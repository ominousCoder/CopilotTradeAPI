export default async function handler(req, res) {
  const { symbol, expiration, long_strike, short_strike, type } = req.query;

  if (!symbol || !expiration || !long_strike || !short_strike || !type) {
    return res.status(400).json({
      error: "missing_parameters",
      message: "symbol, expiration, long_strike, short_strike, and type are required."
    });
  }

  try {
    // Fetch chain
    const url = new URL("https://api.tradier.com/v1/markets/options/chains");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("expiration", expiration);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.TRADIER_KEY}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "provider_error",
        message: "Tradier returned a non-200 response."
      });
    }

    const data = await response.json();
    const raw = data?.options?.option;

    if (!raw) {
      return res.status(404).json({
        error: "not_found",
        message: "No options returned for this chain."
      });
    }

    const options = Array.isArray(raw) ? raw : [raw];

    // Extract legs
    const longLeg = options.find(
      o => o.strike == long_strike && o.option_type === type
    );
    const shortLeg = options.find(
      o => o.strike == short_strike && o.option_type === type
    );

    if (!longLeg || !shortLeg) {
      return res.status(404).json({
        error: "legs_not_found",
        message: "One or both legs were not found in the chain."
      });
    }

    // Validate bid/ask
    if (
      longLeg.bid == null || longLeg.ask == null ||
      shortLeg.bid == null || shortLeg.ask == null
    ) {
      return res.status(400).json({
        error: "invalid_market_data",
        message: "Missing bid/ask for one or both legs."
      });
    }

    // Mid prices
    const longMid = (longLeg.bid + longLeg.ask) / 2;
    const shortMid = (shortLeg.bid + shortLeg.ask) / 2;

    if (!isFinite(longMid) || !isFinite(shortMid)) {
      return res.status(400).json({
        error: "invalid_mid",
        message: "Could not compute mid prices."
      });
    }

    // Spread math
    const debit = longMid - shortMid;
    const width = Math.abs(shortLeg.strike - longLeg.strike);
    const maxProfit = width - debit;

    // Orientation
    const isBull =
      (type === "call" && Number(short_strike) > Number(long_strike)) ||
      (type === "put" && Number(short_strike) < Number(long_strike));

    const spreadType = isBull ? "bull" : "bear";

    // Scoring
    const debitScore =
      debit <= width * 0.25 ? 9 :
      debit <= width * 0.35 ? 7 :
      debit <= width * 0.45 ? 5 :
      debit <= width * 0.55 ? 3 : 1;

    const riskReward = maxProfit / debit;
    const rrScore =
      riskReward >= 3 ? 9 :
      riskReward >= 2 ? 7 :
      riskReward >= 1.5 ? 5 :
      riskReward >= 1.2 ? 3 : 1;

    const liquidityScore =
      longLeg.bid > 0 && shortLeg.bid > 0 ? 9 :
      longLeg.ask - longLeg.bid < 0.1 && shortLeg.ask - shortLeg.bid < 0.1 ? 7 :
      3;

    const totalScore = debitScore + rrScore + liquidityScore;

    // Safety rules
    const isSafe =
      debit > 0 &&
      debit < width &&
      longLeg.bid != null &&
      shortLeg.bid != null;

    return res.status(200).json({
      symbol,
      expiration,
      long_strike: Number(long_strike),
      short_strike: Number(short_strike),
      type,
      spreadType,
      pricing: {
        longMid,
        shortMid,
        debit,
        width,
        maxProfit
      },
      scores: {
        debitScore,
        rrScore,
        liquidityScore,
        total_score: totalScore
      },
      eligibility: {
        is_safe: isSafe
      }
    });

  } catch (err) {
    return res.status(500).json({
      error: "internal_error",
      message: err.message
    });
  }
}
