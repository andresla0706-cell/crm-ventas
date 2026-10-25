import { getConfig, nowIso } from './db.js';

export const DEFAULT_PRIORIDAD = {
  max_reglas: 50,
  peso_historial: 30,
  peso_frescura: 20,
  horas_frescura: 10,
  reglas: [
    { campo: 'respuesta', pregunta: 'capital', valor: 'más de $50,000', puntos: 35 },
    { campo: 'respuesta', pregunta: 'capital', valor: '$10,000-$50,000', puntos: 25 },
    { campo: 'respuesta', pregunta: 'capital', valor: 'menos de $10,000', puntos: 10 },
    { campo: 'pais', valor: 'US', puntos: 8 },
    { campo: 'pais', valor: 'MX', puntos: 5 },
    { campo: 'correo', valor: 'corporativo', puntos: 5 },
    { campo: 'nombre', valor: 'completo', puntos: 3 },
    { campo: 'hora', valor: 'laboral', puntos: 4 },
    { campo: 'repetido', valor: 'si', puntos: 8 },
  ],
};

export const CAMPOS_REGLA = {
  respuesta: { label: 'Respuesta del formulario', valores: null },
  pais: { label: 'País (código, ej. MX)', valores: null },
  plataforma: { label: 'Plataforma', valores: ['fb', 'ig'] },
  anuncio: { label: 'Anuncio contiene', valores: null },
  campana: { label: 'Campaña contiene', valores: null },
  correo: { label: 'Correo', valores: ['corporativo', 'gratuito', 'sin correo'] },
  nombre: { label: 'Nombre', valores: ['completo', 'incompleto'] },
  hora: { label: 'Hora de llegada', valores: ['laboral', 'noche'] },
  dia: { label: 'Día de llegada', valores: ['entre semana', 'fin de semana'] },
  repetido: { label: 'Repetido (mismo teléfono/correo)', valores: ['si', 'no'] },
};

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const FREE_MAIL = /@(gmail|hotmail|outlook|live|yahoo|icloud|me|aol|protonmail|proton|msn|yandex|mail)\./i;
const TZ = process.env.TZ || 'America/Bogota';

/** Hechos derivados del lead para evaluar reglas que no dependen del formulario. */
function hechos(lead, respuestas, repetido) {
  const llegada = new Date(lead.lead_creado_en || lead.creado_en);
  const hora = Number(llegada.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  const dow = llegada.toLocaleString('en-US', { timeZone: TZ, weekday: 'short' });
  const palabras = String(lead.nombre || '').trim().split(/\s+/).filter((w) => w.length > 1);
  return {
    pais: norm(lead.pais),
    plataforma: norm(lead.platform),
    anuncio: norm(lead.ad_name),
    campana: norm(lead.campaign_name),
    correo: !lead.correo ? 'sin correo' : FREE_MAIL.test(lead.correo) ? 'gratuito' : 'corporativo',
    nombre: palabras.length >= 2 ? 'completo' : 'incompleto',
    hora: hora >= 8 && hora < 20 ? 'laboral' : 'noche',
    dia: ['Sat', 'Sun'].includes(dow) ? 'fin de semana' : 'entre semana',
    repetido: repetido ? 'si' : 'no',
    respuestas: Object.entries(respuestas || {}).map(([k, v]) => [norm(k), norm(v)]),
  };
}

/** Puntos de las reglas del administrador (formulario + perfil del lead). */
function puntosReglas(cfg, lead, respuestas, repetido) {
  let total = 0; const detalle = [];
  const hh = hechos(lead, respuestas, repetido);
  for (const r of cfg.reglas || []) {
    const campo = r.campo || 'respuesta'; const val = norm(r.valor); const pts = Number(r.puntos) || 0;
    if (!val) continue;
    let hit = false, label = '';
    if (campo === 'respuesta') {
      const q = norm(r.pregunta); if (!q) continue;
      hit = hh.respuestas.some(([k, v]) => k.includes(q) && (v === val || v.includes(val)));
      label = `${r.pregunta} = ${r.valor}`;
    } else if (campo === 'anuncio' || campo === 'campana') { hit = !!hh[campo] && hh[campo].includes(val); label = `${campo === 'anuncio' ? 'anuncio' : 'campaña'} ~ ${r.valor}`; }
    else if (campo in hh) { hit = norm(hh[campo]) === val; label = `${CAMPOS_REGLA[campo]?.label.split(' (')[0].toLowerCase() || campo} = ${r.valor}`; }
    if (hit) { total += pts; detalle.push(`${label}: ${pts > 0 ? '+' : ''}${pts}`); }
  }
  return { puntos: Math.max(0, Math.min(cfg.max_reglas, total)), detalle };
}

/** Rango de capital declarado (si existe), para agrupar el historial. */
function capitalBucket(respuestas) {
  for (const [k, v] of Object.entries(respuestas || {})) if (norm(k).includes('capital')) return norm(v);
  return null;
}

/** Tasas de resultado por segmento (anuncio, país, capital) de leads con al menos 3 días de vida. */
export function buildHistorial(db) {
  const limite = new Date(Date.now() - 3 * 86400000).toISOString();
  const rows = db.prepare('SELECT ad_name, pais, respuestas, calificado_en, cliente_en, perdido_en FROM leads WHERE COALESCE(lead_creado_en, creado_en) < ?').all(limite);
  const seg = { ad: new Map(), pais: new Map(), capital: new Map() };
  let gN = 0, gS = 0;
  const bump = (m, k, score) => { if (!k) return; const g = m.get(k) || { n: 0, s: 0 }; g.n++; g.s += score; m.set(k, g); };
  for (const r of rows) {
    let resp = {}; try { resp = JSON.parse(r.respuestas || '{}'); } catch { /* vacío */ }
    const score = r.cliente_en ? 3 : r.calificado_en ? 1 : 0;
    gN++; gS += score;
    bump(seg.ad, norm(r.ad_name), score); bump(seg.pais, norm(r.pais), score); bump(seg.capital, capitalBucket(resp), score);
  }
  return { seg, global: gN ? gS / gN : 0, n: gN };
}

/** 0..peso_historial: 15 neutro; sube o baja según cómo cerraron leads parecidos (mínimo 5 casos por segmento). */
function puntosHistorial(cfg, hist, lead, respuestas) {
  const base = cfg.peso_historial / 2;
  if (!hist || !hist.global || hist.n < 10) return { puntos: base, detalle: 'historial: aún sin datos suficientes' };
  const keys = [[hist.seg.ad, norm(lead.ad_name), 'anuncio'], [hist.seg.pais, norm(lead.pais), 'país'], [hist.seg.capital, capitalBucket(respuestas), 'capital']];
  const ratios = [];
  for (const [m, k, label] of keys) { const g = k ? m.get(k) : null; if (g && g.n >= 5) ratios.push([label, (g.s / g.n) / hist.global]); }
  if (!ratios.length) return { puntos: base, detalle: 'historial: segmentos nuevos' };
  const avg = ratios.reduce((a, [, r]) => a + r, 0) / ratios.length;
  const puntos = Math.max(0, Math.min(cfg.peso_historial, base + (avg - 1) * base));
  return { puntos: Math.round(puntos), detalle: `historial: ${ratios.map(([l, r]) => `${l} ${r >= 1 ? '+' : ''}${Math.round((r - 1) * 100)}%`).join(', ')}` };
}

function puntosFrescura(cfg, lead) {
  const horas = (Date.now() - new Date(lead.lead_creado_en || lead.creado_en).getTime()) / 3600000;
  const puntos = Math.max(0, Math.round(cfg.peso_frescura * (1 - horas / cfg.horas_frescura)));
  return { puntos, detalle: `frescura: ${horas < 1 ? 'recién llegado' : `${Math.floor(horas)} h`}` };
}

function puntosSenales(lead) {
  let p = 0; const d = [];
  const digits = (lead.whatsapp || '').replace(/\D/g, '');
  if (digits.length && digits.length < 8) { p -= 5; d.push('número incompleto −5'); }
  if (!digits.length) { p -= 5; d.push('sin número −5'); }
  if (lead.correo && /(^\d+@|test|asdf|qwerty|xxx|example\.|@mail\.ru$)/i.test(lead.correo)) { p -= 3; d.push('correo dudoso −3'); }
  if (!lead.nombre || lead.nombre.trim().length < 3 || !/[aeiouáéíóú]/i.test(lead.nombre)) { p -= 2; d.push('nombre dudoso −2'); }
  return { puntos: Math.max(-10, p), detalle: d.length ? `señales: ${d.join(', ')}` : 'señales: sin alertas' };
}

export function calcularPrioridad(cfg, hist, lead, repetido = false) {
  let respuestas = lead.respuestas;
  if (typeof respuestas === 'string') { try { respuestas = JSON.parse(respuestas || '{}'); } catch { respuestas = {}; } }
  const r = puntosReglas(cfg, lead, respuestas, repetido), hh = puntosHistorial(cfg, hist, lead, respuestas), f = puntosFrescura(cfg, lead), s = puntosSenales(lead);
  const total = Math.max(0, Math.min(100, Math.round(r.puntos + hh.puntos + f.puntos + s.puntos)));
  const detalle = [r.detalle.length ? `formulario: ${r.detalle.join('; ')} (${r.puntos})` : `formulario: sin reglas que apliquen (0)`, `${hh.detalle} (${hh.puntos})`, `${f.detalle} (${f.puntos})`, `${s.detalle} (${s.puntos})`];
  return { prioridad: total, detalle };
}

/** Recalcula la prioridad de los leads indicados (o de todos los abiertos sin primer contacto). */
export function recalcularPrioridades(db, ids = null) {
  const cfg = { ...DEFAULT_PRIORIDAD, ...(getConfig(db).prioridad || {}) };
  const hist = buildHistorial(db);
  const rows = ids
    ? db.prepare(`SELECT * FROM leads WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare('SELECT * FROM leads WHERE primer_contacto_en IS NULL AND perdido_en IS NULL AND sin_respuesta_en IS NULL').all();
  const upd = db.prepare('UPDATE leads SET prioridad = ?, prioridad_detalle = ? WHERE id = ?');
  const dup = db.prepare('SELECT 1 FROM leads WHERE id != ? AND ((whatsapp IS NOT NULL AND whatsapp = ?) OR (correo IS NOT NULL AND lower(correo) = lower(?))) LIMIT 1');
  let n = 0;
  for (const l of rows) {
    const repetido = !!dup.get(l.id, l.whatsapp || '', l.correo || '');
    const { prioridad, detalle } = calcularPrioridad(cfg, hist, l, repetido);
    if (l.prioridad !== prioridad || !l.prioridad_detalle) { upd.run(prioridad, JSON.stringify(detalle), l.id); n++; }
  }
  return n;
}

export function startPrioridad(db, log = console) {
  try { recalcularPrioridades(db); } catch (e) { log.warn('[prioridad]', e.message); }
  return setInterval(() => { try { recalcularPrioridades(db); } catch (e) { log.warn('[prioridad]', e.message); } }, 30 * 60000);
}
