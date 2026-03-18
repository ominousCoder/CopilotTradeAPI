// api/diagnostic.js
//
// Single‑ticker diagnostic endpoint for Tradier.
// Confirms expirations, DTE filtering, chain integrity,
// call/put counts, delta availability, and long‑leg selection.

import {
  fetchExpirations,
  filterExpirations,
  fetchOptionChain,
  buildSpreads
} from "./chain-helpers";

export default async function handler(req, res) {
  try {
    const { symbol } = req.query;

    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol parameter" });
    }

    // 1. Fetch all expirations
    const allExps = await fetchExpirations(symbol);

    // 2. Filter to 7–45 DTE, nearest‑first, first 10
    const filtered = filterExpirations(allExps);

    const expirationDiagnostics = [];

    for (const exp of filtered) {
      // 3. Fetch chain for this expiration
      const chain = await fetchOptionChain(symbol, exp);

      if (!chain) {
        expirationDiagnostics.push({
          expiration: exp,
          error: "No chain returned"
        });
        continue;
      }

      const { underlying, options } = chain;

      const calls = options.filter((o) => o.option_type === "call");
      const puts = options.filter((o) => o.option_type === "put");

      // Count missing deltas
      const missingCallDeltas = calls.filter((c) => c.greeks?.delta == null).length;
      const missingPutDeltas = puts.filter((p) => p.greeks?.delta == null).length;

      // 4. Build spreads (bull + bear)
      const spreads = await buildSpreads(chain, symbol, exp, [0.5, 1, 2, 2.5, 5]);

      expirationDiagnostics.push({
        expiration: exp,
        underlying,
        totalOptions: options.length,
        calls: calls.length,
        puts: puts.length,
        missingCallDeltas,
        missingPutDeltas,
        spreadsBuilt: spreads.length
      });
    }

    return res.status(200).json({
      symbol,
      totalExpirations: allExps.length,
      filteredExpirations: filtered.length,
      expirations: expirationDiagnostics
    });

  } catch (err) {
    console.error("Diagnostic error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
