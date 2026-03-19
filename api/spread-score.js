// api/spread-score.js

const MAX_DEBIT = 40;

export function scoreSpread({ longMid, shortMid, width, bidAskSpread, midPrice, delta, distancePct }) {
  const debit = longMid - shortMid;
  const maxProfit = width - debit;
  const rr = maxProfit / debit;

  // Hard safety gates
  if (debit <= 0) return null;
  if (debit > MAX_DEBIT) return null;
  if (maxProfit <= 0) return null;
  if (!delta || delta === 0) return null;

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
  if (liqRatio <= 0.05) baseLiqBucket = 9;
  else if (liqRatio <= 0.10) baseLiqBucket = 7;
  else if (liqRatio <= 0.15) baseLiqBucket = 5;
  else if (liqRatio <= 0.25) baseLiqBucket = 3;
  else baseLiqBucket = 1;

  // Delta bucket
  let baseDeltaBucket = 0;
  const absDelta = Math.abs(delta);
  if (absDelta >= 0.25 && absDelta <= 0.40) baseDeltaBucket = 9;
  else if (absDelta >= 0.20 && absDelta <= 0.45) baseDeltaBucket = 6;
  else if (absDelta >= 0.15 && absDelta <= 0.50) baseDeltaBucket = 3;
  else baseDeltaBucket = 1;

  // FIX 13: Distance from spot bucket
  // Rewards strikes close to ATM for better fill quality
  let baseDistanceBucket = 0;
  const absDist = Math.abs(distancePct);
  if (absDist <= 2) baseDistanceBucket = 9;
  else if (absDist <= 3) baseDistanceBucket = 7;
  else if (absDist <= 4) baseDistanceBucket = 5;
  else if (absDist <= 5) baseDistanceBucket = 3;
  else baseDistanceBucket = 1;

  // -----------------------------
  // FRACTIONAL MICRO-SCORING
  // -----------------------------
  const debitFraction = Math.max(0, Math.min((1 - debitPct) * 0.99, 0.99));
  const rrFraction = Math.max(0, Math.min((rr / 10) * 0.99, 0.99));
  const liqFraction = Math.max(0, Math.min((1 - liqRatio) * 0.99, 0.99));

  const deltaCenter = 0.30;
  const deltaDistance = Math.abs(absDelta - deltaCenter);
  const deltaFraction = Math.max(0, Math.min((1 - deltaDistance / 0.30) * 0.99, 0.99));

  // FIX 13: Distance fraction — peaks at 0%, falls off as distance increases
  const distanceFraction = Math.max(0, Math.min((1 - absDist / 5) * 0.99, 0.99));

  // -----------------------------
  // FINAL SCORES — capped at 9.99 per dimension
  // -----------------------------
  const debitScore = Math.min(baseDebitBucket + debitFraction, 9.99);
  const rrScore = Math.min(baseRRBucket + rrFraction, 9.99);
  const liquidityScore = Math.min(baseLiqBucket + liqFraction, 9.99);
  const deltaScore = Math.min(baseDeltaBucket + deltaFraction, 9.99);
  const distanceScore = Math.min(baseDistanceBucket + distanceFraction, 9.99);

  // Max possible score is 49.95 (9.99 x 5)
  const total_score = debitScore + rrScore + liquidityScore + deltaScore + distanceScore;

  return {
    debitScore: Number(debitScore.toFixed(4)),
    rrScore: Number(rrScore.toFixed(4)),
    liquidityScore: Number(liquidityScore.toFixed(4)),
    deltaScore: Number(deltaScore.toFixed(4)),
    distanceScore: Number(distanceScore.toFixed(4)),
    total_score: Number(total_score.toFixed(4)),
    debit,
    maxProfit,
    rr,
    is_safe: true
  };
}

export default scoreSpread;
