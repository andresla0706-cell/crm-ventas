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
  `);
  return db;
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
  return merged;
}

export function rowToLead(row) {
  if (!row) return null;
  const lead = { ...row };
  try { lead.respuestas = row.respuestas ? JSON.parse(row.respuestas) : {}; } catch { lead.respuestas = {}; }
  lead.evento_meta_enviado = !!row.evento_meta_enviado;
  return lead;
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
