> **Phase 2 Validation — read-only static analysis.** No code was modified to produce this
> document. No servers were started, no queries were executed against a live database, no load
> tests were run. Every finding below is derived from reading source files (TypeScript/TSX,
> Supabase SQL migrations, Deno Edge Function code) and grepping for known anti-pattern shapes.
> Target profile: Indian 4G (2-5 Mbps, high RTT, variable jitter) — the constitution's stated
> performance target (P10) and the reason caching/round-trip count matters more here than raw
> compute cost.
>
> Scope note: **sampled, not exhaustive.** The hot paths named in the task brief (quiz submission,
> dashboard, pulse, leaderboard, progress, daily-cron, adaptive-remediation cron) were read in full
> or near-full. Middleware (`src/proxy.ts`) was read in full. The remaining ~280 API routes were
> **not** individually audited — P-5 findings in particular are a sample sweep (grep-seeded, then
> manually verified), not a full-surface enumeration. Where a check is exhaustive within its named
> scope, that is stated explicitly in the section.

# Performance Audit — Phase 2 Validation

## Findings table (ranked by impact)

| # | Check | Finding | Impact | Evidence |
|---|---|---|---|---|
| F1 | P-1 | `submit_quiz_results_v2` RPC runs a **two-pass per-question loop** (up to 50 responses) with 4-8 sequential SQL statements per question per pass | **HIGH** | §P-1.1 |
| F2 | P-1 | `daily-cron`'s `generateParentDigests` step runs **two full sequential per-guardian-link loops** (2-3 awaited queries + a conditional external `fetch` each), no batching | **HIGH** | §P-1.2 |
| F3 | P-1 / P-2 / P-5 | `/api/lab-notebook/list` reads `experiment_observations` with **no `.limit()` and no supporting index** on `student_id` or `created_at` — the table has only a PK on `id` | **HIGH** (compounding) | §P-1.6, §P-2 row 10, §P-5.1 |
| F4 | P-4 | Student dashboard (`/dashboard`) fans out to **~7 independent data sources** on every mount even though a single batched RPC (`get_dashboard_data`) already exists and is called by the nav shell for the same student | **MED-HIGH** | §P-4.1 |
| F5 | P-1 | `daily-cron`'s `manageChallengeStreaks` Step 4 issues **one `UPDATE` per at-risk student** in a for-loop instead of two bulk `.update().in()` calls | **MED** | §P-1.3 |
| F6 | P-1 | `adaptive-remediation` cron's `runInjectPhase` calls `isFeatureEnabled()` **3× per student** inside the main student loop (up to 200 students/run ⇒ up to 600 sequential awaits) | **MED** | §P-1.4 |
| F7 | P-2 | `concept_mastery` has no composite index matching the dashboard/revision "due reviews" query shape (`student_id` + `next_review_date` range + `mastery_probability` + `ORDER BY next_review_date`) — the existing composite index is on the sibling column `next_review_at`, not `next_review_date` | **MED** | §P-2 row 1 |
| F8 | P-4 | `GET /api/board-score` sets **no `Cache-Control` header**, and `BoardScoreWidget` fetches it with raw `useState`/`useEffect` (no SWR) — every dashboard mount re-fetches with zero caching, unlike its sibling `/api/v2/today` (30s private cache + SWR dedupe) | **MED** | §P-4.2 |
| F9 | P-1 | `daily-cron`'s batch-lookup loops (`recalculatePerformanceScores`, `manageChallengeStreaks`, `nudgeFirstQuizStudents`) chunk `.in()` reads at 200 rows but run the chunks **sequentially** instead of via `Promise.all` | **LOW** | §P-1.5 |
| F10 | P-2 | `learner_mastery` has no index on `attempts`; `/api/v1/leaderboard/mastery` filters `WHERE attempts > 0` before its `.limit(10000)` cap | **LOW** | §P-2 row 6 |
| F11 | P-6 | `src/proxy.ts` re-evaluates the same `/^sb-.+-auth-token/` cookie-presence check **4 separate times** across different middleware layers instead of computing it once and threading the result | **LOW** | §P-6.1 |
| F12 | P-5 | `/api/revision/overview` reads `concept_mastery` with no `.limit()` (bounded implicitly by student + date-window scope, not a real risk today) | **LOW / informational** | §P-5.2 |
| F13 | P-3 | Dead routes (`/study-plan`, `/review`) and the 118-file `simulations/` tree do **not** inflate the shared or page bundle — both are clean findings, included for completeness | **NONE (clean)** | §P-3 |

---

## P-1: N+1 sweep on hot paths

**Scope: exhaustive for quiz-submit, dashboard, pulse, leaderboard, daily-cron; sampled for
adaptive-remediation (its 2,319-line route was grep-swept for loop/await patterns, then the
`runInjectPhase` function — the highest-frequency one — was read in full; `runVerifyPhase` and the
per-signal `verify*Row` helpers were not read line-by-line).**

### P-1.1 — `submit_quiz_results_v2` (quiz submission, HIGH)

File: `supabase/migrations/20260623000500_reapply_submit_quiz_v2_column_fix.sql` (current
definition of the RPC called by `POST /api/quiz/submit` and `POST /api/v2/quiz/submit` — this is
the P4 "atomic quiz submission" RPC, and the single highest-traffic write path in the product).

The RPC iterates `p_responses` (client-supplied array, `.max(50)` in the Next.js route's Zod
schema) **twice**:

- **First pass** (lines 167-212): for each response, `SELECT shuffle_map, correct_answer_index_snapshot FROM quiz_session_shuffles WHERE session_id = ? AND question_id = ?` — 1 query/question.
- **Second pass** (lines 271-409): for each response —
  1. `SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot FROM quiz_session_shuffles ...` (duplicate of the first-pass read, re-fetched)
  2. `SELECT ... FROM question_bank WHERE id = ?`
  3. Conditionally, `SELECT ct.id FROM curriculum_topics ct JOIN subjects s ... ` (topic-id fallback when `question_bank.topic_id` is null)
  4. Conditionally (wrong answer), `SELECT mastery_probability FROM concept_mastery WHERE student_id = ? AND topic_id = ?`
  5. `INSERT INTO quiz_responses (...)`
  6. `PERFORM update_learner_state_post_quiz(...)` — itself does 1 `SELECT ... FOR UPDATE` + 1 upsert (`supabase/migrations/20260623000100_fix_post_quiz_canonical_mastery.sql` lines 94-119 + the upsert further down the same function)
  7. `INSERT ... INTO user_question_history ... ON CONFLICT DO UPDATE`

Net: for a 10-question quiz this is on the order of **60-80 sequential SQL statements** inside one
Postgres transaction; for the schema's own cap of 50 responses it is **300-450**. All of this runs
serially inside a single `plpgsql` function body (no `Promise.all` equivalent exists inside
`plpgsql`) — so it is not a network-round-trip N+1 from the app server's perspective (one RPC call
from Next.js), but it **is** a straight-line O(N) Postgres statement-execution cost gating the
single most latency-sensitive user-facing action in the product (a student staring at "submitting
quiz…" on a 4G connection). The row locking in `update_learner_state_post_quiz`
(`SELECT ... FOR UPDATE`) also means this cost is paid **serially, holding locks**, for every
question the student answered.

Good news found alongside this: `quiz_session_shuffles` has `PRIMARY KEY (session_id, question_id)`
and `concept_mastery` has `UNIQUE (student_id, topic_id)`, so every one of these per-question reads
*is* index-covered (see P-2) — the cost is round-trip/statement count, not missing indexes.

### P-1.2 — `daily-cron` → `generateParentDigests` (HIGH)

File: `supabase/functions/daily-cron/index.ts` lines 150-212.

Two consecutive `for (const {guardian_id,student_id} of links)` loops over
**every** `guardian_student_links` row with `status IN ('approved','active')` (no `.limit()` on
that initial read either):

- Loop 1 (line 160): per link — `SELECT ... FROM quiz_sessions WHERE student_id = ? AND is_completed = true AND created_at >= ?` **and** `SELECT current_streak FROM challenge_streaks WHERE student_id = ?` — 2 sequential awaited queries per link.
- Loop 2 (line 176): per link again — `SELECT phone, notification_preferences FROM guardians WHERE id = ?`, then conditionally `SELECT name FROM students WHERE id = ?`, then conditionally an external `fetch()` to the `whatsapp-notify` Edge Function.

None of this is batched with `.in()`, none of it is `Promise.all`'d, and none of it is chunked. For
N guardian-student links this is **O(4N) sequential DB round-trips** plus up to N sequential
external HTTP calls. This is the textbook N+1 anti-pattern the task asked to sweep for, and it sits
inside the one cron step most likely to grow linearly with the platform's core growth metric
(parent-linked students). `daily-cron` gets an extended 300s Vercel timeout specifically because
steps like this exist; at current guardian-link counts this is probably fine, but it has no ceiling
and is the step most likely to regress the whole cron run first as B2C link volume grows.

### P-1.3 — `daily-cron` → `manageChallengeStreaks` Step 4 (MED)

File: `supabase/functions/daily-cron/index.ts` lines 979-1019. After bulk-fetching at-risk streaks
and batching the student-grade lookup correctly (`.in()` in chunks of 200, matching the good
pattern elsewhere in the same file), the function falls back to a **per-student `UPDATE`** inside a
`for` loop — either a "mercy preserve" update or a "break streak" update, one row at a time. Since
both branches only ever set 1-2 fixed columns and the split is a boolean partition, this is
straightforwardly reducible to two bulk `.update({...}).in('student_id', mercyIds)` /
`.update({...}).in('student_id', breakIds)` calls. Lower severity than F1/F2 because it's pure
writes with no downstream fan-out per row, but it's the same anti-pattern in the same file as
`generateParentDigests`, suggesting it's a house-pattern rather than a one-off.

### P-1.4 — `adaptive-remediation` cron → `runInjectPhase` (MED)

File: `src/app/api/cron/adaptive-remediation/route.ts`. The candidate-gathering half of this
function (lines 324-503) is well-built: bulk reads with `.in()`, a `Promise.all` for the
active/terminal intervention-ledger reads (lines 450-462), and in-memory `Map`-grouping — this is
the same good pattern seen in the Pulse endpoints (see below). However, the per-student loop that
follows (line 509 `for (const student of students)`, capped at
`MAX_INJECT_STUDENTS_PER_RUN = 200`) calls `await isFeatureEnabled(...)` **three times per
student** — once per loop (lines 523, 621, 722, for Loop A / Loops B-C / Loop D respectively) —
instead of once per run. `isFeatureEnabled()` itself is CPU-cheap once its underlying `loadFlags()`
call is warm (a `find()` + a deterministic hash for rollout-percentage bucketing — see
`src/lib/feature-flags.ts` lines 87-127), so this is not a DB-per-call cost, but it is up to **600
redundant sequential `await` hops** in the hottest loop of a cron job that already has a documented
30s Vercel-budget concern in its own comments (line 330: "bounded so the Vercel 30s budget holds").
The three global on/off checks (lines 306-317, once per run) are already correctly hoisted outside
the loop — only the per-student rollout-percentage check needs to move.

### P-1.5 — `daily-cron` batched-but-sequential chunk loops (LOW)

`recalculatePerformanceScores` (lines 349-364, 369-377), `manageChallengeStreaks` (lines 962-974),
and `nudgeFirstQuizStudents` (lines 1537-1551, 1564-1579) all correctly batch `.in()` reads at
`BATCH = 200`, but each batch loop `await`s sequentially (`for (let i = 0; i < ids.length; i +=
BATCH) { await ... }`) rather than firing all chunks via `Promise.all(chunks.map(...))`. This is a
real but low-severity finding: it's already the *good* pattern (bulk `.in()` reads, not per-row
queries) and only matters once the candidate-row count is large enough to need multiple 200-row
chunks, which is not the common case today per the `~60 students` comment in
`nudgeFirstQuizStudents`. Flagged for completeness since the task asked specifically about
sequential-awaits-that-could-be-`Promise.all`.

### P-1.6 — `/api/lab-notebook/list` (see F3, cross-referenced in P-2/P-5)

`src/app/api/lab-notebook/list/route.ts` lines 170-180: after correctly bulk-loading the roster and
using `Promise.all` for the two follow-up reads, the `experiment_observations` read has no
`.limit()` and (per P-2) no supporting index — see §P-2 row 10 and §P-5.1 for the full write-up;
noted here because it's also relevant to the "any query shape that could regress into an N+1-style
scan" framing of this check.

### P-1 — clean results worth recording

These hot paths were read looking for the anti-pattern and **did not** show it — recorded so a
future audit doesn't re-walk the same ground:

- **`src/lib/state/student-state-builder.ts`** (backs `/api/v2/today`, `/api/learner/next`, and the
  Learner Loop generally): uses a single `Promise.all` for the parallel-round-trip reads it
  documents in its own header comment.
- **`src/lib/pulse/pulse-server.ts` `buildClassPulseItems`**: explicitly documents "never N×
  buildStudentState" in its own header and backs that up — 3 bulk reads via `Promise.all`
  (`learner_mastery`, `students`, `state_events`, all `.in()`-scoped to the roster), grouped
  client-side into `Map`s, one non-awaited `.map()` pass to build the response. This is the pattern
  the rest of the codebase should be measured against.
- **`/api/pulse/school`**: 2 RPC calls via `Promise.all`, no fan-out.
- **`/api/v1/leaderboard`, `/api/v1/leaderboard/mastery`**: single bulk reads, CDN-cached, no
  per-row queries.
- **Dashboard component tree** (`MasterySnapshot` + `SubjectRoadmaps` both call
  `useMasteryOverview(studentId)`): both mount simultaneously and both hit the *same* SWR cache key
  (`mastery/${studentId}/all`), so SWR's deduping collapses them to one network call — this looked
  like a double-fetch at first read and is not one.
- **`POST /api/quiz/submit`** (the Next.js route itself, as opposed to the RPC it calls): single
  RPC call, side-effects are fire-and-forget (`runQuizSubmitSideEffects`, not awaited before
  responding) — no loop in the route handler.

---

## P-2: Index alignment (10 most frequent hot-path query shapes)

**Scope: sampled — these are the 10 query shapes most frequently observed while reading the P-1
hot paths, checked by name against the baseline migration's `CREATE INDEX`/`CONSTRAINT` statements
plus a full grep for the specific tables involved. Not a query-shape census of the whole codebase.**

| # | Query shape | Hot path(s) | Index found | Verdict |
|---|---|---|---|---|
| 1 | `concept_mastery` WHERE `student_id=?` AND `next_review_date<=?` AND `mastery_probability<?` AND `next_review_date>=?` ORDER BY `next_review_date` | `/api/dashboard/reviews-due`, `/api/revision/overview` | `idx_concept_mastery_student` (student_id only), `idx_concept_mastery_review_date` (next_review_date only), `idx_concept_mastery_review` (student_id, **next_review_at** — different column) | **GAP** — no composite on the actual filter columns |
| 2 | `concept_mastery` `SELECT ... FOR UPDATE WHERE student_id=? AND topic_id=?` | `update_learner_state_post_quiz` (quiz-submit loop, F1) | `UNIQUE (student_id, topic_id)` (`concept_mastery_student_id_topic_id_key`) | OK — covered |
| 3 | `quiz_session_shuffles` WHERE `session_id=?` AND `question_id=?` | quiz-submit two-pass loop (F1) | `PRIMARY KEY (session_id, question_id)` | OK — covered |
| 4 | `question_bank` WHERE `id=?` | quiz-submit loop | PK on `id` (implicit) | OK — covered |
| 5 | `learner_mastery` WHERE `auth_user_id IN (...)` | Pulse (`buildClassPulseItems`), `student-state-builder`, adaptive-remediation | `learner_mastery_by_user (auth_user_id)`, plus `UNIQUE(auth_user_id, subject_code, chapter_number)` | OK — covered |
| 6 | `learner_mastery` WHERE `attempts > 0` (no `auth_user_id` filter) | `/api/v1/leaderboard/mastery` (reads up to 10,000 rows) | none on `attempts` | **GAP (low)** — bounded by `.limit(10000)` and 60s CDN cache, so cost is capped, but every cache-miss forces a scan of `attempts` with no index to prune it |
| 7 | `quiz_sessions` WHERE `student_id=?` ORDER BY `created_at` DESC | dashboard, progress page, leaderboard fallback | `idx_qs_created`, `idx_qs_student_done`, `idx_quiz_sessions_student_created` (all `student_id, created_at DESC`) | OK — well covered, arguably 3 overlapping indexes (minor redundancy, not a gap) |
| 8 | `state_events` WHERE `actor_auth_user_id IN (...)` AND `kind='learner.mastery_changed'` ORDER BY `occurred_at` DESC | Pulse, adaptive-remediation `runInjectPhase`/`runVerifyPhase` | `idx_state_events_actor_kind` | OK — column-name match found; exact column order not independently re-verified (sampled) |
| 9 | `adaptive_interventions` WHERE `student_id IN (...)` AND `status='active'` | adaptive-remediation ledger read | `idx_adaptive_interventions_student_status` | OK — covered |
| 10 | `experiment_observations` WHERE `student_id IN (...)` ORDER BY `created_at` DESC | `/api/lab-notebook/list` (F3) | **none** — table has only `PRIMARY KEY (id)` (confirmed: `supabase/migrations/20260504195900_ensure_experiment_observations.sql` lines 39-56, no follow-up migration adds one) | **GAP (real)** — combined with no `.limit()` (P-5), this is a full sequential scan today that grows monotonically |

---

## P-3: Dead-weight shipping

**Scope: exhaustive for the 4 named dead routes + the `simulations/` tree; `.next` build output was
not available (per the task's own instruction) so this reasons from import graphs and
`next/dynamic` usage, not from a real bundle-composition report.**

- **`/study-plan`, `/review`** (permanently 301-redirected per `next.config.js`, confirmed in the
  Phase 1 discovery doc): Next.js App Router compiles each route segment into its own route chunk;
  an unreachable `page.tsx` under `/study-plan/` does not get pulled into the **shared** bundle that
  P10 measures — it becomes dead weight only in the sense of an orphaned, never-served chunk in the
  build output, not a tax on every page's first load. **No shared/page-bundle impact.** (It is
  still real maintenance debt — see the Phase 1 doc's §6 — just not a performance finding.)
  One live route (`/exam-prep`) does statically import a component that lives under
  `src/components/study-plan/` (`TodayLoopCard`), which is fine — that's a shared component,
  not the dead page.
- **`simulations/` (118 files)**: every one of the 118 simulation components in
  `src/components/simulations/index.tsx` is wrapped in `next/dynamic(() => import('./X'), { ssr:
  false, loading: () => <SimulationSkeleton /> })` — confirmed by reading the full export list.
  `stem-centre/page.tsx` (the only live consumer) statically imports the `index.tsx` barrel file
  itself plus `SimulationShell`, but the barrel file's `dynamic()` wrappers mean each individual
  simulation component is its own code-split chunk, loaded only when a student opens that specific
  simulation. **This is a clean result** — the 118-file count looks alarming in isolation but the
  code-splitting is done correctly; it does not inflate the shared bundle or `/stem-centre`'s
  initial page bundle beyond the barrel file's own (small) metadata array.
- **`/tutor` vs `/foxy`, `/mock-exam` vs `/exams/mock`** (the other duplicate-feature pairs flagged
  in the Phase 1 discovery doc): not re-audited here for bundle impact — out of scope for this pass
  since neither was named in the task's explicit dead-route list.

---

## P-4: Caching posture

**Scope: sampled — the hot GET routes touched while tracing P-1/P-2 were checked for
`Cache-Control` headers and SWR usage; not a full 280-route caching audit.**

### P-4.1 — Dashboard fan-out vs. the existing batched RPC (F4)

`useDashboardData(studentId)` (`src/lib/swr.tsx` lines 293-303) wraps a single RPC,
`get_dashboard_data(p_student_id)`, which is itself well-built server-side — one `plpgsql` function,
~11 small sequential `SELECT`s inside a single Postgres round trip (not a network N+1; read in full
at `supabase/migrations/00000000000000_baseline_from_prod.sql` lines 4481+), returning
`profiles, due_count, unread_count, knowledge_gaps, velocity, bloom, cbse_readiness, exams, nudges,
retention_score, error_breakdown` in one JSON payload.

This hook is called today by `DesktopSidebar.tsx` and `MobileBottomNav.tsx` — the **navigation
chrome**, not the dashboard content itself. `StudentOSDashboard.tsx` (the actual `/dashboard` page
component) does not call it. Instead the dashboard content independently fetches, on every mount:

1. `getPendingParentLinks(authUserId)` — raw Supabase call, no SWR, no cache
2. `getNextTopics(...)` — raw Supabase call, no SWR, no cache
3. `useMasteryOverview(studentId)` (SWR, deduped across 2 mounted consumers — fine)
4. `useTodayQueue(studentId)` → `/api/v2/today` (SWR, 30s dedupe, server sets `Cache-Control:
   private, max-age=30`)
5. `useReviewCards(studentId, 20)` (SWR) inside `RevisionRail`
6. `ReviewsDueCard`'s own SWR fetch to `/api/dashboard/reviews-due` (server sets `Cache-Control:
   private, max-age=300` and a server-side `cacheFetchAsync` cache — this route is a genuinely good
   example, see below)
7. `BoardScoreWidget`'s raw `fetch('/api/board-score')` in a `useState`/`useEffect` (no SWR, no
   cache — see F8)

Several of these overlap conceptually with fields `get_dashboard_data` already computes
(`due_count` ≈ reviews-due, `knowledge_gaps`/`bloom` ≈ mastery-overview-adjacent), but the two paths
evolved independently (the RPC is the older "Priority 2 dashboard" design; the SWR hooks are the
newer per-widget Alfa-OS design) and were never reconciled. This is not a correctness bug — every
individual fetch here is reasonably cached or bounded on its own — but it means a first dashboard
paint on a 4G connection issues on the order of **6-7 separate HTTP round trips** (plus whatever
`DesktopSidebar`/`MobileBottomNav` add via `get_dashboard_data`) instead of consolidating onto the
one RPC that was purpose-built for this exact "everything the dashboard needs" use case.

### P-4.2 — `/api/board-score` has no `Cache-Control` header (F8)

`src/app/api/board-score/route.ts` `GET` (lines 62-127) proxies to the `board-score` Edge Function
and returns its payload verbatim with `NextResponse.json(payload, { status: ... })` — no `headers`
option at all. Contrast with its dashboard sibling `/api/v2/today`
(`Cache-Control: private, max-age=30, must-revalidate`) and `/api/dashboard/reviews-due`
(`Cache-Control: private, max-age=300` + a server-side `cacheFetchAsync`). `BoardScoreWidget.tsx`
compounds this by using raw `useState`/`useEffect` + `fetch()` instead of the `useSWR`/`useReviewCards`
pattern used by its sibling widgets — so there is neither a browser-cache header nor a client-side
SWR dedupe layer, and BoardScore predictions are documented elsewhere in the codebase as
nightly-cron-computed (`board-score` Vercel cron, 03:00 UTC) — i.e. genuinely static for up to 24h,
making this one of the cheapest possible caching wins in the whole dashboard.

### P-4.3 — Good examples worth preserving as the house pattern

- `/api/dashboard/reviews-due`: server-side `cacheFetchAsync` keyed by `student_id + date`
  (correctly per-student, per the code's own P13 callout that a shared/public cache would leak one
  student's review state to another) + `Cache-Control: private, max-age=300`.
- `/api/v1/leaderboard`, `/api/v1/leaderboard/mastery`: `public, s-maxage=60,
  stale-while-revalidate=120` + the `Vercel-CDN-Cache-Control`/`CDN-Cache-Control` triad — correctly
  public since leaderboard data is identical for all viewers.
- `/api/pulse/school`, `/api/pulse/class/[classId]`: `private, max-age=60|30,
  stale-while-revalidate=...` — correctly private (per-school/per-class scoped data).
- `src/lib/cache.ts`: documents its own scope limits honestly in its header comment — it's an
  **in-memory, per-Vercel-instance** cache (not Redis-backed like the rate limiter), so its hit rate
  depends on serverless instance warmth. This is a known, self-documented limitation, not a hidden
  gap — flagged here only as context for why `/api/dashboard/reviews-due`'s cache is not as strong a
  guarantee as a Redis-backed one would be, especially across concurrent cold starts at scale.

### P-4.4 — Progress page: no caching layer at all

`src/app/progress/page.tsx` (lines 316-400) fires **9-10 separate raw Supabase queries** on every
mount via two `Promise.all` groups plus 3 bare `.then()` calls (`getBloomProgression`,
`getLearningVelocity`, `getKnowledgeGaps`, `cognitive_session_metrics`, `performance_scores`,
`score_history`, `coin_balances`, `concept_mastery`, plus `getStudentProfiles`/`getSubjects`) — none
behind SWR, none behind a server cache. The `Promise.all` grouping means these are parallelized
correctly (not sequential — not an N+1), but every tab-switch back to `/progress` re-runs the full
fan-out with zero caching, unlike the dashboard's SWR-backed widgets. Lower severity than F4/F8
because it's parallel rather than sequential, but it's the same "no caching layer" pattern repeated
on a second high-traffic page.

---

## P-5: Payload sizes (unbounded lists reachable by students)

**Scope: sampled.** Method: grepped every `route.ts` under `src/app/api/` that both imports
`authorizeRequest` and queries `.from(...)`, for files with **no** `.limit(` anywhere in the file;
then manually read each candidate to separate genuine unbounded list reads from single-row
lookups (profile/status endpoints, which dominated the raw grep hit list and are not a P-5 concern).
This is not a full audit of all ~280 routes — it is a targeted sweep for the specific shape the
task asked about.

| Route | Table / query | Bounded by? | Verdict |
|---|---|---|---|
| `/api/lab-notebook/list` | `experiment_observations` `.in('student_id', ids).order('created_at', desc)` | Nothing — no `.limit()`, no per-group cap | **Real gap (F3)** — reads full observation history for every student in a roster just to derive one "most recent" timestamp per student in JS; grows unbounded as students log more experiments, with no supporting index (P-2 row 10) to cushion the cost |
| `/api/revision/overview` | `concept_mastery` `.eq('student_id', studentId).lt('mastery_probability', 0.95).gte(...).lte(...).order('next_review_date')` | Implicitly bounded: single student + academic-year-start..today+7 date window + CBSE curriculum size (a student can have at most a few hundred `concept_mastery` rows total) | **Low risk today**, flagged as missing defense-in-depth (no explicit `.limit()` even though the natural ceiling is low) |
| `/api/support/tickets` (GET) | `support_tickets` | `.range(offset, offset + pageSize - 1)` — genuinely paginated | Clean |
| `/api/parent/messages/threads/[id]/messages` (GET) | `teacher_parent_messages` | `.limit(limit + 1)` | Clean |
| `/api/v1/leaderboard/mastery` | `learner_mastery` | `.limit(10000)` at the aggregation-input stage, `.slice(0, limit)` at output | Clean (capped, if generous) |

**Not independently re-verified**: the remaining ~40 routes surfaced by the initial no-`.limit()`
grep were single-row/profile/status endpoints on manual inspection (e.g. `/api/student/profile`,
`/api/payments/status`) and were excluded from the table above as not list-shaped; this exclusion
was done by reading each file's `.select()` target, not by re-running a second automated pass, so
treat the "not in the table" set as sampled-clean rather than exhaustively-verified-clean.

---

## P-6: Middleware cost (`src/proxy.ts`, ~1,260 lines, runs on every request)

**Scope: exhaustive read of the file for regex-compilation and per-request recomputation patterns;
not a line-by-line audit of every branch's cost.**

### P-6.1 — Repeated cookie-presence regex check (F11)

The pattern `request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name))` (a regex
**literal**, so V8 caches the compiled pattern itself — this is not a recompilation cost) appears
independently at four call sites: lines 674, 688, 970, and 1110, plus a near-duplicate at line 981
(`if (/^sb-.+-auth-token/.test(c.name))` inside a cookie-iteration loop). Each of these re-scans
`request.cookies.getAll()` (a small array, typically well under 10 cookies) and re-runs the regex
test independently, even though the underlying question — "does this request carry a Supabase
session cookie?" — is the same question asked by different middleware layers (0.6's parent-route
gate, the session-refresh layer, and the rate-limit-response content-negotiation branch). The
per-request cost is small in absolute terms (a handful of regex tests over a handful of cookies),
but it is **repeated identical work within a single request's middleware execution** — the textbook
shape of "could be memoized" the task asked about. A single `const hasSbSessionCookie = ...`
computed once near the top of `proxy()` and threaded through would remove the duplication.

### P-6.2 — Everything else checked and found clean

- `ROUTE_ROLE_RULES` (`src/lib/middleware-helpers.ts` line 268) is a **module-level constant array**
  — built once at cold start, not per-request. `findRouteRule()` (line 294) does a linear scan over
  it per request, but the array is small (one entry per protected portal prefix), so this is
  negligible.
- `B2C_HOSTS` (line 534) is a module-level `Set`, not rebuilt per request.
- The IP-literal check (`/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)`, line 546) is a single
  regex-literal test per request, not a hot loop.
- `addSecurityHeaders()` (line 1214) sets a fixed set of static-string headers per response —
  `crypto.randomUUID()` is the only non-trivial call, and that's inherent to the request-ID feature,
  not optimizable away.
- The Upstash `Ratelimit` clients (lines 226-228) are constructed **once**, inside `ensureUpstash()`,
  guarded by a module-level `redisClient` check — not reconstructed per request.
- No `JSON.parse` of a config blob was found in the per-request path; feature-flag/config reads go
  through the existing (already-flagged-elsewhere-in-this-report) `isFeatureEnabled`/`loadFlags`
  cache rather than being parsed fresh in middleware.

---

## Phase 3 recommendations (not implemented — this is a read-only audit)

Ordered to match the findings table, highest impact first. None of these were built; each is scoped
so the assessment/backend/architect agents can pick them up independently in Phase 3.

1. **F1 (quiz-submit RPC)**: collapse the two-pass loop in `submit_quiz_results_v2` into a single
   pass (the first pass exists only to pre-compute `v_total`/`v_correct`/`v_flagged` before the
   `INSERT INTO quiz_sessions`; those aggregates could be accumulated in the same pass that already
   does the per-question work, deferring only the `quiz_sessions` insert until after the loop).
   Separately, consider batching the `quiz_session_shuffles` read for the whole response array in
   one `SELECT ... WHERE session_id = ? AND question_id = ANY(?)` instead of one `SELECT` per
   question per pass — this alone would cut the shuffle-table reads from 2N to 1. **Requires
   assessment sign-off (P1/P4 invariant surface) before any change**, per the review-chain matrix.
2. **F2 (`generateParentDigests`)**: rewrite as bulk reads — `quiz_sessions`/`challenge_streaks`/
   `guardians`/`students` all keyed by the same `student_id`/`guardian_id` sets already collected
   from the initial `guardian_student_links` read; batch with `.in()` the same way
   `nudgeFirstQuizStudents` already does in the same file, then build the per-guardian notification
   rows from in-memory `Map`s. The WhatsApp `fetch()` fan-out can stay per-recipient (external HTTP
   calls can't be batched into one SQL query) but should be parallelized with a bounded
   `Promise.all`/concurrency-limited batch rather than fully sequential.
3. **F3 (`experiment_observations`)**: add a migration-authored index
   (`CREATE INDEX ... ON experiment_observations (student_id, created_at DESC)`) and add `.limit()`
   per student (or switch to a `DISTINCT ON (student_id) ... ORDER BY student_id, created_at DESC`
   query, or a small RPC) so the route stops reading full history to derive a single "last active"
   timestamp.
4. **F4 (dashboard fan-out)**: either (a) extend `get_dashboard_data` to cover the fields the
   Alfa-OS widgets need and have `StudentOSDashboard` consume it as the primary data source, with
   the per-widget SWR hooks becoming progressive-enhancement overlays, or (b) explicitly document
   that the RPC is nav-only and intentionally superseded by the per-widget hooks — either is fine,
   but the current state (both exist, neither owns the "dashboard data" concern) should be a
   deliberate choice, not drift. Frontend + backend should jointly decide.
5. **F5 (`manageChallengeStreaks`)**: replace the per-student `UPDATE` loop with two bulk
   `.update({...}).in('student_id', mercyIds)` / `.in('student_id', breakIds)` calls.
6. **F6 (adaptive-remediation per-student flag checks)**: hoist the rollout-percentage check out of
   the per-loop-type branches — call `loadFlags()` once (already effectively cached across the 3
   existing global checks) and compute `hashForRollout(student.auth_user_id, flagName) <
   rollout_percentage` synchronously per student instead of `await isFeatureEnabled(...)` 3× per
   student.
7. **F7 (`concept_mastery` index gap)**: add
   `CREATE INDEX CONCURRENTLY ... ON concept_mastery (student_id, next_review_date) WHERE
   mastery_probability < 1` (partial index matching the reviews-due/revision-overview predicate
   shape) — architect-owned per the DB-engineering domain table; verify whether `next_review_at` vs
   `next_review_date` is intentional column duplication or drift before adding the index (worth a
   quick architect check — if one of the two columns is dead, fixing that is higher-leverage than
   indexing around it).
8. **F8 (`/api/board-score` caching)**: add `Cache-Control: private, max-age=3600` (or similar,
   matching the nightly-cron computation cadence) to the route response, and migrate
   `BoardScoreWidget` from raw `fetch`/`useState` to the shared `useSWR` pattern its sibling widgets
   already use.
9. **F9 (sequential chunk loops)**: low priority — convert the `for` + `await` batch loops to
   `Promise.all(chunks.map(...))` in the three named daily-cron functions once/if candidate-row
   counts grow past a single 200-row chunk in practice.
10. **F10 (`learner_mastery.attempts` index)**: low priority given the existing `.limit(10000)` +
    60s CDN cache already bound the cost; revisit if/when `ff_personalised_compete_v1` ramps to a
    userbase large enough that a 10,000-row scan on every cache-miss becomes measurable.
11. **F11 (middleware cookie-check dedupe)**: compute the `hasSbSessionCookie` boolean once near the
    top of `proxy()`, thread it through to the 4-5 call sites that currently recompute it.
12. **F12 (`/api/revision/overview` defense-in-depth limit)**: add an explicit `.limit()` (e.g. 200)
    as a ceiling even though the natural bound is low today — cheap insurance against a future
    schema change that removes the implicit bound (e.g. if the curriculum grows or the date window
    widens).

## Explicitly out of scope for Phase 2 (flag for a future pass if desired)

- `runVerifyPhase` and the per-signal `verify*Row` helpers in the adaptive-remediation route
  (`src/app/api/cron/adaptive-remediation/route.ts` lines 1567+) were grep-swept but not read
  line-by-line the way `runInjectPhase` was.
- The remaining ~270 API routes not touched by any of the 7 named hot paths were not audited for
  N+1/caching/payload-size issues.
- No live EXPLAIN/ANALYZE was run against any of the query shapes in §P-2 — index "OK — covered"
  verdicts are based on matching filter/sort columns against `CREATE INDEX`/`CONSTRAINT` statements
  in the migration text, not on an actual query planner check against real data volume and
  selectivity.
- Mobile (Flutter) API consumption patterns were not examined — this audit is Next.js/Supabase-only
  per the task brief.
