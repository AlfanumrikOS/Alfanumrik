-- Migration: 20260418101100_claim_verification_batch_rpc.sql
-- Purpose: Atomic claim RPC that the verify-question-bank Edge Function calls
-- to atomically grab a batch of legacy_unverified / stale-pending rows and
-- mark them pending with a TTL'd claim token. See spec §8.3.
--
-- Contract:
--   - Grabs rows with verification_state = 'legacy_unverified' OR rows where
--     the previous claim expired (state = 'pending' AND claim_expires_at < now()).
--   - FOR UPDATE SKIP LOCKED prevents two concurrent verifier runs from
--     claiming the same row (safe with multiple Supabase cron invocations).
--   - Sets verification_state='pending' atomically with claim token +
--     expiry so the row is only visible to the claiming worker.
--   - Service role only — this is called from the Edge Function with the
--     service-role key. No student-facing callers.

CREATE OR REPLACE FUNCTION claim_verification_batch(
  p_batch_size int,
  p_claimed_by text,
  p_claim_ttl_seconds int
) RETURNS SETOF question_bank
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE question_bank
  SET verification_state = 'pending',
      verification_claimed_by = p_claimed_by,
      verification_claim_expires_at = now() + (p_claim_ttl_seconds || ' seconds')::interval
  WHERE id IN (
    SELECT id FROM question_bank
    WHERE verification_state = 'legacy_unverified'
       OR (verification_state = 'pending'
           AND verification_claim_expires_at < now())
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION claim_verification_batch(int, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_verification_batch(int, text, int) TO service_role;

COMMENT ON FUNCTION claim_verification_batch(int, text, int) IS
  'Atomic claim for retroactive question verification. Returns rows newly '
  'marked pending with a TTL. Re-claims stale pending rows whose expiry has '
  'passed. SKIP LOCKED makes it safe under concurrent Edge Function runs. '
  'See spec §8.3.';