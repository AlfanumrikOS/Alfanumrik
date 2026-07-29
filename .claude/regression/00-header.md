# Regression Catalog

Authoritative list of regression tests that MUST exist and pass before release.
Each entry links to the asserting test(s). Removing an entry requires explicit
user approval.

Status key: `E` = exists and passing | `P` = partial | `M` = missing.

**Total catalog: 321 entries (target: 35 — TARGET EXCEEDED).**
Latest: REG-318..REG-321 (2026-07-29, forensic-audit fix batch, PR #1410 —
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
count undercounts. The 317 (now 321) figure is the authoritative
incrementally-maintained running total: each entry's own addition updates
"Pre-REG-N: X entries ... **Total catalog: X+1 entries**" in the same
commit, and the highest such self-declaration in the shard set (this file
and `11-infrastructure.md` at REG-317, now this file at REG-321) is treated
as ground truth. Known intentional ID gaps below REG-296 (never
renumbered, do not fill): REG-1..REG-35 (catalog numbering starts at
REG-36; REG-1..35 were never used — SG-1..SG-6 in `01-subject-governance.md`
use a separate prefix), REG-80/81/82 (recommended in `03-quiz-integrity.md`/
`05-xp-scoring.md`, never added), REG-170 (intentionally skipped — see
`03-quiz-integrity.md`), REG-176 (present, prose format — NOT a gap, a
counting-format artifact, see above). REG-296 through REG-317 are fully
contiguous with no gaps; REG-322 is the next free id after this promotion.
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
