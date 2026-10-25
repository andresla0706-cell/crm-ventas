import webpush from 'web-push';
import { getSetting, setSetting, nowIso } from './db.js';

let ready = false;

export function ensurePush(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    agente TEXT,
    creado_en TEXT NOT NULL,
    ultimo_envio TEXT
  ); CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);`);
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  if (!cols('tasks').has('recordado')) db.exec('ALTER TABLE tasks ADD COLUMN recordado INTEGER NOT NULL DEFAULT 0');
  if (!cols('leads').has('proxima_recordada')) db.exec('ALTER TABLE leads ADD COLUMN proxima_recordada TEXT');
  let k = getSetting(db, 'vapid');
  if (!k?.publicKey) { k = webpush.generateVAPIDKeys(); setSetting(db, 'vapid', k); }
  webpush.setVapidDetails(`mailto:${process.env.VAPID_EMAIL || 'soporte@zigga.app'}`, k.publicKey, k.privateKey);
  ready = true;
  return k.publicKey;
}

export function publicKey(db) { return getSetting(db, 'vapid')?.publicKey || ensurePush(db); }

export function suscribir(db, userId, sub, agente) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Suscripción inválida.');
  db.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, agente, creado_en) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, agente = excluded.agente`)
    .run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(agente || '').slice(0, 200), nowIso());
}

export function darDeBaja(db, userId, endpoint) {
  return db.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes;
}

export function contarSubs(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(userId).n;
}

/** Envía una notificación a todos los dispositivos de un usuario. Nunca lanza. */
export async function notificarUsuario(db, userId, payload) {
  if (!ready || userId == null) return 0;
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId);
  if (!subs.length) return 0;
  const body = JSON.stringify({ title: payload.title, body: payload.body || '', url: payload.url || '/', tag: payload.tag || `zigga-${Date.now()}`, icon: '/icon-192.png' });
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 });
      db.prepare('UPDATE push_subs SET ultimo_envio = ? WHERE id = ?').run(nowIso(), s.id); ok++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id);
      else console.warn('[push]', e.statusCode || '', e.body || e.message);
    }
  }));
  return ok;
}

/** Avisa a los administradores con acceso a alguna de las áreas. */
export async function notificarAdmins(db, areas, payload) {
  const list = Array.isArray(areas) ? areas : [areas];
  const admins = db.prepare("SELECT id, area FROM users WHERE activo = 1 AND role = 'admin'").all().filter((a) => a.area === 'AMBAS' || list.includes(a.area));
  await Promise.all(admins.map((a) => notificarUsuario(db, a.id, payload)));
}

const fmt = (iso) => new Date(iso).toLocaleString('es-CO', { timeZone: process.env.TZ || 'America/Bogota', hour: '2-digit', minute: '2-digit' });

/** Recordatorios: tareas y próximas acciones cuya hora acaba de llegar. */
export async function enviarRecordatorios(db) {
  if (!ready) return;
  const now = nowIso();
  const desde = new Date(Date.now() - 10 * 60000).toISOString(); // tolera reinicios de hasta 10 min
  const tareas = db.prepare('SELECT t.*, l.nombre AS lead_nombre FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id WHERE t.hecho = 0 AND t.recordado = 0 AND t.fecha >= ? AND t.fecha <= ?').all(desde, now);
  for (const t of tareas) {
    db.prepare('UPDATE tasks SET recordado = 1 WHERE id = ?').run(t.id);
    await notificarUsuario(db, t.asignado_id, { title: `⏰ ${t.titulo}`, body: t.lead_nombre ? `${t.lead_nombre} · ${fmt(t.fecha)}` : fmt(t.fecha), url: t.lead_id ? `/#lead-${t.lead_id}` : '/#tareas', tag: `tarea-${t.id}` });
  }
  const leads = db.prepare('SELECT id, nombre, pais, proxima_accion, proxima_fecha, responsable_id FROM leads WHERE responsable_id IS NOT NULL AND proxima_fecha >= ? AND proxima_fecha <= ? AND (proxima_recordada IS NULL OR proxima_recordada != proxima_fecha)').all(desde, now);
  for (const l of leads) {
    db.prepare('UPDATE leads SET proxima_recordada = ? WHERE id = ?').run(l.proxima_fecha, l.id);
    await notificarUsuario(db, l.responsable_id, { title: `⏰ ${l.proxima_accion || 'Próxima acción'}: ${l.nombre}`, body: `${l.pais || ''} · ${fmt(l.proxima_fecha)}`.replace(/^ · /, ''), url: `/#lead-${l.id}`, tag: `lead-${l.id}-${l.proxima_fecha}` });
  }
}

export function startRecordatorios(db, log = console) {
  return setInterval(() => enviarRecordatorios(db).catch((e) => log.warn('[push]', e.message)), 60000);
}

/** Texto corto para el aviso de lead nuevo. */
export function leadAviso(l) {
  const partes = [l.pais, l.prioridad != null ? `Prioridad ${Math.round(l.prioridad)}` : null, l.ad_name].filter(Boolean);
  return { title: `Nuevo lead: ${l.nombre}`, body: partes.join(' · '), url: `/#lead-${l.id}`, tag: `nuevo-${l.id}` };
}
