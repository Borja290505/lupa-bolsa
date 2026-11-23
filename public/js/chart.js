/* Lupa — gráfico (TradingView Lightweight Charts v5).
 * Velas + medias + bandas + niveles del plan, y paneles inferiores (RSI, MACD…).
 */
(function (root) {
  'use strict';
  const LWC = root.LightweightCharts;
  const { isNum } = root.TA;

  const OVERLAYS = [
    { id: 'ema20', name: 'EMA 20', key: 's1', on: true },
    { id: 'sma50', name: 'SMA 50', key: 's2', on: true },
    { id: 'sma200', name: 'SMA 200', key: 'ink2', on: true },
    { id: 'bb', name: 'Bollinger', key: 'muted', on: false },
    { id: 'ichi', name: 'Ichimoku', key: 'cloud', on: false },
    { id: 'sar', name: 'SAR', key: 'dots', on: false },
    { id: 'st', name: 'Supertrend', key: 'updown', on: false },
    { id: 'levels', name: 'Soportes y resistencias', key: 'level', on: true },
    { id: 'plan', name: 'Entrada y salida', key: 'plan', on: true },
    { id: 'signals', name: 'Señales pasadas', key: 'marker', on: false },
  ];
  const PANES = [
    { id: 'rsi', name: 'RSI', on: true },
    { id: 'macd', name: 'MACD', on: true },
    { id: 'stoch', name: 'Estocástico', on: false },
    { id: 'adx', name: 'ADX', on: false },
    { id: 'obv', name: 'OBV', on: false, needsVol: true },
    { id: 'score', name: 'Puntuación', on: false },
  ];

  /* ---------- Colores desde las variables CSS ---------- */
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return {
      surface: g('--surface'), ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'), grid: g('--grid'),
      axis: g('--axis'), up: g('--up'), down: g('--down'), s1: g('--series-1'), s2: g('--series-2'), accent: g('--accent'),
    };
  }
  function alpha(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /* ---------- Serie personalizada: relleno entre dos líneas (nube, bandas) ---------- */
  class BandSeries {
    constructor() { this._d = null; this._o = null; }
    priceValueBuilder(row) { return [row.b, row.a, (row.a + row.b) / 2]; }
    isWhitespace(row) { return !isNum(row.a) || !isNum(row.b); }
    renderer() { return this; }
    update(data, options) { this._d = data; this._o = options; }
    defaultOptions() { return { ...LWC.customSeriesDefaultOptions, upFill: 'rgba(0,0,0,0.06)', downFill: 'rgba(0,0,0,0.06)' }; }
    draw(target, priceToCoordinate) {
      const d = this._d, o = this._o;
      if (!d || !d.visibleRange || !d.bars.length) return;
      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context, hr = scope.horizontalPixelRatio, vr = scope.verticalPixelRatio;
        const from = Math.max(0, d.visibleRange.from - 1), to = Math.min(d.bars.length, d.visibleRange.to + 1);
        let run = null;
        const flush = () => {
          if (run && run.pts.length > 1) {
            ctx.fillStyle = run.fill;
            ctx.beginPath();
            run.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.a) : ctx.moveTo(p.x, p.a)));
            for (let k = run.pts.length - 1; k >= 0; k--) ctx.lineTo(run.pts[k].x, run.pts[k].b);
            ctx.closePath();
            ctx.fill();
          }
          run = null;
        };
        for (let i = from; i < to; i++) {
          const bar = d.bars[i], row = bar.originalData;
          if (this.isWhitespace(row)) { flush(); continue; }
          const ya = priceToCoordinate(row.a), yb = priceToCoordinate(row.b);
          if (ya === null || yb === null) { flush(); continue; }
          const pt = { x: bar.x * hr, a: ya * vr, b: yb * vr };
          const fill = row.a >= row.b ? o.upFill : o.downFill;
          if (run && run.fill !== fill) { run.pts.push(pt); flush(); }
          if (!run) run = { fill, pts: [] };
          run.pts.push(pt);
        }
        flush();
      });
    }
  }

  /* ---------- Estado del gráfico ---------- */
  let chart = null, host = null, ctx = null, onHover = null;

  function toTimeFactory(interval, gmtoffset) {
    if (interval === '1h') return (ts) => ts + gmtoffset;
    return (ts) => new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10);
  }

  function timeLabel(time, interval) {
    let d;
    if (typeof time === 'number') d = new Date(time * 1000);
    else if (typeof time === 'string') d = new Date(time + 'T00:00:00Z');
    else if (time && time.year) d = new Date(Date.UTC(time.year, time.month - 1, time.day));
    else return '';
    const opts = interval === '1h'
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
    return new Intl.DateTimeFormat('es-ES', opts).format(d);
  }

  function render(el, data, A, opts) {
    host = el;
    const prevRange = chart && ctx && ctx.symbol === data.symbol && ctx.interval === data.interval ? chart.timeScale().getVisibleLogicalRange() : null;
    destroy();
    const col = palette();
    const mobile = el.clientWidth < 640;
    const panes = PANES.filter((p) => opts.panes[p.id] && (!p.needsVol || A.hasVol));
    const base = mobile ? 300 : 400, paneH = mobile ? 92 : 116;
    el.style.height = `${base + panes.length * paneH}px`;

    const fmtPrice = (p) => A.fp(p);
    const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
    const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const compact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

    chart = LWC.createChart(el, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: col.surface }, textColor: col.muted,
        fontFamily: 'Archivo, system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: col.grid, separatorHoverColor: col.axis, enableResize: false },
      },
      grid: { vertLines: { color: col.grid }, horzLines: { color: col.grid } },
      rightPriceScale: { borderColor: col.axis },
      timeScale: { borderColor: col.axis, timeVisible: data.interval === '1h', secondsVisible: false, rightOffset: 6, minBarSpacing: 1.5 },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: col.muted, width: 1, style: LWC.LineStyle.Solid, labelBackgroundColor: col.ink2 },
        horzLine: { color: col.muted, width: 1, style: LWC.LineStyle.Solid, labelBackgroundColor: col.ink2 },
      },
      localization: { locale: 'es-ES', timeFormatter: (t) => timeLabel(t, data.interval) },
      handleScroll: { vertTouchDrag: false },
    });

    const toTime = toTimeFactory(data.interval, data.gmtoffset || 0);
    const times = data.t.map(toTime);
    const pt = (arr) => arr.map((v, i) => (isNum(v) ? { time: times[i], value: v } : { time: times[i] }));
    const priceFmt = { type: 'custom', formatter: fmtPrice, minMove: 1 / 10 ** A.dec };
    const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    const ind = A.ind;

    // Velas: las alcistas huecas y las bajistas rellenas (se distinguen también sin color)
    // El autoescalado incluye los niveles del plan cuando se está viendo la parte final del gráfico
    const planLv = opts.overlays.plan && opts.plan ? [opts.plan.primary.entry, opts.plan.primary.stop, opts.plan.primary.tp1.price, opts.plan.primary.tp2.price].filter(isNum) : [];
    const lastIdx = data.c.length - 1;
    const candle = chart.addSeries(LWC.CandlestickSeries, {
      upColor: alpha(col.surface, 0), downColor: col.down, borderUpColor: col.up, borderDownColor: col.down,
      wickUpColor: col.up, wickDownColor: col.down, borderVisible: true, priceFormat: priceFmt,
      priceLineColor: col.ink2, priceLineWidth: 1, priceLineStyle: LWC.LineStyle.Dotted,
      autoscaleInfoProvider: (orig) => {
        const r = orig();
        if (!r || !planLv.length || !chart) return r;
        const vr = chart.timeScale().getVisibleLogicalRange();
        if (!vr || vr.to < lastIdx - 3) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...planLv), maxValue: Math.max(r.priceRange.maxValue, ...planLv) } };
      },
    });
    candle.setData(data.t.map((_, i) => ({ time: times[i], open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i] })));
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: A.hasVol ? 0.2 : 0.06 } });

    if (A.hasVol) {
      const vol = chart.addSeries(LWC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, ...quiet });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
      vol.setData(data.t.map((_, i) => ({ time: times[i], value: data.v[i], color: alpha(data.c[i] >= data.o[i] ? col.up : col.down, 0.32) })));
    }

    const series = { candle };
    const line = (arr, color, width = 2, extra = {}, pane = 0) => {
      const s = chart.addSeries(LWC.LineSeries, { color, lineWidth: width, priceFormat: priceFmt, ...quiet, ...extra }, pane);
      s.setData(pt(arr));
      return s;
    };

    const ov = opts.overlays;
    if (ov.bb) {
      const band = chart.addCustomSeries(new BandSeries(), { upFill: alpha(col.ink2, 0.06), downFill: alpha(col.ink2, 0.06), ...quiet });
      band.setData(data.t.map((_, i) => (isNum(ind.bb.upper[i]) ? { time: times[i], a: ind.bb.upper[i], b: ind.bb.lower[i] } : { time: times[i] })));
      series.bbU = line(ind.bb.upper, alpha(col.muted, 0.9), 1);
      series.bbL = line(ind.bb.lower, alpha(col.muted, 0.9), 1);
    }
    if (ov.ichi) {
      const cloud = chart.addCustomSeries(new BandSeries(), { upFill: alpha(col.up, 0.12), downFill: alpha(col.down, 0.12), ...quiet });
      cloud.setData(data.t.map((_, i) => (isNum(ind.ichi.cloudA[i]) && isNum(ind.ichi.cloudB[i]) ? { time: times[i], a: ind.ichi.cloudA[i], b: ind.ichi.cloudB[i] } : { time: times[i] })));
      series.kijun = line(ind.ichi.kijun, col.ink2, 1);
    }
    if (ov.ema20) series.ema20 = line(ind.ema20, col.s1);
    if (ov.sma50) series.sma50 = line(ind.sma50, col.s2);
    if (ov.sma200) series.sma200 = line(ind.sma200, col.ink2);
    if (ov.sar) {
      const s = chart.addSeries(LWC.LineSeries, { color: col.ink2, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.6, priceFormat: priceFmt, ...quiet });
      s.setData(data.t.map((_, i) => (isNum(ind.sar.sar[i]) ? { time: times[i], value: ind.sar.sar[i], color: ind.sar.dir[i] > 0 ? col.up : col.down } : { time: times[i] })));
      series.sar = s;
    }
    if (ov.st) {
      const s = chart.addSeries(LWC.LineSeries, { color: col.up, lineWidth: 2, priceFormat: priceFmt, ...quiet });
      s.setData(data.t.map((_, i) => {
        const v = ind.st.line[i], d = ind.st.dir[i];
        if (!isNum(v) || (i > 0 && ind.st.dir[i - 1] !== d)) return { time: times[i] };
        return { time: times[i], value: v, color: d > 0 ? col.up : col.down };
      }));
      series.st = s;
    }

    // Niveles horizontales
    const plan = opts.plan;
    if (ov.levels) {
      A.levels.resistances.slice(0, 3).forEach((r, k) => candle.createPriceLine({ price: r.price, color: alpha(col.ink2, 0.55), lineWidth: 1, lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: false, title: `R${k + 1}` }));
      A.levels.supports.slice(0, 3).forEach((s, k) => candle.createPriceLine({ price: s.price, color: alpha(col.ink2, 0.55), lineWidth: 1, lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: false, title: `S${k + 1}` }));
    }
    if (ov.plan && plan) {
      const p = plan.primary;
      const pl = (price, color, title) => candle.createPriceLine({ price, color, lineWidth: 2, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title });
      pl(p.entry, col.accent, 'Entrada');
      pl(p.stop, col.down, 'Stop');
      pl(p.tp1.price, col.up, 'Objetivo 1');
      pl(p.tp2.price, col.up, 'Objetivo 2');
    }
    if (ov.signals && A.backtest) {
      const mk = [];
      for (const tr of A.backtest.trades) {
        mk.push({ time: times[tr.entryI], position: 'belowBar', color: col.up, shape: 'arrowUp', text: 'C' });
        mk.push({ time: times[tr.exitI], position: 'aboveBar', color: col.down, shape: 'arrowDown', text: 'V' });
      }
      if (A.backtest.open) mk.push({ time: times[A.backtest.open.entryI], position: 'belowBar', color: col.up, shape: 'arrowUp', text: 'C' });
      mk.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      LWC.createSeriesMarkers(candle, mk);
    }

    // Paneles inferiores
    const fixed = (min, max) => ({ autoscaleInfoProvider: () => ({ priceRange: { minValue: min, maxValue: max } }) });
    const fmt0 = { type: 'custom', formatter: (p) => nf0.format(p), minMove: 1 };
    panes.forEach((p, k) => {
      const idx = k + 1;
      if (p.id === 'rsi') {
        const s = line(ind.rsi, col.s1, 2, { priceFormat: fmt0, lastValueVisible: true, title: 'RSI', ...fixed(0, 100) }, idx);
        s.createPriceLine({ price: 70, color: col.axis, lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: col.axis, lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: false });
        series.rsi = s;
      } else if (p.id === 'macd') {
        const hist = chart.addSeries(LWC.HistogramSeries, { priceFormat: priceFmt, ...quiet }, idx);
        hist.setData(data.t.map((_, i) => {
          const v = ind.macd.hist[i];
          if (!isNum(v)) return { time: times[i] };
          const grow = i > 0 && Math.abs(v) >= Math.abs(ind.macd.hist[i - 1]);
          return { time: times[i], value: v, color: alpha(v >= 0 ? col.up : col.down, grow ? 0.55 : 0.28) };
        }));
        series.macd = line(ind.macd.line, col.s1, 2, { lastValueVisible: true, title: 'MACD' }, idx);
        series.macdSig = line(ind.macd.signal, col.s2, 2, {}, idx);
      } else if (p.id === 'stoch') {
        series.stochK = line(ind.stoch.k, col.s1, 2, { priceFormat: fmt0, lastValueVisible: true, title: 'Estoc.', ...fixed(0, 100) }, idx);
        series.stochD = line(ind.stoch.d, col.s2, 2, { priceFormat: fmt0, ...fixed(0, 100) }, idx);
        series.stochK.createPriceLine({ price: 80, color: col.axis, lineWidth: 1, axisLabelVisible: false });
        series.stochK.createPriceLine({ price: 20, color: col.axis, lineWidth: 1, axisLabelVisible: false });
      } else if (p.id === 'adx') {
        series.adx = line(ind.dmi.adx, col.ink, 2, { priceFormat: fmt0, lastValueVisible: true, title: 'ADX' }, idx);
        series.pdi = line(ind.dmi.plus, col.up, 1, { priceFormat: fmt0 }, idx);
        series.mdi = line(ind.dmi.minus, col.down, 1, { priceFormat: fmt0 }, idx);
        series.adx.createPriceLine({ price: 25, color: col.axis, lineWidth: 1, axisLabelVisible: false });
      } else if (p.id === 'obv') {
        const f = { type: 'custom', formatter: (v) => compact.format(v), minMove: 1 };
        series.obv = line(ind.obv, col.s1, 2, { priceFormat: f, lastValueVisible: true, title: 'OBV' }, idx);
        series.obvSma = line(ind.obvSma, col.s2, 1, { priceFormat: f }, idx);
      } else if (p.id === 'score') {
        const sc = A.backtest ? A.backtest.score : [];
        const h = chart.addSeries(LWC.HistogramSeries, { priceFormat: { type: 'custom', formatter: (v) => nf2.format(v), minMove: 0.01 }, ...quiet, lastValueVisible: true, title: 'Puntuación', ...fixed(-1, 1) }, idx);
        h.setData(data.t.map((_, i) => (isNum(sc[i]) ? { time: times[i], value: sc[i], color: alpha(sc[i] >= 0 ? col.up : col.down, 0.5) } : { time: times[i] })));
        series.score = h;
      }
    });
    const allPanes = chart.panes();
    if (allPanes.length > 1) {
      allPanes[0].setStretchFactor(base / paneH);
      for (let k = 1; k < allPanes.length; k++) allPanes[k].setStretchFactor(1);
    }

    ctx = { symbol: data.symbol, interval: data.interval, times, series, data, A, col };

    if (prevRange) chart.timeScale().setVisibleLogicalRange(prevRange);
    else setRange(opts.range || 'default');

    chart.subscribeCrosshairMove((param) => {
      if (!onHover) return;
      const i = param && isNum(param.logical) && param.point ? Math.round(param.logical) : null;
      onHover(i !== null && i >= 0 && i < data.c.length ? i : null);
    });
  }

  function rangeBars(key) {
    if (!ctx) return null;
    const t = ctx.data.t, last = t.length - 1, day = 86400;
    const days = { '1S': 7, '1M': 31, '3M': 92, '6M': 183, '1A': 366, '3A': 1096, '5A': 1827 }[key];
    if (!days) return null;
    const from = t[last] - days * day;
    let i = last;
    while (i > 0 && t[i - 1] >= from) i--;
    return i;
  }

  function setRange(key) {
    if (!chart || !ctx) return;
    const last = ctx.data.t.length - 1;
    if (key === 'default') key = ctx.interval === '1h' ? '1M' : ctx.interval === '1wk' ? '5A' : '1A';
    if (key === 'Todo') { chart.timeScale().fitContent(); return; }
    const i = rangeBars(key);
    if (i === null) return;
    chart.timeScale().setVisibleLogicalRange({ from: i - 0.5, to: last + 6 });
  }

  function destroy() {
    if (chart) { chart.remove(); chart = null; }
    ctx = null;
  }

  root.ChartView = {
    OVERLAYS, PANES, render, setRange, destroy, palette, alpha,
    onHover: (fn) => { onHover = fn; },
    rangeKeys: (interval) => (interval === '1h' ? ['1S', '1M', 'Todo'] : interval === '1wk' ? ['1A', '3A', '5A', 'Todo'] : ['3M', '6M', '1A', 'Todo']),
    defaultRange: (interval) => (interval === '1h' ? '1M' : interval === '1wk' ? '5A' : '1A'),
  };
})(typeof window !== 'undefined' ? window : globalThis);
