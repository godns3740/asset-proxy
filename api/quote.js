export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://finance.yahoo.com',
      'Origin': 'https://finance.yahoo.com',
    };

    const symList = symbols.split(',');
    const result = {};

    for (const sym of symList) {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.trim())}?interval=1d&range=1d`;
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) continue;
        const data = await r.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta) {
          result[sym.trim()] = {
            price: meta.regularMarketPrice,
            currency: meta.currency,
            name: meta.shortName || sym,
          };
        }
      } catch(e) {
        console.error(sym, e.message);
      }
    }

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
