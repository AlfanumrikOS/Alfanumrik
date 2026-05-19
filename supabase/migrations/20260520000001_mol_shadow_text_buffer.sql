-- 20260520000001_mol_shadow_text_buffer.sql
-- C4.2b-ii (2026-05-20): bounded 7-day text buffer for the Sonnet grader.
--
-- Background:
--   C4.2a wired the shadow OpenAI call into pipeline.ts + pipeline-stream.ts;
--   C4.2b-i shipped the grader cron in scaffold mode (resolveTexts() returns
--   null). The grader needs the FULL question + baseline + shadow texts to
--   compare quality, but storing those on the hot mol_request_logs table
--   would (a) explode the row size (TOAST bloat on every read), (b) couple
--   retention of telemetry rows to retention of full-text content (the
--   telemetry row should live ~90 days, the text only 7), and (c) blur the
--   privacy story (mol_request_logs is admin-readable with no text content
--   today — adding text columns changes the threat model).
--
-- Architect's design (Path A, APPROVED 2026-05-19):
--   Separate table `mol_shadow_text_buffer` keyed by shadow_request_id with
--   a 7-day TTL. PII-redacted at WRITE time (email / Indian phone / Razorpay
--   IDs). RLS: super_admin + platform_admin read; service-role writes.
--
-- Sweep cadence:
--   pg_cron every 6 hours batch-deletes 10k expired rows. Belt-and-braces:
--   the grader cron ALSO deletes a row after a successful grade so we shed
--   storage as fast as the grader catches up.
--
-- Privacy posture:
--   We deliberately do NOT redact names. NCERT content (history, biology,
--   civics) contains thousands of proper nouns that ARE the curriculum
--   ("Newton", "Sita", "Gandhi", "Akbar") and a name-regex would shred them.
--   Email / phone / payment IDs are the actual PII attack surface and are
--   redacted exactly. The redaction_applied[] column tracks which redactors
--   fired so auditors can quantify exposure if questions arise later.

CREATE TABLE IF NOT EXISTS public.mol_shadow_text_buffer (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_request_id      text NOT NULL,
  shadow_request_id        text NOT NULL,
  question_text            text NOT NULL,
  baseline_system_prompt   text NOT NULL,
  shadow_system_prompt     text NULL,
  baseline_response_text   text NOT NULL,
  shadow_response_text     text NOT NULL,
  redaction_applied        text[] NOT NULL DEFAULT '{}',
  created_at               timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS mol_shadow_text_buffer_shadow_idx
  ON public.mol_shadow_text_buffer (shadow_request_id);

CREATE INDEX IF NOT EXISTS mol_shadow_text_buffer_expires_idx
  ON public.mol_shadow_text_buffer (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.mol_shadow_text_buffer ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY is NOT idempotent under bare CREATE POLICY; wrap so the
-- migration is re-runnable on an environment that already has the table
-- but not yet the policy (e.g. a manual hot-fix patch).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'mol_shadow_text_buffer'
       AND policyname = 'mol_shadow_text_buffer_admin_read'
  ) THEN
    CREATE POLICY mol_shadow_text_buffer_admin_read ON public.mol_shadow_text_buffer
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.admin_users
          WHERE admin_users.auth_user_id = auth.uid()
            AND admin_users.admin_level IN ('super_admin', 'platform_admin')
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.mol_shadow_text_buffer IS
  'C4.2b-ii: full question + response text for offline Sonnet grading. 7-day TTL. PII-redacted at write (email/phone/razorpay-id; intentionally NOT name-redacted due to NCERT-content false-positive risk). Service-role write, super_admin/platform_admin read. Companion to mol_request_logs.';

COMMENT ON COLUMN public.mol_shadow_text_buffer.redaction_applied IS
  'Which redactors fired on this row: subset of [''email'', ''phone'', ''razorpay_id''] (deduped). Empty array = no PII detected.';

COMMENT ON COLUMN public.mol_shadow_text_buffer.expires_at IS
  'Hard 7-day TTL. pg_cron job mol_shadow_text_buffer_sweeper deletes expired rows every 6 hours (10k batch cap). Grader cron also DELETEs on successful grade.';

-- pg_cron sweeper: every 6h, delete expired rows in batches of 10k.
--
-- Guarded so `supabase db push` succeeds on environments without pg_cron
-- (local dev, ephemeral test DBs). The sweeper is best-effort — grader-side
-- DELETE on successful grade is the primary GC path; this sweeper catches
-- (a) rows whose grader never ran (rate=0, kill_switch flipped), and (b)
-- rows whose grader failed midway.
DO $migration_body$
DECLARE
  v_jobid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron not installed; skipping mol_shadow_text_buffer_sweeper schedule. '
      'Enable via Supabase dashboard -> Database -> Extensions. Grader-side '
      'DELETE will still GC graded rows; only the 7-day-stale sweep is missing.';
    RETURN;
  END IF;

  -- Idempotent re-schedule: drop the existing job if any so the cron command
  -- below is the single source of truth.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'mol_shadow_text_buffer_sweeper';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'mol_shadow_text_buffer_sweeper',
    schedule := '0 */6 * * *',
    command  := $cron_cmd$
      DELETE FROM public.mol_shadow_text_buffer
       WHERE id IN (
         SELECT id FROM public.mol_shadow_text_buffer
          WHERE expires_at < now()
          LIMIT 10000
       )
    $cron_cmd$
  );
END $migration_body$;
