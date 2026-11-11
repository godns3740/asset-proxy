// 월급날 결산 리포트: 숫자 정리 + PDF + 알림 문구
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { cycleLabel, ymShift } from './_budget.js';

const W = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
const man = n => { const a = Math.round(Math.abs(n)); return a >= 10000 ? `${(Math.round(a / 1000) / 10).toLocaleString('ko-KR')}만원` : `${a.toLocaleString('ko-KR')}원`; };
const signedMan = n => (n > 0 ? '+' : n < 0 ? '−' : '') + man(n);
const dot = s => s.replace(/-/g, '.');
// 기간 이름: 날짜가 가장 많이 걸친 달
const midMonthLabel = (a, b) => { const t = (Date.parse(a) + Date.parse(b)) / 2; return `${new Date(t).getUTCMonth() + 1}월`; };

// ─── 숫자 정리 ───────────────────────────────────────────────
export function buildReport(budget, key, cats = []) {
  const s = budget.summary(key), p = budget.summary(ymShift(key, -1));
  const color = name => (cats.find(c => c.name === name) || {}).color || '#9ca3af';
  const catRows = [...new Set([...Object.keys(s.byCat), ...Object.keys(p.byCat)])]
    .map(c => ({ name: c, now: s.byCat[c] || 0, prev: p.byCat[c] || 0, color: color(c) }))
    .filter(r => r.now > 0).sort((a, b) => b.now - a.now);
  const shops = Object.entries(s.shops).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sum - a.sum).slice(0, 5);
  const fx = s.fixedStatus;
  const assets = budget.assetGroups();

  const notes = [];
  const rises = catRows.filter(r => r.prev > 0 && r.now - r.prev >= 30000).sort((a, b) => (b.now - b.prev) - (a.now - a.prev));
  rises.slice(0, 2).forEach(r => notes.push(`${r.name}이(가) 지난달보다 ${man(r.now - r.prev)} 늘었어요 (${man(r.prev)} → ${man(r.now)}).`));
  const small = {};
  s.varTx.filter(t => t.amount <= 15000).forEach(t => { small[t.category] = small[t.category] || { n: 0, sum: 0 }; small[t.category].n++; small[t.category].sum += t.amount; });
  const topSmall = Object.entries(small).sort((a, b) => b[1].sum - a[1].sum)[0];
  if (topSmall && topSmall[1].n >= 5) notes.push(`${topSmall[0]} 소액 결제 ${topSmall[1].n}번, 합계 ${W(topSmall[1].sum)}. 절반만 줄여도 약 ${man(topSmall[1].sum / 2)}을 아낄 수 있어요.`);
  const topShop = shops.find(x => x.n >= 4);
  if (topShop) notes.push(`${topShop.name}에서 ${topShop.n}번, ${W(topShop.sum)}을 썼어요.`);
  if (s.salary && fx.total / s.salary > 0.6) notes.push(`고정지출이 월급의 ${Math.round(fx.total / s.salary * 100)}%예요. 구독·보험 중 줄일 수 있는 게 있는지 한 번 점검해 보세요.`);
  if (s.remain >= 0) notes.push(`${man(s.remain)}을 남겼어요. 남은 돈은 세이프박스나 적금으로 옮겨 두면 다음 달 예산이 깔끔해져요.`);
  else notes.push(`${man(-s.remain)} 초과했어요. 다음 달엔 쓴 돈 목표를 ${man(Math.max(0, s.variable + s.remain))} 안쪽으로 잡아 보세요.`);

  return {
    key, title: `${midMonthLabel(s.start, s.end)} 결산`, period: `${dot(s.start)} ~ ${dot(s.end)}`,
    income: s.income, salary: s.salary, fixed: fx.total, fixedPaid: fx.paid, fixedPending: fx.pending,
    variable: s.variable, prevVariable: p.variable, remain: s.remain, prevRemain: p.salary ? p.remain : null,
    excluded: s.excluded, excludedTx: s.excludedTx.map(t => ({ name: String(t.memo || '').split(' · ')[0], amount: t.amount })),
    catRows, shops, hasPrev: p.variable > 0,
    fixedRows: fx.rows.map(r => ({ name: r.f.name, amount: r.tx ? r.tx.amount : r.exp.amount, paid: !!r.tx, together: r.group > 1 })),
    assets, notes,
  };
}

export function notifyText(r) {
  const res = r.remain >= 0 ? `${man(r.remain)} 남김` : `${man(-r.remain)} 초과`;
  const diff = r.variable - r.prevVariable;
  return `${r.title} · ${res} · 쓴 돈 ${man(r.variable)}${r.prevVariable ? ` (지난달 대비 ${signedMan(diff)})` : ''}`;
}

// ─── PDF ─────────────────────────────────────────────────────
const FONT_DIR = path.join(process.cwd(), 'fonts');
const C = { text: '#111827', sub: '#6b7280', line: '#e5e7eb', soft: '#f3f4f6', green: '#16a34a', red: '#dc2626', blue: '#2563eb' };

export function renderPdf(r) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${r.title} 가계부 리포트` } });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.registerFont('R', fs.readFileSync(path.join(FONT_DIR, 'Pretendard-Regular.otf')));
    doc.registerFont('B', fs.readFileSync(path.join(FONT_DIR, 'Pretendard-Bold.otf')));
    const L = 40, R = 555, Wd = R - L;
    let y = 40;
    const need = h => { if (y + h > 800) { doc.addPage(); y = 40; } };
    const text = (s, x, yy, o = {}) => doc.font(o.bold ? 'B' : 'R').fontSize(o.size || 10).fillColor(o.color || C.text).text(s, x, yy, { width: o.width, align: o.align || 'left', lineBreak: o.wrap !== false ? undefined : false });
    const section = title => { need(40); y += 14; text(title, L, y, { bold: true, size: 13 }); y += 22; doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(C.line).stroke(); y += 8; };

    // 머리말
    text('월급날 결산 리포트', L, y, { size: 10, color: C.sub }); y += 16;
    text(r.title, L, y, { bold: true, size: 26 }); y += 34;
    text(`${r.period}`, L, y, { size: 11, color: C.sub }); y += 26;

    // 요약 카드 4개
    const cards = [
      ['수입', W(r.income), C.green],
      ['고정지출', W(r.fixed), C.text],
      ['쓴 돈', W(r.variable), C.text],
      [r.remain >= 0 ? '남긴 돈' : '초과', W(Math.abs(r.remain)), r.remain >= 0 ? C.green : C.red],
    ];
    const cw = (Wd - 3 * 8) / 4;
    cards.forEach(([k, v, col], i) => {
      const x = L + i * (cw + 8);
      doc.roundedRect(x, y, cw, 58, 8).fillColor(C.soft).fill();
      text(k, x + 10, y + 10, { size: 9, color: C.sub });
      text(v, x + 10, y + 28, { bold: true, size: 13, color: col, width: cw - 16 });
    });
    y += 70;
    const sub = [];
    if (r.prevVariable) sub.push(`쓴 돈 지난달 대비 ${signedMan(r.variable - r.prevVariable)}`);
    if (r.prevRemain !== null) sub.push(`지난달 ${r.prevRemain >= 0 ? '남긴 돈' : '초과'} ${man(Math.abs(r.prevRemain))}`);
    sub.push(`고정지출 중 실제 ${man(r.fixedPaid)} · 예상 ${man(r.fixedPending)}`);
    text(sub.join('   ·   '), L, y, { size: 9, color: C.sub, width: Wd }); y += 16;
    if (r.excluded) { text(`특별 지출(예산 제외) ${W(r.excluded)}: ${r.excludedTx.map(t => t.name).join(', ')}`, L, y, { size: 9, color: C.blue, width: Wd }); y += 16; }

    // 카테고리
    section(r.hasPrev ? '어디에 썼나 · 쓴 돈 (지난달 대비)' : '어디에 썼나 · 쓴 돈');
    const max = Math.max(1, ...r.catRows.map(c => c.now));
    r.catRows.forEach(c => {
      need(22);
      doc.circle(L + 4, y + 6, 3.5).fillColor(c.color).fill();
      text(c.name, L + 14, y, { size: 10, width: 110 });
      doc.roundedRect(L + 130, y + 3, 230, 7, 3.5).fillColor(C.soft).fill();
      doc.roundedRect(L + 130, y + 3, Math.max(3, 230 * c.now / max), 7, 3.5).fillColor(c.color).fill();
      text(W(c.now), L + 370, y, { size: 10, bold: true, width: 80, align: 'right' });
      const d = c.now - c.prev;
      if (c.prev) text(`${d >= 0 ? '▲' : '▼'} ${man(Math.abs(d))}`, L + 455, y, { size: 9, color: d > 0 ? C.red : C.green, width: 60, align: 'right' });
      else if (r.hasPrev) text('새로 생김', L + 455, y, { size: 9, color: C.sub, width: 60, align: 'right' });
      y += 20;
    });
    if (!r.catRows.length) { text('쓴 돈이 없어요', L, y, { color: C.sub }); y += 18; }

    // 많이 쓴 곳
    section('많이 쓴 곳 TOP 5');
    r.shops.forEach((s, i) => { need(18); text(`${i + 1}. ${s.name}`, L, y, { size: 10, width: 300 }); text(`${s.n}번`, L + 320, y, { size: 10, color: C.sub, width: 60, align: 'right' }); text(W(s.sum), L + 390, y, { size: 10, bold: true, width: 125, align: 'right' }); y += 18; });

    // 고정지출
    section(`고정지출 ${W(r.fixed)}`);
    const half = Math.ceil(r.fixedRows.length / 2), colW = Wd / 2 - 10;
    const startY = y;
    r.fixedRows.forEach((f, i) => {
      const col = i < half ? 0 : 1, row = i < half ? i : i - half;
      const x = L + col * (colW + 20), yy = startY + row * 17;
      if (yy > 790) return;
      text(`${f.paid ? '✓' : '·'} ${f.name}`, x, yy, { size: 9, color: f.paid ? C.text : C.sub, width: colW - 80 });
      text(f.together ? '함께 결제' : W(f.amount) + (f.paid ? '' : ' (예상)'), x + colW - 110, yy, { size: 9, color: f.paid ? C.text : C.sub, width: 110, align: 'right' });
    });
    y = startY + half * 17 + 4;

    // 통장별 잔액
    section(`내 돈 ${W(r.assets.total)}`);
    text(`바로 쓸 수 있는 돈 ${W(r.assets.cash)}`, L, y, { size: 9, color: C.sub }); y += 16;
    r.assets.groups.forEach(g => { need(18); text(g.name, L, y, { size: 10, width: 250, color: /합계 제외/.test(g.name) ? C.sub : C.text }); text(W(g.total), L + 260, y, { size: 10, bold: true, width: 255, align: 'right' }); y += 18; });

    // 한 줄 정리
    section('다음 달을 위한 한 줄');
    r.notes.forEach(n => { need(30); text(`•  ${n}`, L, y, { size: 10, width: Wd }); y += doc.heightOfString(`•  ${n}`, { width: Wd }) + 6; });

    doc.end();
  });
}

// ─── 메일 본문 (PDF와 같은 내용 요약) ────────────────────────
export function mailHtml(r) {
  const row = (k, v, col) => `<tr><td style="padding:6px 0;color:#6b7280">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${col || '#111827'}">${v}</td></tr>`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<div style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:480px;color:#111827">
  <h2 style="margin:0 0 4px">${esc(r.title)}</h2><div style="color:#6b7280;margin-bottom:14px">${esc(r.period)}</div>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
  ${row('수입', W(r.income), '#16a34a')}${row('고정지출', W(r.fixed))}${row('쓴 돈', W(r.variable))}
  ${row(r.remain >= 0 ? '남긴 돈' : '초과', W(Math.abs(r.remain)), r.remain >= 0 ? '#16a34a' : '#dc2626')}
  ${r.excluded ? row('특별 지출(예산 제외)', W(r.excluded), '#2563eb') : ''}</table>
  <ul style="padding-left:18px;color:#374151;font-size:14px">${r.notes.map(n => `<li style="margin:4px 0">${esc(n)}</li>`).join('')}</ul>
  <div style="color:#9ca3af;font-size:12px">자세한 내용은 첨부한 PDF를 확인하세요.</div></div>`;
}
