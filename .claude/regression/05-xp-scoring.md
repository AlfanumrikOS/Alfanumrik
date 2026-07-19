## School-wide academic reporting depth — mastery + Bloom's + PII-safe export (Phase 3B Wave D) — REG-99

Source: Phase 3B Wave D "School-wide academic REPORTING depth" (autonomous,
read-only board/parent-ready reporting), behind `ff_school_reports_depth`; default
OFF. Adds ONE migration
(`supabase/migrations/20260614000003_phase3b_school_reporting.sql`) with three
read-only SECURITY DEFINER read-model RPCs (`get_school_mastery_rollup`,
`get_school_bloom_summary`, `export_school_report`) + ONE covering index
(`idx_quiz_responses_student_bloom`), three thin GET routes
(`src/app/api/school-admin/reports/{mastery,bloom,export}/route.ts`) gated by
`ff_school_reports_depth` (404 BEFORE auth when OFF) that authorize via the
EXISTING `institution.view_analytics` permission through a USER-CONTEXT client
(`resolveCommandCenterContext`), shared types
(`src/lib/school-admin/reporting-types.ts`: `DEFAULT_MASTERY_GROUP_BY` /
`VALID_MASTERY_GROUP_BY` / `reportingRpcErrorResponse` + row/response types), and
the flag hook (`src/lib/use-school-reports-depth.ts` + `SCHOOL_REPORTS_DEPTH_FLAGS`).
NO new table, NO new RBAC permission, NO scoring/XP — 100% read-only. Mastery is
read VERBATIM from `concept_mastery.p_know` and Bloom from
`quiz_responses.bloom_level` — the SAME sources Wave A/C use; the read models never
recompute a value. The "active students" roster is the SAME unified set Wave A/B
converged on (`_school_active_student_ids` = DISTINCT UNION of class_students +
class_enrollments), so reporting numbers can never drift from the seat count or the
Command Center overview.

Five things are blocking defects if they regress: (a) **school-wide mastery rollup
correctness** — `get_school_mastery_rollup` groups by `grade` | `subject` |
`teacher` (validated; default `grade`; unknown → RAISE `22023`); `group_key` is
TEXT in every mode (grade is a STRING per P5; teacher is the teacher uuid as text);
`avg_mastery` is the AVG of per-student AVG(`p_know`) (PRE-aggregated per student
FIRST, so a high-volume student cannot dominate); `student_count` is DISTINCT within
a group; `at_risk_count` counts a student ONLY when their per-student avg
`p_know < 0.4` (a student at exactly 0.40 is NOT at-risk — the boundary excludes
equality, SAME constant + pre-aggregation as Wave A `get_classes_at_risk`); the
roster is the unified union, so a student reachable ONLY via `class_enrollments`
(no `class_students` row) still counts; (b) **Bloom distribution** —
`get_school_bloom_summary` buckets the school's active students' `quiz_responses` by
`bloom_level` with `accuracy = round(correct/total, 2)` (correct derived from
`is_correct`; the baseline has no `correct_count` column), and a NULL/empty
`bloom_level` buckets as `'unspecified'` so the distribution is exhaustive (no rows
silently dropped); (c) **PII-safe aggregate export** — `export_school_report`
returns ONE jsonb `{ school_id, overview, mastery_by_grade[], bloom_summary[],
data_state, generated_at }` that is AGGREGATES ONLY — group-level rows, never an
individual student name/email/id; the CSV serialization on the route serializes
exactly those bounded aggregate arrays server-side (Content-Type `text/csv` +
Content-Disposition `attachment`), so it is PII-safe by construction (P13);
`data_state` flips `'no_data'` for a school with no classes/roster/signal; (d)
**flag-OFF 404-before-auth** — `ff_school_reports_depth` defaults OFF and is
unseeded ⇒ all three routes return 404 and NEVER consult
`resolveCommandCenterContext` or the RPC (the flag gate is evaluated BEFORE any
auth work — byte-identical "feature absent" portal), while
`useSchoolReportsDepth()` paints OFF synchronously (no first-paint flash); (e)
**cross-school scope guard (P8/P9)** — each SECURITY DEFINER RPC RAISES `42501`
unless `auth.uid()` is an ACTIVE `school_admins` member of exactly `p_school_id`,
so a non-admin AND a wrong-school admin both get the permission error on all three
RPCs (mapped to HTTP 403 by the route); the route never leaks SQL/PII on a generic
RPC failure (→ 500), maps `22023` → 400 and `42501` → 403, and validates
`group_by` / `format` BEFORE the RPC (bad → 400 with no RPC call).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-99 | `school_reporting_mastery_rollup_bloom_pii_safe_export_flag_off_404_cross_school_403` | **(a) Mastery rollup correctness.** Live-DB: `get_school_mastery_rollup` over a seeded school (Grade 7/Science: 3 students incl. one reachable ONLY via `class_enrollments`, `p_know` {0.20, 0.40, 0.30}; Grade 8/Maths: 2 students {0.70, 0.90}) returns — group_by `grade` → keys `"7"`/`"8"` (STRINGS, P5), G7 student_count=3 (the class_enrollments-ONLY student counts → unified roster), at_risk_count=2 (the 0.40 boundary student EXCLUDED, strict `<0.4`), avg_mastery≈0.30 (mean of per-student averages), label `"Grade 7"`; group_by `subject` → Science student_count=3 / Maths=2; group_by `teacher` → group_key is the teacher uuid as text, label is the teacher name, one row per teacher; omitted group_by defaults to `grade`; an unknown group_by RAISES `22023`. **(b) Bloom distribution.** Live-DB: `get_school_bloom_summary` over seeded responses ('remember' 3/2-correct, 'apply' 2/1-correct, one NULL-bloom) returns accuracy `round(correct/total,2)` (remember 0.67, apply 0.50), buckets the NULL row as `'unspecified'` (1/0 → 0.00), and the 'remember' count=3 INCLUDES the class_enrollments-only student's response (proves the unified roster, not class_students-only=2). **(c) PII-safe export.** Live-DB: `export_school_report` returns `{ school_id, overview, mastery_by_grade[], bloom_summary[], data_state:'live', generated_at }`, `mastery_by_grade` keyed by `grade` string {"7","8"}, overview.student_count=5 (unified); the FULL jsonb serialized to string contains NONE of the seeded student names, NONE of the seeded student uuids, the class_enrollments-only student's name+id, nor any teacher email (`@rpt.test`); `data_state` is `'no_data'` for an empty school. Route unit (mocked): export format=json returns the verbatim snapshot (Content-Type application/json), format=csv returns Content-Type `text/csv` + Content-Disposition `attachment` `.csv`, invalid format=`pdf` → 400 BEFORE the RPC, the CSV body contains the aggregate section labels/fields (overview, mastery_by_grade, bloom_summary, student_count, at_risk_count, "Grade 7") and NONE of the PII column tokens (email / student_name / student_id / phone / `@`). **(d) Flag-OFF 404-before-auth.** Route unit: with `ff_school_reports_depth` OFF every route returns 404 and NEVER calls `resolveCommandCenterContext` or the RPC, and the gate reads the `ff_school_reports_depth` flag; `useSchoolReportsDepth()` initial SYNCHRONOUS value is `false` (DEFAULT_OFF), stays false absent / explicitly-false / on `getFeatureFlags` rejection, flips ON only after the async confirm when true, and fetches scoped to `role:'school_admin'`. **(e) Cross-school 403 scope guard.** Live-DB: an authenticated NON-admin AND a WRONG-SCHOOL admin (admin of B querying A) both get Postgres `42501` from all three SECURITY DEFINER RPCs; an ACTIVE admin of the school succeeds on all three. Route unit: 42501 → HTTP 403, 22023 → HTTP 400, generic RPC error → HTTP 500 with no SQL/PII leak, resolution 401/403 propagated UNCHANGED with no RPC call, mastery default/valid (grade/subject/teacher)/invalid(400-before-RPC)/empty(200)/cache header, bloom rows/empty/cache header. | `src/__tests__/migrations/school-reporting.test.ts` (14 live-DB tests: scope-guard 42501 for non-admin + wrong-school across all 3 RPCs + active-admin success; group_by validation 22023 + default-grade; mastery rollup by grade incl. unified roster + 0.4 boundary + per-student-pre-agg avg; by subject; by teacher uuid/label; bloom grouping + accuracy + 'unspecified' bucket + unified-roster response count; export shape + PII-safety no-name/no-id/no-email + no_data) + `src/__tests__/api/school-admin/reports-depth-routes.test.ts` (28 unit tests: per-route flag-OFF 404-before-auth no-resolve-call + flag-name; resolution 401/403 passthrough no-RPC; 42501→403; generic→500 no-leak; correct-RPC-with-school-id; mastery default-grade echo + valid grade/subject/teacher + invalid-400-before-RPC + empty-200 + rows + cache header + 22023→400; bloom rows + empty + cache header; export json/csv + format-400-before-RPC + CSV PII-safe aggregate-only + null-degrades-no-500 + 42501→403) + `src/__tests__/school-admin/reports-depth-flag-gate.test.tsx` (5 tests: sync DEFAULT_OFF + stays-OFF-absent / stays-OFF-false / flips-ON-true / stays-OFF-on-reject / role-scoped fetch) | E |

### Pinned tests

- `src/__tests__/migrations/school-reporting.test.ts::get_school_mastery_rollup — group_by grade::groups by grade string with correct student_count, avg_mastery, at_risk_count`
- `src/__tests__/migrations/school-reporting.test.ts::get_school_mastery_rollup — group_by validation::RAISES 22023 for an unknown group_by (never silently guesses)`
- `src/__tests__/migrations/school-reporting.test.ts::get_school_bloom_summary::buckets by bloom_level with response/correct counts + 2dp accuracy`
- `src/__tests__/migrations/school-reporting.test.ts::get_school_bloom_summary::counts the class_enrollments-only student responses (unified roster)`
- `src/__tests__/migrations/school-reporting.test.ts::export_school_report::contains NO individual student name / email / id anywhere in the jsonb (P13)`
- `src/__tests__/migrations/school-reporting.test.ts::scope guard (cross-tenant safety — RAISE 42501)::rejects a WRONG-SCHOOL admin on all three RPCs (admin of B querying A)`
- `src/__tests__/api/school-admin/reports-depth-routes.test.ts::FLAG OFF — GET /api/school-admin/reports/mastery (404 before auth)::returns 404 and NEVER consults resolveCommandCenterContext or the RPC`
- `src/__tests__/api/school-admin/reports-depth-routes.test.ts::FLAG ON — GET /api/school-admin/reports/export::CSV body contains ONLY aggregate fields — NO student name / email / id (P13)`
- `src/__tests__/api/school-admin/reports-depth-routes.test.ts::FLAG ON — GET /api/school-admin/reports/mastery::returns 400 for an invalid group_by BEFORE calling the RPC`
- `src/__tests__/school-admin/reports-depth-flag-gate.test.tsx::useSchoolReportsDepth — default OFF (no first-paint flash)::initialises OFF synchronously and stays OFF when the flag is absent`

### Invariants covered by this section

- P8/P9 (cross-tenant scope) — the three SECURITY DEFINER RPCs RAISE 42501 unless
  `auth.uid()` is an active `school_admins` member of `p_school_id`; the routes
  gate on the EXISTING `institution.view_analytics` permission (no new code) and
  resolve the school server-side, never trusting a client-supplied id.
- P5 (grade format) — `get_school_mastery_rollup` returns `group_key` as TEXT in
  every mode; grade keys are the strings "7"/"8" and `mastery_by_grade[].grade` is
  a string.
- P13 (data privacy) — `export_school_report` is AGGREGATES ONLY (group-level rows,
  never an individual student name/email/id); the CSV serializes exactly those
  bounded aggregate arrays; neither the route nor the resolver leaks SQL/policy
  text on an RPC error (generic 500; raw error logged server-side via the
  redacting logger only).
- No scoring/XP (read-only) — mastery is read verbatim from `concept_mastery.p_know`
  and Bloom from `quiz_responses.bloom_level`; the read models never recompute a
  score and contain no XP constant.
- Flag-OFF byte-identity (rollout safety) — `ff_school_reports_depth` default-OFF
  404s all three reporting routes BEFORE auth (the resolution seam is never even
  consulted) and paints the reporting-depth UI gate OFF synchronously, so the
  flag-OFF portal is byte-identical until rollout.

### Notes on test strategy

REG-99 uses the repo's **live-DB-integration + route-unit + flag-hook pattern**,
matching REG-96 (Wave A) and REG-97 (Wave B) seam-for-seam. The live-DB RPC tests
live under `src/__tests__/migrations/**` (gated by `hasSupabaseIntegrationEnv()` →
`describe.skip` under placeholder env, and by the `RUN_INTEGRATION_TESTS=1` include
split in `vitest.config.ts`) and add the same user-context-JWT seam: because the
three read models are SECURITY DEFINER and guard on `auth.uid()`, each admin fixture
is a REAL auth user (`supabaseAdmin.auth.admin.createUser` → `signInWithPassword` →
anon client bearing the JWT), so the in-RPC scope guard is exercised for real rather
than bypassed by the service-role client. The seeded school deliberately MIXES
`class_students` and `class_enrollments` (one student is class_enrollments-ONLY) so
the unified-roster claim is proven in BOTH the mastery rollup and the bloom summary,
and the PII-safety assertion captures every seeded student name + uuid up front and
asserts NONE of them appears in the exported jsonb string. These run only in the
"Integration Tests (live DB)" CI job (currently billing-blocked; will run when CI
billing is restored). The route + flag-hook tests run under the normal Vitest unit
job with NO DB: the route tests mock the flag gate (`isFeatureEnabled`) and ONLY
`resolveCommandCenterContext` (keeping `reportingRpcErrorResponse` /
`VALID_MASTERY_GROUP_BY` / `DEFAULT_MASTERY_GROUP_BY` / the cache constant REAL via
`importActual`) so the real group_by/format validation + 22023→400 / 42501→403
mapping + CSV serialization run, and a dedicated FLAG-OFF block asserts the
404-before-auth gate by proving `resolveCommandCenterContext` is never consulted;
the flag-hook test mocks only `getFeatureFlags` and asserts the synchronous
DEFAULT_OFF paint (mirrors the Wave A/B/C flag-gate tests).

### Catalog total

Pre-Phase-3B-Wave-D: 66 entries. Phase 3B Wave D (school-wide academic reporting
depth — mastery rollup + Bloom's summary + PII-safe aggregate export, read-only,
behind `ff_school_reports_depth`) adds REG-99 (school-wide mastery rollup with
group-by + verbatim mastery + 0.4 at-risk boundary + unified roster; Bloom
distribution with 'unspecified' bucket; PII-safe aggregate export; flag-OFF
404-before-auth; cross-school 42501 scope guard).

**Total: 67 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Phase 2 grade-experiment-conclusion Python port (2026-06-09) - REG-103

Port of `supabase/functions/grade-experiment-conclusion/index.ts` to Python.
Tier 3 R10 experiment-conclusion grader. Phase 2 uses rule-based scoring
(Phase 2.5 will swap to MoL). Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-103 | `phase_2_grade_experiment_conclusion_python_port_coin_tier_parity` | (1) Tier boundaries match TS byte-for-byte: weak 0-4, developing 5-7, proficient 8-10, strong 11-12. (2) Coin rewards match TS: +0/+5/+15/+30. (3) Rule-based scoring covers tier mapping correctly (short -> weak, long+rich -> proficient/strong). (4) All criteria clamped to 0..3. (5) Bilingual feedback (en+hi) populated for every tier. A regression on tier boundaries or coin rewards changes the in-app economy. | `python/tests/unit/test_grade_experiment_conclusion_scoring.py::test_tier_boundaries_match_ts`, `python/tests/unit/test_grade_experiment_conclusion_scoring.py::test_coin_rewards_match_ts`, `python/tests/unit/test_grade_experiment_conclusion_scoring.py::test_total_to_tier_boundaries`, `python/tests/unit/test_grade_experiment_conclusion_scoring.py::test_short_text_scores_weak`, `python/tests/unit/test_grade_experiment_conclusion_scoring.py::test_long_rich_text_scores_strong`, `python/tests/unit/test_grade_experiment_conclusion_scoring.py::test_all_criteria_in_0_3_range` | E |

### Invariants covered by this section

- P2 (XP economy) - coin tier amounts are part of the gamification
  economy; REG-103 pins +0/+5/+15/+30 verbatim.
- P12 (AI safety) - this Phase 2 port uses deterministic heuristics; no
  LLM output reaches DB or student. Phase 2.5 follow-up will introduce
  MoL routing with the existing safety chain.
- P13 (data privacy) - logs {observation_id, tier, total, coins,
  latency_ms} only; conclusion text NEVER logged.

### Catalog total

Pre-Phase-2-grade-experiment-conclusion: 70 entries. Adds REG-103.

**Total: 71 entries.**

## consecutive_wrong population — increment on wrong / reset on correct, BKT/SM-2 provably unchanged (2026-06-15) — REG-145

Priority: **P1/P4-adjacent (learner-state).** Source: Session 4
consecutive-wrong-maintenance change (2026-06-15), landing directly on top of the
REG-144 schema-reproducibility fix. Migration
`20260615181255_maintain_consecutive_wrong_in_learner_state.sql` extends
`update_learner_state_post_quiz` to MAINTAIN the
`concept_mastery.consecutive_wrong` counter — increment on a wrong answer, reset
to 0 on a correct one — for the SPEC-3 intervention-alert pathway. The counter
feeds NO scoring or mastery formula; it is pure bookkeeping.

> **ID note:** REG-144 is the previous entry (schema-reproducibility fresh-DB
> quiz-function probe, 2026-06-15). REG-145 is the next free id at the time this
> entry was written.

The change is deliberately SURGICAL: the function body is reproduced byte-for-byte
from the deployed version
(`20260615142552_restore_missing_quiz_functions.sql`, the REG-144 restore) and the
ONLY diff is the 3 `consecutive_wrong` spots in the `concept_mastery` upsert (the
INSERT column, the INSERT VALUES neutral `0` seed, and the
`ON CONFLICT DO UPDATE SET` CASE clause) plus the updated COMMENT line. The
10-param signature, the `mastery_level::TEXT` write, the BKT / SM-2 arithmetic, the
RETURN jsonb, and `SECURITY DEFINER` + `SET search_path` are all unchanged.

Two correctness hazards this pins against:

- **Scoring drift.** Because the counter feeds no formula, a quiz attempt that
  produced mastery X / ease Y / interval Z before the migration MUST produce the
  SAME X / Y / Z after it (P1 score accuracy / P4 atomic submission are adjacent —
  the same function runs inside the `submit_quiz_results_v2` atomic transaction).
  The "BKT outputs unchanged" guarantee is asserted STRUCTURALLY: the entire
  BKT/SM-2 mastery-math block is byte-identical between the two function bodies,
  and the key BKT update line
  `v_new_mastery := LEAST(1.0, GREATEST(0.0, v_p_know + (1.0 - v_p_know) * p_p_learn))`
  is pinned byte-for-byte. Reference behavior for a known input (documented in the
  test header, not executed): brand-new row + wrong → seed 0; existing row + wrong
  → `concept_mastery.consecutive_wrong + 1`; existing row + correct → reset 0; in
  all cases BKT output identical to the deployed version.
- **EXCLUDED footgun.** The increment must read the LIVE row
  (`concept_mastery.consecutive_wrong + 1`) and the PLpgSQL parameter
  (`p_is_correct`), NOT the non-existent `EXCLUDED.p_is_correct` pseudo-column,
  which would fail at apply time.

Ordering prerequisite: the `consecutive_wrong` COLUMN is added by the EARLIER
migration `20260615180149_add_consecutive_wrong_to_concept_mastery.sql`
(`ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS consecutive_wrong integer
NOT NULL DEFAULT 0`), which sorts BEFORE 20260615181255 in lexicographic timestamp
order — so the column exists before the function references it.

The regression test below is STATIC (no DB): structural equivalence ("the only diff
is the 3 additive lines") is provable from the SQL text alone, so it runs always-on
in the normal unit lane and catches any future edit that perturbs the mastery math
while touching this function. It is the no-DB companion to REG-144's live fresh-DB
existence probe for the same function.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-145 | `consecutive_wrong_population_structural_diff` | **(1) Signature unchanged:** the CREATE FUNCTION parameter list of `update_learner_state_post_quiz` in `20260615181255` is byte-identical (whitespace-normalized) to the deployed version in `20260615142552` — the full 10-param BKT signature (`p_student_id UUID … p_p_guess FLOAT DEFAULT 0.25`); both migrations DROP the exact 10-arg-type signature. **(2) Column prerequisite:** `20260615180149` runs `ALTER TABLE public.concept_mastery ADD COLUMN IF NOT EXISTS consecutive_wrong integer NOT NULL DEFAULT 0`, AND `'20260615180149…' < '20260615181255…'` (column exists before the function references it). **(3) Population logic:** the `ON CONFLICT DO UPDATE SET` clause is `consecutive_wrong = CASE WHEN p_is_correct THEN 0 ELSE concept_mastery.consecutive_wrong + 1 END` (reset on correct, +1 on wrong) using the parameter `p_is_correct` and the LIVE row, and explicitly does NOT contain the invalid `EXCLUDED.p_is_correct`; the INSERT VALUES path seeds a neutral `0` for the first answer. **(4) BKT/SM-2 unchanged pin:** the entire BKT/SM-2 mastery-math block (BKT evidence/know update → mastery clamp → ease factor → SM-2 interval) is byte-identical between the two function bodies, and the key BKT line `v_new_mastery := LEAST(1.0, GREATEST(0.0, v_p_know + (1.0 - v_p_know) * p_p_learn))` is byte-identical in both — so consecutive_wrong adds no scoring drift; sanity floor: the deployed version has ZERO `consecutive_wrong` mentions, the population version introduces ≥3. | `src/__tests__/schema/consecutive-wrong-population.test.ts` (16 tests, static; no DB) | U (static structural-diff, always-on) |

### Invariants covered by this section

- P1 Score accuracy — REG-145 (the consecutive_wrong-maintenance migration leaves
  the BKT/SM-2 mastery math byte-identical to the deployed version; the structural
  diff pin proves scoring is untouched, so quiz scores cannot drift as a side
  effect of the counter).
- P4 Atomic quiz submission — REG-145 (the modified function still runs inside the
  `submit_quiz_results_v2` atomic transaction; the column prerequisite ordering +
  the no-`EXCLUDED.p_is_correct` assertion guard against an apply-time failure that
  would roll back the whole submission, and the unchanged 10-param signature keeps
  the unguarded `PERFORM update_learner_state_post_quiz(...)` caller valid — the
  REG-144 hazard).

### Catalog total

Pre-REG-145: 112 entries (through the schema-reproducibility fresh-DB-bootstrap
pin, REG-144). The consecutive_wrong-population structural-diff guard adds REG-145:
a static (no-DB) pin that the consecutive_wrong-maintenance migration is surgical —
unchanged 10-param signature, column added (and ordered) before it is referenced,
reset-on-correct/increment-on-wrong via `p_is_correct` (never the invalid
`EXCLUDED.p_is_correct`), and BKT/SM-2 outputs provably unchanged (byte-identical
mastery-math block). **Total catalog: 113 entries (target: 35 — TARGET
EXCEEDED).**

## SPEC-3 consecutive-wrong intervention alert — active path (2026-06-15) — REG-146

Priority: **P8/P9/P13 (monitoring data boundary).** Source: SPEC-3 wiring
(2026-06-15), post-submit telemetry. This is the LIVE half of the SPEC-3
consecutive-wrong pathway whose data-producing half (the `concept_mastery.consecutive_wrong`
counter) is pinned structurally by REG-145. Where REG-145 proves the counter is
MAINTAINED without scoring drift, REG-146 pins what CONSUMES the counter: in
`src/lib/quiz/post-submit-telemetry.ts`, after a successful (non-replay) quiz submit
and gated behind `ff_quiz_telemetry_v1`, for each unique topic the post-RPC
`concept_mastery` read returns `consecutive_wrong`; when `consecutive_wrong >= 3`,
exactly one `intervention_alerts` row is inserted (`alert_type 'consecutive_wrong'`,
`severity 'act'`, `trigger_data {count, threshold: 3}`) UNLESS an OPEN alert already
exists for the same `(student_id + topic_id + alert_type + resolved_at IS NULL)` →
dedup skip.

> **ID note:** REG-145 is the previous entry (consecutive_wrong population
> structural-diff guard, 2026-06-15). REG-146 is the next free id at the time this
> entry was written.

Three correctness hazards this pins against:

- **Dual-id contract.** The `concept_mastery` read is keyed by `students.id`; the
  `intervention_alerts` dedup-read + insert are keyed by `auth.uid()` (FK to
  `auth.users`). Conflating the two id spaces FK-violates the insert. The pin keeps
  the read and the write on their respective id keys.
- **Topic attribution.** `topic_id` is a real `curriculum_topics.id` resolved from
  `question_bank` topic resolution; an unattributable question emits NO alert (no
  `node_code` guess / no synthetic topic). A bad guess would either mis-route an
  alert or FK-violate against `curriculum_topics`.
- **Fire-and-forget safety.** The alert path runs post-RPC, after scoring/XP/BKT
  have already committed. It is fire-and-forget — it never throws or blocks the
  submit, and it performs NO scoring/XP/BKT recompute (P1-P4 untouched). It writes
  `intervention_alerts` ONLY — never the `adaptive_interventions` Loops A/B/C
  substrate.

P13: `trigger_data` carries only `{count, threshold}` (both numbers) — no PII.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-146 | `spec3_intervention_alert_active_path` | **(1) Threshold + shape:** when a unique topic's post-RPC `concept_mastery` read returns `consecutive_wrong >= 3`, exactly one `intervention_alerts` row is inserted with `alert_type='consecutive_wrong'`, `severity='act'`, `trigger_data={count, threshold:3}`; `consecutive_wrong < 3` inserts nothing. **(2) Dedup:** an OPEN alert (`student_id + topic_id + alert_type + resolved_at IS NULL`) already present → dedup skip, no second insert. **(3) Dual-id contract:** the `concept_mastery` read is keyed by `students.id`; the `intervention_alerts` dedup-read + insert are keyed by `auth.uid()` — never conflated. **(4) Topic attribution:** `topic_id` is a real `curriculum_topics.id` from `question_bank` resolution; unattributable questions emit no alert. **(5) Gating + replay:** gated behind `ff_quiz_telemetry_v1`; a replay submit emits no alert. **(6) Safety:** fire-and-forget — a thrown alert path never blocks/aborts the submit; no scoring/XP/BKT recompute; writes `intervention_alerts`, not `adaptive_interventions`. **(7) P13:** `trigger_data` keys are exactly `count` + `threshold`, both numbers, no PII. | `src/__tests__/quiz/post-submit-telemetry.test.ts` (30 tests; the 6 SPEC-3-active scenarios) | U (unit; companion to the REG-145 SPEC-3 population pin) |

### Invariants covered by this section

- P8 RLS boundary / data boundary — REG-146 (the alert path reads `concept_mastery`
  by `students.id` and writes `intervention_alerts` by `auth.uid()`; the dual-id
  contract keeps each read/write on its correct id space and inside the RLS-scoped
  client, so an alert can never reference a row outside the acting student's boundary).
- P9 RBAC enforcement — REG-146 (the alert is keyed to the right student via
  `auth.uid()` (FK `auth.users`); topic attribution rides a real
  `curriculum_topics.id` from `question_bank` resolution, so no alert is mis-routed
  to another student or a guessed topic).
- P13 Data privacy — REG-146 (`trigger_data` carries only `{count, threshold}` —
  numbers, never PII).
- P1-P4 (untouched, asserted) — REG-146 (the path is post-RPC, fire-and-forget; it
  never recomputes scoring/XP/BKT and never throws into the submit, so quiz
  accuracy / XP economy / anti-cheat / atomic submission are all unaffected; it
  writes `intervention_alerts`, not the `adaptive_interventions` Loops substrate).

### Catalog total

Pre-REG-146: 113 entries (through the consecutive_wrong-population structural-diff
guard, REG-145). The SPEC-3 active-path pin adds REG-146: the live consumer of the
REG-145 counter — when a topic's post-RPC `consecutive_wrong >= 3` and behind
`ff_quiz_telemetry_v1`, exactly one `intervention_alerts` row is inserted
(`consecutive_wrong`/`act`/`{count, threshold:3}`) unless an OPEN alert already
exists (dedup), on the dual-id contract (read by `students.id`, write by
`auth.uid()`), with real-`curriculum_topics.id` attribution, no PII in
`trigger_data`, and fire-and-forget post-RPC safety that leaves P1-P4 untouched.
**Total catalog: 114 entries (target: 35 — TARGET EXCEEDED).**

## Remediation — SAO-1/SAO-5: Super-Admin PII-Export Tiering (P9/P13) — 2026-06-29

The Cycle-6 audit found `/api/super-admin/reports` gated ALL six export types
behind a single `authorizeAdmin(request,'support')` call. `support` is the FLOOR
tier (any active `admin_users` row). Four of the six types egress
personally-identifiable data at up to 5000 rows — `students` (minors'
name+email), `teachers` (name+email), `parents` (name+email+PHONE), `audit`
(admin name+email in `details`). Mass minors'/parent PII export at the lowest
admin tier is a P9 (RBAC) + P13/DPDP exposure.

The remediation gates each report `type` at its own tier via a `REPORT_CONFIG`
map: the 4 PII types require `super_admin`; the 2 UUID-only, non-PII types
(`quizzes`, `chats`) keep the `support` floor. `type` is validated against the
map FIRST — an unknown type returns 400 BEFORE `authorizeAdmin` or any DB access
(fail-closed, gate-before-data). The missing-`type` default resolves to
`students` → `super_admin` (strictly safer than the old `support` default). The
fix uses only existing tiers — no new permission/role/migration. It is a one-line
loosening (drop the PII tier) if the CEO later chooses to let some staff retain
PII export.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-198 | `super_admin_reports_pii_export_tier` | P9/P13: the `/api/super-admin/reports` route gates the 4 PII report types (students/teachers/parents/audit) at `admin_level` super_admin and the 2 UUID-only types (quizzes/chats) at the support floor; `type` is validated before the gate (unknown → 400 before authorizeAdmin or any DB access); gate-before-data ordering; no blanket floor inheritance for PII types (no single `authorizeAdmin(request,'support')`, per-type `config.level`, default `type` resolves to students → super_admin). Closes the Cycle-6 finding that mass minors'/parent PII export sat at the lowest admin tier. Static source-parse pins (comments stripped so the doc-quoted old pattern can't satisfy/break the guard). | `src/__tests__/api/super-admin/reports-pii-tier.test.ts` (14 tests) | U | P9,P13 |

### Invariants covered by this section

- P9 (RBAC enforcement) — REG-198 pins per-type tiering: the 4 PII exports require
  `super_admin`, the gate is per-type (`config.level`, no blanket `support`
  inheritance), and an unknown `type` fails closed (400) before the gate or any
  DB access.
- P13 (data privacy) — REG-198 pins that the bulk PII exports (minors' + parents'
  name/email/phone) can no longer be run from the lowest admin tier, and the
  missing-`type` default resolves to the safest tier.

### Catalog total

Pre-SAO-1/SAO-5: 164 entries (through Remediation FOX-4's REG-197 MoL-shadow
governance). Remediation SAO-1/SAO-5 adds REG-198 (super-admin PII-export
per-type tiering — the P9/P13 gate-before-data + no-floor-inheritance pins).
**Total catalog: 165 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — Tier-2 PR B: Super-Admin Export Message Redaction (P13) — 2026-06-29

The Tier-2 PR B slice wraps the free-form `message` CSV column of the super-admin
observability export (`/api/super-admin/observability/export`) in
`redactPIIInText(...)` before egress, mirroring the SAO-3 defense-in-depth
treatment of the `context_json` column two lines below. Ops event messages are
developer-authored templates and PII-free at write time (`logOpsEvent`), so on
clean rows the redactor is an IDENTITY transform (behavior-preserving) — but this
CSV is the last line of defense before bulk egress, and a single mis-instrumented
upstream message carrying an email / Indian phone / Razorpay id would otherwise be
exfiltrated verbatim. Null/empty `message` is passed through untouched. The change
also adds `redactPIIInText` to the `src/lib/ops-events-redactor.ts` re-export
barrel (one line) so the Next.js side imports the shared Deno-compatible redactor.

The route reads through the RLS-bypassing admin client and the unit lane has no
live Postgres, so the wrapping is pinned as comment-stripped static-source
assertions (same convention as the admin-route auth-gate sweep and the REG-201
active-enrollment scoping pin): assert the import is from `@/lib/ops-events-redactor`,
assert the exact `escapeCSV(row.message ? redactPIIInText(row.message).text :
row.message)` ternary (null/empty passthrough preserved), and guard that the
SAO-3 `redactPII(row.context)` sibling is intact. Because `redactPIIInText` is a
pure function, the BEHAVIORAL lane is covered directly: email / Indian phone /
Razorpay-id redaction fire, and a clean developer-template message returns
UNCHANGED (identity transform — proves behavior-preserving on clean rows).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-202 | `super_admin_export_message_pii_redaction` | P13: the super-admin observability CSV export wraps the free-form `message` column in `redactPIIInText` before egress (email/phone/Razorpay-id redacted; clean developer-template rows pass through unchanged — identity transform, null/empty preserved), surfaced via the `@/lib/ops-events-redactor` barrel — defense-in-depth mirroring the SAO-3 `context_json` redaction | `src/__tests__/api/super-admin/observability-export-message-redaction.test.ts` | U | P13 |

### Invariants covered by this section

- P13 (data privacy) — REG-202 pins that the bulk CSV export's free-form `message`
  column is pattern-redacted (email / Indian phone / Razorpay id) at the egress
  boundary, that null/empty messages pass through untouched, and that the redactor
  is an identity transform on the PII-free developer templates ops events carry at
  write time (behavior-preserving). Surfaced through the `@/lib/ops-events-redactor`
  barrel; mirrors the SAO-3 `context_json` deep-redaction sibling.

### Catalog total

Pre-Tier-2-PR-B: 168 entries (through Tier-2 PR A's REG-201 teacher/enrollment
is_active scoping). Tier-2 PR B adds REG-202 (super-admin export message redaction
— the P13 free-form `message`-column egress-redaction source pin + redactor
behavior + barrel export).
**Total catalog: 169 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — SLC-4: Fallback Daily-Cap Alignment (P2) — 2026-06-30

The quiz-submit client-side fallback in `src/lib/supabase.ts` (`submitQuizResults`,
~544-606) called the BROKEN 6-param JSONB overload of `atomic_quiz_profile_update`,
whose daily-cap read referenced a NON-EXISTENT `quiz_sessions.xp_earned` column
(XP lives in `score`). That raised Postgres 42703 at runtime; the surrounding catch
then silently degraded to an UNCAPPED `student_learning_profiles` upsert — so the
fallback path enforced NO 200 XP/day cap and could award a SECOND 200 on top of the
primary path (up to 400/day, a P2 breach). SLC-4 repoints the fallback to the
CANONICAL 7-param VOID overload by passing `p_session_id: session?.id ?? null` (the
7th param forces PostgREST to resolve the ledger-based, IST-boundary, 200/day-capped
writer — the SAME one the primary v2 path uses). The void overload returns no JSONB,
so the over-cap UI display (`effective_xp` / `xp_capped`) is RE-DERIVED by reading
back the AUTHORITATIVE `xp_transactions` ledger row (`reference_id='quiz_<session>'`,
`.maybeSingle()`) — `effectiveXp = ledgerRow.amount; xpCapped = effectiveXp <
xpEarnedUncapped` — never a client recompute from the correct-count. The degraded
uncapped upsert is now reached ONLY on a GENUINE RPC failure (`if (rpcErr) throw
rpcErr`), not the old swallowed 42703. The 200 cap VALUE is unchanged — alignment only.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-205 | `slc4_fallback_routes_through_capped_ledger_writer` | P2: the quiz-submit fallback in `src/lib/supabase.ts` invokes `atomic_quiz_profile_update` with `p_session_id` (the 7-param void, ledger-based, IST-boundary, 200/day-capped writer — same as primary), closing the prior cap-bypass where the 6-param JSONB overload referenced a non-existent `quiz_sessions.xp_earned` column, raised 42703, and silently degraded to an uncapped upsert (primary+fallback could each award 200/day → up to 400); over-cap UI value re-derived from the authoritative `xp_transactions` ledger row, not client-recomputed; 200 cap value unchanged | `src/__tests__/lib/slc4-fallback-cap-alignment.test.ts` | E | P2 |

### Invariants covered by this section

- P2 (XP economy / daily cap) — REG-205 pins that the client-side quiz-submit
  fallback flows through the SAME 7-param capped ledger writer as the primary path
  (comment-stripped source pin that the `atomic_quiz_profile_update` call carries
  `p_session_id` and that NO bare 6-param JSONB call survives in the submit path),
  that the over-cap display is re-derived from the authoritative `xp_transactions`
  ledger row rather than recomputed client-side, that the uncapped degraded upsert
  is gated behind a re-thrown genuine RPC failure, that the 200/day cap value is
  unchanged, and (modelled) that primary+fallback can never exceed 200/day.

### Catalog total

Pre-SLC-4: 171 entries (through Tier-2 PR C's REG-204 durable parent-login limiter).
SLC-4 adds REG-205 (quiz-submit fallback daily-cap alignment — fallback repointed
to the 7-param capped void overload of `atomic_quiz_profile_update`, closing the
6-param 42703 → uncapped-upsert → up-to-400/day P2 bypass; ledger-derived over-cap
display; 200 cap value unchanged).
**Total catalog: 172 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — SLC-5: Anti-Cheat Advisory Convergence (P3) — 2026-06-30

The quiz client (`src/app/quiz/page.tsx`) historically treated two of the three P3
anti-cheat checks as HARD REJECTS: Check 1 (avg time < 3s/question) and Check 3
(response count ≠ question count) each early-`return`ed a discarded result object
(`score_percent: 0, xp_earned: 0, session_id: ''`) BEFORE calling
`submitQuizResults(...)` — so a legitimately-fast or edge-case student's attempt was
silently destroyed client-side and NO session was ever recorded. But the client is
not a security boundary (P3/P9): the server RPC (`submit_quiz_results_v2`) already
re-applies the SAME 3 checks, sets `flagged=true`, zeroes XP, and STILL records the
session with the REAL `score_percent` (record-but-zero). SLC-5 converges the client
to ADVISORY-only: Check 1 and Check 3 now keep only a `console.warn` and ALWAYS fall
through to `submitQuizResults(...)` (Check 2 was already flag-only — unchanged). The
three thresholds are BYTE-UNCHANGED (`avgTimePerQ < 3`, `mcqResponses.length > 3 &&
maxSameOption === mcqResponses.length`, `allResponses.length !== questions.length`)
— only the client RESPONSE changed from reject → advisory-submit. The results state
gains `flagged?: boolean`; when the server returns `flagged=true` the results screen
renders a gentle, NON-accusatory bilingual note (EN/HI via `isHi`, P7) explaining no
XP was awarded while the real server score (P1, no client recompute) stays shown.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-206 | `slc5_client_anticheat_advisory_always_submits` | P3: the quiz client no longer hard-rejects/discards an attempt on the avg-<3s or count-mismatch anti-cheat checks — all 3 checks are advisory and ALWAYS submit to the server, which is the single authority (applies flag + zero-XP + records the session with the REAL score); thresholds byte-unchanged; flagged result renders a gentle bilingual (P7) note with XP=0 and the real server score (P1, no client recompute) | `src/__tests__/quiz/slc5-anticheat-advisory-convergence.test.ts` | E | P3, P7, P1 |

### Invariants covered by this section

- P3 (anti-cheat) — REG-206 pins that the speed (avg<3s) and count-mismatch branches
  no longer early-`return` a `score_percent:0 / xp_earned:0 / session_id:''` discard,
  that all 3 advisory branches fall through to `submitQuizResults(` with no `return`
  between the first check and the submit, and that the 3 threshold conditions remain
  byte-unchanged (a future threshold or response-semantics change fails the test).
  The legacy discard pin in `quiz-pattern-flag-intended-behavior.test.ts` (SLC-6) was
  updated in lock-step to assert the new advisory convergence for speed + count.
- P7 (bilingual UI) — the flagged note carries BOTH an English and a Hindi
  (Devanagari) string gated by `isHi`, mentions XP (untranslated technical term), and
  is NON-accusatory (no "cheat"/"धोखा" language; frames the outcome as "try again").
- P1 (score accuracy) — the always-submit path assigns the result straight from the
  server response (`setResults(res)`) with no `calculateScorePercent` / `Math.round((
  correct/...))` recompute between submit and display; the only client-side score math
  (`calculateScorePercent`) is scoped to the offline network-error catch.

### Catalog total

Pre-SLC-5: 172 entries (through SLC-4's REG-205 fallback daily-cap alignment).
SLC-5 adds REG-206 (client anti-cheat advisory convergence — speed + count checks no
longer discard the attempt; all 3 checks always submit to the authoritative server;
thresholds byte-unchanged; gentle bilingual flagged note; server-authoritative score).
**Total catalog: 173 entries (target: 35 — TARGET EXCEEDED).**

---

## 2026-07-03 — Adaptive-pipeline repair wave: differential-experience invariant — REG-231..REG-234

Source: the 2026-07-02 forensic audit of the adaptive pipeline. Four
independent defects made the pipeline silently INERT — a struggling learner
and a thriving learner received byte-identical experiences:

1. **Personalization inversion (quiz-generator, Deno):** a calibrated IRT
   theta set `difficulty` via the ZPD banding, and the pipeline's
   `difficulty == null` guards then DISABLED review-fill (step 1) and
   adaptive selection (step 2) — precisely the students WITH signal lost the
   adaptive path. Also `selectAdaptiveQuestions` read
   `concept_mastery.mastery_level` as if numeric; since migration
   `20260623000000` that column is a TEXT band label
   ('mastered'/'proficient'/…), so the `< 0.95` filter/sort were nonsense.
2. **Ghost due-schedule column:** `concept_mastery.next_review_date` is a
   DATE column with a `CURRENT_DATE + 1` default that NOTHING ever writes —
   every reader keyed on it saw every touched concept "due" one day after
   first attempt, forever (SRS degenerated into "any previously touched
   topic"). Readers affected: Foxy cognitive-context overdue-reviews, the
   dashboard reviews-due route, the revision overview route, and the
   `get_adaptive_questions` SQL due-predicate. The real SM-2 schedule lives
   in `next_review_at` (timestamptz), written by
   `update_learner_state_post_quiz` on every quiz.
3. **Dead nextAction:** Foxy's `nextAction` came from a cme-engine
   `get_next_action` network call that 401'd on EVERY request (service-role
   key against a user-JWT `auth.getUser()` check), silently swallowed —
   nextAction was always null. Replaced by the pure, local
   `deriveNextAction` 5-priority ladder over data `loadCognitiveContext`
   already loads.
4. **Broken SRS chain:** QuizResults wrong-answer flashcard inserts silently
   failed (the NOT-NULL `grade` column was omitted) and wrote
   `results.session_id` into `source_id` (unresolvable as a
   `question_bank.id`, so a due card could never resurface its question);
   the learner-loop due count read the NONEXISTENT `review_cards` table
   (always errored → 0 → the `review_due_cards` branch was permanently
   dead).

The repair wave fixed all four; these entries pin the fixes AND the umbrella
invariant that the fixes exist to serve: **two learners with different
knowledge states must get measurably different experiences.**

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-231 | `adaptive_differential_experience` | The umbrella differential invariant, proven pure-function-level (no live DB) for synthetic WEAK (low `mastery_probability`, overdue reviews, >=3 conceptual errors, low theta) vs STRONG (all >= 0.85, nothing due, no errors) learners across all three adaptive surfaces: (a) `deriveNextAction` — WEAK gets an actionable intervention from {remediate, revise, re_teach, practice} while STRONG gets `null`, and a strong-but-short-of-mastery learner (0.6 <= m < 0.85) gets `challenge`, never remediation; the 5-priority ladder order is pinned (knowledge gap > overdue review > >=3 conceptual errors > next unmastered) plus every threshold boundary (0.59 practice / 0.6 challenge / 0.84 challenge / 0.85 exactly → mastered → null; 3 conceptual errors re_teach, 2 fall through; re_teach requires an unmastered concept; non-conceptual error types never re_teach; overdue picks weakest mastery first with oldest-`next_review_at` tie-break; gap remediates the prerequisite, falling back to the target when prerequisite is blank). (b) learner-loop `resolveNextLearnerAction` — three learners resolve to THREE distinct actions: empty mastery → `cold_start_diagnostic`, rich mastery + dueReviewCount >= REVIEW_STACKING_THRESHOLD → `review_due_cards` (boundary: threshold-1 does NOT fire), rich mastery + nothing due → `start_quiz` on the WEAKEST chapter (`todays_zpd`); two rich learners with different weakest chapters get different quiz URLs. (c) `selectAdaptiveQuestions` (now flag-ON) — a 0.2-mastery profile and a 0.8-mastery profile yield DISJOINT candidate sets (different chapters, different Bloom composition: weak capped at remember/understand, stronger reaching above), and a fully-mastered learner yields zero adaptive candidates; `FLAG_DEFAULTS[ff_adaptive_live_selection_v1] === true` is pinned. | `src/__tests__/adaptive-differential.test.ts` (Sections 1-3, 21 tests) | E |
| REG-232 | `theta_difficulty_inversion_fix` | The quiz-generator personalization inversion stays fixed (SOURCE PINS — the Edge Function is Deno and cannot be imported into Vitest; interim pending Deno-level tests): `const difficultyExplicitlyRequested = difficulty != null` is captured BEFORE the theta→difficulty ZPD banding (`!difficultyExplicitlyRequested && abilityEstimate != null`); the review-fill step (`if (!difficultyExplicitlyRequested) {`) and the adaptive-selection step (`if (!difficultyExplicitlyRequested && adaptiveSlots > 0)`) are guarded by CALLER intent, never by `difficulty == null` (the inverted shape is absent from executable code); `selectAdaptiveQuestions` reads the canonical numeric `mastery_probability` (`.lt('mastery_probability', 0.95)` + `.order('mastery_probability'…)`) and the TEXT band `mastery_level` is absent from executable code. Companion app-TS pins: `getQuizQuestionsV2`'s theta read filters `student_learning_profiles` by `(student_id, subject)` — without the subject filter a 2+-subject student made `maybeSingle()` error and theta silently stayed null (`src/lib/supabase.ts`); the app-TS selector's mastery query records `mastery_probability < 0.95` (behavioral, via the fake-client filter log). | `src/__tests__/adaptive-differential.test.ts` (Sections 4 + 5a + the Section-3 column pin, 6 tests) | E |
| REG-233 | `ghost_next_review_date_repoint` | Every `concept_mastery` due-schedule reader queries the REAL SM-2 column `next_review_at` (timestamptz, written by `update_learner_state_post_quiz`) and never the ghost `next_review_date` DATE column (`CURRENT_DATE + 1` default, no writer — made every touched concept perpetually "due"): `src/app/api/foxy/_lib/cognitive-context.ts` (overdue-reviews query), `src/app/api/dashboard/reviews-due/route.ts`, `src/app/api/revision/overview/route.ts` (all three: `next_review_at` present in executable code, no quoted `next_review_date` column reference outside comments — pins scoped to concept_mastery readers; `spaced_repetition_cards.next_review_date` is a REAL column on a different table and stays legitimate); migration `20260702200000` repoints the `get_adaptive_questions` due predicate to `next_review_at <= now()` (NULL = never scheduled = not due). Also pins that cognitive-context exports the pure `deriveNextAction` ladder and that the retired 401-dead cme-engine `get_next_action` network call (`functions/v1/cme-engine`) is absent — behavioral coverage of the ladder itself lives in REG-231(a). Contract shapes of the two routes (dueCount/oldestDueDate/estimatedMinutes; overview buckets keyed by the UTC date part) are preserved and covered by their existing updated tests (`src/__tests__/api/dashboard-reviews-due.test.ts`). | `src/__tests__/adaptive-differential.test.ts` (Section 5d, 5 tests) | E |
| REG-234 | `srs_chain_repair` | The wrong-answer→flashcard→review-quiz SRS chain is wired end-to-end: (a) QuizResults card writes carry `source_id = question.id` (a resolvable `question_bank.id` — never `results.session_id`), carry `grade: student.grade` (NOT-NULL column whose omission silently failed every insert; P5 string), dedupe by question text AND by `(source='quiz_wrong_answer', source_id)`, and retry row-by-row when the batch insert hits the partial-unique-index conflict (`idx_src_u` — PostgREST upsert cannot target a partial index, one conflicting row aborted the whole batch) (`src/components/quiz/QuizResults.tsx`); (b) learner-loop `buildLoopAugmentation` counts dues from the LIVE `spaced_repetition_cards` table (`is_active = true`, `next_review_date <= today`, mirroring the `get_review_cards` RPC) and the nonexistent `review_cards` table never comes back (`src/lib/state/learner-loop/resolve-next-action.ts`) — behavioral proof that the un-dead `review_due_cards` branch fires at threshold lives in REG-231(b); (c) the quiz page consumes the adaptive deep links that close the loop: `?qid=<uuid>` behind a strict UUID guard pins a P6-validated question first, `?mode=srs` builds a review quiz from due cards' `source_id`s (`.eq('source','quiz_wrong_answer')`, `.not('source_id','is',null)`), both fire exactly once via `deepLinkFiredRef` and every failure falls back fail-soft to the normal setup screen (`catch` → `setLoading(false)`, no error surface); `pinnedQuestions`/`pinnedOnly` plumbing routes through the NORMAL pipeline (P6 gate, server shuffle, anti-cheat, atomic submit untouched — deep links only choose WHICH questions are served) (`src/app/quiz/page.tsx`). | `src/__tests__/adaptive-differential.test.ts` (Sections 5b + 5c + 5e, 11 tests) | E |

### Invariants covered by this section

- **Differential-experience (P-learner-state umbrella)** — REG-231 is the
  first catalog entry that asserts the adaptive pipeline's reason to exist:
  distinct knowledge states MUST produce distinct recommendations, distinct
  quiz targets, and distinct candidate sets. Any future regression that
  re-flattens the pipeline (a guard inversion, a ghost column, a dead
  network call, a silent insert failure) breaks at least one differential
  assertion even if every component test still passes in isolation.
- P6 Question quality — REG-234(c): deep-linked questions pass the same
  `isValidQuestion` P6 gate as pool questions; REG-231(c): every adaptive
  candidate remains MCQ-shaped (main coverage in
  `select-adaptive-questions.test.ts`).
- P5 Grade format — REG-234(a): the repaired card insert writes
  `student.grade` (string) verbatim.
- P1/P2/P3/P4-adjacent — REG-234(c) pins that deep links only change WHICH
  questions are served; scoring, XP, anti-cheat, and atomic submission flow
  through the unchanged pipeline.
- Operational-integrity — REG-232's source pins are explicitly INTERIM
  (Deno-level tests for quiz-generator remain a gap, same class as the
  REG-118 static-source canary); REG-231's Section-3 pin of
  `FLAG_DEFAULTS[ff_adaptive_live_selection_v1] === true` documents the
  2026-07-02 enable migration `20260702210000` so a silent default flip is
  caught in PR CI.

**Amendment 2026-07-03 (branch `fix/srs-dedupe-per-question`, assessment-mandated "restore complete SRS"):**
REG-234(a)'s QuizResults card write now uses a per-question composite dedupe
key — ``topic = `${subject}:${chapter ?? 'na'}:${question_id}` `` — instead of
the original `topic = bloom_level`. The bloom key, combined with the DB's
partial unique index `idx_src_u (student_id, topic, card_type) WHERE topic IS
NOT NULL` (first-writer-wins), capped every student at **6 lifetime review
cards across ALL subjects** (one per Bloom level), while NULL-bloom cards
escaped dedupe entirely (unbounded duplicates on retakes). The composite key
restores true per-item spaced repetition: every distinct wrong question = its
own card; the same question wrong twice = one card (client source_id dedupe +
the existing 23505-benign row-retry path). Topic is now always non-null for
quiz-wrong cards, closing the NULL-topic escape. Bloom level is dropped from
the card row — recoverable via the `source_id → question_bank.bloom_level`
join. No schema/index change. New pins: Section 5b source pin for the
composite key + absence of `topic: q.bloom_level`
(`src/__tests__/adaptive-differential.test.ts`); behavioral pins (composite
key contains the question id; two distinct wrong questions same bloom → two
cards; same question twice → one card; topic never null; batch-then-retry ×
new-key interaction — one row's composite key 23505s on the retake race →
batch aborts, row retry keeps the OTHER card, banner counts exactly 1, no
warn) in `src/__tests__/components/quiz/QuizResults.flashcard-grade.test.tsx`
(REG-235's file). The other two writers are intentionally unaffected:
`/api/learner/cards/create` omits `topic` (NULL — student-created cards stay
outside `idx_src_u` by design) and the Foxy save-flashcard route keeps its
accepted topic-level dedupe.

### Catalog total

Pre-REG-231: 197 entries (through REG-230, production-reference guard).
Today's adaptive-pipeline repair wave adds REG-231 (umbrella
differential-experience invariant), REG-232 (theta/difficulty inversion +
canonical mastery column), REG-233 (ghost `next_review_date` repoint), and
REG-234 (SRS chain repair: source_id + grade + spaced_repetition_cards +
deep links).
**Total catalog: 201 entries (target: 35 — TARGET EXCEEDED).**

---

