-- 20260518000002_mol_feedback.sql
-- MOL student feedback and dynamic routing weights derived from feedback.

create table if not exists public.mol_feedback (
  id              uuid primary key default gen_random_uuid(),
  request_id      text not null,
  student_id      uuid references public.students(id) on delete cascade,
  rating          smallint not null check (rating between 1 and 5),
  helpful         boolean,
  time_spent_ms   integer,
  completed       boolean,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists mol_feedback_request_idx on public.mol_feedback (request_id);
create index if not exists mol_feedback_student_idx on public.mol_feedback (student_id, created_at desc);

alter table public.mol_feedback enable row level security;

-- Students can write feedback for their own requests (matched via mol_request_logs).
create policy mol_feedback_student_insert on public.mol_feedback
  for insert with check (
    student_id is null
    or exists (select 1 from public.students s where s.id = student_id and s.auth_user_id = auth.uid())
  );

-- Routing weights. Bayesian-style smoothing: openai_weight reflects relative
-- success rate of openai vs anthropic for this task_type, in [0,1].
create table if not exists public.mol_routing_weights (
  task_type       text primary key,
  openai_weight   numeric(4,3) not null default 0.500 check (openai_weight between 0 and 1),
  sample_size     integer not null default 0,
  updated_at      timestamptz not null default now()
);

-- Seed the table with neutral 0.5 weights for every task type
insert into public.mol_routing_weights (task_type, openai_weight)
values
  ('explanation', 0.500),
  ('concept_explanation', 0.500),
  ('step_by_step', 0.500),
  ('reasoning', 0.500),
  ('quiz_generation', 0.500),
  ('evaluation', 0.500),
  ('doubt_solving', 0.500),
  ('ocr_extraction', 0.500)
on conflict (task_type) do nothing;

alter table public.mol_routing_weights enable row level security;
create policy mol_routing_weights_read_all on public.mol_routing_weights for select using (true);

comment on table public.mol_feedback is 'Student feedback on MOL-generated responses. Drives mol_routing_weights.';
comment on table public.mol_routing_weights is 'Dynamic per-task routing weights. Updated nightly from mol_feedback.';
