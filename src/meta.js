import { getConfig, getSetting, setSetting, nowIso } from './db.js';
import { repartirLeads } from './reparto.js';
import { recalcularPrioridades } from './prioridad.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Standard Meta lead-form field names → lead columns.
const STANDARD = {
  full_name: 'nombre', first_name: '_first', last_name: '_last',
  email: 'correo', phone_number: 'whatsapp', country: 'pais', city: 'ciudad',
};
const META_COLUMNS = new Set([
  'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'form_id', 'form_name', 'is_organic', 'platform', 'lead_status', 'full_name', 'first_name', 'last_name',
  'email', 'phone_number', 'country', 'city',
]);

export function prettyQuestion(key) {
  return String(key).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export function prettyAnswer(value) {
  if (value == null) return '';
  return String(value).replace(/_/g, ' ').trim();
}

/** Normalizes one row of a Meta export (object keyed by header) into lead fields. */
export function leadFromExportRow(row) {
  const get = (k) => (row[k] == null ? '' : String(row[k]).trim());
  const lead = {
    meta_lead_id: get('id') || null,
    lead_creado_en: parseMetaTime(get('created_time')),
    nombre: get('full_name') || [get('first_name'), get('last_name')].filter(Boolean).join(' ') || 'Sin nombre',
    correo: get('email') || null,
    whatsapp: normalizePhone(get('phone_number')) || null,
    pais: get('country') || null,
    ciudad: get('city') || null,
    campaign_id: get('campaign_id') || null, campaign_name: get('campaign_name') || null,
    adset_id: get('adset_id') || null, adset_name: get('adset_name') || null,
    ad_id: get('ad_id') || null, ad_name: get('ad_name') || null,
    form_id: get('form_id') || null, form_name: get('form_name') || null,
    platform: get('platform') || null,
    respuestas: {},
  };
  for (const [k, v] of Object.entries(row)) {
    if (META_COLUMNS.has(k) || v == null || String(v).trim() === '') continue;
    lead.respuestas[prettyQuestion(k)] = prettyAnswer(v);
  }
  return lead;
}

/** Normalizes one Graph API lead (with field_data) into lead fields. */
export function leadFromGraph(item, formName) {
  const lead = {
    meta_lead_id: String(item.id),
    lead_creado_en: parseMetaTime(item.created_time),
    nombre: 'Sin nombre', correo: null, whatsapp: null, pais: null, ciudad: null,
    campaign_id: item.campaign_id || null, campaign_name: item.campaign_name || null,
    adset_id: item.adset_id || null, adset_name: item.adset_name || null,
    ad_id: item.ad_id || null, ad_name: item.ad_name || null,
    form_id: item.form_id || null, form_name: formName || null,
    platform: item.platform || null,
    respuestas: {},
  };
  let first = '', last = '';
  for (const f of item.field_data || []) {
    const value = Array.isArray(f.values) ? f.values.filter(Boolean).join(', ') : '';
    const target = STANDARD[f.name];
    if (target === 'nombre') lead.nombre = value || lead.nombre;
    else if (target === '_first') first = value;
    else if (target === '_last') last = value;
    else if (target === 'whatsapp') lead.whatsapp = normalizePhone(value) || null;
    else if (target) lead[target] = value || null;
    else if (value) lead.respuestas[prettyQuestion(f.name)] = prettyAnswer(value);
  }
  if (lead.nombre === 'Sin nombre' && (first || last)) lead.nombre = [first, last].filter(Boolean).join(' ');
  return lead;
}

export function normalizePhone(p) {
  if (!p) return '';
  const s = String(p).trim();
  if (s.startsWith('p:')) return normalizePhone(s.slice(2));
  const digits = s.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : (digits ? `+${digits}` : '');
}

export function parseMetaTime(t) {
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Inserts normalized leads that are not yet in the DB. Returns counts. */
export function insertNewLeads(db, leads, { origen, userId }) {
  const config = getConfig(db);
  const firstStage = config.etapas.FTD[0]?.id || 'nuevo';
  const exists = db.prepare('SELECT id FROM leads WHERE meta_lead_id = ?');
  const insert = db.prepare(`
    INSERT INTO leads (nombre, correo, whatsapp, pais, ciudad, area, etapa, origen_tipo, meta_lead_id,
      campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, form_id, form_name, platform,
      respuestas, lead_creado_en, creado_en, actualizado_en, creado_por)
    VALUES (@nombre, @correo, @whatsapp, @pais, @ciudad, 'FTD', @etapa, @origen, @meta_lead_id,
      @campaign_id, @campaign_name, @adset_id, @adset_name, @ad_id, @ad_name, @form_id, @form_name, @platform,
      @respuestas, @lead_creado_en, @now, @now, @userId)`);
  const activity = db.prepare('INSERT INTO activities (lead_id, tipo, texto, user_id, en) VALUES (?, ?, ?, ?, ?)');
  let nuevos = 0, repetidos = 0, invalidos = 0;
  const ids = [];
  const now = nowIso();
  db.exec('BEGIN');
  try {
    for (const l of leads) {
      if (!l.meta_lead_id) { invalidos++; continue; }
      if (exists.get(l.meta_lead_id)) { repetidos++; continue; }
      const r = insert.run({
        nombre: l.nombre || 'Sin nombre', correo: l.correo ?? null, whatsapp: l.whatsapp ?? null,
        pais: l.pais ?? null, ciudad: l.ciudad ?? null, etapa: firstStage, origen,
        meta_lead_id: l.meta_lead_id,
        campaign_id: l.campaign_id ?? null, campaign_name: l.campaign_name ?? null,
        adset_id: l.adset_id ?? null, adset_name: l.adset_name ?? null,
        ad_id: l.ad_id ?? null, ad_name: l.ad_name ?? null,
        form_id: l.form_id ?? null, form_name: l.form_name ?? null, platform: l.platform ?? null,
        respuestas: JSON.stringify(l.respuestas || {}),
        lead_creado_en: l.lead_creado_en ?? now, now, userId: userId ?? null,
      });
      const id = Number(r.lastInsertRowid);
      ids.push(id);
      const label = origen === 'meta' ? 'Lead recibido de Meta' : origen === 'webhook' ? 'Lead recibido por webhook' : 'Lead importado desde archivo de Meta';
      activity.run(id, 'creacion', `${label}${l.ad_name ? ` · anuncio "${l.ad_name}"` : ''}`, userId ?? null, now);
      nuevos++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  let repartidos = 0;
  if (ids.length) {
    try { recalcularPrioridades(db, ids); } catch (e) { console.warn('[prioridad]', e.message); }
    try { repartidos = repartirLeads(db, ids); } catch (e) { console.warn('[reparto]', e.message); }
  }
  return { nuevos, repetidos, invalidos, ids, repartidos };
}

export function metaConfig() {
  const token = process.env.META_ACCESS_TOKEN || '';
  const forms = (process.env.META_FORM_IDS || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const minutes = Math.max(1, Number(process.env.META_POLL_MINUTES || 5));
  return { enabled: !!token && forms.length > 0, forms, minutes, hasToken: !!token };
}

async function graphGet(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error?.message || `HTTP ${res.status}`;
    throw new Error(`Graph API: ${msg}`);
  }
  return body;
}

/** Pulls leads for every configured form; stops paging once a page holds only known leads. */
export async function syncMetaLeads(db, { trigger = 'auto' } = {}) {
  const cfg = metaConfig();
  const status = { ultimo: nowIso(), trigger, nuevos: 0, repetidos: 0, formularios: [], error: null };
  if (!cfg.enabled) {
    status.error = 'Falta META_ACCESS_TOKEN o META_FORM_IDS en las variables de entorno.';
    setSetting(db, 'meta_sync', status);
    return status;
  }
  const exists = db.prepare('SELECT 1 FROM leads WHERE meta_lead_id = ?');
  const token = encodeURIComponent(process.env.META_ACCESS_TOKEN);
  const fields = 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic';
  try {
    for (const formId of cfg.forms) {
      let formName = null;
      try {
        const f = await graphGet(`${GRAPH}/${formId}?fields=name&access_token=${token}`);
        formName = f.name || null;
      } catch { /* name is optional */ }
      let url = `${GRAPH}/${formId}/leads?fields=${fields}&limit=100&access_token=${token}`;
      const fresh = [];
      let pages = 0;
      while (url && pages < 20) {
        const page = await graphGet(url);
        pages++;
        const data = page.data || [];
        let known = 0;
        for (const item of data) {
          if (exists.get(String(item.id))) { known++; continue; }
          fresh.push(leadFromGraph(item, formName));
        }
        // Meta returns newest first: a page made only of known leads means the rest is older and known too.
        if (data.length === 0 || known === data.length) break;
        url = page.paging?.next || null;
      }
      const r = insertNewLeads(db, fresh, { origen: 'meta', userId: null });
      status.nuevos += r.nuevos;
      status.repetidos += r.repetidos;
      status.formularios.push({ form_id: formId, nombre: formName, nuevos: r.nuevos });
    }
  } catch (e) {
    status.error = e.message;
  }
  setSetting(db, 'meta_sync', status);
  return status;
}

export function startMetaPolling(db, log = console) {
  const cfg = metaConfig();
  if (!cfg.enabled) {
    log.log('[meta] Sincronización automática desactivada (sin META_ACCESS_TOKEN / META_FORM_IDS).');
    return null;
  }
  log.log(`[meta] Sincronizando ${cfg.forms.length} formulario(s) cada ${cfg.minutes} min.`);
  const run = () => syncMetaLeads(db, { trigger: 'auto' })
    .then((s) => { if (s.nuevos) log.log(`[meta] ${s.nuevos} lead(s) nuevo(s)`); if (s.error) log.warn(`[meta] ${s.error}`); })
    .catch((e) => log.warn(`[meta] ${e.message}`));
  setTimeout(run, 5000);
  return setInterval(run, cfg.minutes * 60000);
}

export function metaStatus(db) {
  return { config: metaConfig(), ultimo: getSetting(db, 'meta_sync') };
}
