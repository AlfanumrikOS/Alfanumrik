-- Migration: 20260809000600_concept_mastery_transfer_evidence.sql
-- Purpose: Foxy North-Star Phase 3 — track TRANSFER evidence on
--   concept_mastery: events where mastery of a topic was evidenced indirectly
--   (a student correctly applied topic X while working in dependent topic Y,
--   per the concept_edges prerequisite graph). Additive columns + a
--   service-role-only recorder RPC. No consumer behavior change in this
--   migration; the Phase-3 orchestrator (TS, ai-engineer/assessment-owned)
--   calls the RPC server-side.
--
-- Schema (additive, style mirrors 20260807000100):
--   * transfer_evidence_count   int NOT NULL DEFAULT 0 — running count.
--   * last_transfer_evidence_at timestamptz NULL       — metadata timestamp
--     of the most recent transfer-evidence event (NULL = never).
--
-- RPC record_transfer_evidence(p_student_id, p_topic_id, p_from_topic_id):
--   upserts the (student, topic) row via the existing UNIQUE
--   concept_mastery_student_id_topic_id_key (baseline :15216) — a transfer
--   event may legitimately precede any direct practice on the topic, so an
--   absent row is created with concept_mastery's own column defaults.
--   Increments the counter, stamps last_transfer_evidence_at + updated_at,
--   and returns jsonb (student_id, topic_id, from_topic_id,
--   transfer_evidence_count, recorded_at) so the caller can log the
--   from-topic provenance into learning_events without a second query
--   (from_topic_id is deliberately NOT a column: one uuid column cannot
--   represent many-source evidence; the event stream is the provenance
--   ledger).
--
-- SECURITY INVOKER justification (required comment): the ONLY grantee is
--   service_role, which bypasses RLS — INVOKER works and is least-privilege:
--   an accidental future grant to a client role would still fail closed under
--   that role's own RLS (students have no INSERT/UPDATE policy on
--   concept_mastery), instead of DEFINER silently escalating a mis-grant
--   into a mastery-tampering hole. Same posture rationale as award_xp_capped
--   (20260809000300). anon/authenticated explicitly revoked because the
--   baseline's default privileges auto-grant new public functions to
--   authenticated.
--
-- RLS: concept_mastery policies are row-scoped (student_id), not
--   column-scoped — additive columns are automatically covered. No RLS change.
-- Idempotent: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE FUNCTION;
--   duplicate_object-guarded CHECK. No DROP.
-- Owner: architect. Reviewers (P14): assessment (mastery semantics),
--   ai-engineer (orchestrator caller), testing, quality. Added: 2026-08-05.

BEGIN;

ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS transfer_evidence_count   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_transfer_evidence_at timestamptz;

DO $transfer_evidence_check$
BEGIN
  ALTER TABLE public.concept_mastery
    ADD CONSTRAINT concept_mastery_transfer_evidence_nonneg
    CHECK (transfer_evidence_count >= 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $transfer_evidence_check$;

COMMENT ON COLUMN public.concept_mastery.transfer_evidence_count IS
  'Phase 3 (20260809000600): count of transfer-evidence events — mastery of '
  'this topic evidenced indirectly from work in a dependent topic (concept_'
  'edges graph). Incremented only by record_transfer_evidence() '
  '(service-role-only).';
COMMENT ON COLUMN public.concept_mastery.last_transfer_evidence_at IS
  'Phase 3 (20260809000600): timestamp of the most recent transfer-evidence '
  'event for this student+topic. NULL = never. Stamped by '
  'record_transfer_evidence().';

CREATE OR REPLACE FUNCTION public.record_transfer_evidence(
  p_student_id    uuid,
  p_topic_id      uuid,
  p_from_topic_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
-- SECURITY INVOKER: service_role-only grantee bypasses RLS; a mis-grant to a
-- client role fails closed under that role's RLS. See header.
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_now   timestamptz := now();
BEGIN
  IF p_student_id IS NULL OR p_topic_id IS NULL OR p_from_topic_id IS NULL THEN
    RAISE EXCEPTION 'record_transfer_evidence: all three arguments are required';
  END IF;
  IF p_from_topic_id = p_topic_id THEN
    RAISE EXCEPTION 'record_transfer_evidence: from_topic must differ from topic (self-transfer is not evidence)';
  END IF;

  INSERT INTO public.concept_mastery (
    student_id, topic_id, transfer_evidence_count, last_transfer_evidence_at, updated_at
  ) VALUES (
    p_student_id, p_topic_id, 1, v_now, v_now
  )
  ON CONFLICT (student_id, topic_id) DO UPDATE
    SET transfer_evidence_count   = concept_mastery.transfer_evidence_count + 1,
        last_transfer_evidence_at = v_now,
        updated_at                = v_now
  RETURNING transfer_evidence_count INTO v_count;

  RETURN jsonb_build_object(
    'success',                 true,
    'student_id',              p_student_id,
    'topic_id',                p_topic_id,
    'from_topic_id',           p_from_topic_id,
    'transfer_evidence_count', v_count,
    'recorded_at',             v_now
  );
END;
$$;

COMMENT ON FUNCTION public.record_transfer_evidence(uuid, uuid, uuid) IS
  'Phase 3 (20260809000600): records one transfer-evidence event — mastery '
  'of p_topic_id evidenced indirectly from correct work in dependent '
  'p_from_topic_id. Upserts the concept_mastery row (unique student_id+'
  'topic_id), increments transfer_evidence_count, stamps '
  'last_transfer_evidence_at/updated_at, returns provenance jsonb for the '
  'caller''s event log. SECURITY INVOKER; EXECUTE granted to service_role '
  'ONLY.';

-- Grants: service_role ONLY (strip the default-privileges authenticated grant).
REVOKE ALL ON FUNCTION public.record_transfer_evidence(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_transfer_evidence(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_transfer_evidence(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_transfer_evidence(uuid, uuid, uuid) TO service_role;

COMMIT;
