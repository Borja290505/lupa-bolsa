/* Lupa — interfaz. Busca el valor, pide los datos al Worker, analiza y pinta cada sección. */
(function () {
  'use strict';
  const { isNum } = TA;
  const F = Lupa.fmt;
  const $ = (sel, r = document) => r.querySelector(sel);

  /* ---------- Utilidades DOM (todo el texto entra con textContent) ---------- */
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
  function sv(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const kid of kids.flat()) if (kid) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  function icon(kind) {
    const paths = {
      buy: 'M5 1.5 9.2 8.5H.8z', sell: 'M5 8.5.8 1.5h8.4z',
      neutral: 'M5 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z', info: 'M4.2 4.2h1.6v4.4H4.2zM4.2 1.6h1.6v1.6H4.2z',
    };
    return sv('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true', class: `ico ico--${kind}` }, sv('path', { d: paths[kind] }));
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('lupa:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lupa:' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  /* ---------- Estado ---------- */
  const state = {
    interval: ['1h', '1d', '1wk'].includes(store.get('interval', '1d')) ? store.get('interval', '1d') : '1d',
    overlays: { ...Object.fromEntries(ChartView.OVERLAYS.map((o) => [o.id, o.on])), ...store.get('overlays', {}) },
    panes: { ...Object.fromEntries(ChartView.PANES.map((p) => [p.id, p.on])), ...store.get('panes', {}) },
    allowShort: !!store.get('allowShort', false),
    recents: store.get('recents', []),
    symbol: null, data: null, A: null, money: null, reqId: 0,
  };

  /* ---------- Formatos ---------- */
  const CUR_NAME = { EUR: 'euros', USD: 'dólares', GBP: 'libras', GBp: 'peniques', JPY: 'yenes', CHF: 'francos suizos', CAD: 'dólares canadienses', HKD: 'dólares de Hong Kong', CNY: 'yuanes' };
  const EXCHANGE_NAME = {
    MCE: 'la Bolsa de Madrid', NMS: 'el Nasdaq', NasdaqGS: 'el Nasdaq', NasdaqGM: 'el Nasdaq', NasdaqCM: 'el Nasdaq', NGM: 'el Nasdaq', NCM: 'el Nasdaq',
    NYQ: 'la Bolsa de Nueva York', NYSE: 'la Bolsa de Nueva York', NYSEArca: 'NYSE Arca', PCX: 'NYSE Arca', ASE: 'NYSE American',
    CMX: 'el COMEX', COMEX: 'el COMEX', NYM: 'el NYMEX', NYMEX: 'el NYMEX', CBT: 'el CBOT', CBOT: 'el CBOT', NYB: 'el ICE', ICE: 'el ICE',
    CCC: 'el mercado de criptomonedas', CCY: 'el mercado de divisas', GER: 'Xetra', XETRA: 'Xetra', PAR: 'Euronext París', Paris: 'Euronext París',
    AMS: 'Euronext Ámsterdam', LSE: 'la Bolsa de Londres', MIL: 'la Bolsa de Milán', SNP: 'el índice S&P', DJI: 'el índice Dow Jones', 'Cboe Indices': 'Cboe',
  };
  const exchangeName = (x) => EXCHANGE_NAME[x] || x;
  const listJoin = (arr) => { try { return new Intl.ListFormat('es', { type: 'conjunction' }).format(arr); } catch { return arr.join(', '); } };
  const TYPE_NAME = { EQUITY: 'Acción', ETF: 'ETF', INDEX: 'Índice', FUTURE: 'Futuro', CRYPTOCURRENCY: 'Criptomoneda', CURRENCY: 'Divisa', MUTUALFUND: 'Fondo' };

  function moneyFmt(d, dec) {
    const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const plain = ['INDEX', 'CURRENCY'].includes(d.type) || !d.currency;
    const sym = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }[d.currency] || d.currency;
    return (x) => (!isNum(x) ? '—' : plain ? nf.format(x) : `${nf.format(x)} ${sym}`);
  }
  const pctTxt = (x) => `${F.signed(x)} %`;
  const dtf = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const df = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

  /* ---------- Búsqueda ---------- */
  const input = $('#q'), list = $('#suggest'), form = $('.search');
  let sug = [], sugIdx = -1, sugTimer = null, sugReq = 0;

  function closeSug() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); sug = []; sugIdx = -1; }
  function showSug(items, title) {
    sug = items; sugIdx = -1;
    list.replaceChildren();
    if (!items.length) return closeSug();
    if (title) list.append(h('li', { class: 'suggest__title', role: 'presentation', text: title }));
    items.forEach((it, k) => {
      list.append(h('li', {
        role: 'option', id: `sug-${k}`, class: 'suggest__item', 'aria-selected': 'false',
        onmousedown: (e) => { e.preventDefault(); pick(it.symbol); },
      }, h('span', { class: 'suggest__name', text: it.name }), h('span', { class: 'suggest__meta', text: [it.symbol, it.where].filter(Boolean).join(', ') })));
    });
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function moveSug(d) {
    if (!sug.length) return;
    sugIdx = (sugIdx + d + sug.length) % sug.length;
    list.querySelectorAll('.suggest__item').forEach((li, k) => li.setAttribute('aria-selected', k === sugIdx ? 'true' : 'false'));
    input.setAttribute('aria-activedescendant', `sug-${sugIdx}`);
  }
  const localSug = (q) => Tickers.search(q, 6).map((it) => ({ symbol: it.s, name: it.n, where: it.g }));

  input.addEventListener('input', () => {
    clearTimeout(sugTimer);
    const q = input.value.trim();
    if (!q) { showRecents(); return; }
    showSug(localSug(q));
    if (q.length >= 2) sugTimer = setTimeout(() => remoteSug(q), 280);
  });
  input.addEventListener('focus', () => { if (!input.value.trim()) showRecents(); });
  input.addEventListener('blur', () => setTimeout(closeSug, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSug(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSug(-1); }
    else if (e.key === 'Escape') closeSug();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sugIdx >= 0 && sug[sugIdx]) return pick(sug[sugIdx].symbol);
    const q = input.value.trim();
    if (!q) return;
    closeSug();
    pick(await resolve(q));
  });

  function showRecents() {
    const items = state.recents.slice(0, 6).map((r) => ({ symbol: r.symbol, name: r.name, where: '' }));
    if (items.length) showSug(items, 'Recientes'); else closeSug();
  }

  async function remoteSug(q) {
    const id = ++sugReq;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!r.ok) return;
      const arr = await r.json();
      if (id !== sugReq || input.value.trim() !== q || document.activeElement !== input) return;
      const merged = [...localSug(q)];
      for (const x of arr) if (!merged.some((m) => m.symbol === x.symbol)) merged.push({ symbol: x.symbol, name: x.name, where: [x.exchange, x.type].filter(Boolean).join(', ') });
      showSug(merged.slice(0, 8));
    } catch { /* sin conexión: se quedan las sugerencias locales */ }
  }

  async function resolve(q) {
    const ex = Tickers.exact(q);
    if (ex) return ex.s;
    const raw = q.trim();
    if (/^[\^A-Za-z0-9.=&-]{1,15}$/.test(raw) && (/[.=^-]/.test(raw) || raw === raw.toUpperCase())) return raw.toUpperCase();
    const local = Tickers.search(q, 1);
    if (local.length) return local[0].s;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(raw)}`);
      if (r.ok) { const arr = await r.json(); if (arr.length) return arr[0].symbol; }
    } catch { /* sigue abajo */ }
    return raw.toUpperCase();
  }

  function pick(symbol) {
    closeSug();
    input.value = '';
    input.blur();
    load(symbol);
  }

  /* ---------- Plazo ---------- */
  const seg = document.querySelectorAll('.seg [data-interval]');
  function paintSeg() { seg.forEach((b) => b.setAttribute('aria-checked', b.dataset.interval === state.interval ? 'true' : 'false')); }
  seg.forEach((b) => b.addEventListener('click', () => {
    if (state.interval === b.dataset.interval) return;
    state.interval = b.dataset.interval; store.set('interval', state.interval); paintSeg();
    if (state.symbol) load(state.symbol);
  }));
  paintSeg();

  /* ---------- Carga de datos ---------- */
  function setLoading(on) {
    document.body.classList.toggle('is-loading', on);
    $('.progress').hidden = !on;
  }
  function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = false; }
  function hideError() { $('#error').hidden = true; }

  async function load(symbol) {
    const id = ++state.reqId;
    setLoading(true); hideError();
    try {
      const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${state.interval}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `El servidor respondió con un error (${res.status}).`);
      if (id !== state.reqId) return;
      const k = body.candles.filter((x, i, a) => i === 0 || x[0] > a[i - 1][0]);
      const series = { t: k.map((x) => x[0]), o: k.map((x) => x[1]), h: k.map((x) => x[2]), l: k.map((x) => x[3]), c: k.map((x) => x[4]), v: k.map((x) => x[5]) };
      const A = Lupa.analyze(series, { interval: state.interval, decimals: body.decimals, type: body.type, gmtoffset: body.gmtoffset });
      state.symbol = body.symbol;
      state.data = { ...body, ...series };
      state.A = A;
      state.money = moneyFmt(body, A.dec);
      addRecent(body.symbol, body.name);
      updateUrl();
      renderReport();
    } catch (err) {
      if (id !== state.reqId) return;
      const msg = err instanceof TypeError ? 'No se puede conectar con el servidor de datos. Revisa tu conexión.' : err.message;
      showError(msg);
    } finally {
      if (id === state.reqId) setLoading(false);
    }
  }

  function addRecent(symbol, name) {
    state.recents = [{ symbol, name }, ...state.recents.filter((r) => r.symbol !== symbol)].slice(0, 10);
    store.set('recents', state.recents);
  }
  function updateUrl() {
    const u = new URL(location.href);
    u.searchParams.set('s', state.symbol); u.searchParams.set('i', state.interval);
    history.replaceState(null, '', u);
  }

  /* ---------- Informe ---------- */
  function renderReport() {
    $('#welcome').hidden = true;
    $('#report').hidden = false;
    document.title = `${state.data.symbol}: análisis técnico en Lupa`;
    renderAsset();
    renderChartTools();
    renderChart();
    renderSummary();
    renderIndicators();
    renderLevels();
    renderPatterns();
    renderPerformance();
    renderBacktest();
    renderConclusion();
  }

  const plan = () => (state.allowShort ? state.A.plans.withShort : state.A.plans.onlyLong);

  function prevCloseInfo() {
    const d = state.data, last = d.c.length - 1, off = d.gmtoffset || 0;
    const dayKey = (ts) => new Date((ts + off) * 1000).toISOString().slice(0, 10);
    const today = dayKey(Date.now() / 1000);
    if (state.interval === '1wk') return { prev: d.c[last - 1], label: 'esta semana' };
    if (state.interval === '1d') return { prev: d.c[last - 1], label: dayKey(d.t[last]) === today ? 'hoy' : 'en la última sesión' };
    let j = last;
    while (j > 0 && dayKey(d.t[j]) === dayKey(d.t[last])) j--;
    return { prev: d.c[j], label: dayKey(d.t[last]) === today ? 'hoy' : 'en la última sesión' };
  }

  function renderAsset() {
    const d = state.data, A = state.A, last = d.c.length - 1, P = d.c[last];
    const { prev, label } = prevCloseInfo();
    const ch = P - prev, chp = (ch / prev) * 100;
    const tone = ch > 0 ? 'buy' : ch < 0 ? 'sell' : 'neutral';
    const tr = A.trend;
    const trTone = tr.dir === 'alcista' ? 'buy' : tr.dir === 'bajista' ? 'sell' : 'neutral';
    const when = d.marketTime ? dtf.format(new Date(d.marketTime * 1000)) : df.format(new Date(d.t[last] * 1000));
    const meta = [TYPE_NAME[d.type] || d.type, d.exchange ? `en ${exchangeName(d.exchange)}` : '', d.currency && CUR_NAME[d.currency] ? `en ${CUR_NAME[d.currency]}` : ''].filter(Boolean).join(' ');
    const local = Tickers.get(d.symbol);
    const display = local && !['EQUITY', 'ETF'].includes(d.type) ? local.n : d.name;
    put($('#asset'),
      h('div', { class: 'asset__id' },
        h('h1', { class: 'asset__name', text: display }),
        h('p', { class: 'asset__meta' }, h('span', { class: 'tag', text: d.symbol }), h('span', { text: meta }))),
      h('div', { class: 'asset__quote' },
        h('p', { class: 'asset__price', text: state.money(P) }),
        h('p', { class: `asset__change tone-${tone}` }, icon(tone), h('span', { class: 'num', text: `${F.signed(ch, (x) => A.fp(x))} (${pctTxt(chp)})` }), h('span', { class: 'muted', text: ` ${label}` })),
        h('p', { class: 'asset__time muted', text: `Último dato: ${when}` })),
      h('div', { class: 'asset__verdict' },
        h('span', { class: `pill tone-${trTone}` }, icon(trTone), `Tendencia ${tr.label.toLowerCase()}`),
        h('a', { class: 'jump', href: '#conclusion', onclick: (e) => { e.preventDefault(); $('#conclusion').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } }, 'Ver entrada y salida')),
    );
  }

  /* ---------- Gráfico ---------- */
  function renderChartTools() {
    const A = state.A;
    const ov = $('#overlay-toggles'), pn = $('#pane-toggles'), rg = $('#ranges');
    put(ov, ...ChartView.OVERLAYS.map((o) => h('button', {
      type: 'button', class: 'chip chip--toggle', 'aria-pressed': state.overlays[o.id] ? 'true' : 'false',
      onclick: () => { state.overlays[o.id] = !state.overlays[o.id]; store.set('overlays', state.overlays); renderChartTools(); renderChart(); },
    }, h('span', { class: `key key--${o.key}`, 'aria-hidden': 'true' }), o.name)));
    put(pn, h('span', { class: 'toggles__label', text: 'Paneles' }), ...ChartView.PANES.filter((p) => !p.needsVol || A.hasVol).map((p) => h('button', {
      type: 'button', class: 'chip chip--toggle chip--small', 'aria-pressed': state.panes[p.id] ? 'true' : 'false',
      onclick: () => { state.panes[p.id] = !state.panes[p.id]; store.set('panes', state.panes); renderChartTools(); renderChart(); },
    }, p.name)));
    put(rg, ...ChartView.rangeKeys(state.interval).map((k) => h('button', {
      type: 'button', class: 'chip chip--small', onclick: () => ChartView.setRange(k),
    }, k === 'Todo' ? 'Todo' : k)));
  }

  function renderChart() {
    ChartView.render($('#chart'), state.data, state.A, { overlays: state.overlays, panes: state.panes, plan: plan() });
    renderReadout(null);
  }

  function renderReadout(i) {
    const d = state.data, A = state.A;
    if (!d) return;
    const last = d.c.length - 1, k = i === null ? last : i;
    const prev = k > 0 ? d.c[k - 1] : d.o[k];
    const chp = ((d.c[k] - prev) / prev) * 100;
    const fp = A.fp;
    const when = new Intl.DateTimeFormat('es-ES', state.interval === '1h' ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date((d.t[k] + (d.gmtoffset || 0)) * 1000));
    const item = (label, value) => h('span', { class: 'ro' }, h('span', { class: 'ro__k', text: label }), h('span', { class: 'ro__v num', text: value }));
    const keyed = (key, label, value) => h('span', { class: 'ro' }, h('span', { class: `key key--${key}`, 'aria-hidden': 'true' }), h('span', { class: 'ro__k', text: label }), h('span', { class: 'ro__v num', text: value }));
    const parts = [
      h('span', { class: 'ro ro--date', text: when }),
      item('Ap.', fp(d.o[k])), item('Máx.', fp(d.h[k])), item('Mín.', fp(d.l[k])), item('Cierre', fp(d.c[k])),
      h('span', { class: `ro tone-${chp >= 0 ? 'buy' : 'sell'}` }, icon(chp >= 0 ? 'buy' : 'sell'), h('span', { class: 'ro__v num', text: pctTxt(chp) })),
    ];
    if (A.hasVol) parts.push(item('Vol.', F.fc(d.v[k])));
    if (state.overlays.ema20 && isNum(A.ind.ema20[k])) parts.push(keyed('s1', 'EMA 20', fp(A.ind.ema20[k])));
    if (state.overlays.sma50 && isNum(A.ind.sma50[k])) parts.push(keyed('s2', 'SMA 50', fp(A.ind.sma50[k])));
    if (state.overlays.sma200 && isNum(A.ind.sma200[k])) parts.push(keyed('ink2', 'SMA 200', fp(A.ind.sma200[k])));
    put($('#readout'), ...parts);
  }
  ChartView.onHover((i) => renderReadout(i));

  /* ---------- Resumen técnico ---------- */
  const toneOf = (s) => (s >= 0.15 ? 'buy' : s <= -0.15 ? 'sell' : 'neutral');

  function renderSummary() {
    const S = state.A.summary;
    const pos = ((Math.max(-1, Math.min(1, S.score)) + 1) / 2) * 100;
    const segs = ['Venta fuerte', 'Venta', 'Neutral', 'Compra', 'Compra fuerte'];
    const active = S.score >= 0.5 ? 4 : S.score >= 0.15 ? 3 : S.score > -0.15 ? 2 : S.score > -0.5 ? 1 : 0;
    put($('#summary'), 
      h('div', { class: 'block__head' }, h('h2', { text: 'Resumen técnico' }), h('p', { class: 'muted', text: `${S.counts.buy + S.counts.sell + S.counts.neutral} indicadores con voto, ponderados por grupo` })),
      h('div', { class: 'summary' },
        h('div', { class: 'summary__verdict' },
          h('p', { class: `summary__label tone-${toneOf(S.score)}` }, icon(toneOf(S.score)), S.label),
          h('p', { class: 'summary__counts' },
            h('strong', { class: 'num', text: S.counts.buy }), ' a favor de comprar, ',
            h('strong', { class: 'num', text: S.counts.sell }), ' de vender y ',
            h('strong', { class: 'num', text: S.counts.neutral }), ' neutrales'),
          h('div', { class: 'gauge', role: 'img', 'aria-label': `Puntuación ${F.f2(S.score)} en una escala de −1 (venta fuerte) a +1 (compra fuerte): ${S.label}` },
            h('div', { class: 'gauge__track' }, segs.map((s, k) => h('span', { class: `gauge__seg gauge__seg--${k}${k === active ? ' is-on' : ''}` }))),
            h('span', { class: 'gauge__mark', style: `left:${pos}%` }),
            h('div', { class: 'gauge__labels', 'aria-hidden': 'true' }, h('span', { text: 'Venta fuerte' }), h('span', { text: 'Neutral' }), h('span', { text: 'Compra fuerte' })))),
        h('div', { class: 'groups' }, state.A.summary.groups.filter((g) => isNum(g.score)).map((g) => {
          const w = Math.min(1, Math.abs(g.score)) * 50;
          return h('div', { class: 'group' },
            h('span', { class: 'group__name', text: g.name }),
            h('span', { class: 'gbar', role: 'img', 'aria-label': `${g.name}: ${g.label} (${F.f2(g.score)})` },
              h('span', { class: `gbar__fill ${g.score >= 0 ? 'gbar__fill--pos' : 'gbar__fill--neg'}`, style: `width:${w}%` })),
            h('span', { class: 'group__val' }, h('span', { class: 'num', text: F.signed(g.score, F.f2) }), ` ${g.label}`));
        }))),
    );
  }

  /* ---------- Indicadores ---------- */
  function sigChip(r) {
    if (r.info) return h('span', { class: 'sig sig--info' }, icon('info'), 'Dato');
    const v = r.vote, kind = v > 0 ? 'buy' : v < 0 ? 'sell' : 'neutral';
    const text = v >= 1 ? 'Compra' : v > 0 ? 'Compra débil' : v <= -1 ? 'Venta' : v < 0 ? 'Venta débil' : 'Neutral';
    return h('span', { class: `sig sig--${kind}${v !== 0 && Math.abs(v) < 1 ? ' sig--soft' : ''}` }, icon(kind), text);
  }

  function renderIndicators() {
    const S = state.A.summary;
    const groups = state.A.groups.map((g) => ({ ...g, rows: S.rows.filter((r) => r.group === g.id), sum: S.groups.find((x) => x.id === g.id) }));
    put($('#indicators'), 
      h('div', { class: 'block__head' }, h('h2', { text: 'Todos los indicadores' }), h('p', { class: 'muted', text: 'Valor actual, señal y lectura de cada uno' })),
      h('div', { class: 'ind-groups' }, groups.filter((g) => g.rows.length).map((g) => h('section', { class: 'ind-group' },
        h('header', { class: 'ind-group__head' }, h('h3', { text: g.name }), g.sum && isNum(g.sum.score) ? h('span', { class: `sig sig--${toneOf(g.sum.score)}` }, icon(toneOf(g.sum.score)), g.sum.label) : null),
        h('div', { class: 'ind-rows', role: 'table', 'aria-label': `Indicadores de ${g.name.toLowerCase()}` },
          h('div', { class: 'ind-row ind-row--head', role: 'row' }, ['Indicador', 'Valor', 'Señal', 'Lectura'].map((t) => h('span', { role: 'columnheader', text: t }))),
          g.rows.map((r) => h('div', { class: 'ind-row', role: 'row' },
            h('span', { class: 'ind-row__name', role: 'rowheader', text: r.name }),
            h('span', { class: 'ind-row__val num', role: 'cell', text: r.value }),
            h('span', { class: 'ind-row__sig', role: 'cell' }, sigChip(r)),
            h('span', { class: 'ind-row__text', role: 'cell', text: r.text }))))))),
    );
  }

  /* ---------- Niveles ---------- */
  function renderLevels() {
    const A = state.A, L = A.levels, d = state.data, P = d.c[d.c.length - 1], m = state.money, cfg = A.cfg;
    const ago = (n) => (n <= 0 ? `en la última ${cfg.bar}` : `hace ${n} ${n === 1 ? cfg.bar : cfg.barPl}`);
    const detail = (x) => (x.extreme && x.touches === 1 ? `extremo del periodo, ${ago(x.ago)}` : `${x.touches} ${x.touches === 1 ? 'toque' : 'toques'}, el último ${ago(x.ago)}`);
    const rows = [
      ...L.resistances.map((r, k) => ({ kind: 'res', name: `Resistencia ${k + 1}`, price: r.price, detail: detail(r) })).reverse(),
      { kind: 'now', name: 'Precio actual', price: P, detail: '' },
      ...L.supports.map((s, k) => ({ kind: 'sup', name: `Soporte ${k + 1}`, price: s.price, detail: detail(s) })),
    ];
    const dist = (p) => pctTxt(((p - P) / P) * 100);
    const f = L.fib, pv = L.pivots;
    const smallTable = (title, caption, items) => h('div', { class: 'mini' }, h('h3', { text: title }), caption ? h('p', { class: 'muted small', text: caption }) : null,
      h('table', { class: 'mini__table' }, h('tbody', items.map(([k, v, cls]) => h('tr', { class: cls || '' }, h('th', { scope: 'row', text: k }), h('td', { class: 'num', text: m(v) }), h('td', { class: 'num muted', text: dist(v) }))))));
    put($('#levels'), 
      h('div', { class: 'block__head' }, h('h2', { text: 'Niveles clave' }), h('p', { class: 'muted', text: 'Zonas donde el precio ha girado antes, de la más alta a la más baja' })),
      h('div', { class: 'levels' },
        h('ol', { class: 'ladder-list' }, rows.map((r) => h('li', { class: `lv lv--${r.kind}` },
          h('span', { class: 'lv__name', text: r.name }),
          h('span', { class: 'lv__price num', text: m(r.price) }),
          h('span', { class: 'lv__dist num muted', text: r.kind === 'now' ? '' : dist(r.price) }),
          h('span', { class: 'lv__detail muted', text: r.detail })))),
        h('div', { class: 'levels__side' },
          f ? smallTable('Fibonacci', `Retrocesos del último tramo ${f.up ? 'alcista' : 'bajista'} (de ${m(f.up ? f.lo : f.hi)} a ${m(f.up ? f.hi : f.lo)})`,
            f.ratios.map((r) => [`${F.f1(r * 100)} %`, f.levels[r]])) : null,
          pv ? smallTable(`Pivotes ${pv.label}`, null, [['R2', pv.R2], ['R1', pv.R1], ['Pivote', pv.P, 'is-pivot'], ['S1', pv.S1], ['S2', pv.S2]]) : null,
          isNum(L.hi52) ? smallTable('Últimas 52 semanas', null, [['Máximo', L.hi52], ['Mínimo', L.lo52]]) : smallTable('Periodo cargado', null, [['Máximo', L.periodHigh], ['Mínimo', L.periodLow]]))),
    );
  }

  /* ---------- Patrones ---------- */
  function renderPatterns() {
    const A = state.A, cfg = A.cfg;
    const when = (n) => (n <= 0 ? `en la última ${cfg.bar}` : `hace ${n} ${n === 1 ? cfg.bar : cfg.barPl}`);
    const item = (p) => h('li', { class: 'pat' }, sigChip({ vote: p.bias }), h('span', { class: 'pat__name', text: p.name }), h('span', { class: 'pat__desc muted', text: `${p.desc}, ${when(p.ago)}.` }));
    put($('#patterns'), 
      h('div', { class: 'block__head' }, h('h2', { text: 'Velas y divergencias' }), h('p', { class: 'muted', text: 'Patrones en las tres últimas velas y desacuerdos entre precio e indicadores' })),
      h('div', { class: 'pats' },
        h('div', {}, h('h3', { text: 'Patrones de velas' }), A.patterns.length ? h('ul', { class: 'pat-list' }, A.patterns.map(item)) : h('p', { class: 'muted', text: 'Ningún patrón destacable en las últimas velas.' })),
        h('div', {}, h('h3', { text: 'Divergencias' }), A.divergences.length ? h('ul', { class: 'pat-list' }, A.divergences.map(item)) : h('p', { class: 'muted', text: 'No hay divergencias recientes: los indicadores acompañan al precio.' }))),
    );
  }

  /* ---------- Rendimiento ---------- */
  function renderPerformance() {
    const P = state.A.perf;
    const max = Math.max(1, ...P.rows.map((r) => Math.abs(r.ret)).filter(isNum));
    const tile = (label, value, note) => h('div', { class: 'tile' }, h('p', { class: 'tile__label', text: label }), h('p', { class: 'tile__value', text: value }), note ? h('p', { class: 'tile__note muted', text: note }) : null);
    const hvLvl = !isNum(P.hvMedian) ? '' : P.hv > P.hvMedian * 1.25 ? 'Alta para este valor' : P.hv < P.hvMedian * 0.8 ? 'Baja para este valor' : 'Normal para este valor';
    put($('#performance'), 
      h('div', { class: 'block__head' }, h('h2', { text: 'Rendimiento y riesgo' })),
      h('div', { class: 'perf' },
        h('div', { class: 'perf__bars', role: 'table', 'aria-label': 'Rentabilidad por periodo' }, P.rows.map((r) => {
          const w = isNum(r.ret) ? (Math.abs(r.ret) / max) * 50 : 0;
          return h('div', { class: 'pbar', role: 'row' },
            h('span', { class: 'pbar__label', role: 'rowheader', text: r.label }),
            h('span', { class: 'gbar', 'aria-hidden': 'true' }, h('span', { class: `gbar__fill ${r.ret >= 0 ? 'gbar__fill--pos' : 'gbar__fill--neg'}`, style: `width:${w}%` })),
            h('span', { class: 'pbar__val num', role: 'cell', text: isNum(r.ret) ? pctTxt(r.ret) : '—' }));
        })),
        h('div', { class: 'tiles' },
          tile(`Caída máxima (${P.ddWindow})`, `${F.f1(P.mdd)} %`, 'Peor bajada desde un máximo'),
          tile('Distancia al máximo', `${F.f1(P.ddNow)} %`, `Respecto al cierre más alto del ${P.ddWindow}`),
          tile('Volatilidad anual', `${F.f0(P.hv)} %`, hvLvl),
          tile(`Movimiento medio por ${state.A.cfg.bar}`, `${F.f1(P.atrPct)} %`, 'ATR de 14 sobre el precio'))),
    );
  }

  /* ---------- Backtest ---------- */
  function renderBacktest() {
    const B = state.A.backtest, d = state.data, m = state.money;
    const el = $('#backtest');
    if (!B) { put(el, h('div', { class: 'block__head' }, h('h2', { text: 'Historial de la señal' })), h('p', { class: 'muted', text: 'No hay historial suficiente para probar la señal en este valor.' })); return; }
    const since = df.format(new Date(B.startTime * 1000));
    const tile = (label, value, note, tone) => h('div', { class: 'tile' }, h('p', { class: 'tile__label', text: label }), h('p', { class: `tile__value${tone ? ` tone-${tone}` : ''}`, text: value }), note ? h('p', { class: 'tile__note muted', text: note }) : null);
    const better = B.totalRet >= B.buyHold;
    let now;
    if (B.open) now = `Ahora mismo la señal está comprada desde el ${df.format(new Date(d.t[B.open.entryI] * 1000))} a ${m(B.open.entry)} (${pctTxt(B.open.ret * 100)}). Su stop móvil está en ${m(B.open.stop)}.`;
    else now = 'Ahora mismo la señal está fuera del mercado.';
    put(el, 
      h('div', { class: 'block__head' }, h('h2', { text: 'Historial de la señal' }), h('p', { class: 'muted', text: `Qué habría pasado siguiendo la puntuación técnica en este valor desde el ${since}` })),
      h('div', { class: 'tiles tiles--4' },
        tile('Operaciones', F.f0(B.closed + (B.open ? 1 : 0)), B.open ? 'Incluye una abierta' : null),
        tile('Aciertos', isNum(B.winRate) ? `${F.f0(B.winRate)} %` : '—', isNum(B.avgWin) ? `Ganancia media ${pctTxt(B.avgWin)}, pérdida media ${pctTxt(B.avgLoss)}` : null),
        tile('Rentabilidad de la señal', pctTxt(B.totalRet), `Comprar y mantener: ${pctTxt(B.buyHold)}`, better ? 'buy' : 'sell'),
        tile('Caída máxima', `${F.f1(B.mdd)} %`, `Comprar y mantener: ${F.f1(B.mddBH)} %`)),
      h('p', { class: 'note', text: now }),
      h('p', { class: 'muted small', text: `Regla: compra cuando la puntuación supera ${F.signed(B.enter, F.f2)} y vende cuando baja de ${F.signed(B.exit, F.f2)} o salta un stop móvil de 3 ATR. Comisión del ${F.f1(B.fee)} % por operación. Está dentro del mercado el ${F.f0(B.exposure)} % del tiempo. Lo que funcionó en el pasado no garantiza nada.` }),
    );
  }

  /* ---------- Conclusión ---------- */
  function ladder(p, P) {
    const m = state.money, col = ChartView.palette();
    const long = p.side === 'long';
    const prices = [p.stop, p.entry, p.zone[0], p.zone[1], p.tp1.price, p.tp2.price, P].filter(isNum);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    const pad = (hi - lo) * 0.07 || hi * 0.01;
    lo -= pad; hi += pad;
    const W = 320, H = 360, x0 = 6, bw = 118, top = 12, bot = H - 12;
    const y = (v) => top + ((hi - v) / (hi - lo)) * (bot - top);
    const g = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ladder', role: 'img', 'aria-label': `Esquema del plan: entrada ${m(p.entry)}, stop ${m(p.stop)}, objetivos ${m(p.tp1.price)} y ${m(p.tp2.price)}, precio actual ${m(P)}` });
    const rect = (a, b, fill) => g.append(sv('rect', { x: x0, y: Math.min(y(a), y(b)), width: bw, height: Math.max(1, Math.abs(y(a) - y(b))), fill, rx: 4 }));
    rect(p.entry, p.tp2.price, ChartView.alpha(col.up, 0.13));
    rect(p.stop, p.entry, ChartView.alpha(col.down, 0.13));
    rect(p.zone[0], p.zone[1], ChartView.alpha(col.accent, 0.22));
    const hl = (v, color, w) => g.append(sv('line', { x1: x0, x2: x0 + bw, y1: y(v), y2: y(v), stroke: color, 'stroke-width': w }));
    hl(p.tp2.price, col.up, 2); hl(p.tp1.price, col.up, 2); hl(p.stop, col.down, 2); hl(p.entry, col.accent, 2.5);
    // precio actual: línea fina y punto con anillo del color de fondo
    g.append(sv('line', { x1: x0, x2: x0 + bw, y1: y(P), y2: y(P), stroke: col.ink, 'stroke-width': 1 }));
    g.append(sv('circle', { cx: x0 + bw - 10, cy: y(P), r: 5, fill: col.ink, stroke: col.surface, 'stroke-width': 2 }));
    // Etiquetas a la derecha, separadas para que no se pisen
    const labels = [
      { v: p.tp2.price, t: 'Objetivo 2' }, { v: p.tp1.price, t: 'Objetivo 1' }, { v: P, t: 'Precio actual' },
      { v: p.entry, t: 'Entrada' }, { v: p.stop, t: 'Stop' },
    ].map((q) => ({ ...q, y0: y(q.v), y: y(q.v) })).sort((a, b) => a.y - b.y);
    const gap = 34;
    for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + gap);
    const over = labels[labels.length - 1].y - (H - 16);
    if (over > 0) { labels[labels.length - 1].y -= over; for (let k = labels.length - 2; k >= 0; k--) labels[k].y = Math.min(labels[k].y, labels[k + 1].y - gap); }
    const lx = x0 + bw + 14;
    for (const q of labels) {
      if (Math.abs(q.y - q.y0) > 2) g.append(sv('path', { d: `M${x0 + bw} ${q.y0} L${lx - 4} ${q.y}`, stroke: col.axis, fill: 'none', 'stroke-width': 1 }));
      g.append(sv('text', { x: lx, y: q.y - 3, class: 'ladder__k' }, q.t));
      g.append(sv('text', { x: lx, y: q.y + 13, class: 'ladder__v' }, m(q.v)));
    }
    return g;
  }

  function planRows(p, compact) {
    const m = state.money, long = p.side === 'long';
    const row = (cls, title, price, sub, note) => h('div', { class: `prow prow--${cls}` },
      h('dt', {}, h('span', { class: `key key--${cls}`, 'aria-hidden': 'true' }), title),
      h('dd', {}, h('strong', { class: 'prow__price', text: m(price) }), sub ? h('span', { class: 'prow__sub num', text: sub }) : null, note && !compact ? h('small', { text: note }) : null));
    const zoneTxt = `zona ${m(p.zone[0])} a ${m(p.zone[1])}`;
    const entryNote = p.kind === 'breakout'
      ? `Solo si una vela cierra ${long ? 'por encima' : 'por debajo'} de ${m(p.trigger)} (${listJoin(p.basis)})`
      : p.basis.length > 1 ? `Coinciden aquí: ${listJoin(p.basis)}` : `${long ? 'Nivel de apoyo' : 'Nivel de freno'}: ${p.basis[0]}`;
    const tpNote = (tp) => (tp.level ? `Un poco antes de este nivel: ${tp.label}` : `Calculado a ${tp.label}`);
    return h('dl', { class: 'prows' },
      row('entry', p.kind === 'breakout' ? 'Entrada en ruptura' : 'Entrada óptima', p.entry, zoneTxt, entryNote),
      row('stop', 'Stop de pérdidas', p.stop, `${long ? '−' : '+'}${F.f1(p.riskPct)} % desde la entrada`, `Colócalo ${p.stopBasis}`),
      row('tp', 'Objetivo 1', p.tp1.price, `${long ? '+' : '−'}${F.f1(p.tp1Pct)} %`, tpNote(p.tp1)),
      row('tp', 'Objetivo 2', p.tp2.price, `${long ? '+' : '−'}${F.f1(p.tp2Pct)} %`, tpNote(p.tp2)),
      h('div', { class: 'prow prow--rr' }, h('dt', { text: 'Riesgo / beneficio' }), h('dd', {}, h('strong', { class: 'prow__price', text: `1 : ${F.f1(p.rr)}` }), h('span', { class: 'prow__sub', text: `hasta el objetivo 1 (1 : ${F.f1(p.rr2)} hasta el 2)` }))),
    );
  }

  function renderConclusion() {
    const A = state.A, P0 = plan(), p = P0.primary, m = state.money, tr = A.trend, d = state.data;
    const P = d.c[d.c.length - 1], long = p.side === 'long';
    const tone = P0.actionTone > 0.25 ? 'buy' : P0.actionTone < -0.25 ? 'sell' : 'neutral';
    const trTone = tr.dir === 'alcista' ? 'buy' : tr.dir === 'bajista' ? 'sell' : 'neutral';
    const dirWord = (x) => (x === 'alcista' ? 'buy' : x === 'bajista' ? 'sell' : 'neutral');
    const S = A.summary;
    const total = S.counts.buy + S.counts.sell + S.counts.neutral;
    const agree = P0.verdictSide > 0 ? `${S.counts.buy} de ${total} indicadores son alcistas.`
      : P0.verdictSide < 0 ? `${S.counts.sell} de ${total} indicadores son bajistas.`
      : `${S.counts.buy} alcistas, ${S.counts.sell} bajistas y ${S.counts.neutral} neutrales: no hay acuerdo claro.`;

    const sideSeg = h('div', { class: 'seg seg--small', role: 'radiogroup', 'aria-label': 'Cómo operas' },
      [[false, 'Solo compro'], [true, 'También en corto']].map(([v, t]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': state.allowShort === v ? 'true' : 'false',
        onclick: () => { if (state.allowShort === v) return; state.allowShort = v; store.set('allowShort', v); renderConclusion(); renderChart(); },
      }, t)));

    const exitLines = [
      `Con beneficio: recoge una parte en el objetivo 1 (${m(p.tp1.price)}) y mueve el stop a tu precio de entrada; el resto, en el objetivo 2 (${m(p.tp2.price)}).`,
      p.trail.useful
        ? `Salida dinámica: si una vela cierra ${long ? 'por debajo' : 'por encima'} ${p.trail.of} (ahora en ${m(p.trail.price)}), sal aunque no haya llegado al objetivo.`
        : `Salida dinámica: cuando ya estés dentro y el precio avance, si una vela cierra ${long ? 'por debajo' : 'por encima'} ${p.trail.of}, sal aunque no haya llegado al objetivo.`,
      `Con pérdida: si toca ${m(p.stop)} se sale sin dudar. La idea ${long ? 'alcista' : 'bajista'} queda anulada.`,
    ];

    const alt = P0.alt;
    put($('#conclusion'), 
      h('div', { class: `ticket__band tone-bg-${tone}`, 'aria-hidden': 'true' }),
      h('div', { class: 'ticket__head' }, h('h2', { text: 'Conclusión' }), sideSeg),
      h('div', { class: 'ticket__top' },
        h('div', { class: 'verdict' },
          h('p', { class: 'verdict__k', text: 'Tendencia' }),
          h('p', { class: `verdict__v tone-${trTone}` }, icon(trTone), tr.label),
          h('ul', { class: 'horizons' }, tr.parts.map((q) => h('li', {}, h('span', { class: 'muted', text: `${q.name} plazo (${q.horizon})` }), h('span', { class: `sig sig--${dirWord(q.dir)}` }, icon(dirWord(q.dir)), q.dir)))),
          h('p', { class: 'muted small', text: `Estructura: ${tr.structureText}. Fuerza (ADX): ${F.f0(tr.adx)}.` })),
        h('div', { class: 'verdict' },
          h('p', { class: 'verdict__k', text: 'Qué hacer' }),
          h('p', { class: `verdict__v tone-${tone}` }, icon(tone), P0.action),
          h('p', { class: 'verdict__why', text: P0.why }),
          h('p', { class: 'muted small', text: `Confianza ${P0.confidence}: ${agree}` }))),
      h('div', { class: 'ticket__perf', 'aria-hidden': 'true' }),
      h('div', { class: 'ticket__body' },
        h('h3', { class: 'ticket__title', text: P0.primaryTitle }),
        h('div', { class: 'ticket__grid' }, h('div', { class: 'ticket__ladder' }, ladder(p, P)), planRows(p, false))),
      h('div', { class: 'ticket__exit' }, h('h3', { text: 'Cómo salir' }), h('ul', {}, exitLines.map((t) => h('li', { text: t })))),
      P0.notes.length ? h('ul', { class: 'ticket__notes' }, P0.notes.map((t) => h('li', { text: t }))) : null,
      alt ? h('details', { class: 'ticket__alt' }, h('summary', { text: P0.altTitle }), planRows(alt, true)) : null,
      h('p', { class: 'ticket__legal', text: 'Lupa calcula estos niveles automáticamente con los indicadores de arriba. Es una herramienta de análisis, no una recomendación de inversión: ningún indicador acierta siempre y se puede perder dinero.' }),
    );
  }

  /* ---------- Bienvenida ---------- */
  function renderWelcome() {
    const groups = Object.entries(Tickers.POPULAR);
    put($('#popular'), ...groups.map(([g, syms]) => h('div', { class: 'pop' },
      h('h2', { class: 'pop__title', text: g }),
      h('div', { class: 'pop__chips' }, syms.map((s) => { const it = Tickers.get(s); return h('button', { type: 'button', class: 'chip', onclick: () => load(s) }, it ? it.n : s); })))));
    const rec = $('#recents');
    if (state.recents.length) {
      rec.hidden = false;
      put(rec, h('h2', { class: 'pop__title', text: 'Vistos hace poco' }), h('div', { class: 'pop__chips' }, state.recents.slice(0, 8).map((r) => h('button', { type: 'button', class: 'chip', onclick: () => load(r.symbol) }, r.name))));
    }
  }

  /* ---------- Arranque ---------- */
  let lastWide = innerWidth >= 640;
  let resizeTimer = null;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { const wide = innerWidth >= 640; if (wide !== lastWide && state.A && !$('#view-analizar').hidden) { lastWide = wide; renderChart(); } }, 200);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.A && !$('#view-analizar').hidden) { renderChart(); renderConclusion(); } });

  // API para el resto de la app (la pestaña "Mi cartera" abre aquí el análisis de cada valor)
  window.Analizador = {
    load: (symbol, interval) => {
      if (['1h', '1d', '1wk'].includes(interval) && interval !== state.interval) { state.interval = interval; store.set('interval', interval); paintSeg(); }
      return load(String(symbol).toUpperCase());
    },
    onShow: () => {
      if (state.A) { renderChart(); renderConclusion(); } else renderWelcome();
    },
  };

  renderWelcome();
  const params = new URLSearchParams(location.search);
  const qi = params.get('i');
  if (['1h', '1d', '1wk'].includes(qi)) { state.interval = qi; paintSeg(); }
  const qs = params.get('s');
  const start = () => { if (qs) load(qs.toUpperCase()); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start, start); else start();
})();
