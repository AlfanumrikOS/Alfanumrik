-- Migration: 20260729130400_get_plan_limit_school_coverage.sql
--
-- PURPOSE (P0-1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Make the server-authoritative daily quota resolver `get_plan_limit()` respect
-- SCHOOL (B2B) coverage, not just the student's own personal (B2C) subscription.
--
-- THE BUG: `get_plan_limit(p_student_id, p_feature)` read ONLY
-- `student_subscriptions` JOIN `subscription_plans`, falling back to free/5. It
-- never consulted `schools` / `school_subscriptions`. A student fully covered by
-- a paid or trial SCHOOL plan therefore still received the free-tier cap of
-- 5 Foxy chats/day. `check_and_record_usage()` derives its limit from this same
-- function, so the free cap was enforced at the moment of use. This is what made
-- the school demo fail.
--
-- WHAT THIS CHANGES
--   effective_limit = GREATEST(personal_plan_limit, school_derived_limit)
-- A student can only ever GAIN capacity here. School coverage NEVER lowers a
-- limit the student already had — the return is `v_personal` unless the school
-- branch produces a STRICTLY GREATER number.
--
--
-- CONTRACT
-- ─────────────────────────────────────────────────────────────────────────────
-- Signature UNCHANGED: public.get_plan_limit(p_student_id uuid, p_feature text)
--   RETURNS integer, LANGUAGE plpgsql, STABLE, SECURITY DEFINER,
--   SET search_path = 'public'.
-- Volatility, security, search_path and return type are preserved byte-for-byte
-- from the baseline definition (`00000000000000_baseline_from_prod.sql` L4779)
-- so every existing caller — notably `check_and_record_usage()` (baseline L1893)
-- and `record_ai_usage()` (baseline L2006) — is unaffected in shape.
--
-- SECURITY DEFINER justification (carried over, unchanged from the baseline):
--   the function must read `subscription_plans` / `student_subscriptions` — and
--   now `school_subscriptions` / roster tables — on behalf of a caller who has
--   no RLS grant on those tables. It is a pure read that returns a single
--   integer for a student id the caller already holds; it leaks no rows and no
--   PII (P13). EXECUTE remains REVOKEd from PUBLIC/anon/authenticated (see §4;
--   migrations 20260516040000 and 20260516050000 set that posture and this file
--   re-asserts it, since CREATE OR REPLACE preserves — but we do not want to
--   silently depend on — the pre-existing ACL).
--
-- P8 (RLS): NO RLS posture change. No table is created, altered, or dropped.
--   No policy is added, changed or removed. This migration only replaces one
--   function body and adds three pure helper functions.
-- P5 (grades): no grade column is read or written anywhere in this file.
-- P11: no pricing, no subscription status, no payment record is touched. This
--   grants entitlement strictly as a FUNCTION of already-verified subscription
--   rows (`school_subscriptions.status IN ('active','trial')`) — it never
--   creates access without an existing paid/trial row.
--
--
-- PRECEDENCE RULE IMPLEMENTED (mirrors packages/lib/src/entitlements/effective-plan.ts)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Resolve `v_personal` EXACTLY as before (unchanged query, unchanged free
--    fallback, unchanged -1 → 999999 mapping, unchanged notes/default CASE).
-- 2. Resolve the covering school's `school_subscriptions.plan` text and map it
--    into the CONSUMER tier space via `public.school_plan_to_consumer_code()`,
--    which reproduces `SCHOOL_PLAN_TO_CONSUMER` from effective-plan.ts VERBATIM:
--        trial          -> pro
--        basic          -> starter
--        standard       -> pro
--        premium        -> pro
--        enterprise     -> unlimited
--        school_premium -> unlimited
--    with the same fall-through to the canonical consumer normaliser
--    (`normalizePlanCode`: strip _monthly/_yearly, then basic->starter,
--    premium->pro, ultimate->unlimited) and the same fail-closed default to
--    'free' for anything still unrecognised. If a student is linked to more than
--    one covering school, the HIGHEST consumer tier wins (ranking = planTier()
--    from packages/lib/src/plans.ts: free=0, starter=1, pro=2, unlimited=3,
--    reproduced in `public.consumer_plan_tier()`).
-- 3. Look the mapped consumer code up in `subscription_plans` and compute the
--    school-derived limit with the SAME CASE expression used for the personal
--    limit (so a school 'pro' gets literally the 'pro' catalog row's caps —
--    including the -1 → 999999 unlimited sentinel set by 20260714120000).
-- 4. RETURN the greater of the two. Ties and NULLs return the personal value.
--
-- KNOWN, DELIBERATE DIVERGENCE FROM effective-plan.ts (case-folding): the TS map
-- is case-sensitive on the raw `school_subscriptions.plan` string; this SQL
-- lower()/btrim()s first. A stray 'Premium' therefore resolves to 'pro' here and
-- to 'free' in TS. That divergence is on the OVER-GRANT side only (see the seat
-- note below for why that direction is the safe one) and is called out here so
-- it is not mistaken for a third authority. The TIER MAPPING ITSELF is identical.
--
--
-- SEAT DEFINITION — WHY THE BROADEST ONE (deliberate, documented)
-- ─────────────────────────────────────────────────────────────────────────────
-- This repo currently carries THREE different definitions of "an active student
-- of a school", and they disagree:
--   (a) `class_students` roster rows  (the section-roster table)
--   (b) `class_enrollments` roster rows (the bulk-import / enroll-page table)
--   (c) `COUNT(students WHERE school_id = X AND is_active)` — the raw link,
--       used by several existing API routes.
-- `_school_active_student_ids()` (migration 20260614000001) standardises SEAT
-- BILLING on the UNION of (a) and (b), and explicitly notes that this roster
-- definition is STRICTER than (c). `studentOccupiesSeat()` in effective-plan.ts
-- mirrors that stricter (a)∪(b) definition.
--
-- For a BILLING/CAP decision, stricter is correct — you must not under-count
-- billable seats. For a GRANT decision the asymmetry inverts: under-granting
-- silently breaks a paying school's students mid-lesson (the exact P0 we are
-- fixing), while over-granting costs at most some extra AI calls for a student
-- who is already linked to a paying school. So this function uses the UNION OF
-- ALL THREE — (a) ∪ (b) ∪ (c) — as the covering-school candidate set, and does
-- NOT additionally require `classes.is_active` / `classes.deleted_at IS NULL`
-- or `students.is_active`. It is a strict SUPERSET of both the seat-billing
-- definition and the effective-plan.ts definition, so it can never grant LESS
-- than either.
-- This intentionally does NOT change seat billing: `_school_active_student_ids()`
-- is untouched and remains the sole authority for what a school is charged for.
-- FOLLOW-UP (not fixed here): converge the three definitions behind one helper.
--
--
-- STRICT NO-OP FOR PURE B2C — how it is guaranteed
-- ─────────────────────────────────────────────────────────────────────────────
--   1. §1 (the personal branch) is copied byte-for-byte from the baseline body:
--      same SELECT, same ORDER BY sp.sort_order DESC LIMIT 1, same
--      `IF v_plan IS NULL` free fallback (5/5), same feature CASE.
--   2. The school branch cannot produce a value unless the candidate-school set
--      is NON-EMPTY. For a student with `school_id IS NULL` and no roster row on
--      either table, all three UNION arms return zero rows, the join to
--      `school_subscriptions` returns zero rows, `v_school_code` stays NULL and
--      the function returns `v_personal`.
--   3. Even with a school link, the branch short-circuits to `v_personal` when
--      the school has no `status IN ('active','trial')` subscription, when the
--      mapped code is 'free', or when no `subscription_plans` row exists for the
--      mapped code.
--   4. The final statement is `RETURN GREATEST(v_personal, v_school)`. SQL
--      GREATEST ignores NULL arguments, so a NULL `v_school` — the value on
--      every B2C path — returns exactly `v_personal`; a lower or equal school
--      tier is likewise indistinguishable from today.
--   5. Any error raised inside the school branch (missing table on a partially
--      migrated DB, permission surprise, etc.) is trapped and degrades to
--      "no school contribution" — it can never fail a quota check that would
--      have succeeded before.
--   6. `to_regclass()` guards precede every optional-table read, so the function
--      is safe on a fresh DB where roster tables may not yet exist.
--
--
-- IDEMPOTENCY
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION throughout (same names, same argument types, same
-- return types — no DROP needed, no dependency breakage). REVOKE statements are
-- idempotent by nature. Safe to re-run any number of times. No data is written.
--
--
-- REVERSIBILITY — MANUAL DOWN (do NOT auto-run; run only on operator decision)
-- ─────────────────────────────────────────────────────────────────────────────
-- This is also the operational KILL SWITCH: it restores the exact pre-change
-- behaviour with a single statement and no application deploy.
--
--   CREATE OR REPLACE FUNCTION public.get_plan_limit(p_student_id uuid, p_feature text)
--   RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $down$
--   DECLARE
--     v_plan     text := 'free';
--     v_foxy_lim int  := 5;
--     v_quiz_lim int  := 5;
--   BEGIN
--     SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
--     INTO   v_plan, v_foxy_lim, v_quiz_lim
--     FROM   student_subscriptions ss
--     JOIN   subscription_plans sp ON sp.plan_code = ss.plan_code
--     WHERE  ss.student_id = p_student_id
--       AND  ss.status IN ('active', 'trial')
--     ORDER BY sp.sort_order DESC
--     LIMIT 1;
--     IF v_plan IS NULL THEN
--       v_plan := 'free'; v_foxy_lim := 5; v_quiz_lim := 5;
--     END IF;
--     RETURN CASE p_feature
--       WHEN 'foxy_chat' THEN CASE WHEN v_foxy_lim = -1 THEN 999999 ELSE v_foxy_lim END
--       WHEN 'quiz'      THEN CASE WHEN v_quiz_lim = -1 THEN 999999 ELSE v_quiz_lim END
--       WHEN 'notes'     THEN CASE v_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE 999999 END
--       ELSE                   CASE v_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE 999999 END
--     END;
--   END;
--   $down$;
--   REVOKE EXECUTE ON FUNCTION public.get_plan_limit(uuid, text) FROM PUBLIC, anon, authenticated;
--   -- optionally, to remove the helpers too (nothing else references them):
--   DROP FUNCTION IF EXISTS public.school_plan_to_consumer_code(text);
--   DROP FUNCTION IF EXISTS public.consumer_plan_tier(text);
--   DROP FUNCTION IF EXISTS public.normalize_consumer_plan_code(text);
--
--
-- FEATURE FLAG: NONE, deliberately. No flag is created, seeded, read or flipped;
-- `ff_institution_entitlements_v1` is NOT touched. Rationale: the change is
-- monotone (it can only raise a cap), is a provable no-op for every B2C student,
-- and is already gated by the commercial reality it depends on — a school gets
-- the higher cap only while it holds an active|trial `school_subscriptions` row.
-- A default-OFF flag would ship the P0 still broken; the manual DOWN above is
-- the kill switch, and it needs no deploy.
--
-- Indexes: none added. The probes ride existing indexes — students PK,
-- idx_class_students_student / idx_class_students_student_active,
-- idx_class_enrollments_student (WHERE is_active), classes PK,
-- school_subscriptions_school_idx, subscription_plans plan_code unique.
--
-- Owner: architect.
-- Review chain (P14): backend (quota-consuming API routes), ai-engineer (Foxy
-- daily-limit enforcement, P12), ops (school demo / entitlement runbooks),
-- testing (regression pin for the B2C no-op + the school-covered grant).

BEGIN;

-- ── 1. Consumer-code normaliser — SQL twin of normalizePlanCode() ────────────
-- packages/lib/src/plans.ts: strip a trailing _monthly/_yearly, then apply
-- PLAN_ALIAS { basic: 'starter', premium: 'pro', ultimate: 'unlimited' }.
-- Anything not resolving to a known PLANS key falls back to 'free' (which is
-- what getPlanConfig()/planTier() do for an unknown code).
CREATE OR REPLACE FUNCTION public.normalize_consumer_plan_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE t.c
    WHEN 'free'      THEN 'free'
    WHEN 'starter'   THEN 'starter'
    WHEN 'pro'       THEN 'pro'
    WHEN 'unlimited' THEN 'unlimited'
    WHEN 'basic'     THEN 'starter'
    WHEN 'premium'   THEN 'pro'
    WHEN 'ultimate'  THEN 'unlimited'
    ELSE 'free'
  END
  FROM (
    SELECT regexp_replace(lower(btrim(coalesce(p_code, ''))), '_(monthly|yearly)$', '') AS c
  ) t;
$$;

COMMENT ON FUNCTION public.normalize_consumer_plan_code(text) IS
  'SQL twin of normalizePlanCode() in packages/lib/src/plans.ts. Strips a '
  'trailing _monthly/_yearly billing-cycle suffix and folds the legacy aliases '
  '(basic->starter, premium->pro, ultimate->unlimited). Unknown codes fail '
  'closed to ''free''. Keep in lockstep with plans.ts.';

-- ── 2. Tier ranking — SQL twin of planTier() ─────────────────────────────────
-- THE single ranking: free=0, starter=1, pro=2, unlimited=3. Used only to pick
-- the strongest coverage when a student is linked to more than one school.
CREATE OR REPLACE FUNCTION public.consumer_plan_tier(p_code text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE public.normalize_consumer_plan_code(p_code)
    WHEN 'starter'   THEN 1
    WHEN 'pro'       THEN 2
    WHEN 'unlimited' THEN 3
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.consumer_plan_tier(text) IS
  'SQL twin of planTier() in packages/lib/src/plans.ts (0=free, 1=starter, '
  '2=pro, 3=unlimited). The ONE ranking used to compare a B2B-derived tier '
  'against a B2C tier. Keep in lockstep with plans.ts.';

-- ── 3. B2B plan text -> consumer tier code ───────────────────────────────────
-- VERBATIM reproduction of SCHOOL_PLAN_TO_CONSUMER +
-- normalizeSchoolPlanToConsumerCode() in
-- packages/lib/src/entitlements/effective-plan.ts. If that map changes, change
-- it HERE in the same PR — these two are the same policy expressed twice.
CREATE OR REPLACE FUNCTION public.school_plan_to_consumer_code(p_plan text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE lower(btrim(coalesce(p_plan, '')))
    WHEN 'trial'          THEN 'pro'        -- trial schools get full module access
    WHEN 'basic'          THEN 'starter'
    WHEN 'standard'       THEN 'pro'
    WHEN 'premium'        THEN 'pro'
    WHEN 'enterprise'     THEN 'unlimited'
    WHEN 'school_premium' THEN 'unlimited'
    ELSE public.normalize_consumer_plan_code(p_plan)
  END;
$$;

COMMENT ON FUNCTION public.school_plan_to_consumer_code(text) IS
  'Maps a school_subscriptions.plan value into the consumer tier space so B2B '
  'and B2C coverage can be compared on one axis. Mirrors '
  'SCHOOL_PLAN_TO_CONSUMER in packages/lib/src/entitlements/effective-plan.ts '
  'exactly (trial->pro, basic->starter, standard->pro, premium->pro, '
  'enterprise->unlimited, school_premium->unlimited), falling through to '
  'normalize_consumer_plan_code() and finally ''free''.';

-- ── 4. get_plan_limit — personal limit, now floored by school coverage ───────
CREATE OR REPLACE FUNCTION public.get_plan_limit(p_student_id uuid, p_feature text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- personal (B2C) — names and defaults preserved from the baseline body
  v_plan       text := 'free';
  v_foxy_lim   int  := 5;
  v_quiz_lim   int  := 5;
  v_personal   int;
  -- school (B2B) — all NULL unless coverage is actually found
  v_has_roster boolean := false;
  v_code       text;
  v_s_plan     text;
  v_s_foxy     int;
  v_s_quiz     int;
  v_school     int;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. PERSONAL LIMIT — byte-identical to the previous definition.
  --    If this block ever diverges from the baseline, the B2C no-op proof in
  --    the header is void. Do not "tidy" it.
  ---------------------------------------------------------------------------
  SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
  INTO   v_plan, v_foxy_lim, v_quiz_lim
  FROM   student_subscriptions ss
  JOIN   subscription_plans sp ON sp.plan_code = ss.plan_code
  WHERE  ss.student_id = p_student_id
    AND  ss.status IN ('active', 'trial')
  ORDER BY sp.sort_order DESC
  LIMIT 1;

  -- Default free-tier if no active subscription
  IF v_plan IS NULL THEN
    v_plan     := 'free';
    v_foxy_lim := 5;
    v_quiz_lim := 5;
  END IF;

  -- -1 means unlimited → treat as a very large number
  v_personal := CASE p_feature
    WHEN 'foxy_chat' THEN CASE WHEN v_foxy_lim = -1 THEN 999999 ELSE v_foxy_lim END
    WHEN 'quiz'      THEN CASE WHEN v_quiz_lim = -1 THEN 999999 ELSE v_quiz_lim END
    WHEN 'notes'     THEN CASE v_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE 999999 END
    ELSE                   CASE v_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE 999999 END
  END;

  ---------------------------------------------------------------------------
  -- 2. SCHOOL COVERAGE — additive only. Every early RETURN below yields the
  --    pre-change value.
  ---------------------------------------------------------------------------
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.school_subscriptions') IS NULL
     OR to_regclass('public.subscription_plans') IS NULL THEN
    RETURN v_personal;
  END IF;

  v_has_roster := to_regclass('public.classes') IS NOT NULL
              AND to_regclass('public.class_students') IS NOT NULL
              AND to_regclass('public.class_enrollments') IS NOT NULL;

  BEGIN
    IF v_has_roster THEN
      -- Candidate covering schools = direct link ∪ class_students roster ∪
      -- class_enrollments roster (the deliberately BROADEST grant-side set —
      -- see the seat-definition note in the header).
      WITH candidate_schools AS (
        SELECT s.school_id AS school_id
        FROM   public.students s
        WHERE  s.id = p_student_id
          AND  s.school_id IS NOT NULL
        UNION
        SELECT c.school_id
        FROM   public.class_students cs
        JOIN   public.classes c ON c.id = cs.class_id
        WHERE  cs.student_id = p_student_id
          AND  COALESCE(cs.is_active, true) = true
          AND  c.school_id IS NOT NULL
        UNION
        SELECT c.school_id
        FROM   public.class_enrollments ce
        JOIN   public.classes c ON c.id = ce.class_id
        WHERE  ce.student_id = p_student_id
          AND  COALESCE(ce.is_active, true) = true
          AND  c.school_id IS NOT NULL
      )
      SELECT public.school_plan_to_consumer_code(ss.plan)
      INTO   v_code
      FROM   public.school_subscriptions ss
      JOIN   candidate_schools cand ON cand.school_id = ss.school_id
      WHERE  ss.status IN ('active', 'trial')
      ORDER BY public.consumer_plan_tier(public.school_plan_to_consumer_code(ss.plan)) DESC
      LIMIT 1;
    ELSE
      -- Fresh/partial DB without the roster tables: direct link only.
      SELECT public.school_plan_to_consumer_code(ss.plan)
      INTO   v_code
      FROM   public.school_subscriptions ss
      JOIN   public.students s ON s.school_id = ss.school_id
      WHERE  s.id = p_student_id
        AND  s.school_id IS NOT NULL
        AND  ss.status IN ('active', 'trial')
      ORDER BY public.consumer_plan_tier(public.school_plan_to_consumer_code(ss.plan)) DESC
      LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Degrade to "no school contribution". A quota check must never fail
    -- because the B2B lookup did.
    v_code := NULL;
  END;

  IF v_code IS NULL OR v_code = 'free' THEN
    RETURN v_personal;
  END IF;

  -- Resolve the school-derived tier through the SAME plan catalog the personal
  -- path uses, so 20260714120000's -1 (unlimited Foxy on paid plans) applies
  -- identically to school-covered students.
  SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
  INTO   v_s_plan, v_s_foxy, v_s_quiz
  FROM   subscription_plans sp
  WHERE  sp.plan_code = v_code
  LIMIT 1;

  IF v_s_plan IS NULL THEN
    RETURN v_personal;  -- mapped tier has no catalog row → no boost
  END IF;

  v_school := CASE p_feature
    WHEN 'foxy_chat' THEN CASE WHEN v_s_foxy = -1 THEN 999999 ELSE v_s_foxy END
    WHEN 'quiz'      THEN CASE WHEN v_s_quiz = -1 THEN 999999 ELSE v_s_quiz END
    WHEN 'notes'     THEN CASE v_s_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE 999999 END
    ELSE                   CASE v_s_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE 999999 END
  END;

  ---------------------------------------------------------------------------
  -- 3. GREATEST(personal, school) — a student NEVER loses access they had.
  --    GREATEST ignores NULL inputs, so:
  --      v_school NULL (every B2C path)      -> v_personal, unchanged
  --      v_school <= v_personal              -> v_personal, unchanged
  --      v_school >  v_personal              -> the school-derived cap
  ---------------------------------------------------------------------------
  RETURN GREATEST(v_personal, v_school);
END;
$$;

COMMENT ON FUNCTION public.get_plan_limit(uuid, text) IS
  'Server-authoritative daily limit for a student+feature. Returns '
  'GREATEST(personal B2C plan limit, school B2B coverage-derived limit) so a '
  'student covered by a paid/trial school plan is not capped at the free tier, '
  'and so school coverage can never LOWER an entitlement. Pure no-op for '
  'students with no school link and no active school subscription. School plan '
  'text is mapped into the consumer tier space by '
  'school_plan_to_consumer_code(), which mirrors SCHOOL_PLAN_TO_CONSUMER in '
  'packages/lib/src/entitlements/effective-plan.ts.';

-- ── 5. EXECUTE posture ──────────────────────────────────────────────────────
-- Re-assert the hardening set by 20260516040000 / 20260516050000 rather than
-- relying implicitly on CREATE OR REPLACE preserving the ACL. These functions
-- are internal: only SECURITY DEFINER callers and service_role need them.
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(uuid, text) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.normalize_consumer_plan_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.normalize_consumer_plan_code(text) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.consumer_plan_tier(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consumer_plan_tier(text) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.school_plan_to_consumer_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.school_plan_to_consumer_code(text) FROM anon, authenticated;

-- ── 6. Deploy-log verification — read-only, fail-soft (never throws) ────────
DO $verify$
DECLARE
  v_map record;
BEGIN
  -- Assert the B2B → consumer mapping matches effective-plan.ts.
  FOR v_map IN
    SELECT * FROM (VALUES
      ('trial',          'pro'),
      ('basic',          'starter'),
      ('standard',       'pro'),
      ('premium',        'pro'),
      ('enterprise',     'unlimited'),
      ('school_premium', 'unlimited'),
      ('nonsense_code',  'free')
    ) AS m(school_plan, expected_consumer)
  LOOP
    IF public.school_plan_to_consumer_code(v_map.school_plan) IS DISTINCT FROM v_map.expected_consumer THEN
      RAISE WARNING '[get_plan_limit_school_coverage] mapping drift: % -> % (expected %)',
        v_map.school_plan,
        public.school_plan_to_consumer_code(v_map.school_plan),
        v_map.expected_consumer;
    END IF;
  END LOOP;

  RAISE NOTICE '[get_plan_limit_school_coverage] get_plan_limit now returns GREATEST(personal, school-derived); B2C path unchanged.';
END $verify$;

COMMIT;
