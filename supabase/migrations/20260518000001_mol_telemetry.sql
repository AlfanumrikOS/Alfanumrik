-- 20260518000001_mol_telemetry.sql
-- MOL request telemetry. One row per generateResponse() call.

create table if not exists public.mol_request_logs (
  id              uuid primary key default gen_random_uuid(),
  request_id      text not null,
  student_id      uuid references public.students(id) on delete set null,

  task_type       text not null,
  surface         text,                 -- 'foxy' | 'quiz' | 'solver' | 'ocr' | other

  provider        text not null,        -- 'openai' | 'anthropic' | 'hybrid'
  model           text not null,
  passes          smallint not null default 1,
  fallback_count  smallint not null default 0,
  failure_chain   text,                 -- e.g. 'openai:503,openai:503'

  latency_ms        integer not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  usd_cost          numeric(12,6) not null default 0,
  inr_cost          numeric(12,4) not null default 0,

  grade           text,
  language        text,
  exam_goal       text,

  created_at      timestamptz not null default now()
);

create index if not exists mol_request_logs_created_idx     on public.mol_request_logs (created_at desc);
create index if not exists mol_request_logs_student_idx     on public.mol_request_logs (student_id, created_at desc);
create index if not exists mol_request_logs_provider_idx    on public.mol_request_logs (provider, created_at desc);
create index if not exists mol_request_logs_task_type_idx   on public.mol_request_logs (task_type, created_at desc);
create index if not exists mol_request_logs_fallback_idx    on public.mol_request_logs (created_at desc) where fallback_count > 0;

alter table public.mol_request_logs enable row level security;

-- Only service role writes; super-admins read. Students never see this table.
create policy mol_request_logs_admin_read on public.mol_request_logs
  for select using (
    exists (
      select 1 from public.admin_users
      where admin_users.auth_user_id = auth.uid()
        and admin_users.admin_level in ('super_admin', 'platform_admin')
    )
  );

comment on table public.mol_request_logs is 'Per-call telemetry for the Model Orchestration Layer. See docs/MOL_ARCHITECTURE.md';
