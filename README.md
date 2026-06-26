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
