export function buildCandidates(options, underlyingPrice) {
  if (!options || !options.length || !underlyingPrice) return [];

  const maxSpread = 0.20;

  // We expect options from /api/chain to have `type`, `strike`, `bid`, `ask`
  const calls = options.filter(o => {
    if (o.type !== "call") return false;
    if (o.bid == null || o.ask == null) return false;
    if (o.bid <= 0 || o.ask <= 0) return false;
    if (o.ask - o.bid > maxSpread) return false;
    return true;
  });

  if (!calls.length) return [];

  // Sort by strike
  calls.sort((a, b) => a.strike - b.strike);

  // Find ATM-ish call
  const atmIndex = calls.reduce(
    (bestIdx, o, idx) =>
      Math.abs(o.strike - underlyingPrice) <
      Math.abs(calls[bestIdx].strike - underlyingPrice)
        ? idx
        : bestIdx,
    0
  );

  // Window around ATM
  const window = 5;
  const start = Math.max(0, atmIndex - window);
  const end = Math.min(calls.length - 1, atmIndex + window);
  const windowCalls = calls.slice(start, end + 1);

  const candidates = [];

  // 1-wide and 2-wide bull call spreads
  for (let i = 0; i < windowCalls.length - 1; i++) {
    const long = windowCalls[i];
    const short1 = windowCalls[i + 1];

    candidates.push({
      type: "call",
      orientation: "bull",
      long: long.strike,
      short: short1.strike
    });

    if (i + 2 < windowCalls.length) {
      const short2 = windowCalls[i + 2];
      candidates.push({
        type: "call",
        orientation: "bull",
        long: long.strike,
        short: short2.strike
      });
    }
  }

  return candidates;
}
