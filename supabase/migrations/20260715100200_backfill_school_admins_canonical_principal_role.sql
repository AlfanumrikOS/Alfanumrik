-- Migration: 20260715100200_backfill_school_admins_canonical_principal_role.sql
-- Purpose: Data-only backfill. Normalize the role of a school's FOUNDING admin
--          from the column DEFAULT 'institution_admin' to the canonical
--          'principal' — but ONLY for rows that are unambiguously
--          founder-via-default, never for a deliberately-assigned role.
--          (Phase 3a of the onboarding-hardening initiative — DB layer.)
--
-- WHY
-- ---
-- Going forward, bootstrap_user_profile() (20260715100100) writes founding school
-- admins with role='principal' (the full-capability Wave-C role). PRE-EXISTING
-- founders created by the app-side helper
-- packages/lib/src/identity/school-admin-bootstrap.ts got role='institution_admin'
-- because that helper never sets `role`, so the school_admins column DEFAULT
-- ('institution_admin', baseline:13290) applied. This backfill aligns those
-- historical founders with the new canonical value so the data is consistent.
--
-- THE AMBIGUITY THIS SCOPING RESOLVES
-- -----------------------------------
-- role='institution_admin' is ambiguous: it is BOTH the column DEFAULT (what a
-- founder gets implicitly) AND a legitimate EXPLICIT assignment (a real
-- multi-school operator, or a staff member deliberately given the institution_admin
-- text role). The school_admins.role CHECK also permits 'vice_principal' and
-- 'academic_coordinator' — those are ALWAYS explicit assignments and are NEVER
-- touched here. So the only rows we may safely rewrite are role='institution_admin'
-- rows that we can prove are founder-via-default, not a real assignment.
--
-- Capability note (why over-broad scoping would be unsafe): under the CEO-approved
-- Wave-C matrix (packages/lib/src/school-admin-auth.ts), 'principal' is SINGLE-school
-- and holds the institution_admin capability superset PLUS institution.use_principal_ai;
-- 'institution_admin' is the MULTI-school role (cross-school student access is
-- special-cased for it in rbac.ts::canAccessStudent). This matters only when the
-- ff_school_admin_rbac flag is ON (default OFF), but rewriting a GENUINE multi-school
-- institution_admin to principal would narrow their cross-school scope. The scoping
-- below deliberately excludes any such row.
--
-- CONSERVATIVE SCOPING (every predicate must hold)
-- ------------------------------------------------
-- Normalize sa.role 'institution_admin' -> 'principal' ONLY where:
--   (1) sa.role = 'institution_admin'      — never touch vice_principal /
--       academic_coordinator / already-principal rows.
--   (2) sa.is_active = TRUE                 — do not rewrite deactivated history.
--   (3) sa is the UNIQUE EARLIEST admin of its school: no OTHER school_admins row
--       for the same school_id has created_at <= sa.created_at. This selects the
--       school's founder and excludes both later-added staff (a deliberately-
--       assigned institution_admin added by the founder) AND ambiguous co-earliest
--       ties.
--   (4) sa's auth_user_id administers EXACTLY ONE school (one school_admins row
--       total for that auth_user_id). This protects a GENUINE multi-school
--       institution_admin from being narrowed to a single-school principal.
-- Predicates (3)+(4) together confine the UPDATE to single-school founders whose
-- 'institution_admin' can only have come from the column default.
--
-- SAFETY CONTRACT
-- ---------------
--   - DATA-ONLY: a single scoped UPDATE. No DDL, no schema change, no new table
--     (P8 RLS N/A), no DROP. Grades untouched (P5 N/A).
--   - IDEMPOTENT: re-running is a no-op — after the first pass the matching rows
--     are 'principal', which predicate (1) excludes. Replayable safely.
--   - REVERSIBLE (manual): the affected rows can be identified after the fact from
--     auth_audit_log if needed; a compensating UPDATE back to 'institution_admin'
--     is trivial. No data is destroyed — only a text enum value is normalized
--     within the CHECK-permitted set.
--
-- APPLICATION IS DEPLOY-TIME (docs/runbooks/schema-reproducibility-fix.md).

DO $backfill$
DECLARE
  v_updated INTEGER;
BEGIN
  WITH normalized AS (
    UPDATE public.school_admins sa
       SET role = 'principal',
           updated_at = now()
     WHERE sa.role = 'institution_admin'                       -- (1)
       AND sa.is_active = TRUE                                 -- (2)
       AND NOT EXISTS (                                        -- (3) unique earliest
             SELECT 1
               FROM public.school_admins other
              WHERE other.school_id = sa.school_id
                AND other.id <> sa.id
                AND other.created_at <= sa.created_at
           )
       AND (                                                   -- (4) single-school
             SELECT count(*)
               FROM public.school_admins mine
              WHERE mine.auth_user_id = sa.auth_user_id
           ) = 1
    RETURNING sa.id
  )
  SELECT count(*) INTO v_updated FROM normalized;

  RAISE NOTICE '[20260715100200] backfilled % founder school_admins row(s) institution_admin -> principal', v_updated;
END $backfill$;
