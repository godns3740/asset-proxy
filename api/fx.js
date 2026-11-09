import { requireAuth } from './_auth.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;

  // USD/KRW 환율: Yahoo가 막히면 무료 환율 API로 대신 받아옵니다
  const sources = [
    ['yahoo', async () => {
      const r = await fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=USDKRW%3DX&fields=regularMarketPrice', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      return (await r.json())?.quoteResponse?.result?.[0]?.regularMarketPrice;
    }],
    ['open.er-api', async () => (await (await fetch('https://open.er-api.com/v6/latest/USD')).json())?.rates?.KRW],
    ['frankfurter', async () => (await (await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW')).json())?.rates?.KRW],
  ];
  for (const [source, get] of sources) {
    try {
      const rate = Number(await get());
      if (rate > 500 && rate < 5000) return res.status(200).json({ USDKRW: rate, source });
    } catch (e) { /* 다음 출처로 */ }
  }
  res.status(200).json({ USDKRW: 1350, source: 'fallback' });
}
