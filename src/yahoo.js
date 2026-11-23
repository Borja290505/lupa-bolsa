/* Lupa — acceso a Yahoo Finance (sin dependencias de Cloudflare, se puede probar en Node).
 *
 * Yahoo no tiene API oficial: estos son los mismos accesos que usa su propia web.
 * Uso personal. Si Yahoo cambia algo, el error aparecerá claro en la app.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

// Rango de datos que se pide para cada marco temporal y cuánto se guarda en caché (segundos)
const INTERVALS = {
  '1h': { range: '3mo', ttl: 120 },
  '1d': { range: '3y', ttl: 300 },
  '1wk': { range: '10y', ttl: 3600 },
};

export const SYMBOL_RE = /^[A-Za-z0-9.\-=^&]{1,24}$/;

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// Caché en memoria del propio Worker (complementa a la caché de Cloudflare)
const memo = new Map();
function memoGet(key) {
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  memo.delete(key);
  return null;
}
function memoSet(key, value, ttl) {
  if (memo.size > 300) memo.delete(memo.keys().next().value);
  memo.set(key, { value, exp: Date.now() + ttl * 1000 });
}

// Sesión (cookie + crumb) solo si Yahoo empieza a pedirla
let session = null;
async function getSession(force = false) {
  if (!force && session && Date.now() - session.ts < 30 * 60 * 1000) return session;
  try {
    const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' });
    const raw = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie')].filter(Boolean);
    const cookie = raw.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
    if (!cookie) return null;
    const r2 = await fetch(`${HOSTS[0]}/v1/test/getcrumb`, { headers: { 'User-Agent': UA, Cookie: cookie } });
    const crumb = r2.ok ? (await r2.text()).trim() : '';
    session = { cookie, crumb: crumb && crumb.length < 40 && !crumb.includes('<') ? crumb : '', ts: Date.now() };
    return session;
  } catch {
    return null;
  }
}

async function yahooJson(path, params) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = attempt === 1 ? await getSession(lastStatus === 401) : null;
    for (const host of HOSTS) {
      const qs = new URLSearchParams(params);
      const headers = { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' };
      if (s) { headers.Cookie = s.cookie; if (s.crumb) qs.set('crumb', s.crumb); }
      let res;
      try {
        res = await fetch(`${host}${path}?${qs}`, { headers });
      } catch {
        lastStatus = 502;
        continue;
      }
      if (res.ok) return res.json();
      lastStatus = res.status;
      if (res.status === 404) throw new HttpError(404, 'No hay datos para ese valor.');
    }
    if (![401, 403, 429].includes(lastStatus) && attempt === 0) break;
  }
  if (lastStatus === 429) throw new HttpError(503, 'Yahoo está limitando las peticiones. Espera un minuto y vuelve a intentarlo.');
  throw new HttpError(502, `Yahoo Finance no responde (código ${lastStatus || 'desconocido'}).`);
}

const sig = (x) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(8)) : null);

export function normalizeChart(json, symbol, interval) {
  const res = json?.chart?.result?.[0];
  if (!res) throw new HttpError(404, json?.chart?.error?.description || 'No hay datos para ese valor.');
  const m = res.meta || {};
  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = sig(q.open?.[i]), h = sig(q.high?.[i]), l = sig(q.low?.[i]), c = sig(q.close?.[i]);
    if (o === null || h === null || l === null || c === null || h <= 0) continue;
    const v = q.volume?.[i];
    candles.push([ts[i], o, Math.max(h, o, c), Math.min(l, o, c), c, typeof v === 'number' && v > 0 ? v : 0]);
  }
  // Yahoo a veces repite la última vela (la de "en directo"). Se fusionan las velas que caen
  // en el mismo día (diario) o en la misma semana (semanal) para que no haya fechas repetidas.
  const off = typeof m.gmtoffset === 'number' ? m.gmtoffset : 0;
  const keyOf = (t) => {
    if (interval === '1h') return t;
    const d = new Date((t + off) * 1000);
    if (interval === '1wk') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const merged = [];
  for (const k of candles) {
    const prev = merged[merged.length - 1];
    if (prev && keyOf(prev[0]) === keyOf(k[0])) {
      prev[2] = Math.max(prev[2], k[2]); prev[3] = Math.min(prev[3], k[3]); prev[4] = k[4]; prev[5] = Math.max(prev[5], k[5]);
    } else if (!prev || k[0] > prev[0]) merged.push(k);
  }
  return {
    symbol: m.symbol || symbol,
    name: m.longName || m.shortName || m.symbol || symbol,
    currency: m.currency || '',
    exchange: m.fullExchangeName || m.exchangeName || '',
    type: m.instrumentType || '',
    timezone: m.exchangeTimezoneName || m.timezone || '',
    gmtoffset: off,
    decimals: typeof m.priceHint === 'number' ? m.priceHint : null,
    price: sig(m.regularMarketPrice) ?? merged.at(-1)?.[4] ?? null,
    marketTime: m.regularMarketTime || null,
    interval,
    candles: merged,
  };
}

export async function handleChart(url) {
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const interval = url.searchParams.get('interval') || '1d';
  if (!SYMBOL_RE.test(symbol)) throw new HttpError(400, 'Ticker no válido.');
  const cfg = INTERVALS[interval];
  if (!cfg) throw new HttpError(400, 'Marco temporal no válido (usa 1h, 1d o 1wk).');
  const key = `chart:${symbol}:${interval}`;
  const hit = memoGet(key);
  if (hit) return { body: hit, ttl: cfg.ttl };
  let body;
  try {
    const json = await yahooJson(`/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      range: cfg.range, interval, includePrePost: 'false', events: 'div,split',
    });
    body = normalizeChart(json, symbol, interval);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError(404, `No encuentro datos de «${symbol}». Comprueba el ticker (por ejemplo SAN.MC, AAPL o GC=F).`);
    }
    throw err;
  }
  if (body.candles.length < 2) throw new HttpError(404, `«${symbol}» no tiene suficiente historial.`);
  memoSet(key, body, cfg.ttl);
  return { body, ttl: cfg.ttl };
}

export async function handleSearch(url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 1 || q.length > 40) throw new HttpError(400, 'Búsqueda vacía.');
  const key = `search:${q.toLowerCase()}`;
  const hit = memoGet(key);
  if (hit) return { body: hit, ttl: 86400 };
  const json = await yahooJson('/v1/finance/search', {
    q, quotesCount: '10', newsCount: '0', listsCount: '0', lang: 'es-ES', region: 'ES',
  });
  const body = (json?.quotes || [])
    .filter((x) => x.symbol && x.isYahooFinance !== false)
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || '',
    }));
  memoSet(key, body, 86400);
  return { body, ttl: 86400 };
}

/* ---------- Cotizaciones para la cartera ----------
 * range=5d → precio en directo, cierre anterior y últimos cierres (caché 30 s)
 * range=1y → lo mismo con un año de cierres diarios, para la evolución (caché 1 h)
 */
const QUOTE_TTL = { '5d': 30, '1y': 3600 };

async function getSeries(symbol, range) {
  const key = `q:${symbol}:${range}`;
  const hit = memoGet(key);
  if (hit) return hit;
  let c;
  try {
    c = normalizeChart(await yahooJson(`/v8/finance/chart/${encodeURIComponent(symbol)}`, { range, interval: '1d', includePrePost: 'false' }), symbol, '1d');
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw new HttpError(404, `No encuentro datos de «${symbol}».`);
    throw err;
  }
  const k = c.candles;
  if (!k.length) throw new HttpError(404, `«${symbol}» no tiene cotizaciones.`);
  const day = (t) => new Date((t + c.gmtoffset) * 1000).toISOString().slice(0, 10);
  const last = k[k.length - 1];
  // Si la última vela es la de la sesión del último precio, el cierre anterior es la penúltima
  const sameDay = c.marketTime && day(last[0]) === day(c.marketTime);
  const prevClose = sameDay ? (k.length > 1 ? k[k.length - 2][4] : null) : last[4];
  const out = {
    symbol: c.symbol, name: c.name, currency: c.currency, exchange: c.exchange, type: c.type,
    price: c.price, prevClose, time: c.marketTime,
    closes: k.map((x) => [day(x[0]), x[4]]),
  };
  memoSet(key, out, QUOTE_TTL[range]);
  return out;
}

export async function handleQuotes(url) {
  const raw = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const symbols = [...new Set(raw)];
  if (!symbols.length || symbols.length > 25) throw new HttpError(400, 'Pide entre 1 y 25 tickers.');
  for (const s of symbols) if (!SYMBOL_RE.test(s)) throw new HttpError(400, `Ticker no válido: ${s}`);
  const range = url.searchParams.get('range') === '1y' ? '1y' : '5d';
  const results = await Promise.allSettled(symbols.map((s) => getSeries(s, range)));
  const body = results.map((r, i) => (r.status === 'fulfilled' ? r.value : { symbol: symbols[i], error: r.reason?.message || 'Error al pedir el precio' }));
  return { body, ttl: QUOTE_TTL[range] };
}
