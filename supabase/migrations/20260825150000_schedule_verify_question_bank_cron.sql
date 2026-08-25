-- Migration: 20260825150000_schedule_verify_question_bank_cron.sql
-- Purpose: Give the question-bank verifier a scheduler. It has never had one
--          (launch-blocker P0-6).
--
-- ── THE FINDING ────────────────────────────────────────────────────────────
-- `supabase/functions/verify-question-bank/index.ts` is deployed, authenticated
-- and correct. Nothing invokes it. Verified 2026-08-25:
--
--   cron.job matching 'verif' or verify-question-bank ......... 0 rows
--   vercel.json .............................................. does not exist
--   .github/workflows referencing verify-question-bank ....... none
--   ops_events WHERE source='verify-question-bank'
--                 OR category='grounding.verifier' ........... 0 rows, EVER
--   question_bank verified in the last 30 days ............... 0
--   last row to reach verification_state='verified' .......... 2026-06-22
--
-- The function calls logOpsEvent(category:'grounding.verifier') on every
-- successful run, so zero events over the table's whole lifetime is positive
-- evidence it has never completed a run — not merely that logging is absent.
--
-- Consequence: the verified pool cannot grow, so the RAG verification gate
-- (20260802100000_select_quiz_questions_rag_verification_gate.sql) can never
-- be enabled for any (grade, subject) pair. `ff_grounded_ai_enforced_pairs`
-- is empty, and the strict rung E0 has therefore never applied to a single
-- served question. Measured across the 18 CEO-locked math/science cells
-- (grades 6-12): 7,060 published+active questions, of which 368 (5.2%) are
-- verified_against_ncert. Grades 6, 7 and 8 hold ONE such question between
-- them.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
-- Schedules `verify-question-bank` hourly, following the platform convention
-- established by 20260729120100_reschedule_alert_deliverer_cron_auth.sql:
-- both `Authorization: Bearer <service-role JWT>` and `x-cron-secret`, each
-- read from the EXISTING shared Vault secrets. No new secret is required and
-- no secret literal appears in this file — the repository is public.
--
-- The project URL is written literally rather than via
-- `current_setting('app.supabase_url', true)`, which resolves to NULL on this
-- database (checked 2026-08-25). A NULL there would silently compose a NULL
-- url. The project URL is not a secret: it ships in the public JS bundle, and
-- `grounded-coverage-audit` already hardcodes it the same way.
--
-- ── CADENCE: DELIBERATELY CONSERVATIVE ─────────────────────────────────────
-- Hourly, not every 15 minutes. The function sizes its own batches (1000
-- off-peak / 250 peak, halved when throttled) and each claimed row costs one
-- grounded-answer verifier call. 13,379 rows are claimable today, so an
-- aggressive cadence would commit a large LLM spend before anyone has seen a
-- single real verdict. Hourly clears the backlog in days while leaving room to
-- observe. Raise the cadence once the first ticks look right.
--
-- ── EXPECTED AND INTENDED: THE SERVABLE POOL WILL SHRINK ───────────────────
-- Read this before merging. Tier-0 of the verification gate excludes
-- `verification_state = 'failed'`. Today ZERO rows carry that state — not
-- because the bank is clean, but because nothing has ever judged it. Once the
-- verifier runs it WILL disprove some questions, and each one stops serving
-- the moment it is marked.
--
-- That is the correct outcome: a question the NCERT verifier has disproved
-- must not reach a student. But it is a real, visible reduction in the
-- servable pool, and it should be a decision rather than a surprise. Watch
-- ops_events(category='grounding.verifier') and the failed count after the
-- first few ticks:
--
--   select verification_state, count(*) from public.question_bank
--   where content_status='published' and is_active and deleted_at is null
--   group by verification_state order by 2 desc;
--
-- If the failure rate is high enough to thin a (grade, subject) slice below
-- usable, `cron.unschedule('verify-question-bank-hourly')` stops it
-- immediately; nothing else in the platform depends on this job.
--
-- ── PREREQUISITE: THIS JOB DOES NOTHING WITHOUT THE SIGNING FIX ────────────
-- Scheduling alone does not start verification. Confirmed by invoking the
-- function against production on 2026-08-25: it claimed ~476 rows, RELEASED
-- 230 back to legacy_unverified, verified 0, and marked 0 as 'failed'.
--
-- Zero 'failed' is the diagnostic. verifyOneRow() returns null — which is what
-- triggers the release — ONLY when grounded-answer abstains with
-- `upstream_error` / `circuit_open` and retries are exhausted. A bad question
-- would have produced a 'failed' row. Every failure was upstream.
--
-- Root cause: supabase/functions/_shared/grounded-client.ts sent only
-- `Authorization: Bearer <service key>`, while grounded-answer's admission gate
-- (_shared/security/auth.ts, resolveSecurityPrincipal) additionally requires
-- `x-internal-timestamp` + `x-internal-signature` and answers
-- `401 deny_signature` without them. Corroborated by the trace table:
-- public.grounded_ai_traces holds 1,662 rows and EVERY one is caller='foxy' —
-- the one caller that does not use that file (it goes through the Node mirror
-- packages/lib/src/ai/grounded-client.ts, which does sign). No
-- 'quiz-generator' trace has ever existed.
--
-- That fix ships separately. Merge it FIRST or this cron will run hourly,
-- claim rows, release them unverified, and report success every time.
--
-- ── A CORRECTION WORTH KEEPING ─────────────────────────────────────────────
-- An earlier draft of this migration warned that
-- `ff_python_verify_question_bank_v1` was "on at 100%, the inverse of its
-- documented default" and would route to the Phase 2 no-op stub. That reading
-- was WRONG and is recorded here so it is not repeated.
--
-- ff_python_* flags are NOT controlled by is_enabled / rollout_percentage.
-- packages/lib/src/flags/protected-flags.ts (PYTHON_ENVELOPE) states it
-- outright: "controlled via the metadata jsonb envelope (python-ai-proxy), NOT
-- via is_enabled/rollout_percentage. Console column edits are
-- meaningless-to-harmful." The columns read true/100 and mean nothing.
--
-- The real control is the envelope, which currently reads:
--   {"phase":"phase_2_stub","enabled":false,"kill_switch":false,"rollout_pct":0}
-- The proxy is OFF. The TS verifier-of-record is what runs, which is why the
-- 401 above is reachable at all. Do not "fix" this flag by editing its
-- columns.
--
-- ── BATCH SIZE IS NOT CALLER-CONTROLLABLE — WATCH THE FIRST TICKS ──────────
-- The function decides its own batch: BATCH_SIZE_OFF_PEAK = 1000,
-- BATCH_SIZE_PEAK = 250 (verify-question-bank/shared.ts), via
-- decideBatchSize(). index.ts passes `bodyText: ''` and reads no override, so
-- this cron cannot ask for a smaller batch.
--
-- Once signing works each row costs a real retrieval + LLM call, so a batch of
-- 250-1000 will very likely exceed the Edge Function's wall-clock limit and be
-- cut off part-way. That is survivable — claim_verification_batch reclaims
-- expired claims (DEFAULT_CLAIM_TTL_SECONDS = 600), so a cut-off run's rows
-- return to the pool on their own and no manual cleanup is needed. It is
-- simply wasteful: each hourly tick finishes only as many rows as fit.
--
-- Evidence this already happens: 990 rows currently sit in 'pending' with
-- verification_claimed_by set and claim expiries reaching back to 2026-07-22 —
-- earlier runs were cut off the same way.
--
-- If throughput proves too low after the first few ticks, the fix is to lower
-- those two constants (a code change to shared.ts), NOT to raise the timeout
-- below — see the note on it.
--
-- Idempotent: unschedules any existing job of the same name first.
-- Rollback: select cron.unschedule('verify-question-bank-hourly');

do $migration_body$
declare
  v_jobid       bigint;
  v_service_key text;
  v_cron_secret text;
begin
  -- Environment guard: skip cleanly where pg_cron is absent (dev/branch DBs).
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice
      'pg_cron not installed; skipping verify-question-bank schedule. '
      '(Expected on a dev or preview database.)';
    return;
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'projector_runner_service_role_key'
  limit 1;

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  -- Fail LOUD, not silent. A missing secret here would schedule a job that
  -- posts an unauthenticated request every hour and is rejected every hour,
  -- which looks like "the verifier is running" in cron.job_run_details while
  -- verifying nothing. That is precisely the failure mode this migration
  -- exists to end, so refuse to create the job at all.
  if v_service_key is null or v_cron_secret is null then
    raise exception
      'Vault secret "projector_runner_service_role_key" or "cron_secret" is '
      'missing. Both are required for internal-cron auth and are already used '
      'by other platform jobs. Create them, then re-apply (idempotent).';
  end if;

  select jobid into v_jobid from cron.job where jobname = 'verify-question-bank-hourly';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    job_name := 'verify-question-bank-hourly',
    schedule := '20 * * * *',  -- :20 past the hour, clear of the other jobs
    command  := $cron_cmd$
      SELECT net.http_post(
        url := 'https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/verify-question-bank',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'projector_runner_service_role_key' LIMIT 1
          ),
          'x-cron-secret', (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'cron_secret' LIMIT 1
          ),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        -- pg_net's timeout bounds only how long WE wait for the response; it
        -- does NOT abort the Edge Function, which keeps running server-side.
        -- So this value is an observability choice, not a correctness one: too
        -- low and cron.job_run_details records a timeout for a run that in
        -- fact did useful work, which reads as "the verifier is broken" when
        -- it is not. The first manual invocation on 2026-08-25 was issued at
        -- 60000 and recorded exactly that:
        --   "Timeout of 60000 ms reached. Total time: 60000.768 ms"
        -- while the function carried on and touched 531 rows. Raised to 120s
        -- to capture the summary payload on a normal tick. Do not treat a
        -- timeout here as a failed run — check
        -- ops_events(category='grounding.verifier') instead, which the
        -- function writes only on a completed batch.
        timeout_milliseconds := 120000
      );
    $cron_cmd$
  );

  raise notice
    'Scheduled verify-question-bank-hourly (20 * * * *). Confirm the first '
    'tick with: select * from ops_events where category = ''grounding.verifier'' '
    'order by occurred_at desc limit 5;';
end $migration_body$;
