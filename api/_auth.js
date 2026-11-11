import { timingSafeEqual } from 'crypto';

// 사람별 비밀번호 → 이름
//  APP_TOKEN  : 첫 번째 사용자 비밀번호 (이름은 APP_OWNER, 기본 '규원')
//  APP_USERS  : 추가 사용자 "이름:비밀번호" (여러 명이면 쉼표로 구분) 예) 성재:abcd1234
// 파일명이 _ 로 시작하므로 Vercel 은 이 파일을 API 엔드포인트로 노출하지 않습니다.
function users() {
  const list = [];
  if (process.env.APP_TOKEN) list.push([process.env.APP_OWNER || '규원', process.env.APP_TOKEN]);
  String(process.env.APP_USERS || '').split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
    const i = pair.indexOf(':');
    if (i > 0) list.push([pair.slice(0, i).trim(), pair.slice(i + 1).trim()]);
  });
  return list;
}
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// 첫 번째 사용자(APP_TOKEN 주인)는 다른 사람 대신 내역을 추가할 수 있어요 (캡처 정리 등)
export const primaryOwner = () => (process.env.APP_TOKEN ? (process.env.APP_OWNER || '규원') : null);
export const isUser = name => users().some(([n]) => n === name);

export function ownerFor(token) {
  const hit = users().find(([, t]) => t && same(String(token || ''), t));
  return hit ? hit[0] : null;
}

// 통과하면 req.owner 에 사용자 이름을 넣고 true
export function requireAuth(req, res) {
  if (!users().length) {
    res.status(500).json({ error: 'APP_TOKEN is not configured', message: '서버에 APP_TOKEN이 설정되지 않았어요 (Vercel 환경변수 확인)' });
    return false;
  }
  const owner = ownerFor(req.headers['x-app-token']);
  if (!owner) {
    res.status(401).json({ error: 'unauthorized', message: '비밀번호가 맞지 않아요 (단축어 x-app-token 값과 Vercel 비밀번호 확인)' });
    return false;
  }
  req.owner = owner;
  return true;
}
