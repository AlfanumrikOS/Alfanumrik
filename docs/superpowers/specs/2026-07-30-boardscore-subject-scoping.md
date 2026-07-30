
# BoardScore™ Subject Scoping — Correctness Spec

Status: spec for backend implementation (next wave). Written by assessment. Read-only investigation, no code changed.

Owning invariant reference: this is a P1-adjacent change ("what BoardScore predicts scores for"), NOT a P1 change ("how BoardScore computes a score"). See §6.

## 0. Problem statement

CEO-reported defect: "student shall be able to choose their subjects on their own... you have listed all the subjects, which shall not be the case."

Root cause (confirmed this session): `getActiveSubjectsForGrade(grade)` in
`apps/host/src/app/api/cron/board-score/route.ts:87-103` computes a BoardScore
row for **every** `subject_code` that has active `cbse_chapter_weights` rows
at the student's grade — with no reference to the student at all beyond their
grade. `BoardScoreWidget` (`packages/ui/src/dashboard/os/BoardScoreWidget.tsx`)
then renders one tab per row returned by `GET /api/board-score`, so students
see BoardScore tabs for subjects they never picked.

Bug 1 (the PostgREST embed failure that makes `compute` currently 500/422 for
everyone) is being fixed separately and is out of scope here. This spec
assumes `compute` will start succeeding and defines what it should be called
*for*.

## 1. What subject-selection data actually exists (investigated, not assumed)

### 1.1 `students` table columns (baseline migration, line ~11590)
Relevant columns: `grade text NOT NULL`, `stream text` (science/commerce/humanities,
grade 11-12 only, CHECK-constrained), `preferred_subject text`,
`selected_subjects text[] DEFAULT '{}'`, `weak_subjects text[]`, `strong_subjects text[]`.

`selected_subjects` is the column. It is **not** a vague preference field — it
is written and validated server-side, atomically, by a dedicated RPC (§1.2).

### 1.2 Canonical write path: `set_student_subjects(p_student_id, p_subjects, p_preferred)`
`supabase/migrations/00000000000000_baseline_from_prod.sql:6991-7059`. `SECURITY DEFINER` RPC that, in one statement:
1. Resolves `p_student_id` (accepts either `students.id` or `auth_user_id`).
2. Authorizes: `auth.uid()` must match the target student's `auth_user_id`.
3. Validates every requested subject is in `get_available_subjects(student_id)` **and not locked** — raises `subject_not_allowed` otherwise (grade/stream/plan governance, not free-form text).
4. Validates count against the active plan's `subscription_plans.max_subjects` — raises `max_subjects_exceeded` otherwise (free=2, starter=4, pro/unlimited=unlimited).
5. Replaces rows in `student_subject_enrollment` (`DELETE ... WHERE student_id = ...` then re-`INSERT`).
6. Writes `students.selected_subjects` and `students.preferred_subject` in the same statement.

So there are **two mirrored representations of the same fact**, always written together:
- `students.selected_subjects text[]` (denormalized, one row per student — cheapest to read in a batch cron)
- `public.student_subject_enrollment(student_id, subject_code, selected_at, source)` (normalized, `source ∈ {student, admin, migration, onboarding}`, RLS-enabled, PK `(student_id, subject_code)`)

Both are equally authoritative (same transaction). **Recommendation: read `students.selected_subjects` in the cron** — it avoids an extra join per student in a loop that already does one row-per-student fetch, and the cron runs as service-role so RLS is moot either way.

Client entry point for this RPC: `PATCH /api/student/preferences` with
`{ action: 'set_selected_subjects', subjects: string[], preferred_subject: string }`
(`apps/host/src/app/api/student/preferences/route.ts:103-169`). This is called
from onboarding (§2) and from the dashboard's post-onboarding subject switcher
(per that file's own header comment — it replaced three direct client writes
from `dashboard/page.tsx`).

### 1.3 `get_available_subjects(p_student_id)` is confirmed BROADER than "my subjects" — do not use it as the BoardScore source
`supabase/migrations/00000000000000_baseline_from_prod.sql:8874-8911`. Returns
every subject where `grade_subject_map` matches the student's `(grade, stream)`
**and** `subjects.is_active AND subjects.is_content_ready`, annotated with
`is_locked` = "not covered by the student's current plan's `plan_subject_access`."
It does not know or care what the student picked — a grade-10 free-plan
student gets back all 5-6 grade-10 subjects (`is_locked=false` for 2 of them
under the free cap, `is_locked=true` for the rest). Using this RPC's unlocked
set for BoardScore would still be wrong: it's "what the student's plan
entitles them to browse," not "what the student is actually taking board
exams in." It is, however, the **eligibility ceiling** that `selected_subjects`
is validated against at write time (§1.2 step 3) — so `selected_subjects ⊆
unlocked(get_available_subjects)` is already a structural invariant, not
something BoardScore needs to re-derive.

### 1.4 No separate teacher/school subject-enrollment table exists
Searched for `student_subjects`, `student_electives`, `class_enrollments`
subject linkage. Found: `class_students` / `class_enrollments` — these model
**class membership** (which teacher's class a student is in), not per-subject
election. There is no admin/teacher-side "these are the N board subjects this
student sits" table distinct from `student_subject_enrollment`. `source` on
that table does support an `admin` value (a school admin or teacher could, in
principle, set a student's subjects on their behalf via the existing RPC path
with `source='admin'`), but no UI currently exercises that — it's schema
headroom, not a populated data source today.

**Conclusion for step 1: `students.selected_subjects` (mirrored by
`student_subject_enrollment`) is the one and only place the platform records
"the subjects this specific student has chosen." It is not inferred — it is
an explicit, RPC-validated, plan/grade/stream-governed pick.**

## 2. How "my subjects" is already modeled student-facing

- **Onboarding** (`packages/ui/src/onboarding/OnboardingFlow.tsx`, step
  `'subjects'` → `packages/ui/src/onboarding/SubjectStep.tsx`): the student
  is shown `useAllowedSubjects()` (the unlocked set from §1.3) as checkable
  tiles, capped at their plan's `max_subjects`, "Continue" disabled until
  `value.length > 0`. On finish, `selected_subjects` + `preferred_subject`
  are patched onto `students` directly (client write in this file — separate
  from the governed RPC path, see §4 gap note) or via `set_student_subjects`
  when changed later from the dashboard.
- **`/learn`** (`apps/host/src/app/(student)/learn/page.tsx`) **intentionally
  does NOT filter by `selected_subjects`**. It uses `useAllowedSubjects()`
  directly and shows every plan/grade/stream-eligible subject, locked ones
  greyed out with an upgrade CTA ("Locked subjects are shown greyed out —
  they are never hidden, which helps students understand what upgrading
  unlocks" — page's own docstring). This is a deliberate, different product
  decision for a browsing/upsell surface and is **correct for `/learn`**. It
  must not be copied into BoardScore, which is a "here is your board exam
  outcome" surface, not a browse/upsell surface — showing a subject the
  student never elected as a "prediction" is a credibility problem, not an
  upsell opportunity.
- **Dashboard preferred-subject / subject switcher**: reads/writes through
  `/api/student/preferences` (§1.2), i.e. the same governed `selected_subjects`.

This confirms `selected_subjects` is not just "technically available" — it is
already the product's existing, user-facing concept of "my subjects" for the
one surface (onboarding + dashboard switcher) that asks the question. BoardScore
should consume the same answer, not invent a second one.

## 3. `cbse_chapter_weights` grade scope — confirmed intentional, not a gap

`supabase/migrations/20260628000000_board_score_v1.sql` seed data: only
`grade='10'` (`math`, `science`, `social_science` — see §5 naming flag,
`english`) and `grade='12'` (`math`, `physics`, `chemistry`, `biology`,
`english`) rows exist. Table comment: "CBSE official chapter-level mark
allocation per board/grade/subject." Grades 10 and 12 are exactly CBSE's two
board-exam years (Class X, Class XII); grades 6-9 and 11 have no board exam
and structurally cannot have an official CBSE mark-allocation scheme to seed.

**Conclusion: this is intentional product scope (BoardScore = board-exam-year
predictor), not a missing-data bug.** No action needed on grade scope. (It is
separately true that even within 10/12 the *subject* coverage is incomplete —
no `hindi`, no commerce/humanities electives yet — but that's a content-gap
backlog item for whoever owns `cbse_chapter_weights` seeding, not something
this spec should conflate with the subject-scoping defect.)

## 4. Correct subject-scoping rule

Replace `getActiveSubjectsForGrade(grade)` with a per-student function. Exact
contract:

```ts
/**
 * Returns the subject_codes BoardScore should compute for THIS student —
 * the intersection of (a) what the student actually chose, (b) subjects
 * CBSE examines at a board level (cbse_core / cbse_elective, never
 * platform_elective — see §5), and (c) subjects this grade has official
 * CBSE mark-allocation data for (cbse_chapter_weights).
 *
 * Returns [] (not "all subjects") when the student has not yet selected
 * any subjects — BoardScore stays empty/"no data yet" until they do. Never
 * falls back to a broader set.
 */
async function getStudentBoardSubjects(
  studentId: string,
  grade: string,
): Promise<string[]> {
  // 1. The student's own elected subjects — the only legitimate input.
  const { data: studentRow, error: sErr } = await supabaseAdmin
    .from('students')
    .select('selected_subjects')
    .eq('id', studentId)
    .single();
  if (sErr || !studentRow) return [];
  const elected = (studentRow.selected_subjects ?? []) as string[];
  if (elected.length === 0) return [];

  // 2. Keep only subjects CBSE actually examines at board level.
  const { data: subjectRows } = await supabaseAdmin
    .from('subjects')
    .select('code')
    .in('code', elected)
    .in('subject_kind', ['cbse_core', 'cbse_elective']); // NEVER platform_elective
  const boardEligible = new Set((subjectRows ?? []).map((r) => r.code));
  if (boardEligible.size === 0) return [];

  // 3. Intersect with subjects that have active CBSE weight data at this grade
  //    (this is what makes compute() succeed instead of 422ing on "no weights").
  const { data: weightRows } = await supabaseAdmin
    .from('cbse_chapter_weights')
    .select('subject_code')
    .eq('board', 'CBSE')
    .eq('grade', grade)
    .eq('is_active', true)
    .in('subject_code', [...boardEligible]);

  const seen = new Set<string>();
  for (const row of weightRows ?? []) seen.add(row.subject_code as string);
  return [...seen];
}
```

Call site change in `apps/host/src/app/api/cron/board-score/route.ts`: the
per-grade cache (`subjectsByGrade: Map<string, string[]>`) must become
per-student (`Map<studentId, string[]>` or simply inline, since there is no
cross-student reuse once the query is student-scoped) — cache by grade alone
is no longer valid because different students in the same grade now get
different subject lists. Replace the `getActiveSubjectsForGrade(grade)` call
at line 237 with `getStudentBoardSubjects(studentId, grade)`.

### On "no clean elected-subjects data" — explicitly not the case here
The instruction asked me to say plainly if no such data source exists. It
does exist and is exactly what's needed: `students.selected_subjects` is
real, explicit (not inferred), governed (grade/stream/plan-validated at
write time by `set_student_subjects`), and already the product's own
definition of "my subjects" used at onboarding and in the dashboard
switcher. No invented heuristic is required.

The one real gap is **coverage**, not existence: students who signed up
before the onboarding subjects step existed, or who skip/abandon onboarding,
can have `selected_subjects = '{}'` or `NULL`. For those students the
correct behavior is §4's `[]` return — **no BoardScore, not "all subjects
as a fallback."** An empty BoardScore with the existing "No Data Yet" widget
state (`BoardScoreWidget.tsx` lines 251-274, already implemented) is the
correct, honest UI for "you haven't told us your subjects yet" — it must not
regress to showing everything, which is the exact bug being fixed. If product
later wants to nudge these students, that's a "prompt them to complete the
subjects step" intervention, not a BoardScore fallback.

## 5. `platform_elective` position: BoardScore must never show it

Verified `subjects.subject_kind` seed
(`supabase/migrations/_legacy/timestamped/20260415000004_subject_governance_seed.sql`):
`cbse_core` = math/science/english/hindi/social_studies/physics/chemistry/
biology/economics/accountancy/business_studies/history_sr/geography/
political_science; `cbse_elective` = computer_science, sanskrit; `platform_elective`
= **`coding`** only (currently the sole member of that kind).

**Position: BoardScore shows `cbse_core` and `cbse_elective` subjects only,
never `platform_elective`.** Justification: BoardScore's entire premise is
"predicted CBSE board exam score." `coding` is Alfanumrik's own supplementary
gamified subject — CBSE does not set a board exam for it, there is and can be
no official `cbse_chapter_weights` mark allocation for it, and showing a
"predicted board score" for a subject that has no board exam is a factual
claim the product cannot back up. This is enforced two ways in §4's query,
defense-in-depth:
1. Structurally: `cbse_chapter_weights` will in practice never carry
   `platform_elective` rows (no CBSE marking scheme exists to seed).
2. Explicitly: step 2 of `getStudentBoardSubjects` filters
   `subject_kind IN ('cbse_core','cbse_elective')` even if a future
   content-manager mistakenly seeds weights for a platform subject.

### Data-quality blocker to flag before/alongside this ships
`cbse_chapter_weights` seeds the grade-10 Social Studies row as
`subject_code = 'social_science'`
(`supabase/migrations/20260628000000_board_score_v1.sql:259-278`), but the
canonical code everywhere else in the platform — `subjects.code`,
`grade_subject_map`, `student_subject_enrollment`, `students.selected_subjects`,
`get_available_subjects` — is `'social_studies'`
(confirmed via grep across the baseline migration; `social_studies` appears
in ~10 other functions/mappings, `social_science` appears nowhere else).
**Left as-is, §4's step-3 intersection will silently drop grade-10 Social
Studies for every student, even one who correctly selected `social_studies`**,
because the string never matches. This is a one-row data fix
(`UPDATE cbse_chapter_weights SET subject_code = 'social_studies' WHERE
subject_code = 'social_science'`) but it is a **prerequisite for this spec's
grade-10 SST coverage to work at all** — flagging for backend/whoever owns
the `cbse_chapter_weights` seed (likely bundled with the Bug 1 fix batch,
since both touch the same table) so it isn't shipped as a second silent gap
disguised as "fixed."

## 6. P1 confirmation — scoring formula is untouched

This spec changes **which `(student_id, subject_code)` pairs** get passed
into `computeBoardScore()`'s `compute` action. It does not touch, and backend
must not touch as part of this change:
- The chapter-weighted formula itself (`effective_mastery × marks_allocated`
  summed across chapters, `supabase/functions/board-score/index.ts:215-255`).
- Retention decay (`computeRetention`, lines 102-112).
- Confidence band widening logic (lines 260-263).
- Chapter status thresholds (`classifyMastery`, lines 114-119).
- The `board_score_predictions` upsert shape or the `get` action's response
  shape.

This is a **subject-scoping fix (WHICH subjects), not a scoring-formula
change (HOW a subject's score is calculated)** — it does not touch P1
(`score_percent = Math.round((correct/total)*100)`, quiz scoring) at all;
BoardScore has its own separate, documented formula that P1 does not govern.
Flagging explicitly per the task instruction, and because `computeBoardScore()`
sitting in the same file as the fix is exactly the kind of adjacent code a
diff could accidentally touch — it must not.

## 7. Two more call sites that need the same rule (found during investigation, in scope)

### 7.1 `POST /api/board-score` (on-demand compute) has no subject ownership check
`apps/host/src/app/api/board-score/route.ts:151-238`. Accepts any
`subject_code` string (only length/type validated, not membership) from the
authenticated student's own request body and forwards it straight to the
Edge Function's `compute` action with a service-role token. A student (or a
client bug, or a stale cached tab) can currently trigger a BoardScore
compute — and therefore a persisted, displayed prediction — for a subject
they never selected and may not even be eligible for at their grade/stream.
This must be closed in the same change, or the widget-visible symptom comes
right back through the on-demand path even after the cron is fixed.

**Required fix**: before forwarding to the Edge Function, validate
`subjectCode ∈ getStudentBoardSubjects(studentId, grade)` (§4's function,
reused, not reimplemented). If not a member, return `422
{ error: 'subject_not_eligible' }` and do not call the Edge Function.

### 7.2 `GET /api/board-score` / Edge Function `get` action should defensively filter, not just trust upstream cleanliness
`supabase/functions/board-score/index.ts:360-399` (`getBoardScores`) returns
every `board_score_predictions` row for the student with no subject-kind
filter. Once §4 and §7.1 ship, new rows can only ever be `cbse_core`/
`cbse_elective` subjects the student selected — but **existing rows computed
under the old broad logic will still be sitting in `board_score_predictions`**
and will keep being served (and shown as tabs) until naturally overwritten by
the next nightly run for that `(student, subject, grade)` key, which for a
never-selected subject may never happen again. Two actions required, both in
scope for this spec (data cleanup, not a formula/logic change):
1. **One-time cleanup migration**: `DELETE FROM board_score_predictions bsp
   WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id = bsp.student_id AND
   bsp.subject_code = ANY(COALESCE(s.selected_subjects, '{}')))` — removes
   every stale over-broad row in one pass. Run once, after §4/§5's code ships
   (so it doesn't delete rows the next cron run would recreate correctly).
2. **Defensive filter in `getBoardScores`** (belt-and-suspenders, matches
   §5's defense-in-depth posture): join `subjects` and exclude
   `subject_kind = 'platform_elective'` even if a stray row exists.
   Filtering by `selected_subjects` membership inside the `get` action itself
   is optional given the cleanup migration, but recommended for future-proofing
   against any other write path that might reintroduce a stale row.

## 8. Acceptance criteria (for backend + testing)

1. `getActiveSubjectsForGrade(grade)` in
   `apps/host/src/app/api/cron/board-score/route.ts` is replaced by
   `getStudentBoardSubjects(studentId, grade)` implementing exactly the
   3-step query in §4 (elected → board-eligible kind → has weights).
2. A student with `selected_subjects = ['math']` at grade 10 gets exactly one
   `board_score_predictions` row (`math`) from the nightly cron — never
   `science`, `social_studies`, or `english` even though those have
   `cbse_chapter_weights` rows at grade 10.
3. A student with `selected_subjects = []` or `NULL` gets **zero**
   `board_score_predictions` rows from the cron (no fallback to "all
   subjects for grade"). Widget shows the existing "No Data Yet" state.
4. A student who has `coding` in `selected_subjects` (grade 9-12, `unlimited`
   plan) never gets a `coding` BoardScore row, even though `coding` may be in
   their `selected_subjects` array (it's a legitimate platform pick — just
   not a board-exam subject). Verify via a `subject_kind` join, not by
   assuming `coding` will never appear in `cbse_chapter_weights`.
5. `POST /api/board-score` returns `422 { error: 'subject_not_eligible' }`
   and makes zero Edge Function calls when `subject_code` is not in the
   requesting student's `getStudentBoardSubjects(studentId, grade)` result —
   including subjects that exist in `cbse_chapter_weights` for that grade but
   that this specific student never selected.
6. `cbse_chapter_weights` grade-10 Social Studies rows have
   `subject_code = 'social_studies'` (not `'social_science'`) — required for
   a student who selected `social_studies` to ever receive a grade-10 SST
   BoardScore. Test: a grade-10 student with `selected_subjects =
   ['social_studies']` gets a `social_studies` BoardScore row after `compute`
   is called for it.
7. One-time cleanup migration removes all pre-existing
   `board_score_predictions` rows whose `subject_code` is not in that
   student's current `selected_subjects` — run and verified with a
   before/after row-count assertion in a migration test.
8. `computeBoardScore()`'s formula, `computeRetention()`, `classifyMastery()`,
   confidence-band widening, and the `board_score_predictions` /
   `get`-response shapes are byte-for-byte unchanged — diffed explicitly in
   review, not just "tests still pass" (tests may not exercise every branch).
9. `BoardScoreWidget.tsx` requires **no changes** — it already renders
   whatever `GET /api/board-score` returns with no client-side filtering; once
   the server-side scoping (§4, §7) is correct, the widget is correct for
   free. If a widget change is proposed alongside this spec, that's a scope
   creep signal — flag it back to assessment before merging.

## 9. Review chain

Per `.claude/CLAUDE.md` P14 matrix, this is an "Anti-cheat thresholds"-adjacent
/ "Learner-state rules"-adjacent change made by assessment defining behavior
for backend to implement — required reviewers before merge: **testing**
(acceptance criteria → test cases), **frontend** (confirm §8 item 9 — no
widget change needed), and **architect** (the `cbse_chapter_weights` seed
correction in §5/§8-item-6 touches a migration; also worth a quick RLS sanity
check on `student_subject_enrollment`'s `sse_read_own` policy, which compares
`student_id = auth.uid()` — `student_id` there is `students.id`, not
`auth_user_id`; not blocking for this spec since the cron reads via
service-role and bypasses RLS, but noted for architect as a possible existing
RLS defect unrelated to this fix).
