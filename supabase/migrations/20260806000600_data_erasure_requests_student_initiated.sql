-- Migration: 20260806000600_data_erasure_requests_student_initiated.sql
-- Purpose: Foxy North-Star Phase 1 (approval A3) — allow STUDENT-INITIATED
--          scoped memory-erasure requests by relaxing the NOT NULL constraint
--          on public.data_erasure_requests.guardian_id.
--
-- ─── Semantics ────────────────────────────────────────────────────────────────
--   guardian_id NOT NULL  -> parent-initiated FULL-ACCOUNT erasure (the
--                            original 20260527000006 DPDP flow). Unchanged.
--   guardian_id NULL      -> student-initiated SCOPED erasure (A3): the
--                            /api/learner/memory DELETE route inserts
--                            { guardian_id: null, scope: {...} } via the
--                            service-role client. Without this migration that
--                            insert fails at runtime with 23502.
--
-- ─── guardian_id non-null-assumption audit (2026-08-05, architect) ────────────
--   Every existing reference to guardian_id on this table was checked; all are
--   NULL-safe, so NO compensating policy/function change is needed:
--   * No CHECK constraint references guardian_id.
--   * RLS "guardian_sees_own_erasure_requests" (20260527000006): predicate
--     `guardian_id IN (SELECT id FROM guardians ...)` — NULL never matches, so
--     student-initiated rows are simply invisible to guardians. Correct:
--     students read their scoped-request state through /api/learner/memory
--     (service role), never via direct table RLS.
--   * RLS "school_admin_sees_school_erasure_requests": keys on school_id only.
--   * parent_request_child_erasure / parent_cancel_child_erasure /
--     parent-erasure status RPC (20260710040000 / 20260710120000): all filter
--     `der.guardian_id = v_guardian.id` — NULL rows never match, so a guardian
--     can neither see nor cancel a student's scoped request (intended; the
--     student flow is self-service).
--   * insert_data_erasure_audit_event (20260618090000): jsonb_build_object
--     with a NULL guardian_id serializes as JSON null. Fine.
--   * idx_data_erasure_requests_guardian_id: b-tree handles NULLs.
--
-- Idempotent: DROP NOT NULL is a no-op when the column is already nullable.
-- ADDITIVE ONLY: no RLS/policy/index change; the guardian full-account flow is
-- byte-for-byte unchanged.
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (T2 student self-access DPDP entry; approval A3 APPROVED 2026-08-05).
-- Owner: architect. Added: 2026-08-05.

ALTER TABLE public.data_erasure_requests
  ALTER COLUMN guardian_id DROP NOT NULL;

COMMENT ON COLUMN public.data_erasure_requests.guardian_id IS
  'Requesting guardian for the parent-initiated full-account DPDP flow (20260527000006). NULL = student-initiated SCOPED erasure request (Foxy North-Star Phase 1, approval A3) written by /api/learner/memory DELETE with a non-null scope JSONB; the full-account guardian flow is unchanged. Soft FK (no CASCADE) so the audit trail survives guardian purge.';
