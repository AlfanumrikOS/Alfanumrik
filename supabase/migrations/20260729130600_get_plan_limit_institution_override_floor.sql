-- Migration: 20260729130600_get_plan_limit_institution_override_floor.sql
--
-- PURPOSE
-- ─────────────────────────────────────────────────────────────────────────────
-- Close the "operator sets a per-school Foxy/quiz quota in
-- /super-admin/entitlements, but nothing in the enforcement path ever reads
-- it" gap. `/super-admin/entitlements` already writes school-scoped overrides
-- (e.g. `limit.foxy_chat_daily`, `limit.quiz_daily`) into
-- `institution_entitlements`, with full audit trail via `logAdminAudit`
-- (20260615205752). `getResolvedEntitlements()` / `isEntitledEnforced()`
-- (packages/lib/src/entitlements/resolver.ts) already read that table — but
-- `isEntitledEnforced()` has ZERO callers in the actual Foxy/quiz quota path.
-- The REAL enforcement + display authority is 100% SQL:
-- `check_and_record_usage()` and `get_student_usage()` both derive their limit
-- exclusively from `get_plan_limit(p_student_id, p_feature)`
-- (20260729130400, extended by 20260729130500 to be the SOLE limit
-- authority). `get_plan_limit()` never consulted `institution_entitlements`.
-- An operator could set an override in the panel, see it reflected in the
-- panel's own "resolved effective value" preview, and it would do NOTHING at
-- the point a student actually sends a Foxy message or starts a quiz. This
-- migration wires the override in as a THIRD candidate value inside
-- `get_plan_limit()`, so both enforcement (`check_and_record_usage`) and
-- display (`get_student_usage`) inherit the fix automatically, with ZERO
-- application/TS code changes required (mirrors the exact zero-TS-change
-- shape of 20260729130400/20260729130500).
--
--
-- WHAT THIS CHANGES
-- ─────────────────────────────────────────────────────────────────────────────
--   effective_limit = GREATEST(v_personal, v_school, v_institution_override)
-- `v_institution_override` is read from `institution_entitlements` for the
-- SAME candidate-school set 20260729130400 already computes for `v_school`
-- (direct `students.school_id` link ∪ `class_students` roster ∪
-- `class_enrollments` roster — the deliberately BROADEST grant-side set; see
-- that migration's "SEAT DEFINITION" note, unchanged and not re-litigated
-- here), filtered to:
--   - `entitlement_key = 'limit.foxy_chat_daily'` when `p_feature = 'foxy_chat'`
--   - `entitlement_key = 'limit.quiz_daily'`      when `p_feature = 'quiz'`
--   - anything else (`notes`, the `ai_total` ELSE arm) has NO override key in
--     the catalog (packages/lib/src/entitlements/catalog.ts only defines
--     limit.foxy_chat_daily / limit.quiz_daily as "Live limits (2)") and
--     therefore keeps falling through to the existing
--     GREATEST(v_personal, v_school) exactly as before — this migration is a
--     strict no-op for those two features.
-- `effective_from`/`effective_to` windows are honoured exactly as
-- `resolver.ts`'s `withinWindow()` does (NULL on either side = open-ended).
-- The stored `value` jsonb (`{max: number|null, period: text}`) is parsed by
-- the new `public.coerce_institution_limit_max()` helper, which mirrors
-- `resolver.ts`'s `coerceStoredValue()` + `toEffectiveMax()` EXACTLY:
--   - not an object, or an array           -> NULL (ignored — malformed)
--   - missing `max` key                    -> NULL (ignored — malformed)
--   - `period` not in day/week/month       -> NULL (ignored — malformed)
--   - `max` JSON null                      -> 999999 (UNLIMITED_SENTINEL)
--   - `max` a non-negative integer number  -> that integer
--   - anything else (negative, non-integer,
--     non-numeric, wrong type)             -> NULL (ignored — malformed)
-- A malformed row NEVER raises — it is simply excluded from the MAX()
-- aggregate below (see helper definition), so one bad row cannot break
-- quota resolution for any student, mirroring resolver.ts's fall-through
-- philosophy (never trust a stored value blindly).
-- If MULTIPLE covering schools each hold a valid override row, the HIGHEST
-- resolved value wins (`MAX()` over all matching, in-window, well-formed
-- rows) — same reasoning as 20260729130400's multi-school tie-break for
-- `v_school`.
--
--
-- PRECEDENCE DECISION — FLOOR, NOT REPLACE (explicit, not silently invented)
-- ─────────────────────────────────────────────────────────────────────────────
-- `RETURN GREATEST(v_personal, v_school, v_institution_override)`. An
-- admin-set institution override is a FLOOR the operator guarantees a
-- school's students AT MINIMUM — consistent with the existing invariant this
-- function already enforces twice over: "coverage can only raise a cap,
-- never lower one below what a student already resolves to personally."
-- `v_institution_override` competes on the exact same axis as `v_personal`
-- and `v_school` (all three are already-resolved integer daily caps, not
-- consumer-tier codes), so GREATEST is the correct, minimal extension — no
-- new comparison axis, no new tier mapping.
--
-- OPEN PRODUCT QUESTION FOR THE CEO (flagged, NOT resolved here): does a
-- future need exist for an admin override that CAPS a school BELOW its
-- tier-derived default — e.g. throttling an abusive or demo tenant's Foxy
-- spend? That is fundamentally different semantics (replace, not floor) and
-- would require either (a) a distinct entitlement_key namespace (e.g.
-- `limit.foxy_chat_daily_cap`) so a floor-grant and a ceiling-cap cannot be
-- confused in the same column, or (b) a sign/mode field on the stored value.
-- This is a DELIBERATE, SCOPED-OUT follow-up, not something to build
-- speculatively now — the panel today only ever markets overrides as
-- entitlement grants, and every existing write path
-- (`/api/super-admin/entitlements`) has no "this is a ceiling" affordance.
-- Building replace-semantics without that product decision and without a UI
-- that can express "cap below default" would silently create a foot-gun: an
-- operator setting what they believe is a floor could accidentally lower a
-- school's quota below its plan-derived default.
--
--
-- FLAG GATING — DELIBERATELY NOT GATED BEHIND ff_institution_entitlements_v1
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the SAME reasoning 20260729130400 already documented for the
-- school-tier floor, restated for this floor: the change is MONOTONIC
-- (GREATEST-based — it can only raise a student's effective cap, never
-- lower it) and is a provable no-op for every school with no
-- `institution_entitlements` row. Gating a monotonic, provably-safe floor
-- behind a still-OFF flag would ship this fix "wired but inert" — the exact
-- trap 20260729130400 was written specifically to avoid, and the trap this
-- whole task exists to close (an operator sets a quota in the panel and
-- nothing happens).
--
-- This is a DELIBERATE DIVERGENCE from `resolver.ts`'s `isEntitledEnforced()`,
-- not an inconsistency — the two gate DIFFERENT risk shapes:
--   - `isEntitledEnforced()` gates MODULE/FEATURE toggle enforcement
--     (`{enabled: true|false}`). Toggles are BLOCK-CAPABLE and
--     NON-MONOTONIC: flipping a feature/module to enforced can, for a
--     single misconfigured row, actively DENY a capability a school already
--     had (e.g. an operator fat-fingers a module to `{enabled:false}` and,
--     with enforcement live, students are locked out instantly). That is
--     exactly the class of risk a kill-switch flag exists to contain.
--   - This override is a LIMIT floor, always combined via GREATEST with two
--     other always-computed candidates. It cannot deny anything a student
--     already had; the worst case of a misconfigured row is a student
--     getting a HIGHER cap than intended, which is the same "over-grant
--     costs at most some extra AI calls" risk 20260729130400 already
--     accepted for `v_school`.
-- Do not "fix" this into flag-gated later without re-reading this paragraph
-- — the two mechanisms are not inconsistent, they manage different hazards.
--
--
-- CONTRACT
-- ─────────────────────────────────────────────────────────────────────────────
-- Signature UNCHANGED: public.get_plan_limit(p_student_id uuid, p_feature text)
--   RETURNS integer, LANGUAGE plpgsql, STABLE, SECURITY DEFINER,
--   SET search_path = 'public'. Preserved byte-for-byte from 20260729130400.
-- The PERSONAL (§1) computation block is left BYTE-FOR-BYTE UNCHANGED from
-- 20260729130400. The SCHOOL (§2, `v_school`) block's QUERIES (the
-- candidate_schools CTE, the school_subscriptions/subscription_plans
-- lookups, the CASE arms) are also byte-for-byte unchanged — but its
-- CONTROL FLOW is restructured from "early `RETURN v_personal`" to
-- "fall through with `v_school` left NULL", because execution must now
-- continue into the new §2b institution-override block regardless of
-- whether school-tier coverage applied. This is a VALUE-EQUIVALENT
-- restructuring, not a behaviour change: every condition that used to
-- `RETURN v_personal` immediately now instead leaves `v_school` at its
-- uninitialised NULL and proceeds — and `GREATEST(v_personal, NULL, …)`
-- degrades identically to a bare `v_personal` return once §2b also
-- resolves to NULL (the pure-B2C / no-override case). The multi-school
-- tie-break reasoning (highest consumer tier wins) is untouched, since the
-- ORDER BY / LIMIT 1 query itself did not change. Not refactored into a
-- shared helper with §2b (see below for why).
--
-- WHY THE CANDIDATE-SCHOOL CTE IS DUPLICATED, NOT EXTRACTED INTO A SHARED
-- HELPER: the task asked to "reuse that CTE/logic, don't rebuild it" — this
-- is honoured by copying the IDENTICAL candidate-school definition (same
-- three-way UNION, same predicates) verbatim into the new §2b block, rather
-- than refactoring `v_school`'s already-shipped, already-reviewed query to
-- call a new shared table function. Refactoring the existing `v_school`
-- query path carries strictly more regression risk than a byte-identical
-- duplicate for zero behavioural gain — `v_school`'s query is UNTOUCHED by
-- this file. If the two CTEs ever need to diverge (e.g. a future seat-status
-- filter for one but not the other) that will be an explicit, reviewed
-- decision instead of an accidental one from sharing code that was assumed
-- identical.
--
-- SECURITY DEFINER justification (carried over unchanged from
-- 20260729130400): the function must read `institution_entitlements` on
-- behalf of a caller who has no RLS grant on it (its RLS policies — see
-- 20260615205752 — grant service_role, school_admin-own-school, and
-- admin/super_admin only; a plain student/parent/teacher caller has none).
-- It is a pure read that returns a single integer for a student id the
-- caller already holds; it leaks no rows, no school identifiers, no
-- commercial-term details, and no PII (P13).
--
-- P8 (RLS): NO RLS posture change. No table is created, altered, or
--   dropped. No policy is added, changed or removed. This migration only
--   replaces `get_plan_limit()`'s body and adds one pure helper function.
-- P5 (grades): no grade column is read or written anywhere in this file.
-- P11: no pricing, no subscription status, no payment record is touched.
--   `institution_entitlements` rows are commercial-contract facts an
--   operator already explicitly wrote via the audited super-admin panel —
--   this migration only makes the enforcement/display path HONOUR a value
--   that already existed and was already visible in the panel's preview.
--
--
-- STRICT NO-OP FOR PURE B2C AND FOR SCHOOLS WITH NO OVERRIDE ROW
-- ─────────────────────────────────────────────────────────────────────────────
--   1. §1 (personal) is byte-for-byte unchanged. §2 (`v_school`)'s queries
--      are byte-for-byte unchanged and its CASE arms are unchanged; only its
--      control flow was restructured (early RETURN -> fall-through) as
--      described above. `v_school` resolves to the IDENTICAL value in every
--      case as it did under 20260729130400 — so that migration's no-op
--      proof (its header § "STRICT NO-OP FOR PURE B2C") still holds for the
--      school-tier term specifically, and is not re-derived here.
--   2. The new §2b (`v_institution_override`) branch cannot produce a
--      non-NULL value unless the candidate-school set is NON-EMPTY (same
--      guard structure as `v_school`: a student with `school_id IS NULL`
--      and no roster row on either table has all three UNION arms return
--      zero rows).
--   3. Even with a school link, `v_institution_override` stays NULL unless
--      that school (or any covering school) has an `institution_entitlements`
--      row for the EXACT `entitlement_key` this feature maps to, inside its
--      effective window, with a well-formed `{max, period}` value.
--   4. `p_feature NOT IN ('foxy_chat', 'quiz')` never resolves an
--      `entitlement_key`, so `v_institution_override` stays NULL for
--      `notes` and the `ai_total` ELSE arm unconditionally — those two
--      features are a hard no-op from this migration, full stop.
--   5. The final statement is
--      `RETURN GREATEST(v_personal, v_school, v_institution_override)`. SQL
--      GREATEST ignores NULL arguments, so a NULL `v_institution_override`
--      (every path in 2-4 above) returns exactly what 20260729130400
--      already returned; a lower-or-equal override is likewise
--      indistinguishable from today.
--   6. Any error raised inside the new institution-override block (missing
--      table on a partially migrated DB, permission surprise, a genuinely
--      unexpected data shape, etc.) is trapped and degrades to "no
--      institution contribution" — it can never fail a quota check that
--      would have succeeded before this migration.
--   7. `to_regclass()` guards precede the optional-table read, so the
--      function is safe on a fresh DB where `institution_entitlements` may
--      not yet exist (it does, as of 20260615205752, but the guard matches
--      this file's own established defensive style).
--
--
-- IDEMPOTENCY
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION throughout (same names, same argument types,
-- same return types — no DROP needed, no dependency breakage). REVOKE
-- statements are idempotent by nature. Safe to re-run any number of times.
-- No data is written.
--
--
-- REVERSIBILITY — MANUAL DOWN (do NOT auto-run; run only on operator
-- decision). This is also the operational KILL SWITCH: it restores
-- 20260729130400's exact post-change behaviour (personal + school coverage,
-- WITHOUT the institution-override floor) with a single statement and no
-- application deploy.
--
--   CREATE OR REPLACE FUNCTION public.get_plan_limit(p_student_id uuid, p_feature text)
--   RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $down$
--   DECLARE
--     v_plan       text := 'free';
--     v_foxy_lim   int  := 5;
--     v_quiz_lim   int  := 5;
--     v_personal   int;
--     v_has_roster boolean := false;
--     v_code       text;
--     v_s_plan     text;
--     v_s_foxy     int;
--     v_s_quiz     int;
--     v_school     int;
--   BEGIN
--     SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
--     INTO   v_plan, v_foxy_lim, v_quiz_lim
--     FROM   student_subscriptions ss
--     JOIN   subscription_plans sp ON sp.plan_code = ss.plan_code
--     WHERE  ss.student_id = p_student_id AND ss.status IN ('active', 'trial')
--     ORDER BY sp.sort_order DESC LIMIT 1;
--     IF v_plan IS NULL THEN v_plan := 'free'; v_foxy_lim := 5; v_quiz_lim := 5; END IF;
--     v_personal := CASE p_feature
--       WHEN 'foxy_chat' THEN CASE WHEN v_foxy_lim = -1 THEN 999999 ELSE v_foxy_lim END
--       WHEN 'quiz'      THEN CASE WHEN v_quiz_lim = -1 THEN 999999 ELSE v_quiz_lim END
--       WHEN 'notes'     THEN CASE v_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE 999999 END
--       ELSE                   CASE v_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE 999999 END
--     END;
--     IF to_regclass('public.students') IS NULL OR to_regclass('public.school_subscriptions') IS NULL
--        OR to_regclass('public.subscription_plans') IS NULL THEN RETURN v_personal; END IF;
--     v_has_roster := to_regclass('public.classes') IS NOT NULL
--                 AND to_regclass('public.class_students') IS NOT NULL
--                 AND to_regclass('public.class_enrollments') IS NOT NULL;
--     BEGIN
--       IF v_has_roster THEN
--         WITH candidate_schools AS (
--           SELECT s.school_id FROM public.students s WHERE s.id = p_student_id AND s.school_id IS NOT NULL
--           UNION
--           SELECT c.school_id FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id
--           WHERE cs.student_id = p_student_id AND COALESCE(cs.is_active, true) = true AND c.school_id IS NOT NULL
--           UNION
--           SELECT c.school_id FROM public.class_enrollments ce JOIN public.classes c ON c.id = ce.class_id
--           WHERE ce.student_id = p_student_id AND COALESCE(ce.is_active, true) = true AND c.school_id IS NOT NULL
--         )
--         SELECT public.school_plan_to_consumer_code(ss.plan) INTO v_code
--         FROM public.school_subscriptions ss JOIN candidate_schools cand ON cand.school_id = ss.school_id
--         WHERE ss.status IN ('active', 'trial')
--         ORDER BY public.consumer_plan_tier(public.school_plan_to_consumer_code(ss.plan)) DESC LIMIT 1;
--       ELSE
--         SELECT public.school_plan_to_consumer_code(ss.plan) INTO v_code
--         FROM public.school_subscriptions ss JOIN public.students s ON s.school_id = ss.school_id
--         WHERE s.id = p_student_id AND s.school_id IS NOT NULL AND ss.status IN ('active', 'trial')
--         ORDER BY public.consumer_plan_tier(public.school_plan_to_consumer_code(ss.plan)) DESC LIMIT 1;
--       END IF;
--     EXCEPTION WHEN OTHERS THEN v_code := NULL;
--     END;
--     IF v_code IS NULL OR v_code = 'free' THEN RETURN v_personal; END IF;
--     SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
--     INTO v_s_plan, v_s_foxy, v_s_quiz FROM public.subscription_plans sp WHERE sp.plan_code = v_code LIMIT 1;
--     IF v_s_plan IS NULL THEN RETURN v_personal; END IF;
--     v_school := CASE p_feature
--       WHEN 'foxy_chat' THEN CASE WHEN v_s_foxy = -1 THEN 999999 ELSE v_s_foxy END
--       WHEN 'quiz'      THEN CASE WHEN v_s_quiz = -1 THEN 999999 ELSE v_s_quiz END
--       WHEN 'notes'     THEN CASE v_s_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE 999999 END
--       ELSE                   CASE v_s_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE 999999 END
--     END;
--     RETURN GREATEST(v_personal, v_school);
--   END;
--   $down$;
--   REVOKE EXECUTE ON FUNCTION public.get_plan_limit(uuid, text) FROM PUBLIC, anon, authenticated;
--   DROP FUNCTION IF EXISTS public.coerce_institution_limit_max(jsonb);
--
--
-- Indexes: none added. The new probe rides
-- `idx_institution_entitlements_school_key` (school_id, entitlement_key) —
-- created by 20260615205752 — plus the same roster/school indexes
-- `v_school` already rides (students PK, idx_class_students_student(_active),
-- idx_class_enrollments_student (WHERE is_active), classes PK).
--
-- Owner: architect.
-- Review chain (P14): backend (Foxy/quiz quota-consuming API routes — no
-- code change required, but the behavioural contract of the limit they
-- already call has widened), ai-engineer (Foxy daily-limit enforcement,
-- P12), ops (the /super-admin/entitlements panel this migration finally
-- makes load-bearing — operator runbook should note the override now takes
-- effect immediately with no flag flip), testing (regression pin: B2C
-- no-op, school-with-no-override no-op, override-below-tier no-op,
-- override-above-tier grant, malformed-value fall-through, multi-school
-- highest-wins).

BEGIN;

-- ── 1. Institution-entitlement value coercion — SQL twin of resolver.ts's
--       coerceStoredValue() + toEffectiveMax(), restricted to the
--       max_period shape (the only shape limit.* keys use). ─────────────
CREATE OR REPLACE FUNCTION public.coerce_institution_limit_max(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    -- Not an object (includes JSON null, arrays, scalars) -> malformed.
    WHEN p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN NULL
    -- Missing the 'max' key entirely -> malformed.
    WHEN NOT (p_value ? 'max') THEN NULL
    -- period must be one of the three catalog periods -> else malformed.
    WHEN (p_value->>'period') NOT IN ('day', 'week', 'month') THEN NULL
    -- {max: null} => unlimited => the shared 999999 sentinel (matches
    -- toEffectiveMax()'s UNLIMITED_SENTINEL mapping and get_plan_limit()'s
    -- own -1 -> 999999 convention for the personal/school branches).
    WHEN jsonb_typeof(p_value->'max') = 'null' THEN 999999
    -- A non-negative integer JSON number -> that integer. The
    -- floor(x) = x check accepts "integer-valued" numbers like 5.0 (JS
    -- Number.isInteger(5.0) === true) and rejects true fractions like 5.5,
    -- matching coerceStoredValue()'s Number.isInteger() check exactly.
    WHEN jsonb_typeof(p_value->'max') = 'number'
         AND (p_value->>'max')::numeric >= 0
         AND (p_value->>'max')::numeric = floor((p_value->>'max')::numeric)
      THEN (p_value->>'max')::integer
    -- Negative, non-integer, non-numeric, or wrong JSON type -> malformed.
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.coerce_institution_limit_max(jsonb) IS
  'SQL twin of coerceStoredValue()+toEffectiveMax() in '
  'packages/lib/src/entitlements/resolver.ts, restricted to the max_period '
  'value shape ({max:number|null, period:day|week|month}) used by '
  'limit.foxy_chat_daily / limit.quiz_daily. Returns NULL for any malformed '
  'value (never raises) so a single bad row cannot break quota resolution; '
  'NULL is intentionally excluded by MAX() aggregation at the call site. '
  '{max:null} maps to the shared 999999 unlimited sentinel. Keep in '
  'lockstep with resolver.ts.';

-- ── 2. get_plan_limit — now floored by institution_entitlements overrides ───
CREATE OR REPLACE FUNCTION public.get_plan_limit(p_student_id uuid, p_feature text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- personal (B2C) — UNCHANGED from 20260729130400.
  v_plan       text := 'free';
  v_foxy_lim   int  := 5;
  v_quiz_lim   int  := 5;
  v_personal   int;
  -- school (B2B, tier-derived) — UNCHANGED from 20260729130400.
  v_has_roster boolean := false;
  v_code       text;
  v_s_plan     text;
  v_s_foxy     int;
  v_s_quiz     int;
  v_school     int;
  -- institution override (B2B, deal-specific floor) — NEW in this file.
  v_entitlement_key text;
  v_institution_override int;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. PERSONAL LIMIT — byte-identical to 20260729130400. Do not "tidy" it;
  --    the B2C no-op proof depends on this block staying untouched.
  ---------------------------------------------------------------------------
  SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
  INTO   v_plan, v_foxy_lim, v_quiz_lim
  FROM   student_subscriptions ss
  JOIN   subscription_plans sp ON sp.plan_code = ss.plan_code
  WHERE  ss.student_id = p_student_id
    AND  ss.status IN ('active', 'trial')
  ORDER BY sp.sort_order DESC
  LIMIT 1;

  IF v_plan IS NULL THEN
    v_plan     := 'free';
    v_foxy_lim := 5;
    v_quiz_lim := 5;
  END IF;

  v_personal := CASE p_feature
    WHEN 'foxy_chat' THEN CASE WHEN v_foxy_lim = -1 THEN 999999 ELSE v_foxy_lim END
    WHEN 'quiz'      THEN CASE WHEN v_quiz_lim = -1 THEN 999999 ELSE v_quiz_lim END
    WHEN 'notes'     THEN CASE v_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE 999999 END
    ELSE                   CASE v_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE 999999 END
  END;

  ---------------------------------------------------------------------------
  -- 2. SCHOOL (TIER-DERIVED) COVERAGE — same query logic as 20260729130400,
  --    restructured to fall through (no early RETURN) into §2b instead of
  --    returning immediately, so the institution-override term below can
  --    still be evaluated. v_school stays NULL in every "no boost" case,
  --    exactly as it would have in the pre-restructure early-RETURN form.
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
    v_code := NULL;
  END;

  IF v_code IS NOT NULL AND v_code <> 'free' THEN
    SELECT sp.plan_code, sp.foxy_chats_per_day, sp.quizzes_per_day
    INTO   v_s_plan, v_s_foxy, v_s_quiz
    FROM   subscription_plans sp
    WHERE  sp.plan_code = v_code
    LIMIT 1;

    IF v_s_plan IS NOT NULL THEN
      v_school := CASE p_feature
        WHEN 'foxy_chat' THEN CASE WHEN v_s_foxy = -1 THEN 999999 ELSE v_s_foxy END
        WHEN 'quiz'      THEN CASE WHEN v_s_quiz = -1 THEN 999999 ELSE v_s_quiz END
        WHEN 'notes'     THEN CASE v_s_plan WHEN 'free' THEN 2 WHEN 'starter' THEN 5 ELSE 999999 END
        ELSE                   CASE v_s_plan WHEN 'free' THEN 15 WHEN 'starter' THEN 50 WHEN 'pro' THEN 200 ELSE 999999 END
      END;
    END IF;
  END IF;

  ---------------------------------------------------------------------------
  -- 2b. INSTITUTION OVERRIDE (deal-specific floor) — NEW in this file.
  --     Additive only: v_institution_override starts and stays NULL unless
  --     every one of (a) a recognised feature, (b) a non-empty candidate-
  --     school set, (c) a matching in-window row, (d) a well-formed value
  --     is true. The candidate_schools CTE below is a byte-identical COPY
  --     of §2's — see the header for why it is duplicated, not shared.
  ---------------------------------------------------------------------------
  v_entitlement_key := CASE p_feature
    WHEN 'foxy_chat' THEN 'limit.foxy_chat_daily'
    WHEN 'quiz'      THEN 'limit.quiz_daily'
    ELSE NULL
  END;

  IF v_entitlement_key IS NOT NULL
     AND to_regclass('public.institution_entitlements') IS NOT NULL THEN
    BEGIN
      IF v_has_roster THEN
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
        SELECT MAX(public.coerce_institution_limit_max(ie.value))
        INTO   v_institution_override
        FROM   public.institution_entitlements ie
        JOIN   candidate_schools cand ON cand.school_id = ie.school_id
        WHERE  ie.entitlement_key = v_entitlement_key
          AND  (ie.effective_from IS NULL OR ie.effective_from <= now())
          AND  (ie.effective_to   IS NULL OR ie.effective_to   >= now());
      ELSE
        SELECT MAX(public.coerce_institution_limit_max(ie.value))
        INTO   v_institution_override
        FROM   public.institution_entitlements ie
        JOIN   public.students s ON s.school_id = ie.school_id
        WHERE  s.id = p_student_id
          AND  s.school_id IS NOT NULL
          AND  ie.entitlement_key = v_entitlement_key
          AND  (ie.effective_from IS NULL OR ie.effective_from <= now())
          AND  (ie.effective_to   IS NULL OR ie.effective_to   >= now());
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Degrade to "no institution contribution". A quota check must never
      -- fail because this optional lookup did.
      v_institution_override := NULL;
    END;
  END IF;

  ---------------------------------------------------------------------------
  -- 3. GREATEST(personal, school, institution override) — a student NEVER
  --    loses access they had before this migration. GREATEST ignores NULL
  --    inputs, so any of the three being NULL/lower/equal is indistinguish-
  --    able from 20260729130400's return value.
  ---------------------------------------------------------------------------
  RETURN GREATEST(v_personal, v_school, v_institution_override);
END;
$$;

COMMENT ON FUNCTION public.get_plan_limit(uuid, text) IS
  'Server-authoritative daily limit for a student+feature. Returns '
  'GREATEST(personal B2C plan limit, school B2B tier-derived limit, '
  'school B2B deal-specific institution_entitlements override) so a '
  'student is never capped below their personal plan, their school''s '
  'tier-derived coverage, or an explicit operator-set institution floor '
  '(set via /super-admin/entitlements). The institution-override term is a '
  'FLOOR, not a ceiling: it can only raise the effective cap. Pure no-op '
  'for students with no school link, and for schools with no matching '
  'institution_entitlements row. See 20260729130400 for the school-tier '
  'term and 20260729130600 for the institution-override term.';

-- ── 3. EXECUTE posture ──────────────────────────────────────────────────────
-- Re-assert the hardening set by 20260516040000 / 20260516050000 rather than
-- relying implicitly on CREATE OR REPLACE preserving the ACL.
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(uuid, text) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.coerce_institution_limit_max(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.coerce_institution_limit_max(jsonb) FROM anon, authenticated;

-- ── 4. Deploy-log verification — read-only, fail-soft (never throws) ────────
DO $verify$
DECLARE
  v_case  record;
  v_plan  record;
BEGIN
  -- 4a. coerce_institution_limit_max() sanity — mirrors resolver.ts's
  --     coerceStoredValue()/toEffectiveMax() cases.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('{"max": 100, "period": "day"}'::jsonb,     100),
      ('{"max": 5.0, "period": "week"}'::jsonb,     5),
      ('{"max": null, "period": "month"}'::jsonb,   999999),
      ('{"max": -1, "period": "day"}'::jsonb,       NULL::integer),
      ('{"max": 5.5, "period": "day"}'::jsonb,      NULL::integer),
      ('{"max": 100, "period": "fortnight"}'::jsonb, NULL::integer),
      ('{"foo": "bar"}'::jsonb,                     NULL::integer),
      ('null'::jsonb,                               NULL::integer),
      ('[1,2,3]'::jsonb,                             NULL::integer)
    ) AS c(raw_value, expected)
  LOOP
    IF public.coerce_institution_limit_max(v_case.raw_value) IS DISTINCT FROM v_case.expected THEN
      RAISE WARNING '[get_plan_limit_institution_override_floor] coerce_institution_limit_max drift: % -> % (expected %)',
        v_case.raw_value,
        public.coerce_institution_limit_max(v_case.raw_value),
        v_case.expected;
    END IF;
  END LOOP;

  -- 4b. LIVE CENSUS (not a hardcoded list): every DISTINCT
  --      school_subscriptions.plan value that school_plan_to_consumer_code()
  --      cannot recognise and therefore silently folds to 'free' (i.e. the
  --      school's tier-derived coverage, v_school, contributes nothing for
  --      that school). 'free' itself is excluded — that is a correctly
  --      recognised, intentional value, not a gap. This does NOT block the
  --      institution-override floor added by this migration (an operator
  --      can set an explicit override for any of these schools regardless
  --      of what their `plan` text says), but it is the underlying label
  --      gap this task surfaced and did not fix.
  IF to_regclass('public.school_subscriptions') IS NOT NULL THEN
    FOR v_plan IN
      SELECT DISTINCT ss.plan AS plan_value
      FROM   public.school_subscriptions ss
      WHERE  public.school_plan_to_consumer_code(ss.plan) = 'free'
        AND  lower(btrim(coalesce(ss.plan, ''))) <> 'free'
    LOOP
      RAISE WARNING '[get_plan_limit_institution_override_floor] school_subscriptions.plan=% is UNRECOGNISED by school_plan_to_consumer_code() and silently resolves to the free tier (0 tier-derived boost) for every school on that plan value. NOT auto-fixed here (commercial meaning unknown) — set an explicit institution_entitlements override for affected schools via /super-admin/entitlements, or map this value in school_plan_to_consumer_code() in a reviewed follow-up.',
        v_plan.plan_value;
    END LOOP;
  END IF;

  RAISE NOTICE '[get_plan_limit_institution_override_floor] get_plan_limit now returns GREATEST(personal, school-tier, institution-override); both prior no-op proofs unchanged.';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[get_plan_limit_institution_override_floor] verification block skipped: %', SQLERRM;
END $verify$;

COMMIT;
