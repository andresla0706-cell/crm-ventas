import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  empresa: 'CRM Ventas',
  moneda: 'USD',
  etapas: {
    FTD: [
      { id: 'nuevo', nombre: 'Nuevo', tipo: 'abierta' },
      { id: 'contactado', nombre: 'Contactado', tipo: 'abierta' },
      { id: 'calificado', nombre: 'Calificado', tipo: 'calificado' },
      { id: 'reunion', nombre: 'Reunión agendada', tipo: 'abierta' },
      { id: 'propuesta', nombre: 'Propuesta enviada', tipo: 'abierta' },
      { id: 'cliente', nombre: 'Cliente', tipo: 'ganada' },
      { id: 'perdido', nombre: 'Perdido', tipo: 'perdida' },
    ],
    RET: [
      { id: 'ret_nuevo', nombre: 'Nuevo en retención', tipo: 'abierta' },
      { id: 'ret_contactado', nombre: 'Contactado', tipo: 'abierta' },
      { id: 'ret_seguimiento', nombre: 'En seguimiento', tipo: 'abierta' },
      { id: 'ret_redeposito', nombre: 'Redepósito', tipo: 'ganada' },
      { id: 'ret_inactivo', nombre: 'Inactivo', tipo: 'perdida' },
    ],
  },
  motivos_perdida: ['No contesta', 'Sin presupuesto', 'No le interesa', 'Datos falsos', 'Número inválido', 'Otro'],
  siguiente: { reintento_minutos: 120, max_intentos: 3 },
  reparto: { activo: false, tope_diario: 0, reasignar_minutos: 15 },
  prioridad: {
    max_reglas: 50, peso_historial: 30, peso_frescura: 20, horas_frescura: 10,
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
  },
};

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','vendedor')),
      area TEXT NOT NULL DEFAULT 'FTD' CHECK (area IN ('FTD','RET','AMBAS')),
      activo INTEGER NOT NULL DEFAULT 1,
      debe_cambiar_clave INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL,
      ultimo_acceso TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      creado_en TEXT NOT NULL,
      expira_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      correo TEXT,
      whatsapp TEXT,
      pais TEXT,
      ciudad TEXT,
      monto REAL,
      area TEXT NOT NULL DEFAULT 'FTD',
      etapa TEXT NOT NULL,
      responsable_id INTEGER,
      proxima_accion TEXT,
      proxima_fecha TEXT,
      notas TEXT,
      motivo_perdida TEXT,
      origen_tipo TEXT NOT NULL DEFAULT 'manual',
      meta_lead_id TEXT UNIQUE,
      campaign_id TEXT, campaign_name TEXT,
      adset_id TEXT, adset_name TEXT,
      ad_id TEXT, ad_name TEXT,
      form_id TEXT, form_name TEXT,
      platform TEXT,
      respuestas TEXT,
      lead_creado_en TEXT,
      creado_en TEXT NOT NULL,
      actualizado_en TEXT NOT NULL,
      creado_por INTEGER,
      calificado_en TEXT,
      cliente_en TEXT,
      perdido_en TEXT,
      retencion_en TEXT,
      evento_meta_enviado INTEGER NOT NULL DEFAULT 0,
      evento_meta_fecha TEXT,
      evento_meta_respuesta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_resp ON leads(responsable_id);
    CREATE INDEX IF NOT EXISTS idx_leads_area_etapa ON leads(area, etapa);
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      texto TEXT,
      de TEXT,
      a TEXT,
      user_id INTEGER,
      en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_act_lead ON activities(lead_id, en);
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      titulo TEXT NOT NULL,
      fecha TEXT NOT NULL,
      hecho INTEGER NOT NULL DEFAULT 0,
      hecho_en TEXT,
      asignado_id INTEGER,
      creado_por INTEGER,
      creado_en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_asig ON tasks(asignado_id, hecho, fecha);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repeticiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      meta_lead_id TEXT UNIQUE,
      origen TEXT NOT NULL,
      nombre TEXT, correo TEXT, whatsapp TEXT, pais TEXT, ciudad TEXT,
      campaign_name TEXT, adset_name TEXT, ad_name TEXT, form_name TEXT, platform TEXT,
      respuestas TEXT,
      lead_creado_en TEXT,
      user_id INTEGER,
      en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rep_lead ON repeticiones(lead_id, en);
  `);
  migrate(db);
  return db;
}

/** Columnas añadidas después de la primera versión (SQLite no tiene IF NOT EXISTS para columnas). */
function migrate(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name));
  const add = (name, type) => { if (!cols.has(name)) db.exec(`ALTER TABLE leads ADD COLUMN ${name} ${type}`); };
  add('primer_contacto_en', 'TEXT');
  add('ultimo_contacto_en', 'TEXT');
  add('intentos', 'INTEGER NOT NULL DEFAULT 0');
  add('sin_respuesta_en', 'TEXT');
  add('asignado_en', 'TEXT');
  add('ultimo_toque_en', 'TEXT');
  add('reasignaciones', 'INTEGER NOT NULL DEFAULT 0');
  add('prioridad', 'REAL');
  add('prioridad_detalle', 'TEXT');
  add('repeticiones', 'INTEGER NOT NULL DEFAULT 0');
  add('ultima_repeticion_en', 'TEXT');
}

export function nowIso() {
  return new Date().toISOString();
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function getConfig(db) {
  const saved = getSetting(db, 'config');
  if (!saved) {
    setSetting(db, 'config', DEFAULT_SETTINGS);
    return structuredClone(DEFAULT_SETTINGS);
  }
  // Fill gaps from defaults without overwriting what the admin changed.
  const merged = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  merged.etapas = { ...DEFAULT_SETTINGS.etapas, ...(saved.etapas || {}) };
  merged.siguiente = { ...DEFAULT_SETTINGS.siguiente, ...(saved.siguiente || {}) };
  merged.reparto = { ...DEFAULT_SETTINGS.reparto, ...(saved.reparto || {}) };
  merged.prioridad = { ...DEFAULT_SETTINGS.prioridad, ...(saved.prioridad || {}) };
  return merged;
}

export function rowToLead(row) {
  if (!row) return null;
  const lead = { ...row };
  try { lead.respuestas = row.respuestas ? JSON.parse(row.respuestas) : {}; } catch { lead.respuestas = {}; }
  try { lead.prioridad_detalle = row.prioridad_detalle ? JSON.parse(row.prioridad_detalle) : null; } catch { lead.prioridad_detalle = null; }
  lead.evento_meta_enviado = !!row.evento_meta_enviado;
  return lead;
}

const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Busca una etapa por tipo o por palabras en el nombre; devuelve null si no hay. */
export function findStage(stages, { tipo, hints = [] }) {
  if (tipo) { const byTipo = stages.find((s) => s.tipo === tipo); if (byTipo) return byTipo; }
  for (const hnt of hints) { const byName = stages.find((s) => norm(s.nombre).includes(hnt)); if (byName) return byName; }
  return null;
}

/** La etapa a la que debe avanzar un lead según un resultado, sin retroceder nunca. */
export function forwardStage(stages, currentId, target) {
  if (!target) return currentId;
  const cur = stages.findIndex((s) => s.id === currentId);
  const nxt = stages.findIndex((s) => s.id === target.id);
  if (nxt < 0) return currentId;
  const curStage = stages[cur];
  if (curStage && (curStage.tipo === 'ganada' || curStage.tipo === 'perdida')) return currentId;
  return nxt > cur ? target.id : currentId;
}

/** Stage-derived timestamps when a lead enters `etapaId` within `area`. */
export function stageMarks(config, area, etapaId, lead, when) {
  const stages = config.etapas[area] || [];
  const idx = stages.findIndex((s) => s.id === etapaId);
  const stage = stages[idx];
  const marks = {};
  if (!stage) return marks;
  const calIdx = stages.findIndex((s) => s.tipo === 'calificado');
  if (stage.tipo === 'perdida') {
    marks.perdido_en = when;
  } else {
    marks.perdido_en = null;
    if (calIdx >= 0 && idx >= calIdx && !lead.calificado_en) marks.calificado_en = when;
    if (stage.tipo === 'ganada' && !lead.cliente_en) marks.cliente_en = when;
  }
  return marks;
}
