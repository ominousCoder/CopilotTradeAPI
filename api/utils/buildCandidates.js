// api/utils/buildCandidates.js

export function buildCandidates(options, underlyingPrice) {
  if (!options || !options.length || !underlyingPrice) return [];

  const maxSpread = 0.20;

  // ------------------------------------------------------------
  // Filter liquid calls
  // ------------------------------------------------------------
  const calls = options.filter(o => {
    if (o.type !== "call") return false;
    if (o.bid == null || o.ask == null) return false;
    if (o.bid <= 0 || o.ask <= 0) return false;
    if (o.ask - o.bid > maxSpread) return false;
    return true;
  });

  // FIX 7: Filter liquid puts to support bear put spreads
  const puts = options.filter(o => {
    if (o.type !== "put") return false;
    if (o.bid == null || o.ask == null) return false;
    if (o.bid <= 0 || o.ask <= 0) return false;
    if (o.ask - o.bid > maxSpread) return false;
    return true;
  });

  // ------------------------------------------------------------
  // Find ATM index helper
  // ------------------------------------------------------------
  function findAtmIndex(chain) {
    return chain.reduce(
      (bestIdx, o, idx) =>
        Math.abs(o.strike - underlyingPrice) 
        Math.abs(chain[bestIdx].strike - underlyingPrice)
          ? idx
          : bestIdx,
      0
    );
  }

  const candidates = [];

  // ------------------------------------------------------------
  // Bull call spreads
  // ------------------------------------------------------------
  if (calls.length) {
    calls.sort((a, b) => a.strike - b.strike);
    const atmIndex = findAtmIndex(calls);
    const window = 5;
    const start = Math.max(0, atmIndex - window);
    const end = Math.min(calls.length - 1, atmIndex + window);
    const windowCalls = calls.slice(start, end + 1);

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
  }

  // FIX 7: Bear put spreads
  if (puts.length) {
    puts.sort((a, b) => b.strike - a.strike); // Descending for puts
    const atmIndex = findAtmIndex(puts);
    const window = 5;
    const start = Math.max(0, atmIndex - window);
    const end = Math.min(puts.length - 1, atmIndex + window);
    const windowPuts = puts.slice(start, end + 1);

    for (let i = 0; i < windowPuts.length - 1; i++) {
      const long = windowPuts[i];
      const short1 = windowPuts[i + 1];
      candidates.push({
        type: "put",
        orientation: "bear",
        long: long.strike,
        short: short1.strike
      });
      if (i + 2 < windowPuts.length) {
        const short2 = windowPuts[i + 2];
        candidates.push({
          type: "put",
          orientation: "bear",
          long: long.strike,
          short: short2.strike
        });
      }
    }
  }

  return candidates;
}

export default buildCandidates;
