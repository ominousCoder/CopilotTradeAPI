// api/chain-helpers.js

const ALLOWED_WIDTHS = [0.5, 1, 2, 2.5, 5];
const MIN_DELTA = 0.2;
const MAX_DELTA = 0.35;

// Small helper to compare float widths safely
function isAllowedWidth(width) {
  return ALLOWED_WIDTHS.some(w => Math.abs(width - w) < 1e-6);
}

export async function fetchOptionChain(symbol) {
  // 1) Get expirations
  const expUrl = new URL("https://api.tradier.com/v1/markets/options/expirations");
  expUrl.searchParams.set("symbol", symbol);
  expUrl.searchParams.set("includeAllRoots", "true");
  expUrl.searchParams.set("strikes", "false");

  const expResponse = await fetch(expUrl.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.TRADIER_KEY}`,
      Accept: "application/json"
    }
  });

  if (!expResponse.ok) {
    console.error(`Expirations fetch failed for ${symbol}:`, expResponse.status, await expResponse.text());
    return null;
  }

  const expData = await expResponse.json();
  const expirations = expData?.expirations?.date;
  if (!expirations || expirations.length === 0) {
    console.error(`No expirations found for ${symbol}`);
    return null;
  }

  // For now: use the nearest expiration
  const expiration = Array.isArray(expirations) ? expirations[0] : expirations;

  // 2) Get option chain (with greeks so we have delta)
  const chainUrl = new URL("https://api.tradier.com/v1/markets/options/chains");
  chainUrl.searchParams.set("symbol", symbol);
  chainUrl.searchParams.set("expiration", expiration);
  chainUrl.searchParams.set("greeks", "true");

  const response = await fetch(chainUrl.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.TRADIER_KEY}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    console.error(`Chain fetch failed for ${symbol}:`, response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const raw = data?.options?.option;
  if (!raw) {
    console.error(`No options data for ${symbol}`);
    return null;
  }

  const chain = Array.isArray(raw) ? raw : [raw];

  // Normalize a bit and filter out totally unusable quotes
  return chain.filter(opt => {
    const hasBidAsk = typeof opt.bid === "number" && typeof opt.ask === "number";
    const hasStrike = typeof opt.strike === "number";
    const hasDelta = typeof opt.delta === "number";
    return hasBidAsk && hasStrike && hasDelta;
  });
}

// Build bull call debit spreads (defined risk, mid-delta)
export function buildBullSpreads(chain) {
  const spreads = [];

  // Long leg: call, mid-delta
  const longCandidates = chain.filter(opt => {
    return (
      opt.option_type === "call" &&
      typeof opt.delta === "number" &&
      opt.delta >= MIN_DELTA &&
      opt.delta <= MAX_DELTA
    );
  });

  // Short leg: call above long, width in allowed set
  for (const long of longCandidates) {
    const longStrike = long.strike;
    const longMid = (long.bid + long.ask) / 2;

    const shortCandidates = chain.filter(opt => {
      if (opt.option_type !== "call") return false;
      if (opt.strike <= longStrike) return false;

      const width = opt.strike - longStrike;
      return isAllowedWidth(width);
    });

    for (const short of shortCandidates) {
      const shortStrike = short.strike;
      const shortMid = (short.bid + short.ask) / 2;
      const width = shortStrike - longStrike;
      const bidAskSpread = long.ask - long.bid;
      const midPrice = longMid;

      spreads.push({
        expiration: long.expiration_date,
        longStrike,
        shortStrike,
        longMid,
        shortMid,
        width,
        bidAskSpread,
        midPrice,
        type: "call",
        spreadType: "bull",
        isSafe: true
      });
    }
  }

  return spreads;
}

// Build bear put debit spreads (defined risk, mid-delta)
export function buildBearSpreads(chain) {
  const spreads = [];

  // Long leg: put, mid-delta
  const longCandidates = chain.filter(opt => {
    return (
      opt.option_type === "put" &&
      typeof opt.delta === "number" &&
      opt.delta >= MIN_DELTA &&
      opt.delta <= MAX_DELTA
    );
  });

  // Short leg: put below long, width in allowed set
  for (const long of longCandidates) {
    const longStrike = long.strike;
    const longMid = (long.bid + long.ask) / 2;

    const shortCandidates = chain.filter(opt => {
      if (opt.option_type !== "put") return false;
      if (opt.strike >= longStrike) return false;

      const width = longStrike - opt.strike;
      return isAllowedWidth(width);
    });

    for (const short of shortCandidates) {
      const shortStrike = short.strike;
      const shortMid = (short.bid + short.ask) / 2;
      const width = longStrike - shortStrike;
      const bidAskSpread = long.ask - long.bid;
      const midPrice = longMid;

      spreads.push({
        expiration: long.expiration_date,
        longStrike,
        shortStrike,
        longMid,
        shortMid,
        width,
        bidAskSpread,
        midPrice,
        type: "put",
        spreadType: "bear",
        isSafe: true
      });
    }
  }

  return spreads;
}

// Unified builder used by full-scan.js
export function buildSpreads(chain) {
  const bull = buildBullSpreads(chain);
  const bear = buildBearSpreads(chain);
  return [...bull, ...bear];
}
