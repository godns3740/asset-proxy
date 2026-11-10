import { timingSafeEqual } from 'crypto';
import nodemailer from 'nodemailer';
import { requireAuth } from './_auth.js';
import { makeBudget, reportCycleForToday, todayKST, addDays } from './_budget.js';
import { buildReport, renderPdf, notifyText, mailHtml } from './_report.js';

// 월급날 결산 리포트
//  GET /api/report?cron=1              Vercel 예약 실행(매일 아침). 오늘이 월급날이면 PDF를 메일로 보냄
//  GET /api/report?notify=1            단축어용. 오늘이 월급날이면 알림 문구, 아니면 빈 문구
//  GET /api/report?pdf=1&cycle=YYYY-MM PDF 바로 보기 (cycle 생략 시 지난 기간)
//  GET /api/report?send=1&cycle=YYYY-MM 그 기간 리포트를 지금 메일로 보냄
// 환경변수: NAVER_SMTP_USER, NAVER_SMTP_PASS, REPORT_EMAIL, CRON_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` });

function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function load(owner) {
  const who = `&owner=eq.${encodeURIComponent(owner)}`;
  const get = async (t, extra = who) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*${extra}`, { headers: sbHeaders() }); const d = await r.json(); return Array.isArray(d) ? d : []; };
  const [tx, fixed, cats, assets, prof] = await Promise.all([get('transactions'), get('fixed_expenses'), get('categories'), get('assets'), get('profiles', who)]);
  const pr = prof[0] || {};
  return { budget: makeBudget({ tx, fixed, assets, payday: pr.payday || 25, paydayRule: pr.payday_rule || 'before' }), cats };
}

async function sendMail(report, pdf) {
  const user = process.env.NAVER_SMTP_USER, pass = process.env.NAVER_SMTP_PASS, to = process.env.REPORT_EMAIL;
  if (!user || !pass || !to) throw new Error('메일 설정이 없어요 (NAVER_SMTP_USER / NAVER_SMTP_PASS / REPORT_EMAIL)');
  const from = user.includes('@') ? user : `${user}@naver.com`;
  const transport = nodemailer.createTransport({ host: 'smtp.naver.com', port: 465, secure: true, auth: { user: from.split('@')[0], pass } });
  const res = report.remain >= 0 ? `${Math.round(report.remain / 10000)}만원 남김` : `${Math.round(-report.remain / 10000)}만원 초과`;
  await transport.sendMail({
    from: `"가계부" <${from}>`, to,
    subject: `[가계부] ${report.title} · ${res}`,
    html: mailHtml(report),
    attachments: [{ filename: `가계부-${report.key}-결산.pdf`, content: pdf, contentType: 'application/pdf' }],
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const cron = isCron(req);
  if (!cron && !requireAuth(req, res)) return;
  const q = req.query || {};
  const owner = cron ? (process.env.APP_OWNER || '규원') : (q.owner || req.owner);

  try {
    const { budget, cats } = await load(owner);
    const today = todayKST();
    const paydayKey = reportCycleForToday(budget, today);

    if (q.notify) {
      if (!paydayKey) return res.status(200).json({ payday: false, message: '' });
      const r = buildReport(budget, paydayKey, cats);
      return res.status(200).json({ payday: true, message: `💰 ${notifyText(r)} · 메일로 PDF를 보냈어요` });
    }

    if (cron || q.cron) {
      if (!paydayKey) return res.status(200).json({ ok: true, sent: false, reason: `오늘(${today})은 월급날이 아니에요` });
      const r = buildReport(budget, paydayKey, cats);
      await sendMail(r, await renderPdf(r));
      return res.status(200).json({ ok: true, sent: true, cycle: paydayKey, message: notifyText(r) });
    }

    // 지정한 기간 (없으면 지난 기간)
    const prevKey = budget.cycleOf(addDays(budget.cycleRange(budget.cycleOf(today)).start, -1));
    const key = /^\d{4}-\d{2}$/.test(q.cycle || '') ? q.cycle : prevKey;
    const r = buildReport(budget, key, cats);
    if (q.send) {
      await sendMail(r, await renderPdf(r));
      return res.status(200).json({ ok: true, sent: true, cycle: key, message: `${r.title} 리포트를 메일로 보냈어요` });
    }
    if (q.pdf) {
      const pdf = await renderPdf(r);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`가계부-${key}-결산.pdf`)}`);
      return res.status(200).send(pdf);
    }
    return res.status(200).json({ ok: true, report: r, message: notifyText(r) });
  } catch (e) {
    return res.status(500).json({ ok: false, message: `리포트 실패: ${e.message}` });
  }
}

