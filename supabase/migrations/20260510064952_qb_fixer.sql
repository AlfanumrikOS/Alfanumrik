-- Question-Bank fix-failed-questions agent — schema changes
-- Spec: docs/superpowers/specs/2026-05-10-qb-qa-fix-failed-questions-design.md §5

-- 1. Extend verification_state to include the two new states.
alter table question_bank drop constraint if exists question_bank_verification_state_check;
alter table question_bank
  add constraint question_bank_verification_state_check
  check (verification_state in (
    'legacy_unverified', 'pending', 'verified', 'failed',
    'failed_fix_in_flight', 'failed_unfixable'
  ));

-- 2. Claim RPC: atomically claim a batch of `failed` rows for the fixer.
create or replace function public.claim_fix_batch(
  p_batch_size int,
  p_claimed_by text,
  p_ttl_seconds int default 600
)
returns table (
  id uuid,
  question_text text,
  options jsonb,
  correct_answer_index int,
  explanation text,
  grade text,
  subject text,
  chapter_number int,
  chapter_title text
)
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_claim_until timestamptz := now() + make_interval(secs => p_ttl_seconds);
begin
  return query
  with claimed as (
    select qb.id from question_bank qb
    where qb.verification_state = 'failed'
       or (qb.verification_state = 'failed_fix_in_flight'
           and qb.verification_claim_expires_at < now())
    order by qb.updated_at asc nulls first
    limit p_batch_size
    for update skip locked
  ),
  updated as (
    update question_bank qb
    set verification_state = 'failed_fix_in_flight',
        verification_claimed_by = p_claimed_by,
        verification_claim_expires_at = v_claim_until
    from claimed
    where qb.id = claimed.id
    returning qb.id, qb.question_text, qb.options, qb.correct_answer_index,
              qb.explanation, qb.grade, qb.subject, qb.chapter_number, qb.chapter_title
  )
  select * from updated;
end;
$$;

revoke execute on function public.claim_fix_batch(int, text, int) from public, anon, authenticated;
grant execute on function public.claim_fix_batch(int, text, int) to service_role;

comment on function public.claim_fix_batch(int, text, int) is
  'Atomically claim a batch of failed question_bank rows for the fix-failed-questions agent. Mirrors claim_verification_batch.';

-- Partial index supporting claim_fix_batch's WHERE clause + ORDER BY.
-- The existing idx_question_bank_verification_queue covers ('legacy_unverified','pending') only.
create index if not exists idx_question_bank_fix_queue
  on question_bank (updated_at asc)
  where verification_state in ('failed', 'failed_fix_in_flight');

-- 3. Audit table for fixer activity.
create table if not exists question_bank_fix_history (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references question_bank(id) on delete cascade,
  agent_run_id uuid references agent_runs(id) on delete set null,
  fix_strategy text not null check (fix_strategy in (
    'index_correction', 'explanation_only', 'full_regen', 'unfixable'
  )),
  prior_question_text text,
  prior_options jsonb,
  prior_correct_answer_index int,
  prior_explanation text,
  prior_verifier_reason text,
  outcome text not null check (outcome in (
    'verified', 'still_failed', 'marked_unfixable'
  )),
  attempts int not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_qb_fix_history_question
  on question_bank_fix_history (question_id, created_at desc);
create index if not exists idx_qb_fix_history_outcome
  on question_bank_fix_history (outcome, created_at desc);

alter table question_bank_fix_history enable row level security;
-- No SELECT/INSERT policies for anon/authenticated. Service role bypasses RLS.

comment on table question_bank_fix_history is
  'Audit trail of fix-failed-questions agent activity. One row per attempted fix. Service role only.';
