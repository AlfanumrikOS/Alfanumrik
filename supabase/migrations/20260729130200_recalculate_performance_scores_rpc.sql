-- Migration: 20260729130200_recalculate_performance_scores_rpc.sql
-- Purpose: DSA audit CRITICAL — replace the JS-side, PostgREST-truncated nightly
--          performance-score recomputation with one set-based SQL RPC.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ DORMANT ARTIFACT — THIS FUNCTION IS INTENTIONALLY NOT CALLED BY ANYTHING
-- ═══════════════════════════════════════════════════════════════════════════
-- This migration ships the RPC only. Nothing invokes it: `daily-cron` continues
-- to call its dead TypeScript `recalculatePerformanceScores()` path, unchanged
-- by this file. Merging this file therefore changes no student's score.
--
-- Assessment reviewed this port and returned APPROVE WITH CONDITIONS: it may
-- merge DORMANT, but ACTIVATION IS REJECTED until a separate, flagged change
-- delivers ALL of the following:
--   1. Assessment sign-off on the two open scoring questions below (the
--      retention half-life unit, and the level-band divergence).
--   2. A feature flag `ff_perf_score_recompute_v1`, seeded OFF, gating the
--      daily-cron caller swap so the RPC can be turned off without a deploy.
--   3. A production `SELECT count(*) FROM performance_scores;` taken BEFORE the
--      first real run, recorded as the rollback/blast-radius baseline (the
--      upsert destroys the previous score in place).
--   4. A dry run with the notification CTE suppressed — the score_milestone
--      notifications are written in the SAME statement as the scores, so a
--      first activation against a population that has never had a real score
--      would fan out a milestone blast to every affected student at once.
-- Do not wire this into daily-cron, a cron entry, or any API route as part of
-- a "cleanup" pass. Activation is a deliberate, separately-approved change.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DEFECT AS REPORTED
-- ═══════════════════════════════════════════════════════════════════════════
-- supabase/functions/daily-cron/index.ts:423-749 (recalculatePerformanceScores)
-- issues five unbounded reads and aggregates them in JS:
--   concept_mastery      — no filter, no limit          (:427-430)
--   daily_activity       — 14d filter, no limit         (:509-512)
--   quiz_sessions        — 30d filter, no limit         (:529-532)
--   topic_mastery        — no filter, no limit          (:548-550)
--   performance_scores   — no filter, no limit          (:583-585)
-- Every one of them is silently capped at PostgREST's 1000-row default. Past
-- that, students simply vanish from the nightly recompute or are scored from a
-- fraction of their own mastery rows.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE PORT FOUND — READ THIS BEFORE TRUSTING THE OLD BEHAVIOUR
-- ═══════════════════════════════════════════════════════════════════════════
-- Porting the TypeScript line-by-line against the real DDL surfaced that
-- recalculatePerformanceScores does not merely truncate — it CANNOT COMPLETE.
-- Three of its reads name columns/tables that do not exist anywhere in the
-- migration chain (checked against 00000000000000_baseline_from_prod.sql and
-- every timestamped migration on top of it):
--
--   D1. `chapter_topics` (index.ts:443) DOES NOT EXIST. Zero occurrences in any
--       migration. concept_mastery.topic_id's actual FK is
--         concept_mastery_topic_id_fkey -> public.curriculum_topics(id)
--       (baseline:18924-18925). The JS treats the lookup error as FATAL
--       (`throw new Error(...)`, index.ts:446), so the whole step throws on
--       every tick the moment there is at least one concept_mastery row. The
--       nightly performance-score recompute is, today, dead — it writes nothing.
--
--   D2. `daily_activity.subject` (index.ts:511) DOES NOT EXIST. daily_activity
--       has `subjects_studied text[]` (baseline:11xxx block) and is UNIQUE on
--       (student_id, activity_date). This read fails soft (console.warn,
--       index.ts:513) so consistency_score would be 0 for every student even if
--       D1 were fixed.
--
--   D3. `topic_mastery.mastery_level` (index.ts:550) EXISTS but is TEXT
--       ('not_started' etc.), not a 0..1 number. The numeric column is
--       `mastery_percent double precision` on a 0-100 scale (baseline:14521;
--       the baseline itself carries the note "mastery_level is TEXT, use
--       mastery_percent ... 0-100 scale" at :5269-5270). Averaging the TEXT
--       column in JS yields NaN, which propagates through behaviorScore into
--       overall_score and serialises as null — a NOT NULL violation on
--       performance_scores.overall_score.
--
-- Because of D1 there is no observable production behaviour to preserve. This
-- port therefore reproduces the TypeScript's INTENT, on the real schema, with
-- every substitution called out inline and in the deliverable report. Nothing
-- is approximated silently.
--
--   D1 -> JOIN curriculum_topics (the real FK target) -> subjects for the
--         subject code, and take grade from curriculum_topics.grade as the
--         fallback the JS took from chapters.grade.
--   D2 -> derive the per-subject consistency key from
--         unnest(daily_activity.subjects_studied), which is where this table
--         actually records which subjects were studied on a given day.
--         BEHAVIOUR NOTE: consistency_score moves from structurally-always-0 to
--         actually computed. Max effect on overall_score is +4.0 points
--         (consistency is 4/20 of the behaviour component, which is 20% of
--         overall). Flagged for assessment sign-off. NOTE: this is the SMALLER
--         of the two open scoring items — see OPEN SCORING QUESTION 1 below,
--         where the ported half-life unit mismatch is worth ~25 points
--         typically and up to ~64.
--   D3 -> use mastery_percent / 100.0 so the velocity delta lands in the -1..+1
--         range the JS comment explicitly assumes ("range roughly -1 to +1",
--         index.ts:571) before the `50 + delta * 50` mapping.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FORMULA PARITY (weights and constants copied from the TS, unchanged)
-- ═══════════════════════════════════════════════════════════════════════════
--   GRADE_FLOOR   (index.ts:382-384) 6,7:0.30 8,9:0.20 10:0.15 11,12:0.10 else 0.10
--   BLOOM_CEILING (index.ts:387-390) remember .45 understand .60 apply .75
--                                    analyze .85 evaluate .95 create 1.00
--   highestBloomLevel (index.ts:403-410) first of
--                     create>evaluate>analyze>apply>understand>remember with
--                     value > 0.3; null map or no match => 'remember'
--   retention  = last_attempted_at IS NULL
--                  ? current_retention ?? 0
--                  : max(exp(-0.693 * days_since / max(half_life ?? 48, 0.5)),
--                        GRADE_FLOOR[grade])
--   effective  = (p_know ?? mastery_probability ?? 0) * retention * ceiling
--   perf       = avg(effective) over the student x subject group * 100
--   consistency= min(100, distinct_activity_days_14d / 14 * 100)
--   persistence= quizzes_started_30d > 0
--                  ? min(100, completed / started * 100) : 50
--   velocity   = clamp(0,100, 50 + (avg_mastery_last_7d - avg_mastery_7to14d)*50)
--   challenge = revision = breadth = 50 (neutral, not yet tracked)
--   behaviour  = consistency*4/20 + challenge*3/20 + revision*4/20
--              + persistence*3/20 + breadth*3/20 + velocity*3/20
--   overall    = clamp(0,100, perf*0.80 + behaviour*0.20)
--   level_name (index.ts:393-398) >=90 Star Explorer, >=75 Rising Champion,
--              >=60 Steady Learner, >=40 Brave Beginner, else Curious Cub
--
-- ═══════════════════════════════════════════════════════════════════════════
-- OPEN SCORING QUESTION 1 — THE HALF-LIFE UNIT MISMATCH (LARGEST OPEN ITEM)
-- ═══════════════════════════════════════════════════════════════════════════
-- `20260622020000_add_concept_mastery_cme_columns.sql:46` declares
-- concept_mastery.retention_half_life in HOURS — "Forgetting-curve half-life in
-- hours (4..720)" — with DEFAULT 48.0 (:30). The 4..720 range is NOT a CHECK
-- constraint; it is enforced procedurally by the writer RPCs
-- (GREATEST(4.0, ...) / LEAST(720.0, ...), e.g.
-- 20260623000100_fix_post_quiz_canonical_mastery.sql:220-222), which is why any
-- unit change has to move the writers too. The TS nevertheless divides
-- days_since_last_attempt (a value in DAYS) by that hours-denominated column
-- (index.ts:484-487). At the default the effective half-life is therefore 48
-- DAYS where the column means 48 HOURS — a 24× OVERSTATEMENT of retention.
--
-- SIZE THIS CORRECTLY: it is not a footnote. Because retention multiplies the
-- whole effective-mastery term and performance is 80% of overall_score, the
-- mismatch is worth UP TO ~64 POINTS and TYPICALLY ~25 POINTS of overall_score
-- — an ORDER OF MAGNITUDE larger than the +4.0-point consistency_score change
-- (D2) that this header previously singled out for sign-off. Read the two in
-- that proportion: D2 is the small one.
--
-- ASSESSMENT'S RULING: porting the mismatch VERBATIM was CORRECT. DO NOT "fix"
-- it in this file. A mechanical ×24 correction would collapse retention for
-- anyone with a gap in attempts and put every student who skips a weekend at
-- their GRADE_FLOOR — a platform-wide score cliff dressed up as a bug fix.
-- Resolution requires a deliberate, user-approved decision on the UNIT AND the
-- DEFAULT/RANGE TOGETHER (48 & 4..720 were chosen for hours; they are not
-- automatically the right numbers for days), shipped with the activation flag,
-- not folded into this port.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- OPEN SCORING QUESTION 2 — perf_score_level_name CONTRADICTS score-config
-- ═══════════════════════════════════════════════════════════════════════════
-- The 5 bands this file's perf_score_level_name emits (Star Explorer / Rising
-- Champion / Steady Learner / Brave Beginner / Curious Cub) exist in exactly
-- two places in the repo: the dead daily-cron TS, and this migration. They
-- CONTRADICT the canonical 10-band LEVEL_THRESHOLDS in
-- `packages/lib/src/score-config.ts` — Curious Cub 0-19, Quick Learner 20-34,
-- Rising Star 35-49, Knowledge Seeker 50-64, Smart Fox 65-74, Quiz Champion
-- 75-84, Study Master 85-89, Brain Ninja 90-94, Scholar Fox 95-97, Grand Master
-- 98-100 — on both band count AND cutoffs, and they collide on the name
-- "Curious Cub" at a different range. Only "Curious Cub" is shared; the other
-- four labels are unique to the dead path.
-- These MUST be reconciled — and cross-checked against
-- `mobile/lib/core/constants/score_config.dart`, whose drift from the TS twin
-- is pinned by REG-192 — BEFORE this RPC is ever wired to anything. Shipping it
-- as-is would put a second, contradictory band vocabulary into the database.
-- Until then the helper is service_role-EXECUTE-only (see the GRANT block at
-- the foot of this file) so the divergence cannot leak to a client surface.
--
-- ROUNDING: Math.round(x*100)/100 -> ROUND(x::numeric, 2). Postgres numeric
-- ROUND is half-away-from-zero and JS Math.round is half-up; every value here is
-- non-negative, where the two are identical.
--
-- CLAMPS: the TS clamps only `overall`. This port additionally clamps
-- performance_component and behavior_component into [0,100]. Reason: those two
-- columns carry CHECK constraints (baseline:12658, :12663), and a single
-- out-of-range row (e.g. a future-dated last_attempted_at makes exp(-negative)
-- exceed 1) would abort the ENTIRE set-based statement rather than one JS row.
-- The clamp is a no-op on every in-range value.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA (read from the baseline, not guessed)
-- ═══════════════════════════════════════════════════════════════════════════
--   performance_scores (baseline:12643-12667); UNIQUE (student_id, subject)
--     = performance_scores_student_id_subject_key (baseline:15727-15728)
--     -> conflict target (student_id, subject). NOT NULL: student_id, subject,
--        overall_score, performance_component, behavior_component, updated_at.
--     A BEFORE UPDATE trigger trg_performance_scores_updated_at
--     (baseline:18527) also maintains updated_at.
--   score_history (baseline:13500-13511); UNIQUE
--     (student_id, subject, recorded_at) (baseline:15987-15988).
--   notifications (baseline block); partial UNIQUE
--     (recipient_id, type, idempotency_key) WHERE idempotency_key IS NOT NULL
--     = notifications_idempotency_idx (20260505100100).
--     `message` is NOT NULL — see the note at the notifications CTE below.
--
-- SECURITY DEFINER justification (required by house rule): a nightly
-- maintenance writer that must read concept_mastery/daily_activity/quiz_sessions
-- /topic_mastery and write performance_scores/score_history/notifications for
-- EVERY student. All of those tables have RLS with per-student SELECT policies;
-- no single end-user security context can span the population. EXECUTE is
-- granted to service_role ONLY. search_path pinned to public, pg_temp.
--
-- Idempotent: CREATE OR REPLACE for all four functions; the write statement is
-- an upsert (ON CONFLICT DO UPDATE) plus an idempotency-keyed notification
-- insert (ON CONFLICT DO NOTHING), so re-running the same day is a no-op beyond
-- refreshing timestamps. No table created or dropped. No new table => no new RLS.
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.recalculate_performance_scores();
--           (plus the three helpers). The Edge Function's JS path is untouched
--           by this file.
--
-- REVIEW CHAIN (P14): assessment (scoring formula + the D2 consistency
--                     behaviour change + the ported half-life unit bug),
--                     backend (daily-cron caller swap), frontend (score
--                     surfaces + the bilingual notification copy),
--                     testing (formula-parity + >1000-row regression).

-- ───────────────────────────────────────────────────────────────────────────
-- Helper 1: GRADE_FLOOR — daily-cron/index.ts:382-384
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.perf_score_grade_floor(p_grade TEXT)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- P5: grades are STRINGS '6'..'12'. Never integers.
  SELECT CASE p_grade
    WHEN '6'  THEN 0.30
    WHEN '7'  THEN 0.30
    WHEN '8'  THEN 0.20
    WHEN '9'  THEN 0.20
    WHEN '10' THEN 0.15
    WHEN '11' THEN 0.10
    WHEN '12' THEN 0.10
    ELSE 0.10   -- mirrors `GRADE_FLOOR[grade] ?? 0.10`
  END::double precision;
$$;

COMMENT ON FUNCTION public.perf_score_grade_floor(TEXT) IS
  'Minimum retention floor by grade for the nightly Performance Score. Verbatim '
  'port of GRADE_FLOOR in supabase/functions/daily-cron/index.ts:382-384. '
  'P5: grade is TEXT.';

-- ───────────────────────────────────────────────────────────────────────────
-- Helper 2: highestBloomLevel -> BLOOM_CEILING, collapsed into one lookup.
--           daily-cron/index.ts:387-390 + :403-410
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.perf_score_bloom_ceiling(p_bloom_mastery JSONB)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- highestBloomLevel walks create > evaluate > analyze > apply > understand >
  -- remember and returns the first level whose mastery exceeds 0.3; a NULL map
  -- or no match returns 'remember'. Since BLOOM_CEILING['remember'] = 0.45 and
  -- the `?? 0.45` fallback is the same value, every miss collapses into one ELSE.
  --
  -- jsonb_typeof guards the cast: bloom_mastery is contractually a 6-key
  -- number map (migration 20260622020000) but is a free-form jsonb column, and
  -- a non-numeric value must not abort the whole nightly statement.
  SELECT CASE
    WHEN jsonb_typeof(p_bloom_mastery -> 'create')     = 'number'
         AND (p_bloom_mastery ->> 'create')::double precision     > 0.3 THEN 1.00
    WHEN jsonb_typeof(p_bloom_mastery -> 'evaluate')   = 'number'
         AND (p_bloom_mastery ->> 'evaluate')::double precision   > 0.3 THEN 0.95
    WHEN jsonb_typeof(p_bloom_mastery -> 'analyze')    = 'number'
         AND (p_bloom_mastery ->> 'analyze')::double precision    > 0.3 THEN 0.85
    WHEN jsonb_typeof(p_bloom_mastery -> 'apply')      = 'number'
         AND (p_bloom_mastery ->> 'apply')::double precision      > 0.3 THEN 0.75
    WHEN jsonb_typeof(p_bloom_mastery -> 'understand') = 'number'
         AND (p_bloom_mastery ->> 'understand')::double precision > 0.3 THEN 0.60
    ELSE 0.45   -- 'remember' ceiling: also the NULL-map and no-match fallback
  END::double precision;
$$;

COMMENT ON FUNCTION public.perf_score_bloom_ceiling(JSONB) IS
  'Bloom ceiling for the nightly Performance Score: highestBloomLevel() piped '
  'through BLOOM_CEILING. Verbatim port of '
  'supabase/functions/daily-cron/index.ts:387-390 and :403-410. Non-numeric '
  'jsonb values are treated as absent rather than raising.';

-- ───────────────────────────────────────────────────────────────────────────
-- Helper 3: levelName — daily-cron/index.ts:393-398
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.perf_score_level_name(p_score NUMERIC)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_score >= 90 THEN 'Star Explorer'
    WHEN p_score >= 75 THEN 'Rising Champion'
    WHEN p_score >= 60 THEN 'Steady Learner'
    WHEN p_score >= 40 THEN 'Brave Beginner'
    ELSE 'Curious Cub'
  END;
$$;

COMMENT ON FUNCTION public.perf_score_level_name(NUMERIC) IS
  'Performance Score band label. Verbatim port of levelName() in '
  'supabase/functions/daily-cron/index.ts:393-398. '
  '⚠ NOT FOR CLIENT USE — EXECUTE is granted to service_role ONLY. These 5 '
  'bands CONTRADICT the canonical 10-band LEVEL_THRESHOLDS in '
  'packages/lib/src/score-config.ts (and its mobile twin '
  'mobile/lib/core/constants/score_config.dart, drift-pinned by REG-192) on '
  'both band count and cutoffs; only the name "Curious Cub" is shared, at a '
  'different range. Reconcile the two before wiring this to anything. '
  'English only — no Hindi twin exists for these labels (P7).';

-- ───────────────────────────────────────────────────────────────────────────
-- Main RPC
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalculate_performance_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      timestamptz := now();
  -- The TS derives every date from UTC (`new Date().toISOString().slice(0,10)`,
  -- index.ts:508/:579 and todayUtcSlug() at :41-43). Anchored to UTC here for
  -- parity — deliberately NOT the IST anchor used by the quiz RPCs, because
  -- changing this step's day boundary would shift score_history rows and
  -- notification idempotency keys.
  v_today    date        := (v_now AT TIME ZONE 'UTC')::date;
  v_day_slug text        := to_char((v_now AT TIME ZONE 'UTC'), 'YYYY_MM_DD');
  v_rows     integer     := 0;
BEGIN
  -- Everything below is ONE statement. That matters for correctness, not just
  -- speed: the `prev` CTE must observe performance_scores as it stood BEFORE
  -- this run's upsert in order to detect threshold crossings. All CTEs in a
  -- statement read the same snapshot taken at statement start, so `prev` sees
  -- pre-update values regardless of the order the planner runs the CTEs in.
  -- Splitting this into separate statements would destroy that guarantee.
  WITH
  -- ── 1. Per-concept effective mastery, mapped to a subject code ──────────
  concept_scored AS (
    SELECT
      cm.student_id,
      sub.code AS subject,
      (
        -- pKnow: `row.p_know ?? row.mastery_probability ?? 0` (index.ts:497)
        COALESCE(cm.p_know, cm.mastery_probability, 0)::double precision
        *
        -- retention (index.ts:482-490)
        CASE
          WHEN cm.last_attempted_at IS NULL
            THEN COALESCE(cm.current_retention, 0)::double precision
          ELSE GREATEST(
                 exp(
                   -0.693
                   * (EXTRACT(EPOCH FROM (v_now - cm.last_attempted_at)) / 86400.0)
                   / GREATEST(COALESCE(cm.retention_half_life, 48.0), 0.5)
                 ),
                 public.perf_score_grade_floor(COALESCE(st.grade, ct.grade))
               )
        END
        *
        -- bloom ceiling (index.ts:493-494)
        public.perf_score_bloom_ceiling(cm.bloom_mastery)
      ) AS effective
    FROM public.concept_mastery cm
    -- D1: curriculum_topics is the REAL FK target of concept_mastery.topic_id
    -- (baseline:18924-18925). The TS joined a nonexistent `chapter_topics`.
    -- INNER JOIN mirrors `if (!mapping) continue` — a concept row whose topic
    -- is not in the catalogue is skipped, not defaulted.
    JOIN public.curriculum_topics ct ON ct.id = cm.topic_id
    JOIN public.subjects          sub ON sub.id = ct.subject_id
    -- LEFT JOIN mirrors `studentGrades.get(...) ?? mapping.grade`
    LEFT JOIN public.students     st ON st.id = cm.student_id
  ),

  -- ── 2. Performance component per student x subject ──────────────────────
  agg AS (
    SELECT
      cs.student_id,
      cs.subject,
      -- `acc.count > 0 ? (acc.total / acc.count) * 100 : 0` — a GROUP BY group
      -- always has count > 0, so the guard is structurally satisfied.
      (SUM(cs.effective) / COUNT(*)::double precision) * 100.0 AS perf_score
    FROM concept_scored cs
    GROUP BY cs.student_id, cs.subject
  ),

  -- ── 3. Consistency: distinct active days in the last 14, per subject ────
  -- D2: daily_activity has NO `subject` column; subjects studied on a day live
  -- in the `subjects_studied text[]` array (the table is UNIQUE on
  -- (student_id, activity_date)). unnest gives the per-subject key the TS
  -- assumed it could read directly.
  consistency AS (
    SELECT
      da.student_id,
      s.subject,
      COUNT(DISTINCT da.activity_date) AS active_days
    FROM public.daily_activity da
    CROSS JOIN LATERAL unnest(COALESCE(da.subjects_studied, ARRAY[]::text[]))
      AS s(subject)
    WHERE da.activity_date >= (v_today - 14)   -- .gte(fourteenDaysAgo), index.ts:508-512
    GROUP BY da.student_id, s.subject
  ),

  -- ── 4. Persistence: completed / started quizzes in the last 30 days ─────
  persistence AS (
    SELECT
      qs.student_id,
      qs.subject,
      COUNT(*)                                       AS started,
      COUNT(*) FILTER (WHERE qs.is_completed)        AS completed
    FROM public.quiz_sessions qs
    WHERE qs.created_at >= (v_now - INTERVAL '30 days')
    GROUP BY qs.student_id, qs.subject
  ),

  -- ── 5. Velocity: this week's average mastery vs last week's ─────────────
  -- D3: mastery_percent (double, 0-100) is the numeric column; the TS read the
  -- TEXT `mastery_level`. Divided by 100 so the delta lands in the -1..+1 band
  -- the `50 + delta * 50` mapping assumes (index.ts:569-572).
  -- COALESCE(...,0) INSIDE the average mirrors `tm.mastery_level ?? 0`, which
  -- makes NULLs count as zeros in both numerator and denominator — SQL AVG
  -- would otherwise skip them entirely.
  -- The outer COALESCE(...,0) mirrors `b.thisWeek.length ? avg : 0` — an empty
  -- bucket contributes 0, not NULL, so a key with only this-week rows gets
  -- avg_last = 0 exactly as in the TS.
  velocity AS (
    SELECT
      tm.student_id,
      tm.subject,
      COALESCE(
        AVG(COALESCE(tm.mastery_percent, 0)::double precision / 100.0)
          FILTER (WHERE (v_now - tm.updated_at) <= INTERVAL '7 days'), 0
      ) AS avg_this_week,
      COALESCE(
        AVG(COALESCE(tm.mastery_percent, 0)::double precision / 100.0)
          FILTER (WHERE (v_now - tm.updated_at) >  INTERVAL '7 days'
                    AND (v_now - tm.updated_at) <= INTERVAL '14 days'), 0
      ) AS avg_last_week
    FROM public.topic_mastery tm
    GROUP BY tm.student_id, tm.subject
  ),

  -- ── 6. Assemble the sub-scores and the two components ───────────────────
  -- The driving set is `agg` (i.e. `for (const [key, acc] of perfMap)`,
  -- index.ts:594): a student x subject with no concept_mastery rows is NOT
  -- scored, no matter how much behaviour data exists. LEFT JOINs supply the
  -- TS's `?? 0` / `?? 50` defaults for the behaviour signals.
  sub_scores AS (
    SELECT
      a.student_id,
      a.subject,
      a.perf_score,
      LEAST(100.0, (COALESCE(c.active_days, 0)::double precision / 14.0) * 100.0)
        AS consistency_score,
      CASE
        WHEN p.started IS NOT NULL AND p.started > 0
          THEN LEAST(100.0, (p.completed::double precision / p.started::double precision) * 100.0)
        ELSE 50.0                              -- `pers && pers.started > 0 ? ... : 50`
      END AS persistence_score,
      CASE
        WHEN v.student_id IS NULL THEN 50.0    -- `velocityMap.get(key) ?? 50`
        ELSE GREATEST(0.0, LEAST(100.0,
               50.0 + (v.avg_this_week - v.avg_last_week) * 50.0))
      END AS velocity_score,
      50.0::double precision AS challenge_score,  -- neutral, not yet tracked
      50.0::double precision AS revision_score,   -- neutral, not yet tracked
      50.0::double precision AS breadth_score     -- neutral, not yet tracked
    FROM agg a
    LEFT JOIN consistency c
      ON c.student_id = a.student_id AND c.subject = a.subject
    LEFT JOIN persistence p
      ON p.student_id = a.student_id AND p.subject = a.subject
    LEFT JOIN velocity v
      ON v.student_id = a.student_id AND v.subject = a.subject
  ),

  -- MATERIALIZED is explicit, not decorative: `computed` is referenced three
  -- times below (performance_scores, score_history, notifications). PG12+ would
  -- normally materialize a multiply-referenced CTE anyway, but pinning it
  -- guarantees the whole five-table aggregation is evaluated ONCE rather than
  -- three times.
  computed AS MATERIALIZED (
    SELECT
      ss.student_id,
      ss.subject,
      -- Weights transcribed literally from BEHAVIOR_WEIGHTS (index.ts:613-620):
      -- consistency 4, challenge 3, revision 4, persistence 3, breadth 3,
      -- velocity 3 — sum 20.
      ROUND((GREATEST(0.0, LEAST(100.0, ss.perf_score)))::numeric, 2)
        AS performance_component,
      ROUND((GREATEST(0.0, LEAST(100.0,
          ss.consistency_score * (4.0 / 20.0)
        + ss.challenge_score   * (3.0 / 20.0)
        + ss.revision_score    * (4.0 / 20.0)
        + ss.persistence_score * (3.0 / 20.0)
        + ss.breadth_score     * (3.0 / 20.0)
        + ss.velocity_score    * (3.0 / 20.0)
      )))::numeric, 2) AS behavior_component,
      ROUND((GREATEST(0.0, LEAST(100.0,
          ss.perf_score * 0.80
        + (  ss.consistency_score * (4.0 / 20.0)
           + ss.challenge_score   * (3.0 / 20.0)
           + ss.revision_score    * (4.0 / 20.0)
           + ss.persistence_score * (3.0 / 20.0)
           + ss.breadth_score     * (3.0 / 20.0)
           + ss.velocity_score    * (3.0 / 20.0)) * 0.20
      )))::numeric, 2) AS overall_score,
      ROUND(ss.consistency_score::numeric, 2) AS consistency_score,
      ROUND(ss.challenge_score::numeric,   2) AS challenge_score,
      ROUND(ss.revision_score::numeric,    2) AS revision_score,
      ROUND(ss.persistence_score::numeric, 2) AS persistence_score,
      ROUND(ss.breadth_score::numeric,     2) AS breadth_score,
      ROUND(ss.velocity_score::numeric,    2) AS velocity_score
    FROM sub_scores ss
  ),

  -- ── 7. Previous scores, read from the pre-statement snapshot ────────────
  -- MATERIALIZED is load-bearing here. Postgres guarantees that every
  -- sub-statement of a single statement sees the same snapshot and cannot
  -- observe another sub-statement's writes, so this would read pre-upsert
  -- values either way — but pinning materialization makes that guarantee
  -- explicit and immune to a future planner deciding to inline this read into
  -- the notification branch. If this ever reads POST-upsert values, every
  -- threshold notification silently stops firing (prev == current always).
  prev AS MATERIALIZED (
    SELECT ps.student_id, ps.subject, ps.overall_score AS previous_score
    FROM public.performance_scores ps
  ),

  -- ── 8. Upsert performance_scores ────────────────────────────────────────
  upserted AS (
    INSERT INTO public.performance_scores (
      student_id, subject, overall_score, performance_component,
      behavior_component, consistency_score, challenge_score, revision_score,
      persistence_score, breadth_score, velocity_score, level_name, updated_at
    )
    SELECT
      c.student_id, c.subject, c.overall_score, c.performance_component,
      c.behavior_component, c.consistency_score, c.challenge_score,
      c.revision_score, c.persistence_score, c.breadth_score, c.velocity_score,
      public.perf_score_level_name(c.overall_score), v_now
    FROM computed c
    ON CONFLICT (student_id, subject) DO UPDATE SET
      overall_score         = EXCLUDED.overall_score,
      performance_component = EXCLUDED.performance_component,
      behavior_component    = EXCLUDED.behavior_component,
      consistency_score     = EXCLUDED.consistency_score,
      challenge_score       = EXCLUDED.challenge_score,
      revision_score        = EXCLUDED.revision_score,
      persistence_score     = EXCLUDED.persistence_score,
      breadth_score         = EXCLUDED.breadth_score,
      velocity_score        = EXCLUDED.velocity_score,
      level_name            = EXCLUDED.level_name,
      updated_at            = EXCLUDED.updated_at
    RETURNING 1 AS written
  ),

  -- ── 9. Snapshot into score_history (one row per student x subject x day) ─
  -- The TS upserts with the default (non-ignoreDuplicates) strategy on
  -- (student_id, subject, recorded_at), i.e. a same-day re-run OVERWRITES —
  -- ported as DO UPDATE, not DO NOTHING.
  history AS (
    INSERT INTO public.score_history (
      student_id, subject, score, performance_component, behavior_component,
      recorded_at
    )
    SELECT
      c.student_id, c.subject, c.overall_score, c.performance_component,
      c.behavior_component, v_today
    FROM computed c
    ON CONFLICT (student_id, subject, recorded_at) DO UPDATE SET
      score                 = EXCLUDED.score,
      performance_component = EXCLUDED.performance_component,
      behavior_component    = EXCLUDED.behavior_component
    RETURNING 1 AS written
  ),

  -- ── 10. Threshold-crossing notifications ────────────────────────────────
  -- Ported rather than left in TypeScript on purpose: step 8 destroys the
  -- previous score, so a caller running after this RPC could no longer compute
  -- the delta. Leaving the TS block in place would have silently produced zero
  -- notifications forever.
  --
  -- Gated on `prev.previous_score IS NOT NULL` — the TS only notifies when a
  -- performance_scores row already existed (`if (prevScore !== null)`,
  -- index.ts:655), so a student's first-ever score never fires a milestone.
  --
  -- Bilingual copy (P7) is transcribed VERBATIM from
  -- daily-cron/index.ts:659-714. If that copy changes, change it here too —
  -- there are now two sites.
  --
  -- `message` is set to the same string as `body`. notifications.message is
  -- NOT NULL and the TS omitted it entirely, so those inserts could never have
  -- succeeded even had they been reached; mirroring `message = body` follows
  -- the house pattern already used by generateParentDigests in the same file
  -- (index.ts:243/:248, which sets both).
  notif_src AS (
    SELECT
      c.student_id,
      c.subject,
      p.previous_score,
      c.overall_score AS current_score,
      (p.previous_score - c.overall_score) AS drop_amount
    FROM computed c
    JOIN prev p
      ON p.student_id = c.student_id AND p.subject = c.subject
    WHERE p.previous_score IS NOT NULL
  ),
  notif_rows AS (
    -- 5+ point drop
    SELECT
      n.student_id AS recipient_id,
      format('Your %s score dropped by %s points', n.subject, ROUND(n.drop_amount)) AS title,
      format('Your Performance Score went from %s to %s. Review some topics to bring it back up!',
             ROUND(n.previous_score), ROUND(n.current_score)) AS body,
      jsonb_build_object(
        'subject',  n.subject,
        'previous', n.previous_score,
        'current',  n.current_score,
        'change',   (0 - n.drop_amount),   -- TS `change: -drop`
        'title_hi', format('तुम्हारा %s स्कोर %s अंक गिर गया', n.subject, ROUND(n.drop_amount)),
        'body_hi',  format('तुम्हारा Performance Score %s से %s हो गया। इसे फिर से बढ़ाने के लिए कुछ टॉपिक दोहराओ!',
                           ROUND(n.previous_score), ROUND(n.current_score))
      ) AS data,
      'score_drop_' || v_day_slug || '_' || n.student_id::text || '_' || n.subject AS idempotency_key
    FROM notif_src n
    WHERE n.drop_amount >= 5

    UNION ALL

    -- Crossed above 80 (achievement)
    SELECT
      n.student_id,
      format('Great job! %s score reached %s', n.subject, ROUND(n.current_score)),
      format('You''ve crossed 80 in %s. Keep up the excellent work!', n.subject),
      jsonb_build_object(
        'subject',   n.subject,
        'previous',  n.previous_score,
        'current',   n.current_score,
        'milestone', 80,
        'title_hi',  format('बहुत बढ़िया! %s स्कोर %s तक पहुँच गया', n.subject, ROUND(n.current_score)),
        'body_hi',   format('तुमने %s में 80 पार कर लिया। बढ़िया काम जारी रखो!', n.subject)
      ),
      'score_above80_' || v_day_slug || '_' || n.student_id::text || '_' || n.subject
    FROM notif_src n
    WHERE n.previous_score < 80 AND n.current_score >= 80

    UNION ALL

    -- Dropped below 50 (warning)
    SELECT
      n.student_id,
      format('%s score needs attention', n.subject),
      'Your score dropped below 50. A quick revision session can help bring it back up!',
      jsonb_build_object(
        'subject',   n.subject,
        'previous',  n.previous_score,
        'current',   n.current_score,
        'milestone', 50,
        'title_hi',  format('%s स्कोर पर ध्यान देने की ज़रूरत है', n.subject),
        'body_hi',   'तुम्हारा स्कोर 50 से नीचे आ गया। एक छोटा रिवीज़न सेशन इसे फिर से बढ़ाने में मदद कर सकता है!'
      ),
      'score_below50_' || v_day_slug || '_' || n.student_id::text || '_' || n.subject
    FROM notif_src n
    WHERE n.previous_score >= 50 AND n.current_score < 50
  ),
  notified AS (
    INSERT INTO public.notifications (
      recipient_type, recipient_id, type, title, message, body, data,
      is_read, created_at, idempotency_key
    )
    SELECT
      'student', nr.recipient_id, 'score_milestone', nr.title, nr.body, nr.body,
      nr.data, false, v_now, nr.idempotency_key
    FROM notif_rows nr
    ON CONFLICT (recipient_id, type, idempotency_key)
      WHERE idempotency_key IS NOT NULL
      DO NOTHING
    RETURNING 1 AS written
  )
  SELECT COUNT(*)::integer INTO v_rows FROM upserted;

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.recalculate_performance_scores() IS
  'Set-based nightly Performance Score recomputation. Replaces '
  'recalculatePerformanceScores() in supabase/functions/daily-cron/index.ts:'
  '423-749, whose five unfiltered PostgREST reads were each silently truncated '
  'at 1000 rows. Writes performance_scores (upsert on student_id,subject), '
  'score_history (upsert on student_id,subject,recorded_at) and the three '
  'score_milestone notifications (idempotency-keyed, ON CONFLICT DO NOTHING) in '
  'ONE statement — the notifications had to move here because the upsert '
  'destroys the previous score a caller would need to detect a threshold '
  'crossing. Returns the count of performance_scores rows written. '
  'PORT NOTES — the TS could not complete against the real schema, so this '
  'reproduces its INTENT with three documented substitutions: '
  '(1) curriculum_topics (the real concept_mastery.topic_id FK target) instead '
  'of the nonexistent chapter_topics table; '
  '(2) unnest(daily_activity.subjects_studied) instead of the nonexistent '
  'daily_activity.subject column — this makes consistency_score real rather '
  'than structurally zero, worth up to +4.0 points of overall_score; '
  '(3) topic_mastery.mastery_percent/100 instead of the TEXT '
  'topic_mastery.mastery_level, which averaged to NaN. '
  'Weights, thresholds, decay model, Bloom ceilings, grade floors, rounding and '
  'the UTC day anchor are otherwise unchanged from the TS, including its '
  'days/hours half-life unit mismatch, which is ported verbatim rather than '
  'silently corrected (that is an assessment decision, and it is the LARGEST '
  'open item here — worth up to ~64 and typically ~25 points of overall_score, '
  'an order of magnitude more than the +4.0 consistency change; a mechanical '
  'x24 correction would floor every student who skips a weekend, so the unit '
  'and the default/range must be decided together). '
  '⚠ DORMANT: nothing calls this. daily-cron still runs the dead TS path. '
  'Activation requires assessment sign-off + the ff_perf_score_recompute_v1 '
  'flag (seeded OFF) + a prod performance_scores baseline count + a dry run '
  'with notifications suppressed. See the migration file header. '
  'SECURITY DEFINER: must span every student across RLS-protected tables; '
  'EXECUTE granted to service_role only.';

-- Least privilege: service_role only for the writer. perf_score_grade_floor and
-- perf_score_bloom_ceiling are pure IMMUTABLE lookups with no data access and
-- stay readable by authenticated callers.
--
-- perf_score_level_name is DELIBERATELY service_role-EXECUTE-only, matching the
-- writer rather than the other two helpers. Its 5 bands contradict the canonical
-- 10-band LEVEL_THRESHOLDS in packages/lib/src/score-config.ts (see OPEN SCORING
-- QUESTION 2 in the header). Granting it to `authenticated` would institutionalise
-- that divergence by making a second, contradictory band vocabulary callable from
-- client surfaces. No client-side use until the two are reconciled.
REVOKE ALL ON FUNCTION public.recalculate_performance_scores() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_performance_scores() FROM anon;
REVOKE ALL ON FUNCTION public.recalculate_performance_scores() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_performance_scores() TO service_role;

REVOKE ALL ON FUNCTION public.perf_score_grade_floor(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.perf_score_bloom_ceiling(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.perf_score_level_name(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.perf_score_level_name(NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.perf_score_level_name(NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.perf_score_grade_floor(TEXT)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.perf_score_bloom_ceiling(JSONB)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.perf_score_level_name(NUMERIC)   TO service_role;
