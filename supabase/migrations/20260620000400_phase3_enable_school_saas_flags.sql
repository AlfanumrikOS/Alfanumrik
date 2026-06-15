-- Migration: 20260620000400_phase3_enable_school_saas_flags.sql
-- Purpose: PHASE 3 flag ENABLEMENT (CEO-approved, branch
--          feat/portal-rbac-saas-remediation). Flips FIVE already-built,
--          flag-gated school/teacher SaaS surfaces from OFF -> ON so the depth
--          that was 404'ing / hidden behind the gates becomes reachable in prod:
--
--    1. ff_school_self_service_billing_v1
--         School-admin Razorpay self-service (POST/PATCH/DELETE on
--         /api/school-admin/subscription). P11-CERTIFIED SAFE by architect +
--         backend for MONTHLY subscriptions ONLY — the route hard-rejects
--         billing_cycle='yearly' with HTTP 400 `yearly_not_supported`
--         (src/app/api/school-admin/subscription/route.ts ~line 202), because
--         the school webhook branch only matches recurring subscription events;
--         a yearly self-service sub would never activate. Monthly path is atomic
--         (webhook-activated 'trial' -> 'active', signature-verified) so no plan
--         access is granted before verified payment. STAGED ROLLOUT REQUIRED —
--         see docs/runbooks/2026-06-16-phase3-billing-flag-rollout.md.
--
--    2. ff_school_admin_rbac
--         Role-aware school-admin capability (school staff / sub-admin
--         delegation). authorizeSchoolAdmin() enforces the CEO-approved
--         role->permission matrix (SCHOOL_ADMIN_ROLE_CAPABILITIES). Built; was
--         404'ing / over-permissive when OFF (all four school_admins.role values
--         collapsed to institution_admin). Enabling activates the matrix.
--
--    3. ff_teacher_command_center
--         Dense desktop-first teacher home ("Class Command Center") + slimmed
--         5-item teacher nav. Built; OFF rendered the legacy tabbed dashboard.
--
--    4. ff_school_command_center
--         Read-only "School Command Center" principal/admin home + consolidated
--         5-section school-admin nav. Built; OFF rendered the legacy stat-tile
--         dashboard.
--
--    5. ff_school_reports_depth
--         Read-only school-wide academic reporting depth (mastery + Bloom's +
--         export; 3 NEW read routes under /api/school-admin/reports/*). Built;
--         OFF returned 404 on those subpaths.
--
-- EXPLICITLY NOT ENABLED HERE:
--    ff_principal_ai_v1 — Principal AI Assistant. SEPARATE track: its backing
--    migration (20260616010000_principal_ai_assistant_v1.sql) is DRAFTED-not-
--    applied and it needs ai-engineer P12 (AI safety) review before any flip.
--    This migration does NOT touch it; it stays OFF / unseeded.
--
-- ─── Column shape / REG-125 conformance ──────────────────────────────────────
-- Mirrors the canonical feature_flags shape used by every prior seed migration
-- (flag_name / is_enabled / rollout_percentage / target_* / created_at /
-- updated_at — NOT name/enabled). Each statement is an idempotent UPSERT with an
-- EXPLICIT column list whose first column is `flag_name`, and resolves conflicts
-- on the canonical unique key `feature_flags_flag_name_key` via
-- `ON CONFLICT (flag_name) DO UPDATE`. This satisfies the REG-125 seed-shape
-- conformance canary (src/__tests__/regressions/reg-125-feature-flags-insert-
-- shape.test.ts): every root-migration INSERT INTO feature_flags carries an
-- explicit column list that includes flag_name, and NO insert uses the broken
-- `ON CONFLICT (name)` target. (REG-125's stricter "no DO UPDATE / no true
-- literal" pins are scoped ONLY to 20260606000000_phase5_phase6_python_flags.sql,
-- the rewritten file — they do not apply to other migrations, so the enabling
-- DO UPDATE + is_enabled=true here is in-policy.)
--
-- UPSERT (not a bare UPDATE) is deliberate: three of these five flags
-- (ff_teacher_command_center, ff_school_command_center, ff_school_reports_depth)
-- were never seeded by any migration (they resolved to OFF by absence). A bare
-- UPDATE would no-op on those rows and silently fail to enable them. The upsert
-- creates the row enabled if absent, or flips is_enabled=true (clearing the
-- rollout/scoping double-gate) if present. Replayable: re-running re-asserts the
-- ON state.
--
-- Scoping: rollout_percentage = 100, target_* = NULL → enabled GLOBALLY for ALL
-- tenants on apply. Per-tenant pilot scoping IS supported by the flag evaluator
-- (isFeatureEnabled honours target_institutions; src/lib/feature-flags.ts ~line
-- 126), and the billing route already evaluates the flag per-school with
-- { institutionId }. For the HIGH-RISK billing flag specifically, the runbook
-- (docs/runbooks/2026-06-16-phase3-billing-flag-rollout.md) recommends overriding
-- this global enable with a pilot-school target_institutions scoping FIRST
-- (staging -> 1-2 pilot schools -> GA) rather than shipping it global on deploy.
-- The 4 non-payment flags gate already-built UI/RBAC depth and are safe global.
--
-- ─── Audit trail ─────────────────────────────────────────────────────────────
-- Flag changes are auditable: the row's updated_at is stamped now() on every
-- apply, and the change is captured in the migration history (this file) and the
-- staged-rollout runbook operator notes. Subsequent operator flips via the
-- super-admin Flags console route through the audited mutation path.
--
-- Additive. Idempotent. Replayable. No DROP. No DDL. No new tables → RLS N/A;
-- feature_flags keeps its existing baseline RLS posture. Guarded so it no-ops
-- cleanly on a fresh DB where feature_flags does not yet exist.
--
-- Owner: ops (flag enablement decision + runbook) with architect + backend
--        (P11 billing certification, monthly-only). CEO-approved.
-- Added: 2026-06-16
--
-- ─── Reversible (instant rollback) ───────────────────────────────────────────
--   UPDATE feature_flags SET is_enabled = false, updated_at = now()
--   WHERE flag_name IN (
--     'ff_school_self_service_billing_v1','ff_school_admin_rbac',
--     'ff_teacher_command_center','ff_school_command_center',
--     'ff_school_reports_depth'
--   );

DO $phase3_enable$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- 1. School self-service billing (P11-certified, MONTHLY only).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_school_self_service_billing_v1', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = true,
          rollout_percentage = 100,
          updated_at = now();

    -- 2. School-admin role-aware RBAC (staff / sub-admin delegation).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_school_admin_rbac', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = true,
          rollout_percentage = 100,
          updated_at = now();

    -- 3. Teacher Command Center (built teacher home + slimmed nav).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_teacher_command_center', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = true,
          rollout_percentage = 100,
          updated_at = now();

    -- 4. School Command Center (built principal/admin home + consolidated nav).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_school_command_center', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = true,
          rollout_percentage = 100,
          updated_at = now();

    -- 5. School reports depth (built deep mastery/Bloom reports + export).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_school_reports_depth', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = true,
          rollout_percentage = 100,
          updated_at = now();

    -- NOTE: ff_principal_ai_v1 is INTENTIONALLY untouched (separate track —
    -- drafted migration + ai-engineer P12 review pending).

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Phase 3 enablement (fresh DB).';
  END IF;
END $phase3_enable$;
