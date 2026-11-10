import { requireAuth } from './_auth.js';

// 사람별 데이터 공통 처리
//  GET    ?owner=이름 (생략하면 내 것, all 이면 모두)  → 누구 것이든 볼 수 있음
//  POST   항상 내 이름으로 저장
//  PATCH  / DELETE  내 것만 고칠 수 있음
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
});
const enc = s => encodeURIComponent(s);

async function relay(r, res, okStatus) {
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = String((data && (data.message || data.hint)) || r.status);
    if (/owner/.test(msg) && /column|does not exist/.test(msg)) {
      return res.status(500).json({ error: msg, message: 'DB에 owner 칸이 없어요. docs/supabase-multiuser.sql 을 Supabase에서 실행해 주세요.' });
    }
    return res.status(r.status).json({ error: msg, message: `DB 오류: ${msg}` });
  }
  return res.status(okStatus).json(data);
}

export function crudHandler(table, { order = 'id.asc', extraFilters } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!requireAuth(req, res)) return;
    const base = `${SUPABASE_URL}/rest/v1/${table}`;
    const me = req.owner, q = req.query || {};
    try {
      if (req.method === 'GET') {
        const who = q.owner === 'all' ? '' : `&owner=eq.${enc(q.owner || me)}`;
        const r = await fetch(`${base}?order=${order}${who}${extraFilters ? extraFilters(q) : ''}`, { headers: headers() });
        return relay(r, res, 200);
      }
      if (req.method === 'POST') {
        const rows = Array.isArray(req.body) ? req.body : [req.body];
        const body = rows.map(({ id, owner, created_at, ...rest }) => ({ ...rest, owner: me }));
        const r = await fetch(base, { method: 'POST', headers: headers(), body: JSON.stringify(Array.isArray(req.body) ? body : body[0]) });
        return relay(r, res, 201);
      }
      if (req.method === 'PATCH') {
        const { id, owner, created_at, ...fields } = req.body || {};
        const r = await fetch(`${base}?id=eq.${enc(id)}&owner=eq.${enc(me)}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(fields) });
        const data = await r.json().catch(() => null);
        if (r.ok && Array.isArray(data) && !data.length) return res.status(403).json({ error: 'forbidden', message: '다른 사람의 데이터는 고칠 수 없어요' });
        if (!r.ok) return relay({ ok: false, status: r.status, json: async () => data }, res, 200);
        return res.status(200).json(data);
      }
      if (req.method === 'DELETE') {
        const r = await fetch(`${base}?id=eq.${enc(q.id)}&owner=eq.${enc(me)}`, { method: 'DELETE', headers: headers() });
        const data = await r.json().catch(() => null);
        if (r.ok && Array.isArray(data) && !data.length) return res.status(403).json({ error: 'forbidden', message: '다른 사람의 데이터는 지울 수 없어요' });
        if (!r.ok) return relay({ ok: false, status: r.status, json: async () => data }, res, 200);
        return res.status(200).json({ deleted: q.id });
      }
      return res.status(405).json({ error: 'Method not allowed', message: '지원하지 않는 요청이에요' });
    } catch (e) {
      return res.status(500).json({ error: e.message, message: `서버 오류: ${e.message}` });
    }
  };
}
