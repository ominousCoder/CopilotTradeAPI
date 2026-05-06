// api/credit-scan.js
// Credit spread scanner — put credit spreads only
// Filters on IV, 1 SD strike placement, net credit, RSI 40–70
// No ADX requirement — credit spreads work in neutral and trending markets

import {
  fetchExpirations,
  filterExpirations,
  fetchOptionChain,
  buildSpreads
} from "./chain-helpers.js";

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
const MIN_IV = 28;          // Minimum IV% to generate viable premium
const MAX_IV = 60;          // Above this — binary event risk, avoid
const MIN_NET_CREDIT = 0.40; // Minimum net credit after commissions
const MIN_RSI = 40;          // Floor — below this, downtrend too risky for short puts
const MAX_RSI = 70;          // Ceiling — overbought, reversal risk
const MAX_PER_SYMBOL = 3;
const MAX_RESULTS = 15;
const SPREAD_WIDTH = 5;      // Fixed $5 wide for now
const TARGET_DTE_MIN = 18;   // Open at 20–25 DTE
const TARGET_DTE_MAX = 28;
const CLOSE_DTE = 14;        // Auto-exit rule — documented here for reference

// ------------------------------------------------------------
// RSI helpers (identical to full-scan.js)
// ------------------------------------------------------------
async function fetchRSI(symbol) {
  try {
    const BASE = process.env.TRADIER_BASE_URL;
    const url = `${BASE}/markets/history?symbol=${symbol}&interval=daily&start=${getPastDate(30)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.TRADIER_KEY}`,
        Accept: "application/json"
      }
    });
    const json = await res.json();
    const history = json?.history?.day;
    if (!history || history.length < 15) return null;
    const closes = history.map(d => d.close);
    return calculateRSI(closes, 14);
  } catch (e) {
    console.log(`[credit-scan] RSI fetch failed for ${symbol}:`, e.message);
    return null;
  }
}

function getPastDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function calculateRSI(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

// ------------------------------------------------------------
// IV fetch — pulls IV from option chain underlying data
// ------------------------------------------------------------
async function fetchIV(symbol) {
  try {
    const BASE = process.env.TRADIER_BASE_URL;
    const url = `${BASE}/markets/options/strikes?symbol=${symbol}&expiration=${getNextExpiration()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.TRADIER_KEY}`,
        Accept: "application/json"
      }
    });
    const json = await res.json();
    // IV pulled from chain underlying when we fetch the chain — placeholder here
    return null;
  } catch (e) {
    console.log(`[credit-scan] IV fetch failed for ${symbol}:`, e.message);
    return null;
  }
}

// ------------------------------------------------------------
// 1 SD calculation
// iv: decimal (e.g. 0.289 for 28.9%)
// dte: days to expiration
// spot: current underlying price
// ------------------------------------------------------------
function calcOneSD(spot, iv, dte) {
  return spot * iv * Math.sqrt(dte / 365);
}

// ------------------------------------------------------------
// Scoring — credit spread specific
// Higher score = better candidate
// ------------------------------------------------------------
function scoreCreditSpread({ netCredit, iv, rsi, shortStrikePct, width, bidAskQuality }) {
  let score = 0;

  // Net credit score (0–30) — primary driver
  // Target $0.40 min, $1.00+ ideal
  if (netCredit >= 1.00) score += 30;
  else if (netCredit >= 0.75) score += 24;
  else if (netCredit >= 0.55) score += 18;
  else if (netCredit >= 0.40) score += 12;
  else score += 0; // Below minimum — will be filtered before scoring

  // IV score (0–25) — higher IV = more premium, but cap at MAX_IV
  if (iv >= 40) score += 25;
  else if (iv >= 35) score += 20;
  else if (iv >= 30) score += 15;
  else if (iv >= 28) score += 10;

  // Strike placement score (0–25)
  // How far OTM is the short strike as % of 1 SD
  // 100%+ of 1 SD away = full score (68%+ win rate)
  // Closer = lower score
  if (shortStrikePct >= 110) score += 25;      // Beyond 1 SD — very safe
  else if (shortStrikePct >= 100) score += 20; // At 1 SD — target zone
  else if (shortStrikePct >= 85) score += 12;  // Slightly inside 1 SD
  else score += 0;                              // Too close — penalize

  // RSI score (0–10) — neutral to bullish preferred
  if (rsi >= 40 && rsi <= 60) score += 10;     // Neutral — ideal
  else if (rsi > 60 && rsi <= 70) score += 8;  // Bullish — good
  else if (rsi > 70) score += 4;               // Overbought — caution
  else score += 0;                             // Below 40 — will be filtered

  // Liquidity score (0–10) — tight bid/ask
  if (bidAskQuality <= 0.10) score += 10;
  else if (bidAskQuality <= 0.20) score += 7;
  else if (bidAskQuality <= 0.40) score += 4;
  else score += 1;

  return score;
}

// ------------------------------------------------------------
// EV calculation
// ------------------------------------------------------------
function calcEV(netCredit, winRate = 0.68) {
  // EV = credit × (2 × winRate - 1)
  const evPerDollar = 2 * winRate - 1; // 0.36 at 68%
  return Number((netCredit * 100 * evPerDollar).toFixed(2)); // Per contract
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

    for (const symbol of tickers) {

      // Fetch RSI
      const rsi = await fetchRSI(symbol);

      // RSI floor check — below 40 means downtrend, skip
      if (rsi !== null && rsi < MIN_RSI) {
        console.log(`[credit-scan] ${symbol} skipped — RSI ${rsi} below floor ${MIN_RSI}`);
        continue;
      }

      // RSI ceiling check — above 70 means overbought, skip
      if (rsi !== null && rsi > MAX_RSI) {
        console.log(`[credit-scan] ${symbol} skipped — RSI ${rsi} above ceiling ${MAX_RSI}`);
        continue;
      }

      // Fetch expirations — filterExpirations already handles 14–45 DTE
      // We then narrow to our target window from the filtered list
      const allExps = await fetchExpirations(symbol);
      const filteredExps = filterExpirations(allExps);
      const expirations = filteredExps.filter(exp => {
        const dte = Math.round((new Date(exp + "T12:00:00") - new Date()) / (1000 * 60 * 60 * 24));
        return dte >= TARGET_DTE_MIN && dte <= TARGET_DTE_MAX;
      });

      if (expirations.length === 0) {
        console.log(`[credit-scan] ${symbol} skipped — no expirations in ${TARGET_DTE_MIN}–${TARGET_DTE_MAX} DTE window`);
        continue;
      }

      for (const expiration of expirations) {
        const chain = await fetchOptionChain(symbol, expiration);
        if (!chain) continue;

        const underlying = chain.underlying;
        const dte = Math.round((new Date(expiration) - new Date()) / (1000 * 60 * 60 * 24));

        // Pull IV from chain — use put side IV at ATM strike
        // Tradier returns iv on individual options — we average near-ATM puts
        // chain-helpers returns { underlying, options } where options is already parsed array
        const puts = chain.options?.filter(o => o.option_type === "put") || [];
        if (puts.length === 0) continue;

        // Find ATM put — closest strike to underlying
        const atmPut = puts.reduce((prev, curr) =>
          Math.abs(curr.strike - underlying) < Math.abs(prev.strike - underlying) ? curr : prev
        );

        const iv = atmPut?.greeks?.smv_vol
          ? atmPut.greeks.smv_vol * 100
          : atmPut?.implied_volatility
          ? atmPut.implied_volatility * 100
          : null;

        // IV filter
        if (iv === null) {
          console.log(`[credit-scan] ${symbol} ${expiration} — IV unavailable, skipping`);
          continue;
        }

        if (iv < MIN_IV) {
          console.log(`[credit-scan] ${symbol} ${expiration} — IV ${iv.toFixed(1)}% below floor ${MIN_IV}%`);
          continue;
        }

        if (iv > MAX_IV) {
          console.log(`[credit-scan] ${symbol} ${expiration} — IV ${iv.toFixed(1)}% above ceiling ${MAX_IV}% — binary event risk`);
          continue;
        }

        // Calculate 1 SD move
        const oneSD = calcOneSD(underlying, iv / 100, dte);
        const oneSdStrike = underlying - oneSD;

        console.log(`[credit-scan] ${symbol} ${expiration} — spot $${underlying}, IV ${iv.toFixed(1)}%, 1SD down $${oneSdStrike.toFixed(2)}`);

        // Find puts at or below 1 SD for short leg
        const eligibleShortPuts = puts.filter(p => p.strike <= oneSdStrike);

        if (eligibleShortPuts.length === 0) {
          console.log(`[credit-scan] ${symbol} ${expiration} — no puts at or below 1 SD ($${oneSdStrike.toFixed(2)})`);
          continue;
        }

        // For each eligible short put, find the long put $5 below
        for (const shortPut of eligibleShortPuts) {
          const longStrike = shortPut.strike - SPREAD_WIDTH;
          const longPut = puts.find(p => p.strike === longStrike);
          if (!longPut) continue;

          const shortMid = (shortPut.bid + shortPut.ask) / 2;
          const longMid = (longPut.bid + longPut.ask) / 2;
          const netCredit = shortMid - longMid;

          // Net credit floor
          if (netCredit < MIN_NET_CREDIT) {
            console.log(`[credit-scan] ${symbol} ${expiration} ${shortPut.strike}/${longStrike} — net credit $${netCredit.toFixed(2)} below floor`);
            continue;
          }

          const collateral = (SPREAD_WIDTH - netCredit) * 100;
          const maxLoss = collateral;
          const maxProfit = netCredit * 100;

          // How far is short strike from spot as % of 1 SD
          const distanceFromSpot = underlying - shortPut.strike;
          const shortStrikePct = (distanceFromSpot / oneSD) * 100;

          // Bid/ask quality — average spread across both legs
          const bidAskQuality = ((shortPut.ask - shortPut.bid) + (longPut.ask - longPut.bid)) / 2;

          const totalScore = scoreCreditSpread({
            netCredit,
            iv,
            rsi,
            shortStrikePct,
            width: SPREAD_WIDTH,
            bidAskQuality
          });

          const ev = calcEV(netCredit);

          allSpreads.push({
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
              maxProfit: Number(maxProfit.toFixed(0)),
              maxLoss: Number(maxLoss.toFixed(0))
            },
            greeks: {
              delta: shortPut.greeks?.delta ?? null,
              theta: shortPut.greeks?.theta ?? null,
              iv: shortPut.greeks?.smv_vol ?? null
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
              strike_placement_score: shortStrikePct >= 110 ? 25 : shortStrikePct >= 100 ? 20 : 12,
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
    }

    // Sort by total score descending
    allSpreads.sort((a, b) => b.scores.total_score - a.scores.total_score);

    // Cap per symbol
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
    console.error("[credit-scan] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
