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
          const excd = EXCD_MAP[sym] || 'NAS';
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
          if (price) result[sym] = { price, currency: 'USD', name: sym };
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
          if (price) result[sym] = { price, currency: 'KRW', name: data?.output?.hts_kor_isnm || code };
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
