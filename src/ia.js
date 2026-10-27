import { DatabaseSync } from 'node:sqlite';
import { getConfig, nowIso } from './db.js';

const API = 'https://api.anthropic.com/v1/messages';
const TZ = process.env.TZ || 'America/Bogota';

export function iaConfig() {
  return { key: process.env.ANTHROPIC_API_KEY || '', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', activa: !!process.env.ANTHROPIC_API_KEY };
}

/** Llamada cruda a la API de Claude. */
export async function claude({ system, messages, tools, max_tokens = 1500, tool_choice }) {
  const cfg = iaConfig();
  if (!cfg.key) throw new Error('Falta ANTHROPIC_API_KEY en el servidor.');
  const body = { model: cfg.model, max_tokens, system, messages };
  if (tools?.length) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API: ${data.error?.message || res.status}`);
  return data;
}

// ---------- SQL de solo lectura, acotado al usuario ----------
let roDb = null;
function readOnlyDb(file) {
  if (!roDb) roDb = new DatabaseSync(file, { readOnly: true });
  return roDb;
}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|main\.|temp\.|sqlite_)/i;

/** Construye el prefijo WITH que acota las tablas a lo que el usuario puede ver. */
function scopeCTE(db, user) {
  const config = getConfig(db);
  const areas = user.area === 'AMBAS' ? ['FTD', 'RET'] : [user.area];
  const esc = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const areaIn = areas.map(esc).join(',');
  const soloMios = user.role === 'vendedor' ? ` AND responsable_id = ${Number(user.id)}` : '';
  const etapas = [];
  for (const a of ['FTD', 'RET']) for (const st of config.etapas[a] || []) etapas.push(`(${esc(a)},${esc(st.id)},${esc(st.nombre)},${esc(st.tipo)})`);
  return `WITH etapas(area, etapa, nombre, tipo) AS (VALUES ${etapas.join(',')}),
leads AS (SELECT id, nombre, correo, whatsapp, pais, ciudad, monto, area, etapa, responsable_id, proxima_accion, proxima_fecha, notas, motivo_perdida, origen_tipo, campaign_name, adset_name, ad_name, form_name, platform, respuestas, COALESCE(lead_creado_en, creado_en) AS lead_creado_en, creado_en, actualizado_en, calificado_en, cliente_en, perdido_en, retencion_en, primer_contacto_en, ultimo_contacto_en, intentos, sin_respuesta_en, asignado_en, prioridad, repeticiones, ultima_repeticion_en FROM main.leads WHERE area IN (${areaIn})${soloMios}),
usuarios AS (SELECT id, nombre, role, area, activo FROM main.users),
tareas AS (SELECT id, lead_id, titulo, fecha, hecho, hecho_en, asignado_id, creado_en FROM main.tasks WHERE lead_id IN (SELECT id FROM leads)${user.role === 'vendedor' ? ` OR (lead_id IS NULL AND asignado_id = ${Number(user.id)})` : ' OR lead_id IS NULL'}),
actividades AS (SELECT id, lead_id, tipo, texto, user_id, en FROM main.activities WHERE lead_id IN (SELECT id FROM leads)),
repeticiones AS (SELECT id, lead_id, origen, ad_name, campaign_name, form_name, respuestas, en FROM main.repeticiones WHERE lead_id IN (SELECT id FROM leads)),
users AS (SELECT * FROM usuarios), tasks AS (SELECT * FROM tareas), activities AS (SELECT * FROM actividades),
sessions AS (SELECT NULL AS token WHERE 0), settings AS (SELECT NULL AS key WHERE 0)
`;
}

export function consultarSQL(dbFile, db, user, sql) {
  const clean = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!clean) throw new Error('Consulta vacía.');
  if (clean.includes(';')) throw new Error('Solo se permite una consulta.');
  if (FORBIDDEN.test(clean)) throw new Error('Solo se permiten consultas SELECT sobre leads, usuarios, tareas, actividades y etapas.');
  if (!/^\s*(select|with)\b/i.test(clean)) throw new Error('La consulta debe empezar con SELECT.');
  // Si el modelo trae su propio WITH, sus CTEs se encadenan después de las nuestras.
  const final = /^\s*with\b/i.test(clean)
    ? `${scopeCTE(db, user)}, ${clean.replace(/^\s*with\b/i, '').trim()}`
    : `${scopeCTE(db, user)}SELECT * FROM (${clean}) LIMIT 200`;
  const ro = readOnlyDb(dbFile);
  const rows = ro.prepare(final).all();
  return rows.map((r) => ({ ...r }));
}

// ---------- chat ----------
function fechaContexto() {
  const now = new Date();
  const local = now.toLocaleString('es-CO', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' });
  const hoyLocal = now.toLocaleDateString('en-CA', { timeZone: TZ });
  // Medianoche local de hoy en UTC (para filtros de "hoy"): aproximación con el offset actual.
  const offsetMin = (new Date(now.toLocaleString('en-US', { timeZone: TZ })) - new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000;
  const inicioHoy = new Date(`${hoyLocal}T00:00:00Z`); inicioHoy.setMinutes(inicioHoy.getMinutes() - offsetMin);
  const inicioSemana = new Date(inicioHoy); inicioSemana.setUTCDate(inicioSemana.getUTCDate() - ((new Date(hoyLocal + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const inicioMes = new Date(inicioHoy); inicioMes.setUTCDate(1);
  return { local, hoyLocal, inicioHoy: inicioHoy.toISOString(), inicioSemana: inicioSemana.toISOString(), inicioMes: inicioMes.toISOString(), ahora: now.toISOString() };
}

function systemPrompt(db, user) {
  const f = fechaContexto();
  const config = getConfig(db);
  const etapas = ['FTD', 'RET'].map((a) => `${a}: ${(config.etapas[a] || []).map((s) => `${s.id}="${s.nombre}"(${s.tipo})`).join(', ')}`).join('\n');
  return `Eres Zigga, el analista del CRM de ventas "${config.empresa && config.empresa !== 'CRM Ventas' ? config.empresa : 'la empresa'}". Respondes en español, de forma directa y breve, con cifras exactas sacadas de la base de datos mediante la herramienta consultar_sql. Nunca inventes datos: si no consultaste, no afirmes.

Quién pregunta: ${user.nombre} (id ${user.id}), rol ${user.role === 'admin' ? 'administrador' : 'vendedor'}, áreas: ${user.area === 'AMBAS' ? 'FTD y Retención' : user.area === 'RET' ? 'Retención' : 'FTD'}. ${user.role === 'vendedor' ? 'Solo ve sus propios leads (la base ya está filtrada).' : 'Ve todos los leads de sus áreas.'}
Fecha y hora actual: ${f.local} (zona ${TZ}). Las fechas en la base están en ISO 8601 UTC. Límites útiles en UTC: hoy empieza en '${f.inicioHoy}', la semana (lunes) en '${f.inicioSemana}', el mes en '${f.inicioMes}', ahora es '${f.ahora}'.

Tablas disponibles (SQLite, solo lectura):
- leads(id, nombre, correo, whatsapp, pais, ciudad, monto, area ['FTD'|'RET'], etapa [id de etapa], responsable_id, proxima_accion, proxima_fecha, notas, motivo_perdida, origen_tipo ['manual'|'import'|'meta'|'webhook'], campaign_name, adset_name, ad_name, form_name, platform, respuestas [JSON texto: usa json_extract(respuestas, '$.\"pregunta\"')], lead_creado_en, creado_en, actualizado_en, calificado_en, cliente_en, perdido_en, retencion_en, primer_contacto_en, ultimo_contacto_en, intentos, sin_respuesta_en, asignado_en, prioridad, repeticiones [veces que la misma persona volvió a llenar el formulario], ultima_repeticion_en)
- usuarios(id, nombre, role ['admin'|'vendedor'], area ['FTD'|'RET'|'AMBAS'], activo)
- tareas(id, lead_id, titulo, fecha, hecho [0/1], hecho_en, asignado_id, creado_en)
- actividades(id, lead_id, tipo ['creacion','etapa','asignacion','area','nota','llamada','whatsapp','reunion','tarea','campo','proxima','repeticion'], texto, user_id, en)
- repeticiones(id, lead_id, origen, ad_name, campaign_name, form_name, respuestas [JSON texto], en) — cada vez que una persona que ya existía volvió a llenar el formulario; no se crea otro lead
- etapas(area, etapa, nombre, tipo ['abierta'|'calificado'|'ganada'|'perdida'])
Etapas configuradas:
${etapas}
Un lead "calificado" tiene calificado_en no nulo; "cliente/cierre" tiene cliente_en no nulo; "perdido" tiene perdido_en no nulo; "sin contactar" tiene primer_contacto_en nulo y perdido_en nulo. Para días sin tocar usa julianday('now') - julianday(actualizado_en). El monto está en ${config.moneda || 'USD'}.

Reglas de respuesta:
- Usa la herramienta tantas veces como necesites (máximo 5). Escribe SQL de SQLite estándar, un solo SELECT, sin punto y coma. Nombres de tabla exactamente como arriba.
- Cuando listes leads, enlázalos así: [Nombre](#lead-ID). Máximo 20 por lista; si hay más, dilo.
- Da la cifra primero y luego el detalle. Usa viñetas cortas. Sin preámbulos.
- Si la pregunta es de opinión ("¿a quién llamo primero?"), consulta los datos (prioridad, vencidos, sin contactar) y recomienda con criterio, explicando en una línea por qué.
- Si algo no se puede saber con estos datos, dilo claramente.`;
}

const TOOLS = [{
  name: 'consultar_sql',
  description: 'Ejecuta una consulta SELECT de solo lectura sobre las tablas leads, usuarios, tareas, actividades y etapas. Devuelve hasta 200 filas en JSON.',
  input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'Consulta SELECT en SQLite, sin punto y coma.' }, proposito: { type: 'string', description: 'Qué quieres averiguar (una frase).' } }, required: ['sql'] },
}];

/** Conversación con herramientas. messages: [{role, content}] del cliente. */
export async function chatZigga(dbFile, db, user, messages) {
  const system = systemPrompt(db, user);
  const convo = messages.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));
  const consultas = [];
  for (let i = 0; i < 6; i++) {
    const resp = await claude({ system, messages: convo, tools: TOOLS, max_tokens: 1800 });
    const toolUses = (resp.content || []).filter((c) => c.type === 'tool_use');
    if (!toolUses.length || resp.stop_reason !== 'tool_use') {
      const text = (resp.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      return { reply: text || 'No obtuve respuesta.', consultas };
    }
    convo.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const tu of toolUses) {
      let content;
      try {
        const rows = consultarSQL(dbFile, db, user, tu.input?.sql);
        consultas.push({ sql: tu.input?.sql, proposito: tu.input?.proposito || '', filas: rows.length });
        content = JSON.stringify({ filas: rows.length, datos: rows });
        if (content.length > 60000) content = JSON.stringify({ filas: rows.length, datos: rows.slice(0, 60), nota: 'Se recortó la salida; agrupa o limita la consulta.' });
      } catch (e) {
        consultas.push({ sql: tu.input?.sql, error: e.message });
        content = JSON.stringify({ error: e.message });
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content });
    }
    convo.push({ role: 'user', content: results });
  }
  return { reply: 'La consulta se hizo demasiado larga. Intenta una pregunta más concreta.', consultas };
}

/** Texto libre → respuesta corta (para el coach y otros usos). */
export async function textoIA(system, prompt, max_tokens = 1200) {
  const resp = await claude({ system, messages: [{ role: 'user', content: prompt }], max_tokens });
  return (resp.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
}

export { nowIso };
