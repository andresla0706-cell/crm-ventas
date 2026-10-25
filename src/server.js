import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, nowIso, getConfig, setSetting, getSetting, rowToLead, stageMarks, findStage, forwardStage, DEFAULT_SETTINGS } from './db.js';
import { startReparto, repartirLeads } from './reparto.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, publicUser,
  sessionMiddleware, requireAuth, requireAdmin, cookieOptions, COOKIE,
} from './auth.js';
import { leadFromExportRow, insertNewLeads, syncMetaLeads, startMetaPolling, metaStatus, normalizePhone } from './meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'crm.sqlite');
const WEBHOOK_KEY = process.env.WEBHOOK_KEY || '';

const db = openDb(DB_FILE);
bootstrapAdmin();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
app.use(sessionMiddleware(db));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ---------- helpers ----------
const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  leadById: db.prepare('SELECT * FROM leads WHERE id = ?'),
  taskById: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  insertActivity: db.prepare('INSERT INTO activities (lead_id, tipo, texto, de, a, user_id, en) VALUES (?, ?, ?, ?, ?, ?, ?)'),
};

function act(leadId, tipo, texto, userId, de = null, a = null) {
  q.insertActivity.run(leadId, tipo, texto ?? null, de ?? null, a ?? null, userId ?? null, nowIso());
}

function isAdmin(u) { return u.role === 'admin'; }

/** Áreas a las que el usuario tiene acceso (FTD, RET o ambas). */
function allowedAreas(u) { return u.area === 'AMBAS' ? ['FTD', 'RET'] : [u.area]; }
function hasArea(u, area) { return allowedAreas(u).includes(area); }

function canSeeLead(user, lead) {
  if (!hasArea(user, lead.area)) return false;
  if (isAdmin(user)) return true;
  return lead.responsable_id === user.id;
}

function stageName(config, area, id) {
  return (config.etapas[area] || []).find((s) => s.id === id)?.nombre || id;
}

function userName(id) {
  if (id == null) return 'Sin asignar';
  return q.userById.get(id)?.nombre || `Usuario ${id}`;
}

function str(v, max = 500) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function bootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  db.prepare(`INSERT INTO users (username, nombre, password_hash, role, area, activo, debe_cambiar_clave, creado_en)
              VALUES (?, ?, ?, 'admin', 'AMBAS', 1, ?, ?)`)
    .run(username, process.env.ADMIN_NAME || 'Administrador', hashPassword(password), process.env.ADMIN_PASSWORD ? 0 : 1, nowIso());
  getConfig(db);
  console.log(`[crm] Administrador creado: usuario "${username}"${process.env.ADMIN_PASSWORD ? '' : ' con la contraseña por defecto (cámbiala al entrar)'}.`);
}

// ---------- público ----------
app.get('/api/public-config', (_req, res) => {
  const c = getConfig(db);
  res.json({ empresa: c.empresa || '', producto: 'Zigga' });
});

// ---------- auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = q.userByName.get(String(username || '').trim().toLowerCase());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  if (!u.activo) return res.status(403).json({ error: 'Tu usuario está desactivado. Habla con el administrador.' });
  const { token, expires } = createSession(db, u.id);
  res.cookie(COOKIE, token, cookieOptions(req, expires));
  res.json({ user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  destroySession(db, req.sessionToken);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.post('/api/me/password', requireAuth, (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!verifyPassword(String(actual || ''), req.user.password_hash)) return res.status(400).json({ error: 'La contraseña actual no coincide.' });
  if (!nueva || String(nueva).length < 8) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres.' });
  db.prepare('UPDATE users SET password_hash = ?, debe_cambiar_clave = 0 WHERE id = ?').run(hashPassword(String(nueva)), req.user.id);
  res.json({ ok: true });
});

// ---------- bootstrap (everything the UI needs) ----------
app.get('/api/bootstrap', requireAuth, (req, res) => {
  const config = getConfig(db);
  const users = db.prepare('SELECT * FROM users ORDER BY nombre').all().map(publicUser);
  const areas = allowedAreas(req.user);
  const areaSql = `area IN (${areas.map(() => '?').join(',')})`;
  let leads, tasks;
  if (isAdmin(req.user)) {
    leads = db.prepare(`SELECT * FROM leads WHERE ${areaSql} ORDER BY COALESCE(lead_creado_en, creado_en) DESC`).all(...areas);
    tasks = db.prepare(`SELECT * FROM tasks WHERE lead_id IS NULL OR lead_id IN (SELECT id FROM leads WHERE ${areaSql}) ORDER BY fecha`).all(...areas);
  } else {
    leads = db.prepare(`SELECT * FROM leads WHERE responsable_id = ? AND ${areaSql} ORDER BY COALESCE(lead_creado_en, creado_en) DESC`).all(req.user.id, ...areas);
    tasks = db.prepare(`SELECT * FROM tasks WHERE (asignado_id = ? AND lead_id IS NULL) OR lead_id IN (SELECT id FROM leads WHERE responsable_id = ? AND ${areaSql}) ORDER BY fecha`)
      .all(req.user.id, req.user.id, ...areas);
  }
  res.json({
    user: publicUser(req.user),
    config,
    users: isAdmin(req.user) ? users : users.filter((u) => u.activo).map(({ id, nombre, role, area }) => ({ id, nombre, role, area })),
    leads: leads.map(rowToLead),
    tasks: tasks.map((t) => ({ ...t, hecho: !!t.hecho })),
    sin_asignar: isAdmin(req.user) ? db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE responsable_id IS NULL AND ${areaSql}`).get(...areas).n : 0,
    meta: isAdmin(req.user) ? metaStatus(db) : null,
    webhook_configurado: !!WEBHOOK_KEY,
    server_time: nowIso(),
  });
});

// ---------- leads ----------
const LEAD_FIELDS = ['nombre', 'correo', 'whatsapp', 'pais', 'ciudad', 'monto', 'proxima_accion', 'proxima_fecha', 'notas', 'motivo_perdida'];
const FIELD_LABEL = {
  nombre: 'Nombre', correo: 'Correo', whatsapp: 'WhatsApp', pais: 'País', ciudad: 'Ciudad', monto: 'Monto',
  proxima_accion: 'Próxima acción', proxima_fecha: 'Fecha de próxima acción', notas: 'Notas', motivo_perdida: 'Motivo de pérdida',
};

app.post('/api/leads', requireAuth, (req, res) => {
  const config = getConfig(db);
  const b = req.body || {};
  const nombre = str(b.nombre, 200);
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  let area = ['FTD', 'RET'].includes(b.area) ? b.area : allowedAreas(req.user)[0];
  if (!hasArea(req.user, area)) return res.status(403).json({ error: `No tienes acceso al área ${area === 'RET' ? 'Retención' : area}.` });
  let responsable_id = b.responsable_id == null || b.responsable_id === '' ? null : Number(b.responsable_id);
  if (!isAdmin(req.user)) responsable_id = req.user.id;
  if (responsable_id != null) {
    const r = q.userById.get(responsable_id);
    if (!r) return res.status(400).json({ error: 'Ese vendedor no existe.' });
    if (!hasArea(r, area)) return res.status(400).json({ error: `${r.nombre} no tiene acceso al área ${area === 'RET' ? 'Retención' : area}.` });
  }
  const stages = config.etapas[area] || [];
  const etapa = stages.some((s) => s.id === b.etapa) ? b.etapa : stages[0]?.id;
  const now = nowIso();
  const r = db.prepare(`INSERT INTO leads (nombre, correo, whatsapp, pais, ciudad, monto, area, etapa, responsable_id, proxima_accion, proxima_fecha, notas,
      origen_tipo, respuestas, lead_creado_en, creado_en, actualizado_en, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', '{}', ?, ?, ?, ?)`)
    .run(nombre, str(b.correo), normalizePhone(b.whatsapp) || null, str(b.pais, 80), str(b.ciudad, 120), num(b.monto), area, etapa, responsable_id,
      str(b.proxima_accion), isoOrNull(b.proxima_fecha), str(b.notas, 5000), now, now, now, req.user.id);
  if (responsable_id) db.prepare('UPDATE leads SET asignado_en = ?, ultimo_toque_en = ? WHERE id = ?').run(now, responsable_id === req.user.id ? now : null, Number(r.lastInsertRowid));
  const id = Number(r.lastInsertRowid);
  act(id, 'creacion', `Lead creado manualmente por ${req.user.nombre}`, req.user.id);
  if (responsable_id) act(id, 'asignacion', `Asignado a ${userName(responsable_id)}`, req.user.id, null, userName(responsable_id));
  const marks = stageMarks(config, area, etapa, {}, now);
  if (Object.keys(marks).length) applyMarks(id, marks);
  res.status(201).json({ lead: rowToLead(q.leadById.get(id)) });
});

function applyMarks(id, marks) {
  const keys = Object.keys(marks);
  if (!keys.length) return;
  db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => marks[k]), id);
}

app.patch('/api/leads/:id', requireAuth, (req, res) => {
  const lead = q.leadById.get(Number(req.params.id));
  if (!lead || !canSeeLead(req.user, lead)) return res.status(404).json({ error: 'Lead no encontrado.' });
  const config = getConfig(db);
  const b = req.body || {};
  const sets = {};
  const now = nowIso();

  for (const f of LEAD_FIELDS) {
    if (!(f in b)) continue;
    let v;
    if (f === 'monto') v = num(b[f]);
    else if (f === 'proxima_fecha') v = isoOrNull(b[f]);
    else if (f === 'whatsapp') v = normalizePhone(b[f]) || null;
    else v = str(b[f], f === 'notas' ? 5000 : 300);
    if (f === 'nombre' && !v) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
    if ((lead[f] ?? null) !== (v ?? null)) sets[f] = v;
  }

  // Area change (admin, or seller passing to the other area is done via /retencion)
  let area = lead.area;
  if ('area' in b && ['FTD', 'RET'].includes(b.area) && b.area !== lead.area) {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo el administrador cambia el área.' });
    if (!hasArea(req.user, b.area)) return res.status(403).json({ error: `No tienes acceso al área ${b.area === 'RET' ? 'Retención' : b.area}.` });
    area = b.area;
    sets.area = area;
    if (area === 'RET' && !lead.retencion_en) sets.retencion_en = now;
  }
  // Stage change
  if ('etapa' in b && b.etapa !== lead.etapa || sets.area) {
    const stages = config.etapas[area] || [];
    const target = stages.some((s) => s.id === b.etapa) ? b.etapa : (sets.area ? stages[0]?.id : lead.etapa);
    if (target && target !== lead.etapa) {
      sets.etapa = target;
      Object.assign(sets, stageMarks(config, area, target, lead, now));
      const st = stages.find((s) => s.id === target);
      if (st?.tipo !== 'perdida' && !('motivo_perdida' in sets)) sets.motivo_perdida = null;
    }
  }
  // Assignment (admin only)
  if ('responsable_id' in b) {
    const rid = b.responsable_id == null || b.responsable_id === '' ? null : Number(b.responsable_id);
    if (rid !== lead.responsable_id) {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo el administrador asigna leads.' });
      if (rid != null) {
        const r = q.userById.get(rid);
        if (!r) return res.status(400).json({ error: 'Ese vendedor no existe.' });
        if (!hasArea(r, area)) return res.status(400).json({ error: `${r.nombre} no tiene acceso al área ${area === 'RET' ? 'Retención' : area}.` });
      }
      sets.responsable_id = rid;
    }
  }

  if (!Object.keys(sets).length) return res.json({ lead: rowToLead(lead) });
  sets.actualizado_en = now;
  if ('responsable_id' in sets) { sets.asignado_en = sets.responsable_id == null ? null : now; sets.ultimo_toque_en = null; sets.reasignaciones = 0; }
  else if (lead.responsable_id === req.user.id) sets.ultimo_toque_en = now;
  const keys = Object.keys(sets);
  db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), lead.id);

  // History
  if ('area' in sets) act(lead.id, 'area', `Pasó de ${lead.area === 'FTD' ? 'FTD' : 'Retención'} a ${sets.area === 'FTD' ? 'FTD' : 'Retención'}`, req.user.id, lead.area, sets.area);
  if ('etapa' in sets) act(lead.id, 'etapa', `Etapa: ${stageName(config, lead.area, lead.etapa)} → ${stageName(config, area, sets.etapa)}`, req.user.id, stageName(config, lead.area, lead.etapa), stageName(config, area, sets.etapa));
  if ('responsable_id' in sets) act(lead.id, 'asignacion', sets.responsable_id ? `Asignado a ${userName(sets.responsable_id)}` : 'Quedó sin asignar', req.user.id, userName(lead.responsable_id), userName(sets.responsable_id));
  if ('motivo_perdida' in sets && sets.motivo_perdida) act(lead.id, 'campo', `Motivo de pérdida: ${sets.motivo_perdida}`, req.user.id);
  if ('proxima_accion' in sets || 'proxima_fecha' in sets) {
    const pa = 'proxima_accion' in sets ? sets.proxima_accion : lead.proxima_accion;
    const pf = 'proxima_fecha' in sets ? sets.proxima_fecha : lead.proxima_fecha;
    act(lead.id, 'proxima', pa ? `Próxima acción: ${pa}${pf ? ` (${fmtDate(pf)})` : ''}` : 'Próxima acción borrada', req.user.id);
  }
  if ('monto' in sets) act(lead.id, 'campo', `Monto: ${lead.monto ?? '—'} → ${sets.monto ?? '—'}`, req.user.id);
  for (const f of ['nombre', 'correo', 'whatsapp', 'pais', 'ciudad']) {
    if (f in sets) act(lead.id, 'campo', `${FIELD_LABEL[f]} actualizado`, req.user.id, lead[f], sets[f]);
  }
  res.json({ lead: rowToLead(q.leadById.get(lead.id)) });
});

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('es-CO', { timeZone: process.env.TZ || 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
}

app.post('/api/leads/:id/retencion', requireAuth, (req, res) => {
  const lead = q.leadById.get(Number(req.params.id));
  if (!lead || !canSeeLead(req.user, lead)) return res.status(404).json({ error: 'Lead no encontrado.' });
  if (lead.area === 'RET') return res.status(400).json({ error: 'Este lead ya está en Retención.' });
  const config = getConfig(db);
  const first = config.etapas.RET[0]?.id;
  if (!first) return res.status(400).json({ error: 'Retención no tiene etapas configuradas.' });
  let rid = req.body?.responsable_id == null || req.body?.responsable_id === '' ? lead.responsable_id : Number(req.body.responsable_id);
  if (rid !== lead.responsable_id && !isAdmin(req.user)) return res.status(403).json({ error: 'Solo el administrador asigna leads.' });
  if (rid != null) {
    const r = q.userById.get(rid);
    if (!r) return res.status(400).json({ error: 'Ese vendedor no existe.' });
    // Quien no tiene acceso a Retención no puede quedarse con el lead: queda sin asignar para que lo entregue el administrador.
    if (!hasArea(r, 'RET')) {
      if (req.body?.responsable_id != null && req.body?.responsable_id !== '') return res.status(400).json({ error: `${r.nombre} no tiene acceso a Retención.` });
      rid = null;
    }
  }
  const now = nowIso();
  db.prepare('UPDATE leads SET area = ?, etapa = ?, responsable_id = ?, retencion_en = COALESCE(retencion_en, ?), perdido_en = NULL, motivo_perdida = NULL, actualizado_en = ?, asignado_en = ?, ultimo_toque_en = ? WHERE id = ?')
    .run('RET', first, rid, now, now, rid == null ? null : now, rid === req.user.id ? now : null, lead.id);
  act(lead.id, 'area', `Pasó a Retención (etapa ${stageName(config, 'RET', first)})`, req.user.id, 'FTD', 'RET');
  if (rid !== lead.responsable_id) act(lead.id, 'asignacion', rid ? `Asignado a ${userName(rid)}` : 'Quedó sin asignar: pendiente de entregar al equipo de Retención', req.user.id, userName(lead.responsable_id), userName(rid));
  res.json({ lead: rowToLead(q.leadById.get(lead.id)) });
});

app.post('/api/leads/assign', requireAdmin, (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isFinite);
  const rid = req.body?.responsable_id == null || req.body?.responsable_id === '' ? null : Number(req.body.responsable_id);
  const target = rid != null ? q.userById.get(rid) : null;
  if (rid != null && !target) return res.status(400).json({ error: 'Ese vendedor no existe.' });
  const upd = db.prepare('UPDATE leads SET responsable_id = ?, actualizado_en = ?, asignado_en = ?, ultimo_toque_en = NULL, reasignaciones = 0 WHERE id = ?');
  let n = 0, omitidos = 0;
  for (const id of ids) {
    const lead = q.leadById.get(id);
    if (!lead || !canSeeLead(req.user, lead)) continue;
    if (lead.responsable_id === rid) continue;
    if (target && !hasArea(target, lead.area)) { omitidos++; continue; }
    const t = nowIso();
    upd.run(rid, t, rid == null ? null : t, id);
    act(id, 'asignacion', rid ? `Asignado a ${userName(rid)}` : 'Quedó sin asignar', req.user.id, userName(lead.responsable_id), userName(rid));
    n++;
  }
  res.json({ actualizados: n, omitidos, aviso: omitidos ? `${omitidos} lead(s) no se asignaron: ${target.nombre} no tiene acceso a su área.` : null });
});

app.delete('/api/leads/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const lead = q.leadById.get(id);
  if (!lead || !canSeeLead(req.user, lead)) return res.status(404).json({ error: 'Lead no encontrado.' });
  db.prepare('DELETE FROM activities WHERE lead_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE lead_id = ?').run(id);
  const r = db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  res.json({ eliminado: r.changes > 0 });
});

app.get('/api/leads/:id/activities', requireAuth, (req, res) => {
  const lead = q.leadById.get(Number(req.params.id));
  if (!lead || !canSeeLead(req.user, lead)) return res.status(404).json({ error: 'Lead no encontrado.' });
  const rows = db.prepare(`SELECT a.*, u.nombre AS usuario FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? ORDER BY a.en DESC, a.id DESC`).all(lead.id);
  res.json({ activities: rows });
});

app.post('/api/leads/:id/notas', requireAuth, (req, res) => {
  const lead = q.leadById.get(Number(req.params.id));
  if (!lead || !canSeeLead(req.user, lead)) return res.status(404).json({ error: 'Lead no encontrado.' });
  const texto = str(req.body?.texto, 4000);
  if (!texto) return res.status(400).json({ error: 'Escribe la nota.' });
  const tipo = ['nota', 'llamada', 'whatsapp', 'reunion'].includes(req.body?.tipo) ? req.body.tipo : 'nota';
  act(lead.id, tipo, texto, req.user.id);
  db.prepare('UPDATE leads SET actualizado_en = ?, ultimo_toque_en = ? WHERE id = ?').run(nowIso(), nowIso(), lead.id);
  res.status(201).json({ ok: true });
});

// ---------- resultado de un toque (Modo Siguiente) ----------
app.post('/api/leads/:id/resultado', requireAuth, (req, res) => {
  const lead = q.leadById.get(Number(req.params.id));
  if (!lead || !canSeeLead(req.user, lead)) return res.status(404).json({ error: 'Lead no encontrado.' });
  const config = getConfig(db);
  const stages = config.etapas[lead.area] || [];
  const cur = stages.find((st) => st.id === lead.etapa);
  if (cur?.tipo === 'perdida') return res.status(400).json({ error: 'Este lead está marcado como perdido. Cámbiale la etapa para reabrirlo.' });
  const { tipo, nota, fecha } = req.body || {};
  const now = nowIso();
  const sets = { actualizado_en: now, ultimo_toque_en: now };
  const contactado = findStage(stages, { hints: ['contact'] }) || stages[1] || null;
  const calificado = findStage(stages, { tipo: 'calificado' }) || contactado;
  const reunion = findStage(stages, { hints: ['reuni', 'cita', 'agend'] }) || calificado;
  const seguimiento = findStage(stages, { hints: ['seguim'] });
  const markContact = () => { if (!lead.primer_contacto_en) sets.primer_contacto_en = now; sets.ultimo_contacto_en = now; sets.intentos = 0; sets.sin_respuesta_en = null; };
  const plus = (ms) => new Date(Date.now() + ms).toISOString();
  const manana9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };
  let texto, nextStage = lead.etapa;
  switch (tipo) {
    case 'no_contesto': {
      const intentos = (lead.intentos || 0) + 1; sets.intentos = intentos;
      const { max_intentos: max, reintento_minutos: mins } = config.siguiente;
      if (intentos >= max) { sets.sin_respuesta_en = now; sets.proxima_accion = null; sets.proxima_fecha = null; texto = `No contestó (intento ${intentos} de ${max}). Sin respuesta: sale de la cola.`; }
      else { sets.proxima_accion = 'Reintentar llamada'; sets.proxima_fecha = isoOrNull(fecha) || plus(mins * 60000); texto = `No contestó (intento ${intentos} de ${max}). Reintento ${fmtDate(sets.proxima_fecha)}`; }
      break;
    }
    case 'volver': { markContact(); nextStage = forwardStage(stages, lead.etapa, contactado); const f = isoOrNull(fecha) || plus(2 * 3600000); sets.proxima_accion = 'Volver a llamar'; sets.proxima_fecha = f; texto = `Contestó. Volver a llamar ${fmtDate(f)}`; break; }
    case 'interesado': { markContact(); nextStage = forwardStage(stages, lead.etapa, lead.area === 'RET' ? (seguimiento || contactado) : calificado); const f = isoOrNull(fecha) || manana9(); sets.proxima_accion = 'Seguimiento'; sets.proxima_fecha = f; texto = `Contestó, interesado. Seguimiento ${fmtDate(f)}`; break; }
    case 'reunion': { const f = isoOrNull(fecha); if (!f) return res.status(400).json({ error: 'Indica fecha y hora de la reunión.' }); markContact(); nextStage = forwardStage(stages, lead.etapa, reunion); sets.proxima_accion = 'Reunión'; sets.proxima_fecha = f; texto = `Reunión agendada ${fmtDate(f)}`; break; }
    case 'contesto': { markContact(); nextStage = forwardStage(stages, lead.etapa, contactado); texto = 'Contestó'; break; }
    default: return res.status(400).json({ error: 'Resultado desconocido.' });
  }
  if (nextStage !== lead.etapa) { sets.etapa = nextStage; Object.assign(sets, stageMarks(config, lead.area, nextStage, lead, now)); }
  const keys = Object.keys(sets);
  db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), lead.id);
  act(lead.id, 'llamada', texto, req.user.id);
  if (sets.etapa) act(lead.id, 'etapa', `Etapa: ${stageName(config, lead.area, lead.etapa)} → ${stageName(config, lead.area, sets.etapa)}`, req.user.id, stageName(config, lead.area, lead.etapa), stageName(config, lead.area, sets.etapa));
  const n = str(nota, 4000); if (n) act(lead.id, 'nota', n, req.user.id);
  res.json({ lead: rowToLead(q.leadById.get(lead.id)) });
});

// ---------- tasks ----------
app.post('/api/tasks', requireAuth, (req, res) => {
  const b = req.body || {};
  const titulo = str(b.titulo, 300);
  const fecha = isoOrNull(b.fecha);
  if (!titulo || !fecha) return res.status(400).json({ error: 'La tarea necesita título y fecha.' });
  let leadId = b.lead_id == null || b.lead_id === '' ? null : Number(b.lead_id);
  if (leadId != null) {
    const lead = q.leadById.get(leadId);
    if (!lead || !canSeeLead(req.user, lead)) return res.status(404).json({ error: 'Lead no encontrado.' });
  }
  let asignado = b.asignado_id == null || b.asignado_id === '' ? req.user.id : Number(b.asignado_id);
  if (!isAdmin(req.user)) asignado = req.user.id;
  const now = nowIso();
  const r = db.prepare('INSERT INTO tasks (lead_id, titulo, fecha, asignado_id, creado_por, creado_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(leadId, titulo, fecha, asignado, req.user.id, now);
  if (leadId != null) { act(leadId, 'tarea', `Tarea creada: ${titulo} (${fmtDate(fecha)})`, req.user.id); db.prepare('UPDATE leads SET ultimo_toque_en = ? WHERE id = ? AND responsable_id = ?').run(now, leadId, req.user.id); }
  res.status(201).json({ task: { ...q.taskById.get(Number(r.lastInsertRowid)), hecho: false } });
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const t = q.taskById.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada.' });
  if (!isAdmin(req.user) && t.asignado_id !== req.user.id && t.creado_por !== req.user.id) return res.status(403).json({ error: 'No puedes editar esta tarea.' });
  const b = req.body || {};
  const sets = {};
  if ('titulo' in b) { const v = str(b.titulo, 300); if (!v) return res.status(400).json({ error: 'El título no puede quedar vacío.' }); sets.titulo = v; }
  if ('fecha' in b) { const v = isoOrNull(b.fecha); if (!v) return res.status(400).json({ error: 'Fecha inválida.' }); sets.fecha = v; }
  if ('asignado_id' in b && isAdmin(req.user)) sets.asignado_id = b.asignado_id == null || b.asignado_id === '' ? null : Number(b.asignado_id);
  if ('hecho' in b) { sets.hecho = b.hecho ? 1 : 0; sets.hecho_en = b.hecho ? nowIso() : null; }
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), t.id);
  if ('hecho' in sets && t.lead_id != null && sets.hecho !== t.hecho) act(t.lead_id, 'tarea', sets.hecho ? `Tarea completada: ${sets.titulo || t.titulo}` : `Tarea reabierta: ${t.titulo}`, req.user.id);
  const fresh = q.taskById.get(t.id);
  res.json({ task: { ...fresh, hecho: !!fresh.hecho } });
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const t = q.taskById.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada.' });
  if (!isAdmin(req.user) && t.asignado_id !== req.user.id && t.creado_por !== req.user.id) return res.status(403).json({ error: 'No puedes borrar esta tarea.' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ---------- users (admin) ----------
app.post('/api/users', requireAdmin, (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  const nombre = str(b.nombre, 120);
  const password = String(b.password || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'El usuario debe tener de 3 a 40 caracteres: letras minúsculas, números, punto, guion o guion bajo.' });
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (q.userByName.get(username)) return res.status(409).json({ error: 'Ese usuario ya existe.' });
  const role = b.role === 'admin' ? 'admin' : 'vendedor';
  const area = ['FTD', 'RET', 'AMBAS'].includes(b.area) ? b.area : 'FTD';
  const r = db.prepare('INSERT INTO users (username, nombre, password_hash, role, area, activo, debe_cambiar_clave, creado_en) VALUES (?, ?, ?, ?, ?, 1, 1, ?)')
    .run(username, nombre, hashPassword(password), role, area, nowIso());
  res.status(201).json({ user: publicUser(q.userById.get(Number(r.lastInsertRowid))) });
});

app.patch('/api/users/:id', requireAdmin, (req, res) => {
  const u = q.userById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const b = req.body || {};
  const sets = {};
  if ('nombre' in b) { const v = str(b.nombre, 120); if (!v) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' }); sets.nombre = v; }
  if ('role' in b) {
    if (u.id === req.user.id && b.role !== 'admin') return res.status(400).json({ error: 'No puedes quitarte el rol de administrador a ti mismo.' });
    sets.role = b.role === 'admin' ? 'admin' : 'vendedor';
  }
  if ('area' in b && ['FTD', 'RET', 'AMBAS'].includes(b.area)) sets.area = b.area;
  if ('activo' in b) {
    if (u.id === req.user.id && !b.activo) return res.status(400).json({ error: 'No puedes desactivarte a ti mismo.' });
    sets.activo = b.activo ? 1 : 0;
  }
  if ('password' in b) {
    if (String(b.password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    sets.password_hash = hashPassword(String(b.password));
    sets.debe_cambiar_clave = 1;
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), u.id);
  if (sets.activo === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ user: publicUser(q.userById.get(u.id)) });
});

// ---------- settings (admin) ----------
app.put('/api/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const current = getConfig(db);
  const next = { ...current };
  if ('empresa' in b) next.empresa = str(b.empresa, 80) || current.empresa;
  if ('moneda' in b) next.moneda = str(b.moneda, 8) || 'USD';
  if (Array.isArray(b.motivos_perdida)) next.motivos_perdida = b.motivos_perdida.map((m) => str(m, 80)).filter(Boolean).slice(0, 40);
  const int = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
  if (b.siguiente && typeof b.siguiente === 'object') next.siguiente = { reintento_minutos: int(b.siguiente.reintento_minutos, 5, 1440, current.siguiente.reintento_minutos), max_intentos: int(b.siguiente.max_intentos, 1, 10, current.siguiente.max_intentos) };
  if (b.reparto && typeof b.reparto === 'object') next.reparto = { activo: !!b.reparto.activo, tope_diario: int(b.reparto.tope_diario, 0, 1000, current.reparto.tope_diario), reasignar_minutos: int(b.reparto.reasignar_minutos, 0, 1440, current.reparto.reasignar_minutos) };
  if (b.etapas && typeof b.etapas === 'object') {
    for (const area of ['FTD', 'RET']) {
      if (!Array.isArray(b.etapas[area])) continue;
      const seen = new Set();
      const list = [];
      for (const s of b.etapas[area]) {
        const nombre = str(s?.nombre, 60);
        if (!nombre) continue;
        let id = str(s?.id, 60) || slug(nombre);
        if (!/^[a-z0-9_]+$/.test(id)) id = slug(nombre);
        while (seen.has(id)) id += '_2';
        seen.add(id);
        const tipo = ['abierta', 'calificado', 'ganada', 'perdida'].includes(s?.tipo) ? s.tipo : 'abierta';
        list.push({ id, nombre, tipo });
      }
      if (list.length < 2) return res.status(400).json({ error: `El área ${area} necesita al menos dos etapas.` });
      // Leads in a removed stage fall back to the first stage.
      const ids = new Set(list.map((s) => s.id));
      db.prepare(`UPDATE leads SET etapa = ? WHERE area = ? AND etapa NOT IN (${[...ids].map(() => '?').join(',')})`).run(list[0].id, area, ...ids);
      next.etapas = { ...next.etapas, [area]: list };
    }
  }
  setSetting(db, 'config', next);
  res.json({ config: getConfig(db) });
});

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'etapa';
}

// ---------- import / meta / webhook / export ----------
app.post('/api/import', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'El archivo no tiene filas.' });
  if (rows.length > 20000) return res.status(400).json({ error: 'Máximo 20.000 filas por archivo.' });
  const leads = rows.map(leadFromExportRow);
  const r = insertNewLeads(db, leads, { origen: 'import', userId: req.user.id });
  res.json(r);
});

app.post('/api/leads/repartir', requireAdmin, (req, res) => {
  const cfg = getConfig(db).reparto;
  if (!cfg.activo) return res.status(400).json({ error: 'Activa el reparto automático en Ajustes primero.' });
  const ids = db.prepare("SELECT id FROM leads WHERE area = 'FTD' AND responsable_id IS NULL AND perdido_en IS NULL ORDER BY COALESCE(lead_creado_en, creado_en)").all().map((r) => r.id);
  const n = repartirLeads(db, ids);
  res.json({ repartidos: n, pendientes: ids.length - n });
});

app.post('/api/meta/sync', requireAdmin, async (_req, res) => {
  const status = await syncMetaLeads(db, { trigger: 'manual' });
  res.json(status);
});

app.post('/api/webhooks/leads', (req, res) => {
  if (!WEBHOOK_KEY) return res.status(503).json({ error: 'Webhook desactivado: define WEBHOOK_KEY en el servidor.' });
  const key = req.query.key || req.headers['x-webhook-key'];
  if (key !== WEBHOOK_KEY) return res.status(401).json({ error: 'Clave inválida.' });
  const body = req.body || {};
  const items = Array.isArray(body) ? body : Array.isArray(body.leads) ? body.leads : [body];
  const leads = items.map((it) => {
    if (it.field_data) return leadFromExportRow(flattenGraph(it));
    if (it.id && (it.full_name || it.email || it.phone_number)) return leadFromExportRow(it);
    // Simplified shape {nombre, correo, whatsapp, pais, ciudad, respuestas, ...}
    return {
      meta_lead_id: String(it.meta_lead_id || it.id || `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      lead_creado_en: it.created_time ? new Date(it.created_time).toISOString() : null,
      nombre: it.nombre || it.full_name || 'Sin nombre', correo: it.correo || it.email || null,
      whatsapp: normalizePhone(it.whatsapp || it.phone_number || it.telefono) || null,
      pais: it.pais || it.country || null, ciudad: it.ciudad || it.city || null,
      campaign_id: it.campaign_id || null, campaign_name: it.campaign_name || null,
      adset_id: it.adset_id || null, adset_name: it.adset_name || null,
      ad_id: it.ad_id || null, ad_name: it.ad_name || null,
      form_id: it.form_id || null, form_name: it.form_name || null, platform: it.platform || null,
      respuestas: it.respuestas && typeof it.respuestas === 'object' ? it.respuestas : {},
    };
  });
  const r = insertNewLeads(db, leads, { origen: 'webhook', userId: null });
  res.status(201).json(r);
});

function flattenGraph(item) {
  const row = { ...item };
  for (const f of item.field_data || []) row[f.name] = Array.isArray(f.values) ? f.values.join(', ') : '';
  delete row.field_data;
  return row;
}

app.get('/api/export.csv', requireAdmin, (req, res) => {
  const config = getConfig(db);
  const areas = allowedAreas(req.user);
  const rows = db.prepare(`SELECT * FROM leads WHERE area IN (${areas.map(() => '?').join(',')}) ORDER BY id`).all(...areas);
  const cols = ['id', 'nombre', 'correo', 'whatsapp', 'pais', 'ciudad', 'monto', 'area', 'etapa', 'responsable', 'proxima_accion', 'proxima_fecha', 'notas', 'motivo_perdida', 'origen_tipo', 'meta_lead_id', 'campaign_name', 'adset_name', 'ad_name', 'form_name', 'platform', 'respuestas', 'lead_creado_en', 'calificado_en', 'cliente_en', 'perdido_en', 'retencion_en'];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(',')];
  for (const r of rows) {
    const o = { ...r, etapa: stageName(config, r.area, r.etapa), responsable: r.responsable_id ? userName(r.responsable_id) : '' };
    lines.push(cols.map((c) => esc(o[c])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\n'));
});

app.get('/api/health', (_req, res) => res.json({ ok: true, time: nowIso() }));

// ---------- static ----------
// index.html se sirve sin caché y con una firma de versión en los enlaces a CSS/JS,
// así cada despliegue fuerza al navegador a bajar los archivos nuevos.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BUILD_ID = crypto.createHash('md5')
  .update(['index.html', 'styles.css', 'app.js'].map((f) => fs.readFileSync(path.join(PUBLIC_DIR, f))).reduce((h, b) => Buffer.concat([h, b]), Buffer.alloc(0)))
  .digest('hex').slice(0, 10);
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replaceAll('{{v}}', BUILD_ID);
const sendIndex = (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(INDEX_HTML);
};
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(PUBLIC_DIR, {
  index: false, etag: true,
  setHeaders(res, filePath) {
    // Con la firma ?v= en la URL, los archivos pueden guardarse por mucho tiempo.
    res.setHeader('Cache-Control', /\.(css|js)$/.test(filePath) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  },
}));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada.' });
  sendIndex(req, res);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande.' });
  res.status(500).json({ error: 'Error interno. Intenta de nuevo.' });
});

app.listen(PORT, () => {
  console.log(`[crm] Escuchando en puerto ${PORT} · base de datos en ${DB_FILE}`);
  startMetaPolling(db);
  startReparto(db);
});
