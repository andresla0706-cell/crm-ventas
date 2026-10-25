import { getConfig, nowIso } from './db.js';
import { iaConfig, textoIA } from './ia.js';

const TZ = process.env.TZ || 'America/Bogota';
const HORA_COACH = Number(process.env.COACH_HORA || 6);

export function ensureCoachTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS coach (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    creado_en TEXT NOT NULL,
    visto INTEGER NOT NULL DEFAULT 0
  ); CREATE INDEX IF NOT EXISTS idx_coach_user ON coach(user_id, fecha);`);
}

const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const horaLocal = () => Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));

function stageMap(config) {
  const m = {}; for (const a of ['FTD', 'RET']) for (const s of config.etapas[a] || []) m[`${a}:${s.id}`] = s; return m;
}

/** Datos crudos de un vendedor para el coach. */
function datosVendedor(db, config, u) {
  const sm = stageMap(config);
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1); const ayerKey = ayer.toLocaleDateString('en-CA', { timeZone: TZ });
  const leads = db.prepare('SELECT * FROM leads WHERE responsable_id = ?').all(u.id).map((l) => ({ ...l, st: sm[`${l.area}:${l.etapa}`] || { nombre: l.etapa, tipo: 'abierta' } }));
  const abiertos = leads.filter((l) => l.st.tipo !== 'perdida' && !l.sin_respuesta_en);
  const acts = db.prepare("SELECT tipo, texto, en, lead_id FROM activities WHERE user_id = ? AND en >= ? AND tipo IN ('llamada','whatsapp','reunion','nota')").all(u.id, d7);
  const dia = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  const contactos = acts.filter((a) => a.tipo !== 'nota' && !/^No contestó/.test(a.texto || ''));
  const ahora = Date.now();
  const tareas = db.prepare('SELECT titulo, fecha, lead_id FROM tasks WHERE asignado_id = ? AND hecho = 0 AND fecha < ?').all(u.id, nowIso());
  const brief = (l) => ({ id: l.id, nombre: l.nombre, etapa: l.st.nombre, area: l.area, monto: l.monto, pais: l.pais, prioridad: l.prioridad, anuncio: l.ad_name, horas_sin_tocar: Math.round((ahora - new Date(l.actualizado_en).getTime()) / 3600000), capital: (() => { try { const r = JSON.parse(l.respuestas || '{}'); return Object.entries(r).find(([k]) => /capital/i.test(k))?.[1] || null; } catch { return null; } })() });
  return {
    vendedor: u.nombre, area: u.area,
    ayer: { llamadas: acts.filter((a) => a.tipo === 'llamada' && dia(a.en) === ayerKey).length, contactos: contactos.filter((a) => dia(a.en) === ayerKey).length, calificados: leads.filter((l) => l.calificado_en && dia(l.calificado_en) === ayerKey).length, cierres: leads.filter((l) => l.cliente_en && dia(l.cliente_en) === ayerKey).length },
    ultimos7: { llamadas: acts.filter((a) => a.tipo === 'llamada').length, contactos: contactos.length, calificados: leads.filter((l) => l.calificado_en && l.calificado_en >= d7).length, cierres: leads.filter((l) => l.cliente_en && l.cliente_en >= d7).length, monto: leads.filter((l) => l.cliente_en && l.cliente_en >= d7).reduce((a, l) => a + (Number(l.monto) || 0), 0) },
    cartera: { abiertos: abiertos.length, sin_contactar: abiertos.filter((l) => !l.primer_contacto_en).length, sin_seguimiento: abiertos.filter((l) => l.primer_contacto_en && !l.proxima_fecha && l.st.tipo !== 'ganada').length, vencidos: abiertos.filter((l) => l.proxima_fecha && l.proxima_fecha < nowIso()).length, sin_respuesta: leads.filter((l) => l.sin_respuesta_en).length },
    tareas_vencidas: tareas.slice(0, 8).map((t) => ({ titulo: t.titulo, fecha: t.fecha, lead_id: t.lead_id })),
    top_sin_contactar: abiertos.filter((l) => !l.primer_contacto_en).sort((a, b) => (b.prioridad || 0) - (a.prioridad || 0)).slice(0, 6).map(brief),
    olvidados: abiertos.filter((l) => l.primer_contacto_en && !l.proxima_fecha && l.st.tipo !== 'ganada').sort((a, b) => a.actualizado_en.localeCompare(b.actualizado_en)).slice(0, 6).map(brief),
    vencidos: abiertos.filter((l) => l.proxima_fecha && l.proxima_fecha < nowIso()).slice(0, 6).map((l) => ({ ...brief(l), proxima: l.proxima_accion, fecha: l.proxima_fecha })),
  };
}

/** Datos del equipo para el informe del administrador. */
function datosEquipo(db, config, admin) {
  const sm = stageMap(config);
  const areas = admin.area === 'AMBAS' ? ['FTD', 'RET'] : [admin.area];
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const leads = db.prepare(`SELECT * FROM leads WHERE area IN (${areas.map(() => '?').join(',')})`).all(...areas).map((l) => ({ ...l, st: sm[`${l.area}:${l.etapa}`] || { nombre: l.etapa, tipo: 'abierta' } }));
  const users = db.prepare("SELECT id, nombre, area FROM users WHERE activo = 1 AND role = 'vendedor'").all();
  const nombre = (id) => users.find((u) => u.id === id)?.nombre || 'Sin asignar';
  const grp = (arr, key) => { const m = {}; for (const x of arr) { const k = key(x) || '—'; m[k] = (m[k] || 0) + 1; } return m; };
  const abiertos = leads.filter((l) => l.st.tipo !== 'perdida' && !l.sin_respuesta_en);
  const nuevos7 = leads.filter((l) => (l.lead_creado_en || l.creado_en) >= d7);
  const porAnuncio = {}; for (const l of nuevos7) { const k = l.ad_name || (l.origen_tipo === 'manual' ? 'Manual' : 'Sin anuncio'); porAnuncio[k] = porAnuncio[k] || { leads: 0, calificados: 0, cierres: 0 }; porAnuncio[k].leads++; if (l.calificado_en) porAnuncio[k].calificados++; if (l.cliente_en) porAnuncio[k].cierres++; }
  const porVendedor = users.filter((u) => areas.includes(u.area) || u.area === 'AMBAS').map((u) => { const mine = leads.filter((l) => l.responsable_id === u.id); const ab = mine.filter((l) => l.st.tipo !== 'perdida' && !l.sin_respuesta_en); return { vendedor: u.nombre, abiertos: ab.length, sin_contactar: ab.filter((l) => !l.primer_contacto_en).length, vencidos: ab.filter((l) => l.proxima_fecha && l.proxima_fecha < nowIso()).length, calificados7: mine.filter((l) => l.calificado_en && l.calificado_en >= d7).length, cierres7: mine.filter((l) => l.cliente_en && l.cliente_en >= d7).length, monto7: mine.filter((l) => l.cliente_en && l.cliente_en >= d7).reduce((a, l) => a + (Number(l.monto) || 0), 0) }; });
  return {
    areas, totales: { leads: leads.length, abiertos: abiertos.length, nuevos_7d: nuevos7.length, sin_asignar: abiertos.filter((l) => l.responsable_id == null).length, sin_contactar: abiertos.filter((l) => !l.primer_contacto_en).length, vencidos: abiertos.filter((l) => l.proxima_fecha && l.proxima_fecha < nowIso()).length, calificados_7d: leads.filter((l) => l.calificado_en && l.calificado_en >= d7).length, cierres_7d: leads.filter((l) => l.cliente_en && l.cliente_en >= d7).length, perdidos_7d: leads.filter((l) => l.perdido_en && l.perdido_en >= d7).length, sin_respuesta: leads.filter((l) => l.sin_respuesta_en).length },
    embudo: grp(abiertos, (l) => `${l.area}: ${l.st.nombre}`),
    motivos_perdida_7d: grp(leads.filter((l) => l.perdido_en && l.perdido_en >= d7), (l) => l.motivo_perdida),
    por_anuncio_7d: porAnuncio, por_vendedor: porVendedor,
    sin_asignar_viejos: abiertos.filter((l) => l.responsable_id == null).sort((a, b) => (a.lead_creado_en || a.creado_en).localeCompare(b.lead_creado_en || b.creado_en)).slice(0, 5).map((l) => ({ id: l.id, nombre: l.nombre, llego: l.lead_creado_en || l.creado_en, prioridad: l.prioridad })),
    responsable_de: nombre,
  };
}

function parseJSON(text) {
  const clean = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(clean); } catch { const m = clean.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* sigue */ } } }
  return null;
}

const SYSTEM_VENDEDOR = `Eres el coach de ventas de Zigga. Hablas en español, directo y cercano, como un buen jefe de piso: concreto, sin sermones ni frases motivacionales vacías. Recibes los datos de un vendedor (ayer, últimos 7 días, su cartera y listas de leads con id) y devuelves SOLO un JSON válido con esta forma:
{"saludo": "una frase corta y personal sobre cómo le fue ayer o esta semana (con cifras)", "acciones": [{"texto": "qué hacer hoy, específico y accionable", "lead_id": 123 o null}], "observacion": "un patrón que notas en sus datos y qué hacer con él, en 1-2 frases"}
Reglas: exactamente 3 acciones, ordenadas por impacto. Prioriza: tareas y seguimientos vencidos primero, luego leads sin contactar de mayor prioridad, luego leads olvidados (contactados sin próxima acción). Nombra al lead en el texto cuando pongas lead_id. Si no hay nada pendiente, propone acciones de cartera (reactivar olvidados, pedir referidos). Nada de markdown.`;

const SYSTEM_EQUIPO = `Eres el analista jefe de Zigga para el administrador de un equipo de ventas. Español, directo, con cifras. Recibes datos del equipo (totales, embudo por etapa, resultados por vendedor y por anuncio de los últimos 7 días, motivos de pérdida, leads sin asignar) y devuelves SOLO un JSON válido:
{"resumen": "2-3 frases con lo más importante del estado del equipo, con cifras", "alertas": ["cosas que requieren acción hoy: leads sin asignar viejos, vendedores con muchos sin contactar o vencidos, caídas del embudo"], "recomendaciones": ["decisiones concretas: qué anuncio escalar o apagar según calificados/cierres por lead, a quién redistribuir leads, qué etapa destrabar"]}
Reglas: máximo 4 alertas y 4 recomendaciones, cada una de una frase, sin markdown. Si una métrica no tiene datos suficientes, dilo en vez de inventar.`;

/** Genera el coach de hoy para todos (o regenera si force). Devuelve cuántos generó. */
export async function generarCoach(db, { force = false, log = console } = {}) {
  if (!iaConfig().activa) return 0;
  ensureCoachTable(db);
  const config = getConfig(db);
  const fecha = hoyLocal();
  const users = db.prepare('SELECT * FROM users WHERE activo = 1').all();
  const existe = db.prepare('SELECT id FROM coach WHERE user_id = ? AND fecha = ?');
  const ins = db.prepare('INSERT INTO coach (user_id, fecha, tipo, contenido, creado_en) VALUES (?, ?, ?, ?, ?)');
  const del = db.prepare('DELETE FROM coach WHERE user_id = ? AND fecha = ?');
  let n = 0;
  for (const u of users) {
    if (!force && existe.get(u.id, fecha)) continue;
    try {
      let contenido;
      if (u.role === 'vendedor') {
        const datos = datosVendedor(db, config, u);
        if (!datos.cartera.abiertos && !datos.ultimos7.llamadas) continue; // sin cartera no hay coach
        const out = parseJSON(await textoIA(SYSTEM_VENDEDOR, `Fecha: ${fecha}. Datos del vendedor:\n${JSON.stringify(datos)}`, 900));
        if (!out?.acciones) continue;
        contenido = { ...out, acciones: out.acciones.slice(0, 3).map((a) => ({ texto: String(a.texto || '').slice(0, 300), lead_id: Number.isFinite(Number(a.lead_id)) ? Number(a.lead_id) : null })) };
      } else {
        const datos = datosEquipo(db, config, u);
        const out = parseJSON(await textoIA(SYSTEM_EQUIPO, `Fecha: ${fecha}. Datos del equipo:\n${JSON.stringify(datos)}`, 1100));
        if (!out?.resumen) continue;
        contenido = { resumen: String(out.resumen).slice(0, 800), alertas: (out.alertas || []).slice(0, 4).map((x) => String(x).slice(0, 300)), recomendaciones: (out.recomendaciones || []).slice(0, 4).map((x) => String(x).slice(0, 300)) };
      }
      if (force) del.run(u.id, fecha);
      ins.run(u.id, fecha, u.role === 'vendedor' ? 'vendedor' : 'equipo', JSON.stringify(contenido), nowIso());
      n++;
    } catch (e) { log.warn(`[coach] ${u.nombre}: ${e.message}`); }
  }
  if (n) log.log(`[coach] ${n} informe(s) generado(s) para ${fecha}`);
  return n;
}

export function coachDeHoy(db, userId) {
  ensureCoachTable(db);
  const row = db.prepare('SELECT * FROM coach WHERE user_id = ? ORDER BY fecha DESC, id DESC LIMIT 1').get(userId);
  if (!row) return null;
  // Solo se muestra el de hoy o el de ayer (si aún no se generó el de hoy).
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  if (row.fecha < ayer.toLocaleDateString('en-CA', { timeZone: TZ })) return null;
  let contenido; try { contenido = JSON.parse(row.contenido); } catch { return null; }
  return { id: row.id, fecha: row.fecha, tipo: row.tipo, visto: !!row.visto, ...contenido };
}

export function marcarVisto(db, userId, id) {
  ensureCoachTable(db);
  return db.prepare('UPDATE coach SET visto = 1 WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function startCoach(db, log = console) {
  ensureCoachTable(db);
  if (!iaConfig().activa) { log.log('[coach] Desactivado (sin ANTHROPIC_API_KEY).'); return null; }
  const tick = () => { if (horaLocal() >= HORA_COACH) generarCoach(db, { log }).catch((e) => log.warn('[coach]', e.message)); };
  setTimeout(tick, 15000);
  return setInterval(tick, 5 * 60000);
}
