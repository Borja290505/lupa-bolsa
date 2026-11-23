/* Lupa — diccionario de nombres → tickers de Yahoo Finance.
 * Sirve para que puedas escribir "santander" u "oro" en vez de SAN.MC o GC=F.
 * Cualquier otro valor se busca en Yahoo directamente.
 */
(function (root) {
  'use strict';
  // s: ticker, n: nombre, a: otros nombres, g: grupo
  const L = [
    // España (Bolsa de Madrid)
    { s: 'SAN.MC', n: 'Banco Santander', a: ['santander'], g: 'España' },
    { s: 'BBVA.MC', n: 'BBVA', a: ['bilbao vizcaya'], g: 'España' },
    { s: 'ITX.MC', n: 'Inditex', a: ['zara'], g: 'España' },
    { s: 'IBE.MC', n: 'Iberdrola', a: [], g: 'España' },
    { s: 'TEF.MC', n: 'Telefónica', a: ['movistar'], g: 'España' },
    { s: 'REP.MC', n: 'Repsol', a: [], g: 'España' },
    { s: 'CABK.MC', n: 'CaixaBank', a: ['caixa', 'la caixa'], g: 'España' },
    { s: 'SAB.MC', n: 'Banco Sabadell', a: ['sabadell'], g: 'España' },
    { s: 'BKT.MC', n: 'Bankinter', a: [], g: 'España' },
    { s: 'UNI.MC', n: 'Unicaja Banco', a: ['unicaja'], g: 'España' },
    { s: 'AENA.MC', n: 'Aena', a: ['aeropuertos'], g: 'España' },
    { s: 'AMS.MC', n: 'Amadeus', a: [], g: 'España' },
    { s: 'FER.MC', n: 'Ferrovial', a: [], g: 'España' },
    { s: 'ACS.MC', n: 'ACS', a: ['florentino'], g: 'España' },
    { s: 'ANA.MC', n: 'Acciona', a: [], g: 'España' },
    { s: 'ANE.MC', n: 'Acciona Energía', a: [], g: 'España' },
    { s: 'CLNX.MC', n: 'Cellnex', a: [], g: 'España' },
    { s: 'ELE.MC', n: 'Endesa', a: [], g: 'España' },
    { s: 'NTGY.MC', n: 'Naturgy', a: ['gas natural fenosa'], g: 'España' },
    { s: 'ENG.MC', n: 'Enagás', a: [], g: 'España' },
    { s: 'RED.MC', n: 'Redeia', a: ['red electrica'], g: 'España' },
    { s: 'SLR.MC', n: 'Solaria', a: [], g: 'España' },
    { s: 'GRF.MC', n: 'Grifols', a: [], g: 'España' },
    { s: 'ROVI.MC', n: 'Laboratorios Rovi', a: ['rovi'], g: 'España' },
    { s: 'IAG.MC', n: 'IAG', a: ['iberia', 'british airways', 'vueling'], g: 'España' },
    { s: 'MAP.MC', n: 'Mapfre', a: [], g: 'España' },
    { s: 'MRL.MC', n: 'Merlin Properties', a: ['merlin'], g: 'España' },
    { s: 'COL.MC', n: 'Inmobiliaria Colonial', a: ['colonial'], g: 'España' },
    { s: 'IDR.MC', n: 'Indra', a: [], g: 'España' },
    { s: 'LOG.MC', n: 'Logista', a: [], g: 'España' },
    { s: 'FDR.MC', n: 'Fluidra', a: [], g: 'España' },
    { s: 'SCYR.MC', n: 'Sacyr', a: [], g: 'España' },
    { s: 'MTS.MC', n: 'ArcelorMittal', a: ['arcelor'], g: 'España' },
    { s: 'ACX.MC', n: 'Acerinox', a: [], g: 'España' },
    { s: 'PUIG.MC', n: 'Puig', a: [], g: 'España' },
    { s: 'MEL.MC', n: 'Meliá Hotels', a: ['melia'], g: 'España' },
    { s: 'VIS.MC', n: 'Viscofan', a: [], g: 'España' },
    { s: 'EBRO.MC', n: 'Ebro Foods', a: ['ebro'], g: 'España' },
    { s: 'CIE.MC', n: 'CIE Automotive', a: ['cie'], g: 'España' },
    { s: 'CAF.MC', n: 'CAF', a: ['construcciones auxiliar de ferrocarriles'], g: 'España' },
    { s: 'PHM.MC', n: 'PharmaMar', a: ['pharma mar'], g: 'España' },
    { s: 'TRE.MC', n: 'Técnicas Reunidas', a: [], g: 'España' },
    { s: 'A3M.MC', n: 'Atresmedia', a: ['antena 3'], g: 'España' },
    { s: 'GEST.MC', n: 'Gestamp', a: [], g: 'España' },
    { s: 'ENC.MC', n: 'Ence', a: [], g: 'España' },
    { s: 'FAE.MC', n: 'Faes Farma', a: ['faes'], g: 'España' },
    // Estados Unidos
    { s: 'AAPL', n: 'Apple', a: ['iphone'], g: 'EE. UU.' },
    { s: 'MSFT', n: 'Microsoft', a: [], g: 'EE. UU.' },
    { s: 'NVDA', n: 'Nvidia', a: [], g: 'EE. UU.' },
    { s: 'AMZN', n: 'Amazon', a: [], g: 'EE. UU.' },
    { s: 'GOOGL', n: 'Alphabet (Google)', a: ['google', 'alphabet', 'youtube'], g: 'EE. UU.' },
    { s: 'META', n: 'Meta Platforms', a: ['facebook', 'instagram', 'whatsapp', 'meta'], g: 'EE. UU.' },
    { s: 'TSLA', n: 'Tesla', a: [], g: 'EE. UU.' },
    { s: 'NFLX', n: 'Netflix', a: [], g: 'EE. UU.' },
    { s: 'AMD', n: 'AMD', a: [], g: 'EE. UU.' },
    { s: 'INTC', n: 'Intel', a: [], g: 'EE. UU.' },
    { s: 'AVGO', n: 'Broadcom', a: [], g: 'EE. UU.' },
    { s: 'ORCL', n: 'Oracle', a: [], g: 'EE. UU.' },
    { s: 'PLTR', n: 'Palantir', a: [], g: 'EE. UU.' },
    { s: 'CRM', n: 'Salesforce', a: [], g: 'EE. UU.' },
    { s: 'ADBE', n: 'Adobe', a: [], g: 'EE. UU.' },
    { s: 'UBER', n: 'Uber', a: [], g: 'EE. UU.' },
    { s: 'DIS', n: 'Disney', a: [], g: 'EE. UU.' },
    { s: 'KO', n: 'Coca-Cola', a: ['cocacola', 'coca cola'], g: 'EE. UU.' },
    { s: 'PEP', n: 'PepsiCo', a: ['pepsi'], g: 'EE. UU.' },
    { s: 'MCD', n: "McDonald's", a: ['mcdonalds'], g: 'EE. UU.' },
    { s: 'NKE', n: 'Nike', a: [], g: 'EE. UU.' },
    { s: 'SBUX', n: 'Starbucks', a: [], g: 'EE. UU.' },
    { s: 'WMT', n: 'Walmart', a: [], g: 'EE. UU.' },
    { s: 'COST', n: 'Costco', a: [], g: 'EE. UU.' },
    { s: 'JPM', n: 'JPMorgan Chase', a: ['jp morgan', 'jpmorgan'], g: 'EE. UU.' },
    { s: 'BAC', n: 'Bank of America', a: [], g: 'EE. UU.' },
    { s: 'GS', n: 'Goldman Sachs', a: [], g: 'EE. UU.' },
    { s: 'V', n: 'Visa', a: [], g: 'EE. UU.' },
    { s: 'MA', n: 'Mastercard', a: [], g: 'EE. UU.' },
    { s: 'PYPL', n: 'PayPal', a: [], g: 'EE. UU.' },
    { s: 'BRK-B', n: 'Berkshire Hathaway', a: ['berkshire', 'buffett'], g: 'EE. UU.' },
    { s: 'JNJ', n: 'Johnson & Johnson', a: ['johnson'], g: 'EE. UU.' },
    { s: 'PFE', n: 'Pfizer', a: [], g: 'EE. UU.' },
    { s: 'LLY', n: 'Eli Lilly', a: ['lilly'], g: 'EE. UU.' },
    { s: 'NVO', n: 'Novo Nordisk', a: ['novo', 'ozempic'], g: 'EE. UU.' },
    { s: 'XOM', n: 'ExxonMobil', a: ['exxon'], g: 'EE. UU.' },
    { s: 'CVX', n: 'Chevron', a: [], g: 'EE. UU.' },
    { s: 'BA', n: 'Boeing', a: [], g: 'EE. UU.' },
    { s: 'F', n: 'Ford', a: [], g: 'EE. UU.' },
    { s: 'GM', n: 'General Motors', a: [], g: 'EE. UU.' },
    { s: 'COIN', n: 'Coinbase', a: [], g: 'EE. UU.' },
    { s: 'MSTR', n: 'Strategy (MicroStrategy)', a: ['microstrategy'], g: 'EE. UU.' },
    { s: 'SPY', n: 'ETF S&P 500 (SPY)', a: ['spy'], g: 'EE. UU.' },
    { s: 'QQQ', n: 'ETF Nasdaq 100 (QQQ)', a: ['qqq'], g: 'EE. UU.' },
    { s: 'GLD', n: 'ETF de oro (GLD)', a: ['gld'], g: 'EE. UU.' },
    // Materias primas (futuros)
    { s: 'GC=F', n: 'Oro', a: ['gold', 'oro'], g: 'Materias primas' },
    { s: 'SI=F', n: 'Plata', a: ['silver', 'plata'], g: 'Materias primas' },
    { s: 'PL=F', n: 'Platino', a: ['platinum'], g: 'Materias primas' },
    { s: 'HG=F', n: 'Cobre', a: ['copper'], g: 'Materias primas' },
    { s: 'BZ=F', n: 'Petróleo Brent', a: ['brent', 'petroleo'], g: 'Materias primas' },
    { s: 'CL=F', n: 'Petróleo WTI', a: ['wti', 'crudo', 'texas'], g: 'Materias primas' },
    { s: 'NG=F', n: 'Gas natural', a: ['gas'], g: 'Materias primas' },
    { s: 'ZW=F', n: 'Trigo', a: ['wheat'], g: 'Materias primas' },
    { s: 'ZC=F', n: 'Maíz', a: ['corn', 'maiz'], g: 'Materias primas' },
    { s: 'KC=F', n: 'Café', a: ['coffee', 'cafe'], g: 'Materias primas' },
    { s: 'CC=F', n: 'Cacao', a: ['cocoa'], g: 'Materias primas' },
    // Índices
    { s: '^IBEX', n: 'IBEX 35', a: ['ibex', 'ibex35'], g: 'Índices' },
    { s: '^GSPC', n: 'S&P 500', a: ['sp500', 's&p', 'sp 500'], g: 'Índices' },
    { s: '^NDX', n: 'Nasdaq 100', a: ['nasdaq'], g: 'Índices' },
    { s: '^IXIC', n: 'Nasdaq Composite', a: [], g: 'Índices' },
    { s: '^DJI', n: 'Dow Jones', a: ['dow'], g: 'Índices' },
    { s: '^STOXX50E', n: 'Euro Stoxx 50', a: ['eurostoxx', 'stoxx'], g: 'Índices' },
    { s: '^GDAXI', n: 'DAX 40', a: ['dax', 'alemania'], g: 'Índices' },
    { s: '^FCHI', n: 'CAC 40', a: ['cac', 'francia'], g: 'Índices' },
    { s: '^FTSE', n: 'FTSE 100', a: ['ftse', 'londres'], g: 'Índices' },
    { s: '^N225', n: 'Nikkei 225', a: ['nikkei', 'japon'], g: 'Índices' },
    { s: '^VIX', n: 'VIX (volatilidad)', a: ['vix', 'miedo'], g: 'Índices' },
    // Criptomonedas
    { s: 'BTC-USD', n: 'Bitcoin', a: ['btc'], g: 'Cripto' },
    { s: 'BTC-EUR', n: 'Bitcoin en euros', a: ['btc eur'], g: 'Cripto' },
    { s: 'ETH-USD', n: 'Ethereum', a: ['eth', 'ether'], g: 'Cripto' },
    { s: 'XRP-USD', n: 'XRP', a: ['ripple', 'xrp'], g: 'Cripto' },
    { s: 'SOL-USD', n: 'Solana', a: ['sol'], g: 'Cripto' },
    { s: 'ADA-USD', n: 'Cardano', a: ['ada'], g: 'Cripto' },
    { s: 'DOGE-USD', n: 'Dogecoin', a: ['doge'], g: 'Cripto' },
    // Divisas
    { s: 'EURUSD=X', n: 'Euro / dólar', a: ['eurusd', 'eur usd', 'euro dolar'], g: 'Divisas' },
    { s: 'EURGBP=X', n: 'Euro / libra', a: ['eurgbp', 'euro libra'], g: 'Divisas' },
    { s: 'USDJPY=X', n: 'Dólar / yen', a: ['usdjpy', 'dolar yen'], g: 'Divisas' },
    { s: 'EURCHF=X', n: 'Euro / franco suizo', a: ['eurchf'], g: 'Divisas' },
  ];

  const POPULAR = {
    'España': ['SAN.MC', 'BBVA.MC', 'ITX.MC', 'IBE.MC', 'TEF.MC', 'REP.MC'],
    'EE. UU.': ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN'],
    'Materias primas': ['GC=F', 'SI=F', 'BZ=F'],
    'Índices': ['^IBEX', '^GSPC', '^NDX'],
    'Cripto': ['BTC-USD', 'XRP-USD', 'ETH-USD'],
  };

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9&^=.\- ]/g, '').trim();
  for (const it of L) it.k = [it.n, it.s, ...it.a].map(norm);
  const bySymbol = new Map(L.map((it) => [it.s, it]));

  // Coincidencias locales ordenadas: exacta > empieza por > contiene
  function search(q, limit = 8) {
    const n = norm(q);
    if (!n) return [];
    const scored = [];
    for (const it of L) {
      let best = 0;
      for (const k of it.k) {
        if (k === n) best = Math.max(best, 3);
        else if (k.startsWith(n)) best = Math.max(best, 2);
        else if (n.length >= 3 && k.includes(n)) best = Math.max(best, 1);
      }
      if (best) scored.push({ it, best });
    }
    scored.sort((a, b) => b.best - a.best);
    return scored.slice(0, limit).map((x) => x.it);
  }

  function exact(q) {
    const n = norm(q);
    return L.find((it) => it.k.includes(n)) || null;
  }

  root.Tickers = { list: L, POPULAR, search, exact, get: (s) => bySymbol.get(s) || null, norm };
})(typeof window !== 'undefined' ? window : globalThis);
