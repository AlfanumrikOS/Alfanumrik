-- Migration: 20260814000020_quiz_session_shuffles_answer_key_column_acl.sql
-- Purpose: Stop the `authenticated` role reading the per-session ANSWER KEY out
--          of public.quiz_session_shuffles directly over PostgREST.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE DEFECT (confirmed from source, 2026-08-14)
-- ─────────────────────────────────────────────────────────────────────────────
-- public.quiz_session_shuffles holds the server-owned per-question snapshot that
-- submit_quiz_results_v2 grades against (table COMMENT, baseline:12893). Two of
-- its columns ARE the answer key:
--
--   * correct_answer_index_snapshot INT NOT NULL   (baseline:12885)
--       — literally question_bank.correct_answer_index frozen at serve time.
--   * integrity_hash TEXT NOT NULL                 (20260504100500, populated by
--       start_quiz_session since 20260801100800/100900)
--       — sha256(options_snapshot::text || correct_answer_index::text)
--         (20260801100900:125-128). With options_snapshot readable (it is), this
--         hash is a FOUR-CANDIDATE brute-force oracle for the same key: try
--         0,1,2,3, hash, compare. It leaks exactly as much as the index itself.
--
-- The table has RLS enabled (baseline:21689) with three SELECT policies:
--   quiz_session_shuffles_student_select (baseline:21699) — student's own rows
--   quiz_session_shuffles_parent_select  (rewritten 20260720170000:72-74)
--   quiz_session_shuffles_teacher_select (baseline:21704)
--
-- PostgreSQL RLS is ROW-level only. It cannot restrict COLUMNS. And the baseline
-- pg_dump carries NO per-table GRANT statements — it ends with
--   ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon/authenticated/service_role
-- (baseline:22640-22643), so every table it creates, including this one, hands
-- `anon` and `authenticated` a TABLE-LEVEL ALL privilege. Row visibility is then
-- the ONLY gate. Consequence, in production today:
--
--   GET /rest/v1/quiz_session_shuffles
--       ?select=question_id,correct_answer_index_snapshot,shuffle_map
--       &session_id=eq.<the student's own in-flight session>
--
-- returns the correct answer for every question of a quiz the student has not
-- yet submitted. Any signed-in student with devtools defeats P3 anti-cheat and
-- makes the P1 score meaningless. Parents and teachers (also the `authenticated`
-- DB role) get the same read over their own row scope.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE FIX AND WHY THIS ONE
-- ─────────────────────────────────────────────────────────────────────────────
-- Column-level ACL: revoke the table-level grant from anon + authenticated, then
-- re-grant column-level SELECT on every NON-key column. Rejected alternatives:
--
--   * Drop the student SELECT policy and route reads through a SECURITY DEFINER
--     RPC — larger blast radius (rewrites the live resume/live-state read path in
--     packages/lib/src/state/student-state-builder.ts) for no extra security; the
--     answer key is the only thing that needs hiding, not the rows.
--   * Move the key to a service-role-only side table — a real schema change to
--     the P1 scoring substrate, plus a backfill, under time pressure. It also
--     needs start_quiz_session + submit_quiz_results_v2 + check_quiz_answer +
--     marking_audit_last_30d all repointed in the same transaction. Strictly more
--     risk to P1/P4 than an ACL change that touches no function body.
--   * Column-level REVOKE alone (no table-level revoke first) — a NO-OP. This is
--     the exact trap documented in 20260814000000:29-32: a column REVOKE cannot
--     subtract from a table-level GRANT. The table-level REVOKE below is what
--     makes the column grant authoritative. That earlier note's conclusion was
--     right for question_bank (see RESIDUAL below) but the mechanism is
--     defeatable, and this migration defeats it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NOTHING LEGITIMATE BREAKS (every consumer audited, 2026-08-14)
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER functions run as the function OWNER (postgres), NOT the
-- caller, so caller-role ACLs are irrelevant to them. All three writers/readers
-- of the key are SECURITY DEFINER:
--   * start_quiz_session        (20260801100900:31-32)
--   * submit_quiz_results_v2    (20260809000500:117-118, baseline:7595) — the P1
--                                scoring authority. UNTOUCHED by this migration.
--   * check_quiz_answer         (20260802130000:194-196) — the legitimate
--                                one-question-at-a-time reveal path.
--
-- Service-role readers (bypass RLS, keep full table ALL — untouched here):
--   * apps/host/src/app/api/quiz/session/[sessionId]/progress/route.ts:124,234,361
--     (getSupabaseAdmin() + explicit ownership probe) — Phase 4 resume route.
--   * apps/host/src/app/api/v2/quiz/submit/route.ts:216 (question_id, shuffle_map)
--   * apps/host/src/app/api/whatsapp/_lib/daily6.ts:1054 — the ONLY app-code read
--     of correct_answer_index_snapshot, and it is service-role.
--   * public.marking_audit_last_30d (20260504100400) — SECURITY INVOKER view,
--     already service_role-only GRANT (that migration:120-124), so it keeps
--     working via service_role and stays closed to authenticated.
--
-- The one read path that genuinely runs under the caller's role
-- (packages/lib/src/state/student-state-builder.ts:261, :471) selects only
-- `session_id, question_id, student_answered_at, created_at` and
-- `question_id, student_answered_at` — all re-granted below.
-- packages/lib/src/quiz/resume.ts:83-93 already declares the answer key
-- deliberately absent from its column whitelist. Mobile makes NO direct read of
-- this table (grep of mobile/lib: comments only). So: zero known breakage.
--
-- Writes: authenticated loses INSERT/UPDATE/DELETE here. That is a no-op in
-- practice — the table has NO INSERT/UPDATE/DELETE policy at all, so RLS already
-- denied every non-bypassing write (noted in progress/route.ts:99). This makes
-- the denial explicit at the privilege layer too. A future migration that adds a
-- student write policy MUST also re-GRANT the verb.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RESIDUAL — READ THIS BEFORE CLAIMING THE ANSWER KEY IS CLOSED
-- ─────────────────────────────────────────────────────────────────────────────
-- This migration does NOT make the answer key unreachable by a signed-in
-- student. Finding C2, documented and deliberately deferred in
-- 20260814000000:21-33, is STILL OPEN: policy `question_bank_authenticated_read`
-- (20260728090000:311-312) is `FOR SELECT TO authenticated USING (true)`, and
-- question_bank carries the same baseline table-level ALL grant. So
--   GET /rest/v1/question_bank?select=id,correct_answer_index&id=eq.<question_id>
-- still returns the key for ANY question — a strictly WIDER read than the one
-- closed here (all ~12.8k questions, not just the caller's own session).
-- Closing C2 needs the coordinated application change described in that
-- migration (server-side P6 validation, session-gated question serving, repoint
-- PYQ + mobile pyq_repository.dart:34,50 + quiz_repository.dart:104). This file
-- closes the session-scoped vector and removes the brute-forcible hash oracle;
-- it is defense in depth, not the end of the story.
--
-- IDEMPOTENT: REVOKE/GRANT/COMMENT are replay-safe. No DDL, no DROP, no function
-- body change, no RLS policy change. P1/P4 behaviour is bit-for-bit unchanged.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Remove the baseline default-privileges table-level grant.
--    This is the step that makes column-level grants authoritative.
-- ──────────────────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.quiz_session_shuffles FROM PUBLIC;
REVOKE ALL ON TABLE public.quiz_session_shuffles FROM anon;
REVOKE ALL ON TABLE public.quiz_session_shuffles FROM authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Re-grant column-level SELECT to `authenticated` on the NON-key columns.
--
--    Deliberately an ALLOWLIST spelled out as a LITERAL, not computed and not a
--    denylist. Two reasons: (a) a column added by a future migration is NOT
--    granted by default, so a future answer-key-shaped column fails CLOSED
--    rather than silently inheriting a read grant; (b) a security-critical ACL
--    must be auditable by reading this file, and assertable from the SQL AST by
--    the companion regression test — a dynamic EXECUTE format() would hide it
--    inside an opaque string literal.
--
--    Every column of quiz_session_shuffles as of this migration EXCEPT
--    correct_answer_index_snapshot and integrity_hash. If a column here does not
--    exist on the target DB the GRANT errors and the whole transaction rolls
--    back — loud failure is correct for a chain-order drift on a security ACL.
--
--    `anon` is granted NOTHING: all three RLS policies key off auth.uid(), which
--    is NULL for anon, so anon could never see a row anyway.
-- ──────────────────────────────────────────────────────────────────────────
GRANT SELECT (
  session_id,
  question_id,
  student_id,
  shuffle_map,
  options_snapshot,
  options_version_at_serve,
  created_at,
  student_selected_displayed_index,
  student_time_spent_seconds,
  student_answered_at
) ON TABLE public.quiz_session_shuffles TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Belt-and-braces: explicitly strip any pre-existing COLUMN-level grant on
--    the two key columns. A no-op after step 1 on a clean environment; it
--    matters on an environment where someone previously ran a column GRANT.
-- ──────────────────────────────────────────────────────────────────────────
REVOKE SELECT (correct_answer_index_snapshot, integrity_hash)
  ON TABLE public.quiz_session_shuffles FROM anon;
REVOKE SELECT (correct_answer_index_snapshot, integrity_hash)
  ON TABLE public.quiz_session_shuffles FROM authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Self-verifying post-conditions. If any of these fire the whole
--    transaction rolls back — the migration cannot half-apply and leave either
--    a still-leaking table or a broken read path.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_key_cols TEXT[] := ARRAY['correct_answer_index_snapshot', 'integrity_hash'];
  v_open_cols TEXT[] := ARRAY[
    'session_id', 'question_id', 'student_id', 'shuffle_map', 'options_snapshot',
    'created_at', 'student_selected_displayed_index',
    'student_time_spent_seconds', 'student_answered_at'
  ];
  c TEXT;
BEGIN
  -- 4a. Neither client role may read the answer key.
  FOREACH c IN ARRAY v_key_cols LOOP
    IF has_column_privilege('authenticated', 'public.quiz_session_shuffles', c, 'SELECT') THEN
      RAISE EXCEPTION
        'POST-CONDITION FAILED: role authenticated can still SELECT quiz_session_shuffles.%', c;
    END IF;
    IF has_column_privilege('anon', 'public.quiz_session_shuffles', c, 'SELECT') THEN
      RAISE EXCEPTION
        'POST-CONDITION FAILED: role anon can still SELECT quiz_session_shuffles.%', c;
    END IF;

    -- 4b. Server-side scoring / forensics MUST retain the key.
    IF NOT has_column_privilege('service_role', 'public.quiz_session_shuffles', c, 'SELECT') THEN
      RAISE EXCEPTION
        'POST-CONDITION FAILED: role service_role LOST SELECT on quiz_session_shuffles.% — the WhatsApp grader and marking_audit_last_30d would break', c;
    END IF;
  END LOOP;

  -- 4c. The legitimate resume / live-state read path MUST survive.
  FOREACH c IN ARRAY v_open_cols LOOP
    IF NOT has_column_privilege('authenticated', 'public.quiz_session_shuffles', c, 'SELECT') THEN
      RAISE EXCEPTION
        'POST-CONDITION FAILED: authenticated lost SELECT on non-key column quiz_session_shuffles.% — the resume path (student-state-builder) would break', c;
    END IF;
  END LOOP;

  -- 4d. No client-role writes. RLS already denied these; the privilege layer
  --     now agrees.
  IF has_table_privilege('authenticated', 'public.quiz_session_shuffles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.quiz_session_shuffles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.quiz_session_shuffles', 'DELETE') THEN
    RAISE EXCEPTION
      'POST-CONDITION FAILED: authenticated retains a write privilege on quiz_session_shuffles';
  END IF;

  -- 4e. anon must hold nothing at all on this table.
  IF has_any_column_privilege('anon', 'public.quiz_session_shuffles', 'SELECT') THEN
    RAISE EXCEPTION
      'POST-CONDITION FAILED: anon retains a SELECT privilege on quiz_session_shuffles';
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Record the boundary on the objects themselves.
-- ──────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.quiz_session_shuffles.correct_answer_index_snapshot IS
  'Integer 0..3 snapshot of question_bank.correct_answer_index at quiz session '
  'start. submit_quiz_results_v2 compares against THIS, not the live '
  'question_bank value. ACL (migration 20260814000020): service_role + owner '
  'ONLY. anon and authenticated hold NO SELECT on this column — RLS is '
  'row-level and cannot hide a column, so the table-level grant from the '
  'baseline default privileges was revoked and re-granted column-wise. Do NOT '
  're-add a table-level GRANT SELECT to authenticated; that silently reopens '
  'the in-flight answer-key read.';

COMMENT ON COLUMN public.quiz_session_shuffles.integrity_hash IS
  'SHA256 hex of options_snapshot::text || correct_answer_index_snapshot::text, '
  'written by start_quiz_session (20260801100900) and verified server-side. '
  'ACL (migration 20260814000020): service_role + owner ONLY, for the same '
  'reason as correct_answer_index_snapshot — because options_snapshot IS '
  'readable by the student, this hash is a 4-candidate brute-force oracle for '
  'the answer key and must never be exposed to a client role.';

COMMENT ON TABLE public.quiz_session_shuffles IS
  'Server-owned per-question shuffle snapshot for quiz sessions started via '
  'start_quiz_session(). Closes the P1+P6 drift bug where a client-derived '
  'stable shuffle could mismatch a later question_bank content edit. '
  'submit_quiz_results_v2 reads from here, NEVER from the live question_bank, '
  'when re-deriving is_correct. See migration 20260428160000 for full threat '
  'model. ACL (migration 20260814000020): the two answer-key columns '
  '(correct_answer_index_snapshot, integrity_hash) are service_role/owner only; '
  'authenticated holds column-level SELECT on the remaining columns and no '
  'write verb; anon holds nothing. RESIDUAL: question_bank.correct_answer_index '
  'remains readable by authenticated (finding C2, 20260814000000) — that wider '
  'vector is NOT closed by this migration.';

COMMIT;

-- Rollback (compensating, if ever needed — reopens the leak, do not run
-- casually):
--   GRANT ALL ON TABLE public.quiz_session_shuffles TO authenticated;
--   GRANT ALL ON TABLE public.quiz_session_shuffles TO anon;
--
-- Tables touched:    public.quiz_session_shuffles (ACL + COMMENTs only)
-- Columns added:     none
-- Columns dropped:   none
-- Functions changed: none
-- RLS policies:      unchanged (3 SELECT policies survive verbatim)
