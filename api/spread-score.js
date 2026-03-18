// api/spread-score.js

export function scoreSpread({ longMid, shortMid, width, bidAskSpread, midPrice }) {
  const debit = longMid - shortMid;
  const maxProfit = width - debit;
  const rr = maxProfit / debit;

  // -----------------------------
  // BASE BUCKETS
  // -----------------------------

  // Debit bucket
  let baseDebitBucket = 0;
  const debitPct = debit / width;
  if (debitPct <= 0.20) baseDebitBucket = 9;
  else if (debitPct <= 0.40) baseDebitBucket = 7;
  else if (debitPct <= 0.60) baseDebitBucket = 5;
  else if (debitPct <= 0.80) baseDebitBucket = 3;
  else baseDebitBucket = 1;

  // RR bucket
  let baseRRBucket = 0;
  if (rr >= 4) baseRRBucket = 9;
  else if (rr >= 3) baseRRBucket = 7;
  else if (rr >= 2) baseRRBucket = 5;
  else if (rr >= 1.5) baseRRBucket = 3;
  else baseRRBucket = 1;

  // Liquidity bucket
  let baseLiqBucket = 0;
  const liqRatio = bidAskSpread / midPrice;
  if (liqRatio <= 0.03) baseLiqBucket = 9;
  else if (liqRatio <= 0.06) baseLiqBucket = 7;
  else if (liqRatio <= 0.10) baseLiqBucket = 5;
  else if (liqRatio <= 0.15) baseLiqBucket = 3;
  else baseLiqBucket = 1;

  // -----------------------------
  // FRACTIONAL MICRO-SCORING
  // -----------------------------

  const debitFraction = Math.max(0, Math.min((1 - debitPct) * 0.99, 0.99));
  const rrFraction = Math.max(0, Math.min((rr / 10) * 0.99, 0.99));
  const liqFraction = Math.max(0, Math.min((1 - liqRatio) * 0.99, 0.99));

  // -----------------------------
  // FINAL SCORES
  // -----------------------------

  const debitScore = baseDebitBucket + debitFraction;
  const rrScore = baseRRBucket + rrFraction;
  const liquidityScore = baseLiqBucket + liqFraction;

  const total_score = debitScore + rrScore + liquidityScore;

  return {
    debitScore: Number(debitScore.toFixed(4)),
    rrScore: Number(rrScore.toFixed(4)),
    liquidityScore: Number(liquidityScore.toFixed(4)),
    total_score: Number(total_score.toFixed(4)),
    debit,
    maxProfit,
    rr
  };
}

export default scoreSpread;
