/* Cartera inicial: copiada de las capturas de MyInvestor del 23/11/2026 (20:10).
 *
 * ref.valor  → lo que mostraba MyInvestor ese día
 * invertido  → valor − ganancia/pérdida que mostraba MyInvestor
 * referencia → ETF que cotiza en directo en euros y sigue el mismo índice que el fondo
 *              (en la acción, su propio ticker)
 * ref.base   → día cuyo cierre de la referencia corresponde a ese valor. Los fondos publican
 *              su valor liquidativo con un día de retraso, así que se anclan al 20/11 (viernes);
 *              la acción, al cierre del propio 23/11.
 *
 * Solo se usa la primera vez: después la cartera se guarda en el servidor y se edita desde la app.
 * Si subes el proyecto a GitHub, que el repositorio sea privado.
 */
const FUNDS_REF = { fecha: '2026-11-23', base: '2026-11-20' };

export default {
  version: 1,
  actualizado: '2026-11-23T19:10:00.000Z',
  posiciones: [
    {
      id: 'ishares-us', compras: ['2026-10-24', '2026-10-27', '2026-11-12'], nombre: 'iShares US Equity Index', oficial: 'iShares US Index Fund (IE) clase S Acc EUR',
      tipo: 'fondo', grupo: 'Cartera automatizada', isin: 'IE000N4ZYX28', indice: 'S&P 500',
      referencia: 'SXR8.DE', ref: { valor: 139.31, ...FUNDS_REF }, invertido: 152.18,
    },
    {
      id: 'ishares-world', compras: ['2026-10-24', '2026-10-27', '2026-11-12'], nombre: 'iShares Developed World', oficial: 'iShares Developed World Screened Index Fund (IE) D Acc EUR',
      tipo: 'fondo', grupo: 'Cartera automatizada', isin: 'IE000N51F726', indice: 'MSCI World Screened',
      referencia: 'EUNL.DE', ref: { valor: 71.46, ...FUNDS_REF }, invertido: 78.06,
    },
    {
      id: 'ishares-em', compras: ['2026-10-24', '2026-10-27', '2026-11-12'], nombre: 'iShares Emerging Markets', oficial: 'iShares Emerging Markets Index Fund (IE) clase S Acc EUR',
      tipo: 'fondo', grupo: 'Cartera automatizada', isin: 'IE000QAZP7L2', indice: 'MSCI Emerging Markets',
      referencia: 'EUNM.DE', ref: { valor: 48.76, ...FUNDS_REF }, invertido: 53.78,
    },
    {
      id: 'fidelity-japan', compras: ['2026-10-24', '2026-10-27', '2026-11-12'], nombre: 'Fidelity MSCI Japan', oficial: 'Fidelity MSCI Japan Index Fund P-ACC-EUR',
      tipo: 'fondo', grupo: 'Cartera automatizada', isin: 'IE00BYX5N771', indice: 'MSCI Japan',
      referencia: 'EUNN.DE', ref: { valor: 43.53, ...FUNDS_REF }, invertido: 47.37,
    },
    {
      id: 'fidelity-europe', compras: ['2026-10-24', '2026-10-27', '2026-11-12'], nombre: 'Fidelity MSCI Europe', oficial: 'Fidelity MSCI Europe Index Fund P-ACC-EUR',
      tipo: 'fondo', grupo: 'Cartera automatizada', isin: 'IE00BYX5MD61', indice: 'MSCI Europe',
      referencia: 'EUNK.DE', ref: { valor: 28.79, ...FUNDS_REF }, invertido: 29.75,
    },
    {
      id: 'fidelity-pacific', compras: ['2026-10-24', '2026-10-27', '2026-11-12'], nombre: 'Fidelity MSCI Pacific ex-Japan', oficial: 'Fidelity MSCI Pacific ex-Japan Index Fund P-ACC-USD',
      tipo: 'fondo', grupo: 'Cartera automatizada', isin: 'IE00BDZVHT63', indice: 'MSCI Pacific ex-Japan',
      referencia: 'SXR1.DE', ref: { valor: 13.1, ...FUNDS_REF }, invertido: 14.03,
    },
    {
      id: 'vanguard-us', compras: ['2026-10-24', '2026-10-27', '2026-11-12'], nombre: 'Vanguard US Equity Index', oficial: 'Vanguard U.S. 500 Stock Index Fund EUR Hedged Acc',
      tipo: 'fondo', grupo: 'Cartera automatizada', isin: 'IE00B1G3DH73', indice: 'S&P 500 con cobertura a euros',
      referencia: 'IBCF.DE', ref: { valor: 9.44, ...FUNDS_REF }, invertido: 10.51,
    },
    {
      id: 'efectivo-automatizada', nombre: 'Efectivo', oficial: '',
      tipo: 'efectivo', grupo: 'Cartera automatizada', isin: '', indice: '',
      referencia: '', ref: { valor: 53.04, fecha: '2026-11-23', base: '2026-11-23' }, invertido: 53.04,
    },
    {
      id: 'fidelity-world', compras: ['2026-10-23', '2026-11-18'], nombre: 'Fidelity MSCI World', oficial: 'Fidelity MSCI World Index Fund P-ACC-EUR',
      tipo: 'fondo', grupo: 'Fondos de inversión', isin: 'IE00BYX5NX33', indice: 'MSCI World',
      referencia: 'EUNL.DE', ref: { valor: 151.87, ...FUNDS_REF }, invertido: 162.84,
    },
    {
      id: 'solaria', compras: ['2026-11-11', '2026-11-18'], nombre: 'Solaria Energía', oficial: 'Solaria Energía y Medio Ambiente',
      tipo: 'accion', grupo: 'Acciones y ETF', isin: '', indice: '',
      referencia: 'SLR.MC', ref: { valor: 84.21, fecha: '2026-11-23', base: '2026-11-23' }, invertido: 104.27,
    },
  ],
};
