// 카카오뱅크 입출금/카드결제 문자(SMS)를 거래 한 건으로 바꿉니다.
// 예)
// [Web발신]
// [카카오뱅크]
// 박*원(1385)
// 11/08 00:15
// 출금 1원
// 간편이체(양성재)
// 잔액 1,240,662원

const AMOUNT_LINE = /(입금|출금|결제|승인|사용|취소)[^\d]*([\d,]+)\s*원|([\d,]+)\s*원[^\n]*?(입금|출금|결제|승인|사용|취소)/;

function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000); // UTC 필드로 읽으면 한국 시간
}

function resolveDate(mm, dd, now = kstNow()) {
  let year = now.getUTCFullYear();
  const candidate = Date.UTC(year, mm - 1, dd);
  // 1월에 받은 12월 문자처럼 한참 미래 날짜가 되면 작년으로 봅니다.
  if (candidate > now.getTime() + 31 * 24 * 3600 * 1000) year -= 1;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function parseSms(text, now) {
  if (!text || typeof text !== 'string') return { ok: false, reason: '문자 내용이 비어 있어요' };
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .filter(s => !/^\[Web발신\]$/.test(s));

  const amtIdx = lines.findIndex(l => !/^잔액/.test(l) && AMOUNT_LINE.test(l));
  if (amtIdx === -1) return { ok: false, reason: '금액 줄을 찾지 못했어요' };
  const m = lines[amtIdx].match(AMOUNT_LINE);
  const kind = m[1] || m[4];
  const amount = parseInt((m[2] || m[3]).replace(/,/g, ''), 10);
  if (!amount) return { ok: false, reason: '금액이 0원이에요' };

  const dm = text.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  const date = dm ? resolveDate(+dm[1], +dm[2], now) : resolveDate(kstNow().getUTCMonth() + 1, kstNow().getUTCDate(), now);
  const time = dm ? `${dm[3].padStart(2, '0')}:${dm[4]}` : null;

  // 금액 다음 줄이 가맹점/상대방. 없으면 금액 줄에서 금액·종류를 뺀 나머지.
  let merchant = lines.slice(amtIdx + 1).find(l => !/^잔액|^누적|^한도/.test(l));
  if (!merchant) {
    merchant = lines[amtIdx].replace(AMOUNT_LINE, '').trim();
  }
  merchant = (merchant || '').replace(/\s+/g, ' ').trim() || '알 수 없음';

  const isCard = /카드|결제|승인|사용/.test(lines[amtIdx]);
  const isCancel = /취소/.test(lines[amtIdx]);
  const type = kind === '입금' && !isCancel ? '수입' : '지출';
  const payment = isCard ? '체크카드' : '계좌이체';

  // 내 계좌끼리 이체: 상대방 이름이 문자 위쪽의 가려진 예금주 이름(예: 박*원)과 맞으면 건너뜁니다.
  const holderLine = lines.find(l => /^\S*\*\S*\(\d{3,4}\)$/.test(l));
  const holderMask = holderLine ? holderLine.replace(/\(\d{3,4}\)$/, '') : null;
  const counterparty = merchant.replace(/^[^(]*\((.+)\)$/, '$1').trim();
  const isSelfTransfer = !isCard && !!holderMask && isMaskMatch(holderMask, counterparty);

  return { ok: true, kind, isCancel, type, amount, date, time, merchant, payment, isSelfTransfer };
}

function isMaskMatch(mask, name) {
  if (!mask || !name || mask.length !== name.length) return false;
  return [...mask].every((c, i) => c === '*' || c === name[i]);
}

// 가맹점/상대방 이름으로 카테고리를 고릅니다. 실제 카테고리 목록에 있는 이름만 씁니다.
const RULES = [
  { type: '수입', re: /급여|월급|상여|성과급/, cats: ['월급', '급여'] },
  { type: '수입', re: /이자|캐시백|환급/, cats: ['부수입', '기타수입'] },
  { type: '지출', re: /스타벅스|투썸|이디야|메가.*커피|메가MGC|컴포즈|빽다방|커피|카페|폴바셋|블루보틀|파리바게|뚜레쥬르|베이커리|던킨|배스킨/i, cats: ['커피/간식', '카페', '간식'] },
  { type: '지출', re: /배달의민족|배민|우아한형제|쿠팡이츠|요기요/, cats: ['배달', '식비', '외식'] },
  { type: '지출', re: /GS25|CU|씨유|세븐일레븐|이마트24|편의점/i, cats: ['편의점', '식비'] },
  { type: '지출', re: /맥도날드|버거킹|롯데리아|맘스터치|김밥|식당|분식|치킨|피자|국밥|고기|횟집|초밥|마라/, cats: ['식비', '외식'] },
  { type: '지출', re: /이마트|홈플러스|롯데마트|마트|코스트코|컬리|마켓/, cats: ['장보기', '생활', '식비'] },
  { type: '지출', re: /택시|카카오T|카카오모빌리티|티머니|코레일|SRT|지하철|버스|주유|GS칼텍스|SK에너지|S-OIL|후불교통|교통/i, cats: ['교통'] },
  { type: '지출', re: /넷플릭스|NETFLIX|유튜브|YOUTUBE|스포티파이|애플|APPLE|디즈니|왓챠|티빙|웨이브|쿠팡와우|멜론|구독/i, cats: ['구독', '통신/구독'] },
  { type: '지출', re: /SKT|SK텔레콤|KT|LG유플러스|U\+|알뜰폰|통신/i, cats: ['통신', '통신/구독'] },
  { type: '지출', re: /쿠팡|무신사|11번가|G마켓|지마켓|옥션|올리브영|다이소|네이버페이|29CM|지그재그/i, cats: ['쇼핑'] },
  { type: '지출', re: /병원|의원|약국|치과|한의원/, cats: ['의료', '병원'] },
  { type: '지출', re: /간편이체|이체|송금/, cats: ['이체', '송금'] },
];

export function pickCategory(merchant, type, categoryNames) {
  const names = categoryNames || [];
  const find = want => names.find(n => n === want) || names.find(n => n.includes(want));
  for (const r of RULES) {
    if (r.type !== type || !r.re.test(merchant)) continue;
    for (const c of r.cats) { const hit = find(c); if (hit) return hit; }
  }
  return type === '수입' ? (find('기타수입') || '기타수입') : (find('기타') || '기타');
}
