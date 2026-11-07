const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const base = `${SUPABASE_URL}/rest/v1/transactions`;

  try {
    if (req.method === 'GET') {
      const { month } = req.query;
      const { start, end } = req.query;
      let url = `${base}?order=date.desc`;
      if (start && end) url += `&date=gte.${start}&date=lte.${end}`;
      else if (req.query.month) url += `&date=gte.${req.query.month}-01&date=lte.${req.query.month}-31`;
      const r = await fetch(url, { headers });
      return res.status(200).json(await r.json());
    }
    if (req.method === 'POST') {
      const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify(req.body) });
      return res.status(201).json(await r.json());
    }
    if (req.method === 'PATCH') {
      const { id, ...fields } = req.body;
      const r = await fetch(`${base}?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify(fields) });
      return res.status(200).json(await r.json());
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      await fetch(`${base}?id=eq.${id}`, { method: 'DELETE', headers });
      return res.status(200).json({ deleted: id });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
