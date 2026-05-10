-- Agent loop trace persistence
-- Spec: docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md §5

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  status text not null check (status in ('success', 'budget_exceeded', 'tool_failure', 'llm_failure', 'unknown_error')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  step_count int not null default 0,
  tokens_input int not null default 0,
  tokens_output int not null default 0,
  final_text_redacted text,
  error_message text,
  user_id uuid references auth.users(id) on delete set null,
  context_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_agent_name_started
  on agent_runs (agent_name, started_at desc);
create index if not exists idx_agent_runs_user_id
  on agent_runs (user_id) where user_id is not null;
create index if not exists idx_agent_runs_status
  on agent_runs (status) where status != 'success';

create table if not exists agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  step_number int not null,
  step_type text not null check (step_type in ('llm_call', 'tool_call')),
  tool_name text,
  tool_input_redacted jsonb,
  tool_output_redacted jsonb,
  tool_error text,
  llm_model text,
  llm_input_tokens int,
  llm_output_tokens int,
  llm_stop_reason text,
  duration_ms int not null,
  created_at timestamptz not null default now(),
  unique (run_id, step_number)
);

create index if not exists idx_agent_steps_run_id
  on agent_steps (run_id, step_number);

-- RLS: service role only (P8)
-- No SELECT/INSERT policies for anon or authenticated. Service role bypasses RLS.
alter table agent_runs enable row level security;
alter table agent_steps enable row level security;

comment on table agent_runs is 'One row per LLM-as-planner agent invocation. Service role only.';
comment on table agent_steps is 'Per-step trace (llm_call or tool_call) for an agent_runs row. Service role only.';
