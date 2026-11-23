/* Lupa — tu cartera: valor total en directo, posiciones, detalle de cada una y edición.
 *
 * Cómo se calcula el valor en directo:
 *   valor ahora = valor que daba MyInvestor × (precio de referencia ahora / precio de referencia ese día)
 * La referencia es un ETF que cotiza en euros y sigue el mismo índice que el fondo (en las
 * acciones, la propia acción). Los fondos solo publican un valor al día, así que esto es una
 * estimación que se adelanta a lo que verás en MyInvestor al día siguiente.
 */
(function () {
  'use strict';
  const LWC = window.LightweightCharts;
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const $ = (sel, r = document) => r.querySelector(sel);

  /* ---------- Utilidades DOM (el texto siempre entra con textContent) ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs && (Array.isArray(attrs) || attrs instanceof Node || typeof attrs !== 'object')) { kids.unshift(attrs); attrs = null; }
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  const SVGNS = 'http://www.w3.org/2000/svg';
  function icon(kind) {
    const paths = { buy: 'M5 1.5 9.2 8.5H.8z', sell: 'M5 8.5.8 1.5h8.4z', neutral: 'M5 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z' };
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 10 10'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', `ico ico--${kind}`);
    const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', paths[kind]); s.append(p);
    return s;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lupa:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lupa:' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem('lupa:' + k); } catch { /* nada */ } },
  };

  /* ---------- Formatos ---------- */
  const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const NF2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const NF1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');
  const eur = (x) => (isNum(x) ? (x < 0 ? '−' : '') + EUR.format(Math.abs(x)) : '—');
  const eurS = (x) => (isNum(x) ? sign(x) + EUR.format(Math.abs(x)) : '—');
  const pctS = (x) => (isNum(x) ? `${sign(x)}${NF2.format(Math.abs(x))} %` : '—');
  const tone = (x) => (!isNum(x) || Math.abs(x) < 0.005 ? 'neutral' : x > 0 ? 'buy' : 'sell');
  const madridDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const fmtDay = (iso) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
  const fmtDayFull = (iso) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
  const fmtTime = (unix) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(unix * 1000));
  const fmtDayTime = (unix) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(unix * 1000));
  // "139,31" / "-12,87" / "1.234,56" / "−5" → número
  function parseEs(s) {
    const t = String(s).trim().replace(/\s/g, '').replace(/[−–]/g, '-').replace(/€/g, '');
    if (!t) return NaN;
    const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    return /^-?\d+(\.\d+)?$/.test(norm) ? Number(norm) : NaN;
  }
  const numEs = (x) => (isNum(x) ? (x < 0 ? '-' : '') + NF2.format(Math.abs(x)).replace(/\./g, '') : '');

  /* ---------- Estado ---------- */
  const S = {
    clave: store.get('clave', ''),
    doc: null, hist: {}, live: {}, errors: {},
    updated: null, loading: false, view: null, detailId: null,
    range: store.get('rango', '3M'), timer: null, chart: null, chartSeries: null, chartKind: null,
    scrollCartera: 0,
  };

  /* ---------- Red ---------- */
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (S.clave) headers['X-Clave'] = S.clave;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { ...opts, headers });
    let body = {};
    try { body = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) { const e = new Error(body.error || `El servidor respondió con un error (${res.status}).`); e.status = res.status; e.code = body.code; throw e; }
    return body;
  }
  async function fetchQuotes(syms, range) {
    const out = [];
    for (let i = 0; i < syms.length; i += 25) {
      const part = syms.slice(i, i + 25);
      const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(part.join(','))}&range=${range}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(body)) throw new Error(body?.error || 'No se pudieron cargar los precios.');
      out.push(...body);
    }
    return out;
  }
  const isCash = (p) => p.tipo === 'efectivo';
  const symbols = () => [...new Set(S.doc.posiciones.filter((p) => !isCash(p) && p.referencia).map((p) => p.referencia))];
  // Yahoo a veces no incluye la última sesión en las velas diarias: se añade con el último precio
  function mergeLive(sym) {
    const hs = S.hist[sym], q = S.live[sym];
    if (!hs || !q || !isNum(q.price) || !isNum(q.time)) return;
    const d = madridDate(new Date(q.time * 1000)), last = hs.closes[hs.closes.length - 1];
    if (!last || d > last[0]) hs.closes.push([d, q.price]);
    else if (d === last[0]) last[1] = q.price;
  }
  const pickLive = (q) => ({ price: q.price, prevClose: q.prevClose, time: q.time, name: q.name, exchange: q.exchange, currency: q.currency });

  async function loadHistory(syms) {
    const need = syms.filter((s) => !S.hist[s]);
    if (!need.length) return;
    for (const q of await fetchQuotes(need, '1y')) {
      if (q.error) { S.errors[q.symbol] = q.error; continue; }
      S.hist[q.symbol] = { ...q, closes: q.closes.slice() };
      if (!S.live[q.symbol]) S.live[q.symbol] = pickLive(q);
      mergeLive(q.symbol);
    }
  }
  async function refreshLive() {
    for (const q of await fetchQuotes(symbols(), '5d')) {
      if (q.error) { if (!S.live[q.symbol]) S.errors[q.symbol] = q.error; continue; }
      delete S.errors[q.symbol];
      S.live[q.symbol] = pickLive(q);
      const hs = S.hist[q.symbol];
      if (hs) {
        const m = new Map(hs.closes);
        for (const [d, c] of q.closes) m.set(d, c);
        hs.closes = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        mergeLive(q.symbol);
      }
    }
    S.updated = new Date();
  }

  /* ---------- Valoración ---------- */
  function closeOnOrBefore(closes, date) {
    let lo = 0, hi = closes.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (closes[mid][0] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? closes[ans][1] : NaN;
  }
  function lastDateBefore(closes, date) {
    for (let i = closes.length - 1; i >= 0; i--) if (closes[i][0] < date) return closes[i][0];
    return null;
  }
  function anchorOf(p) {
    if (p.ref.precio > 0) return p.ref.precio;
    const hs = S.hist[p.referencia];
    return hs ? closeOnOrBefore(hs.closes, p.ref.base) : NaN;
  }
  function val(p) {
    if (isCash(p)) return { ok: true, value: p.ref.valor, prev: p.ref.valor, today: 0, todayPct: 0, pnl: 0, pnlPct: 0 };
    const a = anchorOf(p), q = S.live[p.referencia];
    let r = { ok: false, value: p.ref.valor, prev: p.ref.valor };
    if (isNum(a) && a > 0 && q && isNum(q.price)) {
      const value = (p.ref.valor * q.price) / a;
      const prev = isNum(q.prevClose) ? (p.ref.valor * q.prevClose) / a : value;
      r = { ok: true, value, prev, time: q.time };
    }
    r.today = r.value - r.prev;
    r.todayPct = r.prev ? (r.value / r.prev - 1) * 100 : 0;
    r.pnl = r.value - p.invertido;
    r.pnlPct = p.invertido > 0 ? (r.value / p.invertido - 1) * 100 : NaN;
    return r;
  }
  function totals(list) {
    let value = 0, prev = 0, inv = 0, ok = true;
    for (const p of list) { const v = val(p); value += v.value; prev += v.prev; inv += p.invertido; ok = ok && v.ok; }
    return { value, prev, inv, ok, today: value - prev, todayPct: prev ? (value / prev - 1) * 100 : 0, pnl: value - inv, pnlPct: inv ? (value / inv - 1) * 100 : NaN };
  }
  function groups() {
    const order = [], map = new Map();
    for (const p of S.doc.posiciones) {
      if (!map.has(p.grupo)) { map.set(p.grupo, []); order.push(p.grupo); }
      map.get(p.grupo).push(p);
    }
    return order.map((name, i) => ({ name, idx: i, items: map.get(name) }));
  }
  // Serie de valor (simulada con lo que tienes ahora) para el gráfico de evolución
  function valueSeries(list) {
    const dates = new Set();
    for (const p of list) if (!isCash(p)) for (const [d] of S.hist[p.referencia]?.closes || []) dates.add(d);
    const out = [];
    for (const d of [...dates].sort()) {
      let sum = 0, ok = true;
      for (const p of list) {
        if (isCash(p)) { sum += p.ref.valor; continue; }
        const hs = S.hist[p.referencia], a = anchorOf(p);
        const c = hs ? closeOnOrBefore(hs.closes, d) : NaN;
        if (!isNum(c) || !isNum(a) || a <= 0) { ok = false; break; }
        sum += (p.ref.valor * c) / a;
      }
      if (ok) out.push({ time: d, value: Math.round(sum * 100) / 100 });
    }
    // Punto de ahora mismo si el mercado ha abierto hoy
    const m = marketInfo();
    if (out.length && m.newest && madridDate(new Date(m.newest * 1000)) === madridDate()) {
      const now = Math.round(totals(list).value * 100) / 100, today = madridDate();
      if (out[out.length - 1].time === today) out[out.length - 1].value = now;
      else if (today > out[out.length - 1].time) out.push({ time: today, value: now });
    }
    return out;
  }
  function marketInfo() {
    const times = Object.values(S.live).map((q) => q.time).filter(isNum);
    const newest = times.length ? Math.max(...times) : null;
    return { newest, fresh: !!newest && Date.now() / 1000 - newest < 40 * 60, isToday: !!newest && madridDate(new Date(newest * 1000)) === madridDate() };
  }

  /* Guarda el precio de anclaje la primera vez que se puede calcular, para que no cambie nunca */
  async function persistAnchors() {
    let changed = false;
    for (const p of S.doc.posiciones) {
      if (p.ref.precio > 0 || isCash(p)) continue;
      const a = anchorOf(p);
      if (isNum(a) && a > 0) { p.ref.precio = a; changed = true; }
    }
    if (changed) { try { await save(S.doc); } catch { /* se recalcula la próxima vez */ } }
  }
  async function save(doc) {
    const body = await api('/api/cartera', { method: 'PUT', body: JSON.stringify({ cartera: doc }) });
    S.doc = body.cartera;
    return S.doc;
  }

  /* ---------- Carga ---------- */
  function setProgress(on) { const p = $('.progress'); if (p) p.hidden = !on; }
  async function start() {
    S.loading = true;
    setProgress(true);
    if (S.view === 'cartera' || S.view === 'detalle' || S.view === 'editar') put($(`#view-${S.view}`), h('p', { class: 'muted loading-note', text: 'Cargando tu cartera…' }));
    try {
      const { cartera } = await api('/api/cartera');
      S.doc = cartera;
      if (S.clave) store.set('clave', S.clave);
      await Promise.all([loadHistory(symbols()), refreshLive().catch(() => {})]);
      await persistAnchors();
      S.loading = false;
      show(S.view, S.detailId);
      schedule();
    } catch (e) {
      S.loading = false;
      const el = $(`#view-${S.view === 'analizar' ? 'cartera' : S.view}`);
      if (e.code === 'clave') renderLogin(el, S.clave ? 'La clave no es correcta.' : '');
      else if (e.code === 'sin-clave') renderSetup(el);
      else put(el, h('div', { class: 'alert', role: 'alert', text: e instanceof TypeError ? 'No se puede conectar con el servidor. Revisa tu conexión.' : e.message }),
        h('button', { type: 'button', class: 'btn', onclick: () => start() }, 'Reintentar'));
    } finally {
      setProgress(false);
    }
  }
  function schedule() {
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 60000);
  }
  async function tick() {
    if (!S.doc || !['cartera', 'detalle'].includes(S.view)) return;
    try { await refreshLive(); } catch { /* se queda el último precio */ }
    if (S.view === 'cartera') updateCartera();
    else if (S.view === 'detalle') updateDetalle();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  /* ---------- Clave ---------- */
  function renderLogin(el, msg) {
    const inp = h('input', { type: 'password', id: 'clave', autocomplete: 'current-password', class: 'field__input', required: true });
    put(el, h('form', {
      class: 'gate', onsubmit: (e) => { e.preventDefault(); S.clave = inp.value.trim(); start(); },
    },
    h('h1', { class: 'gate__title', text: 'Tu cartera tiene clave' }),
    h('p', { class: 'muted', text: 'Escribe la clave que pusiste al publicar la app. Solo hace falta una vez en cada dispositivo.' }),
    h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Clave' }), inp),
    msg ? h('p', { class: 'alert', role: 'alert', text: msg }) : null,
    h('button', { type: 'submit', class: 'btn btn--primary' }, 'Entrar')));
    setTimeout(() => inp.focus(), 50);
  }
  function renderSetup(el) {
    put(el, h('div', { class: 'gate' },
      h('h1', { class: 'gate__title', text: 'Falta poner una clave' }),
      h('p', { text: 'Para que nadie más pueda ver tu cartera, la app necesita una clave. Se pone una vez en Cloudflare, también desde el móvil:' }),
      h('ol', { class: 'gate__steps' },
        h('li', {}, 'Entra en dash.cloudflare.com, abre ', h('strong', { text: 'Workers & Pages' }), ' y elige ', h('strong', { text: 'lupa-bolsa' }), '.'),
        h('li', {}, 'Ve a ', h('strong', { text: 'Settings' }), ', busca ', h('strong', { text: 'Variables and Secrets' }), ' y pulsa ', h('strong', { text: 'Add' }), '.'),
        h('li', {}, 'Elige el tipo ', h('strong', { text: 'Secret' }), ', pon de nombre ', h('strong', { text: 'CLAVE' }), ' y como valor la clave que quieras (8 caracteres o más). Pulsa ', h('strong', { text: 'Deploy' }), '.')),
      h('p', { class: 'muted', text: 'Después recarga esta página. Desde un ordenador también se puede con: npx wrangler secret put CLAVE' })));
  }

  /* ---------- Vista: Mi cartera ---------- */
  const GROUP_KEYS = ['g0', 'g1', 'g2', 'g3'];

  function liveBadge() {
    const m = marketInfo();
    if (!m.newest) return h('p', { class: 'live' }, h('span', { class: 'live__dot' }), 'Sin precios todavía');
    if (m.fresh) return h('p', { class: 'live live--on' }, h('span', { class: 'live__dot', 'aria-hidden': 'true' }), `En directo, precio de las ${fmtTime(m.newest)}`);
    return h('p', { class: 'live' }, h('span', { class: 'live__dot', 'aria-hidden': 'true' }), `Mercados cerrados. Último precio: ${fmtDayTime(m.newest)}`);
  }
  function delta(x, pct, extra) {
    const t = tone(x);
    return h('span', { class: `delta tone-${t}` }, icon(t), h('span', { class: 'num', text: `${eurS(x)} (${pctS(pct)})` }), extra ? h('span', { class: 'delta__extra', text: extra }) : null);
  }

  function renderCartera() {
    const el = $('#view-cartera');
    const T = totals(S.doc.posiciones);
    put(el, h('div', { class: 'cgrid' }, h('div', { class: 'cgrid__main' },
      h('section', { class: 'ptotal', 'aria-labelledby': 't-cartera' },
        h('div', { class: 'ptotal__top' },
          h('h1', { id: 't-cartera', class: 'ptotal__title', text: 'Mi cartera' }),
          h('a', { class: 'btn btn--ghost btn--small', href: '#editar' }, 'Editar')),
        h('div', { id: 'c-head' })),
      h('section', { class: 'pchart', 'aria-label': 'Evolución de tu cartera' },
        h('div', { class: 'pchart__head' },
          h('p', { id: 'c-chart-cap', class: 'pchart__cap' }),
          h('div', { class: 'ranges', role: 'group', 'aria-label': 'Periodo' }, ['1M', '3M', '6M', '1A'].map((k) => h('button', {
            type: 'button', class: 'chip chip--small', 'aria-pressed': S.range === k ? 'true' : 'false',
            onclick: () => { S.range = k; store.set('rango', k); renderCartera(); },
          }, k)))),
        h('div', { id: 'c-chart', class: 'pchart__plot' }),
        h('p', { class: 'muted small', text: 'Simulado con lo que tienes hoy: no tiene en cuenta cuándo compraste cada cosa.' })),
      h('section', { id: 'c-alloc', class: 'alloc', 'aria-label': 'Reparto de tu cartera' })),
      h('div', { id: 'c-groups', class: 'pgroups cgrid__side' })),
      h('p', { class: 'pnote muted small', text: 'Los fondos publican su valor una vez al día. Lupa lo estima en directo con un ETF que sigue el mismo índice, así que puede variar un poco respecto a MyInvestor. Para ajustarlo, pulsa Editar y copia los números de MyInvestor.' }),
    );
    updateCartera(true);
    if (T.value === 0 && !S.doc.posiciones.length) put($('#c-groups'), h('p', { class: 'muted', text: 'Todavía no hay posiciones. Pulsa Editar para añadir la primera.' }));
  }

  function updateCartera(fresh) {
    if (!$('#c-head')) return renderCartera();
    const T = totals(S.doc.posiciones);
    const m = marketInfo();
    put($('#c-head'),
      h('p', { class: 'ptotal__value', text: eur(T.value) }),
      h('p', { class: 'ptotal__pnl' }, delta(T.pnl, T.pnlPct), h('span', { class: 'muted', text: ' desde que invertiste' })),
      h('div', { class: 'ptotal__row' },
        h('p', {}, h('span', { class: 'muted', text: m.isToday ? 'Hoy ' : 'Última sesión ' }), delta(T.today, T.todayPct)),
        h('p', {}, h('span', { class: 'muted', text: 'Invertido ' }), h('span', { class: 'num strong', text: eur(T.inv) }))),
      liveBadge(),
      Object.keys(S.errors).length ? h('p', { class: 'alert small', role: 'status', text: `Sin precio de ${Object.keys(S.errors).join(', ')}: se usa el último valor guardado.` }) : null);
    renderAlloc(T);
    renderGroups();
    renderValueChart(S.doc.posiciones, fresh, null, '#c-chart', '#c-chart-cap');
  }

  function renderAlloc(T) {
    const gs = groups().map((g) => ({ ...g, value: totals(g.items).value }));
    const total = T.value || 1;
    put($('#c-alloc'),
      h('h2', { class: 'visually-hidden', text: 'Reparto' }),
      h('div', { class: 'alloc__bar', role: 'img', 'aria-label': gs.map((g) => `${g.name} ${NF1.format((g.value / total) * 100)} %`).join(', ') },
        gs.map((g) => h('span', { class: `alloc__seg swatch--${GROUP_KEYS[Math.min(g.idx, 3)]}`, style: `flex-grow:${Math.max(g.value, 0.0001)}` }))),
      h('ul', { class: 'alloc__legend' }, gs.map((g) => h('li', {},
        h('span', { class: `swatch swatch--${GROUP_KEYS[Math.min(g.idx, 3)]}`, 'aria-hidden': 'true' }),
        h('span', { text: g.name }), h('span', { class: 'num muted', text: `${NF1.format((g.value / total) * 100)} %` })))));
  }

  function renderGroups() {
    const isToday = marketInfo().isToday;
    put($('#c-groups'), groups().map((g) => {
      const G = totals(g.items);
      return h('section', { class: 'pgroup' },
        h('header', { class: 'pgroup__head' },
          h('span', { class: `swatch swatch--${GROUP_KEYS[Math.min(g.idx, 3)]}`, 'aria-hidden': 'true' }),
          h('h2', { class: 'pgroup__title', text: g.name }),
          h('span', { class: 'pgroup__value num', text: eur(G.value) }),
          h('span', { class: 'pgroup__pnl' }, delta(G.pnl, G.pnlPct))),
        h('ul', { class: 'holds' }, g.items.map((p) => {
          const v = val(p);
          const today = isCash(p) ? 'Pendiente de invertir' : v.ok ? `${isToday ? 'Hoy' : 'Última sesión'} ${pctS(v.todayPct)}` : 'Sin precio en directo';
          const kind = isCash(p) ? '' : p.indice || (p.tipo === 'accion' ? 'Acción' : 'Fondo');
          return h('li', {}, h('a', { class: 'hold', href: `#p-${encodeURIComponent(p.id)}` },
            h('span', { class: 'hold__name', text: p.nombre }),
            h('span', { class: 'hold__value num', text: eur(v.value) }),
            h('span', { class: 'hold__meta muted' }, h('span', { class: 'num', text: today }), kind ? h('span', { class: 'hold__idx', text: `, ${kind}` }) : null),
            h('span', { class: 'hold__pnl' }, isCash(p) ? null : delta(v.pnl, v.pnlPct))));
        })));
    }));
  }

  /* ---------- Gráfico de evolución ---------- */
  function rangeStart(points, key) {
    if (!points.length) return 0;
    const days = { '1M': 31, '3M': 92, '6M': 183, '1A': 366 }[key] || 92;
    const lastD = new Date(points[points.length - 1].time + 'T12:00:00Z');
    lastD.setUTCDate(lastD.getUTCDate() - days);
    const from = lastD.toISOString().slice(0, 10);
    const i = points.findIndex((p) => p.time >= from);
    return i < 0 ? 0 : i;
  }

  function renderValueChart(list, fresh, invested, sel, capSel) {
    const el = $(sel), cap = $(capSel);
    if (!el || !LWC) return;
    const all = valueSeries(list);
    const pts = all.slice(rangeStart(all, S.range));
    const capText = () => {
      if (pts.length < 2) return 'Sin historial suficiente';
      const a = pts[0].value, b = pts[pts.length - 1].value;
      const lbl = { '1M': 'En 1 mes', '3M': 'En 3 meses', '6M': 'En 6 meses', '1A': 'En 1 año' }[S.range];
      return `${lbl}: ${eurS(b - a)} (${pctS((b / a - 1) * 100)})`;
    };
    if (cap) cap.textContent = capText();
    const kind = `${sel}|${S.range}|${invested ?? ''}`;
    if (!fresh && S.chart && S.chartKind === kind && el.contains(S.chart.chartElement?.())) {
      S.chartSeries.setData(pts);
      return;
    }
    if (S.chart) { try { S.chart.remove(); } catch { /* ya no existe */ } }
    el.replaceChildren();
    const col = ChartView.palette();
    const chart = LWC.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: col.surface }, textColor: col.muted, fontFamily: 'Archivo, system-ui, sans-serif', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: col.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: LWC.CrosshairMode.Magnet, vertLine: { color: col.muted, labelBackgroundColor: col.ink2 }, horzLine: { visible: false, labelVisible: false } },
      localization: { locale: 'es-ES', priceFormatter: eur, timeFormatter: (t) => fmtDayFull(typeof t === 'string' ? t : `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`) },
      handleScroll: false, handleScale: false,
    });
    const series = chart.addSeries(LWC.AreaSeries, {
      lineColor: col.s1, lineWidth: 2, topColor: ChartView.alpha(col.s1, 0.2), bottomColor: ChartView.alpha(col.s1, 0.02),
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4,
      priceFormat: { type: 'custom', formatter: eur, minMove: 0.01 },
    });
    series.setData(pts);
    if (isNum(invested)) series.createPriceLine({ price: invested, color: col.muted, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: 'Invertido' });
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((param) => {
      if (!cap) return;
      const d = param && param.time ? param.seriesData.get(series) : null;
      if (!d) { cap.textContent = capText(); return; }
      const t = typeof param.time === 'string' ? param.time : `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}`;
      cap.textContent = `${fmtDayFull(t)}: ${eur(d.value)}`;
    });
    S.chart = chart; S.chartSeries = series; S.chartKind = kind;
  }

  /* ---------- Vista: detalle ---------- */
  function renderDetalle(id) {
    const el = $('#view-detalle');
    const p = S.doc.posiciones.find((x) => x.id === id);
    if (!p) { put(el, h('p', { class: 'muted', text: 'Esa posición ya no está en tu cartera.' }), h('a', { class: 'btn', href: '#cartera' }, 'Volver a mi cartera')); return; }
    if (isCash(p)) {
      const T = totals(S.doc.posiciones);
      put(el,
        h('a', { class: 'back', href: '#cartera' }, '‹ Mi cartera'),
        h('section', { class: 'ptotal' },
          h('h1', { class: 'pdetail__title', text: p.nombre }),
          h('ul', { class: 'tags' }, ['Pendiente de invertir', p.grupo].map((t) => h('li', { text: t }))),
          h('p', { class: 'ptotal__value', text: eur(p.ref.valor) })),
        h('dl', { class: 'facts' },
          h('div', { class: 'fact' }, h('dt', { text: 'Peso en tu cartera' }), h('dd', { text: T.value ? `${NF1.format((p.ref.valor / T.value) * 100)} %` : '' })),
          h('div', { class: 'fact' }, h('dt', { text: 'Ajustado con MyInvestor' }), h('dd', { text: `${eur(p.ref.valor)} el ${fmtDayFull(p.ref.fecha)}` }))),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn--ghost', href: '#editar' }, 'Editar')),
        h('p', { class: 'pnote muted small', text: 'Dinero que espera en tu cartera automatizada. MyInvestor lo invierte cuando llega a 150 € más el 0,5 % del valor de la cartera. No cambia con la bolsa. Cuando se invierta, pon el nuevo valor de cada fondo en Editar.' }));
      return;
    }
    const fondo = p.tipo === 'fondo';
    const tags = [fondo ? 'Fondo indexado' : 'Acción', p.indice, p.grupo].filter(Boolean);
    put(el,
      h('a', { class: 'back', href: '#cartera' }, '‹ Mi cartera'),
      h('section', { class: 'ptotal' },
        h('h1', { class: 'pdetail__title', text: p.nombre }),
        h('ul', { class: 'tags' }, tags.map((t) => h('li', { text: t }))),
        h('div', { id: 'd-head' })),
      h('section', { class: 'pchart', 'aria-label': 'Evolución de esta posición' },
        h('div', { class: 'pchart__head' },
          h('p', { id: 'd-chart-cap', class: 'pchart__cap' }),
          h('div', { class: 'ranges', role: 'group', 'aria-label': 'Periodo' }, ['1M', '3M', '6M', '1A'].map((k) => h('button', {
            type: 'button', class: 'chip chip--small', 'aria-pressed': S.range === k ? 'true' : 'false',
            onclick: () => { S.range = k; store.set('rango', k); renderDetalle(id); },
          }, k)))),
        h('div', { id: 'd-chart', class: 'pchart__plot' })),
      h('dl', { id: 'd-facts', class: 'facts' }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => { location.hash = '#analizar'; window.Analizador?.load(p.referencia, '1d'); } }, fondo ? 'Análisis técnico del índice' : 'Análisis técnico'),
        fondo && p.isin ? h('a', { class: 'btn', href: `https://www.quefondos.com/es/fondos/ficha/index.html?isin=${encodeURIComponent(p.isin)}`, target: '_blank', rel: 'noopener' }, 'Ficha del fondo') : null,
        h('a', { class: 'btn btn--ghost', href: '#editar' }, 'Editar')),
      fondo ? h('p', { class: 'pnote muted small', text: `Valor estimado con ${p.referencia}, un ETF que sigue el mismo índice. El valor oficial lo publica la gestora al día siguiente.` }) : null,
    );
    updateDetalle(true);
  }

  function updateDetalle(fresh) {
    const p = S.doc?.posiciones.find((x) => x.id === S.detailId);
    if (!p || !$('#d-head')) return;
    const v = val(p), q = S.live[p.referencia], hs = S.hist[p.referencia], m = marketInfo();
    const T = totals(S.doc.posiciones);
    put($('#d-head'),
      h('p', { class: 'ptotal__value', text: eur(v.value) }),
      h('p', { class: 'ptotal__pnl' }, delta(v.pnl, v.pnlPct), h('span', { class: 'muted', text: ' desde que invertiste' })),
      h('div', { class: 'ptotal__row' },
        h('p', {}, h('span', { class: 'muted', text: m.isToday ? 'Hoy ' : 'Última sesión ' }), delta(v.today, v.todayPct)),
        h('p', {}, h('span', { class: 'muted', text: 'Invertido ' }), h('span', { class: 'num strong', text: eur(p.invertido) }))),
      liveBadge());
    const fact = (k, ...vals) => h('div', { class: 'fact' }, h('dt', { text: k }), h('dd', {}, ...vals));
    const refName = q?.name || hs?.name || p.referencia;
    put($('#d-facts'),
      fact('Peso en tu cartera', h('span', { class: 'num', text: `${NF1.format(T.value ? (v.value / T.value) * 100 : 0)} %` })),
      fact('Ajustado con MyInvestor', `${eur(p.ref.valor)} el ${fmtDayFull(p.ref.fecha)}`, p.tipo === 'fondo' && p.ref.base !== p.ref.fecha ? h('small', { text: `Con el valor liquidativo del ${fmtDayFull(p.ref.base)}` }) : null),
      fact('Referencia en directo', refName && refName !== p.referencia ? `${refName} (${p.referencia})` : p.referencia, q && isNum(q.price) ? h('small', { text: `${NF2.format(q.price)} ${q.currency === 'EUR' ? '€' : q.currency || ''} (${fmtDayTime(q.time)})` }) : h('small', { text: S.errors[p.referencia] || 'Sin precio' })),
      p.oficial ? fact('Nombre oficial', p.oficial) : null,
      p.isin ? fact('ISIN', h('span', { class: 'num', text: p.isin })) : null);
    renderValueChart([p], fresh, p.invertido, '#d-chart', '#d-chart-cap');
  }

  /* ---------- Vista: editar ---------- */
  function renderEditar() {
    const el = $('#view-editar');
    const originals = new Map(S.doc.posiciones.map((p) => [p.id, p]));
    const draft = JSON.parse(JSON.stringify(S.doc.posiciones));
    const form = h('form', { class: 'editor', novalidate: true });
    const list = h('div', { class: 'editor__list' });
    const msg = h('p', { class: 'alert', role: 'alert', hidden: true });
    const grupos = () => [...new Set([...draft.map((p) => p.grupo), 'Cartera automatizada', 'Fondos de inversión', 'Acciones y ETF'])];

    function card(p, i) {
      const isNew = !p.id;
      const f = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field__label', text: label }), input, hint ? h('span', { class: 'field__hint muted', text: hint }) : null);
      const inp = (name, value, attrs = {}) => h('input', { class: 'field__input', name, value: value ?? '', ...attrs });
      const v0 = p._valor !== undefined ? p._valor : numEs(p.ref?.valor);
      const g0 = p._pnl !== undefined ? p._pnl : (isNum(p.ref?.valor) && isNum(p.invertido) ? numEs(p.ref.valor - p.invertido) : '');
      const valor = inp('valor', v0, { inputmode: 'decimal', autocomplete: 'off' });
      const pnl = inp('pnl', g0, { inputmode: 'decimal', autocomplete: 'off' });
      const out = h('output', { class: 'editor__inv muted' });
      const calc = () => { const a = parseEs(valor.value), b = parseEs(pnl.value); out.textContent = isNum(a) && isNum(b) ? `Invertido: ${eur(a - b)}` : ''; };
      valor.addEventListener('input', calc); pnl.addEventListener('input', calc); calc();
      const nombre = inp('nombre', p.nombre, { maxlength: 80, autocomplete: 'off' });
      const grupo = h('select', { class: 'field__input', name: 'grupo' }, grupos().map((g) => h('option', { value: g, selected: g === p.grupo ? true : null }, g)));
      const tipo = h('select', { class: 'field__input', name: 'tipo' }, h('option', { value: 'fondo', selected: p.tipo !== 'accion' ? true : null }, 'Fondo'), h('option', { value: 'accion', selected: p.tipo === 'accion' ? true : null }, 'Acción o ETF'), h('option', { value: 'efectivo', selected: p.tipo === 'efectivo' ? true : null }, 'Efectivo'));
      const referencia = inp('referencia', p.referencia, { maxlength: 24, autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off' });
      const isin = inp('isin', p.isin, { maxlength: 12, autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off' });
      const indice = inp('indice', p.indice, { maxlength: 60, autocomplete: 'off' });
      const oficial = inp('oficial', p.oficial, { maxlength: 140, autocomplete: 'off' });
      const err = h('p', { class: 'editor__err', role: 'alert', hidden: true });
      const node = h('fieldset', { class: 'ecard', 'data-i': i },
        h('legend', { class: 'ecard__title', text: p.nombre || 'Nueva posición' }),
        isNum(p.ref?.valor) && p.ref?.fecha ? (() => {
          const orig = originals.get(p.id), v = orig && !isCash(orig) ? val(orig) : null;
          return h('p', { class: 'ecard__date muted' },
            `Lo que copiaste de MyInvestor el ${fmtDayFull(p.ref.fecha)}.`,
            v && v.ok ? [' Con lo que se ha movido la bolsa desde entonces, ahora vale ', h('strong', { class: 'num', text: eur(v.value) }), ' (lo que ves en Mi cartera).'] : null);
        })() : null,
        h('div', { class: 'ecard__nums' },
          f('Valor en MyInvestor (€)', valor),
          f('Ganancia o pérdida (€)', pnl, 'Con signo menos si pierdes')),
        out,
        h('details', { class: 'ecard__more', open: isNew ? true : null },
          h('summary', { text: 'Más datos' }),
          h('div', { class: 'ecard__grid' },
            f('Nombre', nombre), f('Grupo', grupo), f('Tipo', tipo),
            f('Ticker de referencia', referencia, 'De Yahoo Finance. En fondos, un ETF del mismo índice (por ejemplo EUNL.DE); en acciones, su ticker (SLR.MC)'),
            f('Índice', indice), f('ISIN', isin), f('Nombre oficial', oficial)),
          h('button', { type: 'button', class: 'btn btn--danger btn--small', onclick: () => { sync(); draft.splice(i, 1); paint(); } }, 'Quitar esta posición')),
        err);
      node._read = () => ({ valor: parseEs(valor.value), pnl: parseEs(pnl.value), rawValor: valor.value, rawPnl: pnl.value, nombre: nombre.value.trim(), grupo: grupo.value, tipo: tipo.value, referencia: referencia.value.trim().toUpperCase(), isin: isin.value.trim().toUpperCase(), indice: indice.value.trim(), oficial: oficial.value.trim() });
      node._err = (t) => { err.textContent = t; err.hidden = !t; };
      return node;
    }
    // Copia lo escrito al borrador para no perderlo al añadir o quitar posiciones
    function sync() {
      [...list.querySelectorAll('.ecard')].forEach((c, i) => {
        const r = c._read(), d = draft[i];
        Object.assign(d, { nombre: r.nombre, grupo: r.grupo, tipo: r.tipo, referencia: r.referencia, isin: r.isin, indice: r.indice, oficial: r.oficial, _valor: r.rawValor, _pnl: r.rawPnl });
      });
    }
    function paint() { put(list, draft.map(card)); }
    paint();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.hidden = true;
      const cards = [...list.querySelectorAll('.ecard')];
      let bad = false;
      const next = cards.map((c, i) => {
        const r = c._read(), old = originals.get(draft[i].id) || {};
        if (r.tipo === 'efectivo') { r.referencia = ''; r.pnl = 0; }
        c._err('');
        if (!r.nombre) { c._err('Falta el nombre.'); bad = true; }
        else if (r.tipo !== 'efectivo' && !/^[A-Z0-9.\-=^&]{1,24}$/.test(r.referencia)) { c._err('Falta un ticker de referencia válido (mira «Más datos»).'); bad = true; }
        else if (!isNum(r.valor) || r.valor < 0) { c._err('Escribe el valor que muestra MyInvestor, por ejemplo 139,31.'); bad = true; }
        else if (!isNum(r.pnl) || r.valor - r.pnl < 0) { c._err('Escribe la ganancia o pérdida, por ejemplo -12,87.'); bad = true; }
        return { old, r };
      });
      if (bad) { msg.textContent = 'Revisa las posiciones marcadas.'; msg.hidden = false; return; }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        // Comprueba los tickers nuevos o cambiados antes de guardar
        const newSyms = [...new Set(next.filter(({ old, r }) => r.tipo !== 'efectivo' && (!old.id || old.referencia !== r.referencia)).map(({ r }) => r.referencia))].filter((s) => !S.hist[s]);
        if (newSyms.length) await loadHistory(newSyms);
        const missing = newSyms.filter((s) => !S.hist[s]);
        if (missing.length) {
          cards.forEach((c, i) => { if (missing.includes(next[i].r.referencia)) c._err(`Yahoo no encuentra «${next[i].r.referencia}». Revisa el ticker.`); });
          throw new Error('Algún ticker no existe en Yahoo Finance.');
        }
        try { await refreshLive(); } catch { /* sin precio en directo: se ancla al último cierre */ }
        const today = madridDate();
        const posiciones = next.map(({ old, r }, i) => {
          const p = {
            id: old.id || `${r.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'pos'}-${Date.now().toString(36)}${i}`,
            nombre: r.nombre, oficial: r.oficial, tipo: r.tipo, grupo: r.grupo, isin: r.isin, indice: r.indice, referencia: r.referencia,
            ref: { ...(old.ref || {}) }, invertido: Math.round((r.valor - r.pnl) * 100) / 100,
          };
          const valueChanged = !isNum(old.ref?.valor) || Math.abs(old.ref.valor - r.valor) > 0.004;
          if (r.tipo === 'efectivo') {
            p.ref = { valor: r.valor, fecha: valueChanged ? today : old.ref.fecha, base: valueChanged ? today : old.ref.base };
          } else if (!valueChanged && (old.referencia !== r.referencia || old.tipo !== r.tipo)) {
            // Mismo dato de MyInvestor con otra referencia: se recalcula el anclaje en su fecha
            p.ref = { valor: old.ref.valor, fecha: old.ref.fecha, base: old.ref.base };
          } else if (valueChanged) {
            // Nuevo anclaje: el valor de MyInvestor de hoy frente al precio de referencia que le corresponde
            const hs = S.hist[r.referencia], q = S.live[r.referencia];
            if (r.tipo === 'fondo') {
              const base = (hs && lastDateBefore(hs.closes, today)) || today;
              p.ref = { valor: r.valor, fecha: today, base };
              const a = hs ? closeOnOrBefore(hs.closes, base) : NaN;
              if (isNum(a)) p.ref.precio = a;
            } else {
              p.ref = { valor: r.valor, fecha: today, base: today };
              if (q && isNum(q.price)) p.ref.precio = q.price;
            }
          }
          return p;
        });
        await save({ ...S.doc, posiciones });
        await loadHistory(symbols());
        location.hash = '#cartera';
      } catch (err) {
        msg.textContent = err.message; msg.hidden = false;
      } finally {
        btn.disabled = false; btn.textContent = 'Guardar cambios';
      }
    });

    put(form, list,
      h('button', { type: 'button', class: 'btn', onclick: () => {
        sync();
        draft.push({ nombre: '', tipo: 'fondo', grupo: 'Fondos de inversión', referencia: '', ref: {}, invertido: NaN });
        paint();
        const last = list.lastElementChild; if (last) { last.scrollIntoView({ block: 'center' }); last.querySelector('input')?.focus(); }
      } }, 'Añadir posición'),
      msg,
      h('div', { class: 'editor__bar' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'Guardar cambios'),
        h('a', { class: 'btn btn--ghost', href: '#cartera' }, 'Cancelar')));
    put(el,
      h('a', { class: 'back', href: '#cartera' }, '‹ Mi cartera'),
      h('h1', { class: 'pdetail__title', text: 'Editar cartera' }),
      h('p', { class: 'muted editor__lead', text: 'Aquí están los números que copiaste de MyInvestor, no el valor de ahora. Mi cartera parte de ellos y los mueve con la bolsa, por eso allí ves otras cifras. Cuando quieras ponerla al día, copia de nuevo el valor y la ganancia o pérdida que te enseña MyInvestor.' }),
      form,
      h('button', { type: 'button', class: 'btn btn--ghost btn--small editor__forget', onclick: () => { store.del('clave'); S.clave = ''; S.doc = null; location.hash = '#cartera'; start(); } }, 'Olvidar la clave en este dispositivo'),
    );
  }

  /* ---------- Navegación ---------- */
  function show(view, id) {
    if (S.view === 'cartera' && view !== 'cartera') S.scrollCartera = scrollY;
    const prev = S.view;
    S.view = view; S.detailId = id || null;
    for (const v of ['cartera', 'detalle', 'editar', 'analizar']) $(`#view-${v}`).hidden = v !== view;
    document.querySelectorAll('.tabs__item').forEach((a) => {
      const on = a.dataset.tab === (view === 'analizar' ? 'analizar' : 'cartera');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = view === 'analizar' ? 'Lupa: analizar' : 'Lupa: mi cartera';
    if (view === 'analizar') { window.Analizador?.onShow(); return; }
    if (!S.doc) { if (!S.loading) start(); return; }
    if (view === 'cartera') { renderCartera(); if (prev === 'detalle' || prev === 'editar') requestAnimationFrame(() => scrollTo(0, S.scrollCartera)); else scrollTo(0, 0); }
    else if (view === 'detalle') { renderDetalle(id); scrollTo(0, 0); }
    else if (view === 'editar') { renderEditar(); scrollTo(0, 0); }
  }
  function route() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash === 'analizar') show('analizar');
    else if (hash === 'editar') show('editar');
    else if (hash.startsWith('p-')) show('detalle', hash.slice(2));
    else show('cartera');
  }
  addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.doc && (S.view === 'cartera' || S.view === 'detalle')) show(S.view, S.detailId); });

  // Si se abre con ?s=TICKER (enlace a un análisis), va directo a la pestaña Analizar
  if (new URLSearchParams(location.search).has('s') && !location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#analizar`);
  route();
})();
