const SUPABASE_URL = 'https://warnzdrbovqmegwekicn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhcm56ZHJib3ZxbWVnd2VraWNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQ2OTgzNCwiZXhwIjoyMDk4MDQ1ODM0fQ.LbcTCS-irxJCIrqGdM2vE8AMG7ZJS1IaeUCSR9BRyD8';
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
  const base = `${SUPABASE_URL}/rest/v1/fixed_expenses`;
  try {
    if (req.method === 'GET') {
      const r = await fetch(`${base}?order=id.asc`, { headers });
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
  } catch(e) { return res.status(500).json({ error: e.message }); }
}
