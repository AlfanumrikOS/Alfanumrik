# 12 — Business Workflow Validation (Phase 2, 2026-07-02)

Read-only. This agent writes only this file. J-1 is reproduced from
`00-orchestrator-salvage.md` (already investigated by a prior child run) —
not re-investigated here. J-2 through J-5 are original work for this pass.

---

## J-1: Journey walk-throughs (reproduced from salvage notes)

STATUS: done (reproduced, not re-investigated, per instructions)

Source: `docs/audit/2026-07-02-validation/00-orchestrator-salvage.md` §"Business-workflow
journeys (salvaged from J-1 child)". Re-confirmed the one load-bearing citation
(rhythm/today surrogate-id bug) by direct read; did not re-open Foxy/Dive/Synthesis/
Leaderboard source files.

| Journey | Verdict | Evidence |
|---|---|---|
| S2 Daily Rhythm | **BROKEN** | `src/app/api/rhythm/today/route.ts:210` — `.eq('id', userId)` against `students`, where `userId` is `auth.uid()` and `students.id` is a `uuid_generate_v4()` surrogate key, not the auth uid. Every real student's row lookup returns no match → route 404s `no_student_profile`. Re-confirmed directly in this pass (re-read lines 190-350): line 210 is exactly `.eq('id', userId).maybeSingle()`, and the two downstream RPC calls at line 276 (`get_due_reviews`, `p_student_id: userId`) and line 345 (`get_adaptive_questions`, `p_student_id: userId`) repeat the same auth-uid-for-surrogate-id substitution — these are masked by the line-210 bug today but must be fixed in the same change since both RPCs are documented (elsewhere in the codebase) as surrogate-key-only, no dual-key `OR auth_user_id=` fallback. **Net effect: the Daily Rhythm queue is dark for every student whenever `ff_pedagogy_v2_daily_rhythm` is ON.** This is the same bug class as the pre-existing synthesis/state bug fixed in commit `ce893460` (auth-uid-vs-surrogate-id confusion), recurring at a different call site. |
| S4 Foxy Tutoring | INTACT | `src/app/api/foxy/route.ts` — `authorizeRequest` + `studentId` resolution correct. Quota enforcement uses `check_and_record_usage`, a distinct mechanism from `checkPlanGate`/`checkPlanGateEffective` used elsewhere — noted as a mechanism difference, not a defect (both are legitimate quota primitives; nothing indicates one is stale or bypassed). |
| S5 Weekly Dive | INTACT | All 4 routes (`src/app/api/dive/{state,start,artifact,history}/route.ts`) resolve the student surrogate id correctly — same defensive pattern the ce893460 fix commit message claims ("same pattern as dive"), independently verified true rather than taken on faith. |
| S6 Monthly Synthesis | INTACT | The 2026-07-02 fix (same day as this audit) is present and correct in `src/app/api/synthesis/state/route.ts`; the parent-share ownership check in `src/app/api/synthesis/parent-share/route.ts` is independent of the state route and is itself correct. |
| S7 Leaderboard | INTACT, with dead-weight | `src/app/leaderboard/page.tsx:168-239` (file is 1223 lines total, confirmed present in this pass) performs a client-side re-aggregation of leaderboard rows that is redundant given the data is already server-computed/RLS-safe — the same anti-pattern class flagged for `ProgressSnapshot.tsx` in discovery ch.07 §1.7/§4 item 3 (client-side aggregation where a DB query should be authoritative). Not a correctness bug (the client recompute agrees with the server value, it's just wasted work / a future drift risk), filed as an S3-class cleanup item, not a defect. |

**Root hazard (carried forward from salvage notes, restated here because it frames J-5 below too):** the codebase has two coexisting RPC/query conventions — dual-key-tolerant (`WHERE id = p_student_id OR auth_user_id = p_student_id`, e.g. `get_available_subjects[/_v2]`, `available_chapters_for_student_subject_v2`) vs. surrogate-only (`get_due_reviews`, `get_adaptive_questions`, the raw `students` table query in rhythm/today). Every future route written against `students`/student-scoped RPCs must know which convention the target expects; there is no type-level or naming guard that prevents the mistake. Recommended Phase 3 remediation: make the two strict RPCs dual-key (matching the tolerant convention) in addition to fixing rhythm/today's direct query.

---

## J-2: E2E coverage matrix

STATUS: done

Method: enumerated every `e2e/**/*.spec.ts` (34 files — 28 top-level + 6 under
`e2e/grounding/` + 1 under `e2e/synthetic/`; discovery ch.07 counted "29 files,"
undercounting because its filename check only globbed the top level and missed
the `e2e/grounding/` subdirectory of 6 Foxy/quiz specs), read each file's
`test.describe(...)` headers (and, for the ambiguous ones, the actual test
bodies) rather than trusting filenames alone, and cross-checked content-level
string search for `/leaderboard`, `/dive`, `/rhythm`, `parent/reports`,
`grade-book` across the whole directory (not just filenames) to catch
coverage hiding under a differently-named spec.

### Coverage table (canonical journey → spec(s) → verdict)

| Journey | Spec(s) | Verdict |
|---|---|---|
| S1 Signup/Verify/Onboard (3 roles) | `auth-onboarding-3role.spec.ts`, `auth-onboarding-p15.spec.ts`, `auth-flow.spec.ts` | **COVERED** |
| S2 Daily Rhythm queue | none | **NOT COVERED** — confirmed. See naming-collision note below: `today-home.spec.ts` tests the unrelated `/today` "Consumer Minimalism Wave A" home surface (BFF `/api/v2/today`), not the Pedagogy v2 daily-rhythm queue (`/api/rhythm/today`, `DailyRhythmQueue.tsx`). A future reader skimming filenames could mistake one for the other; they share no code path. |
| S3 Quiz (score/XP/anti-cheat) | `quiz-happy-path.spec.ts`, `e2e/grounding/quiz-enforced-pair.spec.ts` | **COVERED** |
| S4 Foxy tutoring — rendering/RAG-safety | `foxy-structured-rendering.spec.ts`, `e2e/grounding/foxy-grounded.spec.ts`, `e2e/grounding/foxy-hard-abstain.spec.ts`, `e2e/grounding/foxy-unverified.spec.ts` | **PARTIALLY COVERED** — ch.07 undercounted (missed the 3 `grounding/foxy-*` specs entirely). Real coverage exists for structured-payload rendering, Hindi chrome, and the 3 RAG-confidence banner states (grounded/hard-abstain/unverified — P12-adjacent AI-safety surface). |
| S4 Foxy — 7-mode matrix (`learn/explain/practice/revise/doubt/homework/explorer`) | none | **NOT COVERED** — confirmed. No spec parametrizes over `mode`; every Foxy spec exercises the default/grounding path only. ch.07's core claim survives even after finding the extra grounding specs. |
| S5 Weekly Dive | none | **NOT COVERED** — confirmed. Zero filename or in-content hits for `/dive` anywhere in `e2e/`. |
| S6 Monthly Synthesis | `monthly-synthesis.spec.ts` | **COVERED** (student-side ritual render + lazy summary fill); test 1 also asserts the parent-share card renders on `/synthesis`, giving partial indirect coverage of the parent-share *affordance* (not the parent-side consumption). |
| S7 Leaderboard | `public-pages.spec.ts` (line ~128, `PROTECTED_ROUTES` array) | **NOT FUNCTIONALLY COVERED** — confirmed. The only `/leaderboard` reference anywhere in `e2e/` is an unauthenticated-redirect assertion (`page.goto('/leaderboard')` → expect redirect to `/welcome`\|`/login`). No test ever logs in and asserts rank/XP data, so the client-side re-aggregation dead-weight flagged in J-1 (S7) is completely untested by E2E. |
| S8 Subscription purchase | `payment-checkout.spec.ts`, `payment-ops.spec.ts` | **COVERED** |
| Parent — link child / view progress | none dedicated | **NOT COVERED** |
| Parent — reports | `navigation.spec.ts` (`/parent/reports redirects to parent login`) | **NOT FUNCTIONALLY COVERED** — confirmed. Same pattern as leaderboard: only an unauthenticated-redirect smoke check, no logged-in parent ever views a report. |
| Parent — synthesis-share | (see S6 above — indirect only) | **NOT FUNCTIONALLY COVERED from the parent side** |
| Parent — billing | `payment-ops.spec.ts` (generic payment ops, not parent-scoped) | **NOT COVERED** (parent-specific) |
| Teacher — onboarding/classes/roster | none dedicated | **NOT COVERED** |
| Teacher — at-risk alerts / Loop A-C remediation assign | `teacher-remediation-spine.spec.ts` | **COVERED** (this is the adaptive-remediation "assignment," i.e. `adaptive_interventions` rows — a different feature from the grade-book "assignments" page below, despite the shared word) |
| Teacher — assignments / worksheets pages (`src/app/teacher/assignments`, `.../worksheets`) | none | **NOT COVERED** — confirmed. `teacher-remediation-spine.spec.ts` is the only spec matching `assignment`, and it is about adaptive-intervention assignment, not the teacher-authored assignments/worksheets CMS pages. |
| Teacher — grade book (`src/app/teacher/grade-book`) | none | **NOT COVERED** — confirmed. No filename or content hit for `grade-book`/`gradebook` anywhere in `e2e/`. |
| School-admin — Pulse | `pulse-rls.spec.ts` | **COVERED** (RLS boundary focus) |
| School-admin — portal/landing | `school-admin.spec.ts` | **PARTIAL** — 4 `describe` blocks are all auth-guard / landing-page / API-health level (`School Admin Portal — Auth Guards`, `Schools Landing Page`, `School Admin API — Health`, `Unknown Subdomain`); no functional in-portal journey (e.g. viewing a class roster) is exercised. |
| Internal/Super-admin — subject governance | `subject-governance.spec.ts` | **COVERED** |
| Internal/Super-admin — strategic reporting | `strategic-reports.spec.ts` | **COVERED** |
| Internal/Super-admin — control room dashboard | `control-room-refactor.spec.ts` | **COVERED** |
| Internal/Super-admin — student impersonation (support tool) | `student-impersonation.spec.ts` | **COVERED** (entry points only, per describe name) |
| Internal/Super-admin — bulk actions | `bulk-actions.spec.ts` | **COVERED** |
| Internal/Super-admin — observability | `observability-rules.spec.ts`, `observability-timeline.spec.ts` | **COVERED** |
| Cross-cutting — account deletion (DPDP §17) | `account-deletion-flow.spec.ts` | **COVERED** (frontend flow only, per describe name) |
| Cross-cutting — AlfaBot landing widget (marketing AI surface, distinct from Foxy) | `alfabot.spec.ts` (10 describe blocks: launcher, open/close, audience switching, streaming, rate limit, bilingual nudge, escape key, FAQ deep link, lead capture, viewport) | **COVERED** — thorough, but this is REG-65..68's surface, not a journey ch.07 listed; noted for completeness since it's easy to confuse with Foxy coverage. |
| Cross-cutting — smoke/health/nav/a11y/SEO/welcome | `smoke.spec.ts`, `api-health.spec.ts`, `navigation.spec.ts`, `accessibility.spec.ts`, `landing-seo.spec.ts`, `welcome-landing.spec.ts`, `welcome-v2.spec.ts`, `public-pages.spec.ts`, `refresh-page.spec.ts`, `e2e/synthetic/prod-health.spec.ts` | **COVERED** (infrastructure-level, not journey-level) |

### Verdict on ch.07's claim
**CONFIRMED for 5 of 6 named gaps, with one correction.** Weekly dive,
leaderboard (functional), parent reports (functional), daily-rhythm queue,
and teacher grade-book all have zero E2E coverage as ch.07 stated. The
correction: ch.07's Foxy-mode-matrix claim is still true (no mode
parametrization exists), but ch.07 undercounted Foxy coverage overall — it
missed 3 real `e2e/grounding/foxy-*.spec.ts` specs covering the RAG
grounding/safety banner states, because its filename check did not descend
into the `grounding/` subdirectory. Net: ch.07's headline gap list stands;
its "no `foxy*.spec.ts` beyond structured-rendering" sub-claim was wrong in
degree (real safety coverage exists) but not in kind (no mode-matrix test).

### Secondary finding: CI-reachability caveat on 2 specs
`today-home.spec.ts` and `teacher-remediation-spine.spec.ts` gate their
logged-in-state assertions behind `test.fixme(!hasRealStudentCreds(), ...)`
(4 occurrences total). Per the in-file comment (`today-home.spec.ts:24-33`),
these assertions only run once `TEST_STUDENT_EMAIL`/`PASSWORD` fixtures are
wired into CI — until then the deepest assertions in those two files are
skipped, not failing-green. This does not change any verdict above (neither
file was cited as covering a gap-journey) but is a relevant caveat for
reading "file exists" as "assertions execute in CI."

---

## J-3: Anti-cheat intended-behavior brief (for CEO ruling)

STATUS: done

Purpose: lay out precisely what the code does today on each of the 3 anti-cheat
checks, client and server separately, with file:line, then contrast with the
written product-invariant wording. **No verdict is rendered here** — this is
input for a CEO ruling on which of two candidate intended-behaviors is correct
going forward.

### What the code actually does today

**Client-side (`src/app/quiz/page.tsx:927-970`)** — all three checks are
**advisory-only**. Each one does `console.warn(...)` and nothing else; the
submission always proceeds to `submitQuizResults()` regardless of outcome.
This is explicitly documented in a code comment (lines 927-937) as the
"SLC-5 convergence": *"the client is NOT a security boundary (P3/P9)... It
must NEVER discard the attempt or override the score to 0 — doing so
silently destroyed a legitimately fast/edge-case student's work and
recorded NO session."*

| Check | Client location | Condition | Client action |
|---|---|---|---|
| 1. Speed | `:945-951` | `totalResponses > 0 && (timer/totalResponses) < 3` | `console.warn` only; submit proceeds |
| 2. Pattern | `:954-962` | `mcqResponses.length > 3 && maxSameOption === mcqResponses.length` (MCQ-only, blanks/`selected_option === -1` excluded from both numerator and the `mcqResponses` denominator) | `console.warn` only; submit proceeds |
| 3. Count | `:964-970` | `allResponses.length !== questions.length` | `console.warn` only; submit proceeds |

**Server-side, v2 path (`supabase/migrations/20260622030000_submit_quiz_v2_resilient_mastery_perform.sql`)** —
directly re-read in this pass (not taken from the api-contract audit's word):

| Check | Server location | Condition | Server action |
|---|---|---|---|
| 1. Speed | `:228-232` | `v_avg_time := p_time / v_total; v_avg_time < 3.0` | `v_flagged := true` |
| 2. Pattern | `:234-243` | `v_total > 3 AND v_max_same_answer = v_total`, where `v_answer_counts` only increments for `v_selected_displayed BETWEEN 0 AND 3` (i.e. a valid MCQ click) but `v_total` counts **every** submitted response including blanks | `v_flagged := true` |
| 3. Count | `:245-248` | `jsonb_array_length(p_responses) <> v_total` | `v_flagged := true` |
| Effect of any flag | `:253-260` | `IF v_flagged THEN v_xp := 0` | Session is still INSERTed with the real `score_percent`; only XP is zeroed |

**Independently confirmed (re-derived from the function body, not just cited)**:
- **Check 3 is a tautological dead no-op.** `v_total` is incremented once per
  loop iteration over `jsonb_array_elements(p_responses)` (`:174-180`, the
  first-pass loop) — i.e. `v_total` **is** `jsonb_array_length(p_responses)` by
  construction. The condition at `:246` therefore compares a value to itself
  and can never be true. This corroborates `11-api-contracts.md`'s C-6 finding
  independently, from the raw SQL rather than the prior audit's word.
- **Check 2 has a real blind spot, not a hypothetical one.** `v_answer_counts`
  only tallies valid MCQ selections (`0..3`); any blank/skipped response
  (`selected_displayed_index` outside `0..3`, e.g. `-1` or `null` for a
  short-answer/long-answer item) is excluded from the count array but is
  still counted in `v_total`. Concrete failure case: a 5-question quiz where a
  student selects option 0 on all 4 MCQ items and leaves the 5th blank —
  `v_max_same_answer = 4`, `v_total = 5`, `4 <> 5` so the check does **not**
  fire, even though the student answered identically on every question they
  actually attempted. This corroborates C-6's second finding.
- **Server-side v1 path is byte-identical to v2 on all 3 checks** (see J-5
  below for the full v1 body read) — same three conditions, same tautological
  Check 3, same Check-2 blind spot, at
  `supabase/migrations/00000000000000_baseline_from_prod.sql:7380-7397`. Anti-cheat
  behavior does not drift between v1/v2 even though scoring integrity does
  (J-5).

### Contrast with written product-invariant wording

Two documents describe anti-cheat and neither matches the code's actual
consequence:

1. **`.claude/CLAUDE.md` P3** (as loaded in this session): *"Three checks,
   client-side and server-side: (1) minimum 3s avg per question, (2) not all
   same answer index if >3 questions, (3) response count equals question
   count."* This text lists the three conditions but is **silent on
   consequence** — it does not itself say "reject." (This is a correction to
   ch.07's paraphrase, which characterized CLAUDE.md as saying "Reject" — the
   loaded constitution text does not use that word for P3.)
2. **`.claude/skills/quiz-integrity/SKILL.md:47-53`** (`Invariant 4:
   Anti-Cheat`) is the document that actually asserts a hard-reject
   consequence, explicitly, in a table:
   ```
   | Check   | Condition                                          | Result |
   | Speed   | totalTimeSeconds / totalQuestions < 3              | Reject |
   | Pattern | Set(indices).size === 1 && questions.length > 3    | Flag   |
   | Count   | responses.length !== questions.length              | Reject |
   ```
   This directly contradicts the implemented behavior: Speed and Count are
   documented as **Reject** but are implemented as **flag + zero-XP + still
   record the session** on both client and server. Only Pattern's documented
   "Flag" matches the implementation. This is a real, verifiable doc/code
   drift in the skill file, not a paraphrase error.

### Two candidate intended-behavior interpretations (no verdict — for CEO ruling)

**Interpretation A — "Flag is correct; the docs are stale."** The in-code
comment at `quiz/page.tsx:927-937` frames flag-not-reject as a deliberate,
already-shipped design decision (the "SLC-5 convergence"), with an explicit
rationale: a hard reject previously destroyed legitimate students' work
(fast readers, students who happened to pick the same true/false pattern on
a short quiz) and recorded zero session data for them, which is worse for
both the student (lost effort, no XP path even if later verified legitimate)
and the business (zero forensic trail on a rejected attempt). Under this
interpretation, the constitution and skill-file wording should be updated
to read "flag + zero XP, session still recorded" for Speed and Count, matching
what Pattern already documents correctly. This also implies Check 3 being a
dead no-op is low-priority to fix (it never distinguishes anything useful
since `v_total` is always the request's own length) — the real remaining
work is the Check 2 blind spot and, if desired, an actual reject path added
back for provably-automated abuse (which does not exist today in any form).

**Interpretation B — "Reject is correct; the code under-delivers on P3."**
The constitution's product-invariant is the authoritative contract; "reject"
in the anti-cheat sense could mean something more specific than "discard the
attempt and record nothing" — e.g., a genuine reject could mean "the server
returns an error and the client must NOT display a completed/scored quiz
screen," while still logging the raw attempt server-side for forensics
(different from the pre-SLC-5 behavior the code comment says was rejected).
Under this interpretation, today's implementation is a bug: an admittedly
cheating pattern (all-same-answer with 3 blanks, or count mismatch on every
submission) still shows the student a real score and a "quiz complete" UX,
merely denying XP — which a determined or confused user may not even notice,
undermining the deterrent value "reject" is supposed to have. This
interpretation would treat the flag-not-reject SLC-5 change itself as the
regression to fix, not the docs.

**What is NOT ambiguous, regardless of which interpretation is chosen:**
(a) Check 3 (`jsonb_array_length(p_responses) <> v_total`) is dead code today
in both v1 and v2 and provides zero actual protection — it should either be
rewritten against a value that isn't circularly derived from `p_responses`
itself (e.g. compare against the question count recorded by
`start_quiz_session`/`quiz_session_shuffles`) or explicitly removed and
documented as intentionally superseded by the snapshot-ownership check;
(b) Check 2's denominator should almost certainly be `mcqResponses.length`
(the count of valid, non-blank MCQ selections) rather than `v_total`
(all responses including blanks), to close the blind spot, independent of
the reject-vs-flag question.

---

## J-4: ch.07 specifics validation

STATUS: done

### 4a. Knowledge-gap `>` vs `>=` banding mismatch

- **Spec side**: `.claude/skills/cbse-learning-rules` / assessment convention
  (per ch.07 §1.7 and §4 item 4) documents `confidence_score >= 0.7` →
  `critical`, `>= 0.4` → `high`, else `medium`.
- **Code side**: `src/app/progress/page.tsx:466` — directly re-read in this
  pass:
  ```
  severity: (g.confidence_score ?? 0) > 0.7 ? 'critical' : (g.confidence_score ?? 0) > 0.4 ? 'high' : 'medium',
  ```
  Confirmed **strict `>`**, not `>=`, on both thresholds.
- **Who experiences it**: any student whose knowledge-gap row has
  `confidence_score` exactly `0.7` or exactly `0.4` (a plausible, not edge-only,
  value — `confidence_score` is very likely computed as a ratio/probability
  that can land on clean fractions, e.g. 7/10 or 2/5 correct on the diagnostic
  signal feeding this field). Those students see their gap classified one
  severity band lower than intended (`0.7` renders as `high` instead of
  `critical`; `0.4` renders as `medium` instead of `high`) — the gap looks
  less urgent than the spec intends, which is directionally the WORSE failure
  mode for an at-risk-detection UI (under-alarming, not over-alarming).
- **Verdict**: CONFIRMED, exactly as ch.07 stated. Low-blast-radius (boundary
  value only, one component) but real and student-facing.

### 4b. `ProgressSnapshot.tsx` client-side aggregation vs server

- **Code**: `src/components/dashboard/ProgressSnapshot.tsx:37-53` — directly
  re-read in this pass. On mount, fetches
  `performance_scores.overall_score` rows (`.eq('student_id', student.id)`,
  no aggregation in the query) then computes
  `avg = data.reduce((sum, row) => sum + Number(row.overall_score || 0), 0) / data.length`
  client-side (`:44-47`) to produce the single headline "Performance Score"
  number shown on the dashboard.
- **Does it disagree with the server?** No server-computed equivalent exists
  to disagree with. Checked the two other server/route-level readers of
  `performance_scores`: `src/app/api/v2/student/progress/route.ts:52-84`
  returns the raw **per-subject** rows (mobile/API contract payload) with no
  averaging step; `src/app/parent/reports/page.tsx:1556-1594` and
  `src/app/parent/page.tsx:477-490` also fetch and display raw per-subject
  rows, never an average. So `ProgressSnapshot.tsx` is the **only** place in
  the codebase that computes this particular aggregate — there is no
  authoritative source to drift from today.
- **Why this still matters**: exactly the anti-pattern the Scorecard
  Sourcing invariant (ch.07 §1.7) warns against — "progress metrics must
  come from database queries, not client-side aggregation" — applied to a
  headline number nothing else double-checks. If a second surface (e.g. a
  future parent-facing "overall score" widget, or a super-admin report) ever
  computes the same average with slightly different logic (weighted by
  recency, excluding zero-scores, etc.), the two numbers would silently
  diverge with no test or server contract to catch it. This is a **latent**
  drift risk, not a **live** one today — a distinction ch.07 did not fully
  make (it flagged the pattern but did not check whether a second
  independent computation currently exists; it does not).
- **Verdict**: CONFIRMED the pattern (client-side aggregation exists exactly
  as described), REFINED the framing (no active client/server disagreement
  today because no server aggregate exists to disagree with; risk is future
  drift between two future client computations, or a future server addition
  that doesn't match this one).

### 4c. Three day-boundary clock conventions

Three call sites, read directly in this pass:

1. **XP daily cap — explicit IST.**
   `supabase/migrations/20260623000600_fix_atomic_quiz_reference_id_on_conflict_42p10.sql:78-85`:
   ```sql
   WHERE student_id = p_student_id AND daily_category = 'quiz'
     AND created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')
   ```
   Explicitly casts to Indian Standard Time. The 200 XP/day quiz cap resets
   at IST midnight.

2. **Monthly synthesis — plain UTC.**
   `src/lib/learn/monthly-synthesis-orchestrator.ts:76-87` (`monthBoundariesOf`)
   computes month start/end using plain UTC month arithmetic, no timezone
   parameter. Confirmed via ch.07's citation; not re-opened line-by-line in
   this pass since the UTC-vs-IST distinction is unambiguous from the
   function's own doc comment (no `AT TIME ZONE` anywhere, per ch.07 §1.15).
   This one is plausibly **intentional** — a monthly synthesis ritual
   genuinely wants a stable calendar-month boundary and IST vs UTC only
   shifts the edges by 5.5 hours out of a ~30-day window, unlikely to be
   user-visible.

3. **Streak-day comparison — implicit, NOT IST-cast.**
   `supabase/migrations/20260623000600_fix_atomic_quiz_reference_id_on_conflict_42p10.sql:213-222`
   (`atomic_quiz_profile_update`, ~130 lines below the IST-cast XP-cap code
   in the SAME function):
   ```sql
   UPDATE public.students SET
     last_active = NOW(),
     streak_days = CASE
       WHEN last_active::date = CURRENT_DATE     THEN COALESCE(streak_days, 1)
       WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
       ELSE 1
     END
   WHERE id = p_student_id;
   ```
   `CURRENT_DATE` here has **no** `AT TIME ZONE` cast, so it resolves in
   whatever timezone the Postgres session/connection is configured to (the
   Supabase/Postgres default is UTC unless the instance-level `timezone` GUC
   is overridden — not verified against the live DB config in this read-only
   pass, but nothing in the migration sets it locally). This is a genuine,
   confirmed drift from the IST-cast XP-cap logic 130 lines above it **in the
   same function body** — the two boundaries are not just conceptually
   different subsystems (as UTC-synthesis vs IST-XP-cap arguably are), they
   are two clocks disagreeing about "today" inside one transaction.

**Concrete user-visible anomaly (worked example):** IST = UTC+5:30, so the
window where the UTC calendar date lags the IST calendar date is
00:00–05:29 IST (= 18:30–23:59 UTC of the *previous* UTC day). Consider a
student who studies early morning IST (a well-documented pattern for Indian
competitive-exam — NEET/JEE — aspirants) and completes a quiz at 1:00 AM IST
on, say, July 3 (= 19:30 UTC, July 2):
- **XP cap** (IST-aware): `CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'` resolves
  to **July 3** → correctly treated as a new day; the daily cap resets and
  the student can earn up to a fresh 200 XP.
- **Streak** (UTC-implicit): plain `CURRENT_DATE` resolves to **July 2**
  (UTC). If the student's `last_active` was already dated July 2 in UTC terms
  (e.g. from an evening session the previous IST day, ~8 PM IST July 2 =
  2:30 PM UTC July 2), then `last_active::date = CURRENT_DATE` (July 2 =
  July 2) is TRUE → `streak_days` branch hits the **first** CASE arm
  (`COALESCE(streak_days, 1)`, i.e. "already active today, no increment")
  instead of the second arm (`+1` for "active yesterday, extend streak").
  **Net effect: the student's XP resets as if a new day has begun, but their
  streak counter silently fails to acknowledge the new day** — understating
  a real, consecutive-day study habit for exactly the early-morning-study
  segment the product should most want to reward.
- **Verdict**: CONFIRMED, with a concrete worked anomaly ch.07 did not fully
  construct (ch.07 flagged the risk and recommended verification; this pass
  traced through an actual clock-disagreement scenario). Recommend a
  targeted architect/assessment fix: cast the streak comparison to
  `AT TIME ZONE 'Asia/Kolkata'` to match the XP-cap convention in the same
  function.

---

## J-5: Legacy v1 quiz RPC reachability

STATUS: done

### Is `submit_quiz_results` (v1) still reachable? Yes — by design, from both web and mobile.

**Current live definition**: `supabase/migrations/00000000000000_baseline_from_prod.sql:7274-7579`
(the pg_dump-derived, applied-on-prod reproducibility baseline — this is the
authoritative current schema, not the archived `_legacy/` chain). Note: 3
other legacy quiz-submit variants also live in the same baseline —
`submit_quiz_results_rpc` (`:7582`) and `submit_quiz_results_safe` (`:7588`,
a thin wrapper around `_rpc`) — neither was asked about by name in this task
and neither appears to be called from `src/lib/supabase.ts` or the mobile
repository (not exhaustively grep-verified across the whole codebase in this
pass; flagged as a Phase-3 follow-up, not confirmed dead).

**Web**: `src/lib/supabase.ts:501-521` (`submitQuizResults`) — v1 is Layer 2
of a 3-layer dispatch: v2 RPC (`submit_quiz_results_v2`, when a
`sessionId` is present) → v1 RPC (`submit_quiz_results`, always attempted if
v2 didn't return data, OR whenever `sessionId` is falsy) → client-side
degraded fallback. Critically, `sessionId` is NOT guaranteed populated:
`src/app/quiz/page.tsx:605-617` shows the quiz page calls `setServerSessionId(null)`
whenever the `start_quiz_session` RPC is unavailable, which routes that
attempt onto v1 immediately. So v1 is live-reachable from the current web
client, not just from "in-flight old tabs" as the architectural-contract
comment (`supabase.ts:498-499`) implies — any `start_quiz_session` outage or
transient failure sends a live web user through v1.

**Mobile**: `mobile/lib/data/repositories/quiz_repository.dart:1-58` (header
doc, read directly) — mobile's default (`useV2` OFF) and REST-client
(`useV2` ON) paths **both terminate at `submit_quiz_results_v2`** when
`start_quiz_session` succeeds; v1 is a fallback "when `start_quiz_session` is
unavailable or fails (older server, network error during session start)"
and, per the file's own words, "the v1 RPC is preserved **indefinitely** for
old mobile builds in the wild" (`:48-52`). This means the constitution's
framing in `src/lib/supabase.ts:498-499` ("MUST remain callable until mobile
cuts over to v2") is **stale/imprecise**: mobile has already cut over to v2
as its primary path — v1 is kept alive not because mobile hasn't migrated,
but because already-installed old APK binaries can never be forced to
update (a real constraint in the Indian device-tail market this product
serves), so v1 support is intentionally open-ended, not a transitional
state waiting to close.

**Flag posture — a flag that lies.** `ff_v1_quiz_rpc_web_blocked`
(`supabase/migrations/20260504100600_v1_quiz_rpc_user_agent_flag.sql`) is
registered (seeded OFF) and described in the super-admin Flags console as
gating "the legacy `submit_quiz_results` RPC rejects calls where the request
originates from a web client." Directly verified: **the follow-up migration
that would actually add this User-Agent check was never shipped** — a
repo-wide search for the follow-up migration's stated filename pattern
(`v1_quiz_rpc_user_agent_gate`) and for any reference to
`ff_v1_quiz_rpc_web_blocked` outside its own seed migration returns zero
hits. If an operator flips this flag ON today believing it blocks web
callers, **nothing happens** — the v1 RPC body has no code path that reads
this flag. This is an operational-integrity gap: a console-visible flag with
zero enforcement is worse than no flag, because it creates false confidence.

### Does v1 enforce the same P1/P2/P3 as v2?

Directly compared both bodies line-by-line in this pass
(`baseline_from_prod.sql:7274-7579` vs
`20260622030000_submit_quiz_v2_resilient_mastery_perform.sql`):

| Invariant | v1 | v2 | Drift? |
|---|---|---|---|
| P2 XP economy (literals + daily cap) | Calls the SAME shared `atomic_quiz_profile_update(p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_session_id)` (`baseline_from_prod.sql:7549-7551`) that v2 also calls. The IST-boundary ledger cap, idempotency dedupe, and level formula are therefore centralized and NOT duplicated between v1/v2. | Same call, same function. | **NO DRIFT** — P2 enforcement is architecturally shared, not reimplemented. |
| P3 anti-cheat (3 checks) | Identical three conditions, identical literals (`3.0`, `> 3`), identical tautological Check-3 (`v_total` is `jsonb_array_length(p_responses)` by construction here too — `:7308-7310` builds `v_total` from the same loop), identical Check-2 blind spot (`v_answer_counts` only tallies `0..3`, `v_total` includes blanks) — `baseline_from_prod.sql:7380-7397`. | Same 3 checks, same literals, same blind spots (`20260622030000...sql:228-248`). | **NO DRIFT** — bugs and all, byte-for-byte equivalent behavior. |
| P1 score accuracy — **the formula** | `v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100)` (`:7399`) — same formula as v2. | Same formula (`:250-251`). | **NO DRIFT in the formula.** |
| P1 score accuracy — **the scoring source (real finding)** | Reads `correct_answer_index` **LIVE from `question_bank`** at submission time (`:7355-7356`, `:7470-7472`: `SELECT correct_answer_index ... FROM question_bank WHERE id = v_question_id`) — no session-start snapshot exists for v1 at all; there is no `start_quiz_session` counterpart in the v1 flow. | Reads `correct_answer_index_snapshot` from `quiz_session_shuffles`, a row written by `start_quiz_session` at the moment the quiz began, and **raises an exception if the snapshot is missing** (`20260622030000...sql`, `RAISE EXCEPTION 'session_not_started...'`). | **DRIFTED.** This is exactly the vulnerability class the `quiz_session_shuffles` table was built to close — see the baseline's own column comment: *"Closes the P1+P6 drift bug where a client-derived stable shuffle could mismatch a later question_bank content edit... submit_quiz_results_v2 reads from here, NEVER from the live question_bank"* (`baseline_from_prod.sql:12893-12902`). v1-scored quizzes remain exposed to that exact bug class today: if `question_bank.correct_answer_index` is edited (content fix, mislabeled question correction, or a malicious update) between when a v1 quiz was served and when it is submitted, the score silently changes to match the NEW answer key, not the one the student was actually shown. |
| P4 atomicity | Single PL/pgSQL function body: session insert → response insert loop → `atomic_quiz_profile_update` PERFORM, all in one transaction (`:7409-7551`). | Same shape. | **NO DRIFT.** |
| P5 grade format | `p_grade TEXT` (`:7274` signature). | `p_grade TEXT` (`20260622030000...sql:33`). | **NO DRIFT.** |

### Verdict: **DRIFTED** (not SAFE-DUPLICATE, not DEAD)

- **Not DEAD**: confirmed live-reachable from both web (on any
  `start_quiz_session` failure) and mobile (explicit indefinite-support
  fallback for old installed builds), with a currently-nonfunctional kill
  switch (`ff_v1_quiz_rpc_web_blocked`) that cannot actually disable the web
  path even if an operator believes it can.
- **Not SAFE-DUPLICATE**: P2/P3/P4/P5 are architecturally shared or
  byte-identical (genuinely safe to treat as one code path for those four
  invariants), but **P1's scoring *source*** (not formula) is a real,
  live drift — v1 has no server-shuffle-snapshot integrity model at all, so
  it inherits the exact mid-flight content-edit vulnerability that the
  `quiz_session_shuffles` table and `submit_quiz_results_v2` were purpose-built
  to close. Any student still landing on v1 (every mobile install that has
  never called `start_quiz_session` successfully, or any web session where
  `start_quiz_session` failed) is scored against live, mutable
  `question_bank` data rather than a frozen snapshot.
- **Recommended Phase-3 disposition**: either (a) backport a
  snapshot-or-fail model into v1 (raise if no prior session-start snapshot
  exists, mirroring v2's `session_not_started` guard) — the more
  conservative fix, preserves v1 as a real fallback; or (b) ship the
  already-designed-but-never-implemented UA-gate follow-up migration
  referenced in `20260504100600...sql` so `ff_v1_quiz_rpc_web_blocked`
  actually does what its own description claims, closing the web-side
  exposure while leaving v1 open for the mobile long-tail (which was its
  original purpose); either way, the flag's dashboard description should be
  corrected immediately regardless of which fix ships, since today it
  misrepresents what flipping it does.

---

## Phase 3 remediation queue (severity-ranked)

STATUS: done

### CRITICAL

1. **Daily Rhythm queue is completely dark.** `src/app/api/rhythm/today/route.ts:210`
   queries `students` with the auth uid instead of the surrogate `students.id`;
   two downstream RPCs at `:276`/`:345` repeat the mistake and must be fixed
   in the same change (both are surrogate-only, no dual-key fallback). Every
   student sees an empty/404'd Daily Rhythm surface whenever
   `ff_pedagogy_v2_daily_rhythm` is ON. (J-1)

### HIGH

2. **Server anti-cheat Check 3 is a tautological dead no-op** in BOTH
   `submit_quiz_results` (v1) and `submit_quiz_results_v2` — `v_total` is
   built from `jsonb_array_length(p_responses)` in the same loop it's later
   compared against, so the condition can never fire. Independently
   re-derived from the raw SQL in this pass (J-3), corroborating
   `11-api-contracts.md` C-6. Fix requires comparing against a value with an
   independent origin (e.g. the question count recorded at
   `start_quiz_session` time) or removing the dead check and documenting why.
3. **v1 quiz-submit RPC scores against live, mutable `question_bank` data**,
   not a frozen session-start snapshot — the exact vulnerability class
   `quiz_session_shuffles`/v2 was built to close, per the baseline's own
   column comment. v1 is confirmed live-reachable from web (on any
   `start_quiz_session` failure) and from mobile (intentional indefinite
   fallback for old installed builds). (J-5)
4. **`ff_v1_quiz_rpc_web_blocked` is a non-functional kill switch.** The
   flag is seeded and console-visible with a description claiming it blocks
   web-originated v1 calls; the follow-up migration that would implement the
   User-Agent gate was never shipped. An operator who flips it believing it
   protects the web path is wrong — nothing happens. Fix the description
   immediately (documentation-only, zero risk) regardless of whether the
   gate itself is ever implemented. (J-5)
5. **Anti-cheat wording drift is now precisely located, not just noted.**
   `.claude/skills/quiz-integrity/SKILL.md:47-53` explicitly documents Speed
   and Count as "Reject" in a table, directly contradicting the shipped
   flag-plus-zero-XP-plus-record behavior on both client and server. This
   needs a CEO ruling (two candidate interpretations laid out in J-3, no
   verdict rendered here) before either the code or the skill doc is
   changed — whichever direction is chosen, the skill file is unambiguously
   wrong against the current code today and will mislead the next agent who
   reads it as ground truth.

### MEDIUM

6. **Server anti-cheat Check 2 blind spot** (both v1 and v2): comparing
   `v_max_same_answer` against `v_total` (all responses, including blanks)
   instead of `mcqResponses.length`/count of valid MCQ selections means any
   quiz with at least one blank response can never trigger the all-same-
   answer flag, regardless of how suspicious the pattern is on the questions
   that WERE answered. Independent of the reject-vs-flag ruling in item 5.
   (J-3)
7. **Streak-day boundary is UTC-implicit while the XP-cap boundary 130 lines
   above it in the SAME function is explicitly IST-cast.** Concrete,
   worked user-visible anomaly: an early-morning-IST study session (a real
   pattern for Indian competitive-exam aspirants) can reset a student's XP
   cap for a "new day" while their streak counter fails to acknowledge the
   new day, silently understating a genuine consecutive-day habit. Fix:
   cast the streak comparison to `AT TIME ZONE 'Asia/Kolkata'` to match.
   (J-4c)
8. **Six named E2E coverage gaps confirmed**: Weekly Dive, Leaderboard
   (functional), Parent reports (functional), Foxy 7-mode matrix, Daily
   Rhythm queue, Teacher grade-book/worksheets — zero dedicated or
   incidental E2E coverage found by either filename or content search across
   all 34 spec files (including the `e2e/grounding/` subdirectory ch.07's
   pass missed). Recommend prioritizing Daily Rhythm and Leaderboard first
   since both also carry confirmed correctness/dead-weight findings in this
   same audit (items 1 and 10). (J-2)
9. **`today-home.spec.ts` naming collision risk.** `/today` (Consumer
   Minimalism Wave A, BFF `/api/v2/today`) and `/api/rhythm/today` (Pedagogy
   v2 Daily Rhythm queue) are two unrelated features sharing "today" in
   their names/routes. A spec file existing for one could be mistaken for
   coverage of the other by a future reader skimming filenames — as nearly
   happened in this audit pass. No code change needed; recommend a renaming
   or a doc cross-reference to prevent future confusion. (J-2)

### LOW

10. **Leaderboard and ProgressSnapshot client-side re-aggregation
    dead-weight.** `src/app/leaderboard/page.tsx:168-239` recomputes
    already-server-correct aggregate data client-side; confirmed not a
    correctness bug (values agree), just wasted work and a future-drift
    risk. `ProgressSnapshot.tsx:37-53`'s client-averaged "Performance Score"
    is currently the ONLY place that average is computed anywhere in the
    codebase (verified — no second computation exists to disagree with
    today), so it's a latent, not live, risk. Recommend moving both
    server-side opportunistically, not urgently. (J-1, J-4b)
11. **Knowledge-gap severity uses strict `>` instead of `>=`** at
    `src/app/progress/page.tsx:466`, one severity band too lenient at the
    exact boundary values (0.7, 0.4). Low blast radius (boundary-value only)
    but directionally under-alarms an at-risk-detection surface. (J-4a)
12. **Two other legacy quiz-submit RPC variants exist** in the current
    baseline (`submit_quiz_results_rpc`, `submit_quiz_results_safe` —
    `baseline_from_prod.sql:7582`, `:7588`) that were not asked about by name
    in this task and were not exhaustively checked for live callers in this
    pass. Recommend a follow-up grep sweep (web + mobile + Edge Functions)
    to classify them SAFE-DUPLICATE/DRIFTED/DEAD using the same method as
    J-5. (J-5)

---

## Summary

All J-1 through J-5 items completed by direct code reading in this pass (no
sub-agents spawned, per process rules). J-1 reproduces the prior child run's
findings with one item (S2 Daily Rhythm) independently re-verified line-by-line
rather than taken on trust. J-2 through J-5 are original investigation: J-2
confirms 5 of ch.07's 6 named E2E gaps and corrects the 6th (Foxy) in degree
but not in kind; J-3 lays out the anti-cheat brief with two independently
re-derived server-side bugs (tautological Check 3, Check 2 blind spot) and
two candidate interpretations for CEO ruling, no verdict imposed; J-4
confirms all three ch.07 specifics with concrete evidence and, for the
day-boundary clocks, a fully worked user-visible anomaly; J-5 is new
investigation reaching a DRIFTED verdict on the v1 quiz RPC, with the most
consequential single finding being that v1 scores against live mutable
`question_bank` data instead of a frozen session snapshot, and that its
associated kill-switch flag does not actually do what its own description
claims.
