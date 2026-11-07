import { timingSafeEqual } from 'crypto';

// 모든 API 요청은 x-app-token 헤더에 Vercel 환경변수 APP_TOKEN 과 같은 값을 담아야 합니다.
// 파일명이 _ 로 시작하므로 Vercel 은 이 파일을 API 엔드포인트로 노출하지 않습니다.
export function requireAuth(req, res) {
  const expected = process.env.APP_TOKEN;
  if (!expected) {
    res.status(500).json({ error: 'APP_TOKEN is not configured' });
    return false;
  }
  const given = Buffer.from(String(req.headers['x-app-token'] || ''));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
