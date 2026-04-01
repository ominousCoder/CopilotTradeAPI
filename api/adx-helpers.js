// ============================================================
// adx-helpers.js — ADX + Directional Index chop filter
// ============================================================
// Fetches 30 daily candles from Tradier and computes:
//   - ADX (14-period)        → trend strength (< 25 = choppy)
//   - +DI / -DI              → directional bias
//
// Usage in full-scan.js:
//   const adx = await fetchADX(symbol);
//   if (!adx || adx.adx < 25) continue;
//   if (direction === "bear" && adx.minusDI <= adx.plusDI) continue;
//   if (direction === "bull" && adx.plusDI <= adx.minusDI) continue;
// ============================================================

const BASE = process.env.TRADIER_BASE_URL;
const PERIOD = 14;
const CANDLES_NEEDED = PERIOD * 2 + 2; // warmup buffer

// ------------------------------------------------------------
// Fetch daily OHLC candles from Tradier
// ------------------------------------------------------------
async function fetchCandles(symbol) {
  // Request enough history for warmup
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - CANDLES_NEEDED * 2); // extra buffer for weekends/holidays

  const url = `${BASE}/markets/history?symbol=${symbol}&interval=daily` +
    `&start=${start.toISOString().slice(0, 10)}` +
    `&end=${end.toISOString().slice(0, 10)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.TRADIER_KEY}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) return null;

  const json = await res.json();
  const history = json?.history?.day;
  if (!history) return null;

  // Tradier returns object for 1 day, array for many
  const candles = Array.isArray(history) ? history : [history];

  // Need at least PERIOD + 1 candles
  if (candles.length < PERIOD + 1) return null;

  // Take the most recent CANDLES_NEEDED candles
  return candles.slice(-CANDLES_NEEDED);
}

// ------------------------------------------------------------
// Wilder smoothing (EMA variant used in ADX)
// ------------------------------------------------------------
function wilderSmooth(values, period) {
  const result = new Array(values.length).fill(null);
  // First value: simple sum
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum;
  // Subsequent: Wilder's method
  for (let i = period; i < values.length; i++) {
    result[i] = result[i - 1] - result[i - 1] / period + values[i];
  }
  return result;
}

// ------------------------------------------------------------
// Core ADX calculation
// ------------------------------------------------------------
function calculateADX(candles) {
  const n = candles.length;
  if (n < PERIOD + 1) return null;

  const tr    = new Array(n).fill(0);
  const plusDM  = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);

  // Step 1: True Range and Directional Movement
  for (let i = 1; i < n; i++) {
    const high  = candles[i].high;
    const low   = candles[i].low;
    const pHigh = candles[i - 1].high;
    const pLow  = candles[i - 1].low;
    const pClose = candles[i - 1].close;

    tr[i] = Math.max(
      high - low,
      Math.abs(high - pClose),
      Math.abs(low - pClose)
    );

    const upMove   = high - pHigh;
    const downMove = pLow - low;

    plusDM[i]  = (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
  }

  // Step 2: Wilder smooth TR, +DM, -DM (skip index 0)
  const trSlice     = tr.slice(1);
  const plusSlice   = plusDM.slice(1);
  const minusSlice  = minusDM.slice(1);

  const smoothTR    = wilderSmooth(trSlice, PERIOD);
  const smoothPlus  = wilderSmooth(plusSlice, PERIOD);
  const smoothMinus = wilderSmooth(minusSlice, PERIOD);

  // Step 3: +DI, -DI, DX
  const dx = new Array(trSlice.length).fill(null);
  let plusDIFinal  = null;
  let minusDIFinal = null;

  for (let i = PERIOD - 1; i < trSlice.length; i++) {
    if (!smoothTR[i] || smoothTR[i] === 0) continue;

    const pdi = (smoothPlus[i] / smoothTR[i]) * 100;
    const mdi = (smoothMinus[i] / smoothTR[i]) * 100;
    const diSum = pdi + mdi;

    dx[i] = diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100;

    // Keep the last valid values
    plusDIFinal  = pdi;
    minusDIFinal = mdi;
  }

  // Step 4: ADX = Wilder smooth of DX
  const validDX = dx.filter(v => v !== null);
  if (validDX.length < PERIOD) return null;

  const smoothDX = wilderSmooth(validDX, PERIOD);
  const adxValue = smoothDX[smoothDX.length - 1];

  if (adxValue === null) return null;

  return {
    adx:      Number(adxValue.toFixed(2)),
    plusDI:   Number((plusDIFinal ?? 0).toFixed(2)),
    minusDI:  Number((minusDIFinal ?? 0).toFixed(2))
  };
}

// ------------------------------------------------------------
// Public function: fetch candles + return ADX result
// ------------------------------------------------------------
export async function fetchADX(symbol) {
  try {
    const candles = await fetchCandles(symbol);
    if (!candles) return null;
    return calculateADX(candles);
  } catch (err) {
    console.error(`[adx-helpers] Error for ${symbol}:`, err.message);
    return null;
  }
                     }
