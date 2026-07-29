-- Migration: 20260729130100_recalculate_leaderboard_snapshots_rpc.sql
-- Purpose: DSA audit CRITICAL — replace the JS-side, PostgREST-truncated
--          leaderboard rank recalculation with a single set-based SQL
--          statement that ranks every student, not the first 1000.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DEFECT
-- ═══════════════════════════════════════════════════════════════════════════
-- supabase/functions/daily-cron/index.ts:138-155 (recalculateLeaderboards):
--
--   const { data } = await supabase.from('students')
--     .select('id,grade,xp_total').eq('is_active',true).is('deleted_at',null)
--   ... group by grade in JS, list.sort((a,b)=>b.xp_total-a.xp_total),
--       list.forEach((s,i)=> rank = i+1) ...
--   await supabase.from('leaderboard_snapshots').upsert(entries,{onConflict:'student_id'})
--
-- The unfiltered .select() is capped by PostgREST's max-rows setting (1000 by
-- default). Past 1000 active students the fetch silently returns a truncated,
-- arbitrarily-ordered page. Consequences, all silent:
--   * every student outside the first 1000 rows keeps a stale rank forever;
--   * the students who DO get ranked are ranked against a partial population,
--     so their persisted rank is simply wrong;
--   * grade partitions are formed from whatever happened to be in the page, so
--     a grade can be ranked from a fraction of its cohort.
-- The function also transfers the entire students table into the Edge Function
-- and sorts it in JS on every nightly tick.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX
-- ═══════════════════════════════════════════════════════════════════════════
-- One INSERT ... SELECT ... ON CONFLICT DO UPDATE. No row limit, no client-side
-- sort, no data leaving the database.
--
-- ── SEMANTICS: exact parity with the JS being replaced ────────────────────
--
-- 1. POPULATION — WHERE s.is_active = true AND s.deleted_at IS NULL.
--    Mirrors .eq('is_active', true).is('deleted_at', null). `= true` (not
--    `IS TRUE`) so a NULL is_active is excluded exactly as PostgREST's eq
--    excludes it.
--
-- 2. PARTITION — COALESCE(s.grade, 'unknown'), mirroring `s.grade ?? 'unknown'`.
--    students.grade is NOT NULL in the current schema so this never fires; it is
--    kept purely for byte-parity with the JS.
--
-- 3. ORDERING — COALESCE(s.xp_total, 0) DESC, mirroring
--    `list.sort((a,b) => b.xp_total - a.xp_total)` over `s.xp_total ?? 0`.
--
-- 4. RANK FUNCTION — ROW_NUMBER(), *not* RANK(). This is the one place worth
--    reading carefully. The JS assigns `rank = i + 1` by array index, so two
--    students on identical XP receive DIFFERENT, consecutive ranks (…, 7, 8, …)
--    rather than a shared rank. That is ROW_NUMBER semantics — neither RANK()
--    (which would give 7, 7, then skip to 9) nor DENSE_RANK() (7, 7, 8).
--    Porting to RANK() would have been a silent behaviour change on every tie,
--    so ROW_NUMBER() is used to preserve the existing contract.
--
--    Tie-break: `, s.id` is appended to the window ORDER BY. The JS tie-break
--    was the arbitrary, non-deterministic order in which PostgREST happened to
--    return the rows, so ties could shuffle between nights. Ordering by id makes
--    ties STABLE across runs. This is the only intentional behavioural
--    refinement in this file, and it only affects which of two exactly-tied
--    students is listed first.
--
--    If product later decides tied students should SHARE a rank, that is a
--    deliberate product decision (assessment domain) — swap ROW_NUMBER for
--    RANK here and re-pin the regression. Do not change it as a drive-by.
--
-- 5. STALE ROWS — like the JS, this does not delete leaderboard_snapshots rows
--    for students who have since been deactivated or soft-deleted. Retention of
--    stale rows is unchanged; consumers already filter.
--
-- 6. NOT PORTED (deliberate): the JS also flips the `leaderboard_global` /
--    `wave1_leaderboard` feature flags on when >= 2 entries exist. Feature-flag
--    mutation is ops-owned and does not belong in a ranking RPC. The caller
--    keeps that block and drives it off this function's return value.
--
-- ── SCHEMA (read from 00000000000000_baseline_from_prod.sql, not guessed) ──
--   public.leaderboard_snapshots (baseline:11831-11837)
--     student_id uuid NOT NULL   -- PRIMARY KEY (baseline:15499-15500)
--     grade      text NOT NULL
--     total_xp   integer NOT NULL DEFAULT 0
--     rank       integer NOT NULL DEFAULT 0
--     updated_at timestamptz NOT NULL DEFAULT now()
--   FK leaderboard_snapshots_student_id_fkey -> students(id) ON DELETE CASCADE
--   Conflict target is therefore the PK: (student_id). Every column is NOT NULL,
--   so every column is written explicitly.
--   Existing index idx_leaderboard_snapshots_grade_xp (grade, total_xp DESC)
--   serves reads; no new index needed for this writer.
--
-- SECURITY DEFINER justification (required by house rule): this function is a
-- service-role-only nightly maintenance writer. leaderboard_snapshots has RLS
-- enabled with a student-scoped SELECT policy and a service-role-full-access
-- policy; the function must write rows for EVERY student, which no per-student
-- RLS context can do. EXECUTE is granted to service_role ONLY (revoked from
-- PUBLIC/anon/authenticated below), so no end-user can reach it. search_path is
-- pinned to public, pg_temp to prevent search_path capture.
--
-- Idempotent: CREATE OR REPLACE FUNCTION; the statement itself is an upsert and
-- is safe to run any number of times per day. No table created or dropped.
-- No new table => no new RLS required.
--
-- ROLLBACK: the Edge Function's original JS path is unaffected by this file;
--           reverting means simply not calling the RPC. To remove:
--           DROP FUNCTION IF EXISTS public.recalculate_leaderboard_snapshots();
--
-- REVIEW CHAIN (P14): backend (daily-cron caller swap), ops (deployment /
--                     runbook), testing (rank-parity + >1000-student regression).

CREATE OR REPLACE FUNCTION public.recalculate_leaderboard_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now  timestamptz := now();
  v_rows integer     := 0;
BEGIN
  INSERT INTO public.leaderboard_snapshots (
    student_id,
    grade,
    total_xp,
    rank,
    updated_at
  )
  SELECT
    s.id,
    COALESCE(s.grade, 'unknown'),
    COALESCE(s.xp_total, 0),
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(s.grade, 'unknown')
      ORDER BY COALESCE(s.xp_total, 0) DESC, s.id
    )::integer,
    v_now
  FROM public.students s
  WHERE s.is_active = true
    AND s.deleted_at IS NULL
  -- Unconditional DO UPDATE (no `WHERE ... IS DISTINCT FROM` short-circuit) so
  -- that ROW_COUNT below equals the number of RANKED STUDENTS, exactly like the
  -- JS `entries.length` it replaces. The caller's `>= 2` feature-flag check
  -- depends on that meaning: a "changed rows only" count would read 0 on any
  -- night where nobody's XP moved and would silently stop matching.
  -- updated_at is likewise always bumped, matching the JS which stamped
  -- `updated_at: now` on every entry it upserted.
  ON CONFLICT (student_id) DO UPDATE SET
    grade      = EXCLUDED.grade,
    total_xp   = EXCLUDED.total_xp,
    rank       = EXCLUDED.rank,
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.recalculate_leaderboard_snapshots() IS
  'Set-based nightly leaderboard rank recalculation. Replaces the JS loop in '
  'supabase/functions/daily-cron/index.ts:138-155, whose unfiltered '
  'students .select() was silently truncated at PostgREST''s 1000-row cap, '
  'leaving every student past row 1000 with a permanently stale rank and '
  'ranking the rest against a partial population. '
  'Semantics preserved exactly: population = is_active = true AND '
  'deleted_at IS NULL; partition = COALESCE(grade, ''unknown''); order = '
  'COALESCE(xp_total, 0) DESC; rank = ROW_NUMBER (the JS assigned rank by array '
  'index, so tied students get distinct consecutive ranks — NOT RANK(), which '
  'would gap, and NOT DENSE_RANK()). Tie-break by student id added so ties are '
  'stable between nights instead of following arbitrary fetch order. '
  'Does NOT delete snapshots for now-inactive students (same as the JS) and '
  'does NOT touch feature flags (the leaderboard_global / wave1_leaderboard '
  'auto-enable stays with the ops-owned caller). '
  'Returns the number of students ranked and written — the same quantity the '
  'JS returned as entries.length, which the caller''s >= 2 feature-flag check '
  'depends on. '
  'SECURITY DEFINER: must write rows for every student, which no per-student '
  'RLS context can do; EXECUTE granted to service_role only.';

-- Least privilege: service_role only. No end-user role may invoke a
-- whole-table ranking writer.
REVOKE ALL ON FUNCTION public.recalculate_leaderboard_snapshots() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_leaderboard_snapshots() FROM anon;
REVOKE ALL ON FUNCTION public.recalculate_leaderboard_snapshots() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_leaderboard_snapshots() TO service_role;
