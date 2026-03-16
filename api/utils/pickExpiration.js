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

  // Monthlies: 3rd Friday
  const monthlies = expirations.filter(dateStr => {
    const d = new Date(dateStr);
    const day = d.getDate();
    const dow = d.getDay();
    return dow === 5 && day >= 15 && day <= 21;
  });

  if (!monthlies.length) return null;

  const eligible = monthlies.filter(dateStr => {
    const d = new Date(dateStr);
    const diffDays = (d - today) / (1000 * 60 * 60 * 24);
    return diffDays >= minDays;
  });

  if (eligible.length) return eligible[0];

  // Fallback: nearest monthly even if < minDays
  return monthlies[0];
}
