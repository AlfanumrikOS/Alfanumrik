## Teacher detect→act→verify remediation spine (Phase 3A Wave A) — REG-92

Source: Phase 3A Wave A "Class Command Center + Alert→Remediation spine"
(behind `ff_teacher_command_center`). A1 ships the data layer + RLS + RBAC
(`supabase/migrations/20260613000004_teacher_remediation_assignments.sql`,
new `class.assign_remediation` permission — flagged for CEO sign-off at merge);
A2 the assign/list route (`src/app/api/teacher/remediation/route.ts`); A3 the
Today-resolver branch + status-flip helpers + the student-side resolve endpoint
(`src/lib/state/learner-loop/resolve-next-action.ts`,
`src/app/api/rhythm/remediation/[id]/resolve/route.ts`); A4 the Command Center
UI (`src/app/teacher/CommandCenter.tsx`) + the student "from your teacher"
surfacing (`src/lib/today/*`, `src/components/today/TodayFocusCard.tsx`,
`TodayQueueItem.tsx`) + the quiz-completion resolve seam (`src/app/quiz/page.tsx`).

The headline loop — teacher spots an at-risk student → assigns remediation →
the student sees it at the TOP of Today tagged "from your teacher" → completes
it as a NORMAL quiz → the teacher's alert shows resolved — crosses three trust
boundaries. Each is a blocking defect if it regresses: (a) a teacher must NOT
read or assign remediation for a student off their roster, and a student must
NOT read another student's assignment (P8); (b) a teacher-assigned quiz must
score/award XP/anti-cheat EXACTLY like any other student quiz — the assignment
must carry no score/XP fields and the completion flip must be decoupled from the
submit path (P1/P2/P3/P4 untouched); (c) the lifecycle (assigned→in_progress→
resolved) must be idempotent so a re-drain / double-render / re-surface never
double-resolves or double-grants.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-92 | `teacher_detect_act_verify_remediation_spine` | **(a) P8 RLS roster boundary.** The `teacher_remediation_assignments` policies gate a teacher to rows where teacher_id resolves to their own `teachers.id` (auth.uid()) AND student_id is on their roster via the canonical `class_students × class_teachers` join — enforced on SELECT (USING), INSERT (WITH CHECK), and UPDATE (BOTH USING and WITH CHECK, so an owned row cannot be re-pointed at an off-roster student). A forged off-roster student_id fails the predicate. A student SELECT policy scopes to `students.auth_user_id = auth.uid()` ONLY (no `class_teachers`, no open `USING (true)`) so a student reads only their own rows; students get NO insert/update/delete policy. Service role keeps `FOR ALL` for the Today-resolver join. The same roster gate is enforced a second time in application code at the route layer (defense in depth): a POST for an off-roster student → 403, no insert. **(b) P2/P3 no-bypass.** A teacher-assigned remediation REUSES the existing `/quiz` route (no new quiz type) carrying `from=teacher&remediationId=<id>`; the assignment row carries NO score/XP/correct fields (only ids + status + timestamps), and the quiz-page completion seam fires `POST /api/rhythm/remediation/[id]/resolve` ONCE — fire-and-forget, decoupled from `submitQuizResults`/the atomic RPC — so score (P1), the XP formula + 200/day cap (P2), and the 3-rule anti-cheat verdict (P3) are computed by the SAME server authority as any normal quiz; the resolve route threads the INTERNAL `students.id` (never auth.uid()). **(c) Idempotent lifecycle.** `markTeacherRemediationInProgress` is guarded by `status='assigned'` (no-op for non-assigned); `resolveTeacherRemediation` flips assigned|in_progress → resolved (+resolved_at) and returns `alreadyResolved:true` with NO second write when already resolved; the assign POST is idempotent on an open (assigned|in_progress) row for the same (teacher,student,chapter) — returns the existing row, no duplicate insert; status column is CHECK-constrained to the four lifecycle states. Re-drain/re-render/re-surface safe. | `src/__tests__/teacher/remediation-rls-policies.test.ts` (A5 — P8 roster join on teacher SELECT/INSERT/UPDATE, student self-scope, no open predicate, service-role FOR ALL, idempotent migration, status CHECK) + `src/__tests__/api/teacher/remediation/route.test.ts` (A2 — `class.assign_remediation` gate, off-roster 403 no-insert, roster-verified insert uses internal teacher_id, open-row idempotency) + `src/__tests__/state/learner-loop/teacher-remediation.test.ts` (A3 — teacher item wins the queue + reuses `/quiz` + carries from=teacher/remediationId; absent ⇒ queue unchanged; status-flip helpers idempotent, no scoring/XP touched) + `src/__tests__/api/rhythm/remediation-resolve.test.ts` (A3 — resolve route threads INTERNAL studentId, idempotent 200, notFound 404) + `e2e/teacher-remediation-spine.spec.ts` (browser net for the assign action + alert status transition + student surfacing; one live cross-session round-trip left to integration, fixme-gated on the shared test fixture) | E |

### Pinned tests

- `src/__tests__/teacher/remediation-rls-policies.test.ts::REG-92 / A5 — P8: teacher can only read/write rows for students on their roster::teacher INSERT policy WITH CHECK gates on ownership + roster + class-taught`
- `src/__tests__/teacher/remediation-rls-policies.test.ts::REG-92 / A5 — P8: a student can only read their OWN rows (never another student's)::student SELECT policy scopes to student_id via students.auth_user_id`
- `src/__tests__/api/teacher/remediation/route.test.ts::POST /api/teacher/remediation — roster scope (P8)::returns 403 (no insert) when the student is not on the caller roster`
- `src/__tests__/api/teacher/remediation/route.test.ts::POST /api/teacher/remediation — idempotency::returns the existing OPEN assignment without inserting a duplicate (200)`
- `src/__tests__/state/learner-loop/teacher-remediation.test.ts::teacher_remediation — highest-priority branch::chapter-anchored assignment → top item, source:teacher, assignmentId, reused quiz route`
- `src/__tests__/state/learner-loop/teacher-remediation.test.ts::resolveTeacherRemediation — completion → resolved::already-resolved → idempotent success (no second write)`
- `src/__tests__/api/rhythm/remediation-resolve.test.ts::POST /api/rhythm/remediation/[id]/resolve::happy path: threads the INTERNAL studentId (not auth.uid()) and returns 200`

### Invariants covered by this section

- P8 (RLS boundary) — the roster join (`class_students × class_teachers`) gates
  every teacher read/write, the student policy self-scopes via
  `students.auth_user_id`, and the same gate is re-enforced at the route layer.
  Promotes the previously tested-only teacher-roster boundary into the catalog.
- P9 (RBAC enforcement) — the assign/list route is gated by
  `authorizeRequest(request, 'class.assign_remediation')`; the resolve route by
  `quiz.attempt` + `requireStudentId`. The new permission is flagged for CEO
  sign-off (RBAC permission addition).
- P1/P2/P3/P4 (no-bypass) — a teacher-assigned quiz runs as a normal student
  quiz: the assignment carries no score/XP fields, the completion flip is
  decoupled from `submitQuizResults`/the atomic RPC, and the server stays the
  sole grading + XP + anti-cheat authority. No scoring/XP/anti-cheat code is
  touched by Wave A. Extends REG-45/REG-48/REG-51.
- Idempotent lifecycle (operational invariant) — assigned→in_progress→resolved
  is replay-safe end to end: open-row idempotent assign, status-guarded flip,
  already-resolved no-op, and a fire-and-forget completion seam tolerant of
  double-render / re-surface.

### Notes on test strategy

REG-92 uses the repo's **source-level RLS pattern** (mirrors
`rls-student-id-policies.test.ts`): the A5 test asserts the migration SQL
enforces the roster join clause-by-clause rather than running Postgres from
Vitest — sufficient to catch a relaxed predicate, a dropped WITH CHECK, or an
`USING (true)` footgun during a refactor, with a negative assertion guarding the
open-predicate case. The live behavior (an actual off-roster INSERT returning
403) is additionally covered at the route layer, so the boundary is defended
twice. The route/resolver/resolve tests (A2/A3) mock only the seams
(`authorizeRequest`, `supabase-admin`, the status-flip helper) so the REAL gate
+ ownership + idempotency logic runs and is asserted on the observable contract
(status codes, the exact insert payload, which helper args were threaded).

The E2E spec nets the headline loop at the browser layer in three mocked halves
(teacher assign action → alert flips to Assigned; resolved status → ✓ pill;
student-side "from your teacher" surfacing + the reused-`/quiz` deep link).
Rendered-page assertions are `test.fixme(!hasRealStudentCreds(), …)`-gated
because the mocked Supabase session only clears the auth wall against a real
Supabase URL (the CI placeholder bounces to /login) — the same fixture
limitation as REG-45/REG-69. The ONE honest gap left to integration is a single
LIVE cross-session round-trip (one real assignment row written by a teacher's
POST, surfaced by the real resolver to the assigned student, flipped to resolved
by the real completion POST, with RLS enforced); its pieces are unit/route-
covered today, and closing it is tracked alongside the shared test fixture.

### Catalog total

Pre-Phase-3A-Wave-A: 59 entries. Phase 3A Wave A (teacher Command Center +
Alert→Remediation spine) adds REG-92 (teacher detect→act→verify remediation
spine — P8 RLS roster boundary, P1/P2/P3 no-bypass, idempotent lifecycle).

**Total: 60 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Teacher cross-assignment grading queue (Phase 3A Wave B) — REG-93

Source: Phase 3A Wave B "Cross-assignment grading queue" (behind
`ff_teacher_assignment_lifecycle`, layered ON TOP of `ff_teacher_command_center`;
both default OFF). Adds the `get_grading_queue` teacher-dashboard Edge action
(`supabase/functions/teacher-dashboard/index.ts` — `handleGetGradingQueue` +
the pure `buildGradingQueue` / `deriveNeedsReviewReason` helpers) and the Command
Center surface/badge/button wiring (`src/app/teacher/CommandCenter.tsx`,
`src/app/teacher/GradingQueue.tsx`, `src/lib/use-teacher-assignment-lifecycle.ts`,
`src/app/teacher/submissions/page.tsx` deep-link). No migration, no new
permission, no scoring/XP math — the queue is a READ that REUSES the existing
`get_submission_detail` + `mark_submission_reviewed` grading path.

The queue is the single "N submissions awaiting grading" surface that spans every
assignment a teacher owns. Three things are blocking defects if they regress:
(a) the queue must NEVER surface an already-graded/reviewed submission, and a
submission must LEAVE the queue the moment a teacher grades it — a re-surfaced
graded item would invite double-grading and a score-override race; (b)
`needs_review_reason` is additive exception metadata derived from EXISTING
anti-cheat signals (P3 all-same-answer / too-fast) and must NEVER alter the
score or XP a teacher sees — `auto_score` is rendered verbatim from the Edge
response with no client re-scoring (P1/P2 untouched); (c) with the Wave B flag
OFF the Command Center must be byte-identical to Wave A — the queue is never
fetched, the surface never mounts (lazy chunk never loads — P10), and the
"Grading queue" button stays the disabled Wave A placeholder.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-93 | `teacher_grading_queue_ungraded_only_signal_only_flag_off` | **(a) Ungraded-only aggregation — no double-grading.** `buildGradingQueue` emits ONLY submissions whose derived ui-status is `submitted` (turned in, not graded): graded / reviewed / pending rows are excluded, and the SAME submission that appears while `submitted` DISAPPEARS once `mark_submission_reviewed` stamps `graded_at` + flips status to `graded` (the unchanged write) — a `graded_at` stamp alone is enough to drop it even if status lags. The server query is pinned to `.is('graded_at', null)` + `.in('status', ['submitted','completed'])` so a refactor cannot silently widen the queue to graded rows. The queue spans MULTIPLE assignments (each item stamped with its assignment title), is oldest-first FIFO by `submitted_at`, and is `teacher_id`-scoped (P8 roster boundary). **(b) `needs_review_reason` is signal-only — P1/P2 untouched.** The flag is derived purely from EXISTING signals — `all_same_answer` (>3 answered, all same option index — the P3 rule, with a uniform 3-Q quiz NOT flagged) and `too_fast` (avg < 3 s/question — the P3 floor, with exactly-3 s NOT flagged), all_same_answer winning when both fire, null when no usable signal (no fabrication). It NEVER moves the number: `auto_score` is byte-identical whether or not the flag fires (same score/total → same 70 regardless of recorded time; same canonical 100 regardless of answer pattern), preferring the canonical `score` column and falling back to `Math.round((correct/total)*100)` — rendered verbatim by `<GradingQueue>` with no client re-scoring, and grading still flows ONLY through the unchanged `mark_submission_reviewed`. **(c) Flag-OFF byte-identical.** `ff_teacher_assignment_lifecycle` defaults OFF and is unseeded ⇒ `useTeacherAssignmentLifecycle()` resolves false; the Command Center never fetches `get_grading_queue`, the lazy `GradingQueue` chunk never mounts, the "Awaiting grading" tile is absent, and `<ActionBar gradingQueueEnabled={false}>` keeps the "Grading queue" button DISABLED (no badge, click is a no-op) — the Wave A 4-tile layout. With the flag ON the button enables, badges the count, and opens the queue. | `src/__tests__/functions/teacher-dashboard-grading-queue-action.test.ts` (24 tests: ungraded-only filter incl. graded/reviewed/pending exclusion + the submitted→graded transition + graded_at-alone drop; multi-assignment span; oldest-first FIFO; auto_score canonical-then-ratio + score-neutral vs too_fast / all_same_answer; needs_review_reason derivation incl. >3-only, 3s-floor, precedence, no-fabrication, historical-key normalisation; dispatcher `case 'get_grading_queue'` + handler/helper presence; SQL `.is('graded_at', null)` + `'submitted','completed'` filter pin; `.eq('teacher_id', teacherId)` P8 scope) + `src/__tests__/components/teacher/grading-queue.test.tsx` (9 tests: one row per item with auto_score verbatim; exception chips bilingual + flagged-row hoist; row click → onOpenRow reuses the review flow; empty/loading/error states; Hindi P7; ActionBar flag-OFF disabled placeholder vs flag-ON enabled+badged+opens) | U |

### Pinned tests

- `src/__tests__/functions/teacher-dashboard-grading-queue-action.test.ts::buildGradingQueue — aggregation::returns ONLY submitted-but-ungraded rows; excludes graded and pending`
- `src/__tests__/functions/teacher-dashboard-grading-queue-action.test.ts::buildGradingQueue — graded items leave the queue (no double-grading)::the same submission appears while submitted, then disappears once graded`
- `src/__tests__/functions/teacher-dashboard-grading-queue-action.test.ts::buildGradingQueue — graded items leave the queue (no double-grading)::a graded_at stamp alone (status unchanged) is enough to drop the row`
- `src/__tests__/functions/teacher-dashboard-grading-queue-action.test.ts::needs_review_reason is score-neutral (P1/P2 untouched)::auto_score is identical whether or not the too_fast flag fires`
- `src/__tests__/functions/teacher-dashboard-grading-queue-action.test.ts::needs_review_reason is score-neutral (P1/P2 untouched)::auto_score is identical whether or not the all_same_answer flag fires`
- `src/__tests__/functions/teacher-dashboard-grading-queue-action.test.ts::teacher-dashboard dispatcher — get_grading_queue wired::REGRESSION: filters the query to ungraded submitted/completed rows (no double-grading)`
- `src/__tests__/components/teacher/grading-queue.test.tsx::GradingQueue::renders one row per item with auto_score verbatim`
- `src/__tests__/components/teacher/grading-queue.test.tsx::ActionBar — Wave B flag gating::keeps the "Grading queue" button DISABLED when the flag is OFF`

### Invariants covered by this section

- P1/P2 (no-bypass) — `needs_review_reason` is derived exception metadata only;
  `auto_score` is byte-identical with vs without the flag and rendered verbatim
  (no client re-scoring), and grading flows solely through the unchanged
  `mark_submission_reviewed`. The scoring/XP path
  (`src/lib/xp-rules.ts`, `score-config.ts`, `supabase.ts`,
  `quiz/submit-side-effects.ts`) is byte-identical to origin/main. Extends
  REG-45/REG-48/REG-51/REG-92.
- P3 (anti-cheat, reuse) — the queue's exception flags reuse the SAME 3 s/question
  floor and >3-question all-same-answer rule as the canonical anti-cheat; they
  surface (never enforce/re-score) anomalies for teacher triage.
- P8 (roster boundary) — `get_grading_queue` scopes assignments to the caller
  `teacher_id`; the queue inherits the same teacher/roster scoping as
  `get_assignment_submissions`.
- No-double-grade (operational invariant) — the queue is ungraded-only at both
  the SQL filter (`.is('graded_at', null)`) and the JS re-derivation
  (`uiStatusForSubmission`), so a graded submission leaves the queue and can
  never be re-surfaced for a second grade.
- Flag-OFF byte-identity (rollout safety) — `ff_teacher_assignment_lifecycle`
  default-OFF keeps the Command Center the Wave A surface; the lazy queue chunk
  never loads (P10) until rollout.

### Notes on test strategy

REG-93 uses the repo's **frozen-reference + source-pin pattern** (mirrors
`teacher-dashboard-submissions-actions.test.ts`): the Deno/esm.sh Edge Function
cannot be imported under Vitest, so the aggregation/exception-signal logic is
re-implemented as a frozen pure reference and exercised directly, while the
dispatcher wiring and the no-double-grade SQL filter are pinned by reading the
handler source (so a refactor that widened the queue to graded rows, dropped the
`teacher_id` scope, or unwired the action fails the suite). The
submitted→graded transition test models the `mark_submission_reviewed` patch
(graded_at + status) against the SAME row to prove the dynamic no-double-grade
invariant, not just static exclusion. The frontend tests render the REAL pure
`<GradingQueue>` and the exported `<ActionBar>` (the only seams stubbed are the
client supabase helpers + the Wave B flag hook so the module loads under jsdom),
asserting on the observable contract: rows rendered, auto_score verbatim, chips +
hoist, the onOpenRow reuse callback, the bilingual labels, and the flag-OFF
disabled placeholder vs flag-ON enabled+badged button.

The honest gap left to integration is the live Edge round-trip (a real
`assignment_submissions` fetch through Supabase returning the scoped, ungraded
queue, and a real `mark_submission_reviewed` removing a row on the next fetch);
its pure shaping + SQL filter + flag-gating are unit-covered today, and it shares
the same live-fixture limitation as REG-92.

### Catalog total

Pre-Phase-3A-Wave-B: 60 entries. Phase 3A Wave B (teacher cross-assignment
grading queue, behind `ff_teacher_assignment_lifecycle`) adds REG-93 (ungraded-only
aggregation / no double-grading, `needs_review_reason` signal-only — P1/P2
untouched, flag-OFF byte-identical Command Center).

**Total: 61 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Teacher gradebook mastery + Bloom depth (Phase 3A Wave C) — REG-94

Source: Phase 3A Wave C "Gradebook + reporting depth" (behind
`ff_teacher_gradebook_depth`, layered ON TOP of `ff_teacher_command_center`;
both default OFF). Adds three READ-ONLY teacher-dashboard Edge actions
(`supabase/functions/teacher-dashboard/index.ts` —
`handleGetStudentMasteryReport`, `handleGetClassMasteryBloomSummary`,
`handleExportStudentReport`, plus the pure `aggregateBloomDistribution` /
`shapeMasterySummary` helpers and the `readStudent*` reads) and the
drill-through report panel / class-depth gradebook view / parent CSV export
(`src/app/teacher/StudentMasteryReport.tsx`,
`src/app/teacher/CommandCenter.tsx`, `src/app/teacher/grade-book/page.tsx`,
`src/lib/use-teacher-gradebook-depth.ts`, `BLOOM_LEVEL_ORDER` +
report/summary types in `src/lib/types.ts`). No migration, no new permission,
no scoring/XP math — mastery is the BKT `p_know` read VERBATIM and Bloom
accuracy is a display-only correct/total readout over the questions the student
actually answered.

The depth layer surfaces two NEW reporting dimensions over the existing
gradebook. Three things are blocking defects if they regress: (a) mastery must
stay the BKT value read verbatim (round(p_know·100)) and accuracy must stay a
pure correct/total display figure — NEITHER may ever feed or perturb the score
(P1) or the XP economy (P2), and the three Wave C handlers must remain
READ-ONLY (no `.insert`/`.update`/`.upsert`, no `atomic_quiz_profile_update`,
no XP constants); (b) the Bloom aggregation must be correct — per-level
correct/total, canonical CBSE order (remember→understand→apply→analyze→
evaluate→create), weakest-answered-level selection with the tie-break going to
the lower canonical order, never fabricating a 0% for an unattempted level —
and the per-student report must be roster-scoped (P8/P13: a non-roster student
→ 403, no report; the class summary requires class ownership); (c) with the
Wave C flag OFF the gradebook + heatmap must be byte-identical — the depth hook
resolves false, the heatmap cell stays the legacy navigate-to-student link
(no drill-through), the lazy report panel never mounts (P10), and the gradebook
is the score matrix only.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-94 | `teacher_gradebook_mastery_bloom_depth_readonly_roster_scoped_flag_off` | **(a) Mastery = BKT verbatim + accuracy display-only — P1/P2 never perturbed.** `shapeMasterySummary` surfaces `mastery_pct = Math.round(p_know·100)` per concept passed through untouched (a `p_know` of 0.999 → 100, never clamped/bonused/recomputed) with `overall_pct` the simple mean; `aggregateBloomDistribution` emits `accuracy_pct = Math.round(correct/total·100)` as a pure readout that the weakest-level tie-break can never mutate. A source-level guard pins ALL THREE Wave C handlers + their read helpers as READ-ONLY: no `.insert`/`.update`/`.upsert`/`.delete`, no `atomic_quiz_profile_update`, and none of the XP constants (`xp_earned`/`xp_total`/`quiz_per_correct`/`quiz_high_score_bonus`/`quiz_perfect_bonus`) appears in any handler body — a future refactor that tried to write back or re-derive a score inside the report path trips the guard. The frontend renders `mastery_pct`/`accuracy_pct` VERBATIM (no client re-scoring). The scoring/XP path (`src/lib/xp-rules.ts`, `score-config.ts`, `supabase.ts`, `quiz/submit-side-effects.ts`) is byte-identical to origin/main. **(b) Bloom aggregation correctness + roster scope (P8/P13).** `by_level` is per-level correct/total in canonical CBSE order (remember→understand→apply→analyze→evaluate→create), normalising casing/whitespace and SKIPPING null/empty bloom rows; unattempted levels are NOT fabricated as 0% in the Edge response (the panel projects the full 6-level ladder, rendering unanswered levels as a muted "—"); `weakest_level` is the lowest-accuracy answered level with ties broken toward the lower canonical order (remember beats apply at equal 0%). Bloom is sourced from `quiz_responses.bloom_level` (`select('bloom_level, is_correct')`) and mastery from `bkt_mastery_state` (`select('topic_id, p_know, attempts')`) — both source reads pinned. `handleGetStudentMasteryReport` re-resolves the caller roster via `resolveStudentsForTeacher` and 403s `Student not owned by caller` for an off-roster student; `export_student_report` reuses that pipeline and inherits the same 403 (`if (!inner.ok) return inner`); the class summary requires `assertTeacherOwnsClass`. Grade is a string end-to-end (P5). **(c) Flag-OFF byte-identical.** `ff_teacher_gradebook_depth` defaults OFF and is unseeded ⇒ `useTeacherGradebookDepth()` resolves false on the synchronous first paint and stays false; the Command Center heatmap cell stays the legacy navigate-to-student link (drill-through branch off), the lazy `StudentMasteryReport` chunk never mounts (P10), and the gradebook is the score matrix only. With the flag ON the cell drills through to the report panel. Bloom's level NAMES render untranslated even when `isHi` (P7 exception). | `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts` (34 tests: per-level correct/total + canonical order + weakest selection + tie-break + no-fabrication + casing/whitespace normalisation + empty degrade; `shapeMasterySummary` p_know-verbatim incl. 0.999→100; full report shape + P5 grade-string; class rollup weakest-first + pooled Bloom; parent CSV sectioning + escape + P7 untranslated; dispatcher `case` + handler presence; `quiz_responses`/`bkt_mastery_state` source pins; `resolveStudentsForTeacher` + `Student not owned by caller` 403; export reuses pipeline + inherits 403; READ-ONLY guard over all 3 handlers + 5 helpers — no write/XP token) + `src/__tests__/teacher/student-mastery-report.test.tsx` (7 tests: mastery-by-concept verbatim percents; ALL 6 canonical Bloom levels in order, unattempted → muted "—", weakest badge on exactly one row; untranslated names when isHi; export callback; loading/error states; `useTeacherGradebookDepth` default-OFF sync + stays-OFF-when-false + flips-ON-when-true) | U |

### Pinned tests

- `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts::shapeMasterySummary — BKT mastery surfaced verbatim::REGRESSION: does NOT re-derive mastery — p_know passes through untouched (no scoring math)`
- `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts::aggregateBloomDistribution — per-level correct/total::REGRESSION: accuracy_pct is display-only — same correct/total never changes regardless of weakest selection`
- `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts::teacher-dashboard dispatcher — Phase 3A Wave C actions present::REGRESSION: all 3 Wave C handlers are READ-ONLY — no write/XP/score perturbation (P1/P2/P4)`
- `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts::aggregateBloomDistribution — per-level correct/total::emits by_level in canonical CBSE Bloom order (remember→create)`
- `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts::aggregateBloomDistribution — per-level correct/total::breaks weakest_level ties toward the lower canonical Bloom order`
- `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts::get_student_mastery_report — roster scoping (P13)::REGRESSION: rejects a non-roster student (cross-tenant 403)`
- `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts::teacher-dashboard dispatcher — Phase 3A Wave C actions present::REGRESSION: the per-student report is roster-scoped via resolveStudentsForTeacher (P13)`
- `src/__tests__/teacher/student-mastery-report.test.tsx::useTeacherGradebookDepth — default OFF (byte-identical heatmap)::initialises OFF (sync) and stays OFF when the flag is absent`

### Invariants covered by this section

- P1/P2 (no-bypass) — mastery is the BKT `p_know` read verbatim and Bloom
  accuracy is a pure correct/total display figure; a source-level guard pins all
  three Wave C handlers + read helpers as READ-ONLY (no DB write, no XP
  constants, no `atomic_quiz_profile_update`), and the frontend renders both
  verbatim with no client re-scoring. The scoring/XP path (`src/lib/xp-rules.ts`,
  `score-config.ts`, `supabase.ts`, `quiz/submit-side-effects.ts`) is
  byte-identical to origin/main. Extends REG-45/REG-48/REG-51/REG-93.
- P8/P13 (roster boundary + data privacy) — `get_student_mastery_report`
  re-resolves the caller roster and 403s an off-roster student;
  `export_student_report` inherits that gate; `get_class_mastery_bloom_summary`
  requires class ownership. A teacher sees only their own roster student's
  mastery/Bloom data.
- P5 (grade format) — the report payload coerces grade to a string end-to-end.
- P7 (bilingual UI exception) — Bloom's level names are technical terms rendered
  untranslated even when `isHi`.
- Bloom-aggregation correctness (pedagogy invariant) — per-level correct/total in
  canonical CBSE order, weakest-answered-level with lower-canonical tie-break, no
  fabricated 0% for unattempted levels.
- Flag-OFF byte-identity (rollout safety) — `ff_teacher_gradebook_depth`
  default-OFF keeps the heatmap the legacy navigate surface and the gradebook the
  score matrix only; the lazy report chunk never loads (P10) until rollout.

### Notes on test strategy

REG-94 uses the repo's **frozen-reference + source-pin pattern** (mirrors
REG-93 / `teacher-dashboard-grading-queue-action.test.ts`): the Deno/esm.sh Edge
Function cannot be imported under Vitest, so the Bloom aggregation, mastery
shaping, roster gate, class rollup and parent-CSV logic are re-implemented as
frozen pure references and exercised directly, while the dispatcher wiring, the
`quiz_responses`/`bkt_mastery_state` source reads, the `resolveStudentsForTeacher`
403 gate, and a new READ-ONLY guard (no write/XP token inside any Wave C handler
or helper body) are pinned by reading the handler source — so a refactor that
swapped the Bloom source, dropped the roster scope, unwired an action, or tried
to write back / re-score inside the report path fails the suite. The frontend
tests render the REAL pure `<StudentMasteryReport>` and exercise the REAL
`useTeacherGradebookDepth` hook (the only seam stubbed is `getFeatureFlags` so
the hook loads under jsdom), asserting the observable contract: mastery percents
verbatim, the full canonical 6-level Bloom ladder with unattempted → "—" and
exactly one weakest badge, untranslated level names under isHi, the export
callback, and the default-OFF synchronous first paint.

The honest gap left to integration is the live Edge round-trip (a real
`bkt_mastery_state` + `quiz_responses` fetch through Supabase returning the
scoped report, and a real off-roster 403); its pure shaping + source pins +
flag-gating are unit-covered today, sharing the same live-fixture limitation as
REG-92/REG-93.

### Catalog total

Pre-Phase-3A-Wave-C: 61 entries. Phase 3A Wave C (teacher gradebook mastery +
Bloom depth, behind `ff_teacher_gradebook_depth`) adds REG-94 (mastery = BKT
verbatim + accuracy display-only — P1/P2 never perturbed via a READ-ONLY handler
guard; Bloom aggregation correctness + roster scope P8/P13; flag-OFF
byte-identical gradebook + heatmap).

**Total: 62 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Teacher → parent one-tap notify (Phase 3A Wave D) — REG-95

Source: Phase 3A Wave D "Parent comms / Tell the parent" (behind
`ff_teacher_parent_comms`, layered ON TOP of `ff_teacher_command_center`; both
default OFF). Adds one Next.js API route (`POST /api/teacher/parent-notify`,
`src/app/api/teacher/parent-notify/route.ts`) and two Command Center entry
points: a one-tap "Tell the parent 🎉" button on a RESOLVED at-risk alert and a
"Share with parent" button inside the Wave C Student Mastery Report panel
(`src/app/teacher/CommandCenter.tsx`,
`src/app/teacher/StudentMasteryReport.tsx`, `src/lib/use-teacher-parent-comms.ts`,
`TEACHER_PARENT_COMMS_FLAGS` in `src/lib/feature-flags.ts`). The route REUSES the
existing teacher↔parent messaging infra (`teacher_parent_threads` +
`teacher_parent_messages`) and the existing `class.manage` permission — NO new
migration, NO new table/column, NO new permission, NO scoring/XP. The
`include_report` "attachment" is an inline progress-summary line (overall BKT
mastery + recent quiz avg, both read verbatim), never a file — migration-free by
construction.

Three things are blocking defects if they regress: (a) **roster boundary (P8) +
no-guardian safety** — a teacher may notify ONLY the parent of a student on their
own roster (`class_teachers × class_students`); a non-roster student (or a caller
with no `teachers` row) → 403 with NO thread and NO message written; a roster
student with no approved/active `guardian_student_links` row → a clean 409
`{ no_guardian: true }` (informational, NOT an error) with NO message sent; (b)
**RBAC reuse (P9) + insert contract** — the route gates on the EXISTING
`class.manage` permission (no new permission code) and writes through the
existing find-or-create-thread + message-insert path with `sender_role='teacher'`
pinned, reusing rather than duplicating the messaging schema; (c) **no scoring/XP
(P1/P2) + flag-OFF byte-identity** — the route never touches the score formula,
XP constants, or `atomic_quiz_profile_update`, and the `include_report` summary
reads BKT `p_know`/`quiz_sessions.score_percent` verbatim (display-only, no
re-derivation); with `ff_teacher_parent_comms` OFF NO "Tell the parent" /
"Share with parent" affordance renders anywhere and NO parent-notify fetch is
ever issued — the Command Center and report panel stay byte-identical to
Waves A–C.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-95 | `teacher_parent_notify_roster_boundary_no_guardian_class_manage_sender_teacher_flag_off` | **(a) Roster boundary (P8) + no-guardian safety.** A student NOT on the caller-teacher roster → 403 with `threads` and `messages` both empty (no write); a caller with no `teachers` row → 403; a roster student with no linked guardian → 409 `{ no_guardian: true }` with `threads`/`messages` empty (NOT an error, no message sent). **(b) RBAC reuse (P9) + insert contract.** The route calls `authorizeRequest(_, 'class.manage')` (asserted verbatim — the SAME existing permission, NOT a new code) and a 401/403 from the gate propagates with no write; the happy path find-or-creates the `(teacher, guardian, student)` thread, REUSES an existing thread instead of duplicating it, and appends a message with `sender_role === 'teacher'`; the custom `message` is used verbatim (trimmed) and an empty/whitespace custom message → 400. **(c) No scoring/XP (P1/P2) + flag-OFF byte-identity.** `include_report:true` appends an inline progress-summary line (mastery mean `round((80+60)/2)=70%`, recent avg `round((80+90)/2)=85%`) read verbatim from BKT/`quiz_sessions` — no score formula, no XP constant, no `atomic_quiz_profile_update` in the route; the scoring/XP path (`src/lib/xp-rules.ts`, `score-config.ts`, `supabase.ts`, `quiz/submit-side-effects.ts`) is byte-identical to origin/main. Frontend (real `<CommandCenter>` + real `useTeacherParentComms`, only `getFeatureFlags` stubbed): flag ON + a RESOLVED alert renders `tell-parent-btn`, click POSTs `{ student_id, context:'remediation_resolved', include_report:true }`, 200 → `role=status` "Parent notified ✓" + collapse to `parent-notified-chip` (idempotent-safe: button gone, second tap can't re-fire); a 409 `no_guardian` renders the informational "No parent linked" toast (no error toast, button stays available); flag OFF → the resolved alert still renders but NO `tell-parent-btn` and NO `/api/teacher/parent-notify` fetch is ever issued (byte-identical to Wave A–C). | `src/__tests__/api/teacher/parent-notify/route.test.ts` (15 tests: auth gate 401/403 + `class.manage` verbatim + NOT-a-new-permission; 400 missing student_id / unknown context / empty custom message; roster 403 no-write + no-teacher-row 403; no-guardian 409 `{ no_guardian:true }` no-write; templated happy path thread-create + `sender_role='teacher'` + names student/concept; existing-thread reuse no-duplicate; generic-template fallback; custom-message verbatim-trimmed; include_report inline summary 70%/85% + omitted-when-false) + `src/__tests__/teacher/parent-comms.test.tsx` (3 tests: flag-ON resolved-alert button + exact POST body + 200 "Parent notified ✓" + chip collapse + idempotent; flag-ON 409 informational "No parent linked" not-an-error button-stays; flag-OFF no button + no fetch) | U |

### Pinned tests

- `src/__tests__/api/teacher/parent-notify/route.test.ts::POST /api/teacher/parent-notify — roster boundary::403 when the student is not on the caller-teacher roster (no write)`
- `src/__tests__/api/teacher/parent-notify/route.test.ts::POST /api/teacher/parent-notify — no linked guardian::returns 409 { no_guardian: true } and sends NO message (not an error)`
- `src/__tests__/api/teacher/parent-notify/route.test.ts::POST /api/teacher/parent-notify — auth::checks the class.manage permission (NOT a new permission)`
- `src/__tests__/api/teacher/parent-notify/route.test.ts::POST /api/teacher/parent-notify — templated happy path::creates the thread + appends a templated remediation_resolved message (sender_role=teacher)`
- `src/__tests__/api/teacher/parent-notify/route.test.ts::POST /api/teacher/parent-notify — templated happy path::reuses an existing (teacher,guardian,student) thread instead of creating a duplicate`
- `src/__tests__/api/teacher/parent-notify/route.test.ts::POST /api/teacher/parent-notify — include_report::appends an inline progress summary line (mastery / recent avg) to the message body`
- `src/__tests__/teacher/parent-comms.test.tsx::CommandCenter — Tell the parent (Wave D)::flag OFF: no "Tell the parent" button is rendered on a resolved alert and no parent-notify fetch is issued`

### Invariants covered by this section

- P8 (roster boundary) — the route re-resolves the caller roster via
  `class_teachers × class_students` and 403s a non-roster student with no write;
  no-guardian degrades to a clean 409 (no message). Extends REG-92/REG-93/REG-94.
- P9 (RBAC reuse) — gates on the EXISTING `class.manage` permission (no new
  permission code) and reuses the existing thread/message insert path with
  `sender_role='teacher'`.
- P1/P2 (no-bypass) — the notify route never touches the score formula, XP
  constants, or `atomic_quiz_profile_update`; the `include_report` summary reads
  BKT `p_know` / `quiz_sessions.score_percent` verbatim (display-only). The
  scoring/XP path is byte-identical to origin/main.
- Migration-free attachment — `include_report` is an inline text progress summary
  (+ a deep-link reference in the notification payload), never a file; no schema
  change.
- Flag-OFF byte-identity (rollout safety) — `ff_teacher_parent_comms` default-OFF
  keeps the Command Center and the report panel byte-identical to Waves A–C; no
  affordance renders and no parent-notify fetch is issued until rollout.

### Notes on test strategy

REG-95 exercises the REAL Next.js route (imported under Vitest after mocking
`@/lib/rbac`, `@/lib/logger`, and `@/lib/supabase-admin`) against a tiny
in-memory store that mirrors only the columns the route touches — the same
approach as the existing `teacher-parent-messaging.test.ts`. The frontend tests
render the REAL `<CommandCenter>` and exercise the REAL `useTeacherParentComms`
hook (the only seam stubbed is `getFeatureFlags` so the flag hook loads under
jsdom; `global.fetch` is stubbed to branch the teacher-dashboard Edge fixtures
vs. the `/api/teacher/parent-notify` POST), asserting the observable contract:
the exact POST body, the 200/409/flag-OFF outcomes, the idempotent chip collapse,
and the no-fetch-when-OFF guarantee. The honest gap left to integration is the
live DB round-trip (a real `guardian_student_links` resolve + a real
find-or-create against `teacher_parent_threads`/`teacher_parent_messages` and a
real off-roster 403), sharing the live-fixture limitation of REG-92/REG-93/REG-94.

### Catalog total

Pre-Phase-3A-Wave-D: 62 entries. Phase 3A Wave D (teacher → parent one-tap
notify, behind `ff_teacher_parent_comms`) adds REG-95 (roster boundary P8 +
no-guardian 409; `class.manage` reuse P9 + `sender_role='teacher'` insert; no
scoring/XP P1/P2 with migration-free inline-summary attachment; flag-OFF
byte-identical Command Center).

**Total: 63 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## School Command Center read-model rollup (Phase 3B Wave A) — REG-96

Source: Phase 3B Wave A "School Command Center" (read-only principal/admin
overview, behind `ff_school_command_center`; default OFF). Adds ONE migration
(`supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql`)
with three SECURITY DEFINER read-model RPCs (`get_school_overview`,
`get_classes_at_risk`, `get_teacher_engagement`) + covering indexes, three thin
GET routes (`src/app/api/school-admin/{overview,classes-at-risk,teacher-engagement}/route.ts`)
that gate on the EXISTING `institution.view_analytics` permission and call the
RPCs through a USER-CONTEXT client, a server-side school-resolution guard
(`src/lib/school-admin/command-center-context.ts`), shared types
(`src/lib/school-admin/command-center-types.ts`), the flag hook
(`src/lib/use-school-command-center.ts` + `SCHOOL_COMMAND_CENTER_FLAGS`), and the
read-only UI (`src/app/school-admin/CommandCenter.tsx` + the two command-center
panels). NO new table, NO new RBAC permission, NO scoring/XP — 100% read-only.
Mastery is read verbatim from `concept_mastery.p_know` (assessment owns the value;
the read models never recompute it).

Three things are blocking defects if they regress: (a) **rollup correctness +
the 0.4 at-risk boundary** — `get_classes_at_risk` counts a student as at-risk
ONLY when their avg `p_know < 0.4` (a student at exactly 0.40 is NOT at-risk —
the boundary excludes equality), orders most-at-risk first, and clamps `p_limit`
to 1..100; `get_school_overview` flips `data_state` to `'no_data'` for an empty
school and `'live'` otherwise, and returns NULL `avg_mastery` /
`seat_utilization_pct` rather than a fake `0` when there is no mastery / seat
signal; (b) **cross-school 403 scope guard (P8/P9 cross-tenant safety)** — each
SECURITY DEFINER RPC RAISES 42501 unless `auth.uid()` is an ACTIVE
`school_admins` member of exactly `p_school_id`, so a non-admin AND a wrong-school
admin both get the permission error (mapped to HTTP 403 by the route); the
route-layer resolver is defence-in-depth in front of it (no membership → 403;
multi-school + no `?school_id` → 400 with `{ school_ids }`; a `?school_id` outside
the caller's memberships → 403; the P9 `authorizeRequest` 401/403 propagates
unchanged) and never leaks SQL/PII on a generic RPC failure (→ 500); (c)
**flag-OFF byte-identical** — `ff_school_command_center` defaults OFF and is
unseeded ⇒ `useSchoolCommandCenter()` resolves false on the synchronous first
paint and stays false (no first-paint flash), so both the `/school-admin` page
and the consolidated nav stay byte-identical to the legacy stat-tile surface
until rollout.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-96 | `school_command_center_rollup_at_risk_boundary_cross_school_403_flag_off` | **(a) Rollup correctness + 0.4 boundary.** Live-DB: `get_classes_at_risk` over a seeded 4-student class with `p_know` of {0.39, 0.40, 0.10, 0.80} returns `at_risk_count = 2` — the 0.40 boundary student is EXCLUDED (strict `< 0.4`); the all-above class returns `at_risk_count = 0`; ordering is most-at-risk-first; `get_school_overview.data_state` is `'no_data'` for an empty school and `'live'` for one with a roster; `avg_mastery` and `seat_utilization_pct` are NULL (never fake `0`) for a roster with no `concept_mastery` / no seat snapshot; `get_teacher_engagement` counts distinct active class assignments per teacher (TA1=2, TA2=0) ordered assigned-DESC. **(b) Cross-school 403 scope guard.** Live-DB: an authenticated NON-admin AND a WRONG-SCHOOL admin (admin of B querying A) both get Postgres `42501` from all three SECURITY DEFINER RPCs; an ACTIVE admin of the school succeeds. Unit: the route maps RPC `42501` → HTTP 403 and a generic RPC error → HTTP 500 with no SQL/PII leak; `resolveCommandCenterContext` gates on `institution.view_analytics` (P9, no new permission), returns the `authorizeRequest` 401/403 UNCHANGED, 403s a caller with no active membership, 400s a multi-school caller with `{ school_ids }`, 403s a `?school_id` outside the caller's memberships, resolves a single membership without a param, and de-dupes repeated rows; `parsePagination` clamps limit to 1..100 (500→100, 0/neg→default-or-1) and offset to ≥0 (non-numeric→default). **(c) Flag-OFF byte-identical.** `useSchoolCommandCenter()` initial SYNCHRONOUS value is `false` (DEFAULT_OFF) before any async resolution, stays false when the flag is absent / explicitly false / on a `getFeatureFlags` rejection, flips ON only after the async confirm when the flag resolves true, and requests flags scoped to `role: 'school_admin'`. | `src/__tests__/migrations/school-command-center-read-models.test.ts` (14 live-DB tests: scope guard 42501 for non-admin + wrong-school across all 3 RPCs + active-admin success; 0.4 at-risk boundary incl. the 0.40-excluded student + most-at-risk-first ordering; pagination clamp 500→≤100 / 0→≥1 / negative→≥1; `data_state` no_data↔live; null `avg_mastery` + null `seat_utilization_pct`; teacher class_count rollup) + `src/__tests__/api/school-admin/command-center-routes.test.ts` (41 unit tests: per-route 401/403/400 passthrough no-RPC-call, 42501→403, generic→500 no-leak, correct-RPC-with-school-id, cache header; overview live/no_data/null-result snapshot + no-pagination-params; list empty/null→200 empty array + count=rows.length + limit/offset clamp echo + RPC param pin) + `src/__tests__/lib/school-admin/command-center-context.test.ts` (24 unit tests: P9 gate passthrough + `institution.view_analytics`; no-membership 403; single resolve; multi-school 400 `{ school_ids }`; cross-school `?school_id` 403; matched `?school_id` resolve; row de-dupe; lookup-error 500 no-leak; `parsePagination` clamp matrix; `rpcErrorResponse` 42501→403 / generic→500-no-leak; constants) + `src/__tests__/school-admin/command-center-flag-gate.test.tsx` (5 tests: sync DEFAULT_OFF + stays-OFF-absent / stays-OFF-false / flips-ON-true / stays-OFF-on-reject / role-scoped fetch) | E |

### Pinned tests

- `src/__tests__/migrations/school-command-center-read-models.test.ts::scope guard (cross-tenant safety — RAISE 42501)::rejects a WRONG-SCHOOL admin (admin of B querying A)`
- `src/__tests__/migrations/school-command-center-read-models.test.ts::at-risk boundary (p_know < 0.4 is at-risk; exactly 0.4 is NOT)::counts students strictly below 0.4 — the 0.40 student is excluded`
- `src/__tests__/migrations/school-command-center-read-models.test.ts::data_state hint::flips to 'no_data' for an empty school (no classes/roster/mastery)`
- `src/__tests__/migrations/school-command-center-read-models.test.ts::null numerics when there is no signal::avg_mastery is null for a roster with no concept_mastery rows`
- `src/__tests__/api/school-admin/command-center-routes.test.ts::GET /api/school-admin/classes-at-risk — resolution + error mapping::maps a Postgres 42501 RPC error to HTTP 403 (scope guard)`
- `src/__tests__/lib/school-admin/command-center-context.test.ts::resolveCommandCenterContext — membership resolution::403 when ?school_id is NOT one of the caller active memberships (cross-school)`
- `src/__tests__/school-admin/command-center-flag-gate.test.tsx::useSchoolCommandCenter — default OFF (no first-paint flash)::initialises OFF synchronously and stays OFF when the flag is absent`

### Invariants covered by this section

- P8/P9 (cross-tenant scope) — the SECURITY DEFINER RPCs RAISE 42501 unless
  `auth.uid()` is an active `school_admins` member of `p_school_id`; the routes
  gate on the EXISTING `institution.view_analytics` permission (no new code) and
  resolve the school server-side, never trusting a client-supplied id.
- P5 (grade format) — `get_classes_at_risk` returns `grade` as a text column;
  the shared type is `string | null`.
- P13 (data privacy) — neither the route nor the resolver leaks SQL/policy text
  on an RPC or membership-lookup error (generic 500 message; raw error logged
  server-side via the redacting logger only).
- No scoring/XP (read-only) — mastery is read verbatim from
  `concept_mastery.p_know`; the read models never recompute a score and contain
  no XP constant.
- Flag-OFF byte-identity (rollout safety) — `ff_school_command_center` default-OFF
  keeps both school-admin surfaces byte-identical to the legacy stat-tile
  dashboard until rollout, with a deterministic synchronous OFF first paint.

### Notes on test strategy

REG-96 uses the repo's **live-DB-integration + route-unit + flag-hook pattern**.
The live-DB RPC tests live under `src/__tests__/migrations/**` (gated by
`hasSupabaseIntegrationEnv()` → `describe.skip` under placeholder env, and by the
`RUN_INTEGRATION_TESTS=1` include split in `vitest.config.ts`), matching the
existing migration integration suite (`cbse-syllabus.test.ts:5`,
`question-bank-verification.test.ts:5`, `state-runtime/bkt-sql-parity.test.ts:43`
`await sb.rpc(...)`). They add the user-context-JWT seam those tests did not need:
because the read models are SECURITY DEFINER and guard on `auth.uid()`, each admin
fixture is a REAL auth user (`supabaseAdmin.auth.admin.createUser` →
`signInWithPassword` → anon client bearing the JWT), so the in-RPC scope guard is
exercised for real rather than bypassed by the service-role client. These run only
in the "Integration Tests (live DB)" CI job (currently billing-blocked; will run
when CI billing is restored). The route + resolver + flag-hook tests run under the
normal Vitest unit job with no DB: the route tests mock ONLY
`resolveCommandCenterContext` (keeping `parsePagination` / `rpcErrorResponse` /
the cache constant REAL via `importActual`) so the real clamp + 42501→403 mapping
run; the resolver test mocks `authorizeRequest` + `@supabase/ssr` + the logger and
drives the real function; the flag-hook test mocks only `getFeatureFlags` and
asserts the synchronous DEFAULT_OFF paint (mirrors the Phase 3A
`teacher/command-center-flag-gate.test.tsx`).

### Catalog total

Pre-Phase-3B-Wave-A: 63 entries. Phase 3B Wave A (read-only School Command Center,
behind `ff_school_command_center`) adds REG-96 (rollup correctness + 0.4 at-risk
boundary; cross-school 403 scope guard P8/P9; flag-OFF byte-identical with a
deterministic synchronous-OFF first paint).

**Total: 64 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Seat-aware provisioning enforcement — hybrid seat policy (Phase 3B Wave B) — REG-97

Source: Phase 3B Wave B "Seat-aware provisioning ENFORCEMENT" (PAYMENT-ADJACENT,
P11 — every active student on a school roster is a billable seat), behind
`ff_school_provisioning`; default OFF. Adds ONE migration
(`supabase/migrations/20260614000001_phase3b_seat_enforcement.sql`) with the
race-safe SQL primitives — `evaluate_seat_policy` (READ-ONLY jsonb verdict,
SECURITY DEFINER + active-school_admin scope guard, EXECUTE to `authenticated`),
the two ATOMIC advisory-locked enroll guards `enroll_students_with_seat_check`
(class_students) and `enroll_section_students_with_seat_check` (class_enrollments,
SAME `'school_seat:'||school_id` lock namespace), `refresh_school_seat_usage`
(snapshot UPSERT + grace-clock state machine), and the unified-count helpers
`_school_active_student_ids` / `_count_active_school_students` (the Wave A
`get_school_overview` / `get_classes_at_risk` were `CREATE OR REPLACE`'d to derive
"active students" from the same unified set so the read models and the enforcement
count cannot drift) — plus the app layer (`src/lib/school-admin/seat-enforcement.ts`),
the three wired routes (`src/app/api/school-admin/students/route.ts`,
`src/app/api/schools/enroll/route.ts`, `src/app/api/school-admin/invite-codes/route.ts`),
the flag (`SCHOOL_PROVISIONING_FLAGS.V1`), and the UI flag hook
(`src/lib/use-school-provisioning.ts`).

Four things are blocking defects if they regress: (a) **the CEO-approved HYBRID
SEAT POLICY** — `S = active school_subscriptions.seats_purchased`,
`grace_ceiling = floor(S*1.10)`, a 14-day grace window from the first overage;
the 4 statuses are `within_plan` (N≤S → ALLOW), `grace_warn` (S<N≤ceiling, window
OPEN → SOFT ALLOW), `grace_expired` (S<N≤ceiling, window ELAPSED → BLOCK), and
`over_ceiling` (N>ceiling → BLOCK always); the grace clock is SET on first overage
and RESET to null when active returns to ≤S; students are NEVER auto-deactivated;
(b) **the unified both-table count** — "active students" is the DISTINCT UNION of
`class_students` + `class_enrollments` (active rows, active non-deleted classes of
the school, active students), so a student in BOTH counts ONCE and a roster
written by `/api/schools/enroll` (class_enrollments) is no longer invisible to the
cap; (c) **dual atomic race-safe enroll paths** — both guards re-evaluate the
policy UNDER a per-school advisory lock against the LIVE count and, on a hard
block, RAISE SQLSTATE `P3B01` (verdict jsonb in DETAIL) WITHOUT inserting anything
(all-or-nothing), and the shared lock namespace serialises concurrent imports so
two batches can never both pass the check at the same count; (d) **flag-OFF
byte-identical** — `ff_school_provisioning` defaults OFF and is unseeded ⇒ none of
the enforcement helpers run and every route returns its legacy response
shape/status unchanged, while `useSchoolProvisioning()` resolves false on the
synchronous first paint (no first-paint flash). P13: the grace_warn flag carries
metadata only (school id + seat counts + timestamps), never email/phone/name; the
P3B01 path never leaks SQL to the client (generic 503; raw error logged
server-side via the redacting logger only).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-97 | `seat_provisioning_hybrid_policy_unified_count_atomic_race_flag_off` | **(a) Hybrid policy state machine.** Live-DB (S=10, ceiling=11): `evaluate_seat_policy` returns `within_plan` (add 10 → projected 10), `grace_warn` (add 11 → projected 11, SOFT ALLOW), `over_ceiling` (add 12, BLOCK) and never mutates the grace clock; the atomic guard SETS the clock on the 11th add (grace_warn) and, with the clock back-dated >14d, BLOCKS an in-ceiling add as `grace_expired` (while in-window it was allowed); deactivating back to ≤S + `refresh_school_seat_usage` RESETS the clock to null. **(b) Unified both-table count.** Live-DB: seed one student via `class_students`, one via `class_enrollments`, one in BOTH → `_count_active_school_students` = 3 (DISTINCT UNION; the both-table student counts once) and equals `get_school_overview.student_count`. **(c) Dual atomic race-safe enroll.** Live-DB: `enroll_students_with_seat_check` (class_students) AND `enroll_section_students_with_seat_check` (class_enrollments) both RAISE `P3B01` with the verdict in DETAIL and insert NOTHING when over ceiling, and succeed within plan; `refresh_school_seat_usage` is idempotent (twice → same snapshot, one row per (school, day)); two concurrent enrolls (one per path, 7+7 vs ceiling 11) → exactly one wins, exactly one is `P3B01`, total never exceeds the ceiling (advisory lock serialises). Unit (`seat-enforcement.ts`, no DB): P3B01 detection + verdict parse from DETAIL with a status-only message fallback; `seatCapViolationResponse` is 409 with status/projected/grace_ceiling/seats_purchased and `grace_expires_at` ONLY on `grace_expired`; `remainingCapacity` = max(ceiling − active, 0); `flagGraceWarn` inserts ONE de-duped school row + one super-admin row per ACTIVE `admin_users(super_admin)` `auth_user_id` (fan-out N→N+1; capture the actual `notifications` insert payloads), where EVERY inserted row carries a non-empty string `message` (`notifications.message` text NOT NULL — bug-1 insert-shape guard) and a valid-uuid `recipient_id` (`notifications.recipient_id` uuid NOT NULL — the school row uses the school uuid, each super-admin row uses a resolved `admin_users.auth_user_id` uuid, and NO row carries the old `recipient_id === 'super_admin'` string — bug-2 insert-shape guard), the payload `data` carries ids/counts/grace_expires_at only (no PII — P13), and it never throws on failure (insert error / admin_users-lookup error → school row still persists, super-admin fan-out skipped); a negative case proves the message+uuid guards FAIL against the old buggy shape (omitted `message` / `'super_admin'` recipient_id) — real regression guard, not a tautology. Route unit (mocked): students route single 409-on-block / grace_warn soft-allow + `warning` field + `flagGraceWarn` called / within_plan 201 / RPC-error 503; bulk capacity-split (created up to remaining, overflow `seat_limit_reached`); deactivation → `refreshSeatUsage`; `/api/schools/enroll` capacity-trim BEFORE student create (no orphans) + atomic section commit + P3B01→409 + preview-fail 503; invite-codes `max_uses_capped_to_seats` + `remaining_seats` / 409 when exhausted / 503 unavailable / teacher codes NOT seat-bounded. **(d) Flag-OFF byte-identical.** With `ff_school_provisioning` OFF every route returns its LEGACY status/shape (students single 201 + legacy 409 `code:'seat_cap_violation'`; deactivate 200; `/api/schools/enroll` legacy 403; invite raw row, no cap fields) and NONE of the enforcement helpers run; `useSchoolProvisioning()` is synchronously `false` (DEFAULT_OFF), stays false absent / explicitly-false / on `getFeatureFlags` rejection, flips ON only after the async confirm when the flag resolves true, and fetches scoped to `role: 'school_admin'`. | `src/__tests__/migrations/seat-enforcement.test.ts` (live-DB: 4-status evaluate + read-only no-mutation; cross-school 42501 on `evaluate_seat_policy`; unified DISTINCT-union count + read-model parity; class_students + class_enrollments P3B01-nothing-inserted + within-plan success; grace_warn clock SET; grace_expired via back-dated clock; grace RESET after deactivate+refresh; refresh idempotency one-row-per-day; concurrent-enroll race exactly-one-wins) + `src/__tests__/lib/school-admin/seat-enforcement.test.ts` (23 unit tests: flag gate; P3B01 parse + message fallback; non-P3B01→error no-throw; allowed verdict; empty-payload guard; both RPC names; `seatCapViolationResponse` 409 shape + grace_expires_at conditionality; `remainingCapacity` clamp + null; `flagGraceWarn` de-dupe + no-PII + never-throws + INSERT-SHAPE GUARDS: every row has a non-empty `message` (NOT NULL bug-1), every `recipient_id` is a valid uuid — school uuid + per-super-admin `admin_users.auth_user_id`, never `'super_admin'` (uuid NOT NULL bug-2) — fan-out N→N+1, zero/error super-admin lookup still persists the school row, plus a negative case that FAILS on the old buggy shape) + `src/__tests__/api/school-admin/seat-enforcement-routes.test.ts` (15 unit tests: students single block/grace/within/503 + deactivate refresh + bulk split/503; enroll trim-before-create/P3B01→409/503; invite cap/409/503/teacher-not-bounded) + `src/__tests__/api/school-admin/seat-enforcement-flag-off.test.ts` (6 unit tests: legacy 201/409/200/403/201 shapes + no-enforcement-helper-called across all three routes) + `src/__tests__/school-admin/provisioning-flag-gate.test.tsx` (5 tests: sync DEFAULT_OFF + stays-OFF-absent / stays-OFF-false / flips-ON-true / stays-OFF-on-reject / role-scoped fetch) | E |

### Pinned tests

- `src/__tests__/migrations/seat-enforcement.test.ts::enroll_students_with_seat_check (class_students path)::over_ceiling (12th, N=12 > ceiling 11) RAISES P3B01 and inserts NOTHING`
- `src/__tests__/migrations/seat-enforcement.test.ts::enroll_students_with_seat_check (class_students path)::grace_expired: back-date the grace clock > 14d ⇒ the 11th-equivalent add is BLOCKED`
- `src/__tests__/migrations/seat-enforcement.test.ts::unified active count (class_students UNION class_enrollments)::counts the DISTINCT union; a student in BOTH roster tables counts once`
- `src/__tests__/migrations/seat-enforcement.test.ts::grace clock reset + refresh idempotency::SETS the clock on overage then RESETS to null when active <= S after refresh`
- `src/__tests__/migrations/seat-enforcement.test.ts::race-safety (advisory lock serialises concurrent enrolls)::two concurrent enrolls that would jointly exceed the ceiling never both succeed`
- `src/__tests__/lib/school-admin/seat-enforcement.test.ts::seatCapViolationResponse — 409 body shape::INCLUDES grace_expires_at only when the verdict carries it (grace_expired)`
- `src/__tests__/lib/school-admin/seat-enforcement.test.ts::flagGraceWarn — de-duped, no-PII, never-throws, NOT-NULL+uuid insert shape::inserts the school row (school uuid) + one row per super-admin (admin_users uuids) — fan-out N→N+1` (insert-shape regression guard: every row has a non-empty `message` (bug 1) + a valid-uuid `recipient_id`, never `'super_admin'` (bug 2))
- `src/__tests__/lib/school-admin/seat-enforcement.test.ts::flagGraceWarn — de-duped, no-PII, never-throws, NOT-NULL+uuid insert shape::FAILS against the OLD buggy insert shape (omitted message / recipient_id "super_admin")` (proves the guards are real, not tautologies)
- `src/__tests__/api/school-admin/seat-enforcement-routes.test.ts::POST /api/schools/enroll (enforcement ON)::trims overflow BEFORE creating students (no orphans) — overflow reported as seat_limit_reached`
- `src/__tests__/api/school-admin/seat-enforcement-flag-off.test.ts::FLAG OFF — POST /api/schools/enroll (legacy path)::legacy over-cap returns 403 (legacy status) and never calls enforcement helpers`
- `src/__tests__/school-admin/provisioning-flag-gate.test.tsx::useSchoolProvisioning — default OFF (no first-paint flash)::initialises OFF synchronously and stays OFF when the flag is absent`

### Invariants covered by this section

- P11 (payment integrity, ADJACENT) — seats are monetisable; the enrollment
  guards mirror the P11 locking discipline (per-school `pg_advisory_xact_lock`
  taken BEFORE the policy is re-evaluated and BEFORE any insert) so concurrent
  imports serialise and can never double-allocate seats; the block path is
  all-or-nothing (P3B01 rolls the txn back, nothing inserted) and never grants a
  seat past the grace ceiling.
- P8/P9 (cross-tenant scope) — `evaluate_seat_policy` is SECURITY DEFINER and
  RAISES 42501 unless `auth.uid()` is an active `school_admins` member of
  `p_school_id`; the mutating RPCs are service_role-only and run behind
  `authorizeSchoolAdmin` (the routes resolve the school server-side, never from
  the request body).
- P13 (data privacy) — the grace_warn flag carries metadata only (school id +
  seat counts + timestamps), never email/phone/name; the P3B01 path never leaks
  SQL to the client (generic 503; raw error logged server-side via the redacting
  logger only).
- No scoring/XP (provisioning only) — the seat count is a roster count; no XP
  constant or scoring formula is touched.
- Flag-OFF byte-identity (rollout safety) — `ff_school_provisioning` default-OFF
  keeps all three provisioning routes byte-identical to today (enforcement
  helpers never invoked) and `useSchoolProvisioning()` paints OFF synchronously.

### Notes on test strategy

REG-97 uses the repo's **live-DB-integration + helper-unit + route-unit +
flag-hook pattern**, matching REG-96 (Wave A) seam-for-seam. The live-DB SQL tests
live under `src/__tests__/migrations/**` (gated by `hasSupabaseIntegrationEnv()` →
`describe.skip` under placeholder env, and by the `RUN_INTEGRATION_TESTS=1` include
split in `vitest.config.ts`) and add the same user-context-JWT seam Wave A uses:
`evaluate_seat_policy` is SECURITY DEFINER + scope-guarded on `auth.uid()`, so the
admin fixture is a REAL auth user (`supabaseAdmin.auth.admin.createUser` →
`signInWithPassword` → anon client bearing the JWT) and the 42501 guard is
exercised for real; the service-role-only mutating RPCs are driven through the
service-role client (their backend credential). These run only in the "Integration
Tests (live DB)" CI job (currently billing-blocked; will run when CI billing is
restored). The helper / route / flag-hook tests run under the normal Vitest unit
job with NO DB: the helper test mocks `supabase-admin` + `feature-flags` +
`logger` and drives the REAL P3B01 parser / 409 builder / capacity math /
flagGraceWarn. For `flagGraceWarn` the mocked admin client now ROUTES by table
(`notifications` vs `admin_users`) and CAPTURES the actual insert payloads
(flattening both the single-object school insert and the bulk super-admin array
insert), so the strengthened test asserts the live-DB NOT-NULL contract WITHOUT a
DB: every captured row has a non-empty `message` (`notifications.message` text
NOT NULL — bug 1) and a valid-uuid `recipient_id` (`notifications.recipient_id`
uuid NOT NULL; the school uuid + per-super-admin `admin_users.auth_user_id`, never
the old `'super_admin'` string — bug 2), the super-admin fan-out is N→N+1, and a
negative case proves the guards FAIL on the old buggy shape (these two bugs were
fixed and would otherwise only surface against a live DB). The route tests mock
ONLY the seat-enforcement HELPER module
(keeping `seatCapViolationResponse` REAL via `importActual`) plus the auth + db
seams, so the routes' real branching + response shapes run; the flag-off file
asserts the enforcement helpers are NEVER called with the flag OFF and each route
returns its legacy status/shape; the flag-hook test mocks only `getFeatureFlags`
and asserts the synchronous DEFAULT_OFF paint (mirrors the Wave A
`school-admin/command-center-flag-gate.test.tsx`).

### Catalog total

Pre-Phase-3B-Wave-B: 64 entries. Phase 3B Wave B (seat-aware provisioning
ENFORCEMENT, P11-adjacent, behind `ff_school_provisioning`) adds REG-97 (CEO-approved
hybrid seat policy — 4 statuses + 14-day grace + reset; unified both-table count;
dual atomic race-safe enroll paths with P3B01-nothing-inserted-on-block; flag-OFF
byte-identical).

**Total: 65 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## School-admin RBAC depth — role→permission matrix + staff management (Phase 3B Wave C) — REG-98

Source: Phase 3B Wave C "School-admin RBAC depth" (CEO-approved 2026-06-08 role→
permission matrix; RBAC additions gate), behind `ff_school_admin_rbac`; default
OFF. Adds ONE idempotent grants migration
(`supabase/migrations/20260614000002_phase3b_school_admin_rbac.sql`: seeds 4 new
`institution.*` permission codes — export_reports / manage_billing / view_billing /
manage_staff — re-asserts `institution.manage_students`, and grants the Wave-C
SUPERSET to the SINGLE `institution_admin` RBAC role so `authorizeRequest()` passes
for every code a school admin can possibly hold). The PER-ROLE narrowing lives IN
CODE: `SCHOOL_ADMIN_ROLE_CAPABILITIES` + `schoolAdminRoleAllows()` in
`src/lib/school-admin-auth.ts`, applied as Step-4 of `authorizeSchoolAdmin` ONLY
when `ff_school_admin_rbac` is ON (the trigger `sync_school_admin_role()` maps all
four `school_admins.role` values to the one `institution_admin` RBAC role, so RBAC
alone cannot distinguish them — the matrix narrows on the `school_admins.role`
field already fetched, O(1), no extra round-trip, the 6 platform roles untouched).
Plus the flag-conditional deploy-safety selector
(`src/lib/school-admin/permission-code.ts`), the staff-management route
(`src/app/api/school-admin/staff/route.ts`, GET/POST/PATCH/DELETE on
`institution.manage_staff`), the UI flag hook (`src/lib/use-school-admin-rbac.ts` +
`SCHOOL_ADMIN_RBAC_FLAGS`), and the caller-role hook
(`src/lib/use-school-admin-role.ts`).

Four things are blocking defects if they regress: (a) **the CEO-approved
role→permission matrix** — principal AND institution_admin allow ALL 10 matrix
codes; vice_principal denies EXACTLY `institution.manage_billing` +
`institution.manage_staff` (keeps the other 8, incl. `institution.view_billing` +
`institution.manage`); academic_coordinator allows ONLY the 6 shared codes
(view_analytics, report.view_class, export_reports, manage_students,
manage_teachers, class.manage) and denies `institution.manage` + both billing +
staff; a code OUTSIDE the matrix union DEFERS (returns allowed) for every valid
role (Wave C only ever NARROWS the RBAC superset, never grants beyond it), and an
impossible role value fails CLOSED (denies everything); (b) **server narrowing
under the flag** — with `ff_school_admin_rbac` ON, `authorizeSchoolAdmin` returns
403 `SCHOOL_ADMIN_ROLE_DENIED` when the caller's `school_admins.role` does not
grant the requested code (vice_principal→manage_billing/manage_staff,
academic_coordinator→manage/view_billing) and authorizes when it does
(principal/institution_admin→any; vice_principal→view_billing;
academic_coordinator→shared; any role→non-matrix code); (c) **flag-OFF
byte-identical** — with the flag OFF the Step-4 narrowing block is SKIPPED
entirely, so the SAME (role, code) pair that 403s under ON is `authorized:true`
under OFF with the identical schoolId/userId/schoolAdminId, NO role is ever
`SCHOOL_ADMIN_ROLE_DENIED` on the OFF path for any matrix code, the permission-code
selector returns the route's ORIGINAL pre-Wave-C code, the staff endpoint 404s on
ALL verbs (gate BEFORE auth — `authorizeSchoolAdmin` is never even consulted), and
`useSchoolAdminRbac()` paints OFF synchronously (no first-paint flash); (d) **staff
safety guards** — the LAST active principal cannot be demoted (PATCH→409
LAST_PRINCIPAL_LOCKOUT) or revoked (DELETE→409), a cross-school target id resolves
to 404 (the caller's school is taken from their school_admins record, never the
body), POST is idempotent (no-op on an active member WITHOUT silently changing
role; reactivate a revoked member with the requested role; create-new returns 201),
an invalid role enum is 4xx, and audit metadata / logs carry id+role only — never
email / name / phone (P13).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-98 | `school_admin_rbac_matrix_scoping_flag_off_byte_identical_staff_lockout` | **(a) Role→permission matrix (pure, no DB).** The full 4-role × 10-code grid matches the CEO contract cell-for-cell: principal=10/10, institution_admin=10/10, vice_principal=8/10 (denies ONLY manage_billing + manage_staff; keeps view_billing + manage), academic_coordinator=6/10 (the shared 6; denies manage + both billing + staff); a non-matrix code (`school.manage_settings` + others) DEFERS (allowed) for every valid role; an impossible role denies BOTH matrix and non-matrix codes (fail-closed). A second independent EXPECTED literal asserts each cell so a drift in either copy fails. **(b) Server narrowing under flag ON (mocked).** `authorizeSchoolAdmin` 403s `SCHOOL_ADMIN_ROLE_DENIED` for vice_principal+manage_billing, vice_principal+manage_staff, academic_coordinator+manage, academic_coordinator+view_billing; authorizes principal+manage_staff, principal+manage_billing, institution_admin+manage_staff, vice_principal+view_billing, academic_coordinator+manage_students, any-role+non-matrix; the resolved school context (schoolId/role) is returned even on the narrowing denial. **(c) Flag-OFF byte-identical.** With the flag OFF, vice_principal+manage_billing AND academic_coordinator+manage are `authorized:true` (the pairs that 403 under ON) with identical schoolId/userId/schoolAdminId; NO role is ever `SCHOOL_ADMIN_ROLE_DENIED` across every (4 roles × 4 carve-out codes) pair; the flag is read with `ff_school_admin_rbac`; `schoolAdminPermissionCode` returns the OFF (original) code when OFF and the matrix code when ON (reads `ff_school_admin_rbac` with an environment scope); the staff endpoint returns 404 on GET/POST/PATCH/DELETE when OFF and NEVER calls `authorizeSchoolAdmin` (gate before auth); `useSchoolAdminRbac()` initial SYNCHRONOUS value is `false` (DEFAULT_OFF), stays false absent / explicitly-false / on `getFeatureFlags` rejection, flips ON only after the async confirm when true, and fetches scoped to `role:'school_admin'`. **(d) Staff API (mocked, flag ON).** authorize denial returned unchanged (403, gated on `institution.manage_staff`); GET lists school-scoped active staff (empty→200 empty array; list error→500); POST invite-new→201 + idempotent no-op on an active member (200, role UNCHANGED, no insert/createUser) + reactivate a revoked member (200, is_active→true with requested role) + invalid email/role→400; PATCH role change→200 + unchanged→no-op + invalid enum→400 + cross-school→404 + last-principal demote→409 LAST_PRINCIPAL_LOCKOUT (nothing updated) + demote-allowed when count=2; DELETE revoke→200 (is_active→false) + idempotent on already-revoked (200) + cross-school→404 + last-principal revoke→409 + allowed when count=2 + missing id→400; P13: invite audit row + 500-path log carry NO email/name. | `src/__tests__/lib/school-admin/role-capabilities.test.ts` (62 unit tests: full 40-cell role×code grid + per-role allowed-count summary (principal/institution_admin=10, vice_principal=8, academic_coordinator=6) + non-matrix defer for every role + unknown-role fail-closed) + `src/__tests__/school-admin-auth-rbac-narrowing.test.ts` (14 unit tests, mocked: flag-ON denials VP→billing/staff + AC→manage/view_billing, flag-ON allows principal/institution_admin/VP-view_billing/AC-shared/non-matrix, flag-OFF byte-identical authorized for the same pairs + no-denial-across-the-grid + flag-name read) + `src/__tests__/lib/school-admin/permission-code.test.ts` (5 unit tests, mocked: OFF→off code, ON→on code, reads ff_school_admin_rbac, environment scope, pure round-trip) + `src/__tests__/api/school-admin/staff-routes.test.ts` (27 unit tests, mocked: flag-OFF 404 all 4 verbs no-auth-call; authorize-denial passthrough; GET list/empty/500; POST 201/no-op/reactivate/400×2; PATCH change/no-op/400/cross-school-404/last-principal-409/allowed-count2; DELETE revoke/idempotent/cross-school-404/last-principal-409/allowed-count2/missing-id-400; P13 no-PII audit + log) + `src/__tests__/school-admin/rbac-flag-gate.test.tsx` (5 tests: sync DEFAULT_OFF + stays-OFF-absent / stays-OFF-false / flips-ON-true / stays-OFF-on-reject / role-scoped fetch) | E |

### Pinned tests

- `src/__tests__/lib/school-admin/role-capabilities.test.ts::schoolAdminRoleAllows — per-role coarse summary (count of allowed matrix codes)::vice_principal allows exactly 8 (denies manage_billing + manage_staff only)`
- `src/__tests__/lib/school-admin/role-capabilities.test.ts::schoolAdminRoleAllows — per-role coarse summary (count of allowed matrix codes)::academic_coordinator allows exactly the 6 shared codes (no manage, no billing, no staff)`
- `src/__tests__/lib/school-admin/role-capabilities.test.ts::schoolAdminRoleAllows — non-matrix codes DEFER (allowed) for every role::academic_coordinator defers (allows) non-matrix code school.manage_settings`
- `src/__tests__/school-admin-auth-rbac-narrowing.test.ts::authorizeSchoolAdmin — flag ON narrowing (denials)::vice_principal calling institution.manage_billing → 403 SCHOOL_ADMIN_ROLE_DENIED`
- `src/__tests__/school-admin-auth-rbac-narrowing.test.ts::authorizeSchoolAdmin — flag OFF is byte-identical (no narrowing)::vice_principal + institution.manage_billing is AUTHORIZED when the flag is OFF (would be 403 ON)`
- `src/__tests__/school-admin-auth-rbac-narrowing.test.ts::authorizeSchoolAdmin — flag OFF is byte-identical (no narrowing)::NO role is ever 403 SCHOOL_ADMIN_ROLE_DENIED on the OFF path, for any matrix code`
- `src/__tests__/api/school-admin/staff-routes.test.ts::FLAG OFF — endpoint behaves as not-present (404 before auth)::POST → 404 and never calls authorizeSchoolAdmin`
- `src/__tests__/api/school-admin/staff-routes.test.ts::PATCH — role change::returns 409 LAST_PRINCIPAL_LOCKOUT when demoting the ONLY active principal`
- `src/__tests__/api/school-admin/staff-routes.test.ts::DELETE — revoke (deactivate)::returns 409 LAST_PRINCIPAL_LOCKOUT when revoking the ONLY active principal`
- `src/__tests__/api/school-admin/staff-routes.test.ts::DELETE — revoke (deactivate)::returns 404 for a CROSS-SCHOOL target`
- `src/__tests__/school-admin/rbac-flag-gate.test.tsx::useSchoolAdminRbac — default OFF (no first-paint flash)::initialises OFF synchronously and stays OFF when the flag is absent`

### Invariants covered by this section

- P9 (RBAC enforcement) — the per-school-admin-role capability matrix is the
  authoritative server-side narrowing (`authorizeSchoolAdmin` Step 4), applied on
  top of the existing `authorizeRequest` permission check; the client hooks
  (`useSchoolAdminRbac`, `useSchoolAdminRole`) are UI convenience only, never a
  security boundary.
- P8/P9 (cross-tenant scope) — the staff route takes the caller's school from
  their `school_admins` record (never the request body) and 404s any target whose
  `school_id` differs; the LAST-principal lockout prevents a school from locking
  itself out of billing/staff management.
- P13 (data privacy) — staff audit metadata + error logs carry `school_admins.id`
  + role only, never email / name / phone; the new permission descriptions and
  audit actions contain no PII.
- No scoring/XP (RBAC only) — Wave C touches permissions + grants + a staff route;
  no XP constant or scoring formula is read or written.
- Flag-OFF byte-identity (rollout safety) — `ff_school_admin_rbac` default-OFF
  skips the entire narrowing block (server auth decision byte-identical to
  pre-Wave-C), keeps the permission-code selector on each route's original code,
  404s the staff endpoint, and paints the RBAC UI gate OFF synchronously.

### Notes on test strategy

REG-98 is a **pure-unit + mocked-seam** entry (no live-DB tier — the only DB
artifact is an additive idempotent grants migration whose effect is asserted
indirectly: the matrix superset is granted at the RBAC layer, and the per-role
narrowing it enables is exercised in code). The matrix test imports the REAL
exported `schoolAdminRoleAllows` / `SCHOOL_ADMIN_ROLE_CAPABILITIES` and asserts
every cell against a SECOND independent EXPECTED literal so a drift in either copy
fails (it is NOT a tautology against the source map). The narrowing test mirrors
the sibling `school-admin-auth.test.ts` seam (RBAC + supabase-admin + logger +
feature-flags mocked) and toggles the flag to prove the ON denials AND the OFF
byte-identity for the SAME (role, code) pairs. The staff-route test mirrors the
Wave B `seat-enforcement-routes.test.ts` handler-keyed chainable stub (extended to
support the `{ count }` principal lookup the lockout guard uses) and stubs the flag
+ auth seams so the route's real branching + status codes + lockout guards run; the
flag-OFF block proves the 404-before-auth gate by asserting `authorizeSchoolAdmin`
is never called. The flag-hook test mocks only `getFeatureFlags` and asserts the
synchronous DEFAULT_OFF paint (mirrors the Wave A/B flag-gate tests).

### Catalog total

Pre-Phase-3B-Wave-C: 65 entries. Phase 3B Wave C (school-admin RBAC depth —
CEO-approved role→permission matrix + staff management, behind
`ff_school_admin_rbac`) adds REG-98 (role→permission matrix scoping incl. the
negative coordinator∌billing / vice_principal∌staff carve-outs; flag-OFF
byte-identical with NO narrowing; staff-API last-principal lockout + cross-school
isolation + flag-OFF 404).

**Total: 66 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Engineering-Audit Cycle 5 — Teacher/School-Admin B2B (P8/P13) — 2026-06-29

Source: engineering-audit program, Cycle 5 (Teacher/School-Admin B2B). The
teacher-dashboard Edge Function resolves students to enrich, count, and grade
across many code paths; the audit found that several `.from('students')`
grade-fallback queries were not consistently scoped to the requesting teacher's
own school, opening a cross-tenant student-PII leak (TSB-1) where a teacher could
surface grade/roster data for students at another school. This cycle pins every
such site to the teacher's AUTH-DERIVED `school_id` (same-school only) and makes
each fail-closed for a school-less teacher, and adds a DB-layer RLS backstop so
the teacher→student boundary holds even if an application path regresses (TSB-2).
The `teacher_id` is JWT-bound at dispatch and is never request-supplied.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-184 | `teacher_dashboard_grade_fallback_tenant_scoped` | P8/P13: every teacher-dashboard `.from('students')` grade-fallback query is scoped by the teacher's AUTH-DERIVED `school_id` (same-school only) AND is fail-closed (empty / 403 / studentInClass=false) for a school-less teacher, across all 8 sites (assertTeacherOwnsClass, resolveStudentsForTeacher Path B, dashboard grade count, heatmap, alerts, resolveStudentsForClass, handleGetAttendanceRecord, and the handleSetGradeBookCell cross-tenant WRITE); `teacher_id` is JWT-bound at dispatch, never request-supplied — closes the critical cross-tenant student-PII leak (TSB-1). | `src/__tests__/edge-functions/teacher-dashboard-tenant-scoping.test.ts` | E |
| REG-185 | `students_teacher_assigned_rls_backstop` | P8: migration `20260702010000_teacher_assigned_students_rls.sql` adds the named "Teachers can view students in their classes" SELECT policy on public.students with the class_students⋈class_teachers⋈teachers roster join resolved from auth.uid() + both is_active guards (non-assigned AND inactive-enrollment teachers → 0 rows), no grade/school over-grant, idempotent + non-destructive — DB-layer defense-in-depth for the teacher→student boundary (TSB-2). | `src/__tests__/rls-teacher-assigned-students.test.ts` | E |

### Invariants covered by this section

- P8 (RLS boundary — every teacher-dashboard grade-fallback `.from('students')`
  query scoped to the teacher's auth-derived `school_id` and fail-closed for a
  school-less teacher; `teacher_id` JWT-bound at dispatch, never request-supplied;
  DB-layer RLS backstop policy resolves the class_students⋈class_teachers⋈teachers
  roster from auth.uid() with both is_active guards, no grade/school over-grant)
- P13 (data privacy — same-school-only scoping closes the cross-tenant
  student-PII leak; no other school's roster/grade data is reachable through any
  of the 8 audited sites, including the cross-tenant grade-book WRITE)

### Catalog total

Pre-REG-184: 150 entries (through Engineering-Audit Cycle 4's REG-182/REG-183
Foxy output content backstop + input injection neutralizer). Engineering-Audit
Cycle 5 adds REG-184 (teacher-dashboard grade-fallback tenant scoping — all 8
`.from('students')` sites same-school-only + fail-closed, closing TSB-1) and
REG-185 (students teacher-assigned RLS backstop — DB-layer defense-in-depth,
TSB-2).
**Total catalog: 152 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — TSB-4: Class-Membership Soft-Delete Sync (P8) — 2026-06-29

The engineering audit found a live P8 divergence between the two dual
class-membership join tables. Both `class_students` and `class_enrollments`
carry the same natural key `(class_id, student_id)` + an `is_active` soft-delete
flag, but only their row SETS were kept in sync (the INSERT-only mirror in
migration `20260620000700`). The school-admin de-enroll path flips
`is_active=false` on `class_enrollments` ONLY — and nothing propagated that flip
to `class_students`, the table the LIVE teacher boundary reads
(`canAccessStudent` / the `is_teacher_of(uuid)` SECURITY DEFINER helper resolve a
teacher's reachable students through `class_students WHERE is_active = true`). So
a de-enrolled student stayed `is_active=true` on `class_students` and REMAINED
VISIBLE to the assigned teacher.

The TSB-4 AUTO-FIX-SAFE slice adds two bidirectional, recursion-guarded
`AFTER UPDATE OF is_active` triggers (one per direction) that mirror the
`is_active` flip on the counterpart row, going forward. Recursion terminates
after exactly one bounce via a DOUBLE guard: trigger-level
`WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)` + a row-level
`WHERE ... AND is_active IS DISTINCT FROM NEW.is_active` (the reverse fire updates
zero rows → no re-entry). The slice is deliberately narrow — triggers + comments
only: it does NOT repoint the boundary helpers, add a teacher RLS policy on
`class_enrollments`, backfill the already-divergent historical rows, or DROP
either table. The full consolidation (boundary repoint to the canonical-by-intent
`class_enrollments`, the verified one-time backfill, and the eventual DROP of the
redundant table) is a SEPARATE, CEO-gated cutover.

The unit lane has no live Postgres, so the trigger contract is pinned as
comment-stripped static-source assertions (same convention as
`slc1-quiz-session-trigger-dedupe.test.ts` / REG-194 and the FIX-C INSERT-mirror
canary `portal-rbac-remediation-migration-canaries.test.ts` / REG-158). The
live-DB behavioural proof ("de-enroll on `class_enrollments` flips
`class_students.is_active` to false in one round trip, no trigger storm") is
deferred to an integration lane.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-200 | `class_membership_softdelete_sync` | P8: migration `20260702030000` adds bidirectional recursion-guarded `AFTER UPDATE OF is_active` triggers between `class_students` and `class_enrollments` so a soft de-enroll propagates to BOTH (closing the divergence where a de-enrolled student stayed `is_active=true` on `class_students`, the table the `canAccessStudent`/`is_teacher_of` teacher boundary reads); guard = trigger `WHEN OLD.is_active IS DISTINCT FROM NEW.is_active` + row `WHERE is_active IS DISTINCT FROM NEW.is_active` (terminates after one round-trip); idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS), SECURITY DEFINER + pinned search_path, NO DROP/RLS change; the DROP + boundary-repoint deferred to a separate CEO-gated cutover | `src/__tests__/tsb4-class-membership-softdelete-sync.test.ts` | E | P8 |

### Invariants covered by this section

- P8 (RLS / teacher-boundary divergence) — REG-200 pins that the soft de-enroll
  now propagates to `class_students` (the boundary-read table), so a de-enrolled
  student stops being reachable via `canAccessStudent` / `is_teacher_of`; the
  double recursion guard (trigger-level WHEN + row-level WHERE) is asserted on
  BOTH directions; the posture (idempotent, SECURITY DEFINER, pinned search_path)
  and the additive-only contract (no DROP TABLE/COLUMN, no RLS/policy churn, no
  boundary-helper redefinition — triggers + comments only) are pinned; and the
  ADR header's CEO-gated deferral of the DROP + boundary-repoint is pinned so the
  narrow scope can't silently widen.

### Catalog total

Pre-TSB-4: 166 entries (through Remediation PP-1/3's REG-199 parent-link
consent). Remediation TSB-4 adds REG-200 (class-membership soft-delete sync —
the P8 bidirectional recursion-guarded UPDATE-mirror going-forward fix).
**Total catalog: 167 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — Tier-2 PR A: Teacher/Enrollment is_active Scoping (P8) — 2026-06-29

The Tier-2 PR A slice adds an `.eq('is_active', true)` filter to the two teacher
roster lookups that read the `class_students` join through the RLS-BYPASSING
admin client (`/api/teacher/remediation` + `/api/teacher/parent-notify`), and adds
`is_active: true` to the `schools/enroll` off-path `class_enrollments` upsert
conflict payload so a re-enroll RESTORES the active flag (parity with the
seat-enforced RPC path). On these admin-client reads the filter is the ONLY
boundary keeping a soft-de-enrolled student off the teacher's roster — there is no
RLS backstop on a service-role read, so dropping it re-opens the divergence where
a de-enrolled student stays reachable for remediation / parent-notify.

The unit lane has no live Postgres, so the contract is pinned as comment-stripped
static-source assertions (same convention as the admin-route auth-gate sweep
`api/super-admin/admin-route-auth-gate-sweep.test.ts` and the TSB-4 migration-shape
pin `tsb4-class-membership-softdelete-sync.test.ts`): assert the `is_active` filter
sits ON the `class_students` query chain (non-vacuous — `.from` + `.select` +
`.eq('student_id')` + `.in('class_id')` confirmed present), assert the
`class_enrollments` upsert payload carries `is_active: true`, and GUARD that the
teacher-auth `class_teachers` lookup is preserved and was NOT itself
is_active-narrowed (the change is on the STUDENT roster lookup only). Behavioural
proof (de-enrolled student → 403) deferred to an integration lane.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-201 | `teacher_reads_scope_active_enrollment` | P8: the teacher remediation + parent-notify `class_students` roster lookups filter `.eq('is_active', true)` (a soft-de-enrolled student can't be assigned remediation or trigger parent-notify — these are RLS-bypassed admin-client reads so the filter is the only boundary), and the `schools/enroll` `class_enrollments` upsert restores `is_active: true` on re-enroll (parity with the seat-enforced RPC); guard pins that the teacher-auth `class_teachers` lookup is preserved; UPDATED 2026-07-13 (canary repair): remediation's class_teachers lookups are now deliberately is_active-scoped (fail-closed teacher auth, per the route header's active-rows requirement) and the pin asserts that scoping is REQUIRED on remediation; extraction upgraded from first-chain to ALL-chains so every class_enrollments read must carry is_active + class scoping | `src/__tests__/api/teacher/active-enrollment-scoping.test.ts` | U | P8 |

### Catalog total

Pre-Tier-2-PR-A: 167 entries (through TSB-4's REG-200 class-membership soft-delete
sync). Tier-2 PR A adds REG-201 (teacher/enrollment is_active scoping — the P8
admin-client roster filter + re-enroll active-restore source pin).
**Total catalog: 168 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — TSB-4: class_enrollments Teacher RLS + Fail-Closed Reconcile (P8) — 2026-06-30

Two TSB-4 READY-NOW migrations close the teacher data-boundary (P8) gap left by the
soft-delete-sync slice (REG-200). (1) `20260702050000_class_enrollments_teacher_select_policy.sql`
adds the MISSING teacher SELECT policy to `class_enrollments` — the canonical-by-intent
membership roster that today carries only school-admin / student / service-role policies,
so an ASSIGNED teacher on the RLS client got ZERO rows. The new
`class_enrollments_teacher_select` policy is a byte-for-byte mirror of the `class_students`
teacher policy (`class_id IN (SELECT ct.class_id FROM class_teachers ct JOIN teachers t
ON t.id=ct.teacher_id WHERE t.auth_user_id=auth.uid())`) — assigned teacher → rows,
non-assigned teacher → zero; grant-only, additive, idempotent (`DROP POLICY IF EXISTS` →
`CREATE`), no RLS toggle. (2) `20260702060000_class_membership_isactive_backfill.sql` is a
one-time FAIL-CLOSED reconcile of rows that diverged BEFORE the 20260702030000
UPDATE-mirror triggers landed: it flips `class_students.is_active` true→false ONLY where the
matching `class_enrollments` row is ALREADY inactive (direction A — completing an
already-authorized de-enroll), closing the live leak where a de-enrolled student stayed
teacher-visible via `canAccessStudent` (rbac.ts:331). It NEVER reactivates — the reverse
direction (ce=true/cs=false) is RAISE NOTICE report-only. A service-role-only, RLS-enabled
backup table (`_tsb4_isactive_backfill_backup`) snapshots changed rows for exact rollback.
No DROP of the roster tables; the `canAccessStudent` / `is_teacher_of` reader is NOT repointed
onto `class_enrollments` (deferred to the CEO-gated cutover). Migrations-only slice.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-208 | `tsb4_enrollments_teacher_rls_and_failclosed_reconcile` | P8: `class_enrollments` gains a teacher SELECT RLS policy mirroring `class_students` (closing the discoverable-policy gap where an assigned teacher got zero rows on the canonical roster); a one-time FAIL-CLOSED reconcile flips `class_students.is_active` true→false only where the matching `class_enrollments` row is already inactive (completes authorized de-enrolls, closing the live leak where de-enrolled students stayed teacher-visible via rbac.ts) — never reactivates (no over-grant), reverse direction report-only, backup table RLS-protected, no DROP, canAccessStudent reader NOT repointed (deferred/gated) | `src/__tests__/tsb4-enrollments-rls-reconcile.test.ts` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary / teacher data boundary) — REG-208 source-pins (comment-tolerant)
  the SHAPE of both migrations: (1) the teacher SELECT policy on `class_enrollments`
  references `class_teachers` / `teachers` / `auth_user_id` / `auth.uid()` in the same
  `class_id IN (...)` subquery as the `class_students` teacher policy, is FOR SELECT,
  and is idempotent (`DROP POLICY IF EXISTS`); (2) the new `_tsb4_isactive_backfill_backup`
  table ENABLES RLS + a service-role-only policy in the SAME migration; (3) the KEY safety
  pin — the reconcile UPDATE sets `is_active = false` ONLY, conditioned on
  `ce.is_active=false AND cs.is_active=true`, with NO unqualified `is_active = true`
  assignment anywhere in active SQL (the backfill can only REMOVE visibility, never grant);
  (4) neither migration DROPs `class_students` / `class_enrollments`; (5) the reader is NOT
  repointed — `src/lib/rbac.ts` still reads `.from('class_students')`.
- Lane note: SOURCE pin in the normal `npm test` lane (sibling to REG-200's
  `tsb4-class-membership-softdelete-sync.test.ts`), NOT the live-DB integration lane.

### Catalog total

TSB-4 RLS + fail-closed reconcile adds REG-208 (class_enrollments teacher SELECT policy
mirroring class_students + one-time fail-closed is_active reconcile that only ever removes
teacher visibility; backup table RLS-protected; no DROP; reader not repointed).
**Total catalog: 175 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-221 — XC-3 Phase 3 (first slice): teacher/school-admin read route migrated admin → RLS-scoped server client; cross-tenant upper+lower bound proven (allowlist 270 → 269)

**Why.** Phase 3 is HIGHER RISK than Phase 2: the rows are cross-tenant and
multi-row, so the gate is TENANT-SCOPING CORRECTNESS — a too-LOOSE RLS policy is
a cross-tenant PII/commercial leak (strictly worse than a 200→empty under-fetch),
and a too-STRICT one silently empties a working surface. This first slice picks
the single most provable teacher/school-admin GET: `GET /api/school-admin/contracts`
— GET-only, single table (`school_contracts`), web cookie caller (no mobile
Bearer surface for school-admin), flag-gated (`ff_school_contracts_v1`), and the
route author already documented its reliance on the named SELECT policy.

**What.** `src/app/api/school-admin/contracts/route.ts` swaps its one read from
`getSupabaseAdmin()` (RLS-bypassing service role) to `createSupabaseServerClient()`
(RLS-respecting cookie session). `authorizeSchoolAdmin(... institution.view_billing/manage)`
unchanged; response envelope `{ success, data: { rows, total, page, limit } }`
byte-identical. Caller transport: school-admin portal is web cookie only
(grep confirms NO `mobile/` caller and no Bearer-only path), so the cookie client
is correct; a missing/mismatched session yields `auth.uid()=NULL` → zero rows
(fail-CLOSED, never a 500, never a payload).

**Tenant bound PROOF — policy `school_admin_can_read_own_contracts`**
(`supabase/migrations/20260507150000_school_contracts.sql`):
`FOR SELECT TO authenticated USING (school_id IN (SELECT school_id FROM public.school_admins WHERE auth_user_id = auth.uid()))`.
- **LOWER BOUND (in-scope visible, no under-fetch):** `auth.schoolId` is resolved
  by `authorizeSchoolAdmin` from the caller's ACTIVE `school_admins` membership —
  a SUBSET of the policy's (un-`is_active`-filtered) set — so the caller's own
  school is always admitted; the route's `.eq('school_id', auth.schoolId)` then
  returns exactly that school's contracts.
- **UPPER BOUND (cross-tenant invisible):** the policy admits ONLY
  `school_id ∈ {caller's school_admins schools}`; any school the caller does not
  administer is excluded even if a foreign `school_id` reached the query. The
  `school_admins` SELECT/UPDATE policies all self-scope via `auth_user_id=auth.uid()`
  and never read `school_contracts` back, so the inline `FROM school_admins` is
  NOT a recursion cycle (it is already in the Phase-0a `GRANDFATHERED_INLINE_POLICIES`
  ledger).

**Scan result.** Among teacher/school-admin GET routes, this is the only clean
GET-only single-table read whose RLS bounds are airtight. DEFERRED: `school-admin/analytics`
(reads `school_subscriptions`, an intentional deny-all/service-role-only table —
RLS swap would empty it), `school-admin/students`/`classes` (GET mixed with
write handlers in the same file — cannot leave the admic-client import / prune
the allowlist), `teacher/lab-leaderboard` (multi-table + a view of unknown RLS
posture), `teacher/classes/available` (join-by-secret preview RLS would BLOCK —
intended), `school-admin/invoices` (no confirmed school-admin SELECT policy on
`school_invoices`). N = 1.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-221 | `GET /api/school-admin/contracts — RLS tenant-bound contract (admin→server migration)` | P8/P9/P13: with the RLS client emulated as "rows the `school_admin_can_read_own_contracts` policy exposes to THIS caller" (dataset ∩ the auth.uid()-resolved school), (a) LOWER BOUND — an in-scope admin gets the byte-identical `{ success, data:{ rows, total:2, page:1, limit:25 } }` envelope with ONLY their school's rows (a co-resident other-tenant row never appears); (b) UPPER BOUND — a request resolving a foreign `school_id` the caller does not administer returns `{ rows:[], total:0 }` with NOT ONE foreign row in the serialized body (RLS is the independent boundary); a denied caller gets the authz `errorResponse` verbatim with ZERO client builds (no DB touched); (c) regression guard — the route builds `createSupabaseServerClient` and the source imports `@/lib/supabase-server` and NOT `supabase-admin`. The allowlist guard pins the ledger ratchet 270 → 269 (route pruned from `scripts/admin-client-allowlist.json`, `count` + `EXPECTED_COUNT` decremented; `detected === allowlist`). | `src/__tests__/api/school-admin/contracts-rls-contract.test.ts`, `src/__tests__/api-admin-client-allowlist.test.ts`, `scripts/admin-client-allowlist.json` | E | P8, P9, P13 |

### Invariants covered by this section

- P8 (RLS boundary) — a cross-tenant school-admin read now runs under the
  caller's identity with the `school_admin_can_read_own_contracts` policy as a
  real second line of defense behind `authorizeSchoolAdmin`; the RLS-bypassing
  service-role client is removed from this path.
- P9 (RBAC enforcement) — `authorizeSchoolAdmin` (RBAC + active-school + Wave-C
  role narrowing) unchanged; RLS is additive defense in depth.
- P13 (data privacy) — both tenant bounds proven: a school the caller does not
  administer is invisible (no cross-tenant commercial-contract leak), and a
  denied/sessionless caller gets zero rows (fail-closed).

### Catalog total

XC-3 Phase 3 first slice adds REG-221 (one teacher/school-admin read route —
`school-admin/contracts` — migrated admin → RLS-scoped `createSupabaseServerClient`
with cross-tenant upper+lower bound proven against `school_admin_can_read_own_contracts`;
admin-client allowlist ratcheted 270 → 269).
**Total catalog: 188 entries (target: 35 — TARGET EXCEEDED).**

## REG-222 — XC-3 Phase 4 (first drain): `at_risk_alerts::Teachers see own at-risk alerts` inline subquery → `get_my_teacher_id()`; ledger 241 → 240

**Why.** Phase 1 drained the apex `students` school-admin edge (242 → 241), proving
a single grandfathered inline cross-table policy can be refactored to a SECURITY
DEFINER helper without shifting its boundary. Phase 4 carries that ratchet through
the REMAINING grandfathered policies, table by table, so the
`GRANDFATHERED_INLINE_POLICIES` allowlist shrinks toward zero. This first Phase 4
slice proves the phase is executable on a NON-apex table by picking the single
CLEANEST policy whose inline cross-table subquery has an EXACT existing-helper
equivalent (boundary-preserving, no new helper needed).

**What.** `supabase/migrations/20260702100000_xc3_p4_drain_at_risk_alerts_teacher_select.sql`
DROPs + re-CREATEs the policy `"Teachers see own at-risk alerts"` ON
`public.at_risk_alerts`, replacing its inline `FROM public.teachers` subquery with
the EXISTING SECURITY DEFINER helper `public.get_my_teacher_id()`. Command (`FOR ALL`,
no `FOR` clause), roles (PUBLIC, no `TO` clause), and check shape (USING only, so
WITH CHECK keeps defaulting to USING) are preserved EXACTLY.

**Boundary-equivalence PROOF (the gate).** Baseline (00000000000000_baseline_from_prod.sql:20252):
`USING ( teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid()) )`.
Helper: `get_my_teacher_id()` (baseline:8998) is exactly
`SELECT id FROM teachers WHERE auth_user_id = auth.uid() LIMIT 1`. The two predicates
admit the IDENTICAL `at_risk_alerts` rows for EVERY caller because:
- **Same table, same filter, no extra guards** — both read `public.teachers` and
  filter ONLY on `auth_user_id = auth.uid()`; neither carries an `is_active`,
  `deleted_at`, or status guard, so neither narrows nor widens the teacher set.
- **At-most-one element** — `public.teachers` has a FULL UNIQUE constraint on
  `auth_user_id` (`teachers_auth_user_id_unique`, baseline:16272), so
  `{ id : auth_user_id = auth.uid() }` has cardinality 0 or 1. With a 0/1-element
  set, `teacher_id IN (set)` ≡ `teacher_id = (the element)`; the helper's `LIMIT 1`
  drops no row (LIMIT 1 only matters at >1, which UNIQUE forbids).
- **Empty/NULL parity** — caller with no teacher row: inline `IN ()` = FALSE,
  helper `= NULL` = NULL (not TRUE); a row with `teacher_id IS NULL` (the FK is
  `ON DELETE SET NULL`): both forms never match. Identical non-match in every case.
No row becomes newly visible, none is removed — proven for every caller, not just
the happy path.

**Recursion safety.** `get_my_teacher_id()` is SECURITY DEFINER (baseline:8997), so
its inner read of `public.teachers` BYPASSES RLS — no `at_risk_alerts → teachers`
edge remains in the RLS graph, so the latent TSB-4-class cycle the inline form
could close cannot form. The helper is in the migration-`20260516050000`
keep-PUBLIC-EXECUTE list (kept precisely because it is referenced inside RLS
USING/WITH CHECK), so `authenticated` callers can still evaluate the policy — unlike
the plural `get_my_student_ids()`, which was revoked from PUBLIC and would have
broken any policy that called it (hence the plural helper, though a byte-exact match
for student-own inline forms, is NOT a usable drain target).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-222 | `generalized RLS recursion guard` (existing static guard, re-pinned) | P8: the static cross-table-recursion guard parses the full root chain INCLUDING migration `20260702100000`, reduces `at_risk_alerts::Teachers see own at-risk alerts` to its NEW helper-delegating form (`teacher_id = public.get_my_teacher_id()`), and the detector no longer flags it (no inline `FROM`/`JOIN` over a different RLS table). The drained key is PRUNED from `GRANDFATHERED_INLINE_POLICIES`, so (a) `detected ⊆ allowlist` still holds, (b) no STALE allowlist entry remains (`allowlist \ detected === ∅`), and (c) BOTH count pins ratchet 241 → 240 (`GRANDFATHERED_INLINE_POLICIES.size === 240` and `detectedRiskKeys().length === 240`). Re-introducing the old inline `FROM public.teachers` shape under the same name would now FAIL the guard (the name is absent from the ledger). 23/23 in the file pass at 240. Static SQL-text guard, no DB. | `src/__tests__/rls-no-cross-table-recursion.test.ts`, `supabase/migrations/20260702100000_xc3_p4_drain_at_risk_alerts_teacher_select.sql` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary) — one more latent inline cross-table edge (a TSB-4-class
  recursion risk) is removed from the policy surface by delegating to a SECURITY
  DEFINER helper whose inner reads bypass RLS; the boundary is proven byte-identical.

### Catalog total

XC-3 Phase 4 first drain adds REG-222 (one grandfathered inline policy —
`at_risk_alerts::Teachers see own at-risk alerts` — refactored from an inline
`FROM public.teachers` subquery to the existing SECURITY DEFINER helper
`get_my_teacher_id()`, boundary-identical via the UNIQUE `teachers.auth_user_id`
constraint; recursion-guard ledger ratcheted 241 → 240).
**Total catalog: 189 entries (target: 35 — TARGET EXCEEDED).**

## REG-249 — school_id JWT claim (app_metadata) is STAFF-only, single-school, merge + fail-soft; teachers/classes gain additive get_jwt_school_id() staff SELECT RLS (Phase 4 tenant isolation, P8+P13) (2026-07-15)

Phase 4 makes JWT-claim tenant isolation real: `setSchoolClaim()` writes
`app_metadata.school_id` (the ONLY claim `public.get_jwt_school_id()` reads for
the school-staff RLS SELECT policies), and `dispatchSingleSchoolAdminClaim()`
wires it into the STAFF link points behind a single-school guard. The claim is
stamped ONLY for a single-school STAFF member — never a multi-school admin, and
structurally never a student or teacher-import (keyed strictly on
`school_admins`; students are DELIBERATELY excluded because the students staff
RLS policy is role-agnostic and a student claim would leak same-school peer PII).

### Notes on ID assignment

REG-249 is the next free id: after the origin/main merge (and the renumbered
REG-248 institution_admin entry) the catalog's max id is REG-248 and this project
appends rather than backfilling intentional gaps (REG-170 remains a documented
skip). REG-249 is confirmed absent before use. (This entry was authored as REG-243
on the email-onboarding branch and renumbered to REG-249 on merge to avoid a
collision with the origin/main Foxy REG-241..247 block.)

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-249 | `school_id_jwt_claim_staff_only_merge_failsoft` | (a) **MERGE, never clobber**: `setSchoolClaim(authUserId, schoolId)` fetches the user's current `app_metadata` and spreads it — an existing key (`provider`/`providers`/`role`) SURVIVES while `school_id` is added; when a DIFFERENT `school_id` already exists it replaces ONLY `school_id` (other keys untouched); a null/absent `app_metadata` yields just `{ school_id }`. On success returns `{ok:true, changed:true, reason:'set'}` and calls `updateUserById` exactly once. (b) **Idempotent no-op**: when the stored claim already equals the target, NO `updateUserById` call is made and it returns `{ok:true, changed:false, reason:'noop_already_set'}`. (c) **Fail-soft (never throws)**: every failure path returns a structured result and the promise RESOLVES (never rejects) — `invalid_input` (missing authUserId/schoolId, never fetches), `user_not_found`, `fetch_failed`, `update_failed`, and `threw` (an admin call that rejects is caught). (d) **P13**: on a logging failure path with a user carrying `email` + a token-shaped field, the emitted `console.error` output contains NEITHER the email NOR the token (opaque uuids only); the happy MERGE path logs nothing. (e) **Single-school wiring guard** (`setSchoolClaimForSingleSchoolAdmin`/`dispatchSingleSchoolAdminClaim`): a single active `school_admins` membership equal to expected → stamps the claim (`reason:'set'`, `updateUserById` called, query keyed strictly on `school_admins`); MULTIPLE memberships → `skipped_multi_school` with NO claim and `setSchoolClaim` never reached; a single membership for a DIFFERENT school → `skipped_multi_school`; ZERO memberships (a student/teacher-only user has no `school_admins` row) → skipped, never claimed — this is the structural "students are never claimed" guard; fail-soft reasons `skipped_lookup_failed` (lookup error → service-role safety net remains), `skipped_threw` (admin client rejects), `skipped_invalid_input` (no DB touch); `dispatchSingleSchoolAdminClaim` returns `void` synchronously, eventually stamps for a single-school admin, and NEVER throws when the underlying lookup rejects. (f) **Call-site source canary**: the 4 STAFF link points dispatch the claim — `ensureSchoolAdminOnboarding` (school-admin-bootstrap.ts), `establishPrincipalAdmin` + `claimAdminToken` (school-provisioning.ts, ≥2 calls), and `POST /api/school-admin/staff` — while the teacher bulk-import route dispatches ZERO and carries the documented `INTENTIONALLY DEFERRED` note (no auth user at import), and the student bulk-import route dispatches ZERO (students are never claimed). SCOPE NOTE: these tests pin the helper/wiring BEHAVIOR that writes the claim + the call-site presence. The accompanying additive migrations `20260715110000_school_staff_jwt_rls_teachers_classes.sql` (mirrors the existing students staff SELECT policy onto `teachers` + `classes` via `get_jwt_school_id()`; RLS stays ENABLED, PERMISSIVE-OR only broadens, idempotent `DROP POLICY IF EXISTS`) and `20260715110100_backfill_app_metadata_school_id.sql` (backfills the claim for single-school `school_admins`/`teachers` only, shallow-merge, ABSENT-claim-only, single-school `HAVING COUNT(DISTINCT school_id)=1`; students DELIBERATELY EXCLUDED) are referenced as the additive-policy delivery — live-DB RLS ENFORCEMENT is deploy/integration-time and is NOT asserted by these unit tests. | `packages/lib/src/identity/school-claim.test.ts` (12 tests: 3 MERGE + 1 idempotent + 6 fail-soft + 2 P13) and `packages/lib/src/identity/school-claim-wiring.test.ts` (14 tests: 4 single-school-guard + 3 fail-soft + 2 dispatch fire-and-forget + 5 call-site source canary), mirrored into the apps/host vitest lane via the `apps/host/src/lib/identity/school-claim{,-wiring}.test.ts` re-export stubs. Additive policies: `supabase/migrations/20260715110000_school_staff_jwt_rls_teachers_classes.sql` + `20260715110100_backfill_app_metadata_school_id.sql`. | E | P8, P13 |

### Invariants covered by this section

- P8 (RLS / tenant boundary) — the scalar `app_metadata.school_id` claim that
  `get_jwt_school_id()` reads is stamped ONLY for single-school STAFF (keyed on
  `school_admins`); multi-school admins stay on the explicit
  `school_admins`-scoped path, and the teachers/classes additive staff SELECT
  policies close the tenant-scoping gap without narrowing any existing policy.
- P13 (data privacy) — students are structurally never claimed (the wiring keys
  on `school_admins` and the backfill migration excludes students), so the
  role-agnostic students staff policy can never let a student read same-school
  peers' PII; and `setSchoolClaim` logs opaque uuids only (never email/token).

### Catalog total

Pre-REG-249: 215 entries (through REG-248, institution_admin first-class
onboarding). Adds REG-249 (school_id JWT claim is single-school STAFF-only,
merge + fail-soft; the 4 staff link points dispatch it while teacher/student
imports do not; accompanying additive teachers/classes staff SELECT RLS +
single-school STAFF-only backfill referenced, not live-DB-enforced here).
**Total catalog: 216 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-256 — teacher-skills eval harness pins — P13 judge-prompt boundary, P6/P5 oracle parity, callClaude-only transport, exit-code policy (2026-07-15)

Pins the offline teacher-skills eval harness (`eval/teacher-skills/`, adapted
from Apache-2.0 anthropics/k12-teacher-skills@7c03c83; sibling of the REG-140
RAG harness).

Pins: (1) **P13 boundary** — an artifact with a PII-shaped key is verdict
REVIEW with zero criteria evaluated and is NEVER serialized into a judge
prompt (with `--judge` on the judge is a real external LLM call, so this is a
data-exfiltration boundary); the harness has NO Supabase client and NO DB
reads — synthetic/dev fixtures only, never production student data.
(2) **Deterministic-before-LLM** — QZ-P6a..f/QZ-P5 checks mirror quiz-oracle
`runDeterministicChecks` semantics (exactly-4 distinct options,
`correct_answer_index` 0-3, placeholder regex, string difficulty enum
easy|medium|hard, Bloom's six, grade strings "6"-"12") and are decided
synchronously, never delegated to the judge. (3) **Transport** — judge calls
go only through injected `callClaude` (`@alfanumrik/lib/ai`), no Anthropic
SDK import, no direct api.anthropic.com, and NO model override ever passed
(model changes are user-approval-gated). (4) **Exit-code policy** — 0 on a
completed run (verdicts live in the report), 2 on operator/config error, and
`--judge` on without config fails at the gate BEFORE any AI import.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-256 | `teacher_skills_eval_harness_p13_judge_boundary_oracle_parity_callclaude_transport_exit_codes` | (1) P13 boundary: an artifact carrying a PII-shaped key yields verdict REVIEW with zero criteria evaluated and is never serialized into a judge prompt; the harness has no Supabase client and no DB reads (synthetic/dev fixtures only). (2) Deterministic-before-LLM: QZ-P6a..f/QZ-P5 checks mirror quiz-oracle `runDeterministicChecks` semantics (exactly-4 distinct options, `correct_answer_index` 0-3, placeholder regex, string difficulty enum easy\|medium\|hard, Bloom's six, grade strings "6"-"12") and are decided synchronously, never delegated to the judge. (3) Transport: judge calls flow only through injected `callClaude` (`@alfanumrik/lib/ai`) — no Anthropic SDK import, no direct api.anthropic.com, no model override ever passed. (4) Exit codes: 0 on completed run, 2 on operator/config error; `--judge` without config fails at the gate before any AI import. | `apps/host/src/__tests__/eval/teacher-skills/` (5 files, 83 tests) | E | P13, P6/P5 parity (measurement-side), P12-adjacent |

### Invariants covered by this section

- P13 (data privacy) — a PII-shaped artifact key short-circuits to verdict
  REVIEW with zero criteria evaluated and is never serialized into a judge
  prompt; with `--judge` on the judge is a real external LLM call, so this is
  a data-exfiltration boundary. The harness has no Supabase client and no DB
  reads — synthetic/dev fixtures only, never production student data.
- P6/P5 parity (measurement-side) — the harness's deterministic QZ checks
  mirror the quiz-oracle `runDeterministicChecks` semantics exactly (option
  count/distinctness, answer-index range, placeholder regex, string difficulty
  enum, Bloom's six, grade strings "6"-"12"), so the eval harness cannot drift
  into grading against a different quality/grade contract than production.
- P12-adjacent (audited AI transport) — judge calls go only through the
  injected `callClaude` from `@alfanumrik/lib/ai` with no model override, so
  the user-approval gate on model changes cannot be bypassed from the harness;
  `--judge` without config fails at the gate before any AI import.
- Operational integrity — exit-code policy: 0 on completed run (verdicts live
  in the report, never in the exit code), 2 on operator/config error.

Assessment conditions tracked at merge: QZ-P6f string-difficulty sampling
boundary vs the generator's integer-difficulty served path must be documented
before grading real batches; A1 technical-term clause documented-or-split;
foxy good-fixture grade-level calibration.

### Catalog total

Pre-REG-256: 222 entries (through REG-255, quiz-generator RAG retrieval
single-source pin).
Adds REG-256 (teacher-skills eval harness pins — P13 judge-prompt boundary
[PII-shaped key → REVIEW, zero criteria, never serialized to the judge; no
Supabase client / no DB reads], deterministic-before-LLM QZ-P6a..f/QZ-P5
oracle parity, callClaude-only transport with no model override, and the
0/2 exit-code policy with the `--judge`-without-config pre-AI-import gate).
**Total catalog: 223 entries (target: 35 — TARGET EXCEEDED).**

---

