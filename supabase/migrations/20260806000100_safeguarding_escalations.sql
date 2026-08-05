-- Migration: 20260806000100_safeguarding_escalations.sql
-- Purpose: Foxy North-Star Phase 1 (S5.6 / U6 safeguarding flow) — create the
--          `safeguarding_escalations` table (+ RLS + indexes) and seed the
--          `safeguarding.review` permission granted to institution_admin, in
--          the SAME migration per the P8 same-migration RLS rule and the spec's
--          "table + RLS + safeguarding role grant (same migration)" contract.
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (S1.7 Foxy Guardian MISS -> S5.6; PR5 "sensitive conversations only
--        with safeguarding purpose"; U6 row in the build matrix; approval A1
--        APPROVED 2026-08-05; RBAC addition approved under A1/A3/A12).
--
-- ─── What this table is ──────────────────────────────────────────────────────
-- One row per safeguarding disclosure escalation raised by the pre-LLM
-- disclosure classifier in the Foxy pipeline (self-harm / abuse / violence /
-- acute distress). Rows are written ONLY by service-role server code (the
-- classifier stage + routing worker) and read ONLY by the human review lane
-- (school-admin / super-admin pages) through service-role API routes. The
-- school-admin lane is gated by authorizeSchoolAdmin(request,
-- 'safeguarding.review') — the permission seeded + granted to
-- institution_admin below; the super-admin lane is gated by
-- authorizeAdmin(request, 'admin') per the dominant /api/super-admin/*
-- house convention (admin/super_admin also hold safeguarding.review
-- defensively via the grants below). Human-in-the-loop per
-- approval A1: no auto parent notify; review -> action is a human decision.
--
-- ─── Idempotency / safety contract ───────────────────────────────────────────
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
--     DROP POLICY IF EXISTS + CREATE POLICY / CREATE OR REPLACE FUNCTION /
--     DROP TRIGGER IF EXISTS + CREATE TRIGGER — safe to replay everywhere
--     (PROD, main-staging, CI live-DB, fresh DBs).
--   - Permission + grant seeding mirrors the established RBAC seed pattern
--     (20260620000500_portal_rbac_remediation_seed_school_manage_api_keys.sql):
--     ON CONFLICT (code) DO NOTHING / ON CONFLICT (role_id, permission_id)
--     DO NOTHING, resolve by name/code, never by hardcoded UUID.
--   - ADDITIVE ONLY. No DROP TABLE/COLUMN, no DELETE, no UPDATE of RBAC tables.

BEGIN;

-- =============================================================================
-- 1. Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.safeguarding_escalations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  -- Tenant scope. NULLABLE: B2C students have no school (mirrors
  -- data_erasure_requests.school_id). Soft (FK-less) on purpose — school rows
  -- may be torn down independently of the safeguarding audit trail.
  school_id          uuid NULL,
  -- Foxy session / message provenance. Soft (FK-less) uuid pointers: chat
  -- retention and safeguarding retention are governed by DIFFERENT policies
  -- (retain_until below), so an escalation row must survive chat purges.
  session_id         uuid NULL,
  message_id         uuid NULL,
  category           text NOT NULL
                       CHECK (category IN ('self_harm', 'abuse', 'violence', 'acute_distress')),
  -- Which detection tier raised the row: the deterministic regex pre-filter
  -- alone, or regex + LLM confirmation stage.
  tier               text NOT NULL
                       CHECK (tier IN ('regex_only', 'llm_confirmed')),
  -- Classifier metadata: confidence + label ONLY. NEVER message text — the one
  -- sanctioned home for disclosure text is disclosure_excerpt below (PR5).
  classifier_meta    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- <=500 chars. The ONE sanctioned place student message text may live
  -- (PR5: sensitive conversations retained ONLY with a safeguarding purpose).
  -- Nowhere else — not in classifier_meta, not in audit_logs, not in Sentry.
  disclosure_excerpt text NULL
                       CHECK (disclosure_excerpt IS NULL OR length(disclosure_excerpt) <= 500),
  status             text NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review', 'reviewed', 'actioned', 'dismissed')),
  -- auth.users.id of the human reviewer (soft pointer; review lane stamps it).
  reviewed_by        uuid NULL,
  reviewed_at        timestamptz NULL,
  review_notes       text NULL,
  -- Retention policy column (approval A1): rows past retain_until are purged
  -- by the retention worker (later Phase 1 PR). 90-day default.
  retain_until       timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.safeguarding_escalations IS
  'Foxy safeguarding disclosure escalations (S5.6/U6): one row per classifier-raised disclosure (self_harm/abuse/violence/acute_distress). Human review lane only; all access via service-role routes — school-admin lane gated by safeguarding.review, super-admin lane by authorizeAdmin(admin) per house convention.';
COMMENT ON COLUMN public.safeguarding_escalations.classifier_meta IS
  'Classifier confidence + label ONLY. NEVER message text (PR5 — disclosure_excerpt is the sole sanctioned home for text).';
COMMENT ON COLUMN public.safeguarding_escalations.disclosure_excerpt IS
  '<=500 chars. The ONE sanctioned place message text lives, retained strictly for the safeguarding purpose (PR5). Purged with the row at retain_until.';
COMMENT ON COLUMN public.safeguarding_escalations.retain_until IS
  'Retention boundary (approval A1 retention policy): default now()+90 days; retention worker purges rows past this timestamp.';

-- =============================================================================
-- 2. Indexes (review-lane + retention-worker read paths)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_safeguarding_escalations_student_id
  ON public.safeguarding_escalations (student_id);

CREATE INDEX IF NOT EXISTS idx_safeguarding_escalations_school_status
  ON public.safeguarding_escalations (school_id, status);

CREATE INDEX IF NOT EXISTS idx_safeguarding_escalations_retain_until
  ON public.safeguarding_escalations (retain_until);

-- =============================================================================
-- 3. updated_at trigger (house pattern)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_safeguarding_escalations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_safeguarding_escalations_updated_at
  ON public.safeguarding_escalations;

CREATE TRIGGER trg_safeguarding_escalations_updated_at
  BEFORE UPDATE ON public.safeguarding_escalations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_safeguarding_escalations_updated_at();

-- =============================================================================
-- 4. RLS — DELIBERATE DEVIATION from the standard 4-pattern policy set
-- =============================================================================
-- The house RLS template (student-own / parent-linked / teacher-assigned /
-- admin-service-role) is INTENTIONALLY NOT applied here. This deviation is part
-- of the approved design (spec U6; approval A1):
--
--   * NO student self-read policy. A student being able to SELECT their own
--     escalation rows would reveal THAT they were flagged (and when), which is
--     itself a harm vector — e.g. an abuser with access to the child's device
--     could discover the disclosure was escalated and retaliate.
--   * NO parent-linked policy. Parents are excluded by the approved
--     safeguarding policy (A1: human-in-the-loop, NO auto parent notify —
--     whether/when a parent is informed is a reviewer decision, never a
--     direct-read grant; in abuse cases the parent may be the subject).
--   * NO teacher-assigned policy. Teachers are not the review lane; the
--     designated safeguarding reviewers (school-admin / super-admin surfaces)
--     are, and any per-policy notification to a designated adult flows through
--     the routing worker, not through table reads.
--
-- ALL access is therefore through service-role server routes: the
-- school-admin lane gated by authorizeSchoolAdmin(request,
-- 'safeguarding.review') (permission seeded below, granted to
-- institution_admin), and the super-admin lane gated by
-- authorizeAdmin(request, 'admin') per house convention. RLS is
-- deny-by-default for every authenticated/anon principal; the single explicit
-- policy below grants service_role only (made explicit rather than relying
-- solely on the bypass-RLS flag, so the posture is self-documenting).

ALTER TABLE public.safeguarding_escalations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "safeguarding_escalations_service_role_all"
  ON public.safeguarding_escalations;
CREATE POLICY "safeguarding_escalations_service_role_all"
  ON public.safeguarding_escalations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 5. NEW PERMISSION CODE: safeguarding.review  (same migration as the table)
-- =============================================================================
-- RBAC addition approved 2026-08-05 under A1 (safeguarding policy) — spec U6
-- "safeguarding role grant (same migration)". Column shape (code, resource,
-- action, description, is_active) confirmed against the baseline; there is NO
-- `category` column (categorisation is carried by `resource`).

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('safeguarding.review',
   'safeguarding',
   'review',
   'Review, action, and dismiss safeguarding disclosure escalations (gates the school-admin human review lane via authorizeSchoolAdmin; the super-admin lane uses authorizeAdmin admin-level per the /api/super-admin/* house convention)',
   true)
ON CONFLICT (code) DO NOTHING;

-- GRANT safeguarding.review -> institution_admin (the school-side review lane).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'institution_admin'
   AND p.code = 'safeguarding.review'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: admin + super_admin already hold every permission via the
-- wildcard CROSS JOIN grants in 20260612123200_rbac_matrix_conformance.sql,
-- but that wildcard only captures codes present when IT runs — on an env where
-- this file replays without the matrix migration re-running afterwards the new
-- code would be missing from both. Explicit grants close that replay-order
-- hole (mirrors 20260620000000 / 20260620000500 verbatim).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('admin', 'super_admin')
   AND p.code = 'safeguarding.review'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
--   SELECT r.name FROM role_permissions rp
--     JOIN roles r       ON r.id = rp.role_id
--     JOIN permissions p ON p.id = rp.permission_id
--    WHERE p.code = 'safeguarding.review' ORDER BY r.name;
--     -- expect: admin, institution_admin, super_admin
--   SELECT count(*) FROM pg_policies
--    WHERE tablename = 'safeguarding_escalations';
--     -- expect: 1 (service_role ALL only — the deviation is deliberate)
