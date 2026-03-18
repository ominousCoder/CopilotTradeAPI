import {
  fetchExpirations,
  filterExpirations,
  fetchOptionChain,
  buildSpreads
} from "./chain-helpers";

export default async function handler(req, res) {
  console.log("TRADIER_KEY present:", !!process.env.TRADIER_KEY);
  console.log("TRADIER_BASE_URL:", process.env.TRADIER_BASE_URL);

  try {
    const { symbol } = req.query;

    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol parameter" });
    }

    const allExps = await fetchExpirations(symbol);
    const filtered = filterExpirations(allExps);

    const expirationDiagnostics = [];

    for (const exp of filtered) {
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

      const missingCallDeltas = calls.filter((c) => c.greeks?.delta == null).length;
      const missingPutDeltas = puts.filter((p) => p.greeks?.delta == null).length;

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
