import { getConfig, getSetting, setSetting, nowIso } from './db.js';

/** Vendedores activos con acceso a FTD, en orden estable. */
function vendedoresFTD(db) {
  return db.prepare(`SELECT id, nombre FROM users WHERE activo = 1 AND role = 'vendedor' AND area IN ('FTD','AMBAS') ORDER BY id`).all();
}

function asignadosHoy(db, userId) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return db.prepare('SELECT COUNT(*) AS n FROM leads WHERE responsable_id = ? AND asignado_en >= ?').get(userId, start.toISOString()).n;
}

/** Siguiente vendedor en la rotación con cupo; null si nadie tiene cupo. */
function siguienteVendedor(db, cfg, excluir = []) {
  const lista = vendedoresFTD(db).filter((v) => !excluir.includes(v.id));
  if (!lista.length) return null;
  const puntero = getSetting(db, 'reparto_puntero', null);
  let start = lista.findIndex((v) => v.id === puntero) + 1;
  for (let i = 0; i < lista.length; i++) {
    const v = lista[(start + i) % lista.length];
    if (!cfg.tope_diario || asignadosHoy(db, v.id) < cfg.tope_diario) {
      setSetting(db, 'reparto_puntero', v.id);
      return v;
    }
  }
  return null;
}

/** Reparte por turnos los leads (ids) recién llegados, si el reparto automático está activo. Devuelve cuántos asignó. */
export function repartirLeads(db, ids) {
  const cfg = getConfig(db).reparto;
  if (!cfg.activo) return 0;
  const upd = db.prepare('UPDATE leads SET responsable_id = ?, asignado_en = ?, ultimo_toque_en = NULL, actualizado_en = ? WHERE id = ? AND responsable_id IS NULL AND area = ?');
  const act = db.prepare("INSERT INTO activities (lead_id, tipo, texto, a, en) VALUES (?, 'asignacion', ?, ?, ?)");
  let n = 0;
  for (const id of ids) {
    const v = siguienteVendedor(db, cfg);
    if (!v) break;
    const now = nowIso();
    const r = upd.run(v.id, now, now, id, 'FTD');
    if (r.changes) { act.run(id, `Asignado automáticamente a ${v.nombre} (reparto por turnos)`, v.nombre, now); n++; }
  }
  return n;
}

/** Leads asignados que nadie ha tocado en X minutos pasan al siguiente vendedor. */
export function reasignarOlvidados(db, log = console) {
  const cfg = getConfig(db).reparto;
  if (!cfg.activo || !cfg.reasignar_minutos) return 0;
  const limite = new Date(Date.now() - cfg.reasignar_minutos * 60000).toISOString();
  const vendedores = vendedoresFTD(db);
  if (vendedores.length < 2) return 0;
  const rows = db.prepare(`SELECT id, responsable_id, reasignaciones, nombre FROM leads
    WHERE area = 'FTD' AND responsable_id IS NOT NULL AND primer_contacto_en IS NULL AND ultimo_toque_en IS NULL
      AND sin_respuesta_en IS NULL AND asignado_en IS NOT NULL AND asignado_en < ?`).all(limite);
  const upd = db.prepare('UPDATE leads SET responsable_id = ?, asignado_en = ?, reasignaciones = reasignaciones + 1, actualizado_en = ? WHERE id = ?');
  const libera = db.prepare('UPDATE leads SET responsable_id = NULL, asignado_en = NULL, actualizado_en = ? WHERE id = ?');
  const act = db.prepare("INSERT INTO activities (lead_id, tipo, texto, de, a, en) VALUES (?, 'asignacion', ?, ?, ?, ?)");
  let n = 0;
  for (const l of rows) {
    const now = nowIso();
    const anterior = db.prepare('SELECT nombre FROM users WHERE id = ?').get(l.responsable_id)?.nombre || 'Sin asignar';
    if (l.reasignaciones >= vendedores.length - 1) {
      // Ya pasó por todos: queda sin asignar para que el administrador decida.
      libera.run(now, l.id);
      act.run(l.id, `Nadie lo contactó en ${cfg.reasignar_minutos} min tras pasar por todo el equipo; queda sin asignar`, anterior, 'Sin asignar', now);
      n++;
      continue;
    }
    const v = siguienteVendedor(db, cfg, [l.responsable_id]);
    if (!v) continue;
    upd.run(v.id, now, now, l.id);
    act.run(l.id, `Reasignado a ${v.nombre}: ${anterior} no lo contactó en ${cfg.reasignar_minutos} min`, anterior, v.nombre, now);
    n++;
  }
  if (n) log.log(`[reparto] ${n} lead(s) reasignado(s) por falta de contacto`);
  return n;
}

export function startReparto(db, log = console) {
  return setInterval(() => { try { reasignarOlvidados(db, log); } catch (e) { log.warn('[reparto]', e.message); } }, 60000);
}
