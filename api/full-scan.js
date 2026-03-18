import scoreSpread from "./spread-score";
import {
  fetchExpirations,
  filterExpirations,
  fetchOptionChain,
  buildSpreads
} from "./chain-helpers";

export default async function handler(req, res) {
  try {
    const { symbols } = req.query;

    if (!symbols) {
      return res.status(400).json({ error: "Missing symbols parameter" });
    }

    const tickers = symbols.split(",");
    let allSpreads = [];

    const allowedWidths = [0.5, 1, 2, 2.5, 5];

    for (const symbol of tickers) {
      const allExps = await fetchExpirations(symbol);
      const expirations = filterExpirations(allExps);

      for (const expiration of expirations) {
        const chain = await fetchOptionChain(symbol, expiration);
        if (!chain) continue;

        const spreads = await buildSpreads(chain, symbol, expiration, allowedWidths);
        if (!spreads || spreads.length === 0) continue;

        for (const sp of spreads) {
          const longMid = (sp.long.bid + sp.long.ask) / 2;
          const shortMid = (sp.short.bid + sp.short.ask) / 2;

          const score = scoreSpread({
            longMid,
            shortMid,
            width: sp.width,
            bidAskSpread: (sp.long.ask - sp.long.bid) + (sp.short.ask - sp.short.bid),
            midPrice: longMid - shortMid
          });

          allSpreads.push({
            symbol,
            expiration,
            long_strike: sp.long.strike,
            short_strike: sp.short.strike,
            type: sp.type,
            spreadType: sp.type === "bull" ? "bull_call" : "bear_put",
            pricing: {
              longMid,
              shortMid,
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
            eligibility: { is_safe: true }
          });
        }
      }
    }

    allSpreads.sort((a, b) => b.scores.total_score - a.scores.total_score);

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
