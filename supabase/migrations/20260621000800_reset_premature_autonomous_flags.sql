-- Migration: 20260621000800_reset_premature_autonomous_flags.sql
-- Purpose: RCA 2026-06-21 — reset three feature flags that are is_enabled = true
--          in production but were seeded OFF per the product constitution and their
--          own seed migrations (20260619000300, 20260619000600, 20260619000100).
--          These unvalidated beta loops are running on all 37 production students.
--
-- Flags reset:
--   ff_adaptive_remediation_v1  (seed: 20260619000300, seeded OFF)
--   ff_adaptive_loops_bc_v1     (seed: 20260619000600, seeded OFF)
--   ff_school_pulse_v1          (seed: 20260619000100, seeded OFF)
--
-- Safety note per REG-131: the Loops B & C verify/drain path continues to drain
-- ACTIVE rows regardless of the flag. Resetting the flag prevents new rows from
-- being injected but does NOT freeze existing active interventions. This is the
-- intended safe-state behaviour.
--
-- Idempotent: WHERE is_enabled = true guard means re-runs are a no-op.

BEGIN;

UPDATE public.feature_flags
SET    is_enabled  = false,
       updated_at  = now()
WHERE  flag_name IN (
         'ff_adaptive_remediation_v1',
         'ff_adaptive_loops_bc_v1',
         'ff_school_pulse_v1'
       )
  AND  is_enabled = true;

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'feature_flags.premature_autonomous_flags_reset',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'flags_reset', jsonb_build_array(
      'ff_adaptive_remediation_v1',
      'ff_adaptive_loops_bc_v1',
      'ff_school_pulse_v1'
    ),
    'reason', 'flags were enabled prematurely before feature validation; seeded OFF per constitution; reset to OFF per RCA 2026-06-21',
    'rca', '2026-06-21'
  ),
  now()
);

COMMIT;
