-- Migration: 20260623010000_seed_unseeded_b2b_flags.sql
-- Purpose: PHASE 0 ("Trust the substrate") — seed the SIX B2B feature flags that
--          are referenced in application code but have NO row in
--          public.feature_flags, so they cannot be inspected or toggled from the
--          super-admin Flags console today. Seeding the rows makes each flag
--          AUDITABLE + FLIPPABLE; it does NOT change behavior. ALL six are seeded
--          in the DISABLED state (is_enabled = FALSE, rollout_percentage = 0).
--
-- ─── WHY (ops B2B-activation RCA, 2026-06-23) ─────────────────────────────────
-- The ops RCA found ~15 B2B flags claimed "unseeded". Verification against the
-- migration set (every `INSERT INTO public.feature_flags` block + the
-- 20260620000400 phase3_enable + 20260615000000 phase3c + 20260619000100 pulse
-- seeds) showed MOST of the claimed candidates are ALREADY seeded:
--     ALREADY SEEDED (do NOT re-seed here — would be redundant / risk drift):
--       ff_school_command_center       (20260620000400, enabled in prod)
--       ff_school_reports_depth        (20260620000400, enabled in prod)
--       ff_teacher_command_center      (20260620000400 / 20260620001601)
--       ff_school_admin_rbac           (20260611000100 OFF seed + 20260620000400)
--       ff_school_pulse_v1             (20260619000100, OFF)
--       ff_tenant_type_v1              (20260507000004 / 20260615000000)
--       ff_tenant_module_registry_v1   (20260615000000)
--       ff_tenant_config_v2            (20260615000000)
--       ff_event_bus_v1                (20260507000007 / 20260615000000)
--       ff_institution_entitlements_v1 (20260615205753)
--       ff_school_contracts_v1         (20260507150002)
--       ff_school_self_service_billing_v1 (20260507000002 / 20260620000400)
--
-- GENUINELY UNSEEDED (no INSERT INTO feature_flags anywhere in the migration
-- set; confirmed referenced in code by FLAG_DEFAULTS + the read paths below) —
-- these are the SIX this migration seeds, all OFF:
--   1. ff_school_provisioning           SCHOOL_PROVISIONING_FLAGS.V1
--        Seat-enforcement on school-admin provisioning (enroll/bulk/deactivate/
--        invite). Read server-side via isFeatureEnabled in
--        src/lib/school-admin/seat-enforcement.ts. PAYMENT-ADJACENT (P11): each
--        active student is a billable seat. OFF = byte-identical legacy soft check.
--   2. ff_teacher_assignment_lifecycle  TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS.V1
--        Cross-assignment grading queue inside the Teacher Command Center.
--        Read client-side. OFF = queue button stays a disabled placeholder.
--   3. ff_teacher_gradebook_depth       TEACHER_GRADEBOOK_DEPTH_FLAGS.V1
--        Mastery + Bloom's drill-through / class summary / export on the teacher
--        surfaces. Read client-side. OFF = score matrix only, no depth view.
--   4. ff_teacher_parent_comms          TEACHER_PARENT_COMMS_FLAGS.V1
--        One-tap "Tell the parent" / "Share with parent" affordance. Read
--        client-side. OFF = no affordance rendered, no parent-notify fetch.
--   5. ff_education_intelligence        EDUCATION_INTELLIGENCE_FLAGS.V1
--        Super-admin Education Intelligence Cloud dashboards. Read client-side.
--        OFF = nav group hidden, pages not-found. (Read API stays super-admin
--        gated regardless of the flag.)
--   6. ff_principal_ai_v1               PRINCIPAL_AI_FLAGS.V1
--        School-scoped Principal AI Assistant (POST/GET /api/school-admin/
--        ai-assistant). Read server-side. OFF = routes 404 BEFORE any work.
--        NOTE: the backing migration 20260616010000_principal_ai_assistant_v1.sql
--        is DRAFTED-not-applied; the route degrades gracefully when the context
--        RPC/tables are missing, so seeding the flag OFF here is safe and never
--        500s. AI-engineer P12 review still gates ENABLEMENT (this seed only
--        makes the OFF row visible).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- Every flag is seeded is_enabled = FALSE, rollout_percentage = 0. The read path
-- (isFeatureEnabled in src/lib/feature-flags.ts) returns false for both
-- `is_enabled = false` AND `rollout_percentage <= 0`, so EVERY gated surface stays
-- byte-identical to today until an operator explicitly flips the flag from the
-- super-admin console. FLAG_DEFAULTS already resolves all six to false in code, so
-- this seed simply makes the DB rows match the code default. This migration does
-- NOT flip any flag ON.
--
-- ─── Column shape (REG-125 conformance) ───────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260622090000_seed_ff_adaptive_live_selection_v1.sql,
-- 20260619000100_seed_ff_school_pulse_v1.sql): defensive to_regclass guard +
-- EXPLICIT column list whose first column is `flag_name` + ON CONFLICT
-- (flag_name) DO NOTHING. This satisfies REG-125 (canonical feature_flags shape:
-- flag_name/is_enabled, NOT name/enabled; DO NOTHING, never DO UPDATE). Scoping
-- arrays are NULL (no role/env/institution narrowing) — the global
-- is_enabled=false / rollout=0 double gate is what holds each flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). Each INSERT is additionally guarded
-- so it no-ops cleanly if the feature_flags table does not yet exist (fresh DB /
-- out-of-order apply), so the live-DB CI test and Supabase preview branches never
-- fail. No schema changes. Pure data seed. No new tables → RLS N/A; the table
-- keeps its existing baseline RLS posture (P8 unaffected).
--
-- Owner: architect (this seed) + ops (flip procedure) + ai-engineer (P12 review
--        gate for ff_principal_ai_v1 ENABLEMENT only).
-- Added: 2026-06-23 (B2B activation Phase 0).
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name IN (
--     'ff_school_provisioning', 'ff_teacher_assignment_lifecycle',
--     'ff_teacher_gradebook_depth', 'ff_teacher_parent_comms',
--     'ff_education_intelligence', 'ff_principal_ai_v1'
--   );
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $seed_b2b_flags$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES
      (
        'ff_school_provisioning',
        false,
        0,
        'Seat-enforcement on school-admin provisioning (enroll/bulk-CSV/deactivate/invite). PAYMENT-ADJACENT (P11): each active roster student is a billable seat. When ON, provisioning routes apply the hybrid seat policy via the race-safe seat RPCs; when OFF (default) the legacy seats_purchased soft check is the byte-identical fallback. Read server-side (src/lib/school-admin/seat-enforcement.ts). Default off; staging-first. Code: SCHOOL_PROVISIONING_FLAGS in src/lib/feature-flags.ts.',
        NULL, NULL, NULL, now(), now()
      ),
      (
        'ff_teacher_assignment_lifecycle',
        false,
        0,
        'Cross-assignment grading queue surface inside the Teacher Command Center (layered on top of ff_teacher_command_center). When ON, the today-summary "awaiting grading" badge + an enabled grading-queue surface route to the existing /teacher/submissions flow; when OFF (default) the grading-queue button is a disabled placeholder. Read client-side. Default off. Code: TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS in src/lib/feature-flags.ts.',
        NULL, NULL, NULL, now(), now()
      ),
      (
        'ff_teacher_gradebook_depth',
        false,
        0,
        'Mastery + Bloom''s reporting depth on the teacher surfaces (Command Center drill-through Student Mastery Report + class mastery/Bloom summary + CSV export). When OFF (default) the heatmap cell is a plain navigate link and the gradebook is the score matrix only. Read client-side. Default off. Code: TEACHER_GRADEBOOK_DEPTH_FLAGS in src/lib/feature-flags.ts.',
        NULL, NULL, NULL, now(), now()
      ),
      (
        'ff_teacher_parent_comms',
        false,
        0,
        'One-tap "Tell the parent" / "Share with parent" affordance in the Teacher Command Center + Student Mastery Report panel (layered on top of ff_teacher_command_center). When OFF (default) no affordance is rendered and no parent-notify fetch is issued. Read client-side. Default off. Code: TEACHER_PARENT_COMMS_FLAGS in src/lib/feature-flags.ts.',
        NULL, NULL, NULL, now(), now()
      ),
      (
        'ff_education_intelligence',
        false,
        0,
        'Super-admin Education Intelligence Cloud dashboards (Overview/Schools/Revenue/Geography + per-school drilldown). When OFF (default) the nav group is hidden and the pages render not-found; the read API stays super-admin gated regardless of the flag. Read client-side. Default off. Code: EDUCATION_INTELLIGENCE_FLAGS in src/lib/feature-flags.ts.',
        NULL, NULL, NULL, now(), now()
      ),
      (
        'ff_principal_ai_v1',
        false,
        0,
        'School-scoped Principal AI Assistant (POST/GET /api/school-admin/ai-assistant). Principal-only capability (institution.use_principal_ai, CEO-approved 2026-06-11). When OFF (default) the routes 404 BEFORE any work — byte-identical to flag-absent. Seeding OFF only makes the row auditable; ENABLEMENT is gated on ai-engineer P12 review AND the backing migration 20260616010000_principal_ai_assistant_v1.sql being applied. The route degrades gracefully when the context RPC/tables are missing, so this OFF seed never 500s. Read server-side. Default off. Code: PRINCIPAL_AI_FLAGS in src/lib/feature-flags.ts.',
        NULL, NULL, NULL, now(), now()
      )
    ON CONFLICT (flag_name) DO NOTHING;

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping B2B flag seed (fresh DB).';
  END IF;
END $seed_b2b_flags$;
