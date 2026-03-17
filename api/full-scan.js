import { pickExpiration } from "./utils/pickExpiration.js";
import { buildCandidates } from "./utils/buildCandidates.js";

export default async function handler(req, res) {
  const { symbols } = req.query;

  if (!symbols) {
    return res.status(400).json({
      error: "missing_symbols",
      message: "Query parameter 'symbols' is required (comma-separated)."
    });
  }

  try {
    const results = [];

    // 1) Fetch quotes for all symbols
    const batchRes = await fetch(
      `/api/batch-scan?symbols=${encodeURIComponent(symbols)}`,
      { headers: { Host: req.headers.host } }
    );

    const batchData = await batchRes.json();

    if (!batchRes.ok || !batchData?.data) {
      return res.status(502).json({
        error: "batch_scan_failed",
        message: batchData?.message || "Batch scan failed."
      });
    }

    // 2) Loop through each symbol
    for (const q of batchData.data) {
      const symbol = q.symbol;
      const underlyingPrice = q.last;

      if (!symbol || !underlyingPrice || underlyingPrice <= 0) continue;

      // 3) Pick expiration
      const expiration = await pickExpiration(symbol);
      if (!expiration) continue;

      // 4) Fetch chain
      const chainRes = await fetch(
        `/api/chain?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}`,
        { headers: { Host: req.headers.host } }
      );

      const chainData = await chainRes.json();
      if (!chainRes.ok || !chainData?.options?.length) continue;

      // 5) Build candidate spreads
      const candidates = buildCandidates(chainData.options, underlyingPrice);
      if (!candidates.length) continue;

      // 6) Score each candidate
      for (const c of candidates) {
        const scoreRes = await fetch(
          `/api/spread-score?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}&long_strike=${encodeURIComponent(c.long)}&short_strike=${encodeURIComponent(c.short)}&type=${encodeURIComponent(c.type)}`,
          { headers: { Host: req.headers.host } }
        );

        const scoreData = await scoreRes.json();
        if (scoreRes.ok && scoreData?.scores?.total_score != null) {
          results.push(scoreData);
        }
      }
    }

    // 7) Sort and return top 5 safe spreads
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
