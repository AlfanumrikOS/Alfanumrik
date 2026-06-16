-- Migration: 20260620000600_create_parent_weekly_reports.sql
-- Purpose: FIX B (P1) of the portal RBAC SaaS remediation FIX PASS.
--          Create the `parent_weekly_reports` table that the parent AI weekly
--          report 24h cache depends on. The table does NOT exist in the baseline
--          (00000000000000_baseline_from_prod.sql — confirmed absent), so today
--          src/app/api/parent/report/route.ts:
--            * line 58 SELECTs `report, generated_at` from it (always empty ->
--              cache permanently dead),
--            * line 148 UPSERTs onConflict:'student_id,guardian_id' (fails: no
--              table, no matching unique constraint).
--          Net effect: the parent-report Edge Function (Claude) is re-invoked on
--          EVERY load — cost + latency. This migration makes the cache real.
--
-- ─── Column shape aligned to the route (src/app/api/parent/report/route.ts) ───
--   READ  (line 57-65): .select('report, generated_at')
--                        .eq('student_id', ...).eq('guardian_id', ...)
--                        .gte('generated_at', twentyFourHoursAgo)
--   WRITE (line 147-158): .upsert({ student_id, guardian_id, report, language,
--                          generated_at }, { onConflict: 'student_id,guardian_id' })
--   => required columns: student_id, guardian_id, report (jsonb), language (text),
--      generated_at (timestamptz). onConflict needs a UNIQUE(student_id,guardian_id).
--   guardian_id references guardians(id) (the route resolves guardian.id from
--   getGuardianByAuthUserId(auth.userId) and writes that value).
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. New table. No DROP / DELETE / UPDATE / TRUNCATE.
--   - IDEMPOTENT / replayable: CREATE TABLE IF NOT EXISTS; the UNIQUE constraint
--     and every policy/index/trigger is guarded (constraint via a DO-block guard,
--     policies via DROP POLICY IF EXISTS + CREATE, indexes via IF NOT EXISTS).
--     Safe to replay on PROD, main-staging, CI live-DB, and fresh DBs.
--   - RLS ENABLED IN THIS SAME MIGRATION (P8). Policies below.
--   - Grades are not stored here; `language` is a free 'en'/'hi' tag (the route
--     validates it to one of those two before writing).
--
-- ─── RLS policy design (P8 / P13) ────────────────────────────────────────────
--   This is parent-owned cache data keyed by (student_id, guardian_id). The
--   single data boundary is "is the calling guardian linked to this student?",
--   which the EXISTING baseline SECURITY DEFINER helper is_guardian_of(student_id)
--   already encodes (EXISTS over guardian_student_links JOIN guardians on
--   auth.uid(), status IN ('active','approved')). Policies:
--     * guardian SELECT/INSERT/UPDATE own  -> is_guardian_of(student_id)
--     * service_role ALL                   -> the route uses supabaseAdmin
--                                             (service role) for read + upsert,
--                                             so service_role must have full
--                                             access; this is the actual runtime
--                                             path. The guardian-scoped policies
--                                             additionally permit a direct
--                                             RLS-respecting client read if ever
--                                             wired.
--   NOTE: the four-pattern checklist's "student own / teacher assigned" patterns
--   do not apply — a weekly PARENT report is, by definition, parent-scoped data;
--   students and teachers have no read interest in the parent's cached AI report,
--   and admin access is via the service_role policy (service role bypasses RLS
--   anyway; the explicit policy documents intent).
--
-- Owner: architect. Portal RBAC SaaS remediation FIX PASS — FIX B.

BEGIN;

-- =============================================================================
-- 1. TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."parent_weekly_reports" (
  "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
  "student_id"   uuid        NOT NULL REFERENCES "public"."students"("id")   ON DELETE CASCADE,
  "guardian_id"  uuid        NOT NULL REFERENCES "public"."guardians"("id")  ON DELETE CASCADE,
  "report"       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "language"     text        NOT NULL DEFAULT 'en',
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "parent_weekly_reports_pkey" PRIMARY KEY ("id")
);

-- UNIQUE(student_id, guardian_id) — required so the route's
-- onConflict:'student_id,guardian_id' upsert resolves. Added via a guarded
-- DO-block (ADD CONSTRAINT has no IF NOT EXISTS) so replay is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'parent_weekly_reports_student_guardian_key'
       AND conrelid = 'public.parent_weekly_reports'::regclass
  ) THEN
    ALTER TABLE "public"."parent_weekly_reports"
      ADD CONSTRAINT "parent_weekly_reports_student_guardian_key"
      UNIQUE ("student_id", "guardian_id");
  END IF;
END $$;

-- =============================================================================
-- 2. RLS (mandatory — P8)
-- =============================================================================
ALTER TABLE "public"."parent_weekly_reports" ENABLE ROW LEVEL SECURITY;

-- Guardian reads own linked child's report.
DROP POLICY IF EXISTS "parent_weekly_reports_guardian_select" ON "public"."parent_weekly_reports";
CREATE POLICY "parent_weekly_reports_guardian_select"
  ON "public"."parent_weekly_reports"
  FOR SELECT TO "authenticated"
  USING ( "public"."is_guardian_of"("student_id") );

-- Guardian inserts own linked child's report.
DROP POLICY IF EXISTS "parent_weekly_reports_guardian_insert" ON "public"."parent_weekly_reports";
CREATE POLICY "parent_weekly_reports_guardian_insert"
  ON "public"."parent_weekly_reports"
  FOR INSERT TO "authenticated"
  WITH CHECK ( "public"."is_guardian_of"("student_id") );

-- Guardian updates own linked child's report (the upsert's UPDATE branch).
DROP POLICY IF EXISTS "parent_weekly_reports_guardian_update" ON "public"."parent_weekly_reports";
CREATE POLICY "parent_weekly_reports_guardian_update"
  ON "public"."parent_weekly_reports"
  FOR UPDATE TO "authenticated"
  USING ( "public"."is_guardian_of"("student_id") )
  WITH CHECK ( "public"."is_guardian_of"("student_id") );

-- Service role full access (the route's actual runtime path: supabaseAdmin
-- read + upsert). admin access is via the service role.
DROP POLICY IF EXISTS "parent_weekly_reports_service_role" ON "public"."parent_weekly_reports";
CREATE POLICY "parent_weekly_reports_service_role"
  ON "public"."parent_weekly_reports"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- =============================================================================
-- 3. INDEXES
-- =============================================================================
-- The cache lookup filters (student_id, guardian_id) and orders by generated_at.
-- The UNIQUE(student_id, guardian_id) constraint already provides a usable index
-- for the equality lookup; add a generated_at-scoped index to serve the
-- .gte(generated_at).order(generated_at desc).limit(1) freshness probe.
CREATE INDEX IF NOT EXISTS "idx_parent_weekly_reports_lookup"
  ON "public"."parent_weekly_reports" ("student_id", "guardian_id", "generated_at" DESC);

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. Table + unique constraint exist:
--    SELECT conname FROM pg_constraint
--     WHERE conrelid = 'public.parent_weekly_reports'::regclass ORDER BY conname;
--      -- expect parent_weekly_reports_pkey + parent_weekly_reports_student_guardian_key
-- 2. RLS enabled:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'parent_weekly_reports';  -- expect t
-- 3. The route's upsert resolves (onConflict student_id,guardian_id) without error
--    and a second load within 24h returns cached:true.
