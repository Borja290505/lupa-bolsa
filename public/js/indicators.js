/* Lupa — indicadores técnicos.
 * Todas las funciones reciben arrays de números y devuelven arrays de la misma
 * longitud, con NaN donde el indicador todavía no tiene datos suficientes.
 * Las fórmulas siguen las definiciones estándar (las mismas que TradingView / TA-Lib).
 */
(function (root) {
  'use strict';

  const isNum = (v) => typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
  const filled = (n) => new Array(n).fill(NaN);

  /* ---------- Medias ---------- */

  function sma(src, n) {
    const len = src.length, out = filled(len);
    let sum = 0, run = 0;
    for (let i = 0; i < len; i++) {
      const v = src[i];
      if (!isNum(v)) { sum = 0; run = 0; continue; }
      sum += v; run++;
      if (run > n) { sum -= src[i - n]; run = n; }
      if (run === n) out[i] = sum / n;
    }
    return out;
  }

  // Media exponencial genérica con semilla SMA. alpha = 2/(n+1) (EMA) o 1/n (Wilder/RMA).
  function smooth(src, n, alpha) {
    const len = src.length, out = filled(len);
    let run = 0, start = -1;
    for (let i = 0; i < len; i++) {
      if (!isNum(src[i])) { run = 0; continue; }
      if (++run === n) { start = i; break; }
    }
    if (start < 0) return out;
    let prev = 0;
    for (let j = start - n + 1; j <= start; j++) prev += src[j];
    prev /= n;
    out[start] = prev;
    for (let i = start + 1; i < len; i++) {
      const v = src[i];
      if (isNum(v)) prev = alpha * v + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }
  const ema = (src, n) => smooth(src, n, 2 / (n + 1));
  const rma = (src, n) => smooth(src, n, 1 / n);

  /* ---------- Ventanas móviles ---------- */

  function rolling(src, n, fn) {
    const len = src.length, out = filled(len);
    for (let i = n - 1; i < len; i++) {
      let ok = true;
      for (let j = i - n + 1; j <= i; j++) if (!isNum(src[j])) { ok = false; break; }
      if (ok) out[i] = fn(src, i - n + 1, i);
    }
    return out;
  }
  const highest = (src, n) => rolling(src, n, (a, s, e) => { let m = -Infinity; for (let j = s; j <= e; j++) if (a[j] > m) m = a[j]; return m; });
  const lowest = (src, n) => rolling(src, n, (a, s, e) => { let m = Infinity; for (let j = s; j <= e; j++) if (a[j] < m) m = a[j]; return m; });
  const sum = (src, n) => rolling(src, n, (a, s, e) => { let t = 0; for (let j = s; j <= e; j++) t += a[j]; return t; });
  // Desviación típica poblacional (igual que TradingView ta.stdev y TA-Lib)
  const stdev = (src, n) => rolling(src, n, (a, s, e) => {
    let m = 0; for (let j = s; j <= e; j++) m += a[j]; m /= n;
    let v = 0; for (let j = s; j <= e; j++) v += (a[j] - m) * (a[j] - m);
    return Math.sqrt(v / n);
  });

  /* ---------- Tendencia ---------- */

  function macd(close, fast = 12, slow = 26, sig = 9) {
    const ef = ema(close, fast), es = ema(close, slow);
    const line = close.map((_, i) => ef[i] - es[i]);
    const signal = ema(line, sig);
    const hist = line.map((v, i) => v - signal[i]);
    return { line, signal, hist };
  }

  function trueRange(h, l, c) {
    const len = h.length, out = filled(len);
    if (!len) return out;
    out[0] = h[0] - l[0];
    for (let i = 1; i < len; i++) {
      out[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    return out;
  }
  const atr = (h, l, c, n = 14) => rma(trueRange(h, l, c), n);

  function dmi(h, l, c, n = 14) {
    const len = h.length, pDM = filled(len), mDM = filled(len), tr = filled(len);
    for (let i = 1; i < len; i++) {
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      pDM[i] = up > down && up > 0 ? up : 0;
      mDM[i] = down > up && down > 0 ? down : 0;
      tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    const trR = rma(tr, n), pR = rma(pDM, n), mR = rma(mDM, n);
    const plus = filled(len), minus = filled(len), dx = filled(len);
    for (let i = 0; i < len; i++) {
      if (!isNum(trR[i]) || trR[i] === 0) continue;
      plus[i] = 100 * pR[i] / trR[i];
      minus[i] = 100 * mR[i] / trR[i];
      const s = plus[i] + minus[i];
      dx[i] = s === 0 ? 0 : 100 * Math.abs(plus[i] - minus[i]) / s;
    }
    return { plus, minus, adx: rma(dx, n) };
  }

  // SAR parabólico (Wilder). dir: 1 alcista (puntos debajo), -1 bajista.
  function psar(h, l, step = 0.02, maxStep = 0.2) {
    const len = h.length, sar = filled(len), dir = new Array(len).fill(0);
    if (len < 3) return { sar, dir };
    let up = h[1] + l[1] >= h[0] + l[0];
    let af = step;
    let ep = up ? Math.max(h[0], h[1]) : Math.min(l[0], l[1]);
    let s = up ? Math.min(l[0], l[1]) : Math.max(h[0], h[1]);
    sar[1] = s; dir[1] = up ? 1 : -1;
    for (let i = 2; i < len; i++) {
      let next = s + af * (ep - s);
      if (up) {
        next = Math.min(next, l[i - 1], l[i - 2]);
        if (l[i] < next) { up = false; next = ep; ep = l[i]; af = step; }
        else if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, maxStep); }
      } else {
        next = Math.max(next, h[i - 1], h[i - 2]);
        if (h[i] > next) { up = true; next = ep; ep = h[i]; af = step; }
        else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, maxStep); }
      }
      s = next; sar[i] = s; dir[i] = up ? 1 : -1;
    }
    return { sar, dir };
  }

  // Supertrend (misma lógica que ta.supertrend de TradingView). dir: 1 alcista, -1 bajista.
  function supertrend(h, l, c, period = 10, factor = 3) {
    const len = h.length, a = atr(h, l, c, period);
    const line = filled(len), dir = new Array(len).fill(0);
    let prevUpper = NaN, prevLower = NaN, prevST = NaN;
    for (let i = 0; i < len; i++) {
      if (!isNum(a[i])) continue;
      const mid = (h[i] + l[i]) / 2;
      let upper = mid + factor * a[i], lower = mid - factor * a[i];
      if (isNum(prevLower)) lower = (lower > prevLower || c[i - 1] < prevLower) ? lower : prevLower;
      if (isNum(prevUpper)) upper = (upper < prevUpper || c[i - 1] > prevUpper) ? upper : prevUpper;
      let d;
      if (!isNum(prevST)) d = -1;                         // empieza bajista como TradingView
      else if (prevST === prevUpper) d = c[i] > upper ? 1 : -1;
      else d = c[i] < lower ? -1 : 1;
      const st = d === 1 ? lower : upper;
      line[i] = st; dir[i] = d;
      prevUpper = upper; prevLower = lower; prevST = st;
    }
    return { line, dir };
  }

  // Ichimoku (9, 26, 52). spanA/spanB son los valores "crudos" de cada vela; en el gráfico
  // se dibujan desplazados 25 velas hacia delante (como TradingView).
  function ichimoku(h, l, conv = 9, base = 26, spanBLen = 52) {
    const mid = (n) => { const hh = highest(h, n), ll = lowest(l, n); return hh.map((v, i) => (v + ll[i]) / 2); };
    const tenkan = mid(conv), kijun = mid(base), spanB = mid(spanBLen);
    const spanA = tenkan.map((v, i) => (v + kijun[i]) / 2);
    return { tenkan, kijun, spanA, spanB, shift: base - 1 };
  }

  function aroon(h, l, n = 25) {
    const len = h.length, up = filled(len), down = filled(len);
    for (let i = n; i < len; i++) {
      let hi = -Infinity, lo = Infinity, hiIdx = i, loIdx = i;
      for (let j = i - n; j <= i; j++) {
        if (h[j] >= hi) { hi = h[j]; hiIdx = j; }
        if (l[j] <= lo) { lo = l[j]; loIdx = j; }
      }
      up[i] = 100 * (n - (i - hiIdx)) / n;
      down[i] = 100 * (n - (i - loIdx)) / n;
    }
    return { up, down };
  }

  // Regresión lineal de los últimos n cierres que terminan en i
  function linreg(src, n, i) {
    if (i - n + 1 < 0) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let k = 0; k < n; k++) {
      const y = src[i - n + 1 + k];
      if (!isNum(y)) return null;
      sx += k; sy += y; sxy += k * y; sxx += k * k;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    const mean = sy / n;
    let ssTot = 0, ssRes = 0;
    for (let k = 0; k < n; k++) {
      const y = src[i - n + 1 + k], f = intercept + slope * k;
      ssTot += (y - mean) * (y - mean); ssRes += (y - f) * (y - f);
    }
    return { slope, intercept, end: intercept + slope * (n - 1), r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
  }

  /* ---------- Momento ---------- */

  function rsi(close, n = 14) {
    const len = close.length, g = filled(len), d = filled(len);
    for (let i = 1; i < len; i++) {
      const ch = close[i] - close[i - 1];
      g[i] = ch > 0 ? ch : 0; d[i] = ch < 0 ? -ch : 0;
    }
    const ag = rma(g, n), al = rma(d, n);
    return ag.map((v, i) => {
      if (!isNum(v) || !isNum(al[i])) return NaN;
      if (al[i] === 0) return v === 0 ? 50 : 100;
      return 100 - 100 / (1 + v / al[i]);
    });
  }

  function stochastic(h, l, c, kLen = 14, kSmooth = 3, dLen = 3) {
    const hh = highest(h, kLen), ll = lowest(l, kLen);
    const raw = c.map((v, i) => {
      if (!isNum(hh[i])) return NaN;
      const r = hh[i] - ll[i];
      return r === 0 ? 50 : 100 * (v - ll[i]) / r;
    });
    const k = sma(raw, kSmooth);
    return { k, d: sma(k, dLen) };
  }

  function stochRsi(close, rsiLen = 14, stLen = 14, kSmooth = 3, dLen = 3) {
    const r = rsi(close, rsiLen);
    const hh = highest(r, stLen), ll = lowest(r, stLen);
    const raw = r.map((v, i) => {
      if (!isNum(hh[i])) return NaN;
      const rg = hh[i] - ll[i];
      return rg === 0 ? 50 : 100 * (v - ll[i]) / rg;
    });
    const k = sma(raw, kSmooth);
    return { k, d: sma(k, dLen) };
  }

  function williamsR(h, l, c, n = 14) {
    const hh = highest(h, n), ll = lowest(l, n);
    return c.map((v, i) => {
      if (!isNum(hh[i])) return NaN;
      const r = hh[i] - ll[i];
      return r === 0 ? -50 : -100 * (hh[i] - v) / r;
    });
  }

  function cci(h, l, c, n = 20) {
    const tp = c.map((v, i) => (h[i] + l[i] + v) / 3);
    const m = sma(tp, n), len = tp.length, out = filled(len);
    for (let i = n - 1; i < len; i++) {
      if (!isNum(m[i])) continue;
      let md = 0;
      for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
      md /= n;
      out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
    }
    return out;
  }

  const roc = (c, n = 12) => c.map((v, i) => (i >= n && c[i - n] !== 0 ? 100 * (v / c[i - n] - 1) : NaN));
  const momentum = (c, n = 10) => c.map((v, i) => (i >= n ? v - c[i - n] : NaN));

  /* ---------- Volatilidad ---------- */

  function bollinger(c, n = 20, mult = 2) {
    const mid = sma(c, n), sd = stdev(c, n);
    const upper = mid.map((m, i) => m + mult * sd[i]);
    const lower = mid.map((m, i) => m - mult * sd[i]);
    const pctB = c.map((v, i) => (upper[i] - lower[i] === 0 ? 0.5 : (v - lower[i]) / (upper[i] - lower[i])));
    const width = mid.map((m, i) => (m ? 100 * (upper[i] - lower[i]) / m : NaN));
    return { mid, upper, lower, pctB, width };
  }

  function keltner(h, l, c, n = 20, mult = 2, atrLen = 10) {
    const mid = ema(c, n), a = atr(h, l, c, atrLen);
    return { mid, upper: mid.map((m, i) => m + mult * a[i]), lower: mid.map((m, i) => m - mult * a[i]) };
  }

  function donchian(h, l, n = 20) {
    const upper = highest(h, n), lower = lowest(l, n);
    return { upper, lower, mid: upper.map((u, i) => (u + lower[i]) / 2) };
  }

  // Volatilidad histórica anualizada (%) de los rendimientos logarítmicos
  function histVol(c, n = 20, periodsPerYear = 252) {
    const r = c.map((v, i) => (i > 0 && c[i - 1] > 0 && v > 0 ? Math.log(v / c[i - 1]) : NaN));
    return stdev(r, n).map((s) => s * Math.sqrt(periodsPerYear) * 100);
  }

  /* ---------- Volumen ---------- */

  function obv(c, v) {
    const len = c.length, out = filled(len);
    if (!len) return out;
    out[0] = 0;
    for (let i = 1; i < len; i++) out[i] = out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0);
    return out;
  }

  function mfi(h, l, c, v, n = 14) {
    const len = c.length, out = filled(len);
    const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
    for (let i = n; i < len; i++) {
      let pos = 0, neg = 0;
      for (let j = i - n + 1; j <= i; j++) {
        const f = tp[j] * v[j];
        if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f;
      }
      out[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
    }
    return out;
  }

  function cmf(h, l, c, v, n = 20) {
    const mfv = c.map((x, i) => {
      const r = h[i] - l[i];
      return r === 0 ? 0 : (((x - l[i]) - (h[i] - x)) / r) * v[i];
    });
    const sMfv = sum(mfv, n), sV = sum(v, n);
    return sMfv.map((s, i) => (sV[i] ? s / sV[i] : NaN));
  }

  function vwapRolling(h, l, c, v, n = 20) {
    const pv = c.map((x, i) => ((h[i] + l[i] + x) / 3) * v[i]);
    const sPv = sum(pv, n), sV = sum(v, n);
    return sPv.map((s, i) => (sV[i] ? s / sV[i] : NaN));
  }

  /* ---------- Puntos de giro (fractales) ---------- */

  // Devuelve los índices de máximos y mínimos locales confirmados con k velas a cada lado.
  function swings(h, l, k = 3) {
    const highs = [], lows = [];
    for (let i = k; i < h.length - k; i++) {
      let isH = true, isL = true;
      for (let j = 1; j <= k; j++) {
        if (!(h[i] >= h[i - j] && h[i] > h[i + j])) isH = false;
        if (!(l[i] <= l[i - j] && l[i] < l[i + j])) isL = false;
        if (!isH && !isL) break;
      }
      if (isH) highs.push(i);
      if (isL) lows.push(i);
    }
    return { highs, lows };
  }

  const TA = {
    isNum, sma, ema, rma, highest, lowest, sum, stdev, macd, trueRange, atr, dmi, psar,
    supertrend, ichimoku, aroon, linreg, rsi, stochastic, stochRsi, williamsR, cci, roc,
    momentum, bollinger, keltner, donchian, histVol, obv, mfi, cmf, vwapRolling, swings,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TA;
  else root.TA = TA;
})(typeof window !== 'undefined' ? window : globalThis);
