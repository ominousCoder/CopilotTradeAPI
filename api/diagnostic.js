// api/diagnostic.js

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

    // FIX 10: Raw connectivity test before hitting helpers
    // This isolates whether the issue is auth/URL vs helper logic
    let rawConnectivity = null;
    try {
      const rawTest = await fetch(
        `${process.env.TRADIER_BASE_URL}/markets/quotes?symbols=${symbol}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.TRADIER_KEY}`,
            Accept: "application/json"
          }
        }
      );
      const rawJson = await rawTest.json();
      rawConnectivity = {
        status: rawTest.status,
        ok: rawTest.ok,
        hasQuote: !!rawJson?.quotes?.quote,
        last: rawJson?.quotes?.quote?.last ?? null
      };
    } catch (rawErr) {
      rawConnectivity = {
        status: "fetch_failed",
        ok: false,
        error: rawErr.message
      };
    }

    // FIX 11: Raw chain test before hitting helpers
    // Tests greeks=true directly to confirm Greeks are returning
    let rawChainTest = null;
    try {
      const today = new Date();
      const testDate = new Date(today);
      testDate.setDate(today.getDate() + 30);
      const testExp = testDate.toISOString().split("T")[0];

      const rawChain = await fetch(
        `${process.env.TRADIER_BASE_URL}/markets/options/chains?symbol=${symbol}&expiration=${testExp}&greeks=true`,
        {
          headers: {
            Authorization: `Bearer ${process.env.TRADIER_KEY}`,
            Accept: "application/json"
          }
        }
      );
      const rawChainJson = await rawChain.json();
      const firstOption = rawChainJson?.options?.option?.[0] ?? null;
      rawChainTest = {
        status: rawChain.status,
        ok: rawChain.ok,
        testExpiration: testExp,
        hasOptions: !!rawChainJson?.options?.option,
        optionCount: rawChainJson?.options?.option?.length ?? 0,
        hasGreeks: !!firstOption?.greeks,
        sampleDelta: firstOption?.greeks?.delta ?? null,
        sampleStrike: firstOption?.strike ?? null
      };
    } catch (chainErr) {
      rawChainTest = {
        status: "fetch_failed",
        ok: false,
        error: chainErr.message
      };
    }

    // ------------------------------------------------------------
    // Full pipeline diagnostic
    // ------------------------------------------------------------
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
      connectivity: rawConnectivity,      // FIX 10: Raw connectivity result
      chainTest: rawChainTest,            // FIX 11: Raw chain + Greeks result
      totalExpirations: allExps.length,
      filteredExpirations: filtered.length,
      expirations: expirationDiagnostics
    });

  } catch (err) {
    console.error("Diagnostic error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
