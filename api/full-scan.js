// api/full-scan.js

import scoreSpread from "./spread-score";
import { fetchOptionChain, buildSpreads } from "./chain-helpers";

// ------------------------------------------------------------
// Expiration picker: this Friday, next Friday, 3 weeks out
// ------------------------------------------------------------
function getFridayTimestamp(weeksAhead = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 5=Fri
  const diffToFriday = (5 - day + 7) % 7;

  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + diffToFriday + weeksAhead * 7
  );

  return Math.floor(target.getTime() / 1000); // Yahoo requires seconds
}

function pickExpirations() {
  return [
    getFridayTimestamp(0),  // this week
    getFridayTimestamp(1),  // next week
    getFridayTimestamp(3)   // three weeks out
  ];
}

// ------------------------------------------------------------
// Main handler
// ------------------------------------------------------------
export default async function handler(req, res) {
  try {
    const { symbols } = req.query;

    if (!symbols) {
      return res.status(400).json({ error: "Missing symbols parameter" });
    }

    const tickers = symbols.split(",");
    let allSpreads = [];

    const expirations = pickExpirations();
    const allowedWidths = [0.5, 1, 2, 2.5, 5];

    for (const symbol of tickers) {
      for (const expiration of expirations) {
        const chain = await fetchOptionChain(symbol, expiration);
        if (!chain) continue;

        const spreads = await buildSpreads(chain, symbol, expiration, allowedWidths);
        if (!spreads || spreads.length === 0) continue;

        for (const sp of spreads) {
          const score = scoreSpread({
            longMid: sp.long.mid,
            shortMid: sp.short.mid,
            width: sp.width,
            bidAskSpread: sp.long.ask - sp.long.bid + (sp.short.ask - sp.short.bid),
            midPrice: (sp.long.mid - sp.short.mid)
          });

          allSpreads.push({
            symbol,
            expiration,
            long_strike: sp.long.strike,
            short_strike: sp.short.strike,
            type: sp.type,
            spreadType: sp.type === "bull" ? "bull_call" : "bear_put",
            pricing: {
              longMid: sp.long.mid,
              shortMid: sp.short.mid,
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
