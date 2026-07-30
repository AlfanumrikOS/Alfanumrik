-- Migration: 20260729130500_get_student_usage_single_limit_authority.sql
--
-- PURPOSE (P0-1, follow-up condition 1 of the 20260729130400 architect review)
-- ─────────────────────────────────────────────────────────────────────────────
-- Make `get_student_usage()` — the READ-ONLY usage-widget feed — stop computing
-- its own limits and delegate every limit to `get_plan_limit()`, so there is
-- exactly ONE limit authority in SQL.
--
-- THE BUG THIS CLOSES: 20260729130400 taught `get_plan_limit()` about school
-- (B2B) coverage, and `check_and_record_usage()` derives the ENFORCED cap from
-- that function — so a school-covered student is now genuinely allowed the
-- higher cap. But `get_student_usage()` carried a SECOND, independently written
-- copy of the limit logic that never called `get_plan_limit()` at all. Left
-- alone, a student covered by a paid/trial school would be ALLOWED unlimited
-- Foxy chats while the widget kept displaying the free-tier number. On a school
-- demo screen that reads as "the fix didn't work". Display and enforcement must
-- come from the same function or they will drift again.
--
--
-- WHAT CHANGES / WHAT DOES NOT
-- ─────────────────────────────────────────────────────────────────────────────
--   CHANGES: where the four `limit` values come from — now 100% from
--            `public.get_plan_limit(p_student_id, <feature>)`.
--   UNCHANGED: the JSON shape, the key names, the key order, the `-1` unlimited
--            sentinel, the four `used` values, the `plan` key's type, the
--            function signature, LANGUAGE, SECURITY, and search_path.
--
-- RETURN SHAPE — PRESERVED EXACTLY (this was a hard requirement)
--   {
--     "plan":     text,
--     "foxy":     { "used": int, "limit": int },
--     "quiz":     { "used": int, "limit": int },
--     "notes":    { "used": int, "limit": int },
--     "ai_total": { "used": int, "limit": int }
--   }
-- Same five top-level keys, same nested {used,limit} pairs, same build order,
-- no key added, no key removed, no key renamed, no type changed. Callers
-- (`apps/host/src/types/database.types.ts` types it as `Json`) cannot break.
--
-- SENTINEL PRESERVED: this function's existing contract is "-1 means unlimited"
-- (its `notes`/`ai_total` CASEs already returned -1, and `foxy`/`quiz` passed
-- through `subscription_plans.foxy_chats_per_day = -1` after 20260714120000).
-- `get_plan_limit()` uses the OTHER sentinel — it maps -1 -> 999999. So the
-- delegated values are mapped BACK to -1 on the way out, via the new
-- `public.usage_limit_for_display()`. Without that mapping this migration would
-- silently change every unlimited row from `-1` to `999999` and any consumer
-- testing `limit === -1` would render "999999 left". The two sentinels are a
-- pre-existing, deliberate boundary: -1 is the DB-display sentinel, 999999 is
-- the TS sentinel (`UNLIMITED_USAGE_SENTINEL`, packages/lib/src/usage-sentinel.ts).
-- This migration does NOT unify them — that would be a contract change.
--
--
-- THE THREE DIVERGENCES, AND WHAT WAS CHOSEN
-- ─────────────────────────────────────────────────────────────────────────────
-- (1) JOIN: `ss.plan_id = sp.id`  vs  `sp.plan_code = ss.plan_code`
--     CHOSEN: plan_code — matches `get_plan_limit()`.
--     WHY: both columns are NOT NULL on `student_subscriptions`, so both joins
--     resolve; they differ only when the two columns disagree (data drift, e.g.
--     a plan_id repointed or a row written by a code path that set only one).
--     `plan_code` is the authoritative one: `subscription_plans` carries
--     `chk_valid_plan_code` pinning it to ('free','starter','pro','unlimited'),
--     the payment/verify path writes it, and — decisively — it is what the
--     ENFORCEMENT function already joins on. Display must follow enforcement.
--     After this migration `plan_id` is no longer read by this function at all.
--     NOTE: this is only used to derive the `plan` LABEL now; it cannot affect a
--     limit, because limits no longer read the catalog here.
--
-- (2) STATUS: `status = 'active'`  vs  `status IN ('active','trial')`
--     CHOSEN: IN ('active','trial') — matches `get_plan_limit()`.
--     WHY, AND WHY IT IS A NO-OP TODAY: `student_subscriptions` carries
--     `chk_subscription_status CHECK (status = ANY (ARRAY['pending','active',
--     'past_due','halted','paused','cancelled','expired','completed']))`.
--     'trial' is NOT a legal value on this table, so the 'trial' arm is
--     unreachable and the two filters select identical rows TODAY. It is adopted
--     purely so the two functions read the same, and so that if the CHECK is
--     ever widened both move together instead of one silently lagging.
--     (Do not confuse this with `school_subscriptions.status`, a DIFFERENT table
--     whose CHECK DOES allow 'trial' — that is the trial-school path, and it is
--     handled inside `get_plan_limit()` by 20260729130400, not here.)
--
-- (3) FREE QUIZ DEFAULT: 3 (this function)  vs  5 (`get_plan_limit()`)
--     CHOSEN: NEITHER — the hardcoded default is DELETED, not re-picked.
--     This is the important one, so read it carefully:
--
--     I could NOT confirm from source that the enforced free quiz cap is 5, and
--     I am not going to assert it. Here is the actual state:
--       • `get_plan_limit()` returns 5 for quiz ONLY on the "no active
--         subscription row" path (its `IF v_plan IS NULL` fallback).
--       • If the student HAS an active `student_subscriptions` row with
--         plan_code='free', `get_plan_limit()` returns
--         `subscription_plans.quizzes_per_day` for the 'free' row instead — a
--         PROD DATA value that is not seeded by any migration in this repo
--         (grep: no INSERT INTO subscription_plans anywhere in the chain; the
--         rows came in with the pg_dump baseline). The COLUMN DEFAULT for
--         `quizzes_per_day` is 3 (baseline L14169).
--       So depending on prod's free-plan row, the enforced free quiz cap today
--       is either 3 or 5, and I cannot see which from the repository.
--
--     Rather than guess, this migration removes the question. `get_student_usage`
--     now has NO quiz default of its own: it displays whatever
--     `get_plan_limit(p_student_id,'quiz')` enforces. If prod's free row says 3,
--     the widget shows 3 and enforcement allows 3 — agreed. If it says 5, both
--     show 5 — agreed. The display can no longer be wrong in either direction,
--     which is the actual requirement; picking a literal could only have made it
--     right by luck.
--
--     ⚠️ OPERATOR ACTION (not performed here — this is a read-only migration):
--     the §4 verification block RAISE NOTICEs the real free-row values from
--     `subscription_plans` into the deploy log. Read them. If free quiz is 3,
--     then the TS display constant `PLAN_LIMITS.free.quiz = 5`
--     (packages/lib/src/usage.ts:41) and the Flutter `_quizLimit()` default of 5
--     (mobile/lib/data/repositories/dashboard_repository.dart:223) are BOTH
--     over-promising by 2 and should be reconciled by backend/mobile — the fix
--     is a data decision (raise the catalog row to 5) or a code decision (lower
--     the TS/Dart constants to 3), and it is the CEO's call which. NOT decided
--     here, and deliberately NOT silently patched by this file.
--
--
-- HOW "EXACTLY ONE AUTHORITY" IS ACHIEVED
-- ─────────────────────────────────────────────────────────────────────────────
-- Every one of the four limits is now a single call:
--     foxy     -> get_plan_limit(p_student_id, 'foxy_chat')
--     quiz     -> get_plan_limit(p_student_id, 'quiz')
--     notes    -> get_plan_limit(p_student_id, 'notes')
--     ai_total -> get_plan_limit(p_student_id, 'ai_total')   [hits its ELSE arm]
-- The deleted local logic was VALUE-EQUIVALENT to those calls modulo the
-- sentinel, so this is a faithful delegation and not a repricing:
--     notes    old: free 2 / starter 5 / else -1
--              get_plan_limit 'notes': free 2 / starter 5 / else 999999  ✓
--     ai_total old: free 15 / starter 50 / pro 200 / else -1
--              get_plan_limit ELSE:    free 15 / starter 50 / pro 200 / else 999999 ✓
--     foxy/quiz old: raw subscription_plans column (-1 = unlimited)
--              get_plan_limit: same column, -1 mapped to 999999            ✓
-- The ONLY intended behaviour deltas are the three divergences above plus the
-- inherited school-coverage boost — which is the entire point.
--
-- No second definition is left behind: `CREATE OR REPLACE` overwrites the one
-- and only `get_student_usage(uuid)`. There is no overload, no `_v2`, no copy in
-- any other migration (grep confirms the baseline L5292 definition and the two
-- REVOKE files are the complete set of references in supabase/migrations/).
--
--
-- ⚠️ KNOWN DEFECT DELIBERATELY *NOT* FIXED HERE (reported, not silently patched)
-- ─────────────────────────────────────────────────────────────────────────────
-- The four `used` values are read from the WIDE columns
-- `student_daily_usage.{foxy_chats_used, quizzes_used, notes_generated,
-- ai_calls_total}`, but `check_and_record_usage()` — the only writer on the
-- enforcement path — writes the NARROW shape `(student_id, feature, usage_date,
-- usage_count)`. Nothing in the entire migration chain ever writes those four
-- wide columns (verified by grep: the only occurrences are the table DDL at
-- baseline L13744-13747 and this function's own read). So `used` is effectively
-- always 0.
-- That is a REAL second defect in this same function, and its BEHAVIOUR is left
-- exactly as it was — same source columns, same predicate, same values; only the
-- plpgsql variable form changed (record -> pre-initialised scalars) so the new
-- to_regclass guard cannot leave a record unassigned. Preserved on purpose: this
-- migration was scoped to limit
-- authority, and changing `used` from a permanent 0 to a true count is a
-- user-visible behaviour change with its own review chain (backend + frontend).
-- It also does not cause the demo failure being fixed — "0 used of unlimited"
-- reads fine on screen, whereas "limit 5" did not. Raised for backend as a
-- separate item. Do not assume `used` is trustworthy until it is fixed.
--
--
-- SECURITY / INVARIANTS
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER justification (carried over unchanged from the baseline
-- definition, not newly introduced): the function reads `student_subscriptions`,
-- `subscription_plans` and `student_daily_usage` on behalf of a caller who holds
-- no RLS grant on them, and calls `get_plan_limit()` which is itself DEFINER for
-- the same reason. It is a pure read keyed by a student id the caller already
-- holds; it returns counts and caps only — no row identifiers, no PII (P13).
-- EXECUTE stays REVOKEd from PUBLIC/anon/authenticated (§3), re-asserting the
-- posture set by 20260516040000 / 20260516050000 rather than depending on
-- CREATE OR REPLACE preserving the ACL.
--
-- P8 (RLS): NO RLS posture change. No table is created, altered or dropped; no
--   policy is added, changed or removed. Function bodies only.
-- P5 (grades): no grade column is read or written anywhere in this file.
-- P11: no pricing, plan catalog row, subscription status or payment record is
--   read-modified. This file WRITES NOTHING AT ALL — every statement is a
--   function definition, a REVOKE, or a read-only NOTICE.
-- P2/P1: no XP and no score is touched.
-- FEATURE FLAG: none created, seeded, read or flipped.
--   `ff_institution_entitlements_v1` is NOT touched.
-- Indexes: none added. The plan-label probe rides the same
--   `student_subscriptions(student_id)` + `subscription_plans.plan_code` unique
--   access as `get_plan_limit()`; the usage probe is unchanged.
--
--
-- IDEMPOTENCY
-- ─────────────────────────────────────────────────────────────────────────────
-- `CREATE OR REPLACE FUNCTION` for both functions (same names, same argument
-- types, same return types — no DROP, no dependency breakage). REVOKEs are
-- idempotent by nature. The verification block is read-only and fail-soft.
-- Safe to re-run any number of times; no data is written.
--
--
-- REVERSIBILITY — MANUAL DOWN (do NOT auto-run; operator decision only)
-- ─────────────────────────────────────────────────────────────────────────────
-- Restores the exact pre-change body (baseline L5292-5295, reformatted only —
-- semantics identical). Note this reinstates the duplicated limit logic and with
-- it the display/enforcement split; it is a display-only rollback and does NOT
-- undo 20260729130400 (that file carries its own separate DOWN).
--
--   CREATE OR REPLACE FUNCTION public.get_student_usage(p_student_id uuid)
--   RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $down$
--   DECLARE
--     v_plan       text DEFAULT 'free';
--     v_foxy_limit int  DEFAULT 5;
--     v_quiz_limit int  DEFAULT 3;
--     v_u          record;
--   BEGIN
--     SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
--     INTO   v_plan, v_foxy_limit, v_quiz_limit
--     FROM   student_subscriptions ss
--     JOIN   subscription_plans sp ON ss.plan_id = sp.id
--     WHERE  ss.student_id = p_student_id AND ss.status = 'active'
--     ORDER BY sp.sort_order DESC LIMIT 1;
--     IF v_plan IS NULL THEN v_plan := 'free'; v_foxy_limit := 5; v_quiz_limit := 3; END IF;
--     SELECT * INTO v_u FROM student_daily_usage
--      WHERE student_id = p_student_id AND usage_date = CURRENT_DATE;
--     RETURN jsonb_build_object(
--       'plan', v_plan,
--       'foxy',     jsonb_build_object('used', COALESCE(v_u.foxy_chats_used,0), 'limit', v_foxy_limit),
--       'quiz',     jsonb_build_object('used', COALESCE(v_u.quizzes_used,0),    'limit', v_quiz_limit),
--       'notes',    jsonb_build_object('used', COALESCE(v_u.notes_generated,0), 'limit', CASE v_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE -1 END),
--       'ai_total', jsonb_build_object('used', COALESCE(v_u.ai_calls_total,0),  'limit', CASE v_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE -1 END));
--   END;
--   $down$;
--   REVOKE EXECUTE ON FUNCTION public.get_student_usage(uuid) FROM PUBLIC, anon, authenticated;
--   -- optionally, to remove the helper too (nothing else references it):
--   DROP FUNCTION IF EXISTS public.usage_limit_for_display(integer);
--
-- Owner: architect.
-- Review chain (P14): backend (usage-widget feed + the TS display authority
-- named above), frontend (Foxy usage badge), ai-engineer (P12 daily-limit copy),
-- ops (school demo runbook), testing (regression pin: display == enforcement).

BEGIN;

-- ── 1. Sentinel adapter: get_plan_limit's 999999 -> this function's -1 ───────
-- Two unlimited sentinels exist in the system by design:
--   -1     : the DB DISPLAY sentinel — what `get_student_usage` has always
--            returned for an unlimited tier, and what `subscription_plans`
--            stores (20260714120000 set foxy_chats_per_day = -1 for paid plans).
--   999999 : the ENFORCEMENT/TS sentinel — what `get_plan_limit()` returns, and
--            `UNLIMITED_USAGE_SENTINEL` in packages/lib/src/usage-sentinel.ts.
-- This adapter exists solely so delegating to `get_plan_limit()` does NOT leak
-- the enforcement sentinel into a response shape that has always used -1.
-- It is NOT a limit authority: it cannot invent, raise or lower a finite cap —
-- it is a pure total function on one integer.
CREATE OR REPLACE FUNCTION public.usage_limit_for_display(p_limit integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  -- >= (not =) so any future "very large means unlimited" value also folds to
  -- the display sentinel instead of rendering as a literal count.
  SELECT CASE WHEN p_limit IS NULL THEN NULL
              WHEN p_limit >= 999999 THEN -1
              ELSE p_limit
         END;
$$;

COMMENT ON FUNCTION public.usage_limit_for_display(integer) IS
  'Translates get_plan_limit()''s unlimited sentinel (999999, = '
  'UNLIMITED_USAGE_SENTINEL in packages/lib/src/usage-sentinel.ts) into the '
  'DB display sentinel (-1) used by get_student_usage()''s JSON contract. Pure '
  'presentation adapter — never a limit authority; finite values pass through '
  'untouched.';

-- ── 2. get_student_usage — limits fully delegated to get_plan_limit() ───────
CREATE OR REPLACE FUNCTION public.get_student_usage(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- `v_plan` is now a LABEL ONLY. It no longer feeds any limit. Deliberately
  -- there is no v_foxy_limit / v_quiz_limit default here any more — that pair of
  -- literals WAS the duplicated authority this migration deletes.
  v_plan text := 'free';
  -- Today's counts. Scalars rather than the previous `record`: with the
  -- to_regclass guard below, a `record` could be left UNASSIGNED and every
  -- `v_u.<col>` reference would then raise `record "v_u" is not assigned yet`.
  -- Scalars pre-initialised to 0 make the guarded path total. Values produced
  -- are identical to the previous COALESCE(v_u.<col>, 0).
  v_foxy_used  int := 0;
  v_quiz_used  int := 0;
  v_notes_used int := 0;
  v_ai_used    int := 0;
BEGIN
  ---------------------------------------------------------------------------
  -- 2a. PLAN LABEL for the `plan` key.
  --     Resolved with the SAME join + status filter as get_plan_limit()'s
  --     personal branch (plan_code, IN ('active','trial'), sort_order DESC),
  --     so the label and the limits agree about which subscription row won.
  --     Divergences (1) and (2) from the header are resolved right here.
  ---------------------------------------------------------------------------
  IF to_regclass('public.student_subscriptions') IS NOT NULL
     AND to_regclass('public.subscription_plans') IS NOT NULL THEN
    SELECT sp.plan_code
    INTO   v_plan
    FROM   student_subscriptions ss
    JOIN   subscription_plans sp ON sp.plan_code = ss.plan_code
    WHERE  ss.student_id = p_student_id
      AND  ss.status IN ('active', 'trial')
    ORDER BY sp.sort_order DESC
    LIMIT 1;
  END IF;

  IF v_plan IS NULL THEN
    v_plan := 'free';
  END IF;

  ---------------------------------------------------------------------------
  -- 2b. TODAY'S COUNTS — VALUE-IDENTICAL to the previous body, on purpose.
  --     Same four source columns, same predicate (student_id + CURRENT_DATE),
  --     same "no row / NULL column => 0" outcome. Only the variable form
  --     changed (record -> scalars) to make the to_regclass guard total; no
  --     count can differ from what this function returned before.
  --     See the "KNOWN DEFECT DELIBERATELY NOT FIXED HERE" note in the header:
  --     these wide columns have no writer, so `used` is effectively always 0.
  --     Fixing that is a separate change with its own review chain, so the
  --     behaviour is carried over untouched rather than quietly corrected here.
  ---------------------------------------------------------------------------
  IF to_regclass('public.student_daily_usage') IS NOT NULL THEN
    SELECT COALESCE(u.foxy_chats_used, 0),
           COALESCE(u.quizzes_used, 0),
           COALESCE(u.notes_generated, 0),
           COALESCE(u.ai_calls_total, 0)
    INTO   v_foxy_used, v_quiz_used, v_notes_used, v_ai_used
    FROM   student_daily_usage u
    WHERE  u.student_id = p_student_id
      AND  u.usage_date = CURRENT_DATE;

    -- No matching row leaves the targets NULL — restore the 0 default so the
    -- JSON never carries a null `used` (the old COALESCE(v_u.<col>,0) on an
    -- all-NULL record produced 0 here).
    v_foxy_used  := COALESCE(v_foxy_used, 0);
    v_quiz_used  := COALESCE(v_quiz_used, 0);
    v_notes_used := COALESCE(v_notes_used, 0);
    v_ai_used    := COALESCE(v_ai_used, 0);
  END IF;

  ---------------------------------------------------------------------------
  -- 2c. LIMITS — the single authority. Four calls, zero local policy.
  --     `get_plan_limit()` already accounts for: the personal (B2C) plan, the
  --     -1 -> 999999 unlimited mapping, and — since 20260729130400 — school
  --     (B2B) coverage via GREATEST(personal, school-derived). Because the
  --     widget now reads the same function the enforcement path reads, a
  --     school-covered student is DISPLAYED exactly what they are ALLOWED.
  --
  --     'ai_total' is not a named branch inside get_plan_limit(); it lands on
  --     that function's ELSE arm (free 15 / starter 50 / pro 200 / else
  --     unlimited), which is exactly the CASE this function used to carry.
  --
  --     Defensive guard: if get_plan_limit() is somehow absent (a partially
  --     migrated DB — it ships in the same baseline as this function, so this
  --     is unreachable in practice), fall back to that function's OWN
  --     documented no-subscription values rather than inventing a policy.
  --
  --     COST: four calls where there used to be one catalog lookup. Each is a
  --     STABLE indexed probe (subscription + optional school coverage); this is
  --     a widget read, not a hot enforcement path, and correctness-by-single-
  --     authority is worth more here than one saved round of index lookups.
  ---------------------------------------------------------------------------
  IF to_regprocedure('public.get_plan_limit(uuid, text)') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'plan', v_plan,
      'foxy', jsonb_build_object(
        'used',  v_foxy_used,
        'limit', public.usage_limit_for_display(public.get_plan_limit(p_student_id, 'foxy_chat'))),
      'quiz', jsonb_build_object(
        'used',  v_quiz_used,
        'limit', public.usage_limit_for_display(public.get_plan_limit(p_student_id, 'quiz'))),
      'notes', jsonb_build_object(
        'used',  v_notes_used,
        'limit', public.usage_limit_for_display(public.get_plan_limit(p_student_id, 'notes'))),
      'ai_total', jsonb_build_object(
        'used',  v_ai_used,
        'limit', public.usage_limit_for_display(public.get_plan_limit(p_student_id, 'ai_total')))
    );
  END IF;

  -- Unreachable in any environment that has get_student_usage at all. These are
  -- get_plan_limit()'s own free-tier fallbacks restated, NOT a second policy.
  RETURN jsonb_build_object(
    'plan', v_plan,
    'foxy',     jsonb_build_object('used', v_foxy_used,  'limit', 5),
    'quiz',     jsonb_build_object('used', v_quiz_used,  'limit', 5),
    'notes',    jsonb_build_object('used', v_notes_used, 'limit', 2),
    'ai_total', jsonb_build_object('used', v_ai_used,    'limit', 15)
  );
END;
$$;

COMMENT ON FUNCTION public.get_student_usage(uuid) IS
  'Read-only usage-widget feed. Every `limit` is delegated to get_plan_limit() '
  '— the single limit authority, which since 20260729130400 also honours school '
  '(B2B) coverage — and translated back to this function''s -1 unlimited '
  'display sentinel by usage_limit_for_display(). Holds NO limit logic of its '
  'own, so what a student SEES cannot drift from what is ENFORCED. The `plan` '
  'key is the PERSONAL (B2C) plan code only and is a label, not a limit source. '
  'KNOWN DEFECT (pre-existing, out of scope): the `used` values read '
  'student_daily_usage wide columns that check_and_record_usage() never writes, '
  'so they are effectively always 0.';

-- ── 3. EXECUTE posture ──────────────────────────────────────────────────────
-- Re-assert the hardening set by 20260516040000 / 20260516050000 rather than
-- relying implicitly on CREATE OR REPLACE preserving the ACL.
REVOKE EXECUTE ON FUNCTION public.get_student_usage(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_student_usage(uuid) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.usage_limit_for_display(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.usage_limit_for_display(integer) FROM anon, authenticated;

-- ── 4. Deploy-log verification — read-only, fail-soft (never throws) ────────
DO $verify$
DECLARE
  v_free_foxy int;
  v_free_quiz int;
  rec         record;
BEGIN
  -- Sentinel adapter sanity.
  IF public.usage_limit_for_display(999999) IS DISTINCT FROM -1
     OR public.usage_limit_for_display(5) IS DISTINCT FROM 5
     OR public.usage_limit_for_display(NULL) IS DISTINCT FROM NULL THEN
    RAISE WARNING '[get_student_usage_single_authority] usage_limit_for_display() drift — expected 999999->-1, 5->5, NULL->NULL';
  END IF;

  -- Surface the REAL free-plan catalog row. This is the number the header's
  -- divergence (3) could not be resolved from source. Operators: read this.
  IF to_regclass('public.subscription_plans') IS NOT NULL THEN
    SELECT foxy_chats_per_day, quizzes_per_day
      INTO v_free_foxy, v_free_quiz
      FROM public.subscription_plans
     WHERE plan_code = 'free'
     LIMIT 1;

    IF v_free_quiz IS NULL THEN
      RAISE NOTICE '[get_student_usage_single_authority] no free plan row in subscription_plans; get_plan_limit() free fallback (foxy 5 / quiz 5) applies';
    ELSE
      RAISE NOTICE '[get_student_usage_single_authority] ENFORCED free-tier caps: foxy_chats_per_day=% quizzes_per_day=% (-1 = unlimited)',
        v_free_foxy, v_free_quiz;

      IF v_free_quiz <> 5 THEN
        RAISE WARNING '[get_student_usage_single_authority] free quizzes_per_day=% but the TS display constant PLAN_LIMITS.free.quiz (packages/lib/src/usage.ts) and Flutter _quizLimit() default are both 5 — display/enforcement disagree OUTSIDE SQL. Reconcile (data or code); this migration deliberately did not pick a side.',
          v_free_quiz;
      END IF;
    END IF;

    FOR rec IN
      SELECT plan_code, foxy_chats_per_day, quizzes_per_day
        FROM public.subscription_plans
       ORDER BY sort_order DESC, plan_code
    LOOP
      RAISE NOTICE '[get_student_usage_single_authority] catalog plan_code=% foxy=% quiz=%',
        rec.plan_code, rec.foxy_chats_per_day, rec.quizzes_per_day;
    END LOOP;
  END IF;

  RAISE NOTICE '[get_student_usage_single_authority] get_student_usage() now delegates ALL four limits to get_plan_limit(); return shape unchanged; `used` values unchanged (known pre-existing defect).';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[get_student_usage_single_authority] verification block skipped: %', SQLERRM;
END $verify$;

COMMIT;
