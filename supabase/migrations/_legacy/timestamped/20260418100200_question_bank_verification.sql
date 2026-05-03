-- supabase/migrations/20260418100200_question_bank_verification.sql

ALTER TABLE question_bank
  ADD COLUMN IF NOT EXISTS verified_against_ncert boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'legacy_unverified'
    CHECK (verification_state IN ('legacy_unverified','pending','verified','failed')),
  ADD COLUMN IF NOT EXISTS verification_claimed_by text,
  ADD COLUMN IF NOT EXISTS verification_claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS verifier_chunk_ids uuid[],
  ADD COLUMN IF NOT EXISTS verifier_model text,
  ADD COLUMN IF NOT EXISTS verifier_trace_id uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verifier_failure_reason text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_question_bank_verified
  ON question_bank (grade, subject, chapter_number)
  WHERE verified_against_ncert = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_question_bank_verification_queue
  ON question_bank (created_at)
  WHERE verification_state IN ('legacy_unverified','pending');

COMMENT ON COLUMN question_bank.verification_state IS
  'State machine: legacy_unverified (never checked) → pending (claimed by verifier) '
  '→ verified (proven by NCERT chunks) OR failed (verifier disagreed). '
  'See spec §5.3.';