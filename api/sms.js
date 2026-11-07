import { requireAuth } from './_auth.js';
import { parseSms, pickCategory } from './_sms-parse.js';

// 아이폰 단축어가 카카오뱅크 문자를 그대로 보내면 거래내역에 저장합니다.
// POST /api/sms  헤더 x-app-token, 본문 {"text":"문자 전체"} (또는 text/plain 본문)
// ?dryRun=1 이면 저장하지 않고 해석 결과만 돌려줍니다.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
});
const won = n => n.toLocaleString('ko-KR') + '원';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  const text = typeof body === 'string' ? body : (body?.text || body?.message || '');
  const p = parseSms(text);
  if (!p.ok) return res.status(422).json({ ok: false, message: `기록 못 함: ${p.reason}` });

  const base = `${SUPABASE_URL}/rest/v1`;
  try {
    const cr = await fetch(`${base}/categories?select=name,type`, { headers: headers() });
    const cats = await cr.json();
    const names = Array.isArray(cats) ? cats.filter(c => c.type === p.type).map(c => c.name) : [];
    const category = pickCategory(p.merchant, p.type, names);
    const memo = p.time ? `${p.merchant} · ${p.time}` : p.merchant;
    const tx = { date: p.date, type: p.type, category, payment: p.payment, memo, amount: p.amount, is_fixed: false };

    if (req.query?.dryRun) return res.status(200).json({ ok: true, dryRun: true, parsed: p, transaction: tx });

    const q = s => encodeURIComponent(s);

    // 결제 취소: 같은 가맹점·금액의 최근 지출을 지웁니다.
    if (p.isCancel) {
      const fr = await fetch(`${base}/transactions?type=eq.${q('지출')}&amount=eq.${p.amount}&memo=like.${q(p.merchant + '*')}&order=date.desc&limit=1`, { headers: headers() });
      const found = await fr.json();
      if (Array.isArray(found) && found[0]) {
        await fetch(`${base}/transactions?id=eq.${found[0].id}`, { method: 'DELETE', headers: headers() });
        return res.status(200).json({ ok: true, cancelled: found[0].id, message: `취소 반영: ${p.merchant} ${won(p.amount)} 삭제` });
      }
      return res.status(200).json({ ok: true, ignored: true, message: `취소 문자지만 원래 결제를 못 찾았어요: ${p.merchant} ${won(p.amount)}` });
    }

    // 같은 문자를 두 번 보내도 한 번만 저장합니다.
    const dr = await fetch(`${base}/transactions?select=id&date=eq.${p.date}&type=eq.${q(p.type)}&amount=eq.${p.amount}&memo=eq.${q(memo)}&limit=1`, { headers: headers() });
    const dup = await dr.json();
    if (Array.isArray(dup) && dup[0]) {
      return res.status(200).json({ ok: true, duplicate: true, id: dup[0].id, message: `이미 기록됨: ${p.merchant} ${won(p.amount)}` });
    }

    const ir = await fetch(`${base}/transactions`, { method: 'POST', headers: headers(), body: JSON.stringify(tx) });
    const saved = await ir.json();
    if (!ir.ok) return res.status(502).json({ ok: false, message: '저장 실패', detail: saved });
    const sign = p.type === '수입' ? '+' : '-';
    return res.status(201).json({ ok: true, id: saved?.[0]?.id, transaction: tx, message: `${category} ${sign}${won(p.amount)} (${p.merchant})` });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}
