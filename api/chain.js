export default async function handler(req, res) {
  const { symbol, expiration, min_strike, max_strike } = req.query;

  if (!symbol || !expiration) {
    return res.status(400).json({
      error: "missing_parameters",
      message: "Query parameters 'symbol' and 'expiration' are required."
    });
  }

  try {
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
        message: `No options returned for ${symbol} on ${expiration}.`
      });
    }

    // Normalize: Tradier returns object for 1 contract, array for many
    const options = Array.isArray(raw) ? raw : [raw];

    // Optional strike filtering
    let filtered = options;
    const min = min_strike ? Number(min_strike) : null;
    const max = max_strike ? Number(max_strike) : null;

    if (min !== null) filtered = filtered.filter(o => o.strike >= min);
    if (max !== null) filtered = filtered.filter(o => o.strike <= max);

    return res.status(200).json({
      symbol,
      expiration,
      count: filtered.length,
      options: filtered.map(o => ({
        type: o.option_type,
        strike: o.strike,
        last: o.last,
        bid: o.bid,
        ask: o.ask,
        volume: o.volume,
        open_interest: o.open_interest,
        iv: o.greeks?.iv,
        delta: o.greeks?.delta,
        gamma: o.greeks?.gamma,
        theta: o.greeks?.theta,
        vega: o.greeks?.vega
      }))
    });

  } catch (err) {
    return res.status(500).json({
      error: "internal_error",
      message: err.message
    });
  }
}
