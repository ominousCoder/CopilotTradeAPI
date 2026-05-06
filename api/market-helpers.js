// api/market-helpers.js
// Shared market data utilities — used by both full-scan.js and credit-scan.js
// No spread-building logic here — pure data fetching only

const BASE = () => process.env.TRADIER_BASE_URL;
const KEY = () => process.env.TRADIER_KEY;

const headers = () => ({
  Authorization: `Bearer ${KEY()}`,
  Accept: "application/json"
});

// ------------------------------------------------------------
// Fetch all expirations for a symbol
// ------------------------------------------------------------
export async function fetchExpirations(symbol) {
  const url = `${BASE()}/markets/options/expirations?symbol=${symbol}&includeAllRoots=true`;
  const res = await fetch(url, { headers: headers() });
  const json = await res.json();
  return json?.expirations?.date ?? [];
}

// ------------------------------------------------------------
// Filter expirations to a DTE range
// Default: 14–45 DTE, first 10 results
// Override with { min, max, limit } for tighter windows
// ------------------------------------------------------------
export function filterExpirations(expirations, { min = 14, max = 45, limit = 10 } = {}) {
  const today = new Date();
  return expirations
    .map(exp => {
      const dte = Math.round((new Date(exp + "T12:00:00") - today) / 86400000);
      return { exp, dte };
    })
    .filter(x => x.dte >= min && x.dte <= max)
    .sort((a, b) => a.dte - b.dte)
    .slice(0, limit)
    .map(x => x.exp);
}

// ------------------------------------------------------------
// Fetch option chain for a specific expiration
// Returns { underlying, options } where options is parsed array
// ------------------------------------------------------------
export async function fetchOptionChain(symbol, expiration) {
  const [quoteRes, chainRes] = await Promise.all([
    fetch(`${BASE()}/markets/quotes?symbols=${symbol}`, { headers: headers() }),
    fetch(`${BASE()}/markets/options/chains?symbol=${symbol}&expiration=${expiration}&greeks=true`, { headers: headers() })
  ]);

  const [quoteJson, chainJson] = await Promise.all([
    quoteRes.json(),
    chainRes.json()
  ]);

  const options = chainJson?.options?.option;
  if (!options || options.length === 0) {
    console.log(`[market-helpers] No options for ${symbol} @ ${expiration}`);
    return null;
  }

  const quotes = quoteJson?.quotes?.quote;
  const underlying = Array.isArray(quotes) ? quotes[0]?.last : quotes?.last ?? null;

  if (!underlying) {
    console.log(`[market-helpers] No underlying price for ${symbol}`);
    return null;
  }

  return { underlying, options };
}

// ------------------------------------------------------------
// Fetch RSI for a symbol
// Returns integer RSI or null if insufficient data
// ------------------------------------------------------------
export async function fetchRSI(symbol, lookback = 30) {
  try {
    const start = getPastDate(lookback);
    const url = `${BASE()}/markets/history?symbol=${symbol}&interval=daily&start=${start}`;
    const res = await fetch(url, { headers: headers() });
    const json = await res.json();
    const history = json?.history?.day;
    if (!history || history.length < 15) return null;
    const closes = history.map(d => d.close);
    return calculateRSI(closes, 14);
  } catch (e) {
    console.log(`[market-helpers] RSI fetch failed for ${symbol}:`, e.message);
    return null;
  }
}

// ------------------------------------------------------------
// RSI calculation — Wilder's smoothing method
// ------------------------------------------------------------
function calculateRSI(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------
function getPastDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}
