export async function pickExpiration(symbol) {
  const url = new URL("https://api.tradier.com/v1/markets/options/expirations");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("includeAllRoots", "true");
  url.searchParams.set("strikes", "false");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.TRADIER_KEY}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) return null;

  const data = await response.json();
  const expirations = data?.expirations?.date;
  if (!expirations) return null;

  const today = new Date();
  const minDays = 14;

  const monthlies = expirations.filter(dateStr => {
    const d = new Date(dateStr);
    const day = d.getDate();
    const dow = d.getDay();
    return dow === 5 && day >= 15 && day <= 21;
  });

  if (monthlies.length === 0) return null;

  const eligible = monthlies.filter(dateStr => {
    const d = new Date(dateStr);
    const diff = (d - today) / (1000 * 60 * 60 * 24);
    return diff >= minDays;
  });

  if (eligible.length > 0) return eligible[0];

  return monthlies[0];
}
