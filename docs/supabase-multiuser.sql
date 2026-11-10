-- 규원 · 성재 함께 쓰기: 데이터에 "누구 것" 표시를 추가합니다.
-- Supabase → SQL Editor → New query 에 붙여 넣고 Run. 여러 번 실행해도 안전합니다.
-- 기존 데이터는 모두 '규원' 으로 표시됩니다.

alter table transactions   add column if not exists owner text not null default '규원';
alter table fixed_expenses add column if not exists owner text not null default '규원';
alter table categories     add column if not exists owner text not null default '규원';
alter table assets         add column if not exists owner text not null default '규원';

create index if not exists transactions_owner_date on transactions (owner, date);

-- 사람별 설정 (월급날, 본인 이름, 문자 연결 등)
create table if not exists profiles (
  owner        text primary key,
  display_name text not null,
  payday       int  not null default 25,            -- 매달 월급날
  payday_rule  text not null default 'before',      -- 주말·공휴일이면 before: 앞당김 / after: 미룸
  owner_name   text,                                -- 통장 예금주 이름 (내 계좌 이체 구분용)
  settings     jsonb not null default '{}'::jsonb,  -- 잔액을 맞출 통장 등
  setup_done   boolean not null default false,
  created_at   timestamptz not null default now()
);

insert into profiles (owner, display_name, payday, payday_rule, setup_done, settings)
values ('규원', '규원', 25, 'before', true,
        '{"balanceAssets": {"카카오뱅크": "카카오뱅크 주거래", "신한": "신한은행 통장"}, "safeboxAsset": "카카오뱅크 세이프박스"}')
on conflict (owner) do nothing;

insert into profiles (owner, display_name, setup_done)
values ('성재', '성재', false)
on conflict (owner) do nothing;
