# 자산 관리 프록시 서버

Yahoo Finance API의 CORS 문제를 우회하는 Vercel 프록시입니다.

## 배포 방법 (5분)

### 1. Vercel 계정 만들기
https://vercel.com 에서 무료 가입 (GitHub 계정으로 로그인 가능)

### 2. Vercel CLI 설치
```bash
npm install -g vercel
```

### 3. 이 폴더에서 배포
```bash
cd asset-proxy
vercel
```
- 질문들에 기본값(엔터)으로 답하면 됩니다
- 마지막에 배포 URL이 나와요: `https://asset-proxy-xxx.vercel.app`

### 3-1. 환경변수 설정 (필수)
API 키는 코드에 넣지 않고 Vercel 환경변수로 관리합니다.
Vercel 대시보드 → 프로젝트 → Settings → Environment Variables 에 아래 값을 추가한 뒤 재배포하세요.

| 이름 | 설명 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL (`https://xxxx.supabase.co`) |
| `SUPABASE_KEY` | Supabase service_role 키 (서버 전용, 절대 공개 금지) |
| `KIS_APP_KEY` | 한국투자증권 Open API App Key |
| `KIS_APP_SECRET` | 한국투자증권 Open API App Secret |
| `APP_TOKEN` | 가계부 비밀번호. 모든 API 요청에 `x-app-token` 헤더로 필요하며, 웹 앱은 처음 접속할 때 한 번 물어봅니다 |

CLI로 추가: `vercel env add SUPABASE_KEY production`

### 4. HTML 파일 업데이트
asset_manager_web.html 상단의 PROXY_BASE_URL을 배포된 URL로 변경:
```js
const PROXY_BASE_URL = 'https://asset-proxy-xxx.vercel.app';
```

## API 엔드포인트

- `GET /api/quote?symbols=005930.KS,TSLA,NKE` → 주가 조회
- `GET /api/fx` → USD/KRW 환율 조회

## 한국 주식 티커 형식
- 삼성전자: `005930.KS`
- SK하이닉스: `000660.KS`
- 카카오뱅크: `323410.KS`
- 대한전선: `001440.KS`
- KODEX 200 ETF: `069500.KS`
