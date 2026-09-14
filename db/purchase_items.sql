-- 구매요청을 행 단위로 저장하는 테이블.
--
-- 왜 필요한가:
--   지금까지 구매요청은 app_data의 'purchaseDB' 한 칸에 JSON 배열 통째로 들어 있었다.
--   저장할 때마다 클라이언트가 배열 '전체'를 자기 사본으로 교체하므로, 두 사람이
--   각자 화면을 열어둔 채 저장하면 나중에 저장한 쪽이 앞사람 것을 지웠다.
--   (2026-09-09 07:39 에 이렇게 9건이 사라졌다)
--
--   행 단위로 옮기면 저장은 INSERT, 삭제는 id 지정 DELETE가 되어
--   남의 행을 건드릴 방법 자체가 없어진다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
--   여러 번 실행해도 안전하다 (if not exists).

create table if not exists purchase_items (
  id               text primary key,              -- 클라이언트가 만든 id (재전송해도 중복 안 생김)
  seq              bigserial,                     -- 원래 배열 순서 보존 / 표시 정렬용
  ts               text not null default '',      -- 작성 시각 문자열 (기존 표기 그대로)
  claim            text not null default '',      -- 청구번호
  req_date         text not null default '',      -- 요청일자 'YYYY.MM.DD' (기존 표기 그대로)
  proj_id          text not null default '',
  proj_name        text not null default '',
  proj_code        text not null default '',
  site             text not null default '',
  manager          text not null default '',
  manager_position text not null default '',      -- position 은 SQL 예약어라 이름을 바꿨다
  phone            text not null default '',
  item_no          integer not null default 1,
  item_name        text not null default '',
  item_spec        text not null default '',
  item_qty         text not null default '',
  item_note        text not null default '',
  created_at       timestamptz not null default now(),
  created_by       text not null default ''
);

create index if not exists purchase_items_claim_idx on purchase_items (claim);
create index if not exists purchase_items_seq_idx   on purchase_items (seq);

-- 서비스 키(서버 API)만 접근하도록 잠근다. 정책을 만들지 않으므로 anon 키로는 못 읽는다.
alter table purchase_items enable row level security;
