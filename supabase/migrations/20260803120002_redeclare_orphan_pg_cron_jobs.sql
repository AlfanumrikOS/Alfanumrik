-- 20260803120002_redeclare_orphan_pg_cron_jobs.sql
-- (renamed from 20260803120000 to resolve a timestamp collision after #1443
--  landed 20260803120000/120001 on main; sorts after both, independent of them.)
-- CI/CD system-design review, 2026-08-03.
--
-- Purpose: re-declare three pg_cron jobs that run in PRODUCTION but exist in
-- no migration the CLI still applies. pg_cron schedules are rows in
-- `cron.job` — DATA, not schema — so the pg_dump-derived baseline
-- (00000000000000_baseline_from_prod.sql) does not recreate them (verified:
-- the baseline contains zero `cron.schedule` calls). Their only declarations
-- live in `_legacy/timestamped/` migrations, which `supabase db push` skips.
-- Result: any environment rebuilt from the baseline (CI live-DB tests, fresh
-- staging, disaster recovery) silently runs WITHOUT:
--
--   1. ops-alert-evaluator                  (*/5 * * * *)  — evaluate_alert_rules()
--      origin: _legacy/timestamped/20260413120000_observability_console_1b.sql
--   2. ops-events-cleanup                   (30 3 * * *)   — cleanup_ops_events()
--      origin: _legacy/timestamped/20260411120000_observability_console_1a.sql
--   3. alfanumrik-content-readiness-daily   (was 30 3 * * *) — recompute_subject_content_readiness_daily()
--      origin: _legacy/timestamped/20260428130000_schedule_content_readiness.sql
--
-- RE-SLOT (job 3): ops-events-cleanup and alfanumrik-content-readiness-daily
-- both fired at 03:30 UTC — two heavy sweeps (ops_events bulk DELETE +
-- full-syllabus readiness recompute) colliding on the same instant. The
-- readiness job moves to 03:15 UTC (`15 3 * * *`), a slot verified free of
-- every other DAILY job at that hour: board-score 0 3, flag-posture-canary
-- 25 3, ops-events-cleanup 30 3, foxy-quality-sample 40 3, reverify-domains
-- 45 3 (Vercel crons + pg_cron combined — they all hit this database).
-- 03:15 UTC = 08:45 IST, still inside the original "after IST bedtime,
-- before IST teacher arrival" window the legacy migration chose.
--
-- All three target functions are schema and ARE in the baseline (verified by
-- grep: cleanup_ops_events line 2363, evaluate_alert_rules line 3263,
-- recompute_subject_content_readiness_daily line 6290 — the latter as
-- repaired by 20260713142448_fix_content_readiness_ambiguous_subject_code.sql).
--
-- Idempotent: unschedule-if-exists then schedule (pattern mirrors
-- 20260528000008_synthetic_host_monitor_cron.sql). Guarded so it SKIPS with
-- a NOTICE where pg_cron is absent (local dev) or a target function is
-- missing (partial environments) — `supabase db push` always proceeds.
-- Applying on production re-schedules the identical jobs (jobs 1-2 unchanged,
-- job 3 moves 03:30 → 03:15 as intended). No tables, no RLS impact.

DO $migration_body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron not installed; skipping ops-alert-evaluator / ops-events-cleanup / '
      'alfanumrik-content-readiness-daily schedules. Enable via Supabase dashboard '
      '-> Database -> Extensions, then re-apply this migration (idempotent).';
    RETURN;
  END IF;

  -- ── 1. ops-alert-evaluator — every 5 minutes ─────────────────────────────
  IF to_regproc('public.evaluate_alert_rules') IS NULL THEN
    RAISE NOTICE 'public.evaluate_alert_rules() missing; skipping ops-alert-evaluator.';
  ELSE
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ops-alert-evaluator';
    PERFORM cron.schedule(
      'ops-alert-evaluator',
      '*/5 * * * *',
      $cron_cmd$ SELECT public.evaluate_alert_rules(); $cron_cmd$
    );
  END IF;

  -- ── 2. ops-events-cleanup — nightly 03:30 UTC (unchanged slot) ───────────
  IF to_regproc('public.cleanup_ops_events') IS NULL THEN
    RAISE NOTICE 'public.cleanup_ops_events() missing; skipping ops-events-cleanup.';
  ELSE
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ops-events-cleanup';
    PERFORM cron.schedule(
      'ops-events-cleanup',
      '30 3 * * *',
      $cron_cmd$ SELECT public.cleanup_ops_events(); $cron_cmd$
    );
  END IF;

  -- ── 3. alfanumrik-content-readiness-daily — nightly, RE-SLOTTED to 03:15 ─
  -- 03:30 → 03:15 UTC so this full-syllabus recompute no longer collides
  -- with ops-events-cleanup's bulk delete (rationale in file header).
  IF to_regproc('public.recompute_subject_content_readiness_daily') IS NULL THEN
    RAISE NOTICE 'public.recompute_subject_content_readiness_daily() missing; skipping alfanumrik-content-readiness-daily.';
  ELSE
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'alfanumrik-content-readiness-daily';
    PERFORM cron.schedule(
      'alfanumrik-content-readiness-daily',
      '15 3 * * *',
      $cron_cmd$ SELECT recompute_subject_content_readiness_daily(); $cron_cmd$
    );
  END IF;
END $migration_body$;
