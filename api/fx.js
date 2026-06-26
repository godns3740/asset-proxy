export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // USD/KRW 환율
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=USDKRW%3DX&fields=regularMarketPrice';
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await r.json();
    const rate = data?.quoteResponse?.result?.[0]?.regularMarketPrice;
    res.status(200).json({ USDKRW: rate || 1350 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
