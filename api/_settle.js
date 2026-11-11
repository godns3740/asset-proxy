// 더치페이 정산: 내가 대신 결제한 뒤 사람 이름으로 들어온 돈을 그 결제에서 빼 줍니다.
// 정산 입금은 subcategory = '정산:<결제 id>' 로 표시하고, 수입 합계에는 넣지 않습니다.
export const SETTLE_CAT = '정산';
export const isSettle = t => t.type === '수입' && (/^정산:/.test(t.subcategory || '') || t.category === SETTLE_CAT);
export const settleTarget = t => { const m = /^정산:(\d+)/.exec(t.subcategory || ''); return m ? +m[1] : null; };

const timeOf = t => { const m = / · (\d{2}):(\d{2})$/.exec(t.memo || ''); return m ? `${m[1]}:${m[2]}` : '00:00'; };
const stamp = (date, time) => Date.parse(`${date}T${time}:00Z`);
const personLike = name => /^[가-힣]{2,4}$/.test(name) || /^간편이체/.test(name);
const nameOf = t => String(t.memo || '').split(' · ')[0];

// income: { date, time, amount }, txs: 같은 사람의 최근 내역 (지출 + 이미 연결된 정산)
export function findSettleTarget(income, txs, hours = 24) {
  const at = stamp(income.date, income.time || '23:59');
  const settled = {};
  txs.filter(isSettle).forEach(s => { const id = settleTarget(s); settled[id] = (settled[id] || 0) + Number(s.amount); });
  return txs
    // 사람에게 보낸 이체(계좌이체 + 사람 이름)는 대신 낸 결제가 아님. "쿠팡이츠" 같은 짧은 가게 이름은 카드 결제라 포함
    .filter(t => t.type === '지출' && !t.is_fixed && t.subcategory !== '예산 제외' && !(t.payment === '계좌이체' && personLike(nameOf(t))))
    .map(t => ({ t, at: stamp(t.date, timeOf(t)), left: Number(t.amount) - (settled[t.id] || 0) }))
    .filter(x => x.at <= at && at - x.at <= hours * 3600e3 && x.left >= income.amount)
    .sort((a, b) => b.at - a.at)[0]?.t || null;
}

// 기간 계산용: 정산 입금을 지출에서 뺀 카테고리별 합계
export function applySettlements(txs, varTx, byCat, all) {
  const byId = new Map(all.map(t => [t.id, t]));
  let total = 0;
  txs.filter(isSettle).forEach(s => {
    const target = byId.get(settleTarget(s));
    if (target && (target.subcategory === '예산 제외' || target.is_fixed)) return;
    const cat = target ? target.category : '기타';
    byCat[cat] = (byCat[cat] || 0) - Number(s.amount);
    total += Number(s.amount);
  });
  Object.keys(byCat).forEach(k => { if (byCat[k] <= 0) delete byCat[k]; });
  return total;
}
