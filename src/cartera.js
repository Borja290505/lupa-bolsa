/* Lupa — tu cartera, guardada en el servidor y protegida con una clave.
 *
 * Se guarda en un Durable Object (almacenamiento de Cloudflare incluido en el plan gratuito).
 * Así la ves igual en el iPhone y en el ordenador, y nadie más puede leerla.
 * La clave se pone una vez en Cloudflare: tu Worker > Settings > Variables and Secrets > Add,
 * tipo Secret y nombre CLAVE. Desde un ordenador también vale:  npx wrangler secret put CLAVE
 */
import { DurableObject } from 'cloudflare:workers';
import CARTERA_INICIAL from './cartera-inicial.js';
import { HttpError, SYMBOL_RE } from './yahoo.js';

export class Cartera extends DurableObject {
  async leer() {
    return (await this.ctx.storage.get('cartera')) ?? null;
  }
  async guardar(doc) {
    await this.ctx.storage.put('cartera', doc);
    return doc;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

export function validarCartera(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.posiciones)) throw new HttpError(400, 'La cartera no tiene posiciones.');
  if (doc.posiciones.length > 100) throw new HttpError(400, 'Demasiadas posiciones (máximo 100).');
  const ids = new Set();
  const posiciones = doc.posiciones.map((p, i) => {
    const nombre = str(p?.nombre, 80);
    if (!nombre) throw new HttpError(400, `A la posición ${i + 1} le falta el nombre.`);
    const efectivo = p.tipo === 'efectivo';
    const referencia = efectivo ? '' : str(p.referencia, 24).toUpperCase();
    if (!efectivo && !SYMBOL_RE.test(referencia)) throw new HttpError(400, `«${nombre}»: el ticker de referencia no es válido.`);
    const valor = num(p.ref?.valor), invertido = num(p.invertido);
    if (!(valor >= 0)) throw new HttpError(400, `«${nombre}»: el valor no es válido.`);
    if (!(invertido >= 0)) throw new HttpError(400, `«${nombre}»: lo invertido no es válido.`);
    const base = str(p.ref?.base, 10), fecha = str(p.ref?.fecha, 10);
    if (!DATE_RE.test(base) || !DATE_RE.test(fecha)) throw new HttpError(400, `«${nombre}»: la fecha no es válida.`);
    let id = str(p.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '') || `pos-${i + 1}`;
    while (ids.has(id)) id += '-2';
    ids.add(id);
    const precio = num(p.ref?.precio);
    const compras = [...new Set((Array.isArray(p.compras) ? p.compras : []).map((d) => str(d, 10)).filter((d) => DATE_RE.test(d)))].sort().slice(0, 30);
    return {
      id, nombre,
      oficial: str(p.oficial, 140),
      tipo: efectivo ? 'efectivo' : p.tipo === 'accion' ? 'accion' : 'fondo',
      grupo: str(p.grupo, 60) || 'Otros',
      isin: str(p.isin, 12).toUpperCase(),
      indice: str(p.indice, 60),
      referencia,
      ref: { valor: Math.round(valor * 100) / 100, fecha, base, ...(precio > 0 ? { precio } : {}) },
      invertido: Math.round((efectivo ? valor : invertido) * 100) / 100,
      ...(compras.length && !efectivo ? { compras } : {}),
    };
  });
  return { version: 1, actualizado: new Date().toISOString(), fechasMigradas: true, posiciones };
}

function mismaClave(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function handleCartera(request, env, url) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (env.CLAVE) {
    if (!mismaClave(request.headers.get('X-Clave') || '', String(env.CLAVE))) {
      await new Promise((r) => setTimeout(r, 400)); // frena a quien intente adivinarla
      throw new HttpError(401, 'Clave incorrecta.', 'clave');
    }
  } else if (!local) {
    throw new HttpError(503, 'Falta poner la clave de la cartera. En Cloudflare, abre tu Worker y ve a Settings > Variables and Secrets > Add: tipo Secret y nombre CLAVE.', 'sin-clave');
  }
  if (!env.CARTERA) throw new HttpError(500, 'Falta el almacenamiento CARTERA en wrangler.jsonc.');
  const stub = env.CARTERA.get(env.CARTERA.idFromName('principal'));

  if (request.method === 'GET') {
    let doc = await stub.leer();
    if (!doc) doc = await stub.guardar(validarCartera(CARTERA_INICIAL));
    // Carteras guardadas antes de tener fechas de compra: se toman de la cartera inicial
    const semilla = new Map(CARTERA_INICIAL.posiciones.map((p) => [p.id, p]));
    if (!doc.fechasMigradas) {
      for (const p of doc.posiciones) if (!p.compras && semilla.get(p.id)?.compras) p.compras = semilla.get(p.id).compras;
      doc = await stub.guardar({ ...validarCartera(doc), fechasMigradas: true });
    }
    return { cartera: doc };
  }
  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > 100000) throw new HttpError(413, 'La cartera es demasiado grande.');
    let body;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Los datos no son JSON válido.'); }
    const doc = validarCartera(body?.cartera);
    await stub.guardar(doc);
    return { ok: true, cartera: doc };
  }
  throw new HttpError(405, 'Método no permitido.');
}
