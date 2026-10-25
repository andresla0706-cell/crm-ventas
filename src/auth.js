import crypto from 'node:crypto';
import { nowIso } from './db.js';

const SESSION_DAYS = 30;
export const COOKIE = 'crm_sid';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_DAYS * 86400000);
  db.prepare('INSERT INTO sessions (token, user_id, creado_en, expira_en) VALUES (?, ?, ?, ?)')
    .run(token, userId, created.toISOString(), expires.toISOString());
  db.prepare('UPDATE users SET ultimo_acceso = ? WHERE id = ?').run(created.toISOString(), userId);
  return { token, expires };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, nombre: u.nombre, role: u.role, area: u.area,
    activo: !!u.activo, debe_cambiar_clave: !!u.debe_cambiar_clave,
    creado_en: u.creado_en, ultimo_acceso: u.ultimo_acceso,
  };
}

export function sessionMiddleware(db) {
  const findUser = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expira_en > ? AND u.activo = 1`);
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE];
    req.user = null;
    if (token) {
      const u = findUser.get(token, nowIso());
      if (u) req.user = u;
      req.sessionToken = token;
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No has iniciado sesión.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede hacer esto.' });
  next();
}

export function cookieOptions(req, expires) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    expires,
    path: '/',
  };
}
