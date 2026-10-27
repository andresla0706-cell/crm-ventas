import { getConfig, nowIso } from './db.js';
import { notificarUsuario, notificarAdmins } from './push.js';
import { recalcularPrioridades } from './prioridad.js';

/**
 * Repetidos: cuando llega un lead cuyo WhatsApp o correo ya está en la base,
 * no se crea otra ficha. Se anota en el lead original, se le avisa al responsable
 * (notificación + tarea) y se guarda lo que la persona respondió esta vez.
 */

const TITULO_TAREA = 'Te volvió a escribir';
const TITULO_CLIENTE = 'Cliente existente te escribió';

const digitos = (p) => String(p || '').replace(/\D/g, '');

/** Lead ya existente con el mismo WhatsApp o correo (prefiere los abiertos y los más recientes). */
export function buscarOriginal(db, { whatsapp, correo }, excluirId = null) {
  const wa = String(whatsapp || '').trim();
  const mail = String(correo || '').trim().toLowerCase();
  const d = digitos(wa);
  if (!wa && !mail) return null;
  const row = db.prepare(`
    SELECT * FROM leads
    WHERE id != ?
      AND (
        (? != '' AND whatsapp IS NOT NULL AND whatsapp = ?)
        OR (? != '' AND whatsapp IS NOT NULL AND length(?) >= 10 AND substr(replace(whatsapp, '+', ''), -10) = substr(?, -10))
        OR (? != '' AND correo IS NOT NULL AND lower(trim(correo)) = ?)
      )
    ORDER BY (perdido_en IS NULL) DESC, actualizado_en DESC
    LIMIT 1`).get(excluirId ?? -1, wa, wa, d, d, d, mail, mail);
  return row || null;
}

/** Guarda la repetición en el original. Solo escribe en la base; los avisos se mandan con avisarRepeticion(). */
export function registrarRepeticion(db, original, datos, { origen, userId = null, meta_lead_id = null }) {
  const now = nowIso();
  if (meta_lead_id && db.prepare('SELECT 1 FROM repeticiones WHERE meta_lead_id = ?').get(meta_lead_id)) return null;
  const respuestas = datos.respuestas && typeof datos.respuestas === 'object' ? datos.respuestas : {};
  db.prepare(`INSERT INTO repeticiones (lead_id, meta_lead_id, origen, nombre, correo, whatsapp, pais, ciudad, campaign_name, adset_name, ad_name, form_name, platform, respuestas, lead_creado_en, user_id, en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(original.id, meta_lead_id, origen, datos.nombre ?? null, datos.correo ?? null, datos.whatsapp ?? null, datos.pais ?? null, datos.ciudad ?? null,
      datos.campaign_name ?? null, datos.adset_name ?? null, datos.ad_name ?? null, datos.form_name ?? null, datos.platform ?? null,
      JSON.stringify(respuestas), datos.lead_creado_en ?? null, userId, now);

  // Completa vacíos del original con lo nuevo (nunca pisa lo que ya tenía).
  const sets = { repeticiones: (original.repeticiones || 0) + 1, ultima_repeticion_en: now, actualizado_en: now };
  for (const f of ['correo', 'whatsapp', 'pais', 'ciudad']) if (!original[f] && datos[f]) sets[f] = datos[f];
  const keys = Object.keys(sets);
  db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), original.id);

  const esCliente = original.area === 'RET';
  const partes = [esCliente ? 'Cliente existente: volvió a llenar el formulario' : 'Volvió a llenar el formulario'];
  if (origen === 'manual') partes[0] = esCliente ? 'Cliente existente: alguien intentó crearlo de nuevo' : 'Alguien intentó crearlo de nuevo como lead';
  if (datos.ad_name) partes.push(`anuncio "${datos.ad_name}"`);
  const resp = Object.entries(respuestas).filter(([, v]) => v != null && String(v).trim() !== '');
  if (resp.length) partes.push(`respondió: ${resp.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  if (sets.correo || (sets.whatsapp && !original.whatsapp) || sets.pais || sets.ciudad) partes.push('se completaron datos que faltaban');
  db.prepare('INSERT INTO activities (lead_id, tipo, texto, user_id, en) VALUES (?, ?, ?, ?, ?)')
    .run(original.id, 'repeticion', partes.join(' · ').slice(0, 1500), userId, now);

  // Tarea para el responsable (una sola abierta por lead).
  const titulo = `${esCliente ? TITULO_CLIENTE : TITULO_TAREA}: ${original.nombre}`;
  let tareaId = null;
  if (original.responsable_id) {
    const abierta = db.prepare('SELECT id FROM tasks WHERE lead_id = ? AND hecho = 0 AND (titulo LIKE ? OR titulo LIKE ?)').get(original.id, `${TITULO_TAREA}:%`, `${TITULO_CLIENTE}:%`);
    if (abierta) { db.prepare('UPDATE tasks SET fecha = ?, asignado_id = ? WHERE id = ?').run(now, original.responsable_id, abierta.id); tareaId = abierta.id; }
    else {
      const r = db.prepare('INSERT INTO tasks (lead_id, titulo, fecha, hecho, asignado_id, creado_por, creado_en, recordado) VALUES (?, ?, ?, 0, ?, NULL, ?, 1)').run(original.id, titulo, now, original.responsable_id, now);
      tareaId = Number(r.lastInsertRowid);
    }
  }
  try { if (!original.primer_contacto_en) recalcularPrioridades(db, [original.id]); } catch { /* no es crítico */ }
  return { leadId: original.id, nombre: original.nombre, area: original.area, etapa: original.etapa, responsable_id: original.responsable_id, esCliente, perdido: !!original.perdido_en, ad_name: datos.ad_name || null, tareaId };
}

/** Manda la notificación del navegador al responsable (o a los administradores si no hay). Nunca lanza. */
export async function avisarRepeticion(db, rep) {
  if (!rep) return;
  const cfg = getConfig(db);
  const etapa = (cfg.etapas[rep.area] || []).find((s) => s.id === rep.etapa)?.nombre || rep.etapa;
  const detalle = [rep.perdido ? 'estaba perdido' : `está en ${etapa}`, rep.ad_name ? `anuncio "${rep.ad_name}"` : null].filter(Boolean).join(' · ');
  const payload = {
    title: rep.esCliente ? `👤 Cliente existente llenó el formulario: ${rep.nombre}` : `🔁 Te volvió a escribir: ${rep.nombre}`,
    body: detalle, url: `/#lead-${rep.leadId}`, tag: `repeticion-${rep.leadId}`,
  };
  try {
    const resp = rep.responsable_id ? db.prepare('SELECT id, activo FROM users WHERE id = ?').get(rep.responsable_id) : null;
    if (resp && resp.activo) await notificarUsuario(db, resp.id, payload);
    else await notificarAdmins(db, [rep.area], { ...payload, body: `Sin responsable · ${detalle}` });
  } catch { /* la notificación es un extra */ }
}

/** Repeticiones de un lead (para la ficha). */
export function repeticionesDeLead(db, leadId) {
  return db.prepare('SELECT r.*, u.nombre AS usuario FROM repeticiones r LEFT JOIN users u ON u.id = r.user_id WHERE r.lead_id = ? ORDER BY r.en DESC').all(leadId)
    .map((r) => { try { r.respuestas = r.respuestas ? JSON.parse(r.respuestas) : {}; } catch { r.respuestas = {}; } return r; });
}
