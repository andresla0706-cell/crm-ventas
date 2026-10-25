/* CRM Ventas — interfaz. Vanilla JS, sin build. */
(() => {
  'use strict';

  // ---------- estado ----------
  const S = {
    user: null, config: null, users: [], leads: [], tasks: [], sinAsignar: 0, meta: null, webhook: false,
    view: 'tablero', area: 'FTD', q: '', listFilters: { etapa: '', responsable: '', origen: '', sort: 'creado', dir: 'desc' },
    boardFilter: { responsable: '' }, metricFilters: { periodo: '30', area: 'FTD', responsable: '' },
    openLeadId: null, activities: [], selected: new Set(), pollTimer: null, lastSnapshot: '',
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    tablero: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></svg>',
    lista: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    tareas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    metricas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    equipo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    importar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    cuenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4 5.2 5.2 0 0 0 3.2.7 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>',
  };

  const COUNTRIES = { AR: 'Argentina', BO: 'Bolivia', BR: 'Brasil', CL: 'Chile', CO: 'Colombia', CR: 'Costa Rica', CU: 'Cuba', DO: 'Rep. Dominicana', EC: 'Ecuador', SV: 'El Salvador', GT: 'Guatemala', HN: 'Honduras', MX: 'México', NI: 'Nicaragua', PA: 'Panamá', PY: 'Paraguay', PE: 'Perú', PR: 'Puerto Rico', UY: 'Uruguay', VE: 'Venezuela', US: 'Estados Unidos', ES: 'España', CA: 'Canadá', IT: 'Italia', FR: 'Francia', DE: 'Alemania', GB: 'Reino Unido', PT: 'Portugal' };
  const countryName = (c) => (c && COUNTRIES[String(c).toUpperCase()]) || c || '';
  const flag = (c) => {
    if (!c || !/^[A-Za-z]{2}$/.test(c)) return '';
    return String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  };
  const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const money = (v) => (v == null || v === '' ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: S.config?.moneda || 'USD', maximumFractionDigits: 0 }).format(Number(v)));
  const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '');
  const ago = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'ahora'; if (s < 3600) return `hace ${Math.floor(s / 60)} min`; if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    const d = Math.floor(s / 86400); return d < 30 ? `hace ${d} d` : fmtD(iso);
  };
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
  const dueClass = (iso) => {
    if (!iso) return '';
    const d = new Date(iso); const now = new Date();
    if (d < now) return 'late';
    return d.toDateString() === now.toDateString() ? 'today' : '';
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const userById = (id) => S.users.find((u) => u.id === id);
  const uname = (id) => (id == null ? 'Sin asignar' : userById(id)?.nombre || 'Usuario');
  const stages = (area) => S.config?.etapas?.[area] || [];
  const stage = (lead) => stages(lead.area).find((s) => s.id === lead.etapa) || { id: lead.etapa, nombre: lead.etapa, tipo: 'abierta' };
  const isAdmin = () => S.user?.role === 'admin';
  const areaLabel = (a) => (a === 'RET' ? 'Retención' : a === 'AMBAS' ? 'FTD + Retención' : 'FTD');
  const userAreas = (u) => (u?.area === 'AMBAS' ? ['FTD', 'RET'] : u?.area ? [u.area] : []);
  const userHasArea = (u, a) => userAreas(u).includes(a);
  const myAreas = () => userAreas(S.user);
  const bothAreas = () => S.user?.area === 'AMBAS';
  const usersForArea = (a) => S.users.filter((u) => u.activo !== false && userHasArea(u, a));
  const origenLabel = (l) => (l.origen_tipo === 'manual' ? 'Manual' : l.origen_tipo === 'import' ? 'Meta (archivo)' : l.origen_tipo === 'webhook' ? 'Webhook' : 'Meta');

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch { /* vacío */ }
    if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error(data.error || 'Sesión expirada.'); }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }
  function toast(msg, kind = '') {
    const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = msg;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), kind === 'bad' ? 5000 : 2600);
  }
  const fail = (e) => toast(e.message || String(e), 'bad');

  /** Nombre de la empresa configurado en Ajustes ('' si todavía es el valor por defecto). */
  function empresaName(cfg = S.config) { const e = (cfg?.empresa || '').trim(); return e && e !== 'CRM Ventas' ? e : ''; }

  // ---------- sesión ----------
  function showLogin() {
    clearInterval(S.pollTimer);
    $('#app').hidden = true; $('#login').hidden = false; $('#overlay').innerHTML = '';
    setTimeout(() => $('#loginUser').focus(), 50);
    fetch('/api/public-config', { credentials: 'same-origin' }).then((r) => r.json()).then((c) => {
      const e = empresaName(c); $('#loginEmpresa').textContent = e || 'Bienvenido'; document.title = e ? `Zigga · ${e}` : 'Zigga';
    }).catch(() => {});
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'); btn.disabled = true; $('#loginError').textContent = '';
    try {
      await api('POST', '/api/login', { username: $('#loginUser').value, password: $('#loginPass').value });
      $('#loginPass').value = '';
      await start();
    } catch (err) { $('#loginError').textContent = err.message; }
    btn.disabled = false;
  });
  $('#logoutBtn').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch { /* igual salimos */ } showLogin(); });

  async function load(silent = false) {
    const d = await api('GET', '/api/bootstrap');
    const snap = JSON.stringify([d.leads, d.tasks, d.users, d.config, d.sin_asignar, d.meta?.ultimo]);
    const changed = snap !== S.lastSnapshot;
    S.lastSnapshot = snap;
    Object.assign(S, { user: d.user, config: d.config, users: d.users, leads: d.leads, tasks: d.tasks, sinAsignar: d.sin_asignar, meta: d.meta, webhook: d.webhook_configurado });
    if (!silent || changed) { render(); if (S.openLeadId) refreshDrawer(); }
  }
  async function start() {
    await load();
    $('#login').hidden = true; $('#app').hidden = false;
    if (!bothAreas()) { S.area = myAreas()[0] || 'FTD'; S.metricFilters.area = S.area; }
    if (!location.hash) location.hash = '#tablero';
    route();
    clearInterval(S.pollTimer);
    S.pollTimer = setInterval(() => { if (document.visibilityState === 'visible') load(true).catch(() => {}); }, 45000);
    if (S.user.debe_cambiar_clave) passwordModal(true);
  }

  // ---------- navegación ----------
  const VIEWS = [
    { id: 'tablero', label: 'Tablero', admin: false }, { id: 'lista', label: 'Lista', admin: false }, { id: 'tareas', label: 'Tareas', admin: false },
    { id: 'metricas', label: 'Métricas', admin: false }, { id: 'equipo', label: 'Equipo', admin: true }, { id: 'importar', label: 'Importar', admin: true },
    { id: 'ajustes', label: 'Ajustes', admin: true }, { id: 'cuenta', label: 'Mi cuenta', admin: false },
  ];
  window.addEventListener('hashchange', route);
  function route() {
    const hash = location.hash.replace('#', '');
    const m = hash.match(/^lead-(\d+)$/);
    if (m) { openLead(Number(m[1])); return; }
    const v = VIEWS.find((x) => x.id === hash && (!x.admin || isAdmin()));
    S.view = v ? v.id : 'tablero';
    S.selected.clear();
    render();
  }
  function go(view) { location.hash = `#${view}`; }

  function taskBadge() {
    const now = new Date(); const end = new Date(); end.setHours(23, 59, 59, 999);
    const open = pendingItems().filter((t) => new Date(t.fecha) <= end);
    return open.length;
  }

  function render() {
    if (!S.user) return;
    const empresa = empresaName();
    const sub = $('#brandSub'); sub.textContent = empresa; sub.hidden = !empresa;
    document.title = empresa ? `Zigga · ${empresa}` : 'Zigga';
    $('#meAvatar').textContent = initials(S.user.nombre); $('#meName').textContent = S.user.nombre;
    $('#meRole').textContent = `${isAdmin() ? 'Administrador' : 'Vendedor'}${bothAreas() ? '' : ` · ${areaLabel(S.user.area)}`}`;
    const badges = { tareas: taskBadge(), lista: isAdmin() ? S.sinAsignar : 0 };
    const nav = VIEWS.filter((v) => !v.admin || isAdmin());
    $('#nav').innerHTML = nav.map((v) => `<button class="navitem ${S.view === v.id ? 'on' : ''}" data-go="${v.id}">${ICONS[v.id]}<span>${v.label}</span>${badges[v.id] ? `<span class="badge ${v.id === 'lista' ? 'neutral' : ''}" title="${v.id === 'lista' ? 'Leads sin asignar' : 'Tareas vencidas o para hoy'}">${badges[v.id]}</span>` : ''}</button>`).join('');
    const mobile = nav.filter((v) => ['tablero', 'lista', 'tareas', 'metricas'].includes(v.id));
    $('#bottomnav').innerHTML = mobile.map((v) => `<button class="${S.view === v.id ? 'on' : ''}" data-go="${v.id}">${ICONS[v.id]}<span>${v.label}</span>${badges[v.id] ? `<span class="badge ${v.id === 'lista' ? 'neutral' : ''}">${badges[v.id]}</span>` : ''}</button>`).join('')
      + `<button class="${['equipo', 'importar', 'ajustes', 'cuenta'].includes(S.view) ? 'on' : ''}" data-more="1">${ICONS.ajustes}<span>Más</span></button>`;
    if (document.activeElement?.id !== 'q') renderTopbar();
    const r = { tablero: renderTablero, lista: renderLista, tareas: renderTareas, metricas: renderMetricas, equipo: renderEquipo, importar: renderImportar, ajustes: renderAjustes, cuenta: renderCuenta }[S.view];
    r();
  }
  /** Reemplaza el contenido de la vista por un nodo nuevo (así no se acumulan listeners). */
  function fresh() { const v = $('#view'); const el = document.createElement('div'); el.className = 'viewbody'; v.replaceChildren(el); return el; }
  document.addEventListener('click', (e) => {
    const go_ = e.target.closest('[data-go]'); if (go_) { go(go_.dataset.go); return; }
    if (e.target.closest('[data-more]')) moreMenu();
  });
  function moreMenu() {
    const items = VIEWS.filter((v) => ['equipo', 'importar', 'ajustes', 'cuenta'].includes(v.id) && (!v.admin || isAdmin()));
    modal(`<h2>Más</h2><div class="list">${items.map((v) => `<button class="btn" data-go="${v.id}" onclick="document.getElementById('overlay').innerHTML=''">${v.label}</button>`).join('')}</div>`);
  }

  function renderTopbar() {
    const titles = { tablero: 'Tablero', lista: 'Lista de leads', tareas: 'Tareas y recordatorios', metricas: 'Métricas', equipo: 'Equipo', importar: 'Importar leads', ajustes: 'Ajustes', cuenta: 'Mi cuenta' };
    const showArea = ['tablero', 'lista'].includes(S.view) && bothAreas();
    const showSearch = ['tablero', 'lista'].includes(S.view);
    $('#topbar').innerHTML = `
      <h1>${titles[S.view]}</h1>
      ${showArea ? `<div class="seg" id="areaSeg"><button class="${S.area === 'FTD' ? 'on' : ''}" data-area="FTD">FTD</button><button class="${S.area === 'RET' ? 'on ret' : ''}" data-area="RET">Retención</button></div>` : ''}
      ${showSearch ? `<div class="search">${ICONS.search}<input class="input" id="q" placeholder="Buscar nombre, WhatsApp, correo…" value="${h(S.q)}"></div>` : ''}
      ${['tablero', 'lista', 'tareas'].includes(S.view) ? `<button class="btn primary" id="newLeadBtn">+ Nuevo lead</button>` : ''}`;
    $('#areaSeg')?.addEventListener('click', (e) => { const b = e.target.closest('[data-area]'); if (!b) return; S.area = b.dataset.area; render(); });
    $('#q')?.addEventListener('input', debounce((e) => { S.q = e.target.value; renderBody(); }, 150));
    $('#newLeadBtn')?.addEventListener('click', () => newLeadModal());
  }
  function renderBody() { const r = { tablero: renderTablero, lista: renderLista }[S.view]; if (r) r(); }

  function matchesQ(l) {
    if (!S.q) return true;
    const q = S.q.toLowerCase();
    return [l.nombre, l.whatsapp, l.correo, l.ciudad, countryName(l.pais), l.ad_name, l.campaign_name].some((v) => v && String(v).toLowerCase().includes(q));
  }

  // ---------- tablero ----------
  function renderTablero() {
    const area = S.area;
    const st = stages(area);
    let leads = S.leads.filter((l) => l.area === area && matchesQ(l));
    if (S.boardFilter.responsable === 'none') leads = leads.filter((l) => l.responsable_id == null);
    else if (S.boardFilter.responsable) leads = leads.filter((l) => l.responsable_id === Number(S.boardFilter.responsable));
    const sellers = usersForArea(area);
    const filters = isAdmin() ? `<div class="filters">
        <select class="input" id="boardResp"><option value="">Todos los responsables</option><option value="none" ${S.boardFilter.responsable === 'none' ? 'selected' : ''}>Sin asignar (${S.leads.filter((l) => l.area === area && l.responsable_id == null).length})</option>
        ${sellers.map((u) => `<option value="${u.id}" ${String(S.boardFilter.responsable) === String(u.id) ? 'selected' : ''}>${h(u.nombre)}</option>`).join('')}</select>
        <span class="muted small">${leads.length} lead${leads.length === 1 ? '' : 's'} en ${areaLabel(area)}</span></div>` : `<div class="filters"><span class="muted small">${leads.length} lead${leads.length === 1 ? '' : 's'} en ${areaLabel(area)}</span></div>`;
    const cols = st.map((s) => {
      const items = leads.filter((l) => l.etapa === s.id);
      const sum = items.reduce((a, l) => a + (Number(l.monto) || 0), 0);
      return `<div class="col" data-stage="${s.id}">
        <div class="col-head ${s.tipo}"><h3>${h(s.nombre)}</h3><span class="chip count">${items.length}</span>${sum ? `<span class="sum muted num">${money(sum)}</span>` : ''}</div>
        <div class="col-body">${items.map(card).join('') || '<div class="empty small">Sin leads</div>'}</div></div>`;
    }).join('');
    fresh().innerHTML = `${filters}<div class="board" id="board">${cols}</div>`;
    $('#boardResp')?.addEventListener('change', (e) => { S.boardFilter.responsable = e.target.value; renderTablero(); });
    wireBoard();
  }
  function card(l) {
    const r = userById(l.responsable_id);
    const due = l.proxima_fecha ? `<span class="due ${dueClass(l.proxima_fecha)}" title="${h(l.proxima_accion || 'Próxima acción')}">⏰ ${fmtDT(l.proxima_fecha)}</span>` : '';
    return `<div class="card" draggable="true" data-id="${l.id}">
      <div class="top"><span class="name">${h(l.nombre)}</span>${l.monto != null ? `<span class="num small"><b>${money(l.monto)}</b></span>` : ''}</div>
      <div class="small muted">${flag(l.pais)} ${h([countryName(l.pais), l.ciudad].filter(Boolean).join(' · ')) || '<span class="faint">Sin ubicación</span>'}</div>
      <div class="bottom">${r ? `<span class="avatar" title="${h(r.nombre)}">${initials(r.nombre)}</span>` : '<span class="avatar none" title="Sin asignar">—</span>'}${due}<span class="faint small">${ago(l.lead_creado_en || l.creado_en)}</span></div>
      ${l.ad_name || l.origen_tipo === 'manual' ? `<div class="src">${h(l.ad_name ? `${l.ad_name}` : 'Creado manualmente')}</div>` : ''}
    </div>`;
  }
  function wireBoard() {
    const board = $('#board'); if (!board) return;
    board.addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openLead(Number(c.dataset.id)); });
    let dragId = null;
    board.addEventListener('dragstart', (e) => { const c = e.target.closest('.card'); if (!c) return; dragId = Number(c.dataset.id); c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); });
    board.addEventListener('dragend', (e) => { e.target.closest?.('.card')?.classList.remove('dragging'); $$('.col.over', board).forEach((c) => c.classList.remove('over')); });
    board.addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (!col) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; $$('.col.over', board).forEach((c) => c !== col && c.classList.remove('over')); col.classList.add('over'); });
    board.addEventListener('dragleave', (e) => { const col = e.target.closest('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
    board.addEventListener('drop', async (e) => {
      const col = e.target.closest('.col'); if (!col) return; e.preventDefault(); col.classList.remove('over');
      const id = Number(e.dataTransfer.getData('text/plain')) || dragId; const lead = S.leads.find((l) => l.id === id);
      if (!lead || lead.etapa === col.dataset.stage) return;
      await changeStage(lead, col.dataset.stage);
    });
  }
  async function changeStage(lead, etapa) {
    const target = stages(lead.area).find((s) => s.id === etapa);
    if (target?.tipo === 'perdida') { lostModal(lead, etapa); return; }
    try { const d = await api('PATCH', `/api/leads/${lead.id}`, { etapa }); replaceLead(d.lead); toast(`${lead.nombre} → ${target?.nombre || etapa}`); }
    catch (e) { fail(e); }
  }
  function lostModal(lead, etapa) {
    const motivos = S.config.motivos_perdida || [];
    modal(`<h2>Marcar como perdido</h2><p class="muted">${h(lead.nombre)} saldrá del embudo. ¿Por qué se perdió?</p>
      <label class="field">Motivo<select class="input" id="motivo">${motivos.map((m) => `<option>${h(m)}</option>`).join('')}</select></label>
      <label class="field">Nota (opcional)<textarea class="input" id="motivoNota" rows="2"></textarea></label>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn danger" id="lostOk">Marcar perdido</button></div>`);
    $('#lostOk').onclick = async () => {
      try {
        const d = await api('PATCH', `/api/leads/${lead.id}`, { etapa, motivo_perdida: $('#motivo').value });
        const nota = $('#motivoNota').value.trim(); if (nota) await api('POST', `/api/leads/${lead.id}/notas`, { texto: nota });
        replaceLead(d.lead); closeModal(); toast('Lead marcado como perdido');
      } catch (e) { fail(e); }
    };
  }
  function replaceLead(lead) {
    const i = S.leads.findIndex((l) => l.id === lead.id);
    if (i >= 0) S.leads[i] = lead; else S.leads.unshift(lead);
    S.sinAsignar = S.leads.filter((l) => l.responsable_id == null).length;
    render(); if (S.openLeadId === lead.id) refreshDrawer();
  }

  // ---------- lista ----------
  function renderLista() {
    const f = S.listFilters; const area = S.area;
    let leads = S.leads.filter((l) => l.area === area && matchesQ(l));
    if (f.etapa) leads = leads.filter((l) => l.etapa === f.etapa);
    if (f.responsable === 'none') leads = leads.filter((l) => l.responsable_id == null); else if (f.responsable) leads = leads.filter((l) => l.responsable_id === Number(f.responsable));
    if (f.origen) leads = leads.filter((l) => (f.origen === 'meta' ? l.origen_tipo !== 'manual' : l.origen_tipo === 'manual'));
    const key = { creado: (l) => l.lead_creado_en || l.creado_en, nombre: (l) => l.nombre.toLowerCase(), etapa: (l) => stages(l.area).findIndex((s) => s.id === l.etapa), monto: (l) => Number(l.monto) || 0, proxima: (l) => l.proxima_fecha || '9999', responsable: (l) => uname(l.responsable_id), pais: (l) => countryName(l.pais) }[f.sort] || ((l) => l.creado_en);
    leads.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * (f.dir === 'asc' ? 1 : -1); });
    const th = (id, label) => `<th data-sort="${id}" class="${f.sort === id ? 'on' : ''}">${label} ${f.sort === id ? (f.dir === 'asc' ? '↑' : '↓') : ''}</th>`;
    const selectable = isAdmin();
    const sel = S.selected;
    const V = fresh();
    V.innerHTML = `
      <div class="filters">
        <select class="input" id="fEtapa"><option value="">Todas las etapas</option>${stages(area).map((s) => `<option value="${s.id}" ${f.etapa === s.id ? 'selected' : ''}>${h(s.nombre)}</option>`).join('')}</select>
        ${isAdmin() ? `<select class="input" id="fResp"><option value="">Todos los responsables</option><option value="none" ${f.responsable === 'none' ? 'selected' : ''}>Sin asignar</option>${S.users.map((u) => `<option value="${u.id}" ${String(f.responsable) === String(u.id) ? 'selected' : ''}>${h(u.nombre)}</option>`).join('')}</select>` : ''}
        <select class="input" id="fOrigen"><option value="">Todos los orígenes</option><option value="meta" ${f.origen === 'meta' ? 'selected' : ''}>Meta</option><option value="manual" ${f.origen === 'manual' ? 'selected' : ''}>Manual</option></select>
        <span class="muted small">${leads.length} lead${leads.length === 1 ? '' : 's'}</span>
        ${isAdmin() ? `<a class="btn sm" href="/api/export.csv" style="margin-left:auto">Exportar CSV</a>` : ''}
      </div>
      ${sel.size ? `<div class="bulkbar"><b>${sel.size} seleccionado${sel.size === 1 ? '' : 's'}</b>
        <select class="input" id="bulkResp" style="width:auto"><option value="">Asignar a…</option><option value="none">Sin asignar</option>${usersForArea(area).map((u) => `<option value="${u.id}">${h(u.nombre)}</option>`).join('')}</select>
        <button class="btn sm" id="bulkClear">Quitar selección</button></div>` : ''}
      <div class="tablewrap"><table>
        <thead><tr>${selectable ? `<th style="width:34px"><input type="checkbox" id="selAll" ${leads.length && leads.every((l) => sel.has(l.id)) ? 'checked' : ''}></th>` : ''}
          ${th('nombre', 'Nombre')}<th>Contacto</th>${th('pais', 'País')}${th('etapa', 'Etapa')}${th('responsable', 'Responsable')}${th('monto', 'Monto')}${th('proxima', 'Próxima acción')}<th>Origen</th>${th('creado', 'Creado')}</tr></thead>
        <tbody>${leads.map((l) => `<tr class="row" data-id="${l.id}">
          ${selectable ? `<td><input type="checkbox" class="selOne" data-id="${l.id}" ${sel.has(l.id) ? 'checked' : ''}></td>` : ''}
          <td class="name">${h(l.nombre)}${l.ciudad ? `<div class="sub">${h(l.ciudad)}</div>` : ''}</td>
          <td><div class="num small">${h(l.whatsapp || '')}</div><div class="sub">${h(l.correo || '')}</div></td>
          <td>${flag(l.pais)} ${h(countryName(l.pais))}</td>
          <td><span class="chip ${stage(l).tipo === 'ganada' ? 'good' : stage(l).tipo === 'perdida' ? 'bad' : stage(l).tipo === 'calificado' ? 'accent' : ''}">${h(stage(l).nombre)}</span></td>
          <td>${l.responsable_id ? `<span class="avatar">${initials(uname(l.responsable_id))}</span> ${h(uname(l.responsable_id))}` : '<span class="faint">Sin asignar</span>'}</td>
          <td class="num">${money(l.monto)}</td>
          <td>${l.proxima_fecha ? `<span class="due ${dueClass(l.proxima_fecha)}">${fmtDT(l.proxima_fecha)}</span><div class="sub">${h(l.proxima_accion || '')}</div>` : '<span class="faint">—</span>'}</td>
          <td><div class="small">${origenLabel(l)}</div>${l.ad_name ? `<div class="sub">${h(l.ad_name)}</div>` : ''}</td>
          <td class="small muted" title="${h(fmtDT(l.lead_creado_en || l.creado_en))}">${ago(l.lead_creado_en || l.creado_en)}</td></tr>`).join('') || `<tr><td colspan="10" class="empty" style="border:0">No hay leads con estos filtros.</td></tr>`}
        </tbody></table></div>`;
    $('#fEtapa').onchange = (e) => { f.etapa = e.target.value; renderLista(); };
    $('#fResp') && ($('#fResp').onchange = (e) => { f.responsable = e.target.value; renderLista(); });
    $('#fOrigen').onchange = (e) => { f.origen = e.target.value; renderLista(); };
    $$('th[data-sort]').forEach((t) => t.onclick = () => { if (f.sort === t.dataset.sort) f.dir = f.dir === 'asc' ? 'desc' : 'asc'; else { f.sort = t.dataset.sort; f.dir = t.dataset.sort === 'nombre' ? 'asc' : 'desc'; } renderLista(); });
    $('tbody', V).addEventListener('click', (e) => {
      if (e.target.classList.contains('selOne')) { const id = Number(e.target.dataset.id); e.target.checked ? sel.add(id) : sel.delete(id); renderLista(); return; }
      const row = e.target.closest('tr.row'); if (row) openLead(Number(row.dataset.id));
    });
    $('#selAll')?.addEventListener('change', (e) => { leads.forEach((l) => e.target.checked ? sel.add(l.id) : sel.delete(l.id)); renderLista(); });
    $('#bulkClear')?.addEventListener('click', () => { sel.clear(); renderLista(); });
    $('#bulkResp')?.addEventListener('change', async (e) => {
      const v = e.target.value; if (!v) return;
      try { const r = await api('POST', '/api/leads/assign', { ids: [...sel], responsable_id: v === 'none' ? null : Number(v) }); toast(r.aviso || `${r.actualizados} lead(s) asignado(s)`, r.aviso ? 'bad' : ''); sel.clear(); await load(); }
      catch (err) { fail(err); }
    });
  }

  // ---------- tareas ----------
  function pendingItems() {
    const items = S.tasks.filter((t) => !t.hecho).map((t) => ({ kind: 'task', id: t.id, fecha: t.fecha, titulo: t.titulo, lead: S.leads.find((l) => l.id === t.lead_id), asignado: t.asignado_id }));
    for (const l of S.leads) {
      if (!l.proxima_fecha || stage(l).tipo === 'perdida') continue;
      if (!isAdmin() && l.responsable_id !== S.user.id) continue;
      items.push({ kind: 'lead', id: l.id, fecha: l.proxima_fecha, titulo: l.proxima_accion || 'Próxima acción', lead: l, asignado: l.responsable_id });
    }
    return items.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  function renderTareas() {
    const items = pendingItems();
    const now = new Date(); const endToday = new Date(); endToday.setHours(23, 59, 59, 999); const week = new Date(endToday.getTime() + 7 * 86400000);
    const groups = [
      { k: 'late', t: 'Vencidas', items: items.filter((i) => new Date(i.fecha) < now && new Date(i.fecha).toDateString() !== now.toDateString()) },
      { k: 'today', t: 'Hoy', items: items.filter((i) => new Date(i.fecha).toDateString() === now.toDateString()) },
      { k: '', t: 'Próximos 7 días', items: items.filter((i) => new Date(i.fecha) > endToday && new Date(i.fecha) <= week) },
      { k: '', t: 'Más adelante', items: items.filter((i) => new Date(i.fecha) > week) },
    ];
    const done = S.tasks.filter((t) => t.hecho).sort((a, b) => (b.hecho_en || '').localeCompare(a.hecho_en || '')).slice(0, 20);
    const item = (i) => `<div class="item">
      <label class="check" style="margin-top:2px"><input type="checkbox" data-kind="${i.kind}" data-id="${i.id}"></label>
      <div class="body"><div class="t">${h(i.titulo)}</div>
        <div class="m"><span class="due ${dueClass(i.fecha)}">${fmtDT(i.fecha)}</span>${i.lead ? ` · <a href="#lead-${i.lead.id}">${h(i.lead.nombre)}</a>` : ''}${isAdmin() && i.asignado ? ` · ${h(uname(i.asignado))}` : ''}${i.kind === 'lead' ? ' · próxima acción del lead' : ''}</div></div>
      ${i.kind === 'task' ? `<button class="btn ghost icon" data-del="${i.id}" title="Borrar">${ICONS.close}</button>` : ''}</div>`;
    const V = fresh();
    V.innerHTML = `
      <div class="filters"><button class="btn primary" id="newTaskBtn">+ Nueva tarea</button><span class="muted small">${items.length} pendiente${items.length === 1 ? '' : 's'}</span></div>
      ${groups.map((g) => g.items.length ? `<div class="group-title ${g.k}"><h2>${g.t}</h2><span class="chip">${g.items.length}</span></div><div class="list">${g.items.map(item).join('')}</div>` : '').join('') || '<div class="empty">No tienes tareas pendientes. Crea una o define la próxima acción de un lead.</div>'}
      ${done.length ? `<details style="margin-top:18px"><summary class="muted" style="cursor:pointer">Completadas recientes (${done.length})</summary><div class="list" style="margin-top:8px">${done.map((t) => `<div class="item"><label class="check" style="margin-top:2px"><input type="checkbox" checked data-kind="task" data-id="${t.id}"></label><div class="body"><div class="t" style="text-decoration:line-through;color:var(--fg-3)">${h(t.titulo)}</div><div class="m">${fmtDT(t.hecho_en)}${t.lead_id ? ` · <a href="#lead-${t.lead_id}">${h(S.leads.find((l) => l.id === t.lead_id)?.nombre || 'Lead')}</a>` : ''}</div></div></div>`).join('')}</div></details>` : ''}`;
    $('#newTaskBtn').onclick = () => taskModal();
    V.addEventListener('change', async (e) => {
      const cb = e.target; if (cb.type !== 'checkbox') return;
      try {
        if (cb.dataset.kind === 'task') await api('PATCH', `/api/tasks/${cb.dataset.id}`, { hecho: cb.checked });
        else await api('PATCH', `/api/leads/${cb.dataset.id}`, { proxima_accion: null, proxima_fecha: null });
        toast(cb.checked ? 'Listo ✓' : 'Tarea reabierta'); await load();
      } catch (err) { fail(err); }
    });
    V.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      try { await api('DELETE', `/api/tasks/${d.dataset.del}`); await load(); } catch (err) { fail(err); }
    });
  }
  function taskModal(lead) {
    const def = new Date(Date.now() + 3600000); def.setMinutes(0, 0, 0);
    modal(`<h2>Nueva tarea</h2>
      <label class="field">Qué hay que hacer<input class="input" id="tTitulo" placeholder="Llamar, enviar propuesta, confirmar pago…" autofocus></label>
      <div class="field-grid"><label class="field">Cuándo<input class="input" id="tFecha" type="datetime-local" value="${toLocalInput(def.toISOString())}"></label>
      ${!lead ? `<label class="field">Lead (opcional)<select class="input" id="tLead"><option value="">Sin lead</option>${S.leads.slice(0, 500).map((l) => `<option value="${l.id}">${h(l.nombre)}</option>`).join('')}</select></label>` : ''}
      ${isAdmin() ? `<label class="field">Para quién<select class="input" id="tAsig">${S.users.filter((u) => u.activo).map((u) => `<option value="${u.id}" ${u.id === (lead?.responsable_id || S.user.id) ? 'selected' : ''}>${h(u.nombre)}</option>`).join('')}</select></label>` : ''}</div>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="tOk">Crear tarea</button></div>`);
    $('#tOk').onclick = async () => {
      try {
        await api('POST', '/api/tasks', { titulo: $('#tTitulo').value, fecha: fromLocalInput($('#tFecha').value), lead_id: lead ? lead.id : ($('#tLead')?.value || null), asignado_id: $('#tAsig')?.value || null });
        closeModal(); toast('Tarea creada'); await load();
      } catch (e) { fail(e); }
    };
  }

  // ---------- métricas ----------
  function renderMetricas() {
    const f = S.metricFilters;
    const since = f.periodo === 'todo' ? null : new Date(Date.now() - Number(f.periodo) * 86400000).toISOString();
    // FTD cuenta también los leads que ya pasaron a Retención (cerraron en FTD antes).
    let base = S.leads.filter((l) => (f.area === 'AMBAS' ? true : f.area === 'FTD' ? (l.area === 'FTD' || !!l.retencion_en) : l.area === 'RET'));
    if (f.responsable) base = base.filter((l) => l.responsable_id === Number(f.responsable));
    const inPeriod = base.filter((l) => !since || (l.lead_creado_en || l.creado_en) >= since);
    const cal = inPeriod.filter((l) => l.calificado_en).length, cli = inPeriod.filter((l) => l.cliente_en).length, per = inPeriod.filter((l) => l.perdido_en).length;
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    const montoCli = inPeriod.filter((l) => l.cliente_en).reduce((a, l) => a + (Number(l.monto) || 0), 0);
    const pipeline = base.filter((l) => !['ganada', 'perdida'].includes(stage(l).tipo)).reduce((a, l) => a + (Number(l.monto) || 0), 0);
    const group = (list, keyFn) => { const m = new Map(); for (const l of list) { const k = keyFn(l) || '—'; const g = m.get(k) || { k, n: 0, cal: 0, cli: 0, monto: 0 }; g.n++; if (l.calificado_en) g.cal++; if (l.cliente_en) { g.cli++; g.monto += Number(l.monto) || 0; } m.set(k, g); } return [...m.values()].sort((a, b) => b.n - a.n); };
    const bars = (rows, cls = '') => { const max = Math.max(1, ...rows.map((r) => r.n)); return `<div class="bars">${rows.slice(0, 12).map((r) => `<div class="bar ${cls}" title="${h(r.k)}: ${r.n} leads · ${r.cal} calificados · ${r.cli} clientes"><span class="lbl">${h(r.k)}</span><div class="track"><div class="fill" style="width:${(r.n / max) * 100}%"></div></div><span class="num small">${r.n}</span></div>`).join('') || '<div class="faint small">Sin datos</div>'}</div>`; };
    const table = (rows) => `<div class="tablewrap mini"><table><thead><tr><th></th><th>Leads</th><th>Calif.</th><th>Clientes</th><th>Tasa cierre</th><th>Monto</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${h(r.k)}</td><td class="num">${r.n}</td><td class="num">${r.cal}</td><td class="num">${r.cli}</td><td class="num">${pct(r.cli, r.n)}</td><td class="num">${money(r.monto)}</td></tr>`).join('') || '<tr><td colspan="6" class="faint">Sin datos</td></tr>'}</tbody></table></div>`;
    const areaForStages = f.area === 'AMBAS' ? 'FTD' : f.area;
    const stageRows = stages(areaForStages).map((s) => ({ k: s.nombre, n: inPeriod.filter((l) => l.area === areaForStages && l.etapa === s.id).length, cal: 0, cli: 0 }));
    const canFilterArea = bothAreas();
    fresh().innerHTML = `
      <div class="filters">
        <div class="seg" id="mPer">${[['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['todo', 'Todo']].map(([v, t]) => `<button class="${f.periodo === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>
        ${canFilterArea ? `<div class="seg" id="mArea"><button class="${f.area === 'FTD' ? 'on' : ''}" data-v="FTD">FTD</button><button class="${f.area === 'RET' ? 'on ret' : ''}" data-v="RET">Retención</button><button class="${f.area === 'AMBAS' ? 'on' : ''}" data-v="AMBAS">Ambas</button></div>` : ''}
        ${isAdmin() ? `<select class="input" id="mResp"><option value="">Todos los vendedores</option>${S.users.map((u) => `<option value="${u.id}" ${String(f.responsable) === String(u.id) ? 'selected' : ''}>${h(u.nombre)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="stack">
        <div class="tiles">
          <div class="tile"><span class="s">Leads nuevos</span><span class="v num">${inPeriod.length}</span><span class="s faint">${f.periodo === 'todo' ? 'histórico' : `últimos ${f.periodo} días`}</span></div>
          <div class="tile"><span class="s">Calificados</span><span class="v num">${cal}</span><span class="s faint">${pct(cal, inPeriod.length)} de los leads</span></div>
          <div class="tile"><span class="s">Clientes</span><span class="v num">${cli}</span><span class="s faint">${pct(cli, inPeriod.length)} de cierre</span></div>
          <div class="tile"><span class="s">Perdidos</span><span class="v num">${per}</span><span class="s faint">${pct(per, inPeriod.length)}</span></div>
          <div class="tile"><span class="s">Monto cerrado</span><span class="v num">${money(montoCli)}</span><span class="s faint">clientes del período</span></div>
          <div class="tile"><span class="s">En embudo</span><span class="v num">${money(pipeline)}</span><span class="s faint">monto de leads abiertos</span></div>
        </div>
        <div class="two">
          <div class="panel"><h2>Por etapa (${areaLabel(areaForStages)})</h2>${bars(stageRows, areaForStages === 'RET' ? 'ret' : '')}</div>
          <div class="panel"><h2>Por anuncio</h2>${bars(group(inPeriod, (l) => l.ad_name || (l.origen_tipo === 'manual' ? 'Manual' : 'Sin anuncio')))}</div>
          <div class="panel"><h2>Por campaña</h2>${bars(group(inPeriod, (l) => l.campaign_name || (l.origen_tipo === 'manual' ? 'Manual' : 'Sin campaña')))}</div>
          <div class="panel"><h2>Por país</h2>${bars(group(inPeriod, (l) => countryName(l.pais) || 'Sin país'))}</div>
        </div>
        ${isAdmin() ? `<div class="panel"><h2>Por vendedor</h2>${table(group(inPeriod, (l) => uname(l.responsable_id)))}</div>` : ''}
        <div class="panel"><h2>Por anuncio · detalle</h2>${table(group(inPeriod, (l) => l.ad_name || (l.origen_tipo === 'manual' ? 'Manual' : 'Sin anuncio')))}</div>
      </div>`;
    $('#mPer').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { f.periodo = b.dataset.v; renderMetricas(); } };
    $('#mArea') && ($('#mArea').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { f.area = b.dataset.v; renderMetricas(); } });
    $('#mResp') && ($('#mResp').onchange = (e) => { f.responsable = e.target.value; renderMetricas(); });
  }

  // ---------- equipo ----------
  function renderEquipo() {
    const count = (id) => S.leads.filter((l) => l.responsable_id === id).length;
    const V = fresh();
    V.innerHTML = `
      <div class="filters"><button class="btn primary" id="newUserBtn">+ Nuevo usuario</button>
        <span class="muted small">Comparte la dirección de este CRM con cada vendedor junto con su usuario y contraseña. Al entrar por primera vez deberá cambiarla.</span></div>
      <div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Acceso</th><th>Leads</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead>
      <tbody>${S.users.map((u) => `<tr><td class="name"><span class="avatar">${initials(u.nombre)}</span> ${h(u.nombre)}</td><td class="num small">${h(u.username)}</td>
        <td>${u.role === 'admin' ? '<span class="chip accent">Administrador</span>' : 'Vendedor'}</td><td>${userAreas(u).map((a) => `<span class="chip ${a === 'RET' ? 'ret' : ''}">${a === 'RET' ? 'Retención' : 'FTD'}</span>`).join(' ')}</td>
        <td class="num">${count(u.id)}</td><td class="small muted">${u.ultimo_acceso ? ago(u.ultimo_acceso) : 'Nunca'}</td>
        <td>${u.activo ? '<span class="chip good">Activo</span>' : '<span class="chip bad">Inactivo</span>'}</td>
        <td><button class="btn sm" data-edit="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#newUserBtn').onclick = () => userModal();
    V.addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (b) userModal(userById(Number(b.dataset.edit))); });
  }
  function userModal(u) {
    const isMe = u && u.id === S.user.id;
    modal(`<h2>${u ? 'Editar usuario' : 'Nuevo usuario'}</h2>
      <div class="field-grid">
        <label class="field">Nombre<input class="input" id="uNombre" value="${h(u?.nombre || '')}"></label>
        <label class="field">Usuario (para entrar)<input class="input" id="uUser" value="${h(u?.username || '')}" ${u ? 'disabled' : ''} autocapitalize="off" placeholder="ej. laura"></label>
        <label class="field">${u ? 'Nueva contraseña (opcional)' : 'Contraseña'}<input class="input" id="uPass" type="text" autocomplete="off" placeholder="mínimo 8 caracteres"></label>
        <label class="field">Rol<select class="input" id="uRole" ${isMe ? 'disabled' : ''}><option value="vendedor" ${u?.role === 'vendedor' ? 'selected' : ''}>Vendedor</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
        <div class="field" style="display:grid;gap:6px"><span>Acceso a áreas</span>
          <label class="check"><input type="checkbox" id="uFTD" ${!u || userHasArea(u, 'FTD') ? 'checked' : ''} ${isMe ? 'disabled' : ''}> FTD</label>
          <label class="check"><input type="checkbox" id="uRET" ${u && userHasArea(u, 'RET') ? 'checked' : ''} ${isMe ? 'disabled' : ''}> Retención</label></div>
        ${u && !isMe ? `<label class="check" style="align-self:end;padding-bottom:8px"><input type="checkbox" id="uActivo" ${u.activo ? 'checked' : ''}> Usuario activo</label>` : ''}
      </div>
      <p class="small muted">Cada persona solo entra a las áreas que marques: quien tiene solo FTD no ve el tablero, los leads ni las métricas de Retención. Un vendedor además solo ve los leads que le asignes; un administrador ve todos los de sus áreas, asigna y administra el equipo.</p>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="uOk">${u ? 'Guardar' : 'Crear usuario'}</button></div>`);
    $('#uOk').onclick = async () => {
      try {
        const ftd = $('#uFTD').checked, ret = $('#uRET').checked;
        if (!isMe && !ftd && !ret) throw new Error('Marca al menos un área.');
        const body = { nombre: $('#uNombre').value, role: $('#uRole').value, area: isMe ? u.area : (ftd && ret ? 'AMBAS' : ret ? 'RET' : 'FTD') };
        if ($('#uPass').value) body.password = $('#uPass').value;
        if (u) { if (!isMe) body.activo = $('#uActivo').checked; await api('PATCH', `/api/users/${u.id}`, body); }
        else { body.username = $('#uUser').value; body.password = $('#uPass').value; await api('POST', '/api/users', body); }
        closeModal(); toast(u ? 'Usuario actualizado' : 'Usuario creado'); await load();
      } catch (e) { fail(e); }
    };
  }

  // ---------- importar ----------
  function renderImportar() {
    const m = S.meta || {}; const cfg = m.config || {}; const last = m.ultimo;
    fresh().innerHTML = `<div class="two">
      <div class="panel">
        <h2>Importar archivo de Meta</h2>
        <p class="muted small" style="margin:0">Descarga los leads desde el Centro de clientes potenciales o el formulario (archivo .xls, .csv o .xlsx) y súbelo aquí. Los leads repetidos se omiten automáticamente.</p>
        <div class="dropzone" id="drop">Arrastra el archivo aquí o <b>haz clic para elegirlo</b><input type="file" id="file" accept=".xls,.xlsx,.csv,.txt" hidden></div>
        <div id="importPreview"></div>
      </div>
      <div class="stack">
        <div class="panel">
          <h2>Sincronización automática con Meta</h2>
          ${cfg.enabled ? `<div><span class="chip good">Activa</span> <span class="small muted">cada ${cfg.minutes} min · ${cfg.forms.length} formulario(s): ${cfg.forms.map((f) => `<code>${h(f)}</code>`).join(' ')}</span></div>` : `<div><span class="chip warn">Desactivada</span></div>
            <p class="small muted" style="margin:0">Para que los leads lleguen solos, define en el servidor las variables <code>META_ACCESS_TOKEN</code> (token de usuario del sistema con permiso <code>leads_retrieval</code>) y <code>META_FORM_IDS</code> (IDs de formulario separados por coma). Opcional: <code>META_POLL_MINUTES</code> (por defecto 5).</p>`}
          ${last ? `<div class="small muted">Última revisión: ${fmtDT(last.ultimo)} (${last.trigger === 'manual' ? 'manual' : 'automática'}) · ${last.nuevos} nuevo(s)${last.error ? `<div style="color:var(--bad)">${h(last.error)}</div>` : ''}</div>` : ''}
          <div><button class="btn" id="syncBtn" ${cfg.enabled ? '' : 'disabled'}>Sincronizar ahora</button></div>
        </div>
        <div class="panel">
          <h2>Webhook para n8n u otras herramientas</h2>
          <p class="small muted" style="margin:0">Envía un <code>POST</code> con JSON a:</p>
          <pre class="code">${h(location.origin)}/api/webhooks/leads?key=TU_CLAVE</pre>
          <p class="small muted" style="margin:0">La clave es la variable <code>WEBHOOK_KEY</code> del servidor ${S.webhook ? '<span class="chip good">configurada</span>' : '<span class="chip warn">sin configurar</span>'}. Acepta el lead tal como lo entrega Meta (con <code>field_data</code>) o un objeto simple: <code>{"nombre","correo","whatsapp","pais","ciudad","respuestas":{}}</code>.</p>
        </div>
        <div class="panel"><h2>Exportar</h2><div><a class="btn" href="/api/export.csv">Descargar todos los leads (CSV)</a></div></div>
      </div></div>`;
    const drop = $('#drop'), file = $('#file');
    drop.onclick = () => file.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]); };
    file.onchange = () => file.files[0] && parseFile(file.files[0]);
    $('#syncBtn').onclick = async () => { $('#syncBtn').disabled = true; try { const r = await api('POST', '/api/meta/sync'); toast(r.error ? r.error : `${r.nuevos} lead(s) nuevo(s)`, r.error ? 'bad' : 'good'); await load(); } catch (e) { fail(e); $('#syncBtn').disabled = false; } };
  }
  async function parseFile(f) {
    const box = $('#importPreview'); box.innerHTML = '<p class="muted small">Leyendo archivo…</p>';
    try {
      if (!window.XLSX) throw new Error('No se pudo cargar el lector de archivos. Recarga la página.');
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', raw: true, cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }).map((r) => {
        const o = {}; for (const [k, v] of Object.entries(r)) { const key = String(k).trim(); if (!key) continue; o[key] = typeof v === 'number' ? (Number.isInteger(v) ? BigInt(v).toString() : String(v)) : v instanceof Date ? v.toISOString() : String(v); } return o;
      }).filter((r) => Object.values(r).some((v) => v !== ''));
      const cols = Object.keys(rows[0] || {});
      if (!rows.length || !cols.includes('id')) throw new Error('No parece un export de Meta: falta la columna "id". Columnas encontradas: ' + (cols.join(', ') || 'ninguna'));
      const known = new Set(S.leads.map((l) => l.meta_lead_id)); const nuevos = rows.filter((r) => !known.has(String(r.id))).length;
      box.innerHTML = `<div class="stack" style="gap:8px"><div><b>${f.name}</b> · ${rows.length} fila(s) · ${nuevos} nueva(s) · ${rows.length - nuevos} ya en el CRM</div>
        <div class="small muted">Columnas: ${cols.map((c) => `<code>${h(c)}</code>`).join(' ')}</div>
        <div><button class="btn primary" id="doImport" ${nuevos ? '' : 'disabled'}>Importar ${nuevos} lead(s)</button></div></div>`;
      $('#doImport').onclick = async () => { $('#doImport').disabled = true; try { const r = await api('POST', '/api/import', { rows }); toast(`${r.nuevos} importado(s), ${r.repetidos} repetido(s)`, 'good'); await load(); go('lista'); } catch (e) { fail(e); $('#doImport').disabled = false; } };
    } catch (e) { box.innerHTML = `<p style="color:var(--bad)">${h(e.message)}</p>`; }
  }

  // ---------- ajustes ----------
  function renderAjustes() {
    const c = S.config;
    const stageEditor = (area) => `<div class="stack" style="gap:6px" id="st_${area}">${c.etapas[area].map((s, i) => `<div class="stage-row" data-i="${i}">
        <input class="input" value="${h(s.nombre)}" data-f="nombre"><select class="input" data-f="tipo"><option value="abierta" ${s.tipo === 'abierta' ? 'selected' : ''}>Abierta</option><option value="calificado" ${s.tipo === 'calificado' ? 'selected' : ''}>Calificado</option><option value="ganada" ${s.tipo === 'ganada' ? 'selected' : ''}>Ganada</option><option value="perdida" ${s.tipo === 'perdida' ? 'selected' : ''}>Perdida</option></select>
        <div class="ops"><button class="btn ghost icon" data-up title="Subir">↑</button><button class="btn ghost icon" data-down title="Bajar">↓</button><button class="btn ghost icon" data-rm title="Quitar">${ICONS.close}</button></div></div>`).join('')}
      <div><button class="btn sm" data-add="${area}">+ Agregar etapa</button></div></div>`;
    const V = fresh();
    V.innerHTML = `<div class="stack" style="max-width:900px">
      <div class="panel"><h2>Empresa</h2><div class="field-grid"><label class="field">Nombre de la empresa (se muestra bajo la marca Zigga y en la pantalla de entrada)<input class="input" id="sEmpresa" value="${h(empresaName(c))}" placeholder="Ej. Ventas Capital"></label><label class="field">Moneda<input class="input" id="sMoneda" value="${h(c.moneda)}" maxlength="3"></label></div></div>
      <div class="two"><div class="panel"><h2>Etapas FTD</h2><p class="small muted" style="margin:0">Marca una etapa como <b>Calificado</b> para medir la tasa de calificación, una como <b>Ganada</b> (cliente) y una como <b>Perdida</b>.</p>${stageEditor('FTD')}</div>
      <div class="panel"><h2>Etapas Retención</h2><p class="small muted" style="margin:0">Cuando un lead llega a Cliente en FTD, pásalo a Retención desde su ficha.</p>${stageEditor('RET')}</div></div>
      <div class="panel"><h2>Motivos de pérdida</h2><textarea class="input" id="sMotivos" rows="4">${h((c.motivos_perdida || []).join('\n'))}</textarea><span class="small muted">Uno por línea.</span></div>
      <div class="actions"><button class="btn primary" id="saveSettings">Guardar ajustes</button></div></div>`;
    V.addEventListener('click', (e) => {
      const row = e.target.closest('.stage-row'); const add = e.target.closest('[data-add]');
      if (add) { const list = $(`#st_${add.dataset.add}`); const div = document.createElement('div'); div.className = 'stage-row'; div.innerHTML = `<input class="input" value="" data-f="nombre" placeholder="Nombre de la etapa"><select class="input" data-f="tipo"><option value="abierta">Abierta</option><option value="calificado">Calificado</option><option value="ganada">Ganada</option><option value="perdida">Perdida</option></select><div class="ops"><button class="btn ghost icon" data-up>↑</button><button class="btn ghost icon" data-down>↓</button><button class="btn ghost icon" data-rm>${ICONS.close}</button></div>`; list.insertBefore(div, list.lastElementChild); div.querySelector('input').focus(); return; }
      if (!row) return;
      if (e.target.closest('[data-rm]')) row.remove();
      else if (e.target.closest('[data-up]') && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      else if (e.target.closest('[data-down]') && row.nextElementSibling?.classList.contains('stage-row')) row.parentNode.insertBefore(row.nextElementSibling, row);
    });
    $('#saveSettings').onclick = async () => {
      const read = (area) => $$(`#st_${area} .stage-row`).map((r, i) => ({ id: c.etapas[area][Number(r.dataset.i)]?.id || undefined, nombre: r.querySelector('[data-f=nombre]').value, tipo: r.querySelector('[data-f=tipo]').value }));
      try {
        await api('PUT', '/api/settings', { empresa: $('#sEmpresa').value, moneda: $('#sMoneda').value.toUpperCase(), motivos_perdida: $('#sMotivos').value.split('\n'), etapas: { FTD: read('FTD'), RET: read('RET') } });
        toast('Ajustes guardados', 'good'); await load();
      } catch (e) { fail(e); }
    };
  }

  // ---------- cuenta ----------
  function renderCuenta() {
    let theme = 'dark'; try { theme = localStorage.getItem('crm_theme') === 'light' ? 'light' : 'dark'; } catch { /* sin storage */ }
    fresh().innerHTML = `<div class="stack" style="max-width:520px">
      <div class="panel"><h2>${h(S.user.nombre)}</h2><div class="small muted">Usuario <code>${h(S.user.username)}</code> · ${isAdmin() ? 'Administrador' : `Vendedor · ${areaLabel(S.user.area)}`}</div></div>
      <div class="panel"><h2>Cambiar contraseña</h2>
        <label class="field">Contraseña actual<input class="input" id="pActual" type="password" autocomplete="current-password"></label>
        <label class="field">Nueva contraseña<input class="input" id="pNueva" type="password" autocomplete="new-password" placeholder="mínimo 8 caracteres"></label>
        <div><button class="btn primary" id="pOk">Actualizar</button></div></div>
      <div class="panel"><h2>Apariencia</h2><div class="seg" id="themeSeg">${[['dark', 'Oscuro'], ['light', 'Claro']].map(([v, t]) => `<button class="${theme === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div></div>
      <div class="panel"><button class="btn" id="logout2">Cerrar sesión</button></div></div>`;
    $('#pOk').onclick = async () => { try { await api('POST', '/api/me/password', { actual: $('#pActual').value, nueva: $('#pNueva').value }); toast('Contraseña actualizada', 'good'); $('#pActual').value = $('#pNueva').value = ''; } catch (e) { fail(e); } };
    $('#themeSeg').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; setTheme(b.dataset.v); renderCuenta(); };
    $('#logout2').onclick = () => $('#logoutBtn').click();
  }
  function setTheme(v) {
    try { if (v === 'light') localStorage.setItem('crm_theme', 'light'); else localStorage.removeItem('crm_theme'); } catch { /* sin storage */ }
    if (v === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
  }

  // ---------- modales ----------
  function modal(inner, opts = {}) {
    $('#overlay').innerHTML = `<div class="modal" id="modal"><div class="scrim" ${opts.locked ? '' : 'data-close'}></div><div class="box ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${inner}</div></div>`;
    $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
    setTimeout(() => $('#modal [autofocus], #modal input, #modal select, #modal textarea')?.focus(), 30);
  }
  function closeModal() { $('#modal')?.remove(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#modal')) closeModal(); else if (S.openLeadId) closeDrawer(); } });

  function passwordModal(forced) {
    modal(`<h2>Cambia tu contraseña</h2><p class="muted">Es tu primera vez aquí o el administrador restableció tu clave. Elige una contraseña nueva de al menos 8 caracteres.</p>
      <label class="field">Contraseña actual<input class="input" id="fpActual" type="password" autocomplete="current-password"></label>
      <label class="field">Nueva contraseña<input class="input" id="fpNueva" type="password" autocomplete="new-password"></label>
      <div class="actions">${forced ? '' : '<button class="btn" data-close>Después</button>'}<button class="btn primary" id="fpOk">Guardar</button></div>`, { locked: forced });
    $('#fpOk').onclick = async () => { try { await api('POST', '/api/me/password', { actual: $('#fpActual').value, nueva: $('#fpNueva').value }); S.user.debe_cambiar_clave = false; closeModal(); toast('Contraseña actualizada', 'good'); } catch (e) { fail(e); } };
  }

  function newLeadModal() {
    const canPick = isAdmin();
    const area = bothAreas() ? S.area : (myAreas()[0] || 'FTD');
    modal(`<h2>Nuevo lead</h2>
      <div class="field-grid">
        <label class="field">Nombre *<input class="input" id="nNombre" autofocus></label>
        <label class="field">WhatsApp<input class="input" id="nWa" placeholder="+57 300 000 0000" inputmode="tel"></label>
        <label class="field">Correo<input class="input" id="nCorreo" type="email"></label>
        <label class="field">País<input class="input" id="nPais" placeholder="CO, MX, EC…" maxlength="40"></label>
        <label class="field">Ciudad<input class="input" id="nCiudad"></label>
        <label class="field">Cuánto va a pagar (${h(S.config.moneda)})<input class="input" id="nMonto" inputmode="decimal" placeholder="0"></label>
        ${bothAreas() ? `<label class="field">Área<select class="input" id="nArea"><option value="FTD" ${area === 'FTD' ? 'selected' : ''}>FTD</option><option value="RET" ${area === 'RET' ? 'selected' : ''}>Retención</option></select></label>` : ''}
        <label class="field">Etapa<select class="input" id="nEtapa">${stages(area).map((s) => `<option value="${s.id}">${h(s.nombre)}</option>`).join('')}</select></label>
        ${canPick ? `<label class="field">Responsable<select class="input" id="nResp"><option value="">Sin asignar</option>${usersForArea(area).map((u) => `<option value="${u.id}">${h(u.nombre)}</option>`).join('')}</select></label>` : ''}
        <label class="field">Próxima acción<input class="input" id="nPA" placeholder="Llamar, enviar info…"></label>
        <label class="field">Fecha de la próxima acción<input class="input" id="nPF" type="datetime-local"></label>
      </div>
      <label class="field">Notas<textarea class="input" id="nNotas" rows="2"></textarea></label>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="nOk">Crear lead</button></div>`, { wide: true });
    $('#nArea')?.addEventListener('change', (e) => {
      $('#nEtapa').innerHTML = stages(e.target.value).map((s) => `<option value="${s.id}">${h(s.nombre)}</option>`).join('');
      if ($('#nResp')) $('#nResp').innerHTML = `<option value="">Sin asignar</option>${usersForArea(e.target.value).map((u) => `<option value="${u.id}">${h(u.nombre)}</option>`).join('')}`;
    });
    $('#nOk').onclick = async () => {
      try {
        const d = await api('POST', '/api/leads', { nombre: $('#nNombre').value, whatsapp: $('#nWa').value, correo: $('#nCorreo').value, pais: $('#nPais').value.toUpperCase().length === 2 ? $('#nPais').value.toUpperCase() : $('#nPais').value, ciudad: $('#nCiudad').value, monto: $('#nMonto').value, area: $('#nArea')?.value || area, etapa: $('#nEtapa').value, responsable_id: $('#nResp')?.value || null, proxima_accion: $('#nPA').value, proxima_fecha: fromLocalInput($('#nPF').value), notas: $('#nNotas').value });
        closeModal(); toast('Lead creado', 'good'); await load(); openLead(d.lead.id);
      } catch (e) { fail(e); }
    };
  }

  // ---------- ficha del lead (drawer) ----------
  async function openLead(id) {
    const lead = S.leads.find((l) => l.id === id);
    if (!lead) { toast('Ese lead no está en tu lista.', 'bad'); return; }
    S.openLeadId = id; S.activities = [];
    renderDrawer();
    try { const d = await api('GET', `/api/leads/${id}/activities`); if (S.openLeadId === id) { S.activities = d.activities; renderTimeline(); } } catch (e) { fail(e); }
  }
  function closeDrawer() { S.openLeadId = null; $('#drawerRoot')?.remove(); if (location.hash.startsWith('#lead-')) history.replaceState(null, '', `#${S.view}`); }
  async function refreshDrawer() {
    if (!S.openLeadId) return;
    const active = document.activeElement; const activeId = active?.id; const inDrawer = active && $('#drawerRoot')?.contains(active);
    if (inDrawer && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return; // no pisar lo que está escribiendo
    renderDrawer(true);
    try { const d = await api('GET', `/api/leads/${S.openLeadId}/activities`); S.activities = d.activities; renderTimeline(); } catch { /* se intenta luego */ }
    if (activeId) $(`#${activeId}`)?.focus();
  }
  function renderDrawer(keepScroll = false) {
    const l = S.leads.find((x) => x.id === S.openLeadId); if (!l) { closeDrawer(); return; }
    const st = stage(l); const scrollTop = keepScroll ? $('#drawerRoot .scroll')?.scrollTop : 0;
    $('#drawerRoot')?.remove();
    const root = document.createElement('div'); root.id = 'drawerRoot'; document.body.appendChild(root);
    const waDigits = (l.whatsapp || '').replace(/\D/g, '');
    const leadTasks = S.tasks.filter((t) => t.lead_id === l.id && !t.hecho);
    const sellers = usersForArea(l.area);
    if (l.responsable_id && !sellers.some((u) => u.id === l.responsable_id)) { const r = userById(l.responsable_id); if (r) sellers.push(r); }
    root.innerHTML = `<div class="scrim" id="drawerScrim"></div><aside class="drawer" aria-label="Ficha del lead">
      <header>
        <div class="title">
          <h2 title="${h(l.nombre)}">${h(l.nombre)}</h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span class="chip ${l.area === 'RET' ? 'ret' : 'accent'}">${areaLabel(l.area)}</span>
            <span class="chip ${st.tipo === 'ganada' ? 'good' : st.tipo === 'perdida' ? 'bad' : ''}">${h(st.nombre)}</span>
            <span class="chip">${origenLabel(l)}</span>
            <span class="faint small">${ago(l.lead_creado_en || l.creado_en)}</span>
          </div>
        </div>
        <button class="btn ghost icon" id="drawerClose" aria-label="Cerrar">${ICONS.close}</button>
      </header>
      <div class="scroll">
        <section>
          <div class="field-grid">
            <label class="field">Etapa<select class="input" id="dEtapa">${stages(l.area).map((s) => `<option value="${s.id}" ${s.id === l.etapa ? 'selected' : ''}>${h(s.nombre)}</option>`).join('')}</select></label>
            <label class="field">Responsable<select class="input" id="dResp" ${isAdmin() ? '' : 'disabled'}><option value="">Sin asignar</option>${sellers.map((u) => `<option value="${u.id}" ${u.id === l.responsable_id ? 'selected' : ''}>${h(u.nombre)}</option>`).join('')}</select></label>
          </div>
          ${st.tipo === 'perdida' ? `<label class="field">Motivo de pérdida<select class="input" id="dMotivo"><option value="">—</option>${(S.config.motivos_perdida || []).map((m) => `<option ${l.motivo_perdida === m ? 'selected' : ''}>${h(m)}</option>`).join('')}${l.motivo_perdida && !(S.config.motivos_perdida || []).includes(l.motivo_perdida) ? `<option selected>${h(l.motivo_perdida)}</option>` : ''}</select></label>` : ''}
          <div class="contact">
            ${waDigits ? `<a class="btn sm" href="https://wa.me/${waDigits}" target="_blank" rel="noopener">${ICONS.wa} WhatsApp</a>` : ''}
            ${l.whatsapp ? `<button class="btn sm" data-copy="${h(l.whatsapp)}">Copiar número</button>` : ''}
            ${l.correo ? `<a class="btn sm" href="mailto:${h(l.correo)}">Correo</a>` : ''}
            ${l.area === 'FTD' ? `<button class="btn sm ${st.tipo === 'ganada' ? 'primary' : ''}" id="toRet">Pasar a Retención →</button>` : ''}
          </div>
          <div class="saving" id="saving"></div>
        </section>
        <section><h3>Datos</h3>
          <div class="field-grid">
            <label class="field">Nombre<input class="input" id="dNombre" value="${h(l.nombre)}" data-f="nombre"></label>
            <label class="field">WhatsApp<input class="input" id="dWa" value="${h(l.whatsapp || '')}" data-f="whatsapp" inputmode="tel"></label>
            <label class="field">Correo<input class="input" id="dCorreo" value="${h(l.correo || '')}" data-f="correo" type="email"></label>
            <label class="field">País<input class="input" id="dPais" value="${h(l.pais || '')}" data-f="pais" placeholder="CO, MX…"></label>
            <label class="field">Ciudad<input class="input" id="dCiudad" value="${h(l.ciudad || '')}" data-f="ciudad"></label>
            <label class="field">Cuánto va a pagar (${h(S.config.moneda)})<input class="input num" id="dMonto" value="${l.monto ?? ''}" data-f="monto" inputmode="decimal"></label>
            <label class="field">Próxima acción<input class="input" id="dPA" value="${h(l.proxima_accion || '')}" data-f="proxima_accion" placeholder="Llamar, enviar propuesta…"></label>
            <label class="field">Fecha de la próxima acción<input class="input" id="dPF" type="datetime-local" value="${toLocalInput(l.proxima_fecha)}" data-f="proxima_fecha"></label>
          </div>
          <label class="field">Notas<textarea class="input" id="dNotas" rows="3" data-f="notas">${h(l.notas || '')}</textarea></label>
        </section>
        ${Object.keys(l.respuestas || {}).length ? `<section><h3>Respuestas del formulario</h3><dl class="kv">${Object.entries(l.respuestas).map(([k, v]) => `<dt>${h(k)}</dt><dd><b>${h(v)}</b></dd>`).join('')}</dl></section>` : ''}
        ${l.origen_tipo !== 'manual' ? `<section><h3>Origen</h3><dl class="kv">
          ${l.campaign_name ? `<dt>Campaña</dt><dd>${h(l.campaign_name)}</dd>` : ''}${l.adset_name ? `<dt>Conjunto</dt><dd>${h(l.adset_name)}</dd>` : ''}${l.ad_name ? `<dt>Anuncio</dt><dd>${h(l.ad_name)}</dd>` : ''}
          ${l.form_name ? `<dt>Formulario</dt><dd>${h(l.form_name)}</dd>` : ''}${l.platform ? `<dt>Plataforma</dt><dd>${l.platform === 'ig' ? 'Instagram' : l.platform === 'fb' ? 'Facebook' : h(l.platform)}</dd>` : ''}
          <dt>Fecha del lead</dt><dd>${fmtDT(l.lead_creado_en)}</dd>${l.meta_lead_id ? `<dt>ID en Meta</dt><dd class="num small">${h(l.meta_lead_id)}</dd>` : ''}</dl></section>` : ''}
        <section><h3>Tareas <span class="chip">${leadTasks.length}</span></h3>
          ${leadTasks.length ? `<div class="list">${leadTasks.map((t) => `<div class="item"><label class="check" style="margin-top:2px"><input type="checkbox" data-task="${t.id}"></label><div class="body"><div class="t">${h(t.titulo)}</div><div class="m"><span class="due ${dueClass(t.fecha)}">${fmtDT(t.fecha)}</span>${isAdmin() ? ` · ${h(uname(t.asignado_id))}` : ''}</div></div></div>`).join('')}</div>` : ''}
          <div><button class="btn sm" id="dNewTask">+ Tarea para este lead</button></div>
        </section>
        <section><h3>Historial</h3>
          <div style="display:grid;gap:6px">
            <div style="display:flex;gap:6px"><select class="input" id="noteTipo" style="width:auto"><option value="nota">Nota</option><option value="llamada">Llamada</option><option value="whatsapp">WhatsApp</option><option value="reunion">Reunión</option></select><input class="input" id="noteText" placeholder="Qué pasó con este lead…"><button class="btn primary" id="noteOk">Agregar</button></div>
          </div>
          <div class="timeline" id="timeline"><div class="faint small">Cargando historial…</div></div>
        </section>
        ${isAdmin() ? `<section><button class="btn danger sm" id="dDelete" style="justify-self:start">Eliminar lead</button></section>` : ''}
      </div></aside>`;
    if (keepScroll && scrollTop) $('#drawerRoot .scroll').scrollTop = scrollTop;
    renderTimeline();
    wireDrawer(l);
  }
  function renderTimeline() {
    const tl = $('#timeline'); if (!tl) return;
    if (!S.activities.length) { tl.innerHTML = '<div class="faint small">Sin movimientos todavía.</div>'; return; }
    const icon = { nota: '✎', llamada: '☎', whatsapp: '✆', reunion: '◷', etapa: '→', asignacion: '●', area: '↹', tarea: '✓', creacion: '+', campo: '✎', proxima: '⏰' };
    tl.innerHTML = S.activities.map((a) => `<div class="tl"><div class="dot ${a.tipo === 'llamada' || a.tipo === 'whatsapp' || a.tipo === 'reunion' ? 'nota' : a.tipo}">${icon[a.tipo] || '•'}</div><div><div class="txt">${a.tipo === 'campo' && a.de != null && a.a != null && !a.texto?.includes('→') ? `${h(a.texto)}: <span class="faint">${h(a.de || '—')}</span> → ${h(a.a || '—')}` : h(a.texto)}</div><div class="when">${fmtDT(a.en)} · ${h(a.usuario || 'Sistema')}</div></div></div>`).join('');
  }
  function wireDrawer(l) {
    const root = $('#drawerRoot');
    $('#drawerScrim').onclick = closeDrawer; $('#drawerClose').onclick = closeDrawer;
    const saving = (t) => { const s = $('#saving'); if (s) s.textContent = t; };
    const save = async (patch) => {
      saving('Guardando…');
      try { const d = await api('PATCH', `/api/leads/${l.id}`, patch); replaceLead(d.lead); saving('Guardado ✓'); setTimeout(() => saving(''), 1500); }
      catch (e) { fail(e); saving(''); renderDrawer(true); }
    };
    $('#dEtapa').onchange = (e) => changeStage(l, e.target.value);
    $('#dResp').onchange = (e) => save({ responsable_id: e.target.value || null });
    $('#dMotivo') && ($('#dMotivo').onchange = (e) => save({ motivo_perdida: e.target.value || null }));
    const debounced = debounce((f, v) => save({ [f]: v }), 600);
    $$('[data-f]', root).forEach((inp) => {
      const f = inp.dataset.f;
      const current = () => (f === 'proxima_fecha' ? fromLocalInput(inp.value) : inp.value);
      const changed = () => { const v = current(); const prev = f === 'proxima_fecha' ? l.proxima_fecha : (l[f] ?? ''); return String(v ?? '') !== String(prev ?? ''); };
      inp.addEventListener('change', () => { if (changed()) save({ [f]: current() }); });
      if (inp.tagName === 'TEXTAREA' || f === 'notas') inp.addEventListener('input', () => { if (changed()) debounced(f, current()); });
    });
    root.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); toast('Número copiado'); } catch { toast(c.dataset.copy); } return; }
    });
    $('#toRet') && ($('#toRet').onclick = () => {
      const ret = usersForArea('RET');
      const keepOk = l.responsable_id && userHasArea(userById(l.responsable_id), 'RET');
      modal(`<h2>Pasar a Retención</h2><p class="muted">${h(l.nombre)} entrará al tablero de Retención en su primera etapa, con todo su historial.</p>
        ${isAdmin() ? `<label class="field">Responsable en Retención<select class="input" id="rResp"><option value="">${keepOk ? `${h(uname(l.responsable_id))} (mantener)` : 'Sin asignar (lo entregas después)'}</option>${ret.map((u) => `<option value="${u.id}">${h(u.nombre)}</option>`).join('')}</select></label>` : (userHasArea(S.user, 'RET') ? '' : '<p class="small muted">Como no tienes acceso a Retención, el lead quedará sin asignar para que el administrador lo entregue al equipo de Retención.</p>')}
        <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="rOk">Pasar a Retención</button></div>`);
      $('#rOk').onclick = async () => { try { const d = await api('POST', `/api/leads/${l.id}/retencion`, { responsable_id: $('#rResp')?.value || null }); closeModal(); replaceLead(d.lead); toast('Lead en Retención', 'good'); } catch (err) { fail(err); } };
    });
    $('#dNewTask').onclick = () => taskModal(l);
    $$('[data-task]', root).forEach((cb) => cb.onchange = async () => { try { await api('PATCH', `/api/tasks/${cb.dataset.task}`, { hecho: cb.checked }); await load(); } catch (err) { fail(err); } });
    const addNote = async () => {
      const texto = $('#noteText').value.trim(); if (!texto) return;
      try { await api('POST', `/api/leads/${l.id}/notas`, { texto, tipo: $('#noteTipo').value }); $('#noteText').value = ''; const d = await api('GET', `/api/leads/${l.id}/activities`); S.activities = d.activities; renderTimeline(); }
      catch (err) { fail(err); }
    };
    $('#noteOk').onclick = addNote; $('#noteText').onkeydown = (e) => { if (e.key === 'Enter') addNote(); };
    $('#dDelete') && ($('#dDelete').onclick = () => {
      modal(`<h2>Eliminar lead</h2><p class="muted">Se borrará <b>${h(l.nombre)}</b> con su historial y tareas. No se puede deshacer.</p><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn danger" id="delOk">Eliminar</button></div>`);
      $('#delOk').onclick = async () => { try { await api('DELETE', `/api/leads/${l.id}`); closeModal(); closeDrawer(); toast('Lead eliminado'); await load(); } catch (err) { fail(err); } };
    });
  }

  // ---------- arranque ----------
  start().catch(() => showLogin());
})();
