// 카카오뱅크 입출금/카드결제 문자(SMS)를 거래 한 건으로 바꿉니다.
// 예)
// [Web발신]
// [카카오뱅크]
// 박*원(1385)
// 11/08 00:15
// 출금 1원
// 간편이체(양성재)
// 잔액 1,240,662원

// 카카오뱅크: "출금 9,400원" / 신한: "출금 20,000" (원 없음)
const AMOUNT_LINE = /(입금|출금|결제|승인|사용|취소)[\s:]*([\d,]+)\s*원?(?![\d/.:])|([\d,]+)\s*원[^\n]*?(입금|출금|결제|승인|사용|취소)/;
// 광고·안내 문자 (쿠폰, 이벤트 등): 금액처럼 보이는 숫자가 있어도 기록하지 않음
const AD_SMS = /\(광고\)|\[광고\]|^광고|무료\s*수신\s*거부|수신거부|쿠폰|이벤트|본\s*문자를/m;

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

// 카드 승인 문자 (현대카드 등): 승인/취소가 첫 줄에, 금액은 다른 줄에
//  현대 네이버 승인 / 양*재 / 11,000원 일시불 / 11/11 19:47 / 신통치킨평택역점 / 누적938,040원
function parseCardSms(lines, text, now) {
  const head = lines.findIndex(l => /(승인|취소)/.test(l) && !/\d[\d,]*\s*원/.test(l) && !/(입금|출금)/.test(l));
  if (head === -1) return null;
  const ai = lines.findIndex((l, i) => i > head && /^[\d,]+\s*원/.test(l));
  if (ai === -1) return null;
  const amount = parseInt(lines[ai].match(/^([\d,]+)/)[1].replace(/,/g, ''), 10);
  if (!amount) return null;
  const isCancel = /취소/.test(lines[head]);
  const dm = text.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  const date = dm ? resolveDate(+dm[1], +dm[2], now) : resolveDate(kstNow().getUTCMonth() + 1, kstNow().getUTCDate(), now);
  const time = dm ? `${dm[3].padStart(2, '0')}:${dm[4]}` : null;
  const merchant = (lines.slice(ai + 1).find(l => !/^\d{1,2}\/\d{1,2}/.test(l) && !/^(누적|잔액|한도|일시불|할부)/.test(l)) || '알 수 없음').replace(/\s+/g, ' ').trim();
  const credit = /일시불|할부|개월/.test(lines[ai]) || /신용/.test(text);
  return {
    ok: true, kind: isCancel ? '취소' : '승인', isCancel, type: '지출', amount, date, time, merchant,
    payment: credit ? '신용카드' : '체크카드', isSelfTransfer: false, isSafebox: false, balance: null, bank: '',
    card: lines[head].replace(/\s*(승인|취소).*$/, '').trim(), isCardSms: true,
  };
}

export function parseSms(text, now, opts = {}) {
  if (!text || typeof text !== 'string') return { ok: false, reason: '문자 내용이 비어 있어요' };
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .filter(s => !/^\[Web\s*발신\]$/.test(s));

  if (AD_SMS.test(text) && !/잔액/.test(text)) return { ok: false, reason: '광고·안내 문자라 기록하지 않았어요' };

  const card = parseCardSms(lines, text, now);
  if (card) return card;

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
  let merchant = lines.slice(amtIdx + 1).find(l => !/^잔액|^누적|^한도|^[\d-]{8,}$/.test(l));
  if (!merchant) {
    // 한 줄 형식 (새마을금고 등): "<새마을금고>900330**8 박규원 입금1 잔액557,692원 11/11 19:25"
    //  → "입금/출금" 바로 앞 단어가 상대방
    const before = lines[amtIdx].split(/(입금|출금|결제|승인|사용|취소)/)[0]
      .replace(/<[^>]*>|\[[^\]]*\]/g, ' ')            // <은행> [은행] 표시
      .split(/\s+/).filter(w => w && !/^[\d*\-]+$/.test(w) && !/\d{2}\/\d{2}|\d{1,2}:\d{2}/.test(w));   // 계좌번호·날짜·시간
    merchant = before.length ? before[before.length - 1] : lines[amtIdx].replace(AMOUNT_LINE, '').trim();
  }
  merchant = (merchant || '').replace(/\s+/g, ' ').trim() || '알 수 없음';

  const isCard = /카드|결제|승인|사용/.test(lines[amtIdx]);
  const isTossPay = /토스페이/.test(merchant);
  const isAtm = /ATM|현금인출|현금출금/i.test(merchant);
  const isCancel = /취소/.test(lines[amtIdx]);
  const type = kind === '입금' && !isCancel ? '수입' : '지출';
  const payment = isTossPay ? '토스' : isAtm ? '현금' : isCard ? '체크카드' : '계좌이체';

  // 내 계좌끼리 이체: 상대방 이름이 문자 위쪽의 가려진 예금주 이름(예: 박*원)과 맞으면 건너뜁니다.
  const holderLine = lines.find(l => /^\S*\*\S*\(\d{3,4}\)$/.test(l));
  const holderMask = holderLine ? holderLine.replace(/\(\d{3,4}\)$/, '') : null;
  // "간편이체(박규원)" → 박규원, "토뱅 박규원" → 박규원
  const counterparty = merchant.replace(/^[^(]*\((.+)\)$/, '$1').trim().split(/\s+/).pop();
  // 신한처럼 가려진 예금주 줄이 없는 은행은 설정한 본인 이름(OWNER_NAME)과 비교합니다
  const owner = String(opts.ownerName || '').trim();
  // 세이프박스·저금통: 같은 은행 안에서 내 돈을 옮긴 것
  const isSafebox = /세이프박스|저금통/.test(merchant);
  const isSelfTransfer = isSafebox || (!isCard && ((!!holderMask && isMaskMatch(holderMask, counterparty)) || (!!owner && counterparty === owner)));

  // 잔액·은행: 통장별 잔액을 맞추는 데 씁니다
  const bm = text.match(/잔액\s*([\d,]+)/);
  const balance = bm ? parseInt(bm[1].replace(/,/g, ''), 10) : null;
  const bank = /카카오뱅크/.test(text) ? '카카오뱅크' : /새마을금고/.test(text) ? '새마을금고' : /(^|\n)\s*신한/.test(text) ? '신한' : '';

  return { ok: true, kind, isCancel, type, amount, date, time, merchant, payment, isSelfTransfer, isSafebox, balance, bank };
}

function isMaskMatch(mask, name) {
  if (!mask || !name || mask.length !== name.length) return false;
  return [...mask].every((c, i) => c === '*' || c === name[i]);
}

// 가맹점/상대방 이름으로 카테고리를 고릅니다. 실제 카테고리 목록에 있는 이름만 씁니다.
const RULES = [
  { type: '수입', re: /급여|월급|상여|성과급/, cats: ['월급', '급여'] },
  { type: '수입', re: /이자|캐시백|환급/, cats: ['부수입', '기타수입'] },
  { type: '지출', re: /배달의민족|배민|우아한형제|쿠팡이츠|요기요/, cats: ['배달'], byTime: true },
  { type: '지출', re: /스타벅스|투썸|이디야|메가.*커피|메가엠지씨|MGC|컴포즈|빽다방|커피|카페|로스터리|폴바셋|블루보틀|파리바게|뚜레쥬르|베이커리|던킨|배스킨|아이스크림|설빙|공차/i, cats: ['커피/간식', '카페', '간식'] },
  { type: '지출', re: /얼맥|호프|포차|이자카야|술집|맥주|와인|bar\b|펍/i, cats: ['술약속', '외식'] },
  { type: '지출', re: /GS25|CU|씨유|세븐일레븐|이마트24|편의점/i, cats: ['편의점', '생활비', '식비'] },
  { type: '지출', re: /맥도날드|버거킹|롯데리아|맘스터치|써브웨이|김밥|식당|분식|치킨|피자|국밥|설렁탕|고기|갈비|양고기|횟집|초밥|마라|카츠|돈까스|솥밥|한와담|국수|냉면|파스타|버거|쌀국수|샤브/, cats: ['외식', '식비'] },
  { type: '지출', re: /이마트|홈플러스|롯데마트|마트|코스트코|컬리|다이소/, cats: ['생활비', '장보기'] },
  { type: '지출', re: /택시|카카오T|카카오모빌리티|티머니|코레일|KORAIL|한국철도|SRT|지하철|버스|주유|GS칼텍스|SK에너지|S-OIL|후불교통|교통/i, cats: ['교통'] },
  { type: '지출', re: /넷플릭스|NETFLIX|유튜브|YOUTUBE|스포티파이|애플|APPLE|디즈니|왓챠|티빙|웨이브|쿠팡와우|멜론|노션|NOTION|이모티콘|ANTHROPIC|CLAUDE|OPENAI|CHATGPT|구독/i, cats: ['구독', '통신/구독'] },
  { type: '지출', re: /SKT|SK텔레콤|KT|LG유플러스|U\+|알뜰폰|통신/i, cats: ['통신', '통신/구독'] },
  { type: '지출', re: /피부과|헤어|미용|네일/, cats: ['쇼핑/미용', '미용/쇼핑', '쇼핑'] },
  { type: '지출', re: /병원|의원|약국|치과|한의원|정신과|내과|외과|안과|이비인후과/, cats: ['의료', '병원'] },
  // 쿠팡·네이버페이는 무엇을 샀는지 알 수 없어서 '기타'로 두고 앱의 '확인'에서 고르게 함
  { type: '지출', re: /무신사|11번가|G마켓|지마켓|옥션|올리브영|29CM|지그재그/i, cats: ['쇼핑/미용', '미용/쇼핑', '쇼핑'] },
  { type: '지출', re: /축의|조의|부의|근조|화환|경조|돌잔치/, cats: ['경조사'] },
  { type: '지출', re: /간편이체|이체|송금/, cats: ['이체', '송금'] },
];

export function pickCategory(merchant, type, categoryNames, time) {
  const names = categoryNames || [];
  const find = want => names.find(n => n === want) || names.find(n => n.includes(want));
  for (const r of RULES) {
    if (r.type !== type || !r.re.test(merchant)) continue;
    if (r.byTime) {  // 배달: 16시 전이면 점심, 이후면 저녁
      const hour = time ? parseInt(time, 10) : 12;
      const hit = find(hour < 16 ? '배달-점심' : '배달-저녁') || find('배달');
      if (hit) return hit;
      continue;
    }
    for (const c of r.cats) { const hit = find(c); if (hit) return hit; }
  }
  return type === '수입' ? (find('기타수입') || '기타수입') : (find('기타') || '기타');
}
