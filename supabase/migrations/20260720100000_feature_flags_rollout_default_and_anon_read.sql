-- Migration: 20260720100000_feature_flags_rollout_default_and_anon_read.sql
-- Purpose: Feature-flag RCA repair (structural half) — two root-cause fixes on
--          public.feature_flags:
--            (1) rollout_percentage column DEFAULT 0 → DEFAULT 100
--            (2) add an anon SELECT RLS policy (feature_flags_read_anon)
--          NO data changes. The one-time repair of already-seeded rows
--          (is_enabled=true AND rollout_percentage=0) is a SEPARATE
--          approved-list migration (Migration B, pending CEO sign-off) —
--          deliberately NOT included here so this file stays a pure
--          zero-data-mutation structural fix.
--
-- ─── RCA (1): the rollout_percentage DEFAULT 0 landmine ──────────────────────
--   The baseline (00000000000000_baseline_from_prod.sql ~line 11216) declares:
--     rollout_percentage integer DEFAULT 0
--   The server evaluator (packages/lib/src/feature-flags.ts:isFeatureEnabled,
--   ~line 120-121) treats rollout_percentage <= 0 as unconditionally FALSE —
--   even when is_enabled = true. Consequence: every flag row created WITHOUT an
--   explicit rollout_percentage (super-admin console inserts, ad-hoc seeds,
--   scripts that omit the column) is born with rollout 0 and therefore
--   evaluates OFF even after an operator flips is_enabled to true — "enabled
--   flags born OFF". Changing the column DEFAULT to 100 makes the natural
--   semantics hold: a newly created flag is governed by is_enabled alone
--   (rollout 100 = no per-user gating), and operators opt IN to partial
--   rollout by setting an explicit percentage. Existing rows are untouched:
--   ALTER COLUMN ... SET DEFAULT only affects future INSERTs that omit the
--   column. Seed migrations that pass rollout_percentage explicitly
--   (the REG-125 canonical shape, e.g. 20260716120000) are unaffected —
--   their explicit 0 still means "seeded dark".
--
-- ─── RCA (2): the silent-empty anon fallback ─────────────────────────────────
--   RLS on feature_flags (baseline ~lines 21029-22021) has exactly two
--   policies: feature_flags_read_authenticated (SELECT TO authenticated) and
--   service_feature_flags (ALL TO service_role). The server evaluator's
--   loadFlags() falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY whenever
--   SUPABASE_SERVICE_ROLE_KEY is missing from the environment
--   (packages/lib/src/feature-flags.ts ~line 59). Under the anon role, RLS
--   filters every row: PostgREST returns HTTP 200 with an empty array — NOT
--   an error — so loadFlags() caches [] for 5 minutes (CACHE_TTL.STATIC) and
--   EVERY flag on the platform evaluates OFF, silently, with no log signal.
--   The policy below closes that failure mode by letting anon read the table.
--
--   Data-exposure assessment (architect, 2026-07-20 — verified in-source):
--   feature-flag rows carry NO PII and no secrets. Exposed columns are
--   flag_name, is_enabled, rollout_percentage, description, scoping arrays
--   (target_roles/environments/institutions/grades/subjects/languages), wave,
--   launch_date, timestamps, and the `metadata` jsonb. The metadata column was
--   audited across every writer/reader in the repo (seed migrations
--   20260519000002 / 20260520000007 / 20260606000000 / 20260615100000; readers
--   supabase/functions/_shared/python-ai-proxy.ts, _shared/mol/feature-flag.ts,
--   grounded-answer/mol-shadow.ts, apps/host/src/app/api/feature-flags/voice/
--   route.ts, api/super-admin/mol-shadow/route.ts; client reader
--   packages/ui/src/MaintenanceBanner.tsx): it holds ONLY operational envelope
--   values — enabled / kill_switch / rollout_pct / task_types[], maintenance
--   banner text (message_en/message_hi), and the competition-SKU pricing in
--   paise (already mirrored verbatim in the row's public description). No
--   PII, no keys, no tokens. A metadata-hiding view is therefore NOT needed;
--   the plain table policy is the simplest posture that closes the RCA.
--   target_institutions holds school UUIDs — opaque identifiers, not PII.
--
--   Anon-read behavior change (reviewed, safe): logged-out surfaces that
--   previously read zero rows (e.g. MaintenanceBanner in packages/ui, the
--   getFeatureFlags helper in packages/lib/src/supabase.ts) will now see flag
--   rows for anonymous visitors. Both are fail-closed consumers — they render
--   nothing / default-OFF on empty data today, and with data they apply the
--   same is_enabled + scoping evaluation that authenticated users already get.
--   A maintenance banner becoming visible to logged-out visitors is the
--   CORRECT behavior, not a regression.
--
-- ─── Idempotency ─────────────────────────────────────────────────────────────
--   * ALTER COLUMN ... SET DEFAULT is naturally idempotent (re-running sets
--     the same default).
--   * The policy add is guarded by a pg_policies existence check inside a
--     DO block, so re-running is a clean no-op.
--   * Both blocks are additionally guarded with to_regclass so the file
--     no-ops cleanly on a fresh/out-of-order DB where feature_flags does not
--     exist yet (live-DB CI test / Supabase preview branches), matching the
--     defensive convention of the flag-seed precedent (20260716120000).
--   No DROP TABLE / DROP COLUMN. No SECURITY DEFINER. No data rewrite.
--
-- Owner: architect. Reviewers (P14 — RBAC/auth chain): backend, frontend,
--        ops, testing.
-- Added: 2026-07-20
--
-- ─── Reversible (manual DOWN) ────────────────────────────────────────────────
--   ALTER TABLE public.feature_flags ALTER COLUMN rollout_percentage SET DEFAULT 0;
--   DROP POLICY IF EXISTS feature_flags_read_anon ON public.feature_flags;

BEGIN;

-- ─── (1) rollout_percentage DEFAULT 0 → 100 ──────────────────────────────────
-- New flag rows that omit rollout_percentage are governed by is_enabled alone
-- (100 = no per-user rollout gating). Existing rows are NOT modified — the
-- one-time repair of enabled-but-rollout-0 rows is Migration B (approved-list,
-- pending CEO sign-off).
DO $rollout_default$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    ALTER TABLE public.feature_flags
      ALTER COLUMN rollout_percentage SET DEFAULT 100;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping rollout_percentage default change (fresh DB).';
  END IF;
END $rollout_default$;

-- ─── (2) anon SELECT policy ──────────────────────────────────────────────────
-- Closes the silent-empty anon fallback: when the server evaluator runs on the
-- anon key (SUPABASE_SERVICE_ROLE_KEY missing), PostgREST previously returned
-- 200 [] (RLS filtered every row), the evaluator cached the empty list for
-- 5 minutes, and every flag evaluated OFF platform-wide with no error signal.
-- Flags carry no PII (see header audit); exposure is flag_name + booleans +
-- scoping arrays + operational metadata envelope.
DO $anon_read_policy$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'feature_flags'
        AND policyname = 'feature_flags_read_anon'
    ) THEN
      CREATE POLICY feature_flags_read_anon
        ON public.feature_flags
        FOR SELECT
        TO anon
        USING (true);
    END IF;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping feature_flags_read_anon policy (fresh DB).';
  END IF;
END $anon_read_policy$;

-- ─── Documentation comment (additive metadata) ───────────────────────────────
DO $column_comment$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    COMMENT ON COLUMN public.feature_flags.rollout_percentage IS
      'Per-user rollout gate, 0-100. The evaluator (isFeatureEnabled) treats '
      '<= 0 as unconditionally OFF even when is_enabled=true, and 100/NULL as '
      'no gating. DEFAULT changed 0 → 100 by 20260720100000: a value of 0 was '
      'silently disabling every flag created without an explicit percentage '
      '("enabled flags born OFF"). Set an explicit 1-99 to opt in to partial '
      'rollout; explicit 0 still means "seeded dark".';
  END IF;
END $column_comment$;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'feature_flags'
--    AND column_name = 'rollout_percentage';
--   Expected: 100
--
-- SELECT policyname, roles, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'feature_flags'
--  ORDER BY policyname;
--   Expected (among others):
--     feature_flags_read_anon            {anon}            SELECT
--     feature_flags_read_authenticated   {authenticated}   SELECT
--     service_feature_flags              {service_role}    ALL
