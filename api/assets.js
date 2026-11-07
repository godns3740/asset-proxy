import { requireAuth } from './_auth.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;

  const base = `${SUPABASE_URL}/rest/v1/assets`;

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${base}?order=id.asc`, { headers });
      const data = await r.json();
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const r = await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
      });
      const data = await r.json();
      return res.status(201).json(data);
    }
    if (req.method === 'PATCH') {
      const { id, ...fields } = req.body;
      const r = await fetch(`${base}?id=eq.${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(fields),
      });
      const data = await r.json();
      return res.status(200).json(data);
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const r = await fetch(`${base}?id=eq.${id}`, {
        method: 'DELETE',
        headers,
      });
      return res.status(200).json({ deleted: id });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
