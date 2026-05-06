// api/credit-scan.js
// Credit spread scanner — put credit spreads only
// Fully independent from chain-helpers — owns all spread logic
// Imports shared fetch utilities from market-helpers.js
// Symbols and chains processed in parallel to avoid Vercel timeout

import { fetchExpirations, filterExpirations, fetchOptionChain, fetchRSI } from "./market-helpers.js";

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
const MIN_IV = 28;           // Minimum IV% — floor for viable premium
const MAX_IV = 60;           // Maximum IV% — above this suggests binary event risk
const MIN_NET_CREDIT = 0.40; // Minimum net credit after commissions
const MIN_RSI = 40;          // Below this — downtrend, short puts too risky
const MAX_RSI = 75;          // Above this — overbought, reversal risk
const MAX_PER_SYMBOL = 3;
const MAX_RESULTS = 15;
const SPREAD_WIDTH = 5;      // Fixed $5 wide for current account size
const TARGET_DTE_MIN = 14;   // Widened from 18 to catch more expirations
const TARGET_DTE_MAX = 35;   // Widened from 28
const CLOSE_DTE = 14;        // Auto-exit — never hold past this

// ------------------------------------------------------------
// Extract IV from a put option
// Tradier can return IV on greeks.smv_vol or implied_volatility
// smv_vol is a decimal (0.289), implied_volatility may be percent or decimal
// ------------------------------------------------------------
function extractIV(option) {
  if (option?.greeks?.smv_vol) {
    return option.greeks.smv_vol * 100; // Convert decimal to percent
  }
  if (option?.implied_volatility) {
    const iv = option.implied_volatility;
    // Tradier sometimes returns as decimal, sometimes as percent
    return iv > 2 ? iv : iv * 100;
  }
  return null;
}

// ------------------------------------------------------------
// 1 SD calculation
// iv: percent (e.g. 28.9 for 28.9%)
// dte: days to expiration
// spot: current underlying price
// Returns: dollar move representing 1 standard deviation
// ------------------------------------------------------------
function calcOneSD(spot, ivPct, dte) {
  return spot * (ivPct / 100) * Math.sqrt(dte / 365);
}

// ------------------------------------------------------------
// Scoring — credit spread specific
// Total possible: 80 points
// ------------------------------------------------------------
function scoreCreditSpread({ netCredit, iv, rsi, shortStrikePct, bidAskQuality }) {
  let score = 0;

  // Net credit score (0–30) — primary driver
  if (netCredit >= 1.00) score += 30;
  else if (netCredit >= 0.75) score += 24;
  else if (netCredit >= 0.55) score += 18;
  else if (netCredit >= 0.40) score += 12;

  // IV score (0–25) — higher IV = more premium
  if (iv >= 40) score += 25;
  else if (iv >= 35) score += 20;
  else if (iv >= 30) score += 15;
  else if (iv >= 28) score += 10;

  // Strike placement score (0–15)
  // shortStrikePct = how far short strike is from spot as % of 1 SD
  // 100% = exactly at 1 SD, 110%+ = beyond 1 SD (safer)
  if (shortStrikePct >= 110) score += 15;
  else if (shortStrikePct >= 100) score += 12;
  else if (shortStrikePct >= 85) score += 6;

  // RSI score (0–10) — neutral to mildly bullish preferred
  if (rsi >= 40 && rsi <= 60) score += 10;
  else if (rsi > 60 && rsi <= 70) score += 8;
  else if (rsi > 70 && rsi <= 75) score += 4;

  // Liquidity score (0–10) — tight bid/ask
  if (bidAskQuality <= 0.10) score += 10;
  else if (bidAskQuality <= 0.20) score += 7;
  else if (bidAskQuality <= 0.40) score += 4;
  else score += 1;

  return score;
}

// ------------------------------------------------------------
// EV calculation — per contract at 68% win rate
// EV = credit × (2 × winRate - 1)
// ------------------------------------------------------------
function calcEV(netCredit, winRate = 0.68) {
  return Number((netCredit * 100 * (2 * winRate - 1)).toFixed(2));
}

// ------------------------------------------------------------
// Process a single symbol
// Returns array of valid credit spreads
// ------------------------------------------------------------
async function processSymbol(symbol) {
  const spreads = [];

  try {
    // RSI and expirations in parallel
    const [rsi, allExps] = await Promise.all([
      fetchRSI(symbol),
      fetchExpirations(symbol)
    ]);

    console.log(`[credit-scan] ${symbol} — RSI: ${rsi}`);

    // RSI filter
    if (rsi !== null && (rsi < MIN_RSI || rsi > MAX_RSI)) {
      console.log(`[credit-scan] ${symbol} skipped — RSI ${rsi} outside ${MIN_RSI}–${MAX_RSI}`);
      return spreads;
    }

    // Filter expirations to target DTE window using market-helpers
    // filterExpirations now accepts { min, max } options
    const expirations = filterExpirations(allExps, { min: TARGET_DTE_MIN, max: TARGET_DTE_MAX });

    console.log(`[credit-scan] ${symbol} — expirations in window: ${expirations.join(", ") || "none"}`);

    if (expirations.length === 0) return spreads;

    // Fetch all chains in parallel
    const chains = await Promise.all(
      expirations.map(exp =>
        fetchOptionChain(symbol, exp).then(chain => ({ exp, chain }))
      )
    );

    for (const { exp: expiration, chain } of chains) {
      if (!chain) continue;

      const { underlying, options } = chain;
      const dte = Math.round((new Date(expiration + "T12:00:00") - new Date()) / 86400000);

      const puts = options.filter(o => o.option_type === "put");
      if (puts.length === 0) {
        console.log(`[credit-scan] ${symbol} ${expiration} — no puts in chain`);
        continue;
      }

      // ATM put — closest strike to underlying
      const atmPut = puts.reduce((prev, curr) =>
        Math.abs(curr.strike - underlying) < Math.abs(prev.strike - underlying) ? curr : prev
      );

      const iv = extractIV(atmPut);

      console.log(`[credit-scan] ${symbol} ${expiration} — DTE: ${dte}, IV: ${iv?.toFixed(1) ?? "null"}, ATM strike: ${atmPut.strike}, underlying: ${underlying}`);

      if (iv === null) {
        console.log(`[credit-scan] ${symbol} ${expiration} — IV unavailable, skipping`);
        continue;
      }

      if (iv < MIN_IV || iv > MAX_IV) {
        console.log(`[credit-scan] ${symbol} ${expiration} — IV ${iv.toFixed(1)}% outside ${MIN_IV}–${MAX_IV}%, skipping`);
        continue;
      }

      // 1 SD down from spot
      const oneSD = calcOneSD(underlying, iv, dte);
      const oneSdStrike = underlying - oneSD;

      console.log(`[credit-scan] ${symbol} ${expiration} — 1SD down: $${oneSdStrike.toFixed(2)}`);

      // Short leg candidates: puts at or below 1 SD
      const eligibleShortPuts = puts
        .filter(p => p.strike <= oneSdStrike)
        .sort((a, b) => b.strike - a.strike); // Closest to 1 SD first

      if (eligibleShortPuts.length === 0) {
        console.log(`[credit-scan] ${symbol} ${expiration} — no puts at or below 1SD ($${oneSdStrike.toFixed(2)})`);
        continue;
      }

      for (const shortPut of eligibleShortPuts) {
        const longStrike = Number((shortPut.strike - SPREAD_WIDTH).toFixed(1));
        const longPut = puts.find(p => Math.abs(p.strike - longStrike) < 0.01);
        if (!longPut) continue;

        const shortMid = (shortPut.bid + shortPut.ask) / 2;
        const longMid = (longPut.bid + longPut.ask) / 2;
        const netCredit = shortMid - longMid;

        if (netCredit < MIN_NET_CREDIT) continue;

        const collateral = (SPREAD_WIDTH - netCredit) * 100;
        const distanceFromSpot = underlying - shortPut.strike;
        const shortStrikePct = (distanceFromSpot / oneSD) * 100;
        const bidAskQuality = ((shortPut.ask - shortPut.bid) + (longPut.ask - longPut.bid)) / 2;
        const totalScore = scoreCreditSpread({ netCredit, iv, rsi, shortStrikePct, bidAskQuality });
        const ev = calcEV(netCredit);

        spreads.push({
          symbol,
          expiration,
          short_strike: shortPut.strike,
          long_strike: longStrike,
          type: "put_credit",
          dte,
          close_dte: CLOSE_DTE,
          spot: {
            underlying,
            one_sd_down: Number(oneSdStrike.toFixed(2)),
            short_strike_pct_of_sd: Number(shortStrikePct.toFixed(1))
          },
          iv: {
            iv_pct: Number(iv.toFixed(1)),
            passes_floor: iv >= MIN_IV,
            passes_ceiling: iv <= MAX_IV
          },
          pricing: {
            shortMid: Number(shortMid.toFixed(3)),
            longMid: Number(longMid.toFixed(3)),
            netCredit: Number(netCredit.toFixed(2)),
            width: SPREAD_WIDTH,
            collateral: Number(collateral.toFixed(0)),
            maxProfit: Number((netCredit * 100).toFixed(0)),
            maxLoss: Number(collateral.toFixed(0))
          },
          greeks: {
            delta: shortPut.greeks?.delta ?? null,
            theta: shortPut.greeks?.theta ?? null
          },
          ev: {
            per_contract: ev,
            win_rate_assumption: 0.68,
            monthly_ev_4_cycles: Number((ev * 4).toFixed(2))
          },
          scores: {
            total_score: totalScore,
            rsi,
            iv_score: iv >= 40 ? 25 : iv >= 35 ? 20 : iv >= 30 ? 15 : 10,
            credit_score: netCredit >= 1.00 ? 30 : netCredit >= 0.75 ? 24 : netCredit >= 0.55 ? 18 : 12,
            strike_placement_score: shortStrikePct >= 110 ? 15 : shortStrikePct >= 100 ? 12 : 6,
            liquidity_score: bidAskQuality <= 0.10 ? 10 : bidAskQuality <= 0.20 ? 7 : bidAskQuality <= 0.40 ? 4 : 1
          },
          exit_rules: {
            profit_target_credit: Number((netCredit * 0.5).toFixed(2)),
            stop_loss_credit: Number((netCredit * 2).toFixed(2)),
            auto_exit_dte: CLOSE_DTE
          }
        });
      }
    }
  } catch (e) {
    console.error(`[credit-scan] Error processing ${symbol}:`, e.message);
  }

  return spreads;
}

// ------------------------------------------------------------
// Main handler
// ------------------------------------------------------------
export default async function handler(req, res) {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: "Missing symbols parameter" });

    const tickers = symbols.split(",");

    // All symbols in parallel
    const results = await Promise.all(tickers.map(processSymbol));
    let allSpreads = results.flat();

    allSpreads.sort((a, b) => b.scores.total_score - a.scores.total_score);

    const seen = {};
    const top_spreads = [];
    for (const spread of allSpreads) {
      seen[spread.symbol] = (seen[spread.symbol] || 0) + 1;
      if (seen[spread.symbol] <= MAX_PER_SYMBOL) top_spreads.push(spread);
      if (top_spreads.length >= MAX_RESULTS) break;
    }

    return res.status(200).json({
      count: top_spreads.length,
      scan_type: "put_credit_spread",
      parameters: {
        min_iv: MIN_IV,
        max_iv: MAX_IV,
        min_net_credit: MIN_NET_CREDIT,
        rsi_range: `${MIN_RSI}–${MAX_RSI}`,
        spread_width: SPREAD_WIDTH,
        dte_window: `${TARGET_DTE_MIN}–${TARGET_DTE_MAX}`,
        close_dte: CLOSE_DTE
      },
      top_spreads
    });

  } catch (err) {
    console.error("[credit-scan] Fatal error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
