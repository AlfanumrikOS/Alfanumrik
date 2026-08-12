-- Migration: 20260814000016_plan_subject_access_grant_pcb_to_starter.sql
-- Phase 3 / M3 — Server-authoritative allowed-subject policy: PRICING layer.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CEO-APPROVED PRICING CHANGE — option B
--   Grant physics, chemistry and biology to the `starter` plan ONLY.
--   `free` stays math-only at grades 11-12 and is NOT touched by this file.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLY-ORDER NOTE — SUPERSEDED IN EFFECT BY 20260814000018 (read before
-- interpreting this file's apply log). Added 2026-08-12 during the migration-
-- ledger reconcile; header-only edit, no SQL below was changed.
-- ═══════════════════════════════════════════════════════════════════════════
--   Production received 20260814000018_plan_subject_access_restrict BEFORE
--   this file runs (018 was applied out of band and imported into the repo;
--   this file had not yet run anywhere). 018 implements a LATER CEO decision
--   that subsumes option B: it grants the full keep-set (math, science,
--   physics, chemistry, biology) to EVERY plan and sets
--   subscription_plans.max_subjects = NULL everywhere.
--
--   This file is therefore a PROVABLE NO-OP on any environment where 018 has
--   already applied, and it does NOT undo any part of 018:
--     * it contains no DELETE and no UPDATE — it cannot re-grant anything 018
--       removed (018 removed only NON-keep-set grants; the three codes below
--       are all inside the keep-set 018 itself granted);
--     * step 1 inserts (starter, physics/chemistry/biology), all three of
--       which already exist post-018, so ON CONFLICT DO NOTHING inserts 0
--       rows;
--     * step 2's audit row is gated on the RETURNING set, so no audit row is
--       written — correct, because nothing changed;
--     * step 0's hard precondition still holds (018..22 do not touch
--       grade_subject_map);
--     * step 0b's ADVISORY WARNING ("plan_subject_access already grants ... to
--       the FREE plan") WILL fire. Post-018 that state is the approved
--       end-state, not drift — treat the warning as expected log noise, not a
--       signal to investigate.
--   The file is kept (rather than dropped from the chain) because it is
--   load-bearing on environments replayed from scratch WITHOUT 018 hand-
--   applied first — there it still closes the grade 11-12 starter dead end in
--   the interval between 016 and 018 in the version order — and because the
--   ledger must match what main ships.
--
-- WHY THIS EXISTS
--   20260814000007 (M1) header, lines 39-53, documents this hole and
--   deliberately left the fix unwritten pending CEO approval. Recap:
--     • M2 (20260814000008) restricts grades 11-12 to
--       math, physics, chemistry, biology — there is deliberately NO `science`
--       row at 11-12 (the UI presents P/C/B as ONE "Science" choice).
--     • plan_subject_access grants free and starter only `math` + `science`
--       within the keep-set.
--     • `science` therefore resolves to nothing at 11-12, leaving a grade
--       11-12 starter student with EXACTLY ONE unlocked subject: math.
--   That is a live cause of "the product looks empty" for 11-12 users. This
--   migration closes it for `starter`, and only for `starter`.
--
-- ───────────────────────────────────────────────────────────────────────────
-- IS plan_subject_access GRADE-AWARE?  **NO.**
-- ───────────────────────────────────────────────────────────────────────────
--   The table is (plan_code, subject_code) with PRIMARY KEY on exactly those
--   two columns. There is no grade column and no grade-scoped variant. This
--   grant is therefore PLAN-WIDE, not grade-scoped.
--
--   grade_subject_map is the binding grade constraint, and it is binding on
--   EVERY consumer — verified by reading each one, not assumed:
--
--   1. get_available_subjects(uuid)      [current def: 20260621000400]
--        `JOIN grade_valid gv ON gv.subject_code = sub.code`, where grade_valid
--        is derived from grade_subject_map for the student's (grade, stream,
--        board). plan_subject_access is used ONLY to compute is_locked over
--        that already-grade-filtered set. A grade 6-10 student never sees a
--        physics row at all — not unlocked, not locked, absent.
--   2. get_available_subjects_v2(uuid)   [20260605000000]
--        Does not read plan_subject_access at all. Unaffected.
--   3. enforce_subject_enrollment()      [current def: 20260814000010]
--        BEFORE INSERT OR UPDATE trigger on student_subject_enrollment. Gates
--        is_active AND grade_subject_map AND plan_subject_access as three
--        separate AND-ed checks, with the grade check running BEFORE the plan
--        check. A grade-6 starter student writing 'physics' still fails with
--        'subject_not_valid_for_grade'. Write path is grade-bound.
--   4. set_student_subjects()            [baseline]
--        Derives its allowed set from `get_available_subjects(...) WHERE NOT
--        is_locked`, i.e. from (1). Grade-bound transitively.
--   5. get_subject_violations()          [current def: 20260814000011]
--        `allowed` CTE = grade_subject_map ⋈ active subjects LEFT JOIN
--        plan_subject_access. Grade-bound.
--
--   Conclusion: a plan-wide grant CANNOT over-grant at grades 6-10, because
--   physics/chemistry/biology have no grade_subject_map row below grade 11 —
--   the legacy seed (20260415000004) maps them only at 11/12 under
--   stream='science', 20260528000010 extends only 11/12, and M2 replaced those
--   with stream-NULL 11/12 rows. Step 0 below turns that from a reviewed
--   assumption into a CHECKED PRECONDITION that fails the whole transaction if
--   it ever stops holding.
--
--   A genuinely grade-scoped grant would require adding a grade column to the
--   primary key and rewriting all five consumers above. That is a schema
--   redesign, not an additive grant, and is not justified while the grade map
--   is provably binding.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT IS NOT TOUCHED
-- ───────────────────────────────────────────────────────────────────────────
--   • `free` — zero rows written. Free stays math-only at 11-12, per option B.
--   • `pro`, `unlimited` — already grant physics/chemistry/biology; zero rows
--     written (ON CONFLICT DO NOTHING would no-op anyway, but they are not
--     even in the insert's source set).
--   • subscription_plans — no price, no plan definition, no max_subjects
--     change. starter's max_subjects stays 4, which exactly accommodates the
--     new grade 11-12 offering (math + physics + chemistry + biology = 4), so
--     set_student_subjects() will not raise 'max_subjects_exceeded' for a
--     student selecting the full 11-12 set. plans.ts still correctly reads
--     "4 subjects" for starter — no marketing copy change is required.
--   • subjects.is_active, grade_subject_map — untouched.
--
-- ───────────────────────────────────────────────────────────────────────────
-- RLS (P8)
-- ───────────────────────────────────────────────────────────────────────────
--   NO NEW TABLE, NO NEW COLUMN, NO NEW RLS SURFACE. This migration inserts
--   three rows into an existing table. plan_subject_access already has RLS
--   enabled with policy `plan_subject_access_authenticated_read`
--   (FOR SELECT TO authenticated USING (true), set by 20260728090000, which
--   also revoked anon). The new rows inherit that posture unchanged: plan
--   metadata, no PII, no anon read. Writes remain service-role only.
--
-- ───────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
-- ───────────────────────────────────────────────────────────────────────────
--   ON CONFLICT (plan_code, subject_code) DO NOTHING against the table's own
--   primary key, so a re-run inserts zero rows. The audit INSERT is gated on
--   EXISTS over the insert's RETURNING set, so a no-op re-run writes no second
--   audit row and the rollback row stays unique and authoritative.
--
-- ROLLBACK
--   DELETE FROM public.plan_subject_access
--    WHERE plan_code = 'starter'
--      AND subject_code = ANY(<details->'granted' from the audit row below>);
--   No student data is written by this migration, so nothing else needs
--   compensating. Students who selected P/C/B while the grant was live keep
--   their student_subject_enrollment rows and would be surfaced by
--   get_subject_violations() after a rollback (repair is a separate ops
--   action, exactly as for any other plan_subject_access removal).
--
-- Non-destructive: no DROP, no UPDATE, no row deletion.

BEGIN;

-- ─── 0. PRECONDITION: grade_subject_map must be the binding grade constraint ─
-- The whole safety argument for a plan-wide (grade-blind) grant is that
-- physics/chemistry/biology are mapped ONLY at grades 11 and 12. If that has
-- stopped being true — a board-specific seed added physics at grade 10, say —
-- then this grant WOULD reach grades below 11 and would be an unpriced
-- giveaway. Fail the transaction rather than discover it in revenue.
--
-- Grades are STRINGS (P5): '11' / '12', never 11 / 12.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(x, ', ' ORDER BY x)
    INTO v_bad
    FROM (
      SELECT DISTINCT format(
               '(grade=%s, subject=%s, board=%s, stream=%s)',
               gsm.grade, gsm.subject_code,
               COALESCE(gsm.board, '<null>'), COALESCE(gsm.stream, '<null>')
             ) AS x
        FROM public.grade_subject_map gsm
       WHERE gsm.subject_code IN ('physics', 'chemistry', 'biology')
         AND gsm.grade NOT IN ('11', '12')
    ) t;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'plan_subject_access is not grade-aware; granting physics/chemistry/biology to starter would reach grades below 11 because grade_subject_map maps them at: %',
      v_bad
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Either remove those sub-grade-11 map rows, or implement a grade-scoped grant (schema change to plan_subject_access). Do NOT weaken this check to make the migration pass — it is the only thing preventing an unpriced giveaway at grades 6-10.';
  END IF;
END;
$$;

-- ─── 0b. Advisory checks (non-blocking) ─────────────────────────────────────
-- Neither of these should stop a legitimate apply; both make a surprising
-- environment visible in the migration log instead of silent.
DO $$
DECLARE
  v_free_pcb   TEXT;
  v_map_1112   INT;
BEGIN
  -- Option B says free stays math-only. This migration writes nothing to free,
  -- but if free ALREADY grants P/C/B then the pricing state on this
  -- environment is not what the decision assumed.
  SELECT string_agg(psa.subject_code, ', ' ORDER BY psa.subject_code)
    INTO v_free_pcb
    FROM public.plan_subject_access psa
   WHERE psa.plan_code = 'free'
     AND psa.subject_code IN ('physics', 'chemistry', 'biology');

  IF v_free_pcb IS NOT NULL THEN
    RAISE WARNING
      'plan_subject_access already grants % to the FREE plan. Option B assumed free was math-only at grades 11-12; this migration does not change free either way.',
      v_free_pcb;
  END IF;

  -- If the 11-12 map rows are absent, the grant is inert and the "empty
  -- product" symptom will persist. Worth seeing in the apply log.
  SELECT count(*) INTO v_map_1112
    FROM public.grade_subject_map gsm
   WHERE gsm.grade IN ('11', '12')
     AND gsm.subject_code IN ('physics', 'chemistry', 'biology');

  IF v_map_1112 = 0 THEN
    RAISE WARNING
      'grade_subject_map has no physics/chemistry/biology rows at grades 11-12; the starter grant will be inert until 20260814000008 has been applied on this environment.';
  END IF;
END;
$$;

-- ─── 1. The grant ───────────────────────────────────────────────────────────
-- Three rows, one plan. The EXISTS guard on public.subjects protects the
-- plan_subject_access_subject_code_fkey FK on a fresh environment whose
-- catalogue has not been seeded yet (the FK references subjects(code), not
-- active subjects, so is_active is deliberately NOT part of this guard —
-- M1 keeps all three in the active keep-set and gating on is_active here would
-- couple the grant to catalogue state it does not own).
--
-- Idempotent: ON CONFLICT on the table's primary key.
WITH grant_set(code) AS (
  VALUES ('physics'), ('chemistry'), ('biology')
),
granted AS (
  INSERT INTO public.plan_subject_access (plan_code, subject_code)
  SELECT 'starter', g.code
    FROM grant_set g
   WHERE EXISTS (SELECT 1 FROM public.subjects s WHERE s.code = g.code)
  ON CONFLICT (plan_code, subject_code) DO NOTHING
  RETURNING subject_code
)
-- ─── 2. Operational audit trail / rollback source of truth ──────────────────
-- Idempotent: gated on EXISTS over the RETURNING set, so a no-op re-run
-- writes nothing and exactly one row ever records the change.
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'plan_subject_access.starter_granted_physics_chemistry_biology',
  'plan_subject_access',
  'starter',
  jsonb_build_object(
    'plan_code',   'starter',
    'granted',     COALESCE((SELECT array_agg(g.subject_code ORDER BY g.subject_code) FROM granted g), ARRAY[]::TEXT[]),
    'approval',    'CEO-approved pricing change, option B (starter only; free unchanged)',
    'free_changed', FALSE,
    'grade_scope', 'plan-wide grant; grades 11-12 in effect because grade_subject_map maps physics/chemistry/biology only at grades 11 and 12 (asserted by this migration)',
    'migration',   '20260814000016_plan_subject_access_grant_pcb_to_starter',
    'applied_at',  now()
  ),
  now()
WHERE EXISTS (SELECT 1 FROM granted);

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- READ-ONLY VERIFICATION SET (nothing below executes — comments only)
-- Run Q1-Q4 BEFORE applying, keep the output, run them again AFTER and diff.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Q1 — Per-plan grants over the keep-set. THE headline before/after diff.
--      Expected delta: the `starter` row gains exactly biology, chemistry,
--      physics. free / pro / unlimited rows must be byte-identical.
--
--   SELECT psa.plan_code,
--          count(*) AS total_grants,
--          array_agg(psa.subject_code ORDER BY psa.subject_code)
--            FILTER (WHERE psa.subject_code IN
--                    ('math','science','physics','chemistry','biology'))
--            AS keep_set_grants
--     FROM public.plan_subject_access psa
--    GROUP BY psa.plan_code
--    ORDER BY psa.plan_code;
--
-- Q2 — What a grade-11 student actually sees, per plan. This mirrors
--      get_available_subjects()'s grade_valid ⋈ plan_valid logic for the
--      stream-NULL / board-generic case M2 leaves behind.
--      BEFORE: starter → math unlocked, nothing else.
--      AFTER:  starter → math, physics, chemistry, biology all unlocked.
--      free must read `math` unlocked and P/C/B locked in BOTH runs.
--
--   SELECT p.plan_code,
--          gsm.subject_code,
--          (psa.subject_code IS NULL) AS is_locked
--     FROM (VALUES ('free'),('starter'),('pro'),('unlimited')) AS p(plan_code)
--     CROSS JOIN LATERAL (
--       SELECT DISTINCT g.subject_code
--         FROM public.grade_subject_map g
--        WHERE g.grade = '11'
--          AND g.stream IS NULL
--     ) gsm
--     JOIN public.subjects sub
--       ON sub.code = gsm.subject_code AND sub.is_active
--     LEFT JOIN public.plan_subject_access psa
--       ON psa.plan_code = p.plan_code
--      AND psa.subject_code = gsm.subject_code
--    ORDER BY p.plan_code, gsm.subject_code;
--
-- Q3 — Grade-6..10 non-leak proof. Confirms the plan-wide grant does NOT
--      reach lower grades. MUST return ZERO rows in BOTH runs (it is the same
--      predicate the step-0 assertion enforces).
--
--   SELECT gsm.grade, gsm.subject_code, gsm.board, gsm.stream
--     FROM public.grade_subject_map gsm
--    WHERE gsm.subject_code IN ('physics','chemistry','biology')
--      AND gsm.grade NOT IN ('11','12');
--
-- Q4 — Revenue blast radius: how many real students are on each
--      (effective plan, grade) at 11-12. The `starter` rows are exactly the
--      population that gains access. Plan resolution mirrors
--      enforce_subject_enrollment() / get_subject_violations().
--
--   WITH eff AS (
--     SELECT s.id, s.grade,
--            COALESCE((
--              SELECT ss.plan_code FROM public.student_subscriptions ss
--               WHERE ss.student_id = s.id
--                 AND ss.status IN ('active','trialing','grace')
--               ORDER BY ss.current_period_end DESC NULLS LAST
--               LIMIT 1
--            ), 'free') AS plan_code
--       FROM public.students s
--      WHERE s.grade IN ('11','12')
--   )
--   SELECT plan_code, grade, count(*) AS students
--     FROM eff GROUP BY plan_code, grade ORDER BY plan_code, grade;
--
-- Q5 — Post-apply only: the audit / rollback row.
--
--   SELECT action, entity_id, details, created_at
--     FROM public.admin_audit_log
--    WHERE action = 'plan_subject_access.starter_granted_physics_chemistry_biology';
--
-- Q6 — Post-apply only: nothing broke. get_subject_violations() must not gain
--      new violations from this change (a grant can only ever REMOVE
--      violations, never add them).
--
--   SELECT count(*) FROM public.get_subject_violations(NULL, '11', NULL, 1000, 0);
--   SELECT count(*) FROM public.get_subject_violations(NULL, '12', NULL, 1000, 0);
