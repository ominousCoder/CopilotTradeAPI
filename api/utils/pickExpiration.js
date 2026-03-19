// api/utils/pickExpiration.js

const BASE = process.env.TRADIER_BASE_URL; // FIX 8: ENV-driven base URL

export async function pickExpiration(symbol) {
  // FIX 8: Use ENV-driven base URL instead of hardcoded Tradier URL
  const url = new URL(`${BASE}/markets/options/expirations`);
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

  // Monthlies: 3rd Friday (day 15–21)
  const monthlies = expirations.filter(dateStr => {
    const d = new Date(dateStr);
    const day = d.getDate();
    const dow = d.getDay();
    return dow === 5 && day >= 15 && day <= 21;
  });

  if (!monthlies.length) return null;

  // FIX 9: Sort monthlies ascending to ensure nearest eligible is first
  monthlies.sort((a, b) => new Date(a) - new Date(b));

  const eligible = monthlies.filter(dateStr => {
    const d = new Date(dateStr);
    const diffDays = (d - today) / (1000 * 60 * 60 * 24);
    return diffDays >= minDays;
  });

  if (eligible.length) return eligible[0];

  // Fallback: nearest monthly even if < minDays
  return monthlies[0];
}

export default pickExpiration;
