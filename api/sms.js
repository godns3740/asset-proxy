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
const norm = s => String(s || '').toLowerCase().replace(/[\s()（）\[\]·._-]/g, '');
// 고정지출 이름과 문자에 찍히는 이름이 다른 경우의 별칭
const FIXED_ALIASES = [
  [/휴대폰|통신|핸드폰/, /SK텔레콤|SKT|KT|LG유플러스|U\+|알뜰/i],
  [/클로드|claude/i, /ANTHROPIC|CLAUDE/i],
  [/넷플릭스/, /NETFLIX|넷플릭스/i],
  [/icloud|아이클라우드/i, /APPLE|ICLOUD/i],
  [/티빙/, /TVING|티빙/i],
  [/노션/, /NOTION|노션/i],
  [/이모티콘/, /이모티콘/],
  [/인터넷/, /인터넷|SK브로드밴드|KT|LG유플러스/i],
];
// 카카오뱅크는 체크카드 결제도 "출금"으로 보내서, 받는 쪽 이름으로 결제수단을 추정합니다
function guessPayment(p, ruleCategory, fixedHit) {
  if (p.type !== '지출' || p.payment !== '계좌이체' || p.kind !== '출금') return p.payment;
  if (fixedHit) return '계좌이체';                                   // 자동이체로 나가는 고정지출
  const personLike = /^간편이체/.test(p.merchant) || /^[가-힣]{2,4}$/.test(p.merchant);
  if (personLike && ruleCategory === '기타') return '계좌이체';        // 사람에게 보낸 돈
  return '체크카드';                                                 // 가게 이름 → 카드 결제
}
function matchFixed(merchant, list) {
  const m = norm(merchant);
  return list.find(f => {
    if (f.is_active === false) return false;
    const n = norm(f.name);
    if (n.length >= 2 && (m.includes(n) || (m.length >= 2 && n.includes(m)))) return true;
    return FIXED_ALIASES.some(([fixedRe, smsRe]) => fixedRe.test(f.name) && smsRe.test(merchant));
  }) || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', message: '방법(메소드)을 POST로 설정해 주세요' });

  const body = req.body;
  const text = typeof body === 'string' ? body : (body?.text || body?.message || '');
  const p = parseSms(text);
  if (!p.ok) return res.status(422).json({ ok: false, message: `기록 못 함: ${p.reason}` });

  const base = `${SUPABASE_URL}/rest/v1`;
  try {
    const [cr, fr] = await Promise.all([
      fetch(`${base}/categories?select=name,type`, { headers: headers() }),
      fetch(`${base}/fixed_expenses?select=name,category,is_active`, { headers: headers() }),
    ]);
    const cats = await cr.json();
    const fixedList = await fr.json().catch(() => []);
    const names = Array.isArray(cats) ? cats.filter(c => c.type === p.type).map(c => c.name) : [];
    // 고정지출 목록의 이름과 겹치는 출금이면 고정지출로 표시 (변동지출 합계에서 빠짐)
    const fixedHit = p.type === '지출' ? matchFixed(p.merchant, Array.isArray(fixedList) ? fixedList : []) : null;
    let category = pickCategory(p.merchant, p.type, names, p.time);
    const ruleCategory = category;
    if (fixedHit && fixedHit.category && names.includes(fixedHit.category)) category = fixedHit.category;
    // 자동 분류가 안 되면, 예전에 같은 가게·사람을 직접 정리한 카테고리를 따릅니다
    if (!fixedHit && (category === '기타' || category === '기타수입') && p.merchant.length >= 2 && !/^토스페이|ATM|현금/i.test(p.merchant)) {
      const enc = s => encodeURIComponent(s);
      const lr = await fetch(`${base}/transactions?select=category,memo&type=eq.${enc(p.type)}&category=neq.${enc('기타')}&category=neq.${enc('기타수입')}&or=(memo.like.${enc(p.merchant + ' · *')},memo.like.${enc('*(' + p.merchant + ') · *')},memo.eq.${enc(p.merchant)})&order=date.desc&limit=1`, { headers: headers() });
      const learned = await lr.json().catch(() => []);
      if (Array.isArray(learned) && learned[0] && names.includes(learned[0].category)) category = learned[0].category;
    }
    const memo = p.time ? `${p.merchant} · ${p.time}` : p.merchant;
    const tx = { date: p.date, type: p.type, category, payment: guessPayment(p, ruleCategory, fixedHit), memo, amount: p.amount, is_fixed: !!fixedHit };

    if (req.query?.dryRun) return res.status(200).json({ ok: true, dryRun: true, parsed: p, transaction: tx });

    const q = s => encodeURIComponent(s);

    // 내 계좌끼리 옮긴 돈은 수입/지출이 아니므로 기록하지 않습니다.
    if (p.isSelfTransfer) {
      return res.status(200).json({ ok: true, ignored: true, message: `내 계좌 이체라 기록 안 함: ${p.merchant} ${won(p.amount)}` });
    }

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
    if (!ir.ok) return res.status(502).json({ ok: false, message: `저장 실패: ${saved?.message || ir.status}`, detail: saved });
    const sign = p.type === '수입' ? '+' : '-';
    return res.status(201).json({ ok: true, id: saved?.[0]?.id, transaction: tx, message: `${tx.is_fixed ? '고정 ' : ''}${category} ${sign}${won(p.amount)} (${p.merchant})` });
  } catch (e) {
    return res.status(500).json({ ok: false, message: `서버 오류: ${e.message}` });
  }
}
