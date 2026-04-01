// api/full-scan.js

import scoreSpread from "./spread-score.js";
import {
  fetchExpirations,
  filterExpirations,
  fetchOptionChain,
  buildSpreads
} from "./chain-helpers.js";
import { fetchADX } from "./adx-helpers.js";

const MAX_DEBIT = 40;
const MAX_DISTANCE_PCT = 4;  // max % distance from spot — strikes beyond this are too far OTM
const MAX_PER_SYMBOL = 3;
const MAX_RESULTS = 15;

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
      // ADX chop filter — skip ticker if not trending strongly enough
      const adxResult = await fetchADX(symbol);

      if (!adxResult || !adxResult.passesFilter) {
        console.log(`[scan] ${symbol} skipped — ADX ${adxResult?.adx ?? "null"}, gap ${adxResult?.diGap ?? "null"}`);
        continue;
      }

      // Directional filter — only trade with the trend when direction is specified
      if (direction === "bear" && adxResult.minusDI <= adxResult.plusDI) {
        console.log(`[scan] ${symbol} skipped — bear requested but +DI(${adxResult.plusDI}) > -DI(${adxResult.minusDI})`);
        continue;
      }

      if (direction === "bull" && adxResult.plusDI <= adxResult.minusDI) {
        console.log(`[scan] ${symbol} skipped — bull requested but -DI(${adxResult.minusDI}) > +DI(${adxResult.plusDI})`);
        continue;
      }

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

          const underlying = chain.underlying;
          const dollarDistance = Number((sp.long.strike - underlying).toFixed(2));
          const distancePct = Number(((sp.long.strike - underlying) / underlying * 100).toFixed(2));

          // Hard distance filter — skip strikes too far from spot
          if (Math.abs(distancePct) > MAX_DISTANCE_PCT) continue;

          const score = scoreSpread({
            longMid,
            shortMid,
            width: sp.width,
            bidAskSpread: (sp.long.ask - sp.long.bid) + (sp.short.ask - sp.short.bid),
            midPrice: longMid - shortMid,
            delta: sp.long.delta,
            distancePct
          });

          if (!score) continue;

          // Auto-align spread direction with DI when no direction specified
          if (!direction) {
            const bearAligned = sp.type === "bear" && adxResult.minusDI > adxResult.plusDI;
            const bullAligned = sp.type === "bull" && adxResult.plusDI > adxResult.minusDI;
            if (!bearAligned && !bullAligned) continue;
          }

          allSpreads.push({
            symbol,
            expiration,
            long_strike: sp.long.strike,
            short_strike: sp.short.strike,
            type: sp.type,
            spreadType: sp.type === "bull" ? "bull_call" : "bear_put",
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
              distanceScore: score.distanceScore,
              total_score: score.total_score
            },
            adx: {
              adx: adxResult.adx,
              plusDI: adxResult.plusDI,
              minusDI: adxResult.minusDI,
              diGap: adxResult.diGap
            },
            eligibility: { is_safe: score.is_safe }
          });
        }
      }
    }

    // Apply explicit direction filter
    if (direction === "bear") {
      allSpreads = allSpreads.filter(s => s.type === "bear");
    } else if (direction === "bull") {
      allSpreads = allSpreads.filter(s => s.type === "bull");
    }

    // Sort by score
    allSpreads.sort((a, b) => b.scores.total_score - a.scores.total_score);

    // Apply per-symbol cap and return top 15
    const seen = {};
    const top_spreads = [];

    for (const spread of allSpreads) {
      seen[spread.symbol] = (seen[spread.symbol] || 0) + 1;
      if (seen[spread.symbol] <= MAX_PER_SYMBOL) {
        top_spreads.push(spread);
      }
      if (top_spreads.length >= MAX_RESULTS) break;
    }

    return res.status(200).json({
      count: top_spreads.length,
      direction: direction ?? "any",
      max_per_symbol: MAX_PER_SYMBOL,
      max_distance_pct: MAX_DISTANCE_PCT,
      top_spreads
    });

  } catch (err) {
    console.error("Full scan error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
