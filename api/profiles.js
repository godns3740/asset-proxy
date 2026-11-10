import { requireAuth } from './_auth.js';

// 사람별 설정
//  GET   → { me, profiles: [...] }  (둘 다 볼 수 있음)
//  PATCH → 내 설정만 수정 (display_name, payday, payday_rule, owner_name, settings, setup_done)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });
const FIELDS = ['display_name', 'payday', 'payday_rule', 'owner_name', 'settings', 'setup_done'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;
  const base = `${SUPABASE_URL}/rest/v1/profiles`;
  try {
    if (req.method === 'GET') {
      const r = await fetch(`${base}?order=created_at.asc`, { headers: headers() });
      const data = await r.json();
      if (!r.ok) return res.status(500).json({ error: data?.message, message: 'profiles 표가 없어요. docs/supabase-multiuser.sql 을 Supabase에서 실행해 주세요.' });
      return res.status(200).json({ me: req.owner, profiles: data });
    }
    if (req.method === 'PATCH') {
      const body = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => FIELDS.includes(k)));
      if (body.payday !== undefined) body.payday = Math.min(31, Math.max(1, parseInt(body.payday, 10) || 25));
      if (body.payday_rule !== undefined && !['before', 'after'].includes(body.payday_rule)) delete body.payday_rule;
      const r = await fetch(`${base}?owner=eq.${encodeURIComponent(req.owner)}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) });
      return res.status(r.ok ? 200 : 500).json(await r.json());
    }
    return res.status(405).json({ message: '지원하지 않는 요청이에요' });
  } catch (e) {
    return res.status(500).json({ message: `서버 오류: ${e.message}` });
  }
}
