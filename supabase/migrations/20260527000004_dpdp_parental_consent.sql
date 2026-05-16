-- 20260527000004_dpdp_parental_consent.sql
--
-- Phase D.1 of the prod-readiness plan — DPDP compliance.
--
-- India's Digital Personal Data Protection (DPDP) Act, in effect 2024,
-- requires explicit verifiable consent from a parent/guardian before the
-- platform processes a child's (under-18) personal data. Alfanumrik onboards
-- students via guardian link-codes (see baseline_from_prod.sql
-- `guardian_student_links`) — today's redemption captures no explicit
-- consent record, so we cannot prove DPDP-compliance to a regulator.
--
-- This migration creates `public.parental_consent`, a thin audit trail of
-- consent grants and revocations, separate from the link itself. The
-- link asserts "this parent is linked to this child"; the consent row
-- asserts "this parent has agreed, on date X, to scopes Y, under policy
-- version V".
--
-- Schema choices:
--   - One active row per (guardian, student) pair: enforced by a UNIQUE
--     constraint over (guardian_id, student_id, revoked_at) with NULLS
--     NOT DISTINCT so two NULL revoked_at values collide. This lets the
--     same (guardian, child) pair carry a revoked row AND a current
--     active row simultaneously without violating the constraint.
--   - consent_version is a free-form string we bump when the policy text
--     materially changes. The gate code re-prompts when the active row's
--     version is older than the current CURRENT_CONSENT_VERSION constant
--     (see src/lib/dpdp/consent.ts).
--   - consent_payload jsonb stores per-scope grants (curriculum_access,
--     performance_data_sharing_with_teacher, marketing_emails). Future
--     selective revocation (parent withdraws only marketing) updates the
--     jsonb in place; we don't model each scope as its own column.
--   - ip_address + user_agent are captured for regulator audit. Not PII
--     in the DPDP sense, but evidence of where/how consent was given.
--
-- RLS posture mirrors guardian_student_links: guardians can SELECT/INSERT
-- their own rows (resolved via the auth_user_id → guardians.id hop);
-- service_role bypasses for the API route's write path. Schools, teachers,
-- and super-admins do NOT get read access to this table — consent is a
-- guardian-personal record, not part of the school's audit trail.

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.parental_consent (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id     uuid NOT NULL REFERENCES public.guardians(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  -- Free-form version label ('v1-2026-05' style). The gate re-prompts when
  -- a guardian's active row carries an older version than CURRENT_CONSENT_VERSION.
  consent_version text NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  -- NULL ⇒ active. revoked_at IS NOT NULL ⇒ historical (kept for audit).
  revoked_at      timestamptz,
  -- Per-scope grants. Shape: { scopes: { curriculum_access: true, … }, locale: 'en' }.
  -- Defaults to '{}' so legacy backfills don't violate NOT NULL on payload reads.
  consent_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Audit forensics. Not used by the gate; visible to operators investigating
  -- a regulator inquiry. ip_address is `inet` so postgres normalises IPv4/v6
  -- and rejects malformed strings at insert time.
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Each (guardian, student) pair may have at most ONE row with the same
  -- revoked_at value. With NULLS NOT DISTINCT (Postgres 15+), two NULLs
  -- collide, so a guardian can have at most one active row at a time. Once
  -- they revoke (revoked_at = now()), they may grant again — the new row
  -- has revoked_at = NULL (active), the old row has revoked_at = now() (historical).
  CONSTRAINT parental_consent_unique_active
    UNIQUE NULLS NOT DISTINCT (guardian_id, student_id, revoked_at)
);

COMMENT ON TABLE public.parental_consent IS
  'DPDP-compliant audit trail of parental consent grants and revocations. '
  'Separate from guardian_student_links (which models the relationship). '
  'Phase D.1, 2026-05.';

COMMENT ON COLUMN public.parental_consent.consent_version IS
  'Policy version label ("v1-2026-05"); re-prompt when stale.';
COMMENT ON COLUMN public.parental_consent.revoked_at IS
  'NULL ⇒ active. Non-NULL ⇒ revoked at this timestamp; kept for audit.';
COMMENT ON COLUMN public.parental_consent.consent_payload IS
  'jsonb of per-scope grants + locale. See src/lib/dpdp/consent.ts SCOPES.';

-- ─── 2. Indexes — fast "is consent active" lookups ──────────────────────────

-- The gate's hot query is "for this guardian, list active rows joined to
-- linked students" — covered by (guardian_id) and (revoked_at) filters.
CREATE INDEX IF NOT EXISTS idx_parental_consent_guardian
  ON public.parental_consent (guardian_id);

CREATE INDEX IF NOT EXISTS idx_parental_consent_student
  ON public.parental_consent (student_id);

-- Partial index for the "active rows only" scan path: WHERE revoked_at IS NULL
-- is the dominant filter; this index avoids scanning the revoked rows entirely.
CREATE INDEX IF NOT EXISTS idx_parental_consent_active
  ON public.parental_consent (guardian_id, student_id)
  WHERE revoked_at IS NULL;

-- ─── 3. RLS — guardians SELECT/INSERT own rows; service_role bypass ─────────

ALTER TABLE public.parental_consent ENABLE ROW LEVEL SECURITY;

-- Guardians SELECT their own rows: resolve auth.uid() → guardians.id and
-- match. The subquery is the same shape as the existing
-- "Guardians can view own links" policy on guardian_student_links — keeps
-- the pattern uniform for operator readability.
DROP POLICY IF EXISTS "Guardians can view own consent" ON public.parental_consent;
CREATE POLICY "Guardians can view own consent"
  ON public.parental_consent
  FOR SELECT
  TO authenticated
  USING (
    guardian_id IN (
      SELECT id FROM public.guardians WHERE auth_user_id = auth.uid()
    )
  );

-- Guardians INSERT only with their own guardian_id. The API route still
-- writes through service_role (it validates ownership + emits state_event +
-- audit_log atomically), so this policy is a defense-in-depth check rather
-- than the primary path.
DROP POLICY IF EXISTS "Guardians can insert own consent" ON public.parental_consent;
CREATE POLICY "Guardians can insert own consent"
  ON public.parental_consent
  FOR INSERT
  TO authenticated
  WITH CHECK (
    guardian_id IN (
      SELECT id FROM public.guardians WHERE auth_user_id = auth.uid()
    )
  );

-- Guardians UPDATE only their own rows (revocation flips revoked_at on the
-- caller's active row). Same auth.uid() → guardian_id resolution.
DROP POLICY IF EXISTS "Guardians can update own consent" ON public.parental_consent;
CREATE POLICY "Guardians can update own consent"
  ON public.parental_consent
  FOR UPDATE
  TO authenticated
  USING (
    guardian_id IN (
      SELECT id FROM public.guardians WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    guardian_id IN (
      SELECT id FROM public.guardians WHERE auth_user_id = auth.uid()
    )
  );

-- Service-role bypass — the API route writes through this scope.
DROP POLICY IF EXISTS "Service role full access parental_consent" ON public.parental_consent;
CREATE POLICY "Service role full access parental_consent"
  ON public.parental_consent
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No DELETE policy — consent revocations are a soft-update (revoked_at = now()).
-- Physical deletion of a consent row would destroy DPDP audit history. If
-- a row needs to disappear, run DELETE as service_role with an audit log
-- entry from the operator.

COMMIT;
