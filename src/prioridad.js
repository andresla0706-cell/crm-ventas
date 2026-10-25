import { getConfig, nowIso } from './db.js';

export const DEFAULT_PRIORIDAD = {
  max_reglas: 50,
  peso_historial: 30,
  peso_frescura: 20,
  horas_frescura: 10,
  reglas: [
    { pregunta: 'capital', valor: 'más de $50,000', puntos: 50 },
    { pregunta: 'capital', valor: '$10,000-$50,000', puntos: 35 },
    { pregunta: 'capital', valor: 'menos de $10,000', puntos: 15 },
    { pregunta: 'proceso legal', valor: 'no', puntos: 5 },
  ],
};

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Puntos de las reglas del administrador sobre las respuestas del formulario. */
function puntosReglas(cfg, respuestas) {
  let total = 0; const detalle = [];
  const entries = Object.entries(respuestas || {}).map(([k, v]) => [norm(k), norm(v)]);
  for (const r of cfg.reglas || []) {
    const q = norm(r.pregunta), val = norm(r.valor);
    if (!q || !val) continue;
    const hit = entries.find(([k, v]) => k.includes(q) && (v === val || v.includes(val)));
    if (hit) { total += Number(r.puntos) || 0; detalle.push(`${r.pregunta} = ${r.valor}: ${r.puntos > 0 ? '+' : ''}${r.puntos}`); }
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

export function calcularPrioridad(cfg, hist, lead) {
  let respuestas = lead.respuestas;
  if (typeof respuestas === 'string') { try { respuestas = JSON.parse(respuestas || '{}'); } catch { respuestas = {}; } }
  const r = puntosReglas(cfg, respuestas), hh = puntosHistorial(cfg, hist, lead, respuestas), f = puntosFrescura(cfg, lead), s = puntosSenales(lead);
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
  let n = 0;
  for (const l of rows) {
    const { prioridad, detalle } = calcularPrioridad(cfg, hist, l);
    if (l.prioridad !== prioridad || !l.prioridad_detalle) { upd.run(prioridad, JSON.stringify(detalle), l.id); n++; }
  }
  return n;
}

export function startPrioridad(db, log = console) {
  try { recalcularPrioridades(db); } catch (e) { log.warn('[prioridad]', e.message); }
  return setInterval(() => { try { recalcularPrioridades(db); } catch (e) { log.warn('[prioridad]', e.message); } }, 30 * 60000);
}
