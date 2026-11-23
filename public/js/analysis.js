/* Lupa — motor de análisis.
 * Puntúa cada indicador (compra / neutral / venta), deduce la tendencia, busca soportes y
 * resistencias, calcula un plan de entrada y salida y hace un backtest sencillo de la señal.
 */
(function (root) {
  'use strict';
  const TA = root.TA || (typeof require !== 'undefined' ? require('./indicators.js') : null);
  const { isNum } = TA;

  /* ---------- Configuración por marco temporal ---------- */
  const CFG = {
    '1h': { ppy: 1638, ppyCrypto: 8760, swingK: 3, srLookback: 700, fibLookback: 160, pivot: 'day', pivotLabel: 'del día anterior', horizons: ['horas', 'días', 'semanas'], bar: 'hora', barPl: 'horas' },
    '1d': { ppy: 252, ppyCrypto: 365, swingK: 4, srLookback: 300, fibLookback: 126, pivot: 'month', pivotLabel: 'del mes anterior', horizons: ['días', 'semanas', 'meses'], bar: 'sesión', barPl: 'sesiones' },
    '1wk': { ppy: 52, ppyCrypto: 52, swingK: 3, srLookback: 260, fibLookback: 104, pivot: 'year', pivotLabel: 'del año anterior', horizons: ['semanas', 'meses', 'años'], bar: 'semana', barPl: 'semanas' },
  };

  const GROUPS = [
    { id: 'tendencia', name: 'Tendencia', w: 0.45 },
    { id: 'momento', name: 'Momento', w: 0.30 },
    { id: 'volumen', name: 'Volumen', w: 0.15 },
    { id: 'volatilidad', name: 'Volatilidad', w: 0.10 },
  ];

  /* ---------- Utilidades ---------- */
  const nf = (d) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);
  const minus = (s) => s.replace(/^-/, '−');
  const f0 = (x) => (isNum(x) ? minus(NF0.format(x)) : '—');
  const f1 = (x) => (isNum(x) ? minus(NF1.format(x)) : '—');
  const f2 = (x) => (isNum(x) ? minus(NF2.format(x)) : '—');
  const signed = (x, fmt = f1) => (isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x)) : '—');
  const compact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
  const fc = (x) => (isNum(x) ? (x < 0 ? '−' : '') + compact.format(Math.abs(x)) : '—');
  const pct = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? (a / b - 1) * 100 : NaN);
  const sg = (x) => (isNum(x) ? Math.sign(x) : NaN);
  const mean = (arr) => { const v = arr.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  const median = (arr) => { const v = arr.filter(isNum).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };

  function guessDecimals(price) {
    if (!isNum(price)) return 2;
    if (price >= 1) return 2;
    if (price >= 0.1) return 4;
    if (price >= 0.001) return 5;
    return 8;
  }

  /* ---------- Punto de entrada ---------- */
  function analyze(series, meta = {}) {
    const { t, o, h, l, c, v } = series;
    const N = c.length;
    if (N < 60) throw new Error('Hay muy pocas velas para analizar este valor (hacen falta al menos 60).');
    const interval = CFG[meta.interval] ? meta.interval : '1d';
    const cfg = CFG[interval];
    const crypto = meta.type === 'CRYPTOCURRENCY';
    const ppy = crypto ? cfg.ppyCrypto : cfg.ppy;
    const dec = isNum(meta.decimals) ? Math.max(meta.decimals, guessDecimals(c[N - 1])) : guessDecimals(c[N - 1]);
    const priceNF = nf(dec);
    const fp = meta.formatPrice || ((x) => (isNum(x) ? minus(priceNF.format(x)) : '—'));
    const volBars = v.filter((x) => x > 0).length;
    const hasVol = volBars / N > 0.8;
    const last = N - 1;

    const ind = {
      ema9: TA.ema(c, 9), ema20: TA.ema(c, 20), sma20: TA.sma(c, 20), sma50: TA.sma(c, 50),
      sma100: TA.sma(c, 100), sma200: TA.sma(c, 200),
      macd: TA.macd(c), rsi: TA.rsi(c, 14), stoch: TA.stochastic(h, l, c), stochRsi: TA.stochRsi(c),
      willr: TA.williamsR(h, l, c), cci: TA.cci(h, l, c), roc: TA.roc(c, 12), mom: TA.momentum(c, 10),
      dmi: TA.dmi(h, l, c), atr: TA.atr(h, l, c, 14), bb: TA.bollinger(c), kc: TA.keltner(h, l, c),
      dc: TA.donchian(h, l), sar: TA.psar(h, l), st: TA.supertrend(h, l, c, 10, 3),
      ichi: TA.ichimoku(h, l), aroon: TA.aroon(h, l, 25), hv: TA.histVol(c, 20, ppy),
    };
    const sh = ind.ichi.shift;
    ind.ichi.cloudA = c.map((_, i) => (i - sh >= 0 ? ind.ichi.spanA[i - sh] : NaN));
    ind.ichi.cloudB = c.map((_, i) => (i - sh >= 0 ? ind.ichi.spanB[i - sh] : NaN));
    if (hasVol) {
      ind.obv = TA.obv(c, v); ind.obvSma = TA.sma(ind.obv, 20); ind.mfi = TA.mfi(h, l, c, v);
      ind.cmf = TA.cmf(h, l, c, v); ind.vwap = TA.vwapRolling(h, l, c, v, 20); ind.volSma = TA.sma(v, 20);
    }
    // Último cruce de las medias 50/200 (índice de la vela donde cambió el orden)
    ind.crossIdx = new Array(N).fill(-1);
    for (let i = 1; i < N; i++) {
      const a = ind.sma50[i] - ind.sma200[i], b = ind.sma50[i - 1] - ind.sma200[i - 1];
      ind.crossIdx[i] = isNum(a) && isNum(b) && Math.sign(a) !== Math.sign(b) ? i : ind.crossIdx[i - 1];
    }

    const sw = TA.swings(h, l, cfg.swingK);
    const x = { t, o, h, l, c, v, N, last, ind, hasVol, cfg, fp, dec, meta, ppy, sw, interval };
    x.B = (n) => `${n} ${n === 1 ? cfg.bar : cfg.barPl}`;
    x.ago = (n) => (n <= 0 ? `en la última ${cfg.bar}` : `hace ${x.B(n)}`);

    const checks = buildChecks(x);
    const summary = summarize(checks, last);
    const trend = trendAt(x, last);
    const levels = findLevels(x);
    const patterns = candlePatterns(x);
    const divergences = findDivergences(x);
    const perf = performance(x);
    const plans = {
      onlyLong: buildPlan(x, summary, trend, levels, false),
      withShort: buildPlan(x, summary, trend, levels, true),
    };
    const backtest = runBacktest(x, checks);

    return { ind, hasVol, interval, cfg, dec, fp, summary, trend, levels, patterns, divergences, perf, plans, backtest, groups: GROUPS };
  }

  /* ---------- Indicadores con voto ---------- */
  function buildChecks(x) {
    const { o, h, l, c, v, ind, hasVol, fp, B } = x;
    const list = [];
    const add = (group, id, name, w, f) => list.push({ group, id, name, w, f });

    // --- Tendencia ---
    const maCheck = (arr, slopeN) => (i) => {
      const m = arr[i], m0 = arr[i - slopeN];
      if (!isNum(m) || !isNum(m0)) return null;
      const up = m > m0, above = c[i] > m;
      const vote = above ? (up ? 1 : 0.5) : (up ? -0.5 : -1);
      return { vote, value: fp(m), text: `Precio ${f1(Math.abs(pct(c[i], m)))} % ${above ? 'por encima' : 'por debajo'}; la media ${up ? 'sube' : 'baja'}` };
    };
    add('tendencia', 'ema20', 'Media exponencial 20', 1, maCheck(ind.ema20, 5));
    add('tendencia', 'sma50', 'Media simple 50', 1.25, maCheck(ind.sma50, 10));
    add('tendencia', 'sma200', 'Media simple 200', 1.5, maCheck(ind.sma200, 20));

    add('tendencia', 'cruce', 'Cruce de medias 50 y 200', 1, (i) => {
      const a = ind.sma50[i], b = ind.sma200[i];
      if (!isNum(a) || !isNum(b)) return null;
      const up = a > b, k = ind.crossIdx[i], agoN = k >= 0 ? i - k : -1;
      let text;
      if (agoN >= 0 && agoN <= 40) text = `${up ? 'Cruce dorado' : 'Cruce de la muerte'} ${x.ago(agoN)}`;
      else text = up ? 'La media de 50 está por encima de la de 200' : 'La media de 50 está por debajo de la de 200';
      return { vote: up ? 1 : -1, value: up ? 'Alcista' : 'Bajista', text };
    });

    add('tendencia', 'macd', 'MACD (12, 26, 9)', 1.25, (i) => {
      const m = ind.macd.line[i], s = ind.macd.signal[i];
      if (!isNum(m) || !isNum(s)) return null;
      const above = m > s;
      let cross = '';
      for (let k = 1; k <= 3; k++) {
        const pm = ind.macd.line[i - k], ps = ind.macd.signal[i - k];
        if (isNum(pm) && isNum(ps) && (pm > ps) !== above) { cross = `; cruce ${above ? 'alcista' : 'bajista'} ${x.ago(k - 1)}`; break; }
      }
      const vote = above ? (m > 0 ? 1 : 0.5) : (m < 0 ? -1 : -0.5);
      return { vote, value: fp(m), text: `Línea ${above ? 'por encima' : 'por debajo'} de la señal, en zona ${m > 0 ? 'positiva' : 'negativa'}${cross}` };
    });

    add('tendencia', 'adx', 'ADX y DMI (14)', 1.25, (i) => {
      const a = ind.dmi.adx[i], p = ind.dmi.plus[i], m = ind.dmi.minus[i];
      if (!isNum(a) || !isNum(ind.dmi.adx[i - 3])) return null;
      const dir = p > m ? 1 : -1, rising = a > ind.dmi.adx[i - 3];
      const vote = dir * (a < 20 ? 0 : a < 25 ? 0.5 : 1);
      const di = `+DI ${f0(p)} frente a −DI ${f0(m)}`;
      const text = a < 20 ? `Sin tendencia clara (${di})` : `Tendencia ${dir > 0 ? 'alcista' : 'bajista'} ${rising ? 'ganando' : 'perdiendo'} fuerza (${di})`;
      return { vote, value: f0(a), text };
    });

    add('tendencia', 'sar', 'SAR parabólico', 0.75, (i) => {
      const s = ind.sar.sar[i], d = ind.sar.dir[i];
      if (!isNum(s)) return null;
      let k = 0;
      while (k < 30 && ind.sar.dir[i - k - 1] === d) k++;
      const flip = k < 5 ? `; giró ${x.ago(k)}` : '';
      return { vote: d, value: fp(s), text: `Puntos ${d > 0 ? 'por debajo del precio' : 'por encima del precio'}${flip}` };
    });

    add('tendencia', 'supertrend', 'Supertrend (10, 3)', 1, (i) => {
      const s = ind.st.line[i], d = ind.st.dir[i];
      if (!isNum(s)) return null;
      let k = 0;
      while (k < 30 && ind.st.dir[i - k - 1] === d) k++;
      const flip = k < 5 ? `; cambió ${x.ago(k)}` : '';
      return { vote: d, value: fp(s), text: `${d > 0 ? 'Alcista: la línea hace de soporte' : 'Bajista: la línea hace de resistencia'}${flip}` };
    });

    add('tendencia', 'ichimoku', 'Ichimoku (9, 26, 52)', 1, (i) => {
      const A = ind.ichi.cloudA[i], Bv = ind.ichi.cloudB[i], tk = ind.ichi.tenkan[i], kj = ind.ichi.kijun[i];
      if (!isNum(A) || !isNum(Bv) || !isNum(tk) || !isNum(kj)) return null;
      const top = Math.max(A, Bv), bot = Math.min(A, Bv);
      const pos = c[i] > top ? 1 : c[i] < bot ? -1 : 0;
      const tkUp = tk > kj;
      const vote = pos === 1 ? (tkUp ? 1 : 0.5) : pos === -1 ? (tkUp ? -0.5 : -1) : 0;
      const fA = ind.ichi.spanA[i], fB = ind.ichi.spanB[i];
      const fut = isNum(fA) && isNum(fB) ? `; nube futura ${fA > fB ? 'alcista' : 'bajista'}` : '';
      const where = pos === 1 ? 'por encima de' : pos === -1 ? 'por debajo de' : 'dentro de';
      return { vote, value: pos === 1 ? 'Sobre la nube' : pos === -1 ? 'Bajo la nube' : 'En la nube', text: `Precio ${where} la nube; Tenkan ${tkUp ? 'sobre' : 'bajo'} Kijun${fut}` };
    });

    add('tendencia', 'aroon', 'Aroon (25)', 0.75, (i) => {
      const u = ind.aroon.up[i], d = ind.aroon.down[i];
      if (!isNum(u)) return null;
      const vote = u >= 70 && d <= 30 ? 1 : d >= 70 && u <= 30 ? -1 : u > d ? 0.5 : u < d ? -0.5 : 0;
      const what = vote >= 1 ? 'Máximos recientes: domina la subida' : vote <= -1 ? 'Mínimos recientes: domina la bajada' : 'Ningún lado domina';
      return { vote, value: `${f0(u)} / ${f0(d)}`, text: `${what} (arriba ${f0(u)}, abajo ${f0(d)})` };
    });

    add('tendencia', 'regresion', 'Regresión lineal (50)', 0.75, (i) => {
      const n = 50, r = TA.linreg(c, n, i);
      if (!r) return null;
      const move = r.end - r.intercept, total = r.intercept ? (move / r.intercept) * 100 : 0;
      const sig = Math.abs(move) > 1.5 * ind.atr[i];
      const strength = r.r2 >= 0.5 ? 1 : r.r2 >= 0.25 ? 0.5 : 0;
      const vote = sig ? Math.sign(move) * strength : 0;
      return { vote, value: `${signed(total)} %`, text: `Pendiente de ${signed(total)} % en ${B(n)}; ajuste R² ${f2(r.r2)}${strength === 0 ? ' (canal poco definido)' : ''}` };
    });

    // --- Momento ---
    add('momento', 'rsi', 'RSI (14)', 1.25, (i) => {
      const r = ind.rsi[i];
      if (!isNum(r) || !isNum(ind.rsi[i - 3])) return null;
      const up = r > ind.rsi[i - 3];
      let vote, txt;
      if (r >= 70) { vote = -0.5; txt = 'Sobrecompra: impulso fuerte, pero con riesgo de recorte'; }
      else if (r >= 55) { vote = 1; txt = 'Zona alcista sin sobrecompra'; }
      else if (r >= 50) { vote = 0.5; txt = 'Ligeramente alcista'; }
      else if (r > 45) { vote = -0.5; txt = 'Ligeramente bajista'; }
      else if (r > 30) { vote = -1; txt = 'Zona bajista'; }
      else { vote = 0.5; txt = 'Sobreventa: posible rebote'; }
      return { vote, value: f1(r), text: `${txt} (${up ? 'subiendo' : 'bajando'})` };
    });

    const stochCheck = (obj, hi, lo) => (i) => {
      const k = obj.k[i], d = obj.d[i], k1 = obj.k[i - 1], d1 = obj.d[i - 1];
      if (!isNum(k) || !isNum(d) || !isNum(k1) || !isNum(d1)) return null;
      const crossUp = k1 <= d1 && k > d, crossDn = k1 >= d1 && k < d;
      let vote, txt;
      if (crossUp && k < lo + 10) { vote = 1; txt = 'Cruce alcista en sobreventa'; }
      else if (crossDn && k > hi - 10) { vote = -1; txt = 'Cruce bajista en sobrecompra'; }
      else if (k > hi) { vote = -0.5; txt = 'Sobrecompra'; }
      else if (k < lo) { vote = 0.5; txt = 'Sobreventa'; }
      else { vote = k > d ? 0.5 : -0.5; txt = `%K ${k > d ? 'por encima' : 'por debajo'} de %D`; }
      return { vote, value: `${f0(k)} / ${f0(d)}`, text: txt };
    };
    add('momento', 'stoch', 'Estocástico (14, 3, 3)', 1, stochCheck(ind.stoch, 80, 20));
    add('momento', 'stochrsi', 'Estocástico RSI', 0.5, stochCheck(ind.stochRsi, 80, 20));

    add('momento', 'willr', 'Williams %R (14)', 0.5, (i) => {
      const w = ind.willr[i];
      if (!isNum(w)) return null;
      const vote = w > -20 ? -0.5 : w < -80 ? 0.5 : w > -50 ? 0.5 : -0.5;
      const text = w > -20 ? 'Sobrecompra: cerca del máximo reciente' : w < -80 ? 'Sobreventa: cerca del mínimo reciente' : w > -50 ? 'En la mitad alta de su rango reciente' : 'En la mitad baja de su rango reciente';
      return { vote, value: f0(w), text };
    });

    add('momento', 'cci', 'CCI (20)', 0.75, (i) => {
      const k = ind.cci[i];
      if (!isNum(k)) return null;
      let vote, text;
      if (k > 200) { vote = -0.5; text = 'Extremo: sobrecompra'; }
      else if (k > 100) { vote = 1; text = 'Impulso alcista fuerte'; }
      else if (k > 0) { vote = 0.5; text = 'Sesgo alcista'; }
      else if (k > -100) { vote = -0.5; text = 'Sesgo bajista'; }
      else if (k > -200) { vote = -1; text = 'Impulso bajista fuerte'; }
      else { vote = 0.5; text = 'Extremo: sobreventa'; }
      return { vote, value: f0(k), text };
    });

    add('momento', 'roc', 'ROC (12)', 0.75, (i) => {
      const r = ind.roc[i], r3 = ind.roc[i - 3];
      if (!isNum(r) || !isNum(r3)) return null;
      const vote = r > 0 ? (r > r3 ? 1 : 0.5) : r < 0 ? (r < r3 ? -1 : -0.5) : 0;
      return { vote, value: `${signed(r)} %`, text: `${signed(r)} % en ${B(12)}, ${Math.abs(r) > Math.abs(r3) ? 'acelerando' : 'frenando'}` };
    });

    add('momento', 'mom', 'Momentum (10)', 0.5, (i) => {
      const m = ind.mom[i];
      if (!isNum(m)) return null;
      return { vote: m > 0 ? 0.5 : m < 0 ? -0.5 : 0, value: fp(m), text: `${m >= 0 ? 'Sube' : 'Baja'} ${fp(Math.abs(m))} respecto a hace ${B(10)}` };
    });

    add('momento', 'macdhist', 'Histograma MACD', 0.75, (i) => {
      const a = ind.macd.hist[i], b = ind.macd.hist[i - 1], d = ind.macd.hist[i - 2];
      if (!isNum(a) || !isNum(b) || !isNum(d)) return null;
      const rising = a > b && b > d, falling = a < b && b < d;
      const vote = rising ? 0.5 : falling ? -0.5 : 0;
      const zone = a > 0 ? 'positivo' : 'negativo';
      const text = rising ? `Crece (${zone}): el impulso se acelera` : falling ? `Decrece (${zone}): el impulso se frena` : `Sin dirección clara (${zone})`;
      return { vote, value: fp(a), text };
    });

    // --- Volumen ---
    if (hasVol) {
      add('volumen', 'obv', 'OBV (balance de volumen)', 1, (i) => {
        const ob = ind.obv[i], s = ind.obvSma[i];
        if (!isNum(s) || i < 10) return null;
        const slope = ob - ind.obv[i - 10], priceUp = c[i] > c[i - 10];
        const vote = ob > s && slope > 0 ? 1 : ob < s && slope < 0 ? -1 : 0;
        let text = `${ob > s ? 'Por encima' : 'Por debajo'} de su media de 20 y ${slope > 0 ? 'subiendo' : 'bajando'}`;
        if (priceUp && slope < 0) text += '; ojo: el precio sube sin volumen que lo respalde';
        else if (!priceUp && slope > 0) text += '; se acumula volumen aunque el precio baje';
        return { vote, value: fc(ob), text };
      });
      add('volumen', 'mfi', 'MFI (14)', 1, (i) => {
        const m = ind.mfi[i];
        if (!isNum(m)) return null;
        const vote = m > 80 ? -0.5 : m < 20 ? 0.5 : m >= 50 ? 0.5 : -0.5;
        const text = m > 80 ? 'Sobrecompra con volumen' : m < 20 ? 'Sobreventa con volumen' : m >= 50 ? 'Entra más dinero del que sale' : 'Sale más dinero del que entra';
        return { vote, value: f0(m), text };
      });
      add('volumen', 'cmf', 'Chaikin Money Flow (20)', 1, (i) => {
        const k = ind.cmf[i];
        if (!isNum(k)) return null;
        const vote = k > 0.05 ? 1 : k < -0.05 ? -1 : 0;
        const text = k > 0.05 ? 'Acumulación: presión compradora' : k < -0.05 ? 'Distribución: presión vendedora' : 'Equilibrio entre compras y ventas';
        return { vote, value: f2(k), text };
      });
      add('volumen', 'vwap', 'VWAP (20)', 0.75, (i) => {
        const w = ind.vwap[i];
        if (!isNum(w)) return null;
        const above = c[i] > w;
        return { vote: above ? 0.5 : -0.5, value: fp(w), text: `Precio ${above ? 'por encima' : 'por debajo'} del precio medio ponderado por volumen` };
      });
      add('volumen', 'relvol', 'Volumen relativo', 0.5, (i) => {
        const s = ind.volSma[i];
        if (!isNum(s) || s === 0) return null;
        const rv = v[i] / s, upBar = c[i] >= o[i];
        const vote = rv >= 1.5 ? (upBar ? 0.5 : -0.5) : 0;
        const text = rv >= 1.5 ? `Volumen alto en vela ${upBar ? 'alcista' : 'bajista'}` : rv < 0.6 ? 'Volumen bajo: poco interés' : 'Volumen normal';
        return { vote, value: `${f1(rv)}×`, text: `${text} (${f1(rv)} veces la media de 20)` };
      });
    }

    // --- Volatilidad ---
    add('volatilidad', 'bollinger', 'Bandas de Bollinger (20, 2)', 1, (i) => {
      const p = ind.bb.pctB[i], w = ind.bb.width[i];
      if (!isNum(p) || !isNum(w)) return null;
      const win = ind.bb.width.slice(Math.max(0, i - 120), i + 1).filter(isNum);
      const rank = win.filter((q) => q <= w).length / win.length;
      const vote = p > 1 ? -0.5 : p < 0 ? 0.5 : p >= 0.5 ? 0.5 : -0.5;
      let text = p > 1 ? 'Por encima de la banda superior: subida muy estirada' : p < 0 ? 'Por debajo de la banda inferior: caída muy estirada' : p >= 0.5 ? 'En la mitad superior de las bandas' : 'En la mitad inferior de las bandas';
      if (win.length > 40 && rank <= 0.1) text += '; bandas muy estrechas: suele anticipar un movimiento fuerte';
      return { vote, value: `%B ${f2(p)}`, text };
    });
    add('volatilidad', 'keltner', 'Canal de Keltner (20, 2)', 0.5, (i) => {
      const u = ind.kc.upper[i], d = ind.kc.lower[i];
      if (!isNum(u) || !isNum(d)) return null;
      const vote = c[i] > u ? 1 : c[i] < d ? -1 : 0;
      const text = vote > 0 ? 'Cierra por encima del canal: impulso alcista' : vote < 0 ? 'Cierra por debajo del canal: impulso bajista' : 'Dentro del canal';
      return { vote, value: `${fp(d)} – ${fp(u)}`, text };
    });
    add('volatilidad', 'donchian', 'Canal de Donchian (20)', 0.75, (i) => {
      const u = ind.dc.upper[i - 1], d = ind.dc.lower[i - 1];
      if (!isNum(u) || !isNum(d)) return null;
      if (c[i] > u) return { vote: 1, value: fp(u), text: `Nuevo máximo de ${B(20)}: ruptura alcista` };
      if (c[i] < d) return { vote: -1, value: fp(d), text: `Nuevo mínimo de ${B(20)}: ruptura bajista` };
      const pos = u > d ? (c[i] - d) / (u - d) : 0.5;
      return { vote: 0, value: `${f0(pos * 100)} %`, text: `En el ${f0(pos * 100)} % del rango de ${B(20)} (de ${fp(d)} a ${fp(u)})` };
    });
    add('volatilidad', 'atr', 'ATR (14)', 0, (i) => {
      const a = ind.atr[i];
      if (!isNum(a)) return null;
      return { vote: 0, value: fp(a), text: `Movimiento medio por ${x.cfg.bar}: ${f1((a / c[i]) * 100)} % del precio`, info: true };
    });
    add('volatilidad', 'hv', 'Volatilidad histórica (20)', 0, (i) => {
      const hv = ind.hv[i];
      if (!isNum(hv)) return null;
      const med = median(ind.hv.slice(Math.max(0, i - x.ppy), i + 1));
      const lvl = hv > med * 1.25 ? 'alta' : hv < med * 0.8 ? 'baja' : 'normal';
      return { vote: 0, value: `${f0(hv)} %`, text: `Anualizada; ${lvl} para este valor (su mediana es ${f0(med)} %)`, info: true };
    });

    return list;
  }

  function scoreAt(checks, i, withRows) {
    const acc = {}, rows = [];
    for (const ck of checks) {
      if (!withRows && ck.w === 0) continue; // los indicadores informativos no puntúan
      const r = ck.f(i);
      if (!r) continue;
      if (withRows) rows.push({ group: ck.group, id: ck.id, name: ck.name, w: ck.w, ...r });
      if (ck.w > 0) {
        const a = acc[ck.group] || (acc[ck.group] = { s: 0, w: 0 });
        a.s += ck.w * r.vote; a.w += ck.w;
      }
    }
    let tot = 0, wt = 0;
    const groupScores = {};
    for (const g of GROUPS) {
      const a = acc[g.id];
      if (!a || !a.w) continue;
      groupScores[g.id] = a.s / a.w;
      tot += g.w * groupScores[g.id]; wt += g.w;
    }
    return { score: wt ? tot / wt : 0, groupScores, rows };
  }

  function scoreLabel(s) {
    if (s >= 0.5) return 'Compra fuerte';
    if (s >= 0.15) return 'Compra';
    if (s > -0.15) return 'Neutral';
    if (s > -0.5) return 'Venta';
    return 'Venta fuerte';
  }

  function summarize(checks, i) {
    const r = scoreAt(checks, i, true);
    const voting = r.rows.filter((q) => !q.info);
    const counts = { buy: voting.filter((q) => q.vote > 0).length, neutral: voting.filter((q) => q.vote === 0).length, sell: voting.filter((q) => q.vote < 0).length };
    const groups = GROUPS.map((g) => ({ ...g, score: r.groupScores[g.id], label: isNum(r.groupScores[g.id]) ? scoreLabel(r.groupScores[g.id]) : null }));
    return { score: r.score, label: scoreLabel(r.score), counts, rows: r.rows, groups, consensus: voting.length ? Math.round((100 * Math.max(counts.buy, counts.sell)) / voting.length) : 0 };
  }

  /* ---------- Tendencia ---------- */
  function trendAt(x, i) {
    const { c, h, l, ind, sw } = x;
    const short = mean([sg(c[i] - ind.ema20[i]), sg(ind.ema20[i] - ind.ema20[i - 5]), ind.st.dir[i] || NaN]);
    const medium = mean([sg(c[i] - ind.sma50[i]), sg(ind.sma50[i] - ind.sma50[i - 10]), sg(ind.macd.line[i])]);
    let long;
    if (isNum(ind.sma200[i])) long = mean([sg(c[i] - ind.sma200[i]), sg(ind.sma200[i] - ind.sma200[i - 20]), sg(ind.sma50[i] - ind.sma200[i])]);
    else if (isNum(ind.sma100[i])) long = mean([sg(c[i] - ind.sma100[i]), sg(ind.sma100[i] - ind.sma100[i - 15])]);
    else { const r = TA.linreg(c, Math.min(i + 1, 120), i); long = r ? Math.sign(r.slope) * (r.r2 > 0.3 ? 1 : 0.5) : NaN; }

    const H = sw.highs.filter((j) => j <= i).slice(-3), Lo = sw.lows.filter((j) => j <= i).slice(-3);
    let structure = 0, structureText = 'sin suficientes giros para leer la estructura';
    if (H.length >= 2 && Lo.length >= 2) {
      const hh = h[H[H.length - 1]] > h[H[H.length - 2]], hl = l[Lo[Lo.length - 1]] > l[Lo[Lo.length - 2]];
      if (hh && hl) { structure = 1; structureText = 'máximos y mínimos cada vez más altos'; }
      else if (!hh && !hl) { structure = -1; structureText = 'máximos y mínimos cada vez más bajos'; }
      else structureText = hh ? 'máximos más altos pero mínimos más bajos (se ensancha)' : 'máximos más bajos pero mínimos más altos (se estrecha)';
    }
    const lab = (s) => (!isNum(s) ? 'sin datos' : s >= 0.34 ? 'alcista' : s <= -0.34 ? 'bajista' : 'lateral');
    const comp = 0.15 * (short || 0) + 0.4 * (medium || 0) + 0.3 * (isNum(long) ? long : medium || 0) + 0.15 * structure;
    const adx = ind.dmi.adx[i];
    let dir = comp > 0.25 ? 'alcista' : comp < -0.25 ? 'bajista' : 'lateral';
    if (isNum(adx) && adx < 18 && Math.abs(comp) < 0.6) dir = 'lateral';
    let strength;
    if (dir === 'lateral') strength = 'en rango';
    else strength = !isNum(adx) ? '' : adx < 20 ? 'débil' : adx < 30 ? 'moderada' : adx < 45 ? 'fuerte' : 'muy fuerte';
    const label = dir === 'lateral' ? 'Lateral, en rango' : `${dir === 'alcista' ? 'Alcista' : 'Bajista'} ${strength}`.trim();
    return {
      dir, strength, label, adx, comp, structure, structureText,
      parts: [
        { id: 'short', name: 'Corto', horizon: x.cfg.horizons[0], dir: lab(short) },
        { id: 'medium', name: 'Medio', horizon: x.cfg.horizons[1], dir: lab(medium) },
        { id: 'long', name: 'Largo', horizon: x.cfg.horizons[2], dir: lab(long) },
      ],
    };
  }

  /* ---------- Niveles ---------- */
  function clusterLevels(points, tol) {
    const pts = points.slice().sort((a, b) => a.price - b.price), cl = [];
    for (const p of pts) {
      const k = cl[cl.length - 1];
      if (k && p.price - k.price <= tol) {
        k.items.push(p); k.wsum += p.w;
        k.price = k.items.reduce((s, q) => s + q.price * q.w, 0) / k.wsum;
      } else cl.push({ items: [p], wsum: p.w, price: p.price });
    }
    return cl.map((k) => ({ price: k.price, touches: k.items.length, strength: k.wsum, lastIdx: Math.max(...k.items.map((q) => q.i)) }));
  }

  function findLevels(x) {
    const { t, h, l, c, last, ind, cfg, sw, meta } = x;
    const P = c[last], A = ind.atr[last];
    const start = Math.max(0, last - cfg.srLookback);
    const rec = (j) => 0.5 + (j - start) / Math.max(1, last - start);
    const pts = [];
    for (const j of sw.highs) if (j >= start) pts.push({ price: h[j], i: j, w: rec(j) });
    for (const j of sw.lows) if (j >= start) pts.push({ price: l[j], i: j, w: rec(j) });
    let hiI = start, loI = start;
    for (let j = start; j <= last; j++) { if (h[j] > h[hiI]) hiI = j; if (l[j] < l[loI]) loI = j; }
    const tol = Math.max(0.5 * A, P * 0.004);
    const cl = clusterLevels(pts, tol);
    const keep = (k) => k.touches >= 2 || last - k.lastIdx <= 60 || Math.abs(k.price - h[hiI]) <= tol || Math.abs(k.price - l[loI]) <= tol;
    let supports = cl.filter((k) => k.price < P - 0.15 * A && keep(k)).sort((a, b) => b.price - a.price).slice(0, 4);
    let resistances = cl.filter((k) => k.price > P + 0.15 * A && keep(k)).sort((a, b) => a.price - b.price).slice(0, 4);
    if (h[hiI] > P + 0.15 * A && !resistances.some((r) => Math.abs(r.price - h[hiI]) <= tol)) {
      resistances.push({ price: h[hiI], touches: 1, strength: 1, lastIdx: hiI, extreme: true });
      resistances = resistances.sort((a, b) => a.price - b.price).slice(0, 4);
    }
    if (l[loI] < P - 0.15 * A && !supports.some((s) => Math.abs(s.price - l[loI]) <= tol)) {
      supports.push({ price: l[loI], touches: 1, strength: 1, lastIdx: loI, extreme: true });
      supports = supports.sort((a, b) => b.price - a.price).slice(0, 4);
    }
    for (const s of supports) { s.extreme = s.extreme || Math.abs(s.price - l[loI]) <= tol; s.ago = last - s.lastIdx; }
    for (const r of resistances) { r.extreme = r.extreme || Math.abs(r.price - h[hiI]) <= tol; r.ago = last - r.lastIdx; }

    // Máximo y mínimo de 52 semanas
    const since = t[last] - 365 * 86400;
    let hi52 = -Infinity, lo52 = Infinity;
    for (let j = last; j >= 0 && t[j] >= since; j--) { hi52 = Math.max(hi52, h[j]); lo52 = Math.min(lo52, l[j]); }
    const covers52 = t[0] <= since + 10 * 86400;

    return {
      supports, resistances, tol,
      fib: fibonacci(x), pivots: pivots(x),
      hi52: covers52 ? hi52 : NaN, lo52: covers52 ? lo52 : NaN,
      periodHigh: Math.max(...h), periodLow: Math.min(...l),
      lookbackHigh: h[hiI], lookbackLow: l[loI],
    };
  }

  function fibonacci(x) {
    const { h, l, last, cfg } = x;
    const s = Math.max(0, last - cfg.fibLookback);
    let hiI = s, loI = s;
    for (let j = s; j <= last; j++) { if (h[j] > h[hiI]) hiI = j; if (l[j] < l[loI]) loI = j; }
    const hi = h[hiI], lo = l[loI], range = hi - lo;
    if (!(range > 0)) return null;
    const up = loI < hiI;
    const ratios = [0.236, 0.382, 0.5, 0.618, 0.786], levels = {};
    for (const r of ratios) levels[r] = up ? hi - range * r : lo + range * r;
    const ext = up ? { 1.272: hi + range * 0.272, 1.618: hi + range * 0.618 } : { 1.272: lo - range * 0.272, 1.618: lo - range * 0.618 };
    return { up, hi, lo, hiI, loI, levels, ext, ratios };
  }

  function pivots(x) {
    const { t, h, l, c, last, cfg, meta } = x;
    const off = meta.gmtoffset || 0;
    const key = (ts) => {
      const d = new Date((ts + off) * 1000);
      return cfg.pivot === 'day' ? `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` : cfg.pivot === 'month' ? `${d.getUTCFullYear()}-${d.getUTCMonth()}` : `${d.getUTCFullYear()}`;
    };
    const lastKey = key(t[last]);
    let j = last;
    while (j >= 0 && key(t[j]) === lastKey) j--;
    if (j < 0) return null;
    const pk = key(t[j]), C = c[j];
    let H = -Infinity, Lo = Infinity, k = j;
    while (k >= 0 && key(t[k]) === pk) { H = Math.max(H, h[k]); Lo = Math.min(Lo, l[k]); k--; }
    const P = (H + Lo + C) / 3;
    return { P, R1: 2 * P - Lo, S1: 2 * P - H, R2: P + (H - Lo), S2: P - (H - Lo), R3: H + 2 * (P - Lo), S3: Lo - 2 * (H - P), label: cfg.pivotLabel };
  }

  /* ---------- Patrones de velas ---------- */
  function candlePatterns(x) {
    const { o, h, l, c, last, ind } = x;
    const out = [];
    const body = (i) => Math.abs(c[i] - o[i]), range = (i) => h[i] - l[i];
    const upper = (i) => h[i] - Math.max(o[i], c[i]), lower = (i) => Math.min(o[i], c[i]) - l[i];
    const bull = (i) => c[i] > o[i], bear = (i) => c[i] < o[i];
    const prior = (i) => {
      if (i - 6 < 0 || !isNum(ind.atr[i])) return 0;
      const ch = c[i - 1] - c[i - 6];
      return Math.abs(ch) < 0.5 * ind.atr[i] ? 0 : Math.sign(ch);
    };
    for (let i = last; i >= Math.max(last - 2, 6); i--) {
      const r = range(i), A = ind.atr[i];
      if (!(r > 0) || !isNum(A)) continue;
      const b = body(i), up = upper(i), lo = lower(i), tr = prior(i);
      const push = (name, bias, desc) => out.push({ name, bias, desc, ago: last - i, i });
      const a = i - 2, m = i - 1;
      if (bear(a) && body(a) > 0.6 * ind.atr[a] && body(m) < 0.35 * body(a) && bull(i) && c[i] > (o[a] + c[a]) / 2 && tr <= 0) push('Estrella de la mañana', 1, 'Giro alcista en tres velas tras una caída');
      if (bull(a) && body(a) > 0.6 * ind.atr[a] && body(m) < 0.35 * body(a) && bear(i) && c[i] < (o[a] + c[a]) / 2 && tr >= 0) push('Estrella de la tarde', -1, 'Giro bajista en tres velas tras una subida');
      if ([a, m, i].every(bull) && c[m] > c[a] && c[i] > c[m] && [a, m, i].every((k) => body(k) > 0.5 * range(k) && upper(k) < 0.3 * body(k))) push('Tres soldados blancos', 1, 'Tres velas alcistas fuertes seguidas');
      if ([a, m, i].every(bear) && c[m] < c[a] && c[i] < c[m] && [a, m, i].every((k) => body(k) > 0.5 * range(k) && lower(k) < 0.3 * body(k))) push('Tres cuervos negros', -1, 'Tres velas bajistas fuertes seguidas');
      if (bear(m) && bull(i) && o[i] <= c[m] && c[i] >= o[m] && b > body(m)) push('Envolvente alcista', 1, tr < 0 ? 'Tras una caída: posible giro al alza' : 'La vela alcista envuelve a la anterior');
      if (bull(m) && bear(i) && o[i] >= c[m] && c[i] <= o[m] && b > body(m)) push('Envolvente bajista', -1, tr > 0 ? 'Tras una subida: posible giro a la baja' : 'La vela bajista envuelve a la anterior');
      if (bear(m) && body(m) > 0.6 * ind.atr[m] && bull(i) && o[i] > c[m] && c[i] < o[m] && b < 0.5 * body(m)) push('Harami alcista', 0.5, 'La caída pierde fuerza');
      if (bull(m) && body(m) > 0.6 * ind.atr[m] && bear(i) && o[i] < c[m] && c[i] > o[m] && b < 0.5 * body(m)) push('Harami bajista', -0.5, 'La subida pierde fuerza');
      if (b <= 0.1 * r) push('Doji', 0, 'Indecisión entre compradores y vendedores');
      else if (lo >= 2 * b && up <= 0.25 * b + 0.05 * r) {
        if (tr < 0) push('Martillo', 1, 'Rechazo de precios bajos tras una caída');
        else if (tr > 0) push('Hombre colgado', -0.5, 'Aviso de debilidad tras una subida');
      } else if (up >= 2 * b && lo <= 0.25 * b + 0.05 * r) {
        if (tr > 0) push('Estrella fugaz', -1, 'Rechazo de precios altos tras una subida');
        else if (tr < 0) push('Martillo invertido', 0.5, 'Posible giro tras una caída');
      }
      if (b >= 0.9 * r && r > 0.8 * A) push(bull(i) ? 'Marubozu alcista' : 'Marubozu bajista', bull(i) ? 1 : -1, bull(i) ? 'Dominio total de los compradores' : 'Dominio total de los vendedores');
    }
    return out;
  }

  /* ---------- Divergencias ---------- */
  function findDivergences(x) {
    const { h, l, last, ind, sw, hasVol } = x;
    const out = [];
    const check = (series, name) => {
      const lows = sw.lows.filter((j) => j >= last - 90), highs = sw.highs.filter((j) => j >= last - 90);
      if (lows.length >= 2) {
        const b = lows[lows.length - 1], a = lows[lows.length - 2];
        if (last - b <= 15 && b - a >= 5 && l[b] < l[a] && isNum(series[a]) && isNum(series[b]) && series[b] > series[a]) {
          out.push({ name: `Divergencia alcista en ${name}`, bias: 1, desc: `El precio hizo un mínimo más bajo, pero el ${name} no lo confirma`, ago: last - b });
        }
      }
      if (highs.length >= 2) {
        const b = highs[highs.length - 1], a = highs[highs.length - 2];
        if (last - b <= 15 && b - a >= 5 && h[b] > h[a] && isNum(series[a]) && isNum(series[b]) && series[b] < series[a]) {
          out.push({ name: `Divergencia bajista en ${name}`, bias: -1, desc: `El precio hizo un máximo más alto, pero el ${name} no lo acompaña`, ago: last - b });
        }
      }
    };
    check(ind.rsi, 'RSI');
    check(ind.macd.line, 'MACD');
    if (hasVol) check(ind.obv, 'OBV');
    return out;
  }

  /* ---------- Rendimiento y riesgo ---------- */
  function performance(x) {
    const { t, c, last, meta, ind, ppy } = x;
    const off = meta.gmtoffset || 0, day = 86400;
    const closeAt = (ts) => { let j = last; while (j > 0 && t[j] > ts) j--; return t[j] <= ts ? c[j] : NaN; };
    const rows = [];
    const yr = new Date((t[last] + off) * 1000).getUTCFullYear();
    const yStart = Date.UTC(yr, 0, 1) / 1000 - off;
    const H = [['1 semana', 7], ['1 mes', 30], ['3 meses', 91], ['6 meses', 182], ['ytd'], ['1 año', 365], ['3 años', 1095], ['5 años', 1826]];
    for (const [k, d] of H) {
      if (k === 'ytd') { if (t[0] < yStart) rows.push({ label: 'En lo que va de año', ret: pct(c[last], closeAt(yStart - 1)) }); continue; }
      const ts = t[last] - d * day;
      if (t[0] > ts + 3 * day) continue;
      rows.push({ label: k, ret: pct(c[last], closeAt(ts)) });
    }
    const since = t[last] - 365 * day;
    let s = 0;
    while (s < last && t[s] < since) s++;
    let peak = -Infinity, mdd = 0, maxC = -Infinity;
    for (let j = s; j <= last; j++) { peak = Math.max(peak, c[j]); mdd = Math.min(mdd, c[j] / peak - 1); maxC = Math.max(maxC, c[j]); }
    const hvMed = median(ind.hv.slice(Math.max(0, last - ppy), last + 1));
    return {
      rows, mdd: mdd * 100, ddNow: (c[last] / maxC - 1) * 100, hv: ind.hv[last], hvMedian: hvMed,
      atrPct: (ind.atr[last] / c[last]) * 100, ddWindow: t[0] <= since ? 'último año' : 'periodo cargado',
    };
  }

  /* ---------- Plan de entrada y salida ---------- */
  function pickCluster(cands, A, P) {
    if (!cands.length) return null;
    const sorted = cands.slice().sort((a, b) => a.price - b.price), groups = [];
    for (const k of sorted) {
      const g = groups[groups.length - 1];
      if (g && k.price - g.max <= 0.5 * A && k.price - g.min <= 0.8 * A) { g.items.push(k); g.max = k.price; }
      else groups.push({ items: [k], min: k.price, max: k.price });
    }
    let best = null;
    for (const g of groups) {
      g.w = g.items.reduce((s, k) => s + k.w, 0);
      g.price = g.items.reduce((s, k) => s + k.price * k.w, 0) / g.w;
      g.dist = Math.abs(P - g.price) / A;
      g.score = g.w * Math.exp(-g.dist / 2.2);
      g.labels = [...new Set(g.items.slice().sort((a, b) => b.w - a.w).map((k) => k.label))].slice(0, 3);
      if (!best || g.score > best.score) best = g;
    }
    return best;
  }

  function dedupeLevels(list, minGap) {
    const out = [];
    for (const k of list) if (!out.some((q) => Math.abs(q.price - k.price) < minGap)) out.push(k);
    return out;
  }

  function setupFor(x, levels, side, kind, opts = {}) {
    const { c, l, h, last, ind, hasVol, sw } = x;
    const P = c[last], A = ind.atr[last];
    const long = side === 'long';
    let entry, zone, basis, trigger = null;

    if (kind === 'pullback') {
      const cands = [];
      const add = (price, w, label) => {
        if (!isNum(price)) return;
        const ok = long ? price < P - 0.05 * A && price > P - 4 * A : price > P + 0.05 * A && price < P + 4 * A;
        if (ok) cands.push({ price, w, label });
      };
      for (const s of long ? levels.supports : levels.resistances) {
        add(s.price, 1 + 0.5 * Math.min(s.touches, 4), `${long ? 'soporte' : 'resistencia'}${s.touches > 1 ? ` con ${s.touches} toques` : ''}`);
      }
      add(ind.ema20[last], 1, 'media exponencial 20'); add(ind.sma50[last], 1.5, 'media de 50');
      add(ind.sma100[last], 1, 'media de 100'); add(ind.sma200[last], 2, 'media de 200');
      add(ind.ichi.kijun[last], 1, 'Kijun de Ichimoku'); add(ind.bb.mid[last], 0.6, 'media de Bollinger');
      if (ind.st.dir[last] === (long ? 1 : -1)) add(ind.st.line[last], 1.2, 'Supertrend');
      if (hasVol) add(ind.vwap[last], 0.6, 'VWAP');
      const f = levels.fib;
      if (f && f.up === long) { add(f.levels[0.382], 1, 'Fibonacci 38,2 %'); add(f.levels[0.5], 1, 'Fibonacci 50 %'); add(f.levels[0.618], 1.2, 'Fibonacci 61,8 %'); }
      const pv = levels.pivots;
      if (pv) { add(pv.P, 0.6, 'punto pivote'); add(long ? pv.S1 : pv.R1, 0.6, long ? 'pivote S1' : 'pivote R1'); }
      const best = pickCluster(cands, A, P);
      if (best) {
        entry = best.price;
        zone = long ? [best.min - 0.15 * A, Math.min(best.max + 0.15 * A, P)] : [Math.max(best.min - 0.15 * A, P), best.max + 0.15 * A];
        basis = best.labels;
      } else {
        entry = long ? P - 0.5 * A : P + 0.5 * A;
        zone = [entry - 0.25 * A, entry + 0.25 * A];
        basis = ['un pequeño retroceso de medio ATR'];
      }
    } else {
      // Ruptura: entrar cuando el precio supera (o pierde) el nivel más cercano
      const lv = long ? levels.resistances.find((r) => r.price > P + 0.2 * A && r.price < P + 5 * A) : levels.supports.find((s) => s.price < P - 0.2 * A && s.price > P - 5 * A);
      let trig = lv ? lv.price : long ? Math.max(ind.dc.upper[last], P + 0.5 * A) : Math.min(ind.dc.lower[last], P - 0.5 * A);
      basis = [lv ? (long ? 'resistencia más cercana' : 'soporte más cercano') : long ? `máximo de 20 ${x.cfg.barPl}` : `mínimo de 20 ${x.cfg.barPl}`];
      if (opts.minTrigger && long && isNum(opts.minTrigger.price) && opts.minTrigger.price > trig) { trig = opts.minTrigger.price; basis = [opts.minTrigger.label]; }
      if (opts.minTrigger && !long && isNum(opts.minTrigger.price) && opts.minTrigger.price < trig) { trig = opts.minTrigger.price; basis = [opts.minTrigger.label]; }
      trigger = trig;
      entry = long ? trig + 0.25 * A : trig - 0.25 * A;
      zone = long ? [trig + 0.1 * A, trig + 0.5 * A] : [trig - 0.5 * A, trig - 0.1 * A];
    }

    // Stop
    let stop, stopBasis;
    if (kind === 'breakout') {
      stop = long ? trigger - 1.2 * A : trigger + 1.2 * A;
      stopBasis = long ? 'por debajo del nivel roto: si el precio vuelve ahí, la ruptura ha fallado' : 'por encima del nivel perdido: si el precio vuelve ahí, la ruptura ha fallado';
    } else {
      const swingsNear = (long ? sw.lows : sw.highs).filter((j) => j >= last - 80).map((j) => (long ? l[j] : h[j]));
      const pool = [...(long ? levels.supports : levels.resistances).map((s) => s.price), ...swingsNear];
      const near = long
        ? pool.filter((p) => p < entry - 0.5 * A && p > entry - 3.5 * A).sort((a, b) => b - a)
        : pool.filter((p) => p > entry + 0.5 * A && p < entry + 3.5 * A).sort((a, b) => a - b);
      if (near.length) { stop = long ? near[0] - 0.3 * A : near[0] + 0.3 * A; stopBasis = long ? 'justo debajo del siguiente soporte' : 'justo encima de la siguiente resistencia'; }
      else { stop = long ? entry - 2 * A : entry + 2 * A; stopBasis = 'a dos veces la volatilidad media (ATR)'; }
      stop = long ? Math.max(Math.min(stop, entry - A), entry - 3.5 * A) : Math.min(Math.max(stop, entry + A), entry + 3.5 * A);
    }
    const R = Math.abs(entry - stop);

    // Objetivos
    const f = levels.fib, pv = levels.pivots;
    let tg = [];
    if (long) {
      for (const r of levels.resistances) tg.push({ price: r.price, label: r.extreme ? 'máximo del periodo' : `resistencia${r.touches > 1 ? ` con ${r.touches} toques` : ''}` });
      if (f && f.up) { tg.push({ price: f.ext[1.272], label: 'extensión de Fibonacci 127,2 %' }); tg.push({ price: f.ext[1.618], label: 'extensión de Fibonacci 161,8 %' }); }
      if (isNum(levels.hi52)) tg.push({ price: levels.hi52, label: 'máximo de 52 semanas' });
      if (pv) { tg.push({ price: pv.R1, label: 'pivote R1' }); tg.push({ price: pv.R2, label: 'pivote R2' }); }
      tg = tg.filter((k) => isNum(k.price) && k.price > entry + 0.5 * A).sort((a, b) => a.price - b.price);
    } else {
      for (const s of levels.supports) tg.push({ price: s.price, label: s.extreme ? 'mínimo del periodo' : `soporte${s.touches > 1 ? ` con ${s.touches} toques` : ''}` });
      if (f && !f.up) { tg.push({ price: f.ext[1.272], label: 'extensión de Fibonacci 127,2 %' }); tg.push({ price: f.ext[1.618], label: 'extensión de Fibonacci 161,8 %' }); }
      if (isNum(levels.lo52)) tg.push({ price: levels.lo52, label: 'mínimo de 52 semanas' });
      if (pv) { tg.push({ price: pv.S1, label: 'pivote S1' }); tg.push({ price: pv.S2, label: 'pivote S2' }); }
      tg = tg.filter((k) => isNum(k.price) && k.price > 0 && k.price < entry - 0.5 * A).sort((a, b) => b.price - a.price);
    }
    tg = dedupeLevels(tg, 0.3 * A);
    const buf = 0.1 * A;
    const adj = (p) => (long ? p - buf : p + buf);
    const gain = (p) => (long ? p - entry : entry - p);
    let tp1 = null;
    for (const k of tg) { const p = adj(k.price); if (gain(p) >= 1.2 * R) { tp1 = { price: p, label: k.label, level: true }; break; } }
    if (!tp1) tp1 = { price: long ? entry + 2 * R : entry - 2 * R, label: 'dos veces el riesgo asumido', level: false };
    let tp2 = null;
    for (const k of tg) { const p = adj(k.price); if (gain(p) > gain(tp1.price) + A) { tp2 = { price: p, label: k.label, level: true }; break; } }
    if (!tp2) {
      const p = long ? Math.max(entry + 3 * R, tp1.price + 1.5 * A) : Math.min(entry - 3 * R, tp1.price - 1.5 * A);
      tp2 = { price: p, label: 'tres veces el riesgo asumido', level: false };
    }
    if (!long) { if (tp1.price <= 0) tp1.price = entry * 0.5; if (tp2.price <= 0) tp2.price = entry * 0.3; }
    const obstacle = tg.find((k) => gain(k.price) > 0 && gain(k.price) < gain(tp1.price) - 0.2 * A) || null;

    // Salida dinámica
    let trail;
    const stOk = ind.st.dir[last] === (long ? 1 : -1);
    trail = stOk ? { price: ind.st.line[last], label: 'Supertrend', of: 'del Supertrend' } : { price: ind.ema20[last], label: 'media exponencial 20', of: 'de la media exponencial 20' };
    trail.useful = isNum(trail.price) && (long ? trail.price > stop : trail.price < stop);

    return {
      side, kind, entry, zone, basis, trigger, stop, stopBasis, tp1, tp2, obstacle, trail,
      rr: gain(tp1.price) / R, rr2: gain(tp2.price) / R,
      riskPct: (R / entry) * 100, tp1Pct: (gain(tp1.price) / entry) * 100, tp2Pct: (gain(tp2.price) / entry) * 100,
      distPct: ((P - entry) / entry) * 100,
    };
  }

  function buildPlan(x, summary, trend, levels, allowShort) {
    const { c, last, ind } = x;
    const P = c[last], A = ind.atr[last];
    const s = summary.score;
    let mode;
    if (trend.dir === 'alcista') mode = s >= 0 ? 'compra' : 'compra-espera';
    else if (trend.dir === 'bajista') mode = s <= 0 ? 'venta' : 'rebote';
    else mode = s >= 0.3 ? 'rango-alcista' : s <= -0.3 ? 'rango-bajista' : 'rango';

    const sma50Trigger = isNum(ind.sma50[last]) && ind.sma50[last] > P ? { price: ind.sma50[last], label: 'media de 50, que marcaría el cambio de tendencia' } : null;
    const longPull = () => setupFor(x, levels, 'long', 'pullback');
    const longBreak = (opts) => setupFor(x, levels, 'long', 'breakout', opts);
    const shortPull = () => setupFor(x, levels, 'short', 'pullback');
    const shortBreak = () => setupFor(x, levels, 'short', 'breakout');

    let action, actionTone, why, primary, primaryTitle, alt = null, altTitle = null;
    switch (mode) {
      case 'compra':
        action = 'Comprar en retroceso'; actionTone = 1;
        why = 'La tendencia es alcista y la mayoría de indicadores están a favor. La mejor entrada es esperar a que el precio retroceda a la zona de apoyo.';
        primary = longPull(); primaryTitle = 'Compra en retroceso';
        alt = longBreak(); altTitle = 'Si prefieres confirmación: compra en ruptura';
        break;
      case 'compra-espera':
        action = 'Esperar el retroceso para comprar'; actionTone = 0.5;
        why = 'La tendencia de fondo sigue siendo alcista, pero el impulso se ha enfriado. Mejor esperar a que el precio llegue a la zona de compra y rebote.';
        primary = longPull(); primaryTitle = 'Compra en la zona de apoyo';
        alt = longBreak(); altTitle = 'Si recupera fuerza: compra en ruptura';
        break;
      case 'venta':
        if (allowShort) {
          action = 'Vender en corto en el rebote'; actionTone = -1;
          why = 'La tendencia es bajista y la mayoría de indicadores la confirman. La mejor entrada en corto es un rebote hasta la zona de resistencia.';
          primary = shortPull(); primaryTitle = 'Venta en corto en rebote';
          alt = longBreak({ minTrigger: sma50Trigger }); altTitle = 'La idea cambia si supera este nivel (compra)';
        } else {
          action = 'No comprar todavía'; actionTone = -1;
          why = 'La tendencia es bajista: comprar ahora es ir a contracorriente. Este es el nivel que tendría que superar para que comprar tenga sentido.';
          primary = longBreak({ minTrigger: sma50Trigger }); primaryTitle = 'Compra solo si confirma el giro';
        }
        break;
      case 'rebote':
        action = allowShort ? 'Rebote en tendencia bajista' : 'Comprar solo si confirma la subida'; actionTone = 0;
        why = 'Los indicadores de corto plazo rebotan, pero la tendencia de fondo sigue siendo bajista. Es más seguro esperar a que supere la resistencia.';
        primary = longBreak({ minTrigger: sma50Trigger }); primaryTitle = 'Compra en ruptura (confirmación)';
        if (allowShort) { alt = shortPull(); altTitle = 'Venta en corto si el rebote se frena aquí'; }
        break;
      case 'rango-alcista':
        action = 'Comprar si rompe el rango'; actionTone = 0.5;
        why = 'No hay una tendencia clara, pero el impulso empuja hacia arriba. La entrada con más sentido es la ruptura de la resistencia.';
        primary = longBreak(); primaryTitle = 'Compra en ruptura';
        alt = longPull(); altTitle = 'Alternativa: compra en la parte baja del rango';
        break;
      case 'rango-bajista':
        if (allowShort) {
          action = 'Vender en la parte alta del rango'; actionTone = -0.5;
          why = 'No hay una tendencia clara, pero el impulso empuja hacia abajo.';
          primary = shortPull(); primaryTitle = 'Venta en corto en la resistencia';
          alt = shortBreak(); altTitle = 'O venta si pierde el soporte';
        } else {
          action = 'Esperar'; actionTone = -0.5;
          why = 'No hay una tendencia clara y el impulso empuja hacia abajo. Mejor esperar a que supere la resistencia.';
          primary = longBreak(); primaryTitle = 'Compra solo si supera la resistencia';
        }
        break;
      default:
        action = 'Operar el rango'; actionTone = 0;
        why = 'No hay tendencia clara: el precio se mueve entre un soporte y una resistencia. Se compra abajo y se vende arriba, o se espera la ruptura.';
        primary = longPull(); primaryTitle = 'Compra en la parte baja del rango';
        alt = longBreak(); altTitle = 'O compra si rompe por arriba';
    }

    // Confianza en el veredicto: acuerdo entre indicadores, plazos, fuerza y riesgo/beneficio
    const verdictSide = { compra: 1, 'compra-espera': 1, 'rango-alcista': 1, venta: -1, 'rango-bajista': -1 }[mode] || 0;
    let conf = verdictSide === 0 ? Math.abs(s) * 0.5 : Math.max(0, s * verdictSide);
    if (verdictSide !== 0) {
      for (const p of trend.parts) conf += p.dir === (verdictSide > 0 ? 'alcista' : 'bajista') ? 0.1 : 0;
      if (isNum(trend.adx) && trend.adx >= 25) conf += 0.1;
    }
    if (primary.rr >= 2) conf += 0.1; else if (primary.rr < 1.3) conf -= 0.15;
    const confidence = conf >= 0.75 ? 'alta' : conf >= 0.45 ? 'media' : 'baja';

    const notes = [];
    if (primary.kind === 'pullback') {
      const gap = primary.side === 'long' ? P - primary.entry : primary.entry - P;
      const r = ind.rsi[last];
      if (gap > 1.5 * A) notes.push(`El precio está un ${f1(Math.abs(primary.distPct))} % ${primary.side === 'long' ? 'por encima' : 'por debajo'} de la entrada: usa una orden limitada y ten paciencia.`);
      else if (mode === 'compra' && isNum(r) && r >= 50 && r < 68 && gap < 1.2 * A) notes.push('El precio ya está cerca de la zona: comprar ahora a mercado también es razonable.');
    }
    if (primary.obstacle) notes.push(`Antes del objetivo 1 hay un obstáculo en ${x.fp(primary.obstacle.price)} (${primary.obstacle.label}): si el precio se frena ahí, recoge parte del beneficio.`);
    if (primary.rr < 1.3) notes.push('La relación riesgo/beneficio es pobre: con estos niveles no compensa entrar.');

    return { mode, action, actionTone, why, primary, primaryTitle, alt, altTitle, confidence, verdictSide, notes, price: P };
  }

  /* ---------- Backtest de la señal ---------- */
  function runBacktest(x, checks) {
    const { t, o, l, c, last, ind } = x;
    const N = c.length;
    let start = 60;
    while (start < N && (!isNum(ind.sma50[start]) || !isNum(ind.macd.signal[start]) || !isNum(ind.dmi.adx[start]))) start++;
    if (N - start < 40) return null;
    const score = new Array(N).fill(NaN);
    for (let i = start; i < N; i++) score[i] = scoreAt(checks, i, false).score;
    const ENTER = 0.25, EXIT = -0.05, FEE = 0.001;
    const trades = [], equity = new Array(N).fill(NaN);
    let eq = 1, pos = null;
    for (let i = start; i < N; i++) {
      if (pos && i >= pos.i) {
        // ¿salta el stop dentro de la vela?
        if (l[i] <= pos.stop) {
          const px = Math.min(o[i], pos.stop);
          const ret = (px * (1 - FEE)) / (pos.price * (1 + FEE)) - 1;
          eq *= 1 + ret;
          trades.push({ entryI: pos.i, exitI: i, entry: pos.price, exit: px, ret, reason: 'stop' });
          pos = null;
        } else {
          pos.stop = Math.max(pos.stop, c[i] - 3 * ind.atr[i]);
          if (score[i] <= EXIT && i < last) {
            const px = o[i + 1];
            const ret = (px * (1 - FEE)) / (pos.price * (1 + FEE)) - 1;
            eq *= 1 + ret;
            trades.push({ entryI: pos.i, exitI: i + 1, entry: pos.price, exit: px, ret, reason: 'señal' });
            pos = null;
            equity[i] = eq;
            i++; // la salida ocurre en la apertura siguiente; esa vela ya no cuenta como dentro
            equity[i] = eq;
            continue;
          }
        }
      }
      if (!pos && i < last && score[i] >= ENTER && !(score[i - 1] >= ENTER)) {
        pos = { i: i + 1, price: o[i + 1], stop: o[i + 1] - 2.5 * ind.atr[i] };
      }
      equity[i] = pos && i >= pos.i ? eq * (c[i] / pos.price) : eq;
    }
    let open = null;
    if (pos) {
      const ret = c[last] / pos.price - 1;
      open = { entryI: pos.i, entry: pos.price, ret, stop: pos.stop };
      equity[last] = eq * (1 + ret);
    }
    const closed = trades.length, wins = trades.filter((q) => q.ret > 0);
    const losses = trades.filter((q) => q.ret <= 0);
    const sumW = wins.reduce((s, q) => s + q.ret, 0), sumL = losses.reduce((s, q) => s + q.ret, 0);
    let peak = -Infinity, mdd = 0;
    for (let i = start; i < N; i++) { if (!isNum(equity[i])) continue; peak = Math.max(peak, equity[i]); mdd = Math.min(mdd, equity[i] / peak - 1); }
    let peakBH = -Infinity, mddBH = 0;
    for (let i = start + 1; i < N; i++) { peakBH = Math.max(peakBH, c[i]); mddBH = Math.min(mddBH, c[i] / peakBH - 1); }
    const finalEq = isNum(equity[last]) ? equity[last] : eq;
    let inBars = trades.reduce((s, q) => s + (q.exitI - q.entryI), 0);
    if (open) inBars += last - open.entryI + 1;
    return {
      start, startTime: t[start], score, trades, open, closed,
      winRate: closed ? (wins.length / closed) * 100 : NaN,
      avgWin: wins.length ? (sumW / wins.length) * 100 : NaN,
      avgLoss: losses.length ? (sumL / losses.length) * 100 : NaN,
      profitFactor: sumL < 0 ? sumW / -sumL : NaN,
      totalRet: (finalEq - 1) * 100,
      buyHold: (c[last] / o[Math.min(start + 1, last)] - 1) * 100,
      mdd: mdd * 100, mddBH: mddBH * 100,
      exposure: (inBars / (N - start)) * 100,
      enter: ENTER, exit: EXIT, fee: FEE * 100,
    };
  }

  const Lupa = { analyze, CFG, GROUPS, scoreLabel, guessDecimals, fmt: { f0, f1, f2, signed, fc, nf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = Lupa;
  else root.Lupa = Lupa;
})(typeof window !== 'undefined' ? window : globalThis);
