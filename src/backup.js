import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from './db.js';

const TZ = process.env.TZ || 'America/Bogota';
const HORA_BACKUP = Number(process.env.BACKUP_HORA || 3);
const KEEP = Number(process.env.BACKUP_KEEP || 14);

export function backupDir(dataDir) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Copia consistente de la base (VACUUM INTO) con fecha; devuelve la ruta. */
export function hacerBackup(db, dataDir, etiqueta = '') {
  const dir = backupDir(dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `zigga-${stamp}${etiqueta ? `-${etiqueta}` : ''}.sqlite`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  podar(dir);
  return file;
}

function podar(dir) {
  const files = listar(dir);
  for (const f of files.slice(KEEP)) { try { fs.unlinkSync(path.join(dir, f.nombre)); } catch { /* ignorar */ } }
}

export function listar(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).map((f) => { const st = fs.statSync(path.join(dir, f)); return { nombre: f, bytes: st.size, creado: st.mtime.toISOString() }; })
    .sort((a, b) => b.creado.localeCompare(a.creado));
}

export function listarBackups(dataDir) {
  return listar(backupDir(dataDir));
}

export function startBackups(db, dataDir, log = console) {
  const hoyKey = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const horaLocal = () => Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  const tick = () => {
    try {
      if (horaLocal() < HORA_BACKUP) return;
      const ultimo = listarBackups(dataDir)[0];
      if (ultimo && new Date(ultimo.creado).toLocaleDateString('en-CA', { timeZone: TZ }) === hoyKey()) return;
      const f = hacerBackup(db, dataDir, 'auto');
      log.log(`[backup] Copia diaria creada: ${path.basename(f)}`);
    } catch (e) { log.warn('[backup]', e.message); }
  };
  setTimeout(tick, 20000);
  return setInterval(tick, 10 * 60000);
}

export { nowIso };
