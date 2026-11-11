import { requireAuth } from './_auth.js';
import { parseSms, pickCategory } from './_sms-parse.js';
import { findSettleTarget, SETTLE_CAT } from './_settle.js';

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
  [/capcut|캡컷/i, /APPLE|CAPCUT/i],
  [/마운자로/, /브이에스라인|VS ?라인|VSLINE/i],
  [/비타민/, /와우바이오텍/],
  [/티빙/, /TVING|티빙/i],
  [/노션/, /NOTION|노션/i],
  [/이모티콘/, /이모티콘/],
  [/인터넷/, /인터넷|SK브로드밴드|KT|LG유플러스/i],
];
// ─── 사람별 설정 (profiles 표) ───────────────────────────────
const enc = s => encodeURIComponent(s);
async function loadProfile(base, owner) {
  const fallback = owner === (process.env.APP_OWNER || '규원')
    ? { owner_name: process.env.OWNER_NAME, settings: { balanceAssets: { '카카오뱅크': '카카오뱅크 주거래', '신한': '신한은행 통장' }, safeboxAsset: '카카오뱅크 세이프박스' } }
    : { owner_name: '', settings: {} };
  try {
    const r = await fetch(`${base}/profiles?owner=eq.${enc(owner)}&limit=1`, { headers: headers() });
    const rows = await r.json();
    if (r.ok && Array.isArray(rows) && rows[0]) return { ...fallback, ...rows[0], owner_name: rows[0].owner_name || fallback.owner_name, settings: { ...fallback.settings, ...(rows[0].settings || {}) } };
  } catch (e) { /* 설정이 없으면 기본값 */ }
  return fallback;
}

// ─── 통장 잔액 맞추기 ───────────────────────────────────────
// 문자를 보내는 통장 → 자산 목록의 이름 (사람마다 settings.balanceAssets / safeboxAsset)
async function syncBalances(base, p, owner, profile) {
  const ASSET_FOR_BANK = profile.settings.balanceAssets || {};
  const SAFEBOX_ASSET = profile.settings.safeboxAsset;
  const when = `${p.date.slice(5).replace('-', '/')}${p.time ? ' ' + p.time : ''}`;
  const done = [];
  // key: 같은 문자를 두 번 받았는지 확인하는 표시. 잔액을 그대로 덮어쓰는 경우는 두 번 해도 같아서 필요 없음
  const update = async (name, fn, key) => {
    const r = await fetch(`${base}/assets?select=id,amount,memo&name=eq.${enc(name)}&owner=eq.${enc(owner)}`, { headers: headers() });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return;
    const stamp = `[문자 ${when}${key ? '|' + key : ''}]`;
    let shown = null;
    await Promise.all(rows.map(a => {
      const memo = String(a.memo || '');
      if (key && memo.includes(stamp)) return null;
      const amount = fn(Number(a.amount));
      if (shown === null) shown = amount;
      const clean = memo.replace(/\s*\[(문자|직접) [^\]]*\]/g, '').trim();
      return fetch(`${base}/assets?id=eq.${a.id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ amount, memo: (clean + ' ' + stamp).trim() }) });
    }));
    if (shown !== null) done.push(`${name.replace(/^카카오뱅크 /, '')} 잔액 ${won(shown)}`);
  };
  if (p.balance !== null && ASSET_FOR_BANK[p.bank]) await update(ASSET_FOR_BANK[p.bank], () => p.balance);
  if (p.isSafebox && p.bank === '카카오뱅크' && SAFEBOX_ASSET) await update(SAFEBOX_ASSET, v => Math.max(0, v + (p.kind === '출금' ? p.amount : -p.amount)), `${p.kind}${p.amount}`);
  return done;
}

// 카카오뱅크는 체크카드 결제도 "출금"으로 보내서, 받는 쪽 이름으로 결제수단을 추정합니다
function guessPayment(p, ruleCategory, fixedHit) {
  if (p.type !== '지출' || p.payment !== '계좌이체' || p.kind !== '출금') return p.payment;
  if (fixedHit) return '계좌이체';                                   // 자동이체로 나가는 고정지출
  const personLike = /^간편이체/.test(p.merchant) || /^[가-힣]{2,4}$/.test(p.merchant);
  if (personLike && ruleCategory === '기타') return '계좌이체';        // 사람에게 보낸 돈
  return '체크카드';                                                 // 가게 이름 → 카드 결제
}
function matchFixed(merchant, list, amount) {
  const m = norm(merchant);
  const hits = list.filter(f => {
    if (f.is_active === false) return false;
    const n = norm(f.name);
    if (n.length >= 2 && (m.includes(n) || (m.length >= 2 && n.includes(m)))) return true;
    return FIXED_ALIASES.some(([fixedRe, smsRe]) => fixedRe.test(f.name) && (smsRe.test(merchant) || fixedRe.test(merchant)));
  });
  // 여러 개가 걸리면 금액이 가장 비슷한 것 (예: 앱스토어 → iCloud / CapCut)
  return hits.sort((a, b) => Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount))[0] || null;
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
  const base = `${SUPABASE_URL}/rest/v1`;
  const me = req.owner, mine = `&owner=eq.${enc(me)}`;
  const profile = await loadProfile(base, me);
  const p = parseSms(text, undefined, { ownerName: profile.owner_name });
  if (!p.ok) return res.status(422).json({ ok: false, message: `기록 못 함: ${p.reason}` });

  try {
    const [cr, fr] = await Promise.all([
      fetch(`${base}/categories?select=name,type${mine}`, { headers: headers() }),
      fetch(`${base}/fixed_expenses?select=name,category,is_active,amount${mine}`, { headers: headers() }),
    ]);
    const cats = await cr.json();
    const fixedList = await fr.json().catch(() => []);
    const names = Array.isArray(cats) ? cats.filter(c => c.type === p.type).map(c => c.name) : [];
    // 고정지출 목록의 이름과 겹치는 출금이면 고정지출로 표시 (변동지출 합계에서 빠짐)
    const fixedHit = p.type === '지출' ? matchFixed(p.merchant, Array.isArray(fixedList) ? fixedList : [], p.amount) : null;
    let category = pickCategory(p.merchant, p.type, names, p.time);
    // 처음 설정에서 적은 "월급 문자에 찍히는 이름"이면 월급으로
    const salaryNames = (profile.settings.salaryNames || []).filter(Boolean);
    if (p.type === '수입' && salaryNames.some(n => p.merchant.includes(n))) category = names.find(n => n === '월급' || n === '급여') || category;
    const ruleCategory = category;
    if (fixedHit && fixedHit.category && names.includes(fixedHit.category)) category = fixedHit.category;
    // 자동 분류가 안 되면, 예전에 같은 가게·사람을 직접 정리한 카테고리를 따릅니다
    if (!fixedHit && (category === '기타' || category === '기타수입') && p.merchant.length >= 2 && !/^토스페이|ATM|현금/i.test(p.merchant)) {
      const lr = await fetch(`${base}/transactions?select=category,memo${mine}&type=eq.${enc(p.type)}&category=neq.${enc('기타')}&category=neq.${enc('기타수입')}&or=(memo.like.${enc(p.merchant + ' · *')},memo.like.${enc('*(' + p.merchant + ') · *')},memo.eq.${enc(p.merchant)})&order=date.desc&limit=1`, { headers: headers() });
      const learned = await lr.json().catch(() => []);
      if (Array.isArray(learned) && learned[0] && names.includes(learned[0].category)) category = learned[0].category;
    }
    const memo = p.time ? `${p.merchant} · ${p.time}` : p.merchant;
    const tx = { date: p.date, type: p.type, category, payment: guessPayment(p, ruleCategory, fixedHit), memo, amount: p.amount, is_fixed: !!fixedHit, owner: me };

    // 내 다른 계좌로 보내서 내는 고정지출 (예: 한화생명·여행 적립): settings.selfFixed 에 적은 항목과 금액이 같으면 고정지출로 기록
    const selfFixed = (profile.settings.selfFixed || []).filter(Boolean);
    const selfHit = p.isSelfTransfer && !p.isSafebox && p.kind === '출금' && Array.isArray(fixedList)
      ? fixedList.find(f => f.is_active !== false && selfFixed.includes(f.name) && Number(f.amount) === p.amount) : null;
    if (selfHit) Object.assign(tx, { type: '지출', category: selfHit.category || category, payment: '계좌이체', is_fixed: true, memo: `${selfHit.name} (내 계좌로 이체)${p.time ? ' · ' + p.time : ''}` });

    if (req.query?.dryRun) return res.status(200).json({ ok: true, dryRun: true, parsed: p, transaction: tx });

    const q = s => encodeURIComponent(s);

    // 문자에 찍힌 잔액으로 통장 잔액을 맞춥니다 (실패해도 기록은 계속)
    const synced = await syncBalances(base, p, me, profile).catch(() => []);
    const syncMsg = synced.length ? ` · ${synced.join(', ')}` : '';

    // 신용카드 카드값: 결제할 때마다 카드 문자로 이미 기록되니, 통장에서 빠지는 카드값은 건너뜁니다
    const cardBills = (profile.settings.cardBills || []).filter(Boolean);
    if (p.type === '지출' && cardBills.some(c => p.merchant.includes(c))) {
      return res.status(200).json({ ok: true, ignored: true, message: `카드값 출금 ${won(p.amount)} · 결제마다 이미 기록돼서 건너뜀${syncMsg}` });
    }

    // 내 계좌끼리 옮긴 돈은 수입/지출이 아니므로 기록하지 않습니다.
    if (p.isSelfTransfer && !selfHit) {
      const what = p.isSafebox ? (p.kind === '출금' ? '세이프박스에 넣음' : '세이프박스에서 꺼냄') : '내 계좌 이체';
      return res.status(200).json({ ok: true, ignored: true, message: `${what} ${won(p.amount)} · 기록 안 함${syncMsg}` });
    }

    // 결제 취소: 같은 가맹점·금액의 최근 지출을 지웁니다.
    if (p.isCancel) {
      const fr = await fetch(`${base}/transactions?type=eq.${q('지출')}${mine}&amount=eq.${p.amount}&memo=like.${q(p.merchant + '*')}&order=date.desc&limit=1`, { headers: headers() });
      const found = await fr.json();
      if (Array.isArray(found) && found[0]) {
        await fetch(`${base}/transactions?id=eq.${found[0].id}`, { method: 'DELETE', headers: headers() });
        return res.status(200).json({ ok: true, cancelled: found[0].id, message: `취소 반영: ${p.merchant} ${won(p.amount)} 삭제` });
      }
      return res.status(200).json({ ok: true, ignored: true, message: `취소 문자지만 원래 결제를 못 찾았어요: ${p.merchant} ${won(p.amount)}` });
    }

    // 더치페이 정산: 사람 이름으로 들어온 돈이 최근 내 결제와 맞으면 그 결제에서 뺍니다
    if (p.type === '수입' && /^[가-힣]{2,4}$/.test(p.merchant) && !['월급', '급여'].includes(tx.category)) {
      const since = new Date(Date.parse(p.date) - 86400e3).toISOString().slice(0, 10);
      const rr = await fetch(`${base}/transactions?select=id,date,type,category,amount,memo,is_fixed,subcategory,payment${mine}&date=gte.${since}&date=lte.${p.date}`, { headers: headers() });
      const recent = await rr.json().catch(() => []);
      const target = Array.isArray(recent) ? findSettleTarget({ date: p.date, time: p.time, amount: p.amount }, recent) : null;
      if (target) {
        const already = recent.filter(t => t.subcategory === `정산:${target.id}`).reduce((a, t) => a + Number(t.amount), 0);
        tx.category = SETTLE_CAT; tx.subcategory = `정산:${target.id}`;
        tx.settleNote = `${String(target.memo || '').split(' · ')[0]} ${won(Number(target.amount))} → 내 몫 ${won(Number(target.amount) - already - p.amount)}`;
      }
    }
    const settleNote = tx.settleNote; delete tx.settleNote;

    // 같은 문자를 두 번 보내도 한 번만 저장합니다.
    const dr = await fetch(`${base}/transactions?select=id${mine}&date=eq.${p.date}&type=eq.${q(p.type)}&amount=eq.${p.amount}&memo=eq.${q(tx.memo)}&limit=1`, { headers: headers() });
    const dup = await dr.json();
    if (Array.isArray(dup) && dup[0]) {
      return res.status(200).json({ ok: true, duplicate: true, id: dup[0].id, message: `이미 기록됨: ${p.merchant} ${won(p.amount)}` });
    }

    const ir = await fetch(`${base}/transactions`, { method: 'POST', headers: headers(), body: JSON.stringify(tx) });
    const saved = await ir.json();
    if (!ir.ok) return res.status(502).json({ ok: false, message: `저장 실패: ${saved?.message || ir.status}`, detail: saved });
    const sign = p.type === '수입' ? '+' : '-';
    if (settleNote) return res.status(201).json({ ok: true, id: saved?.[0]?.id, transaction: tx, message: `정산 +${won(p.amount)} (${p.merchant}) · ${settleNote}${syncMsg}` });
    return res.status(201).json({ ok: true, id: saved?.[0]?.id, transaction: tx, message: `${tx.is_fixed ? '고정 ' : ''}${selfHit ? selfHit.name : category} ${sign}${won(p.amount)} (${p.merchant})${syncMsg}` });
  } catch (e) {
    return res.status(500).json({ ok: false, message: `서버 오류: ${e.message}` });
  }
}
