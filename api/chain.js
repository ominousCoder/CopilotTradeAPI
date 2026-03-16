
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
    const options = data?.options?.option;

    if (!options || options.length === 0) {
      return res.status(404).json({
        error: "not_found",
        message: `No options returned for ${
