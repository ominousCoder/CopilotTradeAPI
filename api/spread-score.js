// api/spread-score.js

const MAX_DEBIT = 40; // Hard ceiling — matches full-scan.js

export function scoreSpread({ longMid, shortMid, width, bidAskSpread, midPrice, delta }) {
  const debit = longMid - shortMid;
  const maxProfit = width - debit;
  const rr = maxProfit / debit;

  // FIX 5: Hard safety gates — return null if spread fails basic rules
  if (debit <= 0) return null;
  if (debit > MAX_DEBIT) return null;
  if (maxProfit <= 0) return null;
  if (!delta || delta <= 0) return null;

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

  // FIX 6: Delta alignment bucket
  let baseDeltaBucket = 0;
  const absDelta = Math.abs(delta);
  if (absDelta >= 0.25 && absDelta <= 0.35) baseDeltaBucket = 9;
  else if (absDelta >= 0.20 && absDelta <= 0.40) baseDeltaBucket = 6;
  else if (absDelta >= 0.15 && absDelta <= 0.45) baseDeltaBucket = 3;
  else baseDeltaBucket = 1;

  // -----------------------------
  // FRACTIONAL MICRO-SCORING
  // -----------------------------
  const debitFraction = Math.max(0, Math.min((1 - debitPct) * 0.99, 0.99));
  const rrFraction = Math.max(0, Math.min((rr / 10) * 0.99, 0.99));
  const liqFraction = Math.max(0, Math.min((1 - liqRatio) * 0.99, 0.99));

  // FIX 6: Delta fraction — peaks at 0.30, falls off symmetrically
  const deltaCenter = 0.30;
  const deltaDistance = Math.abs(absDelta - deltaCenter);
  const deltaFraction = Math.max(0, Math.min((1 - deltaDistance / 0.30) * 0.99, 0.99));

  // -----------------------------
  // FINAL SCORES
  // -----------------------------
  const debitScore = baseDebitBucket + debitFraction;
  const rrScore = baseRRBucket + rrFraction;
  const liquidityScore = baseLiqBucket + liqFraction;
  const deltaScore = baseDeltaBucket + deltaFraction;

  // Max possible score is now 36 (9+9+9+9)
  const total_score = debitScore + rrScore + liquidityScore + deltaScore;

  return {
    debitScore: Number(debitScore.toFixed(4)),
    rrScore: Number(rrScore.toFixed(4)),
    liquidityScore: Number(liquidityScore.toFixed(4)),
    deltaScore: Number(deltaScore.toFixed(4)),
    total_score: Number(total_score.toFixed(4)),
    debit,
    maxProfit,
    rr,
    is_safe: true
  };
}

export default scoreSpread;
