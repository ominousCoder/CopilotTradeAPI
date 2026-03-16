export default async function handler(req, res) {
  const { symbols } = req.query;

  if (!symbols) {
    return res.status(400).json({
      error: "missing_symbols",
      message: "Query parameter 'symbols' is required (comma-separated)."
    });
  }

  try {
    // 1) Fetch quotes for all symbols
    const batchUrl = `${req.headers.origin}/api/batch-scan?symbols=${symbols}`;
    const batchRes = await fetch(batchUrl);
    const batchData = await batchRes.json();

    if (!batchRes.ok) {
      return res.status(502).json({
        error: "batch_scan_failed",
        message: batchData.message
      });
    }

    const results = [];

    // 2) Loop through each symbol
    for (const q of batchData.data) {
      const symbol = q.symbol;

      // Pick expiration (placeholder: nearest monthly)
      const expiration = pickExpiration(); // You will implement this

      // 3) Fetch chain for this symbol/expiration
      const chainUrl = `${req.headers.origin}/api/chain?symbol=${symbol}&expiration=${expiration}`;
      const chainRes = await fetch(chainUrl);
      const chainData = await chainRes.json();

      if (!chainRes.ok) continue;

      // 4) Build candidate spreads (placeholder: 1-wide call spreads)
      const candidates = buildCandidates(chainData.options);

      // 5) Score each candidate
      for (const c of candidates) {
        const scoreUrl =
          `${req.headers.origin}/api/spread-score` +
          `?symbol=${symbol}` +
          `&expiration=${expiration}` +
          `&long_strike=${c.long}` +
          `&short_strike=${c.short}` +
          `&type=${c.type}`;

        const scoreRes = await fetch(scoreUrl);
        const scoreData = await scoreRes.json();

        if (scoreRes.ok) {
          results.push(scoreData);
        }
      }
    }

    // 6) Sort by total score
    const sorted = results
      .filter(r => r.eligibility?.is_safe)
      .sort((a, b) => b.scores.total_score - a.scores.total_score)
      .slice(0, 5);

    return res.status(200).json({
      count: sorted.length,
      top_spreads: sorted
    });

  } catch (err) {
    return res.status(500).json({
      error: "internal_error",
      message: err.message
    });
  }
}

// --- Helper functions ---

function pickExpiration() {
  // Placeholder: you will replace this with your real logic
  return "2026-03-20";
}

function buildCandidates(options) {
  // Placeholder: build simple 1-wide call spreads
  const calls = options.filter(o => o.type === "call");
  const out = [];

  for (let i = 0; i < calls.length - 1; i++) {
    const long = calls[i];
    const short = calls[i + 1];

    out.push({
      type: "call",
      long: long.strike,
      short: short.strike
    });
  }

  return out;
}
