// api/full-scan.js

import scoreSpread from "./spread-score";
import { fetchOptionChain, buildSpreads } from "./chain";

export default async function handler(req, res) {
  try {
    const { symbols } = req.query;

    if (!symbols) {
      return res.status(400).json({ error: "Missing symbols parameter" });
    }

    const tickers = symbols.split(",");
    let allSpreads = [];

    for (const symbol of tickers) {
      const chain = await fetchOptionChain(symbol);
      if (!chain) continue;

      const spreads = buildSpreads(chain);

      for (const sp of spreads) {
        const score = scoreSpread({
          longMid: sp.longMid,
          shortMid: sp.shortMid,
          width: sp.width,
          bidAskSpread: sp.bidAskSpread,
          midPrice: sp.midPrice
        });

        allSpreads.push({
          symbol,
          expiration: sp.expiration,
          long_strike: sp.longStrike,
          short_strike: sp.shortStrike,
          type: sp.type,
          spreadType: sp.spreadType,
          pricing: {
            longMid: sp.longMid,
            shortMid: sp.shortMid,
            debit: score.debit,
            width: sp.width,
            maxProfit: score.maxProfit
          },
          scores: {
            debitScore: score.debitScore,
            rrScore: score.rrScore,
            liquidityScore: score.liquidityScore,
            total_score: score.total_score
          },
          eligibility: { is_safe: sp.isSafe }
        });
      }
    }

    // Sort by fractional total_score
    allSpreads.sort((a, b) => b.scores.total_score - a.scores.total_score);

    // Return top 5
    const top_spreads = allSpreads.slice(0, 5);

    return res.status(200).json({
      count: top_spreads.length,
      top_spreads
    });

  } catch (err) {
    console.error("Full scan error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
