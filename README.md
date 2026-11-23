# Lupa: mi cartera y análisis técnico

Lupa tiene dos pestañas:

- **Mi cartera**: tus fondos y acciones de MyInvestor con el valor total en directo, lo ganado o perdido desde que
  invertiste, cuánto se mueve hoy, la evolución, el reparto y el detalle de cada posición.
- **Analizar**: el análisis técnico de cualquier acción, índice, materia prima o cripto (indicadores, tendencia,
  entrada y salida). Desde el detalle de cada fondo puedes abrir el análisis de su índice.

## Publicarla desde el móvil

Este repositorio tiene que ser **privado**: lleva los importes de tu cartera en `src/cartera-inicial.js`.

1. Entra en [dash.cloudflare.com](https://dash.cloudflare.com) (la cuenta es gratis).
2. Ve a **Workers & Pages** > **Create application** y pulsa **Get started** junto a **Import a repository**.
3. Conecta tu cuenta de GitHub y elige el repositorio `lupa-bolsa`. Deja el nombre `lupa-bolsa` y el resto
   como viene, y pulsa **Save and Deploy**.
4. Cuando termine, ve a **Settings** > **Variables and Secrets** > **Add**. Elige el tipo **Secret**, pon de
   nombre `CLAVE` y como valor la clave que quieras (8 caracteres o más). Pulsa **Deploy**.
5. Abre en Safari la dirección `.workers.dev` que te da Cloudflare, escribe la clave y pulsa Compartir >
   «Añadir a pantalla de inicio».

La clave protege tu cartera: sin ella nadie puede verla aunque tenga la dirección. La app te la pide una
vez en cada dispositivo.

El almacenamiento de la cartera (un Durable Object, incluido en el plan gratuito) se crea solo al publicar.
Cada vez que se sube un cambio a este repositorio, Cloudflare vuelve a publicar la app sola.

## Desde un ordenador

Necesitas Node.js. Desde esta carpeta:

```bash
npm install                    # instala wrangler (solo la primera vez)
npx wrangler login             # solo si no tienes la sesión iniciada
npm run deploy                 # la publica y te da la dirección .workers.dev
npx wrangler secret put CLAVE  # pon la clave de tu cartera (solo una vez)
```

Para probarla en el ordenador: `npm run dev` y abre http://localhost:8787. En local no pide clave y la
cartera de prueba se guarda aparte (en la carpeta `.wrangler`).

## Cómo calcula el valor en directo

Los fondos solo publican un precio oficial al día (el valor liquidativo), y llega con un día de retraso.
Para darte el valor en directo, Lupa sigue un ETF que cotiza en euros y replica el mismo índice:

    valor ahora = valor que daba MyInvestor × (precio del ETF ahora / precio del ETF ese día)

| Posición | Índice | Referencia en directo |
|---|---|---|
| iShares US Equity Index (clase S) | S&P 500 | SXR8.DE |
| iShares Developed World | MSCI World Screened | EUNL.DE |
| iShares Emerging Markets | MSCI Emerging Markets | EUNM.DE |
| Fidelity MSCI Japan | MSCI Japan | EUNN.DE |
| Fidelity MSCI Europe | MSCI Europe | EUNK.DE |
| Fidelity MSCI Pacific ex-Japan | MSCI Pacific ex-Japan | SXR1.DE |
| Vanguard US Equity Index (cubierto a euros) | S&P 500 en euros | IBCF.DE |
| Fidelity MSCI World | MSCI World | EUNL.DE |
| Solaria Energía | (acción) | SLR.MC |

Es una estimación: puede diferir unas décimas de lo que verás en MyInvestor, que se pone al día al día siguiente.

## Mantenerla al día

Cuando hagas una aportación, compres o vendas, o si ves que se aleja de MyInvestor: pulsa **Editar** y copia
los dos números que te enseña MyInvestor en cada posición (el valor y la ganancia o pérdida). Desde ahí
puedes añadir o quitar posiciones. En «Más datos» está el ticker de referencia: en un fondo, un ETF del mismo
índice; en una acción o ETF, su propio ticker de Yahoo Finance.

La cartera inicial (la de tus capturas del 23/11/2026) está en `src/cartera-inicial.js` y solo se usa la
primera vez. Si subes el proyecto a GitHub, que el repositorio sea privado.

## Cómo está hecha

| Archivo | Qué hay |
|---|---|
| `src/worker.js` | El servidor (Cloudflare Worker): rutas `/api/...` y la web. |
| `src/yahoo.js` | Acceso a Yahoo Finance: velas, búsqueda y precios en directo. |
| `src/cartera.js` | Tu cartera guardada en un Durable Object y protegida con la clave. |
| `src/cartera-inicial.js` | La cartera de partida. |
| `public/js/cartera.js` | Pestaña Mi cartera: total, evolución, posiciones, detalle y edición. |
| `public/js/indicators.js` | Fórmulas de los indicadores (comprobadas contra la librería `ta` de Python). |
| `public/js/analysis.js` | Motor del análisis: puntuación, tendencia, niveles, entrada, salida y backtest. |
| `public/js/app.js`, `chart.js`, `tickers.js` | Pestaña Analizar: buscador, gráfico y secciones. |

## Límites

- Yahoo Finance no tiene API oficial: Lupa usa el mismo acceso que su propia web, para uso personal.
  Si un día falla, la app lo dice y usa el último valor guardado.
- Las cotizaciones de las bolsas europeas llegan con unos 15 minutos de retraso.
- El análisis técnico son cálculos automáticos, no recomendaciones de inversión.

## Créditos

- Gráficos: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/), © TradingView, Inc. (licencia Apache 2.0, en `public/vendor/`).
- Tipografía: Archivo (licencia SIL OFL, en `public/fonts/`).
