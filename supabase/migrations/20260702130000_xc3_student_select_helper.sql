-- Migration: 20260702130000_xc3_student_select_helper.sql
-- Purpose: XC-3 Phase drain — refactor the _student_select policies on
--          public.learner_twin_snapshots and public.learner_twin_memory from scalar
--          subqueries to a plain call to the EXISTING baseline helper
--          public.get_my_student_id(), closing the last 2 entries in
--          GRANDFATHERED_INLINE_POLICIES for these tables. Ledger: 236 → 234.
--
-- ─── Background ─────────────────────────────────────────────────────────────────
-- Migration 20260702110000 fixed 4 of 6 XC-3 RS-RULE violations on the Digital Twin
-- tables by delegating _parent_select and _teacher_select policies to the existing
-- SECURITY DEFINER helpers is_guardian_of() and is_teacher_of(). For _student_select
-- on both tables it converted the original IN(SELECT id FROM students …) form to a
-- scalar subquery:
--
--   student_id = (
--     SELECT id FROM public.students
--     WHERE auth_user_id = auth.uid()
--     LIMIT 1
--   )
--
-- The scalar form carries no multi-row JOIN, so it has no active recursion risk
-- (students does not reference learner_twin_* back). However the predicate still
-- contains the literal token "FROM public.students" — a different RLS-enabled table —
-- so the XC-3 static detector (rls-no-cross-table-recursion.test.ts) continues to
-- flag both policies and their GRANDFATHERED_INLINE_POLICIES entries remain live.
--
-- This migration closes the remaining 2 entries by rewriting both policies so their
-- USING predicates delegate to public.get_my_student_id() instead of running the
-- scalar subquery inline.
--
-- ─── Why reuse public.get_my_student_id() instead of a new helper ───────────────
-- An earlier draft of this migration minted a brand-new SECURITY DEFINER helper,
-- public.current_student_id(), that duplicated an already-existing baseline helper
-- byte-for-byte. Architect review rejected that draft: public.get_my_student_id()
-- already exists in 00000000000000_baseline_from_prod.sql (lines 8979-8986), is
-- STABLE + SECURITY DEFINER + SET search_path = public, runs the identical
-- `SELECT id FROM students WHERE auth_user_id = auth.uid() AND is_active = true
-- LIMIT 1`, and is already relied on by the RLS policies of adaptive_mastery,
-- foxy_chat_messages, foxy_sessions, ai_interaction_logs, adaptive_profile, and
-- student_baselines. It is also already exempted from the PUBLIC-execute revoke
-- sweep in 20260516050000_revoke_execute_from_public_corrective.sql, so no grant
-- changes are needed here. This revision reuses that established helper rather than
-- introducing a second, functionally-identical one.
--
-- ─── SECURITY DEFINER justification (required per architect rules) ───────────────
-- public.students is an RLS-enabled table. A scalar subquery over it inside a policy
-- USING clause runs as SECURITY INVOKER: every policy check re-enters the students
-- RLS evaluator. This is the scalar-subquery variant of the TSB-4 cross-table
-- recursion risk. public.get_my_student_id() is SECURITY DEFINER, so it bypasses RLS
-- on its inner read — it executes once as the function owner, returns a plain uuid,
-- and the calling policy predicate becomes:
--
--   student_id = <uuid constant>      ← no FROM/JOIN anywhere in the predicate
--
-- STABLE + SET search_path = public scope the helper safely (as already established
-- for its other six call sites): it reads no mutable state, cannot be confused by
-- schema-search injection, and its is_active = true filter is a tightening relative
-- to the bare scalar-subquery form introduced by 20260702110000 (which had no
-- is_active check). This tightening is confirmed inert for current readers of these
-- two tables: the only non-RLS readers of learner_twin_snapshots / learner_twin_memory
-- are service-role callers, which bypass RLS entirely and never invoke this helper.
--
-- ─── Safety properties ──────────────────────────────────────────────────────────
--   * Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY. Safe to re-apply
--     on any environment. No function is created or altered by this migration.
--   * Boundary: the reused helper resolves the same student id as the scalar
--     subquery it replaces, with the additional is_active = true tightening already
--     established at its other six call sites — a security hardening, not an
--     over-grant.
--   * No destructive DDL: no DROP TABLE / DROP COLUMN.
--   * No new tables, columns, or functions.
--   * Additive: touches only the 2 named SELECT policies.
--   * Rollback: re-run 20260702110000 to restore the scalar-subquery forms (NOT
--     recommended — restores the static detector flags; is_active guard is lost).

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. TABLE: public.learner_twin_snapshots — student_select policy
-- ═════════════════════════════════════════════════════════════════════════════════

-- XC-3 drain: replace the scalar subquery introduced by 20260702110000 with a call
-- to the existing public.get_my_student_id() helper. The USING predicate
-- (student_id = public.get_my_student_id()) contains no FROM/JOIN over any external
-- table → no longer flagged by the static detector.
-- GRANDFATHERED_INLINE_POLICIES entry pruned: 236 → 235.
DROP POLICY IF EXISTS learner_twin_snapshots_student_select
  ON public.learner_twin_snapshots;

CREATE POLICY learner_twin_snapshots_student_select
  ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING ( student_id = public.get_my_student_id() );

COMMENT ON POLICY learner_twin_snapshots_student_select
  ON public.learner_twin_snapshots IS
  'XC-3 drain (20260702130000). Student reads own snapshots. '
  'Delegates to the EXISTING baseline SECURITY DEFINER helper '
  'public.get_my_student_id() (00000000000000_baseline_from_prod.sql:8979-8986; '
  'already used by adaptive_mastery, foxy_chat_messages, foxy_sessions, '
  'ai_interaction_logs, adaptive_profile, and student_baselines policies; already '
  'exempted from the PUBLIC-execute revoke sweep in '
  '20260516050000_revoke_execute_from_public_corrective.sql) instead of the scalar '
  'subquery (= (SELECT id FROM public.students WHERE auth_user_id = auth.uid() '
  'LIMIT 1)) introduced by 20260702110000. The helper bypasses RLS on its inner '
  'students read so the scalar-subquery recursion risk is eliminated, and its '
  'is_active = true filter tightens access vs. the bare scalar-subquery form '
  '(confirmed inert for current readers — the only non-RLS readers of this table '
  'use the service role). Policy predicate carries no FROM/JOIN → passes the XC-3 '
  'static guard (closes the learner_twin_snapshots GRANDFATHERED_INLINE_POLICIES '
  'entry).';

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. TABLE: public.learner_twin_memory — student_select policy
-- ═════════════════════════════════════════════════════════════════════════════════

-- Same drain as above. GRANDFATHERED_INLINE_POLICIES entry pruned: 235 → 234.
DROP POLICY IF EXISTS learner_twin_memory_student_select
  ON public.learner_twin_memory;

CREATE POLICY learner_twin_memory_student_select
  ON public.learner_twin_memory
  FOR SELECT TO authenticated
  USING ( student_id = public.get_my_student_id() );

COMMENT ON POLICY learner_twin_memory_student_select
  ON public.learner_twin_memory IS
  'XC-3 drain (20260702130000). Student reads own memory rows. '
  'Delegates to the EXISTING baseline SECURITY DEFINER helper '
  'public.get_my_student_id() (00000000000000_baseline_from_prod.sql:8979-8986; '
  'already used by adaptive_mastery, foxy_chat_messages, foxy_sessions, '
  'ai_interaction_logs, adaptive_profile, and student_baselines policies; already '
  'exempted from the PUBLIC-execute revoke sweep in '
  '20260516050000_revoke_execute_from_public_corrective.sql) instead of the scalar '
  'subquery (= (SELECT id FROM public.students WHERE auth_user_id = auth.uid() '
  'LIMIT 1)) introduced by 20260702110000. The helper bypasses RLS on its inner '
  'students read so the scalar-subquery recursion risk is eliminated, and its '
  'is_active = true filter tightens access vs. the bare scalar-subquery form '
  '(confirmed inert for current readers — the only non-RLS readers of this table '
  'use the service role). Policy predicate carries no FROM/JOIN → passes the XC-3 '
  'static guard (closes the learner_twin_memory GRANDFATHERED_INLINE_POLICIES '
  'entry).';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────────
-- 1. Active student session sees own rows on both tables:
--      SET role authenticated; SET request.jwt.claims TO '{"sub":"<student-auth-uid>"}';
--      SELECT count(*) FROM public.learner_twin_snapshots;  -- own rows only
--      SELECT count(*) FROM public.learner_twin_memory;     -- own rows only
--
-- 2. Inactive student (is_active = false) session sees 0 rows (is_active tightening,
--    inherited unchanged from public.get_my_student_id()).
--
-- 3. No infinite-recursion error on any authenticated query.
--
-- 4. npx vitest run src/__tests__/rls-no-cross-table-recursion.test.ts
--    → 0 offenders, GRANDFATHERED_INLINE_POLICIES.size === 234, RLS_HELPERS.length
--    stays 11 (no roster change — public.get_my_student_id() is already registered).
