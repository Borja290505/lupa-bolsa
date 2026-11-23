/* Lupa — servidor (Cloudflare Worker)
 *
 * El navegador no puede pedir datos a Yahoo Finance directamente (lo bloquea CORS),
 * así que este Worker hace de intermediario y además guarda tu cartera:
 *   GET /api/chart?symbol=SAN.MC&interval=1d     → velas para el análisis técnico
 *   GET /api/search?q=santander                  → búsqueda de tickers
 *   GET /api/quotes?symbols=SXR8.DE,SLR.MC       → precios en directo (range=1y para el historial)
 *   GET/PUT /api/cartera  (cabecera X-Clave)     → tu cartera
 *   GET /api/health                              → comprobación rápida
 * Todo lo demás se sirve desde la carpeta /public (la web).
 */
import { HttpError, handleChart, handleSearch, handleQuotes } from './yahoo.js';
import { Cartera, handleCartera } from './cartera.js';

export { Cartera };

function json(body, status = 200, ttl = 0, cors = true) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
  };
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  return new Response(JSON.stringify(body), { status, headers });
}

async function withEdgeCache(request, ctx, produce) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  const res = await produce();
  if (cache && res.ok && ctx?.waitUntil) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

const PUBLIC_GET = {
  '/api/chart': handleChart,
  '/api/search': handleSearch,
  '/api/quotes': handleQuotes,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('No encontrado', { status: 404 });
    }
    try {
      if (url.pathname === '/api/cartera') {
        // Sin CORS: solo la propia web puede leer o cambiar la cartera
        return json(await handleCartera(request, env, url), 200, 0, false);
      }
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
      }
      if (request.method !== 'GET') return json({ error: 'Método no permitido' }, 405);
      if (url.pathname === '/api/health') return json({ ok: true, time: new Date().toISOString() });
      const handler = PUBLIC_GET[url.pathname];
      if (!handler) return json({ error: 'Ruta no encontrada' }, 404);
      return await withEdgeCache(request, ctx, async () => {
        const r = await handler(url);
        return json(r.body, 200, r.ttl);
      });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const cors = url.pathname !== '/api/cartera';
      return json({ error: err.message || 'Error inesperado', code: err.code }, status, 0, cors);
    }
  },
};
