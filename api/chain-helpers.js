// ============================================================
// chain-helpers.js — LIGHTWEIGHT DIAGNOSTIC VERSION (FIXED)
// ============================================================

const DEBUG = process.env.DEBUG === "true";

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
// Fetch option chain
// ------------------------------------------------------------
async function fetchOptionChain(symbol, expiration) {
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}?date=${expiration}`;

  const res = await fetch(url);
  const json = await res.json();

  const chain = json?.optionChain?.result?.[0];
  if (!chain) {
    warn(`No chain returned for ${symbol} @ ${expiration}`);
    return null;
  }

  const calls = chain.options?.[0]?.calls?.length ?? 0;
  const puts = chain.options?.[0]?.puts?.length ?? 0;

  debug([
    `Stage: Chain Fetch`,
    `Symbol: ${symbol}`,
    `Expiration: ${expiration}`,
    `Calls: ${calls}`,
    `Puts: ${puts}`
  ]);

  return chain;
}

// ------------------------------------------------------------
// Resolve underlying price
// ------------------------------------------------------------
function resolveUnderlyingPrice(chain) {
  let price = null;
  let source = "unknown";

  if (chain?.quote?.regularMarketPrice) {
    price = chain.quote.regularMarketPrice;
    source = "quote endpoint";
  } else {
    const calls = chain.options?.[0]?.calls ?? [];
    if (calls.length > 0) {
      const atm = calls.reduce((a, b) =>
        Math.abs(b.strike - price) < Math.abs(a.strike - price) ? b : a
      );
      price = atm.strike;
      source = "ATM fallback";
    }
  }

  if (!price) warn("Underlying price could not be resolved.");

  debug([
    "Stage: Underlying Price Resolution",
    `Underlying price: ${price}`,
    `Source: ${source}`
  ]);

  return price;
}

// ------------------------------------------------------------
// Normalize deltas
// ------------------------------------------------------------
function normalizeDeltas(options) {
  let missing = 0;
  let fallback = 0;

  const normalized = options.map((opt) => {
    if (opt.delta == null) {
      missing++;
      const approx = Math.max(0.05, Math.min(0.95, 1 - Math.abs(opt.moneyness)));
      fallback++;
      return { ...opt, delta: approx };
    }
    return opt;
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
// Select bull long legs
// ------------------------------------------------------------
function selectBullLongLegs(calls) {
  const mids = calls.filter((c) => c.delta >= 0.25 && c.delta <= 0.35);

  if (mids.length === 0) warn("No mid-delta calls found.");

  debug([
    "Stage: Bull Long-Leg Selection",
    `Candidates: ${mids.length}`
  ]);

  return mids;
}

// ------------------------------------------------------------
// Select bear long legs
// ------------------------------------------------------------
function selectBearLongLegs(puts) {
  const mids = puts.filter((p) => Math.abs(p.delta) >= 0.25 && Math.abs(p.delta) <= 0.35);

  if (mids.length === 0) warn("No mid-delta puts found.");

  debug([
    "Stage: Bear Long-Leg Selection",
    `Candidates: ${mids.length}`
  ]);

  return mids;
}

// ------------------------------------------------------------
// Build bull spreads
// ------------------------------------------------------------
function buildBullSpreads(longLegs, calls, widths) {
  const spreads = [];

  longLegs.forEach((long) => {
    widths.forEach((w) => {
      const short = calls.find((c) => c.strike === long.strike + w);
      if (short) {
        spreads.push({ type: "bull", long, short, width: w });
      }
    });
  });

  if (spreads.length === 0) warn("No bull spreads built.");

  debug([
    "Stage: Bull Spread Construction",
    `Long legs: ${longLegs.length}`,
    `Spreads built: ${spreads.length}`
  ]);

  return spreads;
}

// ------------------------------------------------------------
// Build bear spreads
// ------------------------------------------------------------
function buildBearSpreads(longLegs, puts, widths) {
  const spreads = [];

  longLegs.forEach((long) => {
    widths.forEach((w) => {
      const short = puts.find((p) => p.strike === long.strike - w);
      if (short) {
        spreads.push({ type: "bear", long, short, width: w });
      }
    });
  });

  if (spreads.length === 0) warn("No bear spreads built.");

  debug([
    "Stage: Bear Spread Construction",
    `Long legs: ${longLegs.length}`,
    `Spreads built: ${spreads.length}`
  ]);

  return spreads;
}

// ------------------------------------------------------------
// Main builder (NO FETCH INSIDE — FIXED)
// ------------------------------------------------------------
async function buildSpreads(chain, symbol, expiration, widths) {
  if (!chain) return [];

  const underlying = resolveUnderlyingPrice(chain);

  const calls = chain.options[0].calls.map((c) => ({
    ...c,
    moneyness: (underlying - c.strike) / underlying
  }));

  const puts = chain.options[0].puts.map((p) => ({
    ...p,
    moneyness: (p.strike - underlying) / underlying
  }));

  const normCalls = normalizeDeltas(calls);
  const normPuts = normalizeDeltas(puts);

  const bullLongs = selectBullLongLegs(normCalls);
  const bearLongs = selectBearLongLegs(normPuts);

  const bullSpreads = buildBullSpreads(bullLongs, normCalls, widths);
  const bearSpreads = buildBearSpreads(bearLongs, normPuts, widths);

  const all = [...bullSpreads, ...bearSpreads];

  if (all.length === 0) warn("All spreads filtered out.");

  debug([
    "Stage: Final Spread Count",
    `Bull: ${bullSpreads.length}`,
    `Bear: ${bearSpreads.length}`,
    `Total: ${all.length}`
  ]);

  return all;
}

module.exports = {
  fetchOptionChain,
  buildSpreads
};
