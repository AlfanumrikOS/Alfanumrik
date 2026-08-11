# Regression Catalog

Authoritative list of regression tests that MUST exist and pass before release.
Each entry links to the asserting test(s). Removing an entry requires explicit
user approval.

Status key: `E` = exists and passing | `P` = partial | `M` = missing.

**Total catalog: 386 entries (target: 35 — TARGET EXCEEDED).**

> Counting note (testing, 2026-08-11): this header declared **372** immediately
> before this batch while the shard-chain running counters had reached **379** —
> a pre-existing 7-entry discrepancy of exactly the kind the header itself warns
> about, and NOT introduced here. It is carried forward, not silently
> reconciled: 379 (shard chain) + 7 (this batch) = **386**, which both this line
> and the three shard totals now agree on. If a later reconciliation finds the
> shard chain was the wrong side of the discrepancy, every total shifts down by
> 7 in lock-step and the ids assigned below do not move.

Latest: REG-380..REG-386 (2026-08-11, the SEV1 fix batch for the platform's two
dominant defect classes — **failures rendered as reassuring empty states**, and
**structurally impossible features** (cross-student data read from the browser
against own-row RLS, returning exactly one row and rendered as a peer board).
Seven entries across three shards:

- **REG-380..REG-382** (`15-cross-cutting.md`) — the leaderboard batch.
  REG-380 pins the `/leaderboard` ↔ `/api/v1/leaderboard/me` ENVELOPE SEAM by
  driving the REAL route handler and the REAL `PercentileBandCard` in one test,
  with no fixture between them: the page read `.band` off the `{success, data}`
  envelope instead of off `data`, got `undefined`, and the resulting TypeError
  tripped the `SectionErrorBoundary` wrapping all seven tabs. Both sides had
  green tests; nothing tested the pair. REG-381 pins band-union TOTALITY plus a
  drift guard asserting the card's union is a superset of BOTH producers (the TS
  `bandFromPercentile()` swept 0..100, and the SQL `CASE` in migration
  `20260813000006`, which is the sole emitter of `top_50`). REG-382 pins that
  the page never reads `performance_scores` / `score_history` /
  `challenge_streaks` / `student_titles` from the browser, and pins the three
  own-scoped replacement routes incl. the `/streaks` P13 peer-field whitelist.
- **REG-383..REG-384** (`10-rbac-rls.md`) — the support batch. REG-383 pins the
  P13 leak the lane existed to close: a student must 404 on a PARENT-authored
  thread (parent tickets anchor to the child's `student_id` with
  `user_role='parent'`; the detail route filtered on `student_id` alone), with a
  FILTER-AWARE double so the assertion is behavioural rather than "an `.eq()`
  was called". REG-384 pins `replies_unavailable` as a distinct retry state, the
  operator composer's fail-safe internal default + post-send reset, the reply
  rate limiter's machine-readable 429, and category-alias normalisation.
- **REG-385..REG-386** (`03-quiz-integrity.md`) — the truthy-`[]` serving bug:
  `if (!error && data)` accepted the RPC's `COALESCE(jsonb_agg(q),'[]')`, so a
  chapter with 40 valid-but-unverified questions served ZERO and never reached
  the fallback. REG-386 pins the Tier-0 never-serve floor that the fix made
  reachable — all THREE verifier-disproved states, not just `'failed'`.

**REG-387 is now the next free id**; REG-371..REG-377 remain RESERVED.
Two defects found while writing these and reported rather than pinned as
correct: the `normalizeTicketCategory()` prototype-inheritance hole
(`10-rbac-rls.md`) and the `select_quiz_questions_rag` RPC's single-state
`verification_state` exclusion (`03-quiz-integrity.md`).

Prior: REG-379 (2026-08-10, canonical `parseOptions` / `OPTION_LETTERS` —
`JSON.parse(null)` returns `null` rather than throwing, so six of the seven
duplicate `parseOptions` copies could return `null` from a function annotated
`: string[]`, crashing the caller's `.map()` at render on the quiz, learn,
mock-exam, pyq, diagnostic and results screens. The canonical module
`packages/lib/src/quiz/options.ts` returns `[]`; the entry also freezes the two
marking-safety properties of the question-serving path — option COUNT (P6's
exactly-four) and option ORDER (bound to the server shuffle snapshot and
`selected_displayed_index`) — as explicitly invariant. 4 sub-entries
[REG-379a..d], 22 tests in `apps/host/src/__tests__/lib/quiz/options.test.ts`,
all E. Documented known gap: the literal STRING `'null'` still parses to `null`
verbatim, preserved-not-introduced from all seven originals and pinned
deliberately; tightening it is a P6 behaviour change needing assessment
sign-off. Full entry in `03-quiz-integrity.md`.)

2026-08-10 reconciliation — 4 test files deleted in the orphan-consolidation
pass, 3 catalog entries repaired, **0 entries deleted**. The deleted files were
`DailyPlanCard.test.tsx` and `DailyRhythmQueue.{blockedPrerequisite,remediation,
srs-count}.test.tsx`. Three entries cited them and were repaired IN PLACE with
the citation struck through and a reconciliation note added — REG-129
(`09-adaptive-program.md`, client half of the Loop A remediation lane;
downgraded `U`→`P` because its six client-half clauses are now unenforced,
server half fully intact via `api/rhythm/today-remediation-lane.test.ts`) and
REG-345 + REG-358 (`03-quiz-integrity.md`, SRS lane count; both stay `E` — the
~~predicate-level guarantee that makes REG-358 meaningful lives in
`srs-source.test.ts` + `api/learner/srs-due.test.ts`, never in the deleted
render test~~ **← THIS CLAUSE IS FACTUALLY WRONG. Corrected the SAME DAY by the
second-pass reconciliation below: `srs-source.test.ts` never referenced either
predicate symbol at any point, and `api/learner/srs-due.test.ts` has since been
deleted with its route.**). `DailyPlanCard.test.tsx` was cited by NO entry; only REG-220's
prose named the component, corrected in place in `10-rbac-rls.md`. The
`blockedPrerequisite` test was cited by no entry either. **Judgement: all four
were false greens, not lost coverage** — `git grep` at HEAD proves all three
`DailyRhythmQueue` tests and the `DailyPlanCard` test were the ONLY importers
of their subjects (zero production importers), and no UI in `apps/host/src` or
`packages/ui/src` consumes `GET /api/rhythm/today` at all any more. Open
obligations to re-pin the client-half clauses if either lane is ever re-lit are
recorded in both shards.

2026-08-10 reconciliation, SECOND PASS (branch
`refactor/student-phase-2-consolidation`, base `855784bc6`) — 4 artifacts
retired, **2 catalog entries corrected, 1 annotated, 0 entries added, 0 entries
deleted. Declared total UNCHANGED at 372 upper bound / 367 honest.**

Retired: `packages/ui/src/goals/StudentGoalBadge.tsx` (+ test);
`packages/ui/src/xp/XPDailyStatus.tsx` (+ barrel line);
`GET /api/learner/srs/due` (+ `api/learner/srs-due.test.ts`, route-access
manifest 399 → 398); `dashboard_cta_clicked` / `trackDashboardCta`
(`packages/lib/src/posthog/dashboard-cta.ts` + its test; type tombstoned in
`posthog/types.ts`).

**Catalog impact is narrower than the change set.** A grep of
`.claude/regression/` for all six retired symbols found citations for exactly
ONE of them:

```
$ grep -rn "srs-due.test.ts\|dashboard-cta.test\|StudentGoalBadge\|XPDailyStatus\|trackDashboardCta\|dashboard_cta_clicked" .claude/regression/
.claude/regression/00-header.md:36:      … api/learner/srs-due.test.ts …
.claude/regression/03-quiz-integrity.md:1625: (REG-358 Location column)
.claude/regression/03-quiz-integrity.md:1658: (REG-358 reconciliation note)
```

`StudentGoalBadge`, `XPDailyStatus`, `trackDashboardCta` and
`dashboard_cta_clicked` were cited by **zero** catalog entries — three of the
four retirements cost the catalog nothing.

**REG-358 (`srs_single_predicate`) — evidence CORRECTED, status stays `E`.**
The backend agent challenged its cited evidence; testing re-derived it from
source rather than accepting either side on report, and **upheld the
challenge**. Three findings, all recorded in full in `03-quiz-integrity.md`:

1. **The `srs-source.test.ts` citation was never true** — not stale, never
   true. `grep -n "SRS_DUE_PREDICATE_DESCRIPTOR\|buildSrsDueQuery"` against
   that file exits 1 (zero matches). It pins an unrelated `get_review_cards`
   RPC ⇄ adapter parity. The same false claim had been repeated in this
   header's first-pass note above; both are now struck through.
2. **`SRS_DUE_PREDICATE_DESCRIPTOR` has ZERO enforcing tests repo-wide** —
   a **pre-existing gap, NOT created by this change**. All four repo-wide
   matches are inside its own source file. `hardLimit`, `order`, `dateFilter`
   and `table` are enforced nowhere; changing `hardLimit: 100 → 5` breaks no
   test. Open obligation recorded, deliberately NOT silently closed.
3. **REG-358's thesis is now VACUOUS rather than unenforced** — the
   distinction matters. After the Phase 2 deletion and this route retirement,
   `buildSrsDueQuery` has exactly ONE production importer
   (`packages/lib/src/learn/srs-quiz-review.ts` → `/quiz?mode=srs`). The
   predicate is frozen and behaviourally tested, but "the COUNT and the CONTENT
   cannot disagree" is now a statement about a single consumer agreeing with
   itself. True, and empty. Residual value is forward-looking only: the
   multi-client `SrsQueryClient` indirection is deliberately retained so a
   future server/cron consumer must route through the same helper.

Real surviving carriers, both re-run green this session (21/21 and 44/44):
`apps/host/src/__tests__/lib/learn/srs-quiz-review.test.ts` →
`describe('fetchSrsDueQuizCards (shared due query)')` — BEHAVIOURAL, no
`vi.mock` of `srs-predicate`, so it exercises the real `buildSrsDueQuery`; and
`apps/host/src/__tests__/adaptive-differential.test.ts:797-844` — STATIC
source-text pins. Status stays `E`: the predicate shape genuinely is enforced.
It was the entry's SCOPE claim that was overstated, so the scope is corrected
rather than the status downgraded.

**REG-345 (`srs_grade_loop_closure`) — clause (3) annotated, status stays `E`.**
Its "used by BOTH the quiz deep-link content and the dashboard DailyRhythmQueue
SRS lane count" is vacuous for the same reason. Selection mechanics remain
fully enforced by `srs-quiz-review.test.ts`.

**REG-217 (`GET /api/student/daily-lab` RLS contract) — retention note added,
status stays `E`.** The route is now caller-less (only its sibling `/claim` is
invoked, from `apps/host/src/app/stem-centre/page.tsx:179`) but was
**DELIBERATELY RETAINED**, blocked pending a user decision: (a) REG-217 is its
only pin; (b) `claim/route.ts:32` imports `DAILY_LAB_BONUS_COINS` from it, so
deleting the module breaks a LIVE route; (c) its test file also guards
`BUILT_IN_SIMULATIONS_META` parity, which `/claim` depends on. Full rationale
with command output in `10-rbac-rls.md`.

Independently derived body count this pass (stated definition: distinct
`REG-N` numerals appearing either as a `##`-level heading or as the leading
cell of a table row, across the 15 non-header shards):

```
$ grep -rhoE '^#{2,4} +REG-[0-9]+' <15 shards> ; grep -rhoE '^\|[[:space:]]*\*{0,2}REG-[0-9]+' <15 shards> \
    | grep -oE '[0-9]+' | sort -n -u | wc -l
326      # max id: 379
```

**326 body-backed ids vs the 372/367 declared above.** That divergence is
PRE-EXISTING and is NOT resolved here — it is the same class of gap the
"Honesty note on the declared total" below already tracks (REG-361..REG-365
narrated but never filed), and closing it needs a full shard-by-shard audit,
not a drive-by edit. Recorded so the next reader has a measured number rather
than only a carried-forward one. This pass itself is count-neutral: 0 added,
0 deleted.

Prior: REG-378 (2026-08-09, Node.js toolchain version pin — every surface
that can choose a Node is pinned to 22.x and none may float; `engine-strict`
makes the real floor 22.22.0, not 22.0.0. Full entry further down this file
and in `11-infrastructure.md`. REG-371..REG-377 remain RESERVED.)
Prior: REG-367..REG-370 (2026-08-05, Student-OS IA consolidation —
four guards for ONE failure class: a cross-file contract that no compiler,
linter, type or render test relates, so when the two sides disagree NOTHING
fails and the student silently gets a duplicated panel, an unreadable label,
a clipped ring, or a 404. REG-367 AppShell rail/aside breakpoint parity —
`StudentOSDashboard` renders `MasterySnapshot`/`RevisionRail` twice on
purpose and relies on CSS to show one; the Tailwind `{bp}:hidden` numbers in
the TSX had drifted from the `@media (min-width:)` numbers in
`packages/ui/src/globals.css`, double-rendering across 768-1023px and
1024-1279px. The guard resolves the Tailwind breakpoint to PIXELS and
compares it to the media query PARSED OUT OF globals.css at test time, with
a brace-aware CSS reader that THROWS rather than defaulting, the
no-`theme.screens`-override precondition asserted, both markup hooks proven
to carry zero CSS rules anywhere, the two-copies premise pinned, and both
shipped regressions proven to FLAG. REG-368 MasteryRing centre-label fit —
the fallback label was hardcoded `text-xs` regardless of `size`, painting
over the stroke at the Foxy 40/4 geometry; tests RENDER the barrel-exported
component and read `style.fontSize` off the DOM rather than restating the
implementation's own formula (which would pin nothing), judge fit with a
model deliberately STRICTER than the component's, carry an explicit
regression witness that the old 12px would NOT have fit, and pin the default
size=64 at exactly 12px as the no-visual-regression guarantee. REG-369
internal-link canary — `BoardScoreWidget` shipped an AnswerChecker™ CTA to
`/answer-checker`, a path with no page and no redirect, 404ing for exactly
the engaged students it targeted; the canary enumerates the App Router tree
+ the `redirects()` sources and resolves every LITERAL internal href, with
non-vacuity floors asserted, the `/answer-checker` case pinned as a HARD
non-allowlisted assertion, and DELIBERATE limits stated (literal hrefs only,
no `router.push`, no `/api/*`) so passing is never over-claimed. **REG-369
carries a documented anti-rot allowlist of exactly TWO pre-existing dead
links — `/super-admin/students` and `/upgrade` — each a real user-visible
404 that predates this pass; a dedicated test asserts each is STILL dead AND
STILL linked, so the moment either is fixed the suite FAILS and forces the
entry to be DELETED. The allowlist cannot rot into permanent cover.**
REG-367..369 in `15-cross-cutting.md`. REG-370 Foxy MasteryAwareness ring
no-shrink — the 40px ring is a flex sibling of a `flex-1 min-w-0` text block,
so a long topic title compressed its box and clipped the stroke; the fix is
ONE wrapper `div` carrying `shrink-0`, because `MasteryRing` takes no
`className` — trivially lost in a refactor with no type error to announce
it. Pinned on the RENDERED tree in BOTH languages (P7 — the Hindi title is
longer, so the squeeze is worse), together with the flex-sibling coupling
that makes the guard necessary, the deliberate ASYMMETRY that the text block
must STAY shrinkable for `truncate`, and the 40/4 geometry shared with
REG-368; `02-foxy-ai.md`. All four are static/DOM canaries, not
browser-truth: JSDOM evaluates no media query and computes no layout, so
REG-367/368/370 verify the contract or the guard is PRESENT, not that a
browser honours it — a visual-regression run would be strictly stronger and
is not part of this pass. Sanity: the 4 new suites plus the
`parent-calendar-live-events` suite touched for a pre-existing timeout flake
were re-run green in ONE vitest pass from apps/host — 74/74, 5 files.
**Renumbered from REG-345..REG-348 during the 2026-08-05 rebase:** upstream
PR #1465 (Foxy North-Star, 7-commit program) reached `main` first and
consumed REG-345..REG-366, so per this catalog's numbering convention — the
side that reaches `main` first keeps its ids — this batch moved up by 22.
No upstream entry was dropped, reworded or renumbered; only these four
numerals moved, and the total grew by 4.)
Prior: REG-366 (2026-08-05, K9 leadership standalone-route fold-in — the
`/school-admin/leadership` standalone route is retired; the nav Leadership
entry now deep-links to `/school-admin/reports?tab=leadership` and the
LeadershipTab loads inside the existing school-admin reports tab strip
behind `ff_school_pulse_v1` staged (5%→25%→100%), mirroring the Phase 1
safeguarding fold-in precedent (P10 bundle boundary). Pinned by
`apps/host/src/__tests__/school-admin/reports-leadership-tab.test.tsx` +
`apps/host/src/__tests__/school-admin/consolidated-nav-mobile.test.tsx`; see
`07-teacher-school.md`.
Prior: REG-361..REG-365 (2026-08-05, Foxy North-Star Phase 5 Stakeholders +
Play batch — five pins across three shards covering the ~50-file uncommitted
Phase 5 change set on branch `Alfanumrik/foxy-system-spec-22f565`.
REG-361 U10 leaderboard percentile-band contract [E]: `/api/v1/leaderboard/me`
returns a percentile band descriptor ONLY (`top_10` / `top_25` / `top_50` /
`keep_going`), NEVER an absolute rank or a `(You)`-tagged position;
`PercentileBandCard` renders bands only; top-N leaderboard tiles unchanged;
`/me` responses are private-cached; pinned by
`apps/host/src/__tests__/api/v1/leaderboard/me.test.ts` +
`packages/ui/src/leaderboard/PercentileBandCard.tsx` + migration
`20260813000006_leaderboard_percentile_rpc.sql`; see `03-quiz-integrity.md`.
REG-362 K3/S1.8/R5 evidence P13 boundary [E]: the teacher-facing evidence
payload attached to remediation alerts carries only bounded fact records
(attempts, incorrect count, hint_level_max, misconception_ids, timestamps,
UUIDs) — never `name`/`email`/`phone`/free-text answer content or transcripts;
pinned by `packages/lib/src/__tests__/teacher/remediation-evidence.test.ts` +
migration `20260813000002_remediation_evidence_column.sql`; see
`03-quiz-integrity.md`.
REG-363 K5 draft quarantine [E]: `teacher_assignment_drafts` has EXACTLY
TWO policies (teacher_own_all + service_role_all) — deliberately NO
student, parent, or authenticated read path until the publish action stamps
`published_assignment_id`; pinned by
`apps/host/src/__tests__/security/teacher-assignment-drafts-rls.test.ts`
(NEW — 6 tests structural pin) + migration
`20260813000004_teacher_assignment_drafts.sql`; see `10-rbac-rls.md`.
REG-364 K4 teacher.override event kind [E]: the six new teacher.decision /
teacher.override event kinds are declared with a bounded payload enum only
(no free-text `reason`/`comment`); both event registries (Next
`packages/lib/src/state/events/registry.ts` + Deno
`supabase/functions/_shared/state-runtime/events-registry.ts`) agree on the
exact shape; pinned by `apps/host/src/__tests__/state/events-registry.test.ts`
+ migration `20260813000003_adaptive_interventions_teacher_decision.sql`;
see `12-observability.md`.
REG-365 K9 leadership read-model P13 contract [E]: the two SECURITY DEFINER
RPCs added by migration `20260813000005_leadership_readmodels.sql`
(`get_school_safeguarding_counts`, `get_school_competency_summary`) return
ONLY counts and averages — the SQL bodies never SELECT `student_id`,
`disclosure_excerpt`, `email`, `phone`, or `full_name`; each is guarded by
an active-school-admin scope guard before any read, both revoke PUBLIC/anon
and grant EXECUTE only to authenticated; pinned by
`apps/host/src/__tests__/migrations/leadership-readmodels-p13.test.ts`
(NEW — 6 tests structural pin, integration lane); see `10-rbac-rls.md`.
Prior: REG-359..REG-360 (2026-08-05, Foxy North-Star Phase 4 wave 4a/4b
batch — REG-359 promotes the Foxy route CHARACTERIZATION FIXTURES suite
(11 seeded + 5 pending, 20-flag OFF-identity sweep) into
`02-foxy-ai.md` as the R3 pipeline-decomposition tripwire (runbook
`docs/runbooks/foxy-r3-decomposition-plan.md`); REG-360 pins the FoxyPanel
embed static-import guard (P10 bundle boundary) — no
`apps/host/src/app/**/page.tsx` may statically import
`@alfanumrik/ui/foxy-panel/*`, only the sanctioned tap-gated launcher
`@alfanumrik/ui/foxy-launcher/*` — runbook
`docs/runbooks/foxy-panel-embed-rollout.md`.
Prior: REG-354..REG-358 (2026-08-05, Foxy North-Star Phase 3 Adaptive +
Check loop batch — five pins across `03-quiz-integrity.md` (REG-354, 355,
356, 358) and `02-foxy-ai.md` (REG-357) covering the ~50-file uncommitted
Phase 3 change set on branch `Alfanumrik/foxy-system-spec-22f565`.
REG-354 XP capped-award contract [E]: `award_xp_capped` RPC in migration
`20260809000300` is SECURITY DEFINER + service_role-only EXECUTE (browser
callers cannot invoke); per-source idempotency via `p_reference_id` on the
partial-unique `xp_transactions_reference_id_uniq` (replay returns
`effective_xp: 0`); IST day boundary anchor (`date_trunc('day', now() AT
TIME ZONE 'Asia/Kolkata')` — extends REG-318's mixed-anchor fix); the three
Phase-3 lane amounts (`retention_award=6`, `remediation_recovery_award=15`,
`thoughtful_question_award=5`) sum to a daily maximum of 71 XP — <<< the
200 XP `quiz_daily_cap`; `awardXpCapped` helper (`packages/lib/src/xp-award.ts`)
never throws / rejects / defines an XP number (all amounts + caps come from
XP_RULES at the call site).
REG-355 hint-ladder P3 lock [E]: `nextRung()` returns
`{ok:false, reason:'locked_pre_attempt'}` when pre-attempt — the P3 lock
lives IN the state machine, no UI loop can bypass; rung 5 is the HONEST
skip-only descriptor (`source:'skip', kind:'skip'`) with same-topic
evidential twin deferred (TODO(L5) in module header, plan-tracker E5/L5);
hint_level widened 0..5 via migration `20260809000400` with USING-clamp
preserving existing rows; `HintLevel` type = `0|1|2|3|4|5`; unhinted
XP bonus keys off `hint_level === 0`.
REG-356 transfer-evidence direction & registry parity (D12) [E]: canonical
RPC call inverts pure-module naming (`p_topic_id = rec.fromTopicId` = SOURCE,
`p_from_topic_id = rec.topicId` = TARGET — mastery lands on the already-solid
prerequisite); bus payload uses `sourceTopicId`/`targetTopicId` role-anchored
keys; BOTH event registries (Next `packages/lib/src/state/events/registry.ts`
+ Deno `supabase/functions/_shared/state-runtime/events-registry.ts`) declare
that shape and only that shape; a new repo-wide static test
(`apps/host/src/__tests__/regressions/phase3-transfer-event-payload-shape.test.ts`,
5 pins) confirms NO non-test source file pairs the `'learner.transfer_evidence'`
kind literal with a payload literal carrying the pre-fix keys — closes the
assessment "no other consumer besides journey/edge registry depended on old
sourceTopicId names" concern.
REG-357 IRT shadow serving-order-unchanged + telemetry P13 [E in
02-foxy-ai.md]: `select_questions_by_irt_info_v2` (migration `20260809000100`)
is a shadow-only extension — return set + ORDER BY identical to v1, so
quiz-question serving order is unchanged whether callers read v1 or v2;
`ff_irt_shadow_v1` (seed `20260809000000`, default OFF/0%) gates ONLY
telemetry emission, not selection; `estimateTheta` (`packages/lib/src/irt/
estimate-theta.ts`) is a pure TS mirror of the Newton-Raphson for
shadow-metric computation; `/api/telemetry/irt-shadow` payload carries
UUIDs + numbers + a short `served_via` enum only (P13). Honest gap: the
20260809000100 migration has never executed against real Postgres this
session.
REG-358 SRS single predicate [E]: `packages/lib/src/learn/srs-predicate.ts`
freezes `SRS_DUE_PREDICATE_DESCRIPTOR` (`is_active=true`,
`source='quiz_wrong_answer'`, `source_id IS NOT NULL`, `next_review_date <=
today`, `ORDER BY next_review_date ASC`, defaultLimit 50, hardLimit 100)
and exposes `buildSrsDueQuery`, ~~called by BOTH the client-side deep-link
consumer (`srs-quiz-review.ts` → `fetchSrsDueQuizCards` →
`selectSrsReviewSet`) AND the server-side `/api/learner/srs/due` route AND
the `DailyRhythmQueue` count — the dashboard SRS lane COUNT and the
`/quiz?mode=srs` CONTENT cannot disagree because they resolve through the
same predicate object~~ **← superseded 2026-08-10 (second pass): TWO of those
three consumers are gone (`DailyRhythmQueue` deleted in Phase 2;
`/api/learner/srs/due` retired once caller-less), leaving the client-side
deep-link path as the SOLE production consumer. The predicate is still frozen
and behaviourally tested, but the count-vs-content clause is now VACUOUS.**;
closes the drift REG-345 pinned at the fetcher level
one layer deeper at the predicate level.)
Prior: REG-351..REG-353 (2026-08-05, Foxy North-Star Phase 2 Canonical
Learner Model batch — three pins in `03-quiz-integrity.md` covering the
~70-file uncommitted Phase 2 change set on branch
`Alfanumrik/foxy-system-spec-22f565`.
REG-351 canonical-facade lockstep [E]: the `@alfanumrik/lib/learner-model`
facade's thresholds/BKT mirror are pinned to BOTH RPC migrations
(`20260623000100` canonical + `20260807000400` evidence re-creation — SQL
WINS on divergence); `bkt-mirror.ts` is display-only (no supabase import,
posterior parity fixtures); the 5-rung next-action ladder order survived the
move verbatim (`getNextAction` IS `deriveNextAction`); sub-entry REG-351d
pins the confidence_score SCALE SHIFT (Beta-posterior variance replaces the
pseudo-decay: 1-attempt blend ≈ ×0.944 vs old ×0.773, hard floor ×0.9167)
plus the consumer-survival result — the progress-page/KnowledgeGapActions
severity split consumes gap-RPC confidence derived as `1 −
mastery_probability` (20260623000700/000800 never read
`cm.confidence_score`), so its >0.7/>0.4 semantics survive; REG-351e pins
every `student_skill_state` reader fail-soft on empty/error (new file
`skill-state-reader-fallbacks.test.ts`).
REG-352 event-capture contract [P — structural pins only, zero live-Postgres
this session]: D2 server-held `question_version`/`content_hash` from
`quiz_session_shuffles` with NO client-suppliable parameter; D3 answer_method
whitelist ELSE 'mcq' + D6 confidence `'^[1-5]$'` else NULL
(normalize-never-abort, P4); D7 misconception match on the ORIGINAL-space
index with per-iteration reset, error-isolated open/resolve lifecycle
(`uq_student_misconceptions_open`, one open row per student+pattern+concept),
free-text columns never written (P13).
REG-353 consolidation ratchet [E]: single-BKT analyzer gate (allowlist ==
exactly `packages/lib/src/cognitive-engine.ts`; deleted copies gone from
source), retired-table baselines frozen (`cme_concept_state: 6`,
`topic_mastery: 20` — analyzer FAILs on growth), cme-engine tombstone
(structured 410 `cme_engine_retired`, 401 posture preserved, facade
replacement pointer, `cme_concept_state` COMMENT-tombstoned in
`20260808000100`); deployed-state caution: verify with
`supabase functions list` post-merge.)
Prior: REG-348..REG-350 (2026-08-05, Foxy North-Star Phase 1 Safety & Trust
batch — three pins in `02-foxy-ai.md` covering the ~40-file uncommitted
Phase 1 change set on branch `Alfanumrik/foxy-system-spec-22f565`.
REG-348 safeguarding two-tier fail-closed contract [E]: after a Tier-1 regex
hit, ANY Tier-2 gateway failure (all-failed / throw / unparseable / empty /
NaN-confidence / wrong-shape JSON) resolves to `{confirmed:true,
tier:'regex_only'}` — a disclosure can never silently degrade to "no
escalation" because a model was down; downstream the route terminates the
turn with the bilingual Childline-1098 helpline envelope, inserts the
escalation row (500-char excerpt cap, confidence+label-only classifier_meta),
fans out WITHOUT the excerpt, REFUNDS the quota unit, never calls the LLM,
awards 0 XP; ambiguous verdicts continue the turn normally in both the
module and route lanes; `ff_safeguarding_v1` OFF → Tier-1 never invoked
(zero classifier calls — the rollback contract). REG-349 safeguarding P13
data boundary [E]: `disclosure_excerpt` is the ONE sanctioned home for
disclosure text; notifications carry `{escalation_id, category}` only, the
super-admin + school-admin review LIST projections never select the excerpt
(only `?id=` detail does), school-admin queries hard-scoped to caller
school_id on every verb, PATCH `pending_review→reviewed/actioned/dismissed`
only with 409 on non-pending and metadata-only audit. REG-350 memory
self-access + scoped erasure [E on TS surfaces, migrations structural-only]:
migration `20260806000100` pinned RLS-enabled with EXACTLY ONE service_role
policy and the DELIBERATE-DEVIATION comment present (no
student/parent/teacher read path — new structure test
`safeguarding-escalations-migration.test.ts`, 8 tests); `/api/learner/memory`
GET whitelists the student projection (twin ALWAYS null, cohortPercentile/
loSkills/knowledgeGaps/nextAction asserted absent) with erasure-guard
fail-closed blank; scoped DELETE rows route into the scope-aware
`execute_data_erasure_purge` RPC and NEVER the full-account cascade, with
`parent.child_erasure_completed` reserved for full-account rows. Honest
gap: zero live-Postgres execution of the 20260806* migrations this session.)
Prior: REG-345..REG-347 (2026-08-05, Foxy North-Star Phase 0 gate batch —
three pins in `03-quiz-integrity.md` covering the ~23-file Phase 0 change set.
REG-345 SRS grade loop closure [E]: `/quiz?mode=srs` grades each served
`spaced_repetition_cards` card EXACTLY ONCE via the existing
`POST /api/learner/review/grade` endpoint with the zod-accepted quality set
{0,3,4,5} mapped from server-truth `is_correct` + speed (correct <10s→5 else
4; wrong→ALWAYS 0, never 3 — SM-2 treats quality>=3 as successful recall, so
3 for a wrong answer would advance the interval; only the flashcard UI may
send 3 — re-pinned 2026-08-05 per assessment mandate, superseding this
entry's original "wrong <5s→0 else 3" mapping),
fire-and-forget/never-throws, and the dashboard SRS
lane COUNT and the quiz CONTENT both flow through the ONE shared
`fetchSrsDueQuizCards` + `selectSrsReviewSet` pair so they can never disagree;
plus the F4 rider that `classifyError` receives REAL per-topic mastery with
0.5 only as the explicit no-row fallback. REG-346 hint_level end-to-end
persistence [P]: UI captures 0-3 at answer time, `_mapV2` forwards verbatim
(omitted → undefined → SQL NULL) without disturbing the v2 strip contract,
migration `20260805100100` adds the nullable CHECKed column, `20260805100200`
regex-guards (`^[0-3]$`) so malformed payloads can never abort the submit
transaction, and a sanctioned-sites sweep proves v_hint_level feeds NO
scoring/XP/anti-cheat logic — P, honestly: zero live-Postgres execution of
either migration this session, structural pins only. REG-347 IRT resurrect
behavior-neutrality [P]: quiz-generator's `useIRT` gate is live code reading
`ff_irt_question_selection` (requires enabled AND rollout ≥100, FAIL-CLOSED
on read error; flag seeded OFF/0%, posture unchanged — F9 only corrected the
self-contradictory reason text), the RPC call pinned to the exact six
baseline:~6702 arg names with the `question_id`→`id` row normalization —
explicit known gap: NO Deno-lane test executes the flag-ON branch; new pin
file `apps/host/src/__tests__/regressions/foxy-phase0-structural.test.ts`
(11 tests). Full-suite + type-check + lint run as the Phase 0 gate in the
same session.)
Prior: REG-344 (2026-08-04, P2-2 API response-envelope wrapper — pins
`withRoute()` [`packages/lib/src/api/v2/with-route.ts`], the shared
error-safety net now adopted by the 11-route `/v2` reference slice: a
successful handler's `NextResponse` (success OR a deliberate non-200
`v2Error`) is returned by reference, never rewrapped; an unhandled throw
ALWAYS becomes the fixed `v2Error('Internal server error', 500,
'INTERNAL_ERROR')` envelope with the caught error's message/stack/cause
NEVER serialized into the response body (P13), full detail logged
server-side only via the structured `logger`; `x-request-id` is echoed
verbatim if the caller supplied one, else generated, attached ONLY on the
error path; `opts.onError` fires with the raw caught value on the error
path and never on the happy path; and `ctx.params` [Next 16's
`Promise<SegmentParams>` shape] is forwarded to the handler by the exact
same Promise reference, unread. A companion static ratchet
[`scripts/check-route-wrapper-ratchet.mjs` +
`scripts/route-wrapper-adoption.json`] re-derives live `withRoute` adoption
across every `apps/host/src/app/api/**/route.ts` on each run and fails if
it ever drops below the recorded floor (11); see `11-infrastructure.md`.)
Prior: REG-336..REG-343 (2026-08-03, P0+P1 launch-hardening batch — eight
pins across five shards, catalogued in one pass. REG-336 setup-plans
caller-contract migration: the x-admin-secret/service-role-key header gate
is REMOVED in favour of a session-based `authorizeAdmin(request,
'super_admin')` floor — the formerly-CORRECT header alone now 401s with zero
Razorpay calls, and accepted invocations write a metadata-only provisioning
audit (P11/P9; `04-payments.md` — the stale REG-160 setup-plans prose was
rewritten to the new contract in the same pass, per the 2026-08-03 architect
review). REG-337 P2 XP literal parity in the two parent-facing Deno Edge
Functions (parent-report-generator + parent-portal): the canonical
`correct*10` / `+20 @ >=80` / `+50 @ ===100` shapes pinned against XP_RULES
by code-shaped regexes with a drift sweep over EVERY `xp +=` literal, and
the regressed `+25` / `?30:0` shapes pinned ABSENT (`05-xp-scoring.md`).
REG-338 usePortalFetch timeout envelope: friendly bilingual timeout copy
chosen from `isHi` AT CALL TIME (P7), non-abort errors rethrown as-is, and
the anon-apikey + session-Bearer + `{action,...params}` envelope pinned for
every teacher/parent portal Edge-Function call (`07-teacher-school.md`).
REG-339 verifyCronAuth consolidation: all 23 `/api/cron/*` +
`/api/internal/cron/*` routes authenticate through ONE fail-closed helper
(`packages/lib/src/cron-auth.ts`) — Bearer/x-cron-secret carriers only, the
leaked-into-access-logs `?token=` query carrier REMOVED (never consulted at
all), first-present-wins, constant-time compare — pinned at the helper level
(13 tests) AND across 4 re-pinned route carrier matrices, with
`/api/cron/daily` pinned DELETED and the admin-client allowlist (269→268) +
route-access manifest (390 entries === 390 route files on disk) ratcheted in
lock-step (`10-rbac-rls.md`). REG-340 global SWR provider: `<SWRProvider>`
mounted OUTERMOST in the root layout wiring DEFAULT_CONFIG into
`<SWRConfig>`, so no `useSWR` call site regresses to unbounded library-
default retries (`11-infrastructure.md`). REG-341 proxy school-lookup
fail-open: transient tenant-lookup failures (non-2xx / thrown / 3s timeout)
NEVER write the 60s negative cache and NEVER hard-404 a white-label tenant —
last-known-good is re-served or the request fails open on a 5s error cache;
only a definitive empty-200 may 404 (`11-infrastructure.md`). REG-342 the
exact-SHA production health poll lives ONLY in `deploy-production.yml` —
reintroducing a ci.yml health-check job is a mutation-proven contract
failure (`11-infrastructure.md`). REG-343 coverage-gate integrity, recorded
honestly as PARTIAL: `vitest.config.ts`'s coverage include had measured ~402
apps/host re-export stubs and NONE of the canonical packages/lib+ui code, so
the global floors and every per-file threshold (incl. the 90% XP floors)
were tautologies; repaired with `allowExternal: true`, bare
`packages/{lib,ui}/src/**` include globs, per-file threshold keys in the
ONLY form vitest's anchored relative-path match can reach
(`'../../packages/...'`), and floors recalibrated on the honest surface —
each mechanic empirically verified against vitest 4.1.8, but NO enforcing
meta-test on the config shape yet, an explicit known gap
(`11-infrastructure.md`). Sanity for the whole batch: the 14 pin/companion
test files were re-run green in ONE vitest pass from apps/host — 191/191.)
**REG-344 is the next free id.** That was true before this pass and is
superseded above — the P2-2 API response-envelope wrapper regression took
REG-344 on 2026-08-04, then the Foxy North-Star Phase 0 gate batch took
REG-345..REG-347 on 2026-08-05, and the same-day Phase 1 Safety & Trust
batch then took REG-348..REG-350, then Phase 2 Canonical Learner Model took
REG-351..REG-353, Phase 3 Adaptive + Check took REG-354..REG-358, and the
Phase 4 wave 4a/4b promotion + FoxyPanel guard took REG-359..REG-360.
(REG-361..REG-365 taken by the Phase 5 Stakeholders + Play batch above;
REG-366 taken by the same-day K9 leadership standalone-route fold-in.) That
made REG-367 the next free id, and the same-day Student-OS IA consolidation
batch then took **REG-367..REG-370**, so REG-371 was the next free id at that
point. That is superseded below — the 2026-08-09 Node.js version-pin batch took
**REG-378**, so REG-379 was the next free id and REG-371..REG-377 remain
RESERVED (see the ID-collision note immediately below). That is in turn
superseded above — the 2026-08-10 canonical-`parseOptions` consolidation took
**REG-379**, so **REG-380 is now the next free id.**

2026-08-09: **REG-378 — Node.js toolchain version pin** (deployment-config
change; architect made it, P14 chain architect → ops, testing). Every surface
that can choose a Node — 5 workspace `package.json` `engines` blocks (the root
one previously ABSENT), all 3 `Dockerfile` stages (`node:20-alpine` →
`node:22-alpine`), 5 GitHub Actions workflows (incl. `playwright.yml`'s floating
`lts/*`), and `.nvmrc` — is pinned to 22.x, with a new root `.npmrc` carrying
`engine-strict=true` so a wrong Node cannot silently produce a build. Guard:
`apps/host/src/__tests__/regressions/reg-378-node-version-pin-drift.test.ts`
(21 tests) re-derives every pin from the files on each run, resolves workflow
`${{ env.* }}` against SAME-FILE scope only (a cross-file expression expands to
the empty string and unpins setup-node exactly like `lts/*`, so it is a FAILURE
not a skip), rejects all floating aliases, re-derives the workspace set from the
root `workspaces` globs rather than a hand-copied list, and — because
`engine-strict` applies to the WHOLE tree — re-derives the real `npm ci` floor
from `package-lock.json` (`posthog-node → ^20.20.0 || >=22.22.0`, i.e. **22.22.0,
not 22.0.0**) and fails if `.npmrc`'s documented number goes stale. Scans exclude
`node_modules/`, `.next/`, `.claude/` (agent worktrees there still carry
`FROM node:20-alpine` — the exclusion is proven load-bearing), and deliberately
INCLUDE `python/Dockerfile` (a `python:3.12-slim` image with zero `FROM node:`
lines: inert today, governed the day a Node stage appears). Honest gap, recorded
in the shard: **no static test can prove a CI runner or the Vercel build image
resolves `22` to >= 22.22.0** — `setup-node` prefers the runner's tool cache over
the newest release unless `check-latest: true`, and a resolution below the floor
turns `engine-strict` into a pipeline-wide `npm ci` failure. Entry + mitigations
in `11-infrastructure.md`. Taken as REG-378 (not 371) to leave REG-371..REG-377
reserved to the pending ops renumbering pass described next.

ID-collision note (2026-08-05, resolved): the Student-OS IA consolidation
batch was authored as REG-345..REG-348 while still uncommitted. Upstream
PR #1465 (Foxy North-Star, 7 commits) reached `main` first and consumed
REG-345..REG-366 — including its own, unrelated REG-345 (SRS grade loop
closure) and REG-348 (safeguarding two-tier fail-closed contract). Per this
catalog's established convention (the side that reaches `main` first keeps
its ids; the not-yet-merged side renumbers up — the same resolution used for
the 2026-08-03 REG-332/333 and the 2026-07-29 REG-322..325 collisions), the
IA batch was renumbered REG-345→REG-367, REG-346→REG-368, REG-347→REG-369
and REG-348→REG-370: heading, table-row id and every cross-reference updated
in `02-foxy-ai.md` and `15-cross-cutting.md`. No upstream entry was dropped
or reworded. Separately, the ops-owned spec
`docs/superpowers/specs/2026-08-05-student-ia-consolidation-design.md` had
proposed REG-349..REG-355 (which the same upstream merge also collides
with); ops is renumbering those to REG-371..REG-377 in a parallel pass — if
that batch lands, the next free id becomes REG-378. Anything still reading
"REG-345 is the next free id", or attributing REG-345..REG-348 to the IA
consolidation batch, is stale.

Honesty note on the declared total (2026-08-05, unresolved — upstream gap, not
this batch's): the 370 above is 366 (upstream PR #1465's own declared total) +
this batch's 4. It is a carried-forward number, not an independently derived
one. A direct sweep of every shard at rebase time found **REG-361 through
REG-365 narrated in this header but with NO body entry — no `## REG-N`
section and no `| REG-N |` table row — in ANY shard.** The header points them
at `03-quiz-integrity.md`, `10-rbac-rls.md` and `12-observability.md`; they
are in none of those files, and the only string match for any of them outside
this header is REG-365 cited *inside REG-366's* row in `07-teacher-school.md`.
Of the Phase 5 batch only REG-366 was actually filed. Their pinning test files
may well exist; the catalog rows do not. Until upstream files those five (or
confirms they were counted in error), treat 370 as an upper bound — if they
were counted but never written, the honest total is 365. This affects only the
total, never the ids: REG-361..REG-365 are RESERVED to upstream's Phase 5
batch either way and must not be reissued.
(2026-08-09 addendum: REG-378 adds exactly one filed, body-backed entry, so the
same bracket now reads **371 upper bound / 366 honest**. REG-378 itself is
filed — `## REG-378` heading plus `| REG-378 |` table row in
`11-infrastructure.md` — and is not part of the unresolved gap above.)
(2026-08-10 addendum: REG-379 adds exactly one more filed, body-backed entry —
`## REG-379` heading plus four `| REG-379a..d |` table rows in
`03-quiz-integrity.md`, counted as ONE entry — so the bracket now reads
**372 upper bound / 367 honest**. The REG-361..REG-365 upstream gap above is
still unresolved and untouched by this pass. The same-day deletion
reconciliation changed no count: 3 entries were repaired in place, 0 deleted.
The same-day SECOND-PASS reconciliation — the four-artifact retirement on
`refactor/student-phase-2-consolidation` — likewise changed no count: REG-358
corrected, REG-345 annotated, REG-217 annotated, 0 added, 0 deleted, so the
bracket still reads **372 upper bound / 367 honest**. That pass DID record an
independently derived body-backed figure of **326** distinct `REG-N` ids across
the 15 shards, which agrees with neither number above; the discrepancy is
pre-existing, is flagged in that note, and remains open.)
Prior: REG-335 (2026-08-03, OpenAI-primary percentage-rollout mechanism —
built ON TOP OF the already-committed REG-334 flat swap [commit `5e6ffa9f`],
still uncommitted at review time. New flag `ff_foxy_openai_primary_rollout_v1`
[seeded OFF/0% by a parallel architect migration] adds a deterministic
per-caller lever, via the pre-existing salted `hashForRollout` family [NOT the
three other, differently-salted hash-bucketing implementations already in this
codebase — confirmed by direct side-by-side source reading, not just a passing
parity test], to dial a controlled percentage of traffic back to the
reconstructed Claude-primary order instead of REG-334's unconditional 100%
default. Fail-safe always toward OpenAI-primary; the no-caller-id case never
even reads the flag. Independently re-run by testing, not taken on the
building agent's report alone: Deno 228/228 (19 CI-scope `grounded-answer`
files + 1 new file, both sub-counts re-verified separately), vitest 486/486 in
`src/__tests__/lib/ai/`, `tsc --noEmit` clean. `git diff` against `5e6ffa9f`
confirmed `LEGACY_FALLBACK_ORDER`/`legacyChain()`/`selectModelChain` are
byte-for-byte unchanged, so REG-334's own pin never traverses the new code
path and remains valid. **UPGRADED to E (2026-08-03, same-day testing
follow-up):** was marked PARTIAL for two gaps — (1) the new 15-test Deno
suite (`model-rollout-flag.test.ts`) not yet in `DENO_TEST_TARGETS`
[the same failure class REG-317 pinned elsewhere], now wired in by
architect and confirmed by a fresh CI-scope run (20 files, 237/237 passing,
up from 19 files/228 — the other 19 files also grew tests from the same
session's cache-order-blindness fix, not a discrepancy); (2) a related
architect migration's open TS-companion + test-count-pin obligation on the
`protected_feature_flags` DB/TS parity guard [low practical risk while the
flag stayed seeded OFF/0%], now closed — ai-engineer applied the TS
companion, testing fixed its own two stale test files (verified failing in
exactly the predicted 5 ways first, 62/67, then fixed and re-verified
69/69 green). See `02-foxy-ai.md` for the full accounting, the closure note,
and the honest "599/599" reproduction shortfall [three good-faith
reconstructions all passed 100% but none matched 599 exactly].
**REG-336 is the next free id.**)
Prior: REG-334 (2026-08-02, Model Gateway OpenAI-primary provider swap — a
CEO-directed cost swap flipped `MODEL_FALLBACK_ORDER`
[`supabase/functions/grounded-answer/config.ts`] and `LEGACY_FALLBACK_ORDER`
[`packages/lib/src/ai/gateway/registry.ts`] from Anthropic-primary to
OpenAI-primary for every preference key (gpt-4o-mini/gpt-4o now run FIRST,
Claude Haiku/Sonnet retained as the reliability fallback tier, not deleted),
gated behind a fast Claude-graded output-quality validation pass
[`eval/openai-migration/` harness] before canary ramp, per RCA-FIX
CRITICAL-1's Claude-calibration concern. Shared infrastructure — the same
config also re-orders ncert-solver's grounded path and the
quiz-generation/verification prompt templates. A NEW explicit regression pin
(`router.test.ts`: "default chain is OpenAI-primary post 2026-08 cost
directive, Claude retained as fallback") asserts the new order on both model
ids and providers so a future accidental revert is caught immediately, the
same way the pre-swap order used to be pinned; the Deno↔TS parity test
[REG-308] now anchors the new order on both sides; every gateway/router test
whose mock adapter map implicitly relied on the pre-swap order (only an
`anthropic` entry present, silently never reaching the real unmocked
`openaiAdapter`) was restructured to mock both providers explicitly, closing
the test-hermeticity gap the reorder exposed — including the Deno-side
`grounded-answer/__tests__/claude.test.ts`. A companion Sonnet model-ID drift
fix (`claude-sonnet-4-6-20251022`→`claude-sonnet-4-20250514`) shipped in the
same change; a same-session ai-engineer follow-up closed the gap this entry
originally flagged as open, and an independent direct-read reconciliation
(2026-08-02) confirms the corrected id is now applied with no residual gap
across all 11 live source files that referenced it (`registry.ts`,
`grounded-answer/config.ts`, MoL's TS `router.ts`/`telemetry.ts`/`grader.ts`/
`grader-cron.ts`, `_shared/security/quota.ts`, and Python
`mol/cost.py`/`router.py`/`grader.py`/`grader_cron.py` — the last of these,
`grader.py`, was found during this reconciliation and had never been named
in either the original "verified applied" or "Known gap" lists), with every
corresponding test (incl. `grader-cron.test.ts`'s mock fixture) updated to
match. See `02-foxy-ai.md` for the full file-by-file accounting and REG-308's
correction note.)
Collision note (2026-08-03): the pair immediately above was authored on this
branch as REG-332 (Model Gateway OpenAI-primary provider swap) and REG-333
(OpenAI-primary percentage-rollout mechanism). Independently, `origin/main`
had ALSO taken REG-332 and REG-333 — for two unrelated fixes, both directly
below (grounded-answer content-readiness precheck, 2026-08-01;
`select_quiz_questions_rag` verification gate, 2026-08-02) — and merged to
main first. Per this catalog's established numbering convention (the side
that reached `main` first keeps its ids; the not-yet-merged side is
renumbered up — the same resolution already used for the 2026-07-29
REG-322..325 collision further below), this branch's pair was renumbered
REG-332→REG-334 and REG-333→REG-335 during this merge's conflict resolution:
heading, table-row id, and every internal self-reference updated in both
`00-header.md` and `02-foxy-ai.md`, plus the corresponding `REG-332`/`REG-333`
comment references in `router.test.ts`, `deno-parity.test.ts`, and the
`grounded-answer` cache-order-fix Deno test files. No entry from either side
was dropped or reworded — only this branch's two ID numerals moved, and the
catalog total grew by 2 (both of main's entries plus both of this branch's
renumbered entries), not by 1. **REG-336 is the next free id.** That was true
at this merge's start and is superseded above — the same-day P0+P1
launch-hardening batch then consumed REG-336..REG-343, so **REG-344 is now the
next free id.**
Prior: REG-333 (2026-08-02, `select_quiz_questions_rag` verification gate —
the RPC serving quiz questions to `/api/quiz`, `/api/v2/quiz/questions`, and
the WhatsApp Daily-6 top-up path had never, across 7 historical versions
since 2026-04-03, filtered on `verification_state`/`verified_against_ncert`,
closing the exact gap REG-332's own "Known gaps" section flagged and
explicitly declined to fix. Migration `20260802100000` adds three
unconditional Tier-0 predicates (`deleted_at IS NULL`,
`content_status='published'`, `verification_state != 'failed'` — this last
with no fallback rung at any tier) across all four repeated query blocks,
and wires the existing, tested, hysteresis-protected
`ff_grounded_ai_enforced_pairs` control into serving for the first time via a
local-thinness fallback ladder (strict Rung E0 only when the enforced pair's
verified pool for the exact requested slice meets the count; Rung
E1/Tier-0-only otherwise, with `ops_events` telemetry on the thin case only).
Testing independently re-ran everything rather than trusting the architect's
self-report: function signature re-verified byte-identical across all 5
historical `CREATE OR REPLACE` bodies (no accidental overload — the exact bug
class that hit a sibling RPC before); RLS policies and the telemetry
fail-open exception wrapper re-verified against live SQL; 18 structure/
contract tests + 6 pure-function ladder tests + 157 pre-existing
RPC-referencing tests all independently re-run and passing (191/191,
DB-free). Testing additionally wrote and ran 10 NEW tests
(`select-quiz-questions-rag-tier0-floor.test.ts`) closing a real gap: neither
the structure test nor the ladder-decision mirror could prove BEHAVIOR for
the one non-negotiable predicate (`verification_state != 'failed'`, no
fallback rung) or the "legacy backlog stays servable under Tier-0 but not the
strict rung" interaction — both now have executable, DB-free proof.
**PARTIAL, explicitly so**: this migration has NEVER executed against a real
Postgres, in this session or any prior one — the live-DB AC-1..AC-6 suite is
written and collects/skips cleanly but has zero live executions (no creds in
this environment); ops has not yet run the §7 pre-rollout census queries; see
`03-quiz-integrity.md`).
**REG-334 is the next free id.** That was true at its writing and is
superseded above — REG-334/REG-335 went to the Model Gateway OpenAI-primary
swap + its percentage-rollout mechanism, and the 2026-08-03 P0+P1
launch-hardening batch then consumed REG-336..REG-343, so **REG-344 is now the
next free id.**
Prior: REG-332 (2026-08-01, grounded-answer content-readiness precheck fix —
`supabase/functions/grounded-answer/coverage.ts`'s strict-mode gate required
`cbse_syllabus.rag_status='ready'` (`chunk_count>=50` AND
`verified_question_count>=40`); production had zero rows meeting the combined
bar, so `ncert-solver` had silently abstained on every strict-mode request
for months and the two GenAI Lesson/Content Generation agents (REG-313/314)
shipped to 100% rollout 100% non-functional — the same defect the
2026-07-27 GenAI incident (`docs/incidents/2026-07-27-genai-generation-
agents-100pct-abstain/README.md`) names as still-open. `verified_question_count`
was irrelevant to all three callers (none reads `question_bank`) and its
presence created a live bootstrapping deadlock: `verify-question-bank`, the
only process that grows it, called this same precheck in strict mode scoped
to the chapter it was trying to verify, so no chapter could ever organically
clear the gate, and each failure is a PERMANENT `verification_state='failed'`
with no retry. Fix changes the 3 predicate-check call sites in `coverage.ts`
(specific-chapter, subject-wide, `suggestAlternatives`) from
`rag_status==='ready'` to `chunk_count >= MIN_CHUNKS_FOR_READY` (existing,
unchanged, dual-sourced constant, value 50); `rag_status`,
`verified_question_count`, and `recompute_syllabus_status()` are untouched at
the data level, confirmed via zero migration diff. Real, live Deno runs this
session: `coverage.test.ts` 10/10 passed; `pipeline.test.ts` 21 total, 20
passed, 1 pre-existing failure reproduced identically against the unmodified
pre-fix HEAD version in an isolated copy (proven unrelated). **PARTIAL,
explicitly so**: no live-Postgres verification (Deno stub only);
`pipeline.test.ts`/`e2e.test.ts` sit outside CI's blocking
`DENO_TEST_TARGETS` (need `--allow-net`/`Deno.serve()`, only `coverage.test.ts`
is CI-blocking); does not remediate the existing `verification_state='failed'`
backlog (a data decision, not code); and surfaces but does NOT fix a
SEPARATE, independently-confirmed gap — `select_quiz_questions_rag`'s live
definition never actually filters on `verified_against_ncert` despite older
comments/specs claiming it does; see `13-rag-cache.md`).
**REG-333 is the next free id.**
This batch's own text declared "REG-333 is the next free id"; that was true
at its merge and is superseded above — the `select_quiz_questions_rag`
verification-gate fix took REG-333 on 2026-08-02, so **REG-334 is now the
next free id.**
Prior: REG-331 (2026-07-30, BoardScore™ subject-scoping fix batch — CEO-
reported "all subjects shown" defect. Bug 1: the Deno Edge Function
`supabase/functions/board-score/index.ts` had used a PostgREST nested embed
requiring an undeclared FK, making every `compute` call fail; rewritten as a
flat-fetch + in-memory-Map join mirroring `cme-engine/index.ts`, with the
scoring formula itself confirmed BYTE-FOR-BYTE UNCHANGED via explicit `git
diff` review. Bug 2: the nightly cron computed a BoardScore for every subject
with grade-level `cbse_chapter_weights`, ignoring what the student actually
selected; new `getStudentBoardSubjects(studentId, grade)` intersects
`students.selected_subjects` with board-examined `subject_kind`
(`cbse_core`/`cbse_elective`, never `platform_elective`) and weight-table
availability, wired into both the cron and a new 422 `subject_not_eligible`
gate on `POST /api/board-score`. Two supporting migrations: a one-row
`cbse_chapter_weights` `social_science`→`social_studies` code fix (without
which Grade-10 Social Studies could never match) and a defensive (currently
zero-row, verified no-op) cleanup DELETE for pre-fix over-broad
`board_score_predictions` rows. **PARTIAL**: the subject-scoping decision
logic and the route-level eligibility gate are REAL behavioral tests (mocked
Supabase, not just structural) that run on every PR; the Deno Edge Function
and both migrations are pinned structurally only (source-text pattern
presence/absence + formula-byte-identity) — no live Deno execution and no
live-DB migration execution in this pass, a bigger integration-lane gap than
REG-329/330's since no integration-lane companion file exists yet for these
two migrations; see `15-cross-cutting.md`).
Prior: REG-330 (2026-07-29, institution-entitlement override floor on
`get_plan_limit()` — the `20260729130600` migration wires the school-scoped
`institution_entitlements` daily-limit overrides the `/super-admin/entitlements`
panel already wrote into the SQL enforcement/display authority as a THIRD
`GREATEST()` term, closing the "operator sets a quota, nothing happens" gap
left after REG-329's school-tier work. **PARTIAL, and honestly so, same shape
as REG-329**: the source contract (18 tests) runs on every PR, but the 7
condition-2 semantic pins plus the display-parity check execute plpgsql and
therefore live in the INTEGRATION lane, which does NOT run on a normal PR —
confirmed locally to collect cleanly and skip (no live creds in this
environment), not executed against a real DB; see `15-cross-cutting.md`).
Prior: REG-326..REG-329 (2026-07-29, diagnostic cold-start correctness +
school-coverage daily-limit P0 batch). REG-326 (diagnostic complete-route
server-side correctness re-derivation, P1 — **it replaces a test that was
PINNING the defect**: `diagnostic-complete-contract.test.ts` stubbed an EMPTY
`question_bank` and then asserted `score_percent === 70` for a body that merely
*claimed* 7 of 10 correct, an assertion that could only pass if the route
trusted the client's `is_correct` flag; the whole file is rebuilt on real
`correct_answer_index` fixtures, with an adversarial pin that an all-`true`
claim over all-wrong indices scores 0, a 200-case property test, the §7.5a
50/80 placement boundaries replacing the stale 40/70 cuts, the C2 speed-run
placement guard, and AC-32 XP neutrality; see `03-quiz-integrity.md`).
REG-327 (diagnostic 5/6/4 blueprint + V1-V18 Tier-0 verification gate + Rung
0-4 insufficient-pool ladder + Bloom's spread, pinned against the PURE selector
— including the **AC-4 information oracle with the pre-fix all-easy 15/0/0 form
kept as an explicit NEGATIVE fixture** so `ORDER BY difficulty ASC LIMIT 15`
cannot silently return, a 500-pool never-degraded property test, grades
`"6".."12"` as STRINGS with integer twins rejected, and the Rung-4 honest stop
returning HTTP 200 with NO `diagnostic_assessments` insert and a provably
non-empty `alternatives` array; see `03-quiz-integrity.md`). REG-328
(daily-limit display == enforcement across the TS client, the new
`/api/usage/daily` service-role read-through and the Flutter tri-state
`UsageLimit` parse, plus the "neither unlimited sentinel — `-1` or `999999` —
ever renders" guarantee; see `15-cross-cutting.md`). REG-329 (the
`get_plan_limit` school-coverage + `get_student_usage` single-limit-authority
migrations — **PARTIAL, and honestly so**: the source contract runs on every PR,
but architect's three semantic pins (B2C byte-identical, `trial` school → `pro`
cap, personal `unlimited` not downgraded under a `basic` school) execute plpgsql
and therefore live in the INTEGRATION lane, which does NOT run on a normal PR;
see `15-cross-cutting.md`). This batch's own text declared "REG-330 is the
next free id"; that was true at its merge and is superseded above — the
institution-entitlement override floor took REG-330 the same day, so
**REG-331 is now the next free id.**
Collision note (2026-07-29): this batch originally claimed REG-322..REG-325 and
declared REG-326 next-free. The DSA-audit fix batch (PR #1415, immediately
below) merged to `main` first with the SAME four ids and the SAME next-free
claim; this batch was renumbered to REG-326..REG-329 during the rebase. No
entry from either batch was dropped, reworded or renumbered on the #1415 side.
Also 2026-07-29 (merged first, PR #1415): REG-322..REG-325 (DSA-audit fix batch, branch
`Alfanumrik/alfanumrik-dsa-review-ba6e30` — a data-structures/algorithms
review of the quiz-validation, shuffle, XP-ledger, and cron-leaderboard
surfaces). REG-322 (P6 — single canonical question-quality gate at
`packages/lib/src/quiz/question-validation.ts`: strict-union behaviour
[null/non-integer `correct_answer_index` rejected, exactly-4-distinct
options, template markers, explanation char+word floors, `allowNonMcq`
relaxing MCQ shape only, bloom_level enforcement OPT-IN via
`enforceBloomLevel` and pinned in BOTH directions — default must not
silently re-tighten, opt-in must actually enforce and forward through the
batch wrapper] plus an anti-fork canary [exactly one implementation under
`packages/lib/src`, the three former fork sites `quiz-assembler.ts`/
`domains/quiz.ts`/`supabase.ts` delegate, only `quiz-assembler` passes
`allowNonMcq: true`, the quarantined `quiz-engine.validateQuestionForQuiz`
has zero production callers]; documented gaps — the quiz page's
deliberately-thinner `isValidQuestion` last-line filter is outside the
canary's scan scope, and the Deno-side parity partner
`supabase/functions/_shared/quiz-oracle.ts` currently lacks the bloom field
[ai-engineer follow-up]; see `03-quiz-integrity.md`). REG-323 (P6-adjacent
— canonical non-mutating Fisher-Yates `shuffle()` at
`packages/lib/src/shuffle.ts` with injectable rng, proven
permutation-preserving and distribution-correct via exact scripted-rng
permutations + a uniformity trial, plus a repo-wide static canary banning
the biased `sort(() => Math.random() - 0.5)` comparator in either ordering
from `packages/` and `apps/`; see `03-quiz-integrity.md`). REG-324 (P2 —
the 6-arg `atomic_quiz_profile_update` overload now WRITES the
`xp_transactions` ledger row it READS for the daily cap, closing the
cap-read/cap-write mismatch left open after REG-318's F4 read repoint:
`daily_category='quiz'`, capped `v_effective_xp` with raw only in metadata,
`v_effective_xp > 0` guard, clamp→ledger→profile/student write ordering in
one transaction, `v_daily_cap` parity with `XP_RULES.quiz_daily_cap` swept
across every root migration, and the nine-key JSONB return pinned in order
[extends REG-48]; recorded HONESTLY as a defensive fix on a
dormant-but-`authenticated`-EXECUTE-granted overload with NO reachable
production caller today — the live path is `submit_quiz_results_v2` + the
7-arg overload; migration `20260729130000_fix_6arg_quiz_xp_ledger_write.sql`;
see `05-xp-scoring.md`). REG-325 (operational integrity + P13 — daily-cron
leaderboard ranking delegated to the `recalculate_leaderboard_snapshots()`
RPC [migration `20260729130100`], killing the silent PostgREST 1000-row
truncation and JS rank-by-array-index: ROW_NUMBER with `s.id` tie-break,
unconditional DO UPDATE so ROW_COUNT = students ranked, the `>= 2` flag
auto-enable gate driven off the RPC integer return, service_role-only
EXECUTE, counts-only logging, AND the dormant
`recalculate_performance_scores()` RPC [migration `20260729130200`] pinned
UNWIRED from both the Vitest and Deno lanes; extends REG-118; see
`11-infrastructure.md`). That batch's own header text declared "REG-326 is the
next free id"; that was true at its merge and is superseded here — REG-326..
REG-329 were taken by the diagnostic + school-coverage batch above, and REG-330
was subsequently taken by the same-day institution-entitlement override floor
(top of this file), so **REG-331 is the next free id.**
Prior: REG-318..REG-321 (2026-07-29, forensic-audit fix batch, PR #1410 —
"Forensic audit fix batch: quiz scoring, payments, security, AI safety (6
critical bugs)"). A deep forensic audit found ~30 confirmed bugs across
quiz scoring, payments, security/RBAC, AI safety, privacy/logging, and
mobile-web contract sync; four of the highest-severity findings are
promoted here as regression-catalog entries (the remainder are covered by
existing catalog entries or fixed without a new dedicated regression, per
the PR's own review-chain sign-off — testing agent scoped this promotion to
the items explicitly assigned, not the full ~30-bug list). REG-318
(quiz-scoring RPC defect cluster — anti-cheat Check 3 tautology exploit via
a nonexistent-column join that silently defeated the response-count-mismatch
rule; daily XP cap computed correctly but not propagated back to the caller;
`atomic_quiz_profile_update`'s 6-arg overload reading a phantom
`quiz_sessions.xp_earned` column; its 7-arg overload's streak counter
comparing "now" against "now" because `last_active` was re-read after being
overwritten in the same call; and a mixed UTC/IST day-boundary anchor
producing a 5.5-hour cap/streak off-by-one — all fixed as additive
`CREATE OR REPLACE`, pinned via migration-source structural tests since no
live-DB integration harness exists for this RPC graph; see
`05-xp-scoring.md`). REG-319 (payment verify-route plan-code forgery /
cross-account binding fix, P11 — `/api/payments/verify` had trusted
client-supplied `plan_code`/`billing_cycle` after only verifying the HMAC
signature proved `order_id|payment_id` pairing, not which plan was
purchased; now derives both fields server-side from the Razorpay order's own
`notes`, cross-checks caller identity, and fails closed (202) rather than
trusting the client on any resolution failure; see `04-payments.md`).
REG-320 (reconcile-payments cron recency-window + terminal-state guard fix,
P11 — the 30-minute reconciliation cron had no recency bound and no
terminal-subscription-state awareness, so it could resurrect access for a
student who had since legitimately cancelled, fighting the cancellation
cron indefinitely; fixed with a 2-hour recency window, a terminal-state
guard, and `reconciled_at` stamping; see `04-payments.md`). REG-321
(ncert-solver AI-safety backport, P12 — the Edge Function, reachable with
any student JWT, had never received the grade-spoof hard block or
output-safety screen already shipped on the Foxy Next.js route; the shared
canonical Deno output-screen module relocation and its TS/Deno pattern-
parity contract ARE test-pinned, but the grade-spoof `403 GRADE_MISMATCH`
check, chunk-interpolation sanitization, query-length cap, and
refund-on-abstain logic are implemented with NO dedicated automated test as
of this promotion — flagged as an explicit known gap rather than claimed as
covered; see `02-foxy-ai.md`).
Reconciliation note (2026-07-29): this catalog's own running total had
drifted across three inconsistent readings before this pass — the
`.claude/CLAUDE.md` narrative said 142 (stale since REG-134, 2026-06-13),
the root `.claude/regression-catalog.md` stub had said 256 at one point,
and this header plus the per-entry running counters embedded across the 15
shard files already agreed on 317 as of REG-317. This header's own
self-declared total and a raw grep-count of `| REG-N |`-shaped table rows
in the shard bodies do NOT agree (270 exact-format table rows vs the 317
self-declared here) because a meaningful minority of entries — including
REG-176, REG-182/183, and others — are written in prose/subsection format
rather than the `| REG-N | ... |` table-row shape, so a naive single-regex
count undercounts. The 317 (now 329) figure is the authoritative
incrementally-maintained running total: each entry's own addition updates
"Pre-REG-N: X entries ... **Total catalog: X+1 entries**" in the same
commit, and the highest such self-declaration in the shard set (this file
and `11-infrastructure.md` at REG-317, then this file at REG-321, then this
file and `11-infrastructure.md` at REG-325, then this file and
`15-cross-cutting.md` at REG-329, now this file and `15-cross-cutting.md` at
REG-330) is treated as ground truth. Known intentional ID gaps below REG-296 (never
renumbered, do not fill): REG-1..REG-35 (catalog numbering starts at
REG-36; REG-1..35 were never used — SG-1..SG-6 in `01-subject-governance.md`
use a separate prefix), REG-80/81/82 (recommended in `03-quiz-integrity.md`/
`05-xp-scoring.md`, never added), REG-170 (intentionally skipped — see
`03-quiz-integrity.md`), REG-176 (present, prose format — NOT a gap, a
counting-format artifact, see above). REG-296 through REG-317 are fully
contiguous with no gaps; REG-322..REG-325 were consumed by the same-day
DSA-audit promotion (PR #1415), REG-326..REG-329 by the same-day
diagnostic cold-start + school-coverage batch, and REG-330 by the same-day
institution-entitlement override floor, so **REG-331 is the next free
id**. Both batches independently claimed REG-322..REG-325 on 2026-07-29; the
DSA-audit batch merged first and keeps those ids, the diagnostic batch was
renumbered upward during its rebase. There is no REG-322..REG-325 duplication
and no gap between REG-321 and REG-329.
Prior: REG-317 (2026-07-27, build/tooling invocability + CI gate blocking
posture — branch `fix/typecheck-scripts-gap`. Pins the family of defects every
existing gate was structurally blind to: tooling that COMPILES but cannot be
INVOKED, and guards that RUN but INSPECT NOTHING. (1) Every npm script path
token resolves — the `check-npm-script-paths.mjs` canary is SPAWNED (exit 0,
cwd-independent, counts cross-checked against an independent workspace
enumeration) and MUTATION-tested against a byte-identical copy in a throwaway
fixture repo reproducing the exact defect shape (22 declarations in
`apps/host/package.json` were each missing a `../../`); stripping the prefix
must exit non-zero naming package/script/token/hint, restoring it must exit 0.
(2) No file under `scripts/` imports the dead pre-monorepo `../src/lib/` path
(74 files, three detectors: `from`, `import()`, `require()`, proven against the
five verbatim shapes from the seven repaired scripts) — detected by SOURCE-TEXT
scan because `vitest.config.ts` aliases `/^(\.\.\/)+src\/lib\//` to
`packages/lib/src/`, so a runtime probe is silently rewritten and passes; that
alias is itself pinned BEHAVIOURALLY by executing its regex, which is exactly
why ~14,000 tests never caught this. (3) The P13 edge-log guard has a
ZERO-MATCH FLOOR — it scans all 47 `supabase/functions/*/index.ts` from either
cwd (count cross-checked, self-updating), and a byte-identical copy in an
isolated fixture root with no functions must exit non-zero with `FAILED TO RUN:
matched 0 files` on stderr; adding one clean function makes the same copy exit
0, adding a PII-logging one exits non-zero — so the floor neither false-greens
nor replaced the guard's real job. It had shipped as
`passed (0 index.ts files scanned)` / exit 0. (4) The three quality-job CI
steps (`Type check (scripts/)`, `Check npm script paths`, `Edge Function log
PII guard (P13)`) exist, are BLOCKING (no `continue-on-error`), actually invoke
their gates, and stay ordered after the P15 auth gate — parsed with a real YAML
parser (NOT the fragile string slicing used by
`v3-school-rpc-predeploy.test.ts`), with a META-PIN asserting the deliberately
advisory Supabase-types step reads `continue-on-error: true` so the
absence-based blocking checks cannot pass vacuously. (5) The Deno pre-warm set
cannot drift from the test set — job-level `DENO_TEST_TARGETS` (≥5 targets, all
resolving on disk, unshadowed by any step), EXACTLY two consuming steps, and
NEITHER `run` body may hardcode a `supabase/functions/` path after comment
stripping; that is what makes the 2026-07 HTTP 522 drift structurally
impossible. 23 Vitest tests, all five invariants mutation-proven and restored.
P13 + P15 + operational integrity. One documented gap: the canary cannot see
extensionless DIRECTORY arguments — measured, not assumed (121 false positives
if relaxed), so REG-317 pins the canary's actual contract and claims no more;
see `11-infrastructure.md`).
Prior: REG-316 (2026-07-27, RAG shadow confidence instrumentation — branch
`claude/rag-confidence-shadow-instrumentation`, commits `6e6f9d96` +
`9febc5be`, both ZERO behaviour change by design. v1 confidence is
`0.347606 + 0.2*(chunks/5)` in the vector-only regime — three reachable values,
912/996 production traces at exactly 0.647606, i.e. a chunk counter. v2
substitutes a relevance signal (Voyage rerank score, else the absolute cosine
newly exposed by migration `20260727130000`) into the SAME unmodified
`computeConfidence` and records it on `grounded_ai_traces`. The value of the
step is the INTEGRITY OF THE SHADOW DATA, so the pins protect the data:
(1) `confidence_v2` is never compared to a threshold anywhere — a quote-aware
scan over ~2400 files, the file-mention allowlist pinned at four modules, the
strict abstain still reading v1 `confidence`, the SSE metadata frame unchanged,
plus a meta-pin proving the detector regex actually fires; (2) NULL is never
coerced to 0 at any hop — `mapNcertRow`, `adaptChunk`, and inside
`computeConfidenceV2` (signal-less chunks are OMITTED from the top-3 average,
not zeroed; all-null ⇒ null + `'none'`); (3) `rankedScores` stays positionally
aligned with `rankedIndices` in BOTH rerank implementations, with every
fall-through path returning same-length all-null arrays; (4) source precedence
`rerank > cosine > none` decided by the top chunk and applied uniformly, with
`top_cosine_similarity` recorded independently of the chosen source;
(5) a static migration scan pinning the `match_rag_chunks_ncert` overload count
at 2 — the CI failure PR #1394 did not have; (6) `writeTrace` retries ONCE with
the shadow keys stripped on a PGRST204-style failure, and only when the row
carried them. 87 Vitest tests across 4 files. P12. Five documented gaps —
no live-DB overload assertion, no behavioural `runPipeline`/`runStreamingPipeline`
test, no Deno tests (Deno unavailable), no `numeric(5,4)` rounding assertion,
and the pre-existing streaming/non-streaming v1 RRF-normalization asymmetry
deliberately NOT pinned; see `13-rag-cache.md`).
Prior: REG-315 (2026-07-25, GenAI Phase 5d — the `/foxy` Study Tools CLIENT
SURFACE, i.e. the student-visible mouth of the Lesson + Content agents pinned by
REG-313/REG-314: `StudyToolsBar` → `useStudyArtifacts` → `study-artifacts.ts`
transport → `StudyArtifactSheet`, plus the `diagram-to-foxy-block` adapter into
the existing REG-55 one-block envelope. Pins (1) flag-OFF DOM IDENTITY asserted
as `container.innerHTML === ''` (a stray wrapper/divider FAILS) with the two
flags ramping INDEPENDENTLY and `useGenAiContentFlags` failing CLOSED on cache
miss / TTL expiry / corrupt cache / throwing or `undefined` flag source, plus the
registry-not-barrel import canary; (2) the deliberate kind→endpoint ASYMMETRY —
diagram = POST `/api/content/diagram` with a NESTED `chapter{}`, lesson = GET
`/api/lesson` with FLAT query params — pinned at the client AND by a static
read-only canary over both route sources; (3) ABSTAIN-IS-NOT-AN-ERROR (HTTP 200 +
`abstained:true` → calm bilingual notice, no retry; retry offered ONLY for the
`network` reason); (4) a CLIENT-side re-run of `validateMermaidCode` as
defence-in-depth over REG-314's server gate — 9 injection shapes return `null`,
never reaching the renderer or the DOM, with no raw-source fallback. Promoted NOW
because migration `20260724220000_set_ff_generation_rollout_100.sql` takes BOTH
`ff_content_generation_v1` and `ff_lesson_generation_v1` to rollout 100% on merge,
so the surface reaches every student with no canary window; the flag-OFF clauses
are the ROLLBACK contract. P12 + P7 + P13 + P5 + P10-adjacent. Two documented
gaps: no `page.tsx`-level mount test and no per-route chunk assertion — see the
"Known gap" block in `02-foxy-ai.md`).
Prior: REG-314 (2026-07-24, GenAI Phase 5c — Content Generation Agent
[NCERT-grounded Mermaid diagrams]: grounded-only single-retrieval generation with
a grounded/confidence-0.75/parse-empty abstain ladder, a DUAL safety gate
[`validateMermaidCode` injection-reject + a v1-kind header constraint, then
`screenStudentFacingText` over every EN/HI field AND the whole `mermaidCode`] with
NO raw-SVG fallback, flag-OFF 404 no-op, student-self scope, and a LIVE registered
agent with zero mastery writes — taking the live agent set from 6 → 7; see
`02-foxy-ai.md`).
Prior: REG-313 (2026-07-24, GenAI Phase 5b — Lesson Generation Agent: the FIRST
student-facing GENERATIVE artifact — additive, flag-gated `ff_lesson_generation_v1`
(default OFF), a PURE planner (`planLesson`, maps unified-memory bands → a HOW-only
`LessonPlan`, no re-derived mastery / no threshold literal / codes-only
`renderAdaptationCodes`) + a grounded-generation orchestrator (`generateLessonNotes`
— ONE `callGroundedAnswer` single retrieval [REG-50], a grounded=false /
`confidence < 0.75` / parse-empty abstain ladder, and a Node-side per-field
`screenStudentFacingText` backstop on EVERY EN + Hindi field where an unsafe section
is dropped and all-dropped → whole-lesson abstain, fail-soft never-throw) behind a
student-self-only read route (own `auth.studentId`, NO cross-student path / no
`canAccessStudent` / no service-role client, flag-OFF → 404 no-op before any work,
abstain → 200), registered as a LIVE agent with ZERO mastery writes (agent-registry
invariants d/e/f over the route); P12 AI-safety + P7 bilingual + WHAT/HOW read-only
+ P5 grade-STRING + P13 no-PII; see `02-foxy-ai.md`).
Prior: REG-312 (2026-07-24, GenAI Phase 5a — read-only Outcome Prediction Agent:
additive, flag-gated `ff_outcome_prediction_v1` (default OFF), a PURE composer
(`composeOutcomePrediction`) behind a read-only GET route that COMPOSES the
platform's existing predictors into one unified `OutcomePrediction` via a 4-tier
data-source ladder (`board_score_predictions` verbatim → memory-derived
`predictExamScore` → `cme_exam_readiness` verbatim → `insufficient_data`) with NO
new prediction math, **NO pass-mark constant** (the D→C1 boundary is DERIVED from
`calculateBoardExamScore`), and NO recompute of the board score; the route is
self-vs-cross-student IDOR-safe (RLS-scoped self / `canAccessStudent`-gated
service-role cross, no payload on any deny) and registers as a LIVE agent with
ZERO mastery writes (agent-registry invariant e over the route + `_lib/`); P8
IDOR + P13 no-PII + WHAT/HOW read-only boundary + P1/P2-adjacent; see
`02-foxy-ai.md`).
Prior: REG-311 (2026-07-24, GenAI Phase 4 — runtime `ResponseEval` observability
sensor: additive, flag-gated `ff_response_eval_v1` (default OFF), OBSERVABILITY-ONLY
9-dimension response sensor that NEVER blocks/alters a response; pins per-dimension
normalization for all 9 dims incl. every boundary (mastery 0.4/0.7/0.85, latency
800/8000ms, cost budget/ceiling, confidence 0.75/0.6 floor/cap, ungrounded cap,
output-screen 1.0/0.5/0.0), the 6 flag conditions [`toxicity_unsafe`,
`age_inappropriate`, `curriculum_out_of_scope`, `hallucination_risk_high`,
`latency_over_ceiling`, `cost_over_ceiling`] firing only under their exact
condition (difficulty_fit + the 2 deferred dims NEVER flag), PII-clean
fire-and-forget emission (codes/ids/numbers only, no prose/PII key), never-throw,
and flag-OFF byte-identity via the re-run 42-test Foxy route suites; P12 AI-safety
observability + P13 no-PII; see `02-foxy-ai.md`).
Prior: REG-310 (2026-07-24, GenAI Phase 3 — Agent Registry + WHAT/HOW boundary:
pure-metadata + inert (no flag/migration/activation) 7-agent registry that is
HOW-only (`decides:'HOW'`, `mayWriteMastery:false`) with the teeth — a static
`findMasteryWrites` proof that NO live agent surface (Foxy route + `_lib/`,
quiz-generator, teacher-dashboard, parent-report-generator) directly writes any of
the 9 forbidden mastery/progression tables; the adaptive engine alone decides
WHAT, mastery moves only through the concept-check/BKT projector path —
adaptive-decides-WHAT learner-state boundary, P1/P2 scoring-adjacent; see
`02-foxy-ai.md`).
Prior: REG-309 (2026-07-24, GenAI Phase 2 — Unified Student Memory read-API:
flag-gated `ff_unified_memory_v1` (default OFF) DPDP erasure suppression
(pending/purging → fully-empty memory, service-role read, FAIL-CLOSED on any
error), flag-OFF byte-identity via reference-identical passthrough of the
existing cognitive/twin/long-memory sub-contexts, fail-soft composition (a
rejecting sub-read degrades only its slice, never throws), and a PII-clean prompt
renderer that equals the existing per-slice renderers — P13, WHAT/HOW read-only
boundary; see `02-foxy-ai.md`).
Prior: REG-308 (2026-07-24, GenAI Phase 1 — provider-agnostic Model Gateway
backward-compat + provider-routing safety: flag-OFF `ff_model_gateway_v1` forces
the `default` policy which reproduces the legacy Anthropic-primary chain
byte-for-byte, the router never selects a dormant `configured:false` provider
(both Gemini seams), config.ts model-name byte-identity, and Deno↔TS
`MODEL_FALLBACK_ORDER` parity — P12; see `02-foxy-ai.md`).
Prior: REG-306..REG-307 (2026-07-22, Master Action Plan Phase 2.3–2.5 + 3.10 —
REG-306 Alfa OS shell launch [Practice/Revision/Test OS presentation shells:
default-OFF client-first-paint flag identity + existing-nav non-regression +
shell render contract + PredictedScoreCard byte-parity + REG-125-conformant
seed shape for the 3 new `20260722104000/104100/104200` flag seeds; presentation
only, P1/P2/P3 untouched] — see `15-cross-cutting.md`; REG-307 Hindi
teacher-feedback language-aware display [P7 fallback matrix asserted verbatim on
web + mobile, `pickTeacherFeedback` ↔ `feedbackFor` pick-logic parity, and the
teacher-dashboard write/read path carrying both language columns] — see
`07-teacher-school.md`). Prior: REG-304..REG-305 (2026-07-22, Master Action Plan Phase 8 monitoring/
alerting rollout-enablement prerequisites — REG-304 adaptive-loops monitoring
gate [aggregate-only `get_adaptive_loops_health` SECURITY DEFINER RPC + fail-
closed nightly monitor cron with runbook-sourced thresholds (ceiling=0,
storm>50%@≥10-sample, heartbeat>26h) + super-admin dashboard + 3 seeded
alert_rules + the adaptive-remediation `job_health` heartbeat it reads] — see
`09-adaptive-program.md`; REG-305 Monthly-Synthesis delivery-failure monitor
(>20%@≥5-attempts) [8.4] + nightly LLM-as-judge quality sampler writing the
RLS-locked `synthesis_quality_scores` table [8.6] + both super-admin
dashboards, all P13 aggregate/ID-only with the parent summary body/bundle/
phone/name never persisted or rendered — see `02-foxy-ai.md`). Prior: REG-303 (2026-07-21, live-production dead-flag-gate fix —
`GET /api/learner/revise-stack` had gated on `isFeatureEnabled('ff_revise_route_v1')`
after migration `20260603120000_remove_ff_revise_route_v1.sql` deleted that
flag row as part of Study Menu v2 consolidation, so the route 404'd
UNCONDITIONALLY for every student in production while both the web
Chapter Refresh section and the mobile Refresh screen silently swallowed the
404 into an empty state; fixed by deleting the dead gate rather than
re-seeding the flag — see `11-infrastructure.md`). Prior: REG-302 (2026-07-22, Master Action Plan Phase 4 — Foxy explorer mode
token-budget fix + dedicated Socratic/artifact-draft persona directive [item
4.1], Monthly Synthesis parent-summary fabrication oracle [number + Devanagari
digits + chapter/topic cross-check against the bundle, word-cap sentence-
boundary truncation, deterministic bilingual template fallback, 5-failure/60s
circuit breaker — item 4.2], and the WhatsApp pre-send fabrication re-check
gate writing a new `flagged` `parent_share_status` [additive migration
`20260722098000`, item 4.5] — see `02-foxy-ai.md`). Prior: REG-301 (2026-07-22, Master Action Plan Phase 2.2 remediation — CBSE-board
dynamic-assembly mock-exam rebuild: legacy `/mock-exam` Section B count fix
[38/78 -> 39/80 marks], the submit-route idempotency replay-guard column bug
[`paper_id` does not exist on `mock_test_attempts` -- fixed to `exam_paper_id`,
so the guard had never actually short-circuited a double-submit against the
real database], the new dynamic snapshot-assembly start/submit flow
[`POST /api/exams/papers/[id]/start` + `start_mock_test_attempt`/
`submit_mock_test_attempt` RPCs, migrations `20260722096000..20260722097100`],
and the legacy multi-subject sample paper's soft deactivation [`is_active =
false`, migration `20260722097200`, no dangling FK] — see
`03-quiz-integrity.md`). Prior: REG-297..REG-300 (2026-07-22, Master Action Plan Phase 3 — REG-297
Loop D verify evaluator [route-level dispatch wiring + the false-positive-
resolution bug assessment caught and backend fixed before merge] + REG-298
cron-worker scale hardening [fairness ordering, escalation-cache N+1
batching, run-lock TOCTOU race closed via migration `20260722095000`] — both
see `09-adaptive-program.md`; REG-299 assignment completion multi-attempt +
due-date lockout hardening — see `07-teacher-school.md`; REG-300 WhatsApp
channel wired for the 3 adaptive-loop parent escalations, closing a
zero-prior-coverage gap on the fetch call itself — see
`09-adaptive-program.md`). Prior: REG-296 (2026-07-22, flag-governance hardening Phase 0 — DB-layer defense-in-depth (BEFORE UPDATE trigger + `admin_flip_feature_flag` RPC + velocity/burst guard) + TS/DB registry parity + canary watch-list growth to 56 names after two live-but-unprotected constitution-pinned flags were found and registered -- see `10-rbac-rls.md`). Prior: REG-290..REG-295 (2026-07-20, parent-dashboard RCA -- the 11-policy `active`/`approved` RLS mismatch silently emptying score/xp/coin/quiz/skill-state/exam/monthly-report tables for OTP-linked guardians + OTP redeem invite_code/link_code fix + teacher_parent_threads INSERT policy + synthesis/parent-share RBAC-gate parity, the billing multi-child deep-link fix, the P7 lockout-message bilingual fix, and three design-system presentational refactors on /parent/reports, ParentGlanceHome, and /parent/profile -- see `08-parent-portal.md`). Prior: REG-287..REG-289 (2026-07-20, super-admin session/routing/error-contract repair — the 2026-07-20 super-admin RCA pins: httpOnly-cookie single-source admin session + ordered Bearer→cookie credential fallback (the ~2.5-min session-death fix), admin-aware Layer 0.65 routing via the `get_admin_level` RPC with the uncached ROLE_UNKNOWN fail-open sentinel + both repair migrations' static SQL pins (the student-bounce fix), and AdminShell structured `ApiResult` error classification incl. Vercel security-checkpoint detection + 401 refresh-retry — see `10-rbac-rls.md`). Prior: REG-285..REG-286 (2026-07-20, protected-flag console guardrail + posture canary — the 2026-07-20 console bulk-enable incident pins: typed-confirmation gate on the super-admin feature-flags API + nightly fail-closed posture-drift canary — see `10-rbac-rls.md`). Prior: REG-284 (2026-07-20, E2E full-suite topology — label-gated advisory PR run + watched blocking nightly — see `11-infrastructure.md`); REG-281..REG-283 (2026-07-20, feature-flag RCA repair — see `10-rbac-rls.md`; renumbered from REG-277..279 after ID collision with the Foxy ramp package, which holds REG-277..REG-280 — see `02-foxy-ai.md`).

## Split Files

| File | Feature area |
|---|---|
| `01-subject-governance.md` | Subject Governance (SG-1..SG-6) |
| `02-foxy-ai.md` | Foxy AI tutor, AlfaBot, structured rendering, prompt routing, diagrams, math |
| `03-quiz-integrity.md` | Quiz scoring, server-shuffle, authenticity, marking, offline replay, E2E critical paths |
| `04-payments.md` | Razorpay, billing, pricing SoT, RBI pre-debit |
| `05-xp-scoring.md` | XP economy, daily cap, anti-cheat, consecutive_wrong |
| `06-auth-onboarding.md` | Auth module, parent-child link, B2C funnel, email onboarding |
| `07-teacher-school.md` | Teacher remediation/grading/notify, school admin, seat provisioning, TSB-4 |
| `08-parent-portal.md` | Consumer Minimalism waves, parent portal, consent |
| `09-adaptive-program.md` | Adaptive remediation loops A/B/C/D, digital twin |
| `10-rbac-rls.md` | RBAC matrix, RLS policies, Student Pulse, XC-3 phases, mutation gates |
| `11-infrastructure.md` | Python AI ports, Voice, Mobile parity, CI alerting + sharded-CI fan-in contract + E2E label-gated/nightly topology + build invocability & CI gate blocking posture, PWA, curriculum versioning, design system |
| `12-observability.md` | Monitoring data boundary, PostHog analytics |
| `13-rag-cache.md` | RAG eval harness, Voyage rerank, grounded-answer cache, response-cache, Knowledge Intelligence |
| `14-audit-remediation.md` | Engineering audit cycles 1-8, tier-2 PRs |
| `15-cross-cutting.md` | Cross-cutting, schema reproducibility, event-sourced migration |
