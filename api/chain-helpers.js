// ============================================================
// chain-helpers.js — TRADIER VERSION (ENV-DRIVEN BASE URL)
// ============================================================

const DEBUG = process.env.DEBUG === "true";
const BASE = process.env.TRADIER_BASE_URL;

function debug(lines) {
  if (!DEBUG) return;
  console.log("[DEBUG][chain-helpers]");
  lines.forEach((l) => console.log(l));
}

function warn(message) {
  if (!DEBUG) return;
  console.log("[DEBUG][chain-helpers] WARNING:", message);
}

// ------------------------------------------------------------
// Fetch all expirations for a symbol
// ------------------------------------------------------------
async function fetchExpirations(symbol) {
  const url = `${BASE}/markets/options/expirations?symbol=${symbol}&includeAllRoots=true`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.TRADIER_KEY}`,
      Accept: "application/json"
    }
  });

  const json = await res.json();
  console.log("[DEBUG] Expirations raw response:", JSON.stringify(json));
  return json?.expirations?.date ?? [];
}

// ------------------------------------------------------------
// Filter expirations to 7–45 DTE and take first 10
// ------------------------------------------------------------
function filterExpirations(expirations) {
  const today = new Date();

  const filtered = expirations
    .map((exp) => {
      const d = new Date(exp);
      const dte = Math.round((d - today) / 86400000);
      return { exp, dte };
    })
    .filter((x) => x.dte >= 7 && x.dte <= 45)
    .sort((a, b) => a.dte - b.dte)
    .slice(0, 10);

  debug([
    "Stage: Expiration Filtering",
    `Total expirations: ${expirations.length}`,
    `Filtered (7–45 DTE): ${filtered.length}`
  ]);

  return filtered.map((x) => x.exp);
}

// ------------------------------------------------------------
// Fetch option chain for a specific expiration
// ------------------------------------------------------------
async function fetchOptionChain(symbol, expiration) {
  // Fetch underlying price and chain in parallel
  const [quoteRes, chainRes] = await Promise.all([
    fetch(`${BASE}/markets/quotes?symbols=${symbol}`, {
      headers: {
        Authorization: `Bearer ${process.env.TRADIER_KEY}`,
        Accept: "application/json"
      }
    }),
    fetch(`${BASE}/markets/options/chains?symbol=${symbol}&expiration=${expiration}&greeks=true`, {
      headers: {
        Authorization: `Bearer ${process.env.TRADIER_KEY}`,
        Accept: "application/json"
      }
    })
  ]);

  const [quoteJson, chainJson] = await Promise.all([
    quoteRes.json(),
    chainRes.json()
  ]);

  const options = chainJson?.options?.option;

  if (!options || options.length === 0) {
    warn(`No options returned for ${symbol} @ ${expiration}`);
    return null;
  }

  // FIX 14: Get underlying from quote endpoint
  const quotes = quoteJson?.quotes?.quote;
  const underlying = Array.isArray(quotes) ? quotes[0]?.last : quotes?.last ?? null;

  console.log(`[DEBUG] ${symbol} underlying from quote:`, underlying);

  debug([
    "Stage: Chain Fetch",
    `Symbol: ${symbol}`,
    `Expiration: ${expiration}`,
    `Options: ${options.length}`,
    `Underlying: ${underlying}`
  ]);

  return { underlying, options };
}
// ------------------------------------------------------------
// Normalize deltas (fallback enabled)
// ------------------------------------------------------------
function normalizeDeltas(options, underlying) {
  let missing = 0;
  let fallback = 0;

  const normalized = options.map((opt) => {
    let delta = opt.greeks?.delta;

    if (delta == null) {
      missing++;
      const moneyness = (underlying - opt.strike) / underlying;
      delta = Math.max(0.05, Math.min(0.95, 1 - Math.abs(moneyness)));
      fallback++;
    }

    return { ...opt, delta };
  });

  debug([
    "Stage: Delta Normalization",
    `Options: ${options.length}`,
    `Missing deltas: ${missing}`,
    `Fallback applied: ${fallback}`
  ]);

  return normalized;
}

// ------------------------------------------------------------
// Select mid-delta long legs
// ------------------------------------------------------------
function selectBullLongLegs(calls) {
  return calls.filter((c) => c.delta >= 0.25 && c.delta <= 0.35);
}

function selectBearLongLegs(puts) {
  return puts.filter((p) => Math.abs(p.delta) >= 0.25 && Math.abs(p.delta) <= 0.35);
}

// ------------------------------------------------------------
// Build bull and bear spreads
// ------------------------------------------------------------
function buildBullSpreads(longLegs, calls, widths) {
  const spreads = [];
  longLegs.forEach((long) => {
    widths.forEach((w) => {
      const short = calls.find((c) => c.strike === long.strike + w);
      if (short) spreads.push({ type: "bull", long, short, width: w });
    });
  });
  return spreads;
}

function buildBearSpreads(longLegs, puts, widths) {
  const spreads = [];
  longLegs.forEach((long) => {
    widths.forEach((w) => {
      const short = puts.find((p) => p.strike === long.strike - w);
      if (short) spreads.push({ type: "bear", long, short, width: w });
    });
  });
  return spreads;
}

// ------------------------------------------------------------
// Main builder
// ------------------------------------------------------------
async function buildSpreads(chain, symbol, expiration, widths) {
  if (!chain) return [];

  const { underlying, options } = chain;

  const calls = options.filter((o) => o.option_type === "call");
  const puts = options.filter((o) => o.option_type === "put");

  const normCalls = normalizeDeltas(calls, underlying);
  const normPuts = normalizeDeltas(puts, underlying);

  const bullLongs = selectBullLongLegs(normCalls);
  const bearLongs = selectBearLongLegs(normPuts);

  const bullSpreads = buildBullSpreads(bullLongs, normCalls, widths);
  const bearSpreads = buildBearSpreads(bearLongs, normPuts, widths);

  const all = [...bullSpreads, ...bearSpreads];

  debug([
    "Stage: Final Spread Count",
    `Bull: ${bullSpreads.length}`,
    `Bear: ${bearSpreads.length}`,
    `Total: ${all.length}`
  ]);

  return all;
}

// FIX 2: Changed module.exports to ES module exports for Vercel compatibility
export {
  fetchExpirations,
  filterExpirations,
  fetchOptionChain,
  buildSpreads
};
