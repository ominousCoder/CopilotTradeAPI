// api/full-scan.js

import scoreSpread from "./spread-score.js";
import {
  fetchExpirations,
  filterExpirations,
  fetchOptionChain,
  buildSpreads
} from "./chain-helpers.js";

const MAX_DEBIT = 40;

export default async function handler(req, res) {
  try {
    const { symbols, direction } = req.query;

    if (!symbols) {
      return res.status(400).json({ error: "Missing symbols parameter" });
    }

    if (direction && !["bull", "bear"].includes(direction)) {
      return res.status(400).json({
        error: "Invalid direction parameter. Use 'bull' or 'bear'."
      });
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
          const debit = longMid - shortMid;

          if (debit > MAX_DEBIT) continue;

          // FIX 13: Calculate distance from spot
          const underlying = chain.underlying;
          const dollarDistance = Number((sp.long.strike - underlying).toFixed(2));
          const distancePct = Number(((sp.long.strike - underlying) / underlying * 100).toFixed(2));

          const score = scoreSpread({
            longMid,
            shortMid,
            width: sp.width,
            bidAskSpread: (sp.long.ask - sp.long.bid) + (sp.short.ask - sp.short.bid),
            midPrice: longMid - shortMid,
            delta: sp.long.delta,
            distancePct  // FIX 13: Pass distance to scorer
          });

          if (!score) continue;

          allSpreads.push({
            symbol,
            expiration,
            long_strike: sp.long.strike,
            short_strike: sp.short.strike,
            type: sp.type,
            spreadType: sp.type === "bull" ? "bull_call" : "bear_put",
            // FIX 13: Add spot context to output
            spot: {
              underlying,
              dollarDistance,
              distancePct: `${distancePct}%`
            },
            pricing: {
              longMid,
              shortMid,
              debit: score.debit,
              width: sp.width,
              maxProfit: score.maxProfit
            },
            greeks: {
              delta: sp.long.delta,
              gamma: sp.long.gamma,
              theta: sp.long.theta,
              vega: sp.long.vega
            },
            scores: {
              debitScore: score.debitScore,
              rrScore: score.rrScore,
              liquidityScore: score.liquidityScore,
              deltaScore: score.deltaScore,
              distanceScore: score.distanceScore,  // FIX 13
              total_score: score.total_score
            },
            eligibility: { is_safe: score.is_safe }
          });
        }
      }
    }

    if (direction === "bear") {
      allSpreads = allSpreads.filter(s => s.type === "bear");
    } else if (direction === "bull") {
      allSpreads = allSpreads.filter(s => s.type === "bull");
    }

    allSpreads.sort((a, b) => b.scores.total_score - a.scores.total_score);
    const top_spreads = allSpreads.slice(0, 5);

    return res.status(200).json({
      count: top_spreads.length,
      direction: direction ?? "any",
      top_spreads
    });

  } catch (err) {
    console.error("Full scan error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
