-- Migration: 20260729130000_fix_6arg_quiz_xp_ledger_write.sql
-- Purpose: P2 (XP economy) DEFENSIVE — make the 6-argument
--          atomic_quiz_profile_update overload WRITE the xp_transactions ledger
--          row it already READS for the 200 XP/day cap, in the same
--          transaction as the students.xp_total / student_learning_profiles.xp
--          updates. Without this the cap structurally cannot bind on the 6-arg
--          path.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SEVERITY: LATENT, NOT ACTIVE — read this before treating it as an incident
-- ═══════════════════════════════════════════════════════════════════════════
-- No first-party page, API route, Supabase Edge Function, cron worker, or
-- Flutter screen invokes the 6-arg overload today. The live quiz submission
-- path runs through submit_quiz_results_v2 -> the 7-ARG overload, which already
-- wrote the ledger row and on which the cap therefore already binds. So:
--
--   * This is a correct fix to a currently-DORMANT surface.
--   * It is NOT the closure of an active P2 breach.
--   * No production XP total is known to be inflated by this defect, and this
--     migration implies no XP reconciliation or backfill.
--
-- See "REACHABILITY" below for the evidence and for the one residual channel
-- that is reachable in principle. An earlier draft of this header asserted the
-- opposite (that this was the hot path and that students could bank unbounded
-- XP through it); that assertion was wrong and is retracted below.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DEFECT (DSA audit, 2026-07-29)
-- ═══════════════════════════════════════════════════════════════════════════
-- There are two overloads of public.atomic_quiz_profile_update:
--
--   6-arg (RETURNS jsonb) — 20260729120001_fix_quiz_rpc_defects.sql:574-698
--   7-arg (RETURNS void)  — 20260729120001_fix_quiz_rpc_defects.sql:714-990
--
-- The 6-arg overload reads today's already-earned quiz XP from
-- public.xp_transactions (daily_category = 'quiz') over an Asia/Kolkata
-- calendar day, and clamps its award with
--     LEAST(GREATEST(0, p_xp), v_remaining)
-- to enforce the P2 daily cap of 200 XP.
--
-- But that overload NEVER INSERTED a row into xp_transactions. The only ledger
-- INSERT in that migration lives at :815, inside the 7-arg overload's CASE A
-- branch (plus the award_xp() delegation in CASE B).
--
-- Consequence — this part WAS true and is what the fix addresses: on the 6-arg
-- path the cap read could only ever see XP written by OTHER paths. This
-- overload's own prior awards read back as zero, so v_today_earned reflected
-- only the 7-arg path's contribution and v_remaining stayed at (or near) 200
-- indefinitely, while students.xp_total and student_learning_profiles.xp were
-- incremented on every call and the return payload asserted `xp_capped: false`,
-- `remaining_today: 200`. The 200 XP/day cap was therefore STRUCTURALLY
-- unenforceable on this overload: not "usually held", not "held approximately"
-- — it could not bind, by construction.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- REACHABILITY — verified by grep 2026-07-29, corrected after quality review
-- ═══════════════════════════════════════════════════════════════════════════
-- The retracted claims were "both live callers use the 6-arg form, so this was
-- the hot path for the cap" and "a student quizzing repeatedly through this
-- path could bank unbounded XP". What the code actually shows:
--
--   * The only 6-arg call sites in the entire repo are (cited by ENCLOSING
--     FUNCTION, not line number — these files are under active edit and the
--     line numbers drift; grep the symbol, do not trust the offset):
--       packages/lib/src/domains/quiz.ts    -> submitQuizSession(), and only in
--                                              its RPC-failure fallback branch
--                                              (~L354 as of 2026-07-29)
--       packages/lib/src/domains/profile.ts -> updateXpAndProfile()
--                                              (~L117 as of 2026-07-29)
--   * packages/lib/src/domains/quiz.ts has ZERO production importers. The only
--     references to it are apps/host/src/lib/domains/quiz.ts (the 2-line
--     auto-generated re-export stub, which is itself imported by nothing) and
--     apps/host/src/__tests__/domain-quiz.test.ts.
--   * updateXpAndProfile has ZERO callers of any kind — not even a test.
--     (domains/profile.ts IS imported in production, by
--     packages/ui/src/refresh/QuickRecallSection.tsx, but only for
--     getReviewCards. The module loads; this function is never invoked.)
--   * Every PERFORM of this RPC anywhere in the migration chain passes SEVEN
--     args — including submit_quiz_results_v2's at 20260729120001:494-496, the
--     live student quiz path. The 7-arg overload writes the ledger at :815, so
--     the cap binds there.
--   * No Supabase Edge Function calls this RPC. No Flutter code calls it; the
--     two Dart hits are comments describing the cap banner.
--
-- ONE RESIDUAL SURFACE — do not over-correct into "unreachable, full stop":
-- the 6-arg overload is still EXECUTE-granted to `authenticated`. Only `anon`
-- was revoked (20260610000000:323, 20260702150000:563), and the baseline's
-- ALTER DEFAULT PRIVILEGES grants functions in public to `authenticated`. That
-- grant is deliberate (rationale at 20260702150000:106-107). A logged-in user
-- can therefore reach this overload with a hand-crafted PostgREST
-- /rest/v1/rpc call carrying exactly the six params. The 2026-07-02 ownership
-- check bounds the blast radius to SELF-award — you cannot write XP onto
-- another student — but self-award is precisely the uncapped-XP shape. So this
-- channel is reachable-in-principle and unexercised-in-practice. It is not a
-- hot path; it is also not nothing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS STILL WORTH LANDING
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The defect is LATENT, not ABSENT. The moment anything routes through
--    domains/quiz.ts or updateXpAndProfile — a refactor, a re-enabled fallback,
--    or a new caller that reasonably assumes an RPC named "atomic_quiz_profile_
--    update" enforces the documented cap — the 200 XP/day cap silently stops
--    binding. There is no error, no log line, and the RPC's own payload
--    actively reports `xp_capped: false, remaining_today: 200`. A silent
--    failure that returns a reassuring answer is the worst kind to find in
--    production, because the first signal is a leaderboard nobody trusts.
-- 2. It closes the direct-PostgREST self-award channel described above.
-- 3. It is cheap and additive: one guarded INSERT, return shape byte-identical,
--    no DDL, no RLS change, no grant change.
--    Fixing a dormant path before it is wired costs one migration. Discovering
--    it after it is wired costs an XP reconciliation across live accounts.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX
-- ═══════════════════════════════════════════════════════════════════════════
-- Add the missing INSERT INTO public.xp_transactions inline, as a new Step 3,
-- BEFORE the profile/student writes and AFTER the cap read — so the cap read
-- and the cap write agree on a single authoritative source (the ledger).
--
-- Structural choice (lowest risk): INLINE INSERT, not delegation to the 7-arg
-- overload. Delegating with p_session_id => NULL was considered and REJECTED
-- because the 7-arg overload:
--   (a) routes a NULL session id into CASE B -> award_xp(), which applies its
--       own XP/profile write semantics and its own last_active side effects;
--   (b) upserts student_learning_profiles under COALESCE(subject, 'general')
--       rather than the raw p_subject this overload uses; and
--   (c) RETURNS void, so it cannot supply the `profile_xp` value that the
--       6-arg overload's RETURNING clause feeds into its JSONB result.
-- Any of those would have changed the return payload or the rows written.
--
-- RETURN SHAPE IS UNCHANGED, BYTE FOR BYTE (pinned by REG-48): the same nine
-- keys, in the same order, built from the same expressions. No key added, no
-- key removed, no expression altered.
--
-- P2 IS UNCHANGED: the XP formula is untouched and the cap value is still 200
-- (mirrors XP_RULES.quiz_daily_cap in packages/lib/src/xp-config.ts:47 — read
-- and confirmed 2026-07-29; XP_PER_LEVEL = 500 at xp-config.ts:71 likewise
-- matches the /500 level math below). This migration RESTORES enforcement of
-- an existing rule; it does not alter the rule.
--
-- Ledger row shape matches the 7-arg overload's INSERT exactly — same target
-- columns (student_id, amount, source, subject, daily_category, reference_id,
-- metadata, created_at), same source = 'quiz' (a valid member of
-- xp_transactions_source_check), same daily_category = 'quiz' (the value the
-- cap read filters on), same metadata keys as the 7-arg CASE B / award_xp
-- delegation (total_q, correct_q, time_seconds, original_xp).
--
-- reference_id is NULL because the 6-arg overload has no p_session_id to key
-- on. The unique index idx_xp_txn_reference_id is PARTIAL
-- (WHERE reference_id IS NOT NULL), so a NULL reference_id is unconstrained and
-- needs no ON CONFLICT clause. This matches the 7-arg overload's own no-session
-- branch, which likewise writes an unkeyed row via award_xp(). NOTE: that means
-- this path is NOT idempotent on retry — same as before this fix, and same as
-- the 7-arg no-session branch. Deliberately unchanged here; adding a synthetic
-- reference key is a separate decision.
--
-- Subject normalisation: the ledger insert applies the SAME 'unknown' -> NULL
-- normalisation the 7-arg overload applies (v_subject_clean), so the two
-- overloads write comparable ledger rows. The student_learning_profiles upsert
-- below still uses the RAW p_subject exactly as before — normalisation is
-- confined to the new ledger row and changes nothing pre-existing.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. No table/column created or dropped.
-- No RLS change (no new table), no GRANT/REVOKE change. The SECURITY DEFINER
-- posture and the pinned `search_path = public, pg_temp` are carried over
-- unchanged from the prior definition — DEFINER is required because this
-- overload writes xp_transactions / students / student_learning_profiles rows
-- that the calling student's own RLS grants do not permit; the compensating
-- control is the auth.uid() ownership check at the top of the body (added
-- 2026-07-02), which this migration also carries over unchanged.
--
-- ROLLBACK: re-apply the 6-arg overload body from
--           20260729120001_fix_quiz_rpc_defects.sql:574-698 verbatim. Rollback
--           is low-urgency: it restores a dormant-but-uncapped overload, which
--           is the state this repo has been in since that overload existed.
--
-- REVIEW CHAIN (P14): assessment (P2 cap enforcement), backend (the two
--                     currently-dormant 6-arg call sites), testing (REG-48
--                     return-shape + cap-binding regression).

CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update(
  p_student_id   UUID,
  p_subject      TEXT,
  p_xp           INT,
  p_total        INT,
  p_correct      INT,
  p_time_seconds INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_minutes  INT := GREATEST(1, ROUND(p_time_seconds / 60.0));
  v_daily_cap     INT := 200;  -- mirrors XP_RULES.quiz_daily_cap
  v_today_earned  INT;
  v_remaining     INT;
  v_effective_xp  INT;
  v_xp_capped     BOOLEAN := false;
  v_xp_excess     INT := 0;
  v_new_profile_xp BIGINT;
  v_ist_today     DATE;  -- FIX F8 (2026-07-29): single IST "what day is it" anchor
  -- FIX 2026-07-29 (DSA audit): subject normalisation for the NEW ledger row
  -- only. Mirrors the 7-arg overload's v_subject_clean. NOT used by the
  -- student_learning_profiles upsert below, which keeps using raw p_subject.
  v_subject_clean TEXT;
BEGIN
  -- SECURITY FIX (2026-07-02, Phase 3 Wave 1 #5): ownership check. Prevents an
  -- authenticated caller from writing XP/profile rows onto an arbitrary
  -- p_student_id. Skipped when auth.uid() IS NULL (service-role callers bypass
  -- RLS and carry no JWT). CARRIED OVER UNCHANGED by this migration.
  --
  -- ACCURACY NOTE (2026-07-29): the 2026-07-02 comment here used to say this
  -- overload "is called directly from the browser by domains/quiz.ts and
  -- domains/profile.ts". As of 2026-07-29 neither of those call sites is
  -- reachable from any production page or route (see the REACHABILITY section
  -- in this file's header). The check still matters, because the overload
  -- remains EXECUTE-granted to `authenticated`, so a hand-crafted PostgREST
  -- /rest/v1/rpc call from any logged-in browser session can still invoke it.
  -- Do NOT remove this check on the grounds that the TS call sites are dead.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  v_ist_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  v_subject_clean := CASE WHEN p_subject IS NULL OR p_subject = 'unknown'
                          THEN NULL ELSE p_subject END;

  -- ── 1. Read today's already-earned quiz XP from the ledger ──────────
  -- FIX F4 + F8 (2026-07-29):
  -- F4: quiz_sessions has NO xp_earned column (confirmed against the
  --     baseline DDL -- the column that actually holds a session's awarded
  --     XP is `score`, written by submit_quiz_results_v2/submit_quiz_results).
  --     `SUM(xp_earned) FROM quiz_sessions` therefore raised Postgres 42703
  --     on every call to this overload -- it always errored, it did not
  --     silently miscount.
  -- F8: the previous CURRENT_DATE-based range was anchored to the session's
  --     (UTC) timezone, not IST, causing an off-by-one during 00:00-05:29 IST.
  -- Fix: read today's-already-earned quiz XP from the SAME authoritative
  -- source the 7-arg sibling overload uses -- the xp_transactions ledger,
  -- daily_category='quiz' -- over an explicit Asia/Kolkata calendar day, so
  -- both overloads agree on both "where is XP tracked" and "what day is it".
  --
  -- FIX 2026-07-29 (DSA audit): this read is now SELF-CONSISTENT on this path,
  -- because Step 3 below finally writes back into the same ledger it reads.
  -- Before today this overload's own prior awards were invisible here, so the
  -- cap below could not bind by construction. That was a real structural
  -- defect; it was also DORMANT — nothing in production routes through this
  -- overload today. See the header's SEVERITY and REACHABILITY sections before
  -- escalating this as a live incident.
  SELECT COALESCE(SUM(amount), 0)::INT
    INTO v_today_earned
    FROM public.xp_transactions
   WHERE student_id     = p_student_id
     AND daily_category = 'quiz'
     AND created_at    >= (v_ist_today AT TIME ZONE 'Asia/Kolkata')
     AND created_at    <  ((v_ist_today + 1) AT TIME ZONE 'Asia/Kolkata');

  -- ── 2. Clamp p_xp under the daily cap ──────────────────────────────
  v_remaining    := GREATEST(0, v_daily_cap - v_today_earned);
  v_effective_xp := LEAST(GREATEST(0, COALESCE(p_xp, 0)), v_remaining);

  IF v_effective_xp < COALESCE(p_xp, 0) THEN
    v_xp_capped := true;
    v_xp_excess := COALESCE(p_xp, 0) - v_effective_xp;
  END IF;

  -- ── 3. Write the xp_transactions ledger row (NEW — DSA audit fix) ───
  -- This is the write that was missing. It runs inside the SAME implicit
  -- transaction as the student_learning_profiles upsert (Step 4) and the
  -- students.xp_total update (Step 5), so the ledger and the aggregate
  -- totals can never diverge: either all three land or none do.
  --
  -- Guarded by v_effective_xp > 0, mirroring the 7-arg overload's
  -- `IF v_xp_to_award > 0 THEN` guard — a fully-capped or flagged (0 XP)
  -- submission writes no ledger row, exactly as on the 7-arg path.
  --
  -- Column list, source, daily_category and metadata keys deliberately mirror
  -- the 7-arg overload's INSERT so that the cap read above (which sums
  -- daily_category = 'quiz') sees rows of the same shape regardless of which
  -- overload produced them.
  IF v_effective_xp > 0 THEN
    INSERT INTO public.xp_transactions (
      student_id, amount, source, subject,
      daily_category, reference_id, metadata, created_at
    ) VALUES (
      p_student_id,
      v_effective_xp,          -- the CAPPED amount, matching what we credit below
      'quiz',
      v_subject_clean,
      'quiz',
      NULL,                    -- no p_session_id on this overload; the unique
                               -- index on reference_id is partial
                               -- (WHERE reference_id IS NOT NULL) so NULL is
                               -- unconstrained and needs no ON CONFLICT.
      jsonb_build_object(
        'total_q',      p_total,
        'correct_q',    p_correct,
        'time_seconds', p_time_seconds,
        'original_xp',  COALESCE(p_xp, 0)   -- amount before daily cap
      ),
      NOW()
    );
  END IF;

  -- ── 4. Upsert learning profile with the CLAMPED value ──────────────
  INSERT INTO public.student_learning_profiles (
    student_id, subject, xp, total_sessions,
    total_questions_asked, total_questions_answered_correctly,
    total_time_minutes, last_session_at, streak_days, level, current_level
  ) VALUES (
    p_student_id, p_subject, v_effective_xp, 1,
    p_total, p_correct,
    v_time_minutes, NOW(), 1, 1, 'beginner'
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    xp = student_learning_profiles.xp + v_effective_xp,
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + p_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + p_correct,
    total_time_minutes = student_learning_profiles.total_time_minutes + v_time_minutes,
    last_session_at = NOW(),
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_effective_xp) / 500) + 1)
  RETURNING xp INTO v_new_profile_xp;

  -- ── 5. Update student totals + streak with the CLAMPED value ───────
  -- FIX F8 (2026-07-29): streak day-boundary now compares IST calendar dates
  -- (via v_ist_today) instead of a bare ::date truncation in the session's
  -- (UTC) timezone. This UPDATE is still a SINGLE statement, so `last_active`
  -- inside the CASE correctly refers to the PRE-update row value (Postgres
  -- evaluates every expression in an UPDATE's SET list against the OLD row,
  -- not sequentially) -- there is no F3-style ordering bug in this overload,
  -- only the timezone bug.
  UPDATE public.students SET
    xp_total = COALESCE(xp_total, 0) + v_effective_xp,
    last_active = NOW(),
    streak_days = CASE
      WHEN last_active IS NOT NULL
           AND (last_active AT TIME ZONE 'Asia/Kolkata')::date = v_ist_today
        THEN COALESCE(streak_days, 1)
      WHEN last_active IS NOT NULL
           AND (last_active AT TIME ZONE 'Asia/Kolkata')::date = v_ist_today - 1
        THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

  -- ── 6. Return cap status so callers can warn the learner ───────────
  -- UNCHANGED FROM THE PRIOR DEFINITION, BYTE FOR BYTE (REG-48 pins this).
  RETURN jsonb_build_object(
    'success',         true,
    'requested_xp',    COALESCE(p_xp, 0),
    'effective_xp',    v_effective_xp,
    'xp_capped',       v_xp_capped,
    'xp_cap_excess',   v_xp_excess,
    'today_earned',    v_today_earned,
    'daily_cap',       v_daily_cap,
    'remaining_today', GREATEST(0, v_remaining - v_effective_xp),
    'profile_xp',      v_new_profile_xp
  );
END;
$$;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT) IS
  'Atomic quiz profile + student XP update with the P2 daily XP cap (200) enforced. '
  'Daily cap source of truth: packages/lib/src/xp-config.ts XP_RULES.quiz_daily_cap. '
  'Returns JSONB (shape pinned by REG-48 — do not change). '
  'SECURITY FIX 2026-07-02 (Phase 3 Wave 1 #5): ownership check. '
  'FIX 2026-07-29 (forensic audit F4/F8): the daily-earned-XP read no longer '
  'references the nonexistent quiz_sessions.xp_earned column (was raising '
  '42703 on every call); it now reads xp_transactions (daily_category=''quiz'') '
  'over an explicit Asia/Kolkata calendar day, matching the 7-arg sibling '
  'overload and removing a UTC/IST day-boundary off-by-one in both the cap '
  'read and the streak comparison. '
  'FIX 2026-07-29 (DSA audit, P2 — defensive fix on a dormant path): this '
  'overload now WRITES the xp_transactions ledger row it already reads for the '
  'cap, in the same transaction as the students.xp_total and '
  'student_learning_profiles.xp updates. Previously it only ever read the '
  'ledger and never wrote it, so its own prior awards were invisible to the cap '
  'read and the 200 XP/day cap could not bind on this path by construction. '
  'SCOPE, verified by grep 2026-07-29: this overload is NOT reachable from any '
  'production page, API route, Edge Function, cron or mobile screen — the live '
  'quiz path uses submit_quiz_results_v2 and the 7-arg overload, where the cap '
  'already bound. The two TS call sites (domains/quiz.ts, domains/profile.ts) '
  'have no production importers. It IS still EXECUTE-granted to authenticated, '
  'so a hand-crafted PostgREST rpc call could reach it (bounded to self-award '
  'by the ownership check). Latent defect closed before it could be wired up; '
  'no XP backfill implied. Ledger row shape (columns, '
  'source=''quiz'', daily_category=''quiz'', metadata keys) mirrors the 7-arg '
  'overload; reference_id is NULL because this overload has no session id, and '
  'idx_xp_txn_reference_id is partial so NULL is unconstrained. XP formula and '
  'cap value unchanged (P2 invariant) — this restores enforcement, it does not '
  'alter the rule.';
