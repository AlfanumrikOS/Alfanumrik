-- supabase/migrations/20260415000007_subject_governance_enable.sql
-- Phase F3 — Subject Governance: enable enforcement
--
-- What it does:
--   1. Pre-check: raises a loud exception if question_bank has rows whose
--      subject column is not present in subjects.code. This gates the FK
--      VALIDATE below and prevents a silent partial-failure state.
--   2. Runs ALTER TABLE question_bank VALIDATE CONSTRAINT question_bank_subject_fk
--      to promote the NOT VALID FK (added in Phase A) to a validated one.
--   3. Enables trigger trg_enforce_subject_enrollment on
--      student_subject_enrollment (created DISABLED in migration
--      20260415000003).
--   4. Writes an audit row and an ops_events entry so the flip is visible
--      in the observability console.
--
-- Idempotency:
--   Safe to re-run. VALIDATE CONSTRAINT on an already-validated FK is a
--   no-op. Enabling an already-enabled trigger is a no-op. The audit/event
--   inserts will add a new "enforcement_enabled" row on each run — this is
--   intentional (a replay signals an operator re-ran the gate).
--
-- Expected runtime on a 10K-student DB:
--   ~5 seconds. VALIDATE scans question_bank (dominant cost), trigger
--   enable is instantaneous.
--
-- Rollback:
--   BEGIN;
--     ALTER TABLE student_subject_enrollment
--       DISABLE TRIGGER trg_enforce_subject_enrollment;
--     ALTER TABLE question_bank DROP CONSTRAINT question_bank_subject_fk;
--     -- then re-add as NOT VALID to preserve Phase A state:
--     ALTER TABLE question_bank
--       ADD CONSTRAINT question_bank_subject_fk
--       FOREIGN KEY (subject) REFERENCES subjects(code) ON UPDATE CASCADE NOT VALID;
--     INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
--     VALUES (NULL, 'subject.governance.enforcement_rolled_back', 'system', NULL,
--             jsonb_build_object('rolled_back_at', now()), now());
--   COMMIT;

BEGIN;

-- Pre-check: surface bad question_bank rows so a human can fix them
-- before VALIDATE locks the table.
DO $$
DECLARE
  bad_count    INT;
  sample_codes TEXT[];
BEGIN
  SELECT COUNT(*), ARRAY_AGG(DISTINCT subject)
    INTO bad_count, sample_codes
    FROM (
      SELECT qb.subject
        FROM question_bank qb
       WHERE qb.subject IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM subjects s WHERE s.code = qb.subject)
       LIMIT 100
    ) sub;

  IF COALESCE(bad_count, 0) > 0 THEN
    RAISE EXCEPTION
      'question_bank has % rows with subject NOT IN subjects.code. Sample codes: %. Fix or rename these subjects before running this migration. Suggested remediation: UPDATE question_bank SET subject = ''math'' WHERE subject = ''Math''; -- repeat per invalid code. Re-run this migration once question_bank is clean.',
      bad_count, sample_codes;
  END IF;
END $$;

-- Validate the FK now that data is clean.
ALTER TABLE question_bank VALIDATE CONSTRAINT question_bank_subject_fk;

-- Enable the enforcement trigger (was created DISABLED in Phase A).
ALTER TABLE student_subject_enrollment
  ENABLE TRIGGER trg_enforce_subject_enrollment;

-- Audit
INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'subject.governance.enforcement_enabled',
  'system',
  NULL,
  jsonb_build_object(
    'enabled_at', now(),
    'trigger',    'trg_enforce_subject_enrollment',
    'fk',         'question_bank_subject_fk'
  ),
  now()
);

INSERT INTO ops_events (
  occurred_at, category, source, severity,
  subject_type, subject_id, message, context, environment
)
SELECT
  now(),
  'data-integrity',
  'subject-governance-enable',
  'warning',
  'system',
  NULL,
  'subject.governance.enforcement_enabled',
  jsonb_build_object(
    'enabled_at', now(),
    'trigger',    'trg_enforce_subject_enrollment',
    'fk',         'question_bank_subject_fk'
  ),
  COALESCE(current_setting('app.environment', true), 'production')
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'ops_events'
);

COMMIT;
