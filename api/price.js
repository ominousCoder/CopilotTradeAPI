export default async function handler(req, res) {
  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({
      error: "missing_symbol",
      message: "Query parameter 'symbol' is required."
    });
  }

  try {
    const response = await fetch(
      `https://api.tradier.com/v1/markets/quotes?symbols=${symbol}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TRADIER_KEY}`,
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        error: "provider_error",
        message: "Tradier returned a non-200 response."
      });
    }

    const data = await response.json();
    const q = data?.quotes?.quote;

    if (!q) {
      return res.status(404).json({
        error: "not_found",
        message: `No quote data returned for symbol ${symbol}.`
      });
    }

    return res.status(200).json({
      symbol: q.symbol,
      last: q.last,
      bid: q.bid,
      ask: q.ask,
      timestamp: q.trade_date,
      source: "tradier"
    });
  } catch (err) {
    return res.status(500).json({
      error: "internal_error",
      message: err.message
    });
  }
}
