
export default async function handler(req, res) {
  const { symbol, expiration, long_strike, short_strike, type } = req.query;

  if (!symbol || !expiration || !long_strike || !short_strike || !type) {
    return res.status(400).json({
      error: "missing_parameters",
      message: "symbol, expiration, long_strike, short_strike, and type are required."
    });
  }

  try {
    // Fetch chain data for the two strikes
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
    const options = data?.options?.option;

    if (!options) {
      return res.status(404).json({
        error: "not_found",
        message: "No options returned for this chain."
      });
    }

    // Extract the two legs
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

    // Compute debit and spread metrics
    const longMid = (longLeg.bid + longLeg.ask) / 2;
    const shortMid = (shortLeg.bid + shortLeg.ask) / 2;
    const debit = longMid - shortMid;
    const width = Math.abs(shortLeg.strike - longLeg.strike);
    const maxProfit = width - debit;

    // Auto-detect orientation
    const isBull =
      (type === "call" && Number(short_strike) > Number(long_strike)) ||
      (type === "put" && Number(short_strike) < Number(long_strike));

    const spreadType = isBull ? "bull" : "bear";

    // Simple scoring bands (you will tune these)
    const debitScore =
      debit <= width * 0.25 ? 9 :
      debit <= width * 0.35 ? 7 :
      debit <= width * 0.45 ? 5 :
