// api/chain-helpers.js

export async function fetchOptionChain(symbol) {
  const url = new URL("https://api.tradier.com/v1/markets/options/expirations");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("includeAllRoots", "true");
  url.searchParams.set("strikes", "false");

  const expResponse = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.TRADIER_KEY}`,
      Accept: "application/json"
    }
  });

  const expData = await expResponse.json();
  const expirations = expData?.expirations?.date;
  if (!expirations || expirations.length === 0) return null;

  const expiration = expirations[0];

  const chainUrl = new URL("https://api.tradier.com/v1/markets/options/chains");
  chainUrl.searchParams.set("symbol", symbol);
  chainUrl.searchParams.set("expiration", expiration);

  const response = await fetch(chainUrl.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.TRADIER_KEY}`,
      Accept: "application/json"
    }
  });

  const data = await response.json();
  const raw = data?.options?.option;
  if (!raw) return null;

  return Array.isArray(raw) ? raw : [raw];
}

export function buildSpreads(chain) {
  const spreads = [];

  for (const long of chain) {
    if (long.option_type !== "call") continue;

    const longStrike = long.strike;
    const longMid = (long.bid + long.ask) / 2;

    for (const short of chain) {
      if (short.option_type !== "call") continue;
      if (short.strike <= longStrike) continue;

      const shortStrike = short.strike;
      const shortMid = (short.bid + short.ask) / 2;

      const width = shortStrike - longStrike;
      const bidAskSpread = long.ask - long.bid;
      const midPrice = longMid;

      spreads.push({
        expiration: long.expiration_date,
        longStrike,
        shortStrike,
        longMid,
        shortMid,
        width,
        bidAskSpread,
        midPrice,
        type: "call",
        spreadType: "bull",
        isSafe: true
      });
    }
  }

  return spreads;
}
