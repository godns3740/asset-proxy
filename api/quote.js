const KIS_APP_KEY = 'PS18OErVVqfxlL31KTWGnfozZ708UMTLDb4s';
const KIS_APP_SECRET = '3yrL+NZrHrZQ8NvCfLJnYK+IqJyq8pu7CP7TPVq25toHZ7nfAIfeK6yc72yuorXVLdvpRFFrx7EtBxMfcySvrzZD4v9BAgYyWxowfC5sUJ6prc0N0lpA3V2OlKllrBKGTbHIQzDzgJLJcPgTqtQkSrePjr+BTHRRJ3xwAM5C4lCFr4CeDbE=';
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const r = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: KIS_APP_KEY,
      appsecret: KIS_APP_SECRET,
    }),
  });
  const data = await r.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

const US_TICKERS = new Set(['TSLA', 'NKE', 'CLIK']);
const EXCD_MAP = { 'CLIK': 'NYS', 'TSLA': 'NAS', 'NKE': 'NYS' };

async function getUSPrice(token, sym) {
  const excd = EXCD_MAP[sym] || 'NAS';
  // 실시간 시도
  try {
    const r = await fetch(
      `${KIS_BASE}/uapi/overseas-stock/v1/quotations/price?AUTH=&EXCD=${excd}&SYMB=${sym}`,
      {
        headers: {
          'authorization': `Bearer ${token}`,
          'appkey': KIS_APP_KEY,
          'appsecret': KIS_APP_SECRET,
          'tr_id': 'HHDFS00000300',
          'custtype': 'P',
        },
      }
    );
    const data = await r.json();
    const price = parseFloat(data?.output?.last);
    if (price && price > 0) return { price, currency: 'USD', name: sym, type: 'realtime' };
  } catch(e) {}

  // 실시간 실패시 전일 종가 조회
  const today = new Date();
  const dateStr = today.toISOString().slice(0,10).replace(/-/g,'');
  const r2 = await fetch(
    `${KIS_BASE}/uapi/overseas-stock/v1/quotations/dailyprice?AUTH=&EXCD=${excd}&SYMB=${sym}&GUBN=0&BYMD=${dateStr}&MODP=0`,
    {
      headers: {
        'authorization': `Bearer ${token}`,
        'appkey': KIS_APP_KEY,
        'appsecret': KIS_APP_SECRET,
        'tr_id': 'HHDFS76240000',
        'custtype': 'P',
      },
    }
  );
  const data2 = await r2.json();
  const output = data2?.output2?.[0];
  const price2 = parseFloat(output?.clos);
  if (price2 && price2 > 0) return { price: price2, currency: 'USD', name: sym, type: 'close' };
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  try {
    const token = await getToken();
    const symList = symbols.split(',').map(s => s.trim());
    const result = {};

    for (const sym of symList) {
      try {
        if (US_TICKERS.has(sym)) {
          const q = await getUSPrice(token, sym);
          if (q) result[sym] = q;
        } else {
          const code = sym.replace('.KS', '');
          const r = await fetch(
            `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
            {
              headers: {
                'authorization': `Bearer ${token}`,
                'appkey': KIS_APP_KEY,
                'appsecret': KIS_APP_SECRET,
                'tr_id': 'FHKST01010100',
                'custtype': 'P',
              },
            }
          );
          const data = await r.json();
          const price = parseInt(data?.output?.stck_prpr);
          const name = data?.output?.hts_kor_isnm || sym;
          if (price && price > 0) result[sym] = { price, currency: 'KRW', name, type: 'realtime' };
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
