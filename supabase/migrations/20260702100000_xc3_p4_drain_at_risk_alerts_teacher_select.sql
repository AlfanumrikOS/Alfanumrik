-- Migration: 20260702100000_xc3_p4_drain_at_risk_alerts_teacher_select.sql
-- Purpose: XC-3 Phase 4 — FIRST drain slice of the remaining grandfathered
--          inline-subquery RLS policies (plan
--          docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md
--          §4 Phase 4: "refactor remaining grandfathered inline-subquery policies,
--          table by table, so the allowlist shrinks toward zero"). Refactors the
--          policy "Teachers see own at-risk alerts" ON public.at_risk_alerts from an
--          inline FROM public.teachers subquery to the EXISTING SECURITY DEFINER
--          helper public.get_my_teacher_id(), per the binding RS-RULE: no policy may
--          inline a FROM/JOIN over a DIFFERENT RLS-enabled table in its USING /
--          WITH CHECK; cross-table identity must delegate to a SECURITY DEFINER helper
--          whose inner reads bypass RLS. Ratchets the recursion-guard ledger 241 → 240.
--
-- ─── What this closes (the inline edge) ──────────────────────────────────────
-- The baseline policy (00000000000000_baseline_from_prod.sql:20252):
--
--   CREATE POLICY "Teachers see own at-risk alerts" ON public.at_risk_alerts
--     USING ( teacher_id IN ( SELECT teachers.id
--                             FROM public.teachers
--                             WHERE teachers.auth_user_id = auth.uid() ) );
--
-- INLINES a SECURITY-INVOKER subquery over public.teachers (a different RLS-enabled
-- table) directly inside a policy ON public.at_risk_alerts. It is one of the 241
-- grandfathered latent inline cross-table edges frozen by the XC-3 recursion guard
-- (src/__tests__/rls-no-cross-table-recursion.test.ts). It does not form a live
-- cycle today (no teachers policy reads at_risk_alerts back), but it is a latent
-- TSB-4-class edge: the moment a teachers policy were to read at_risk_alerts, this
-- inline subquery could close an at_risk_alerts → teachers → at_risk_alerts
-- recursion. Delegating to a SECURITY DEFINER helper removes the latent edge.
--
-- ─── Why the boundary is EXACTLY preserved (PROOF — no over/under-grant) ─────
-- Inline predicate (per row of at_risk_alerts):
--     teacher_id IN ( SELECT id FROM teachers WHERE auth_user_id = auth.uid() )
-- Helper predicate (this migration):
--     teacher_id = public.get_my_teacher_id()
-- where get_my_teacher_id() (baseline:8998) is exactly
--     SELECT id FROM teachers WHERE auth_user_id = auth.uid() LIMIT 1.
--
-- The two predicates select the IDENTICAL set of at_risk_alerts rows for EVERY
-- caller, because:
--   (a) Same table, same filter, NO extra guards. The inline subquery and the
--       helper body both read public.teachers and filter ONLY on
--       auth_user_id = auth.uid(). Neither carries an is_active, deleted_at, or
--       status guard, so neither narrows nor widens the candidate teacher set.
--   (b) The subquery returns AT MOST ONE id. public.teachers has a FULL UNIQUE
--       constraint on auth_user_id (teachers_auth_user_id_unique, baseline:16272),
--       so { id : auth_user_id = auth.uid() } has cardinality 0 or 1 for any caller.
--       With a 0-or-1-element set, `teacher_id IN (set)` is logically identical to
--       `teacher_id = (the single element)`; the helper's LIMIT 1 therefore drops
--       no row the inline form would have matched. (LIMIT 1 only matters when the
--       set has >1 element, which the UNIQUE constraint forbids.)
--   (c) Empty / NULL parity. A caller with no teacher row: inline → empty set →
--       `teacher_id IN ()` is FALSE; helper → get_my_teacher_id() returns NULL →
--       `teacher_id = NULL` is NULL (not TRUE). A row with teacher_id IS NULL
--       (the FK is ON DELETE SET NULL, so this can occur): inline → NULL IN (...)
--       is never TRUE; helper → NULL = <id> is NULL, never TRUE. Both forms hide
--       the row in every such case — identical non-match behaviour.
-- Therefore the visible/insertable row set is IDENTICAL: no row becomes newly
-- visible, none is removed. The only behavioural delta is that the teachers lookup
-- now runs inside a SECURITY DEFINER function.
--
-- ─── Why NO recursion (SECURITY DEFINER) ─────────────────────────────────────
-- public.get_my_teacher_id() is SECURITY DEFINER (baseline:8997), so its inner read
-- of public.teachers BYPASSES RLS — it does not re-enter the RLS policy evaluator.
-- There is therefore no at_risk_alerts → teachers edge in the RLS graph after this
-- change: the cycle the inline form could close cannot form. This mirrors the
-- established is_teacher_of / is_guardian_of / is_school_admin_of_student pattern and
-- the 20260702080000 / 20260702090000 fixes.
--
-- ─── Command / role / WITH CHECK preservation ────────────────────────────────
-- The baseline policy specifies NO `FOR` clause (⇒ FOR ALL), NO `TO` clause
-- (⇒ PUBLIC / all roles), and only USING (so WITH CHECK defaults to the USING
-- expression for INSERT/UPDATE). This migration reproduces that EXACTLY: no FOR,
-- no TO, USING only. The WITH CHECK continues to default to the (new) USING
-- expression, so the INSERT/UPDATE check transforms identically to the read check —
-- no command, role, or check-direction is changed.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. On a fresh DB the chain
--     runs the baseline (inline form) then this migration (DROP + CREATE helper
--     form), ending on the helper form. On prod (inline form live) this DROPs and
--     replaces it in place. Both paths converge to the same non-inline end state.
--   * Boundary-identical: same visible/insertable row set (proof above). NOT an
--     RBAC change (no role/permission added or removed) and NOT a data change.
--   * No destructive DDL: no DROP TABLE / DROP COLUMN. Touches only this one named
--     policy. Reuses the EXISTING helper get_my_teacher_id() (defines nothing new).
--   * get_my_teacher_id() is intentionally kept PUBLIC-EXECUTE precisely because it
--     is referenced inside RLS USING/WITH CHECK expressions (migration
--     20260516050000 keep-list), so authenticated callers can evaluate this policy.
--   * Rollback: re-create the inline policy form (the baseline text above), or simply
--     DROP the named policy (service_role retains full access via
--     "Service role full access at_risk_alerts").

BEGIN;

-- Replace the inline `FROM public.teachers` subquery with the EXISTING SECURITY
-- DEFINER helper (NO inline cross-table subquery). Same name, same FOR ALL, same
-- PUBLIC roles, same USING-only shape — boundary-identical, recursion-safe.
DROP POLICY IF EXISTS "Teachers see own at-risk alerts" ON public.at_risk_alerts;

CREATE POLICY "Teachers see own at-risk alerts"
  ON public.at_risk_alerts
  USING ( teacher_id = public.get_my_teacher_id() );

COMMENT ON POLICY "Teachers see own at-risk alerts" ON public.at_risk_alerts IS
  'XC-3 Phase 4 first drain (20260702100000). Teacher own-alert boundary on '
  'at_risk_alerts, NON-INLINE: delegates to the SECURITY DEFINER helper '
  'public.get_my_teacher_id() instead of inlining a FROM public.teachers subquery '
  '(baseline:20252). Boundary-identical — teachers.auth_user_id is UNIQUE '
  '(teachers_auth_user_id_unique) so the inline IN-subquery returned at most one id, '
  'making `teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())` '
  'equivalent to `teacher_id = get_my_teacher_id()` (same table, same auth.uid() '
  'filter, no is_active/deleted_at/status guard on either side, identical NULL/empty '
  'non-match). The helper bypasses RLS on its inner read so no at_risk_alerts → '
  'teachers → at_risk_alerts recursion can form. Ratchets the XC-3 grandfather '
  'ledger 241 -> 240 (plan Phase 4).';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. As a teacher, alerts whose teacher_id is the caller's teacher id are visible:
--      SELECT count(*) FROM public.at_risk_alerts;  -- own-teacher rows only
-- 2. As that teacher, an alert for a DIFFERENT teacher is NOT visible (0 rows).
-- 3. As a non-teacher authenticated caller, no rows visible (get_my_teacher_id() NULL).
-- 4. No recursion: any authenticated read of at_risk_alerts returns without the
--    "infinite recursion detected in policy" error.
