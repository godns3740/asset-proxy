// 서버용 가계부 계산 (index.html 의 계산과 같은 규칙)
// 월급날 기준 기간, 고정지출 예상/실제, 특별 지출(예산 제외), 통장별 잔액 묶음

const SALARY_CATS = ['월급', '급여'];
const PAYDAY = 25;
const HOLIDAYS = new Set([
  '2025-01-28','2025-01-29','2025-01-30','2025-05-05','2025-05-06','2025-10-03','2025-10-05','2025-10-06','2025-10-07','2025-10-08','2025-10-09','2025-12-25',
  '2026-02-16','2026-02-17','2026-02-18','2026-05-24','2026-05-25','2026-09-24','2026-09-25','2026-09-26','2026-12-25',
  '2027-02-06','2027-02-07','2027-02-08','2027-02-09','2027-05-13','2027-09-14','2027-09-15','2027-09-16','2027-12-25',
  '2028-01-25','2028-01-26','2028-01-27','2028-05-02','2028-10-02','2028-10-03','2028-10-04','2028-12-25',
  '2029-02-12','2029-02-13','2029-02-14','2029-05-20','2029-05-21','2029-09-21','2029-09-22','2029-09-23','2029-09-24','2029-12-25',
  '2030-02-02','2030-02-03','2030-02-04','2030-05-09','2030-09-11','2030-09-12','2030-09-13','2030-12-25',
]);
const FIXED_HOLIDAYS = ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'];
const FIXED_ALIASES = [
  [/휴대폰|통신|핸드폰/, /SK텔레콤|SKT|KT|LG유플러스|U\+|알뜰/i],
  [/클로드|claude/i, /ANTHROPIC|CLAUDE/i],
  [/넷플릭스/, /NETFLIX|넷플릭스/i],
  [/icloud|아이클라우드/i, /APPLE|ICLOUD/i],
  [/capcut|캡컷/i, /APPLE|CAPCUT/i],
  [/마운자로/, /브이에스라인|VS ?라인|VSLINE/i],
  [/티빙/, /TVING|티빙/i],
  [/노션/, /NOTION|노션/i],
  [/이모티콘/, /이모티콘/],
  [/인터넷/, /인터넷|SK브로드밴드|KT|LG유플러스/i],
];
const FIXED_MANUAL = '고정 실제';
const EXCLUDED = '예산 제외';

// ─── 날짜 (모두 'YYYY-MM-DD' 문자열, UTC 로 계산해서 서버 시간대와 무관) ───
const pad = n => String(n).padStart(2, '0');
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
export const ymShift = (key, n) => { let [y, m] = key.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad(m)}`; };
export const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const isOffDay = ds => { const d = parseD(ds).getUTCDay(); return d === 0 || d === 6 || HOLIDAYS.has(ds) || FIXED_HOLIDAYS.includes(ds.slice(5)); };
export function expectedPayday(key) {
  let ds = `${key}-${pad(PAYDAY)}`;
  while (isOffDay(ds)) ds = addDays(ds, -1);
  return ds;
}

const memoName = t => String(t.memo || '').split(' · ')[0];
const normName = x => String(x || '').toLowerCase().replace(/[\s()（）\[\]·._+\-]/g, '');
export const isExcluded = t => t.subcategory === EXCLUDED;

export function makeBudget({ tx = [], fixed = [], assets = [] }) {
  tx = tx.map(t => ({ ...t, amount: Number(t.amount) || 0 }));
  fixed = fixed.map(f => ({ ...f, amount: Number(f.amount) || 0 }));
  assets = assets.map(a => ({ ...a, amount: Number(a.amount) || 0 }));

  const salaryDate = key => tx.filter(t => t.type === '수입' && SALARY_CATS.includes(t.category) && t.date.startsWith(key)).map(t => t.date).sort()[0] || null;
  function cycleRange(key) {
    const prev = ymShift(key, -1);
    return { start: salaryDate(prev) || expectedPayday(prev), end: addDays(salaryDate(key) || expectedPayday(key), -1) };
  }
  function cycleOf(ds) {
    let key = ds.slice(0, 7);
    if (ds >= cycleRange(ymShift(key, 1)).start) key = ymShift(key, 1);
    else if (ds < cycleRange(key).start) key = ymShift(key, -1);
    return key;
  }
  const firstCycle = tx.length ? cycleOf(tx.map(t => t.date).sort()[0]) : cycleOf(todayKST());

  const cache = new Map();
  function fixedStatus(key) {
    if (cache.has(key)) return cache.get(key);
    const { start, end } = cycleRange(key);
    const items = fixed.filter(f => f.is_active !== false);
    const txs = tx.filter(t => t.type === '지출' && t.is_fixed && !isExcluded(t) && t.date >= start && t.date <= end);
    const byItem = new Map(), used = new Set(), unmatched = [];
    for (const t of txs) {
      const m = normName(memoName(t));
      let c = items.filter(f => { const n = normName(f.name); return n.length >= 2 && m.includes(n); });
      if (!c.length) {
        c = items.filter(f => { const n = normName(f.name); return (m.length >= 2 && n.includes(m)) || FIXED_ALIASES.some(([fr, sr]) => fr.test(f.name) && (sr.test(memoName(t)) || fr.test(memoName(t)))); });
        if (c.length > 1) c = [c.sort((a, b) => Math.abs(a.amount - t.amount) - Math.abs(b.amount - t.amount))[0]];
      }
      if (!c.length) { unmatched.push(t); continue; }
      c.forEach(f => { const r = byItem.get(f.id) || []; r.push({ t, group: c.length }); byItem.set(f.id, r); });
    }
    const rows = items.map(f => {
      const hits = byItem.get(f.id) || [];
      const manual = hits.filter(h => h.t.subcategory === FIXED_MANUAL).sort((a, b) => b.t.date.localeCompare(a.t.date) || b.t.id - a.t.id)[0];
      const best = manual || hits.sort((a, b) => b.t.amount - a.t.amount)[0];
      return { f, tx: best ? best.t : null, group: best ? best.group : 0, manual: !!manual };
    });
    let paid = 0, pending = 0;
    rows.forEach(r => { if (r.tx && !used.has(r.tx.id)) { used.add(r.tx.id); paid += r.tx.amount; } });
    const res = { start, end, rows, unmatched, paid: paid + unmatched.reduce((a, t) => a + t.amount, 0), pending: 0, total: 0 };
    cache.set(key, res);
    rows.forEach(r => { r.exp = expectedFixed(r.f, key); if (!r.tx) pending += r.exp.amount; });
    res.pending = pending; res.total = res.paid + pending;
    return res;
  }
  function expectedFixed(f, key) {
    const vals = [];
    for (let i = 1; i <= 6 && vals.length < 3; i++) {
      const k = ymShift(key, -i);
      if (k < firstCycle) break;
      const r = fixedStatus(k).rows.find(x => x.f.id === f.id);
      if (r && r.tx && r.group === 1) vals.push(r.tx.amount);
    }
    return vals.length ? { amount: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), avg: vals.length } : { amount: f.amount, avg: 0 };
  }
  function summary(key) {
    const { start, end } = cycleRange(key);
    const txs = tx.filter(t => t.date >= start && t.date <= end);
    const income = txs.filter(t => t.type === '수입').reduce((s, t) => s + t.amount, 0);
    const salary = txs.filter(t => t.type === '수입' && SALARY_CATS.includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const fx = fixedStatus(key);
    const varTx = txs.filter(t => t.type === '지출' && !t.is_fixed && !isExcluded(t));
    const variable = varTx.reduce((s, t) => s + t.amount, 0);
    const excludedTx = txs.filter(isExcluded);
    const byCat = {}, shops = {};
    varTx.forEach(t => {
      byCat[t.category] = (byCat[t.category] || 0) + t.amount;
      const k = memoName(t); shops[k] = shops[k] || { n: 0, sum: 0 }; shops[k].n++; shops[k].sum += t.amount;
    });
    return {
      key, start, end, txs, income, salary, fixed: fx.total, fixedStatus: fx, variable, varTx, byCat, shops,
      excluded: excludedTx.reduce((s, t) => s + t.amount, 0), excludedTx,
      remain: income - fx.total - variable,
    };
  }

  // 통장별 잔액 (앱의 "내 돈은 어디에" 와 같은 묶음)
  function assetGroups() {
    const seen = new Set();
    const list = assets.filter(a => a.status !== '해지').sort((a, b) => a.id - b.id).filter(a => !seen.has(a.name) && seen.add(a.name));
    const shared = a => /합계 제외/.test(a.memo || '');
    const group = a => {
      if (shared(a)) return '모임통장 (합계 제외)';
      if (a.type === '퇴직연금') return '퇴직연금 (IRP)';
      if (a.type === '전세') return '전세 보증금';
      if (a.type === '국내주식' || a.type === '해외주식') return /카카오페이증권/.test(a.memo || '') ? '카카오페이증권' : '토스증권';
      for (const b of ['카카오페이증권', '카카오뱅크', '신한', '토스뱅크', '토스증권', '새마을금고']) if (a.name.includes(b)) return b === '신한' ? '신한은행' : b;
      if (/청약/.test(a.name)) return '청약';
      return '기타';
    };
    const groups = {};
    list.forEach(a => { const g = group(a); groups[g] = groups[g] || { name: g, total: 0, items: [] }; groups[g].total += a.amount; groups[g].items.push(a); });
    const counted = list.filter(a => !shared(a));
    return {
      total: counted.reduce((s, a) => s + a.amount, 0),
      cash: counted.filter(a => a.type === '현금' && !/증권/.test(a.name)).reduce((s, a) => s + a.amount, 0),
      groups: Object.values(groups).sort((a, b) => (/합계 제외/.test(a.name) - /합계 제외/.test(b.name)) || b.total - a.total),
    };
  }

  return { cycleRange, cycleOf, summary, fixedStatus, assetGroups, salaryDate };
}

// 오늘이 월급날(예상)이면, 어제 끝난 기간의 키를 돌려줍니다
export function reportCycleForToday(budget, today = todayKST()) {
  const key = today.slice(0, 7);
  // 이번 달 월급이 이미 기록됐으면 그 날, 아니면 예정된 월급날에 한 번
  if (today !== (budget.salaryDate(key) || expectedPayday(key))) return null;
  return budget.cycleOf(addDays(today, -1));
}
export const cycleLabel = key => `${Number(key.slice(5))}월`;
