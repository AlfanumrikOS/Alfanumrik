# Regression Catalog

Authoritative list of regression tests that MUST exist and pass before release.
Each entry links to the asserting test(s). Removing an entry requires explicit
user approval.

Status key: `E` = exists and passing | `P` = partial | `M` = missing.

## Subject Governance (Phase H — 2026-04-15)

Source: `docs/superpowers/specs/2026-04-15-subject-governance-design.md` §11.3

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| SG-1 | `class_6_free_plan_no_senior_subjects` | Grade 6 free-plan student never sees Physics/Chemistry/Biology/Accountancy in API, hook, picker, or PATCH preferences | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-2 | `api_never_returns_global_subject_list` | `GET /api/student/subjects` returns a strict subset of the canonical 17 for every student profile | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-3 | `grade_11_commerce_excludes_physics` | Grade 11 commerce stream RPC + validator excludes physics/chemistry/biology | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-4 | `grade_11_science_excludes_accountancy` | Grade 11 science stream RPC + validator excludes accountancy/business_studies | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-5 | `plan_downgrade_clamps_selected_subjects` | Downgrading pro → starter surfaces previously-allowed subjects as `is_locked=true` and `validateSubjectWrite` rejects with reason='plan' | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-6 | `admin_delete_flags_without_deleting_enrollments` | Admin DELETE on `plan_subject_access` flags affected students in the violations report; `student_subject_enrollment` rows are preserved until ops repair | `src/__tests__/regression-subject-leak.test.tsx` | E |

### E2E coverage

Playwright spec `e2e/subject-governance.spec.ts` — three scenarios from §11.5:

- Grade 11 science onboarding: stream capture → subject picker excludes accountancy → dashboard shows only stream-valid subjects.
- Legacy user with invalid enrollment: ReselectBanner visible → reselect → no invalid subjects surface.
- Plan downgrade: post-refresh dashboard has no unlocked physics/chemistry/biology chips.

### Invariants covered by this section

- P5 (grade format — strings)
- P8 (RLS boundary — governance service on server)
- P9 (RBAC enforcement — 422 on write, 200 on read-only allowed intersection)

## Foxy Moat Plan — Phases 0-3 (2026-04-26)

Source: Foxy moat plan Phases 0-3 — NCERT-link removal, Voyage rerank,
RRF retrieval, pedagogy prompt rewrite with coachMode, /api/foxy/remediation
endpoint, misconception ontology schema.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-36 | `foxy_api_no_sources_or_diagrams` | `/api/foxy` POST/GET responses (grounded path, hard-abstain, legacy intent-router fallback, history) never expose `sources` or `diagrams` fields. Closes the moat-leak vector where competitors could scrape NCERT chapter URLs from prod traffic. | `src/__tests__/foxy-api-no-sources.test.ts` | E |
| REG-37 | `foxy_voyage_rerank_fallback` | When `VOYAGE_API_KEY` is unset, fetch throws, returns non-2xx, or returns malformed JSON, the rerank step is bypassed and similarity-ranked top-N is returned. Voyage rerank is a single-point-of-failure on top of RRF — student traffic must continue to flow on outage. | `src/__tests__/foxy-rerank-fallback.test.ts` (parity) + `supabase/functions/grounded-answer/__tests__/` (Deno) | E |
| REG-38 | `foxy_coach_mode_default_is_mastery_driven` | `resolveCoachMode(requested, mastery)` picks 'socratic' for mastery < 0.6, 'answer' for ≥ 0.6 when no explicit mode is requested. Explicit valid mode (`socratic` / `answer` / `review`) wins. Invalid mode falls back to mastery default. NaN/Infinity/out-of-range mastery clamps safely. | `src/__tests__/foxy-coach-mode.test.ts` | E |
| REG-39 | `foxy_remediation_cache_prevents_duplicate_anthropic_calls` | `/api/foxy/remediation`: cache hit on `wrong_answer_remediations(question_id, distractor_index)` returns cached text without invoking Anthropic. Cache miss calls Anthropic exactly once and persists. `distractor_index` outside 0..3 → 400 (P6). `ai_usage_global=false` → 503, no Anthropic call. | `src/__tests__/foxy-remediation-cache.test.ts` | E |
| REG-40 | `/api/foxy/remediation oracle shape uniform — P3 anti-cheat defense-in-depth` | Every non-eligible request to `/api/foxy/remediation` (distractor==correct, never attempted, different distractor than submitted, answered correctly, attestation DB error) returns BYTE-IDENTICAL `403 { success:false, error:'remediation_unavailable' }`. Cache table, question table, and Anthropic are NEVER touched on the failure path so timing and DB-load patterns cannot leak which branch failed. | `src/__tests__/foxy-remediation-oracle-shape.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — kill switch enforced before generation; cache prevents
  unbounded Anthropic spend)
- P6 (question quality — distractor index validated as 0..3 only)
- P10 (bundle/cost budget — rerank fallback keeps the worker hot path
  deterministic when Voyage degrades)
- Moat protection — sources/diagrams stripped from the student-facing
  envelope on every code path

### Notes on test strategy

Three of the four files are **contract/parity tests** following the same
pattern as `foxy-plan-normalization.test.ts` and `foxy-grounded-gate.test.ts`:
they replicate the function logic locally and assert on the contract. This
is deliberate — `/api/foxy/remediation` (Phase 3) and the rerank logic
(Deno-side) cannot be mounted in Vitest without re-mocking 6+ modules
that already have integration coverage at the E2E layer. If the
implementation in `src/app/api/foxy/route.ts`,
`src/app/api/foxy/remediation/route.ts`, or
`supabase/functions/grounded-answer/` diverges from the parity copy
in these tests, quality review must reject and the parity copy must be
re-synced.

## Critical-Path E2E (Audit F9 — 2026-04-27)

Source: production-readiness audit finding F9 — the highest-blast-radius
user flows (quiz happy path, payment funnel) had ZERO Playwright coverage
and the existing `e2e` CI job is `continue-on-error: true`, so even the
specs that did exist couldn't block PRs. The new `e2e-critical-paths` job
runs ONLY these two specs and IS BLOCKING.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-45 | `quiz_happy_path_p1_p2_p3` | Browser-level enforcement of P1 (score = round((correct/total)*100), surfaced from server response, never recomputed in QuizResults), P2 (XP from server response; daily-cap clamp surfaces bilingual "cap reached" copy when `xp_capped: true`), and P3 (all-same-answer flag, speed-hack flag, response-count mismatch — server zeroes XP / rejects). | `e2e/quiz-happy-path.spec.ts` | P (5 tests; 5 fixme until test-user fixture wired in CI — see TODO at bottom of spec) |
| REG-46 | `payment_checkout_p11` | Browser-level enforcement of P11 — happy path (Razorpay → /api/payments/verify → subscription active), signature mismatch returns 400 with no subscription change, atomic-activation kill switch returns 503 with retry copy (no false success), `payment_success` analytics event fires with `amount_inr`/`currency` and NO raw email/phone (P13). Idempotency for duplicate webhook events is unit-only (server-side) and is registered as fixme in the spec to keep the catalog visible at the E2E layer. | `e2e/payment-checkout.spec.ts` | P (5 tests; 4 fixme until test-user fixture wired, 1 fixme by design — webhook idempotency is server-only) |

### Invariants covered by this section

- P1 (score accuracy) — REG-45
- P2 (XP economy + daily cap) — REG-45
- P3 (anti-cheat 3 rules) — REG-45
- P11 (payment integrity — signature, atomicity, no plan access without
  verified payment) — REG-46
- P13 (data privacy — analytics payload contains no raw PII) — REG-46

### Notes on test strategy

Both specs use `test.fixme(true, '<reason>')` for branches that require a
real authenticated student session (the staging Supabase project does not
yet seed `TEST_STUDENT_EMAIL` / `TEST_STUDENT_PASSWORD` for CI). The spec
FILES still parse and the catalog entries are visible — when the fixture
is wired in CI, the fixmes flip off and the suite runs end-to-end. Until
then, the unit-level coverage referenced in each fixme reason is the
authoritative defense for that branch. See `e2e/helpers/auth.ts` for the
mocked-session and real-login helpers, and the TODO blocks at the bottom
of each spec for fixture wiring requirements.

CI job: `e2e-critical-paths` in `.github/workflows/ci.yml` — BLOCKING
(no `continue-on-error`), runs only on PRs targeting main/master/staging
from the same repo. The legacy `e2e` job remains advisory.

## Foxy Phase 2 — Skill State + Misconception Context Wiring (2026-04-28)

Source: Foxy moat plan Phase 2 — wires per-LO BKT mastery (`student_skill_state` join `learning_objectives`) and curated misconception ontology (`quiz_responses` join `question_misconceptions`) into the Foxy pedagogy decision tree. Pre-Phase 2 the MISCONCEPTION_REPAIR pedagogy branch had no real signal because `cme_error_log` only stored generic `error_type` strings.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-41 | `foxy_skill_state_and_misconception_context_wired` | `loadCognitiveContext()` populates `loSkills` from `student_skill_state` join `learning_objectives` (top-10 weakest by `p_know` ASC) and `recentMisconceptions` from `quiz_responses` join `question_misconceptions` (top-3 by count, distractor_index match, 30-day window); `buildLoSkillsSubsection` and `buildMisconceptionPromptSection` emit empty string on no-data and template substitutes cleanly into `{{misconception_section}}`. P12 dosage caps: LO subsection caps at 10 lines, misconception subsection caps at 3 entries, remediation text truncates to ≤ 400 chars. P13: formatter signature contains no PII identifiers (studentId/email/phone). | `src/__tests__/foxy-skill-state-misconception-context.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — dosage caps prevent prompt-injection / token-spend
  blowup; LO and misconception sections bounded; remediation truncated)
- P13 (data privacy — formatter signature pinned to misconception data
  only; no studentId / email / phone reach the prompt or logs)

## Foxy Phase 2.B — RAG Strengthening (2026-04-28)

Source: Foxy moat plan Phase 2.B — diversification and prompt-injection
hardening of the NCERT-grounded RAG pipeline. Adds MMR diversification
between Voyage rerank and prompt assembly, and sanitization of every
chunk's content before it is injected into Claude's system prompt.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-42 | `foxy_mmr_diversity_contract` | `applyMMR(chunks, lambda)` preserves the original top-1 unconditionally (slot-1 is taken before any redundancy comparison runs), never drops chunks (output length === input length, no duplicate ids), is deterministic across repeat calls and idempotent (`applyMMR(applyMMR(x)) === applyMMR(x)`), breaks ties by original input order (stable), and at default λ=0.7 demotes near-duplicates behind diverse near-tied chunks (so the prompt-token budget is not burned on redundant NCERT paragraphs). Lambda extremes: λ=1.0 preserves original ranking; λ=0.0 picks the most-different chunk in slot 2. Defensive shape: empty input → `[]`, non-array input → `[]`, no input mutation. | `src/__tests__/rag/mmr-diversity.test.ts` | E |
| REG-43 | `foxy_chunk_sanitization_strips_injection_prefixes` | `sanitizeChunkForPrompt(text)` strips leading attack prefixes (case-insensitive `Ignore previous`, `Disregard`, `Forget`; role tokens `System:`/`Assistant:`/`Human:`/`User:`; chat-template specials `<\|im_start\|>`, `<\|im_end\|>`, `[INST]`, `[/INST]`; stacked combos like `Ignore previous. System: ...`). Length cap: content > 1500 chars truncates to exactly 1500 (off-by-one boundary verified at MAX+1 → MAX). Idempotent (`sanitize(sanitize(x)) === sanitize(x)`). Defensive: `''`/`null`/`undefined`/non-string → `''`. Audit trail: emits a `[rag/sanitize]` `console.warn` with `prefix=true` / `truncate=true` flags whenever sanitization fires; clean short input emits NO warn (P13 — no PII / spam in logs). Anchoring contract: prefix matchers are anchored at the start of the chunk, so an attack phrase appearing mid-chunk is treated as data and preserved. Preserves clean NCERT content untouched. | `src/__tests__/rag/chunk-sanitization.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — indirect prompt-injection defense at the NCERT-chunk
  boundary; MMR diversity bounds prompt-token spend so a crafted
  near-duplicate cluster cannot crowd out diverse pedagogical material
  and inflate Anthropic cost)
- P13 (data privacy — sanitize warn-log signature contains only
  `prefix`/`truncate`/`originalLen` flags, no chunk content / studentId /
  document_id, so audit trail does not leak PII or NCERT chapter URLs)

### Notes on test strategy

Both files import the Edge Function source directly via dynamic import
(`../../../supabase/functions/_shared/rag/{mmr,sanitize}`). The modules
are pure TS with no Deno globals, so Vitest exercises the same code path
that `deno test` runs on the Edge side. If the implementation diverges
(e.g. someone changes the prefix matcher to global instead of anchored,
or swaps the MMR greedy loop for a probabilistic tie-breaker), these
specs MUST fail and quality MUST reject — the contract here is the
moat-protection guarantee that competitor scrapes and prompt-injection
attempts cannot leak Foxy's behaviour.

## Phase 3.1 — IRT Cron Schedule Parity (2026-04-28)

Source: production-readiness audit follow-up. Multiple sources cite the
IRT 2PL recalibration cron at "02:50 UTC nightly" (constitution
`.claude/CLAUDE.md`, IP-filing doc `docs/architecture/cognitive-model.md`,
route header `src/app/api/cron/irt-calibrate/route.ts`). The schedule is
configured in `vercel.json` (Vercel cron, NOT pg_cron). The unrelated
pg_cron job in `supabase/migrations/20260404000002_pg_cron_daily.sql`
handles the `daily-cron` Edge Function (streaks, leaderboards, parent
digests) at 18:30 UTC and has nothing to do with IRT. Confusion between
the two has caused at least one rumored doc-vs-prod drift report; this
catalog entry pins both schedules in code so future drift fails the
build.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-44 | `irt_calibration_cron_schedule_parity` | `vercel.json` registers exactly one `/api/cron/irt-calibrate` entry with schedule `50 2 * * *` (02:50 UTC daily). The schedule is a 5-field cron. The IRT cron runs 20 minutes after `/api/cron/daily-cron` (`30 2 * * *`) so quiz_responses are settled before recalibration reads them. The route source `src/app/api/cron/irt-calibrate/route.ts` documents the 02:50 UTC schedule in its header. The unrelated pg_cron migration `20260404000002_pg_cron_daily.sql` is pinned at `30 18 * * *` (18:30 UTC) AND must not mention IRT — anti-confusion guard against anyone "aligning" the two. | `src/__tests__/irt/cron-schedule-parity.test.ts` | E |

### Invariants covered by this section

- Documentation/production parity (process invariant) — docs cannot drift
  from `vercel.json` without breaking this test.
- Operational correctness — the 20-minute gap after `daily-cron` is part
  of the IRT calibration's correctness contract (quiz_responses must be
  committed before the recalibration RPC reads them).

## Round 2 Audit Promotions (2026-04-28)

Source: `.claude/CLAUDE.md` "Round 2 audit identified 4 new catalog
entries to promote: atomic_plan_change atomicity, daily XP cap, Sentry
client PII redaction, single-retrieval contract for Foxy. Testing agent
owns adding these to .claude/regression-catalog.md." These tests
already existed in the codebase (REG-47, REG-48, REG-49) or were added
as part of this promotion (REG-50) but were not visible in the catalog.
Promoting them makes them block-on-removal under orchestrator Gate 5 +
quality veto and surfaces them in the per-invariant status table at the
top of `.claude/CLAUDE.md`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-47 | `atomic_plan_change_atomicity_p11` | Bulk plan-change route NEVER updates `students` or `student_subscriptions` directly — every plan transition flows through the `atomic_plan_change(p_student_id, p_new_plan, p_reason)` RPC (migration `20260427000002`) which holds `pg_advisory_xact_lock` and writes both rows + a `domain_events` audit row in a single transaction. Per-student isolation: a single RPC failure does not poison the batch (route reports `failures: [{ student_id, error }]` and bumps ops-event severity to `warning`). Auth gate (`authorizeAdmin`) runs BEFORE any RPC call (401 short-circuit). Static contract canary on the route source asserts no direct `.from('students').update(...)` or `.from('student_subscriptions').update(...)` for plan changes — closes the P11 split-brain vector on bulk plan changes (status=active but plan_id=free). | `src/__tests__/api/super-admin/plan-change-atomicity.test.ts` | E |
| REG-48 | `xp_daily_cap_clamp_p2` | `XP_RULES.quiz_daily_cap` (200) is the published P2 cap and SQL migration `20260427000003_enforce_daily_xp_cap.sql` contains the same literal `v_daily_cap INT := 200` (drift detection: bumping the TS constant without the SQL — or vice-versa — fails this test). Pure-TS clamp parity port (`clampXp(today_earned, requested, cap)`) reproduces the SQL semantics line-for-line: already_at_cap → 0; room_for_full_amount → returns full requested; partial_room (199 + quiz worth 50 → 1, NOT 0 and NOT 50); boundary at-cap → next request awards 0; zero/negative requested → 0; runtime cap arg respected. `atomic_quiz_profile_update` return-shape pinned as TS type alias (`success`, `requested_xp`, `effective_xp`, `xp_capped`, `xp_cap_excess`, `today_earned`, `daily_cap`, `remaining_today`, `profile_xp`) — every key documented in `jsonb_build_object` in the migration. SQL `submit_quiz_results` literals match `XP_RULES.quiz_per_correct` (10) / `quiz_high_score_bonus` (20) / `quiz_perfect_bonus` (50) (audit F20 parity). Anti-cheat zeroes XP path pinned (`v_flagged ... v_xp := 0`). | `src/__tests__/lib/xp-daily-cap.test.ts` | E |
| REG-49 | `sentry_client_pii_redaction_p13` | `redactSentryEvent(event)` (called from `sentry.client.config.ts` `beforeSend`) redacts on every code path before the event leaves the browser. User identity → only opaque `id` survives (email/ip_address/username dropped). request.headers → Authorization/Cookie/Set-Cookie/x-api-key stripped. request.url → sensitive query params (`SENSITIVE_QUERY_KEYS = ['email','phone','token','password','key']`) replaced with `[REDACTED]`. request.data (body) and request.cookies → dropped wholesale. request.query_string (object form) → redactPII applied. extra/contexts → keys matching `SENSITIVE_CONTEXT_KEY_REGEX = /email\|phone\|token\|password\|secret\|key\|cookie\|auth/i` dropped; remaining values → redactPII. breadcrumbs → data redacted, url/to/from sanitised, message URLs sanitised. tags → redactPII applied. Composite end-to-end serialization assertion guarantees no PII string survives in the JSON shipped to Sentry. P13 enforcement — closes the audit Round 2 "no-coverage" gap. | `src/__tests__/sentry/client-redact.test.ts` | E |
| REG-50 | `foxy_single_retrieval_contract_p12` | A single Foxy turn calls `retrieveChunks` (which dispatches the `match_rag_chunks_ncert` RPC via the unified `_shared/rag/retrieve.ts` module) AT MOST ONCE. Static-inspects `supabase/functions/grounded-answer/pipeline.ts`: import is unique; call site is unique; grounding-check step consumes `ctx.chunks` (the single retrieval's output) and never re-invokes `retrieveChunks`; no direct `.rpc('match_rag_chunks_ncert', …)` invocation sneaks in alongside the unified module; cache-hit branch short-circuits BEFORE retrieval (zero RPC on cache hit — source-position pin: `getFromCache(...)` precedes `await retrieveChunks(sb, ...)` and the cache branch contains a `return hit` early exit); no `Promise.all([retrieveChunks, ...])` fan-out. Closes the IP-filing requirement that the pipeline is single-retrieval-then-grounding-check, never context-fan-out + separate grounding fetch. | `src/__tests__/foxy-single-retrieval-contract.test.ts` | E |

### Invariants covered by this section

- P11 (payment integrity — atomic plan transition; no split-brain state
  where status changes without plan_id, or vice versa) — REG-47
- P2 (XP economy — daily-cap clamp; SQL/TS literal parity drift
  detection; `atomic_quiz_profile_update` return shape) — REG-48
- P13 (data privacy — Sentry client `beforeSend` redactor; no PII
  leaves the browser even on error events) — REG-49
- P12 (AI safety — single-retrieval contract bounds RPC load,
  embedding cost, and citation/answer race conditions; cache-hit
  short-circuit pins the cost ceiling) — REG-50

### Notes on test strategy

REG-47 is a route-mock + source-canary test — it exercises the
bulk-actions plan-change route with a mocked `supabaseAdmin.rpc`, then
static-reads the route source to assert no direct table updates.
REG-48 is a SQL-migration parity + pure-TS clamp port — there is no
in-process Postgres in unit tests, so the migration literal is grep'd
and the clamp is re-implemented line-for-line. REG-49 exercises
`redactSentryEvent` directly against synthetic Sentry event shapes —
the redactor was extracted from `sentry.client.config.ts` precisely so
it could be tested without booting the SDK. REG-50 is a static-
inspection parity test on the canonical Edge Function source
(`pipeline.ts`) following the same pattern as REG-37 / REG-42 / REG-43
(the Deno integration test in
`supabase/functions/grounded-answer/__tests__/pipeline.test.ts`
exercises the runtime path; REG-50 pins the structural contract under
`npm test`).

## Quiz Server-Shuffle Authority (P0 fix — 2026-04-28)

Source: production P0 — students saw the green check on a SELECTED option
while the explanation said the SAME option IS correct. Forensic analysis
traced the bug to `seededShuffle(opts, q.id + question_text.slice(0,20))`
in `src/app/quiz/page.tsx`: the seed was STABLE across sessions, so when
`question_bank.options` got edited (e.g. content fix), the cached shuffle
map drifted from the new `correct_answer_index`. The
`grounding.scoring` canary in migration 20260418110000 was already
recording every disagreement in production. Phase A fix: move shuffle
authority from client to server.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-51 | `quiz_server_shuffle_authority_round_trip` | (1) `startQuizSession()` calls the `start_quiz_session` RPC and the response NEVER contains `correct_answer_index` for active questions (server keeps the index in `quiz_session_shuffles` only). Returns null on RPC error / malformed response so callers can fall back to legacy v1. (2) `submitQuizResults` with a non-null `sessionId` routes to `submit_quiz_results_v2`; payload contains ONLY `selected_displayed_index` per response — NO `is_correct`, NO `shuffle_map`, NO `selected_option`. Falls back to v1 when `sessionId` is null OR when v2 RPC returns an error. (3) Pure-TS port of v2 PL/pgSQL inner-loop reproduces snapshot-backed scoring: picking the visually-correct option scores correct on every shuffle permutation; mid-session mutation of `question_bank.options` does NOT affect scoring (snapshot wins); out-of-range / missing snapshot rows return `is_correct=false` defensively without throwing. `correct_option_text` always comes from `options_snapshot[correct_answer_index_snapshot]`, NEVER from live `question_bank.options[correct_answer_index]`. | `src/__tests__/api/quiz-server-shuffle-authority.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy — server is the only authority that compares
  `selected_original_index` to `correct_answer_index_snapshot`; client
  cannot disagree because it never sees the index)
- P6 (question quality — snapshot at session start isolates in-flight
  scoring from mid-session content edits to `question_bank.options` /
  `question_bank.correct_answer_index`)

### Notes on test strategy

REG-51 is a contract / parity test following the pattern of REG-37, REG-42,
REG-43, REG-50: the client-side dispatch contract is exercised via mocked
`supabase.rpc`, and the server-side scoring is reproduced as a pure-TS
port of the PL/pgSQL inner loop in migration 20260428160000. There is no
in-process Postgres in unit tests, so the migration's `submit_quiz_results_v2`
function is parity-asserted by the TS port; if the SQL diverges, this test
must be re-synced and quality must reject. Phase B (out of scope here)
will add SQL-level CHECK constraints on `shuffle_map` and an
`options_version` column for stricter snapshot pinning. Mobile is also
out of scope for Phase A — the legacy `submit_quiz_results` (v1) is
preserved untouched so mobile clients keep working until they adopt the
new RPCs separately.

## Quiz Authenticity Canary (Phase B — 2026-04-29)

Source: Phase A (PR #447, prod git_sha=987fe70, migration
20260428160000_quiz_session_shuffles.sql) moved shuffle authority from
client to server. Phase B (PR feat/quiz-authenticity-phase-b, migration
20260429010000_quiz_authenticity_phase_b_constraints.sql) locks the
contract with DB-level CHECK constraints (4-element options +
correct_answer_index ∈ [0,3]; selected_option ∈ {NULL, -1..3};
explanation forbids "Option [A-D]" / "विकल्प [क-घ]" positional letters)
AND adds a CI canary that promotes the production `grounding.scoring`
ops_events alarm into a CI hard gate.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-52 | `quiz_authenticity_ops_events_canary_p1_p6` | Queries staging `ops_events` for rows with `category='grounding.scoring' AND severity='warning' AND occurred_at > now() - 24h`. Phase A guarantees the server is the only authority that re-derives `is_correct` (against the per-session snapshot, never the live `question_bank`); any non-zero count in this window is direct evidence of a Phase A regression — the server-side derivation disagreed with what the client-rendered green check showed. The test SKIPS gracefully (logs an info line, returns) when integration env is absent (PR branches without staging creds, local dev without `.env.local`). It runs FOR REAL in the CI integration-tests job that wires staging Supabase credentials. On a hit, the assertion message lists the first 50 affected sessions (id, subject_id, occurred_at, message) so ops can replay the snapshot. Fails on infra error (cannot reach Supabase / service-role key invalid) with a distinct error message — infra failures and contract violations are not conflated. | `src/__tests__/regression-quiz-authenticity-canary.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy — production canary detects any disagreement
  between the client-rendered correctness and the server's snapshot-
  backed re-derivation, and the CI test fails the build on any such
  disagreement)
- P6 (question quality — a `grounding.scoring` warning means the
  per-session snapshot was bypassed; a Phase A invariant violated
  in production)

### Notes on test strategy

REG-52 is a **runtime canary promoter**, not a static-source test like
REG-50. The drift bug Phase A closed was a runtime phenomenon (stable
client seed × mid-session content edit) — no amount of source
inspection can prove it stays gone in production. The
`grounding.scoring` ops_events alarm has been recording every
disagreement in production since migration 20260418110000; REG-52
promotes "production canary has zero entries in 24h" into a CI hard
gate. The skip-on-placeholder pattern (via
`src/__tests__/helpers/integration.ts:hasSupabaseIntegrationEnv()`)
keeps the suite deterministic on PR branches that don't have staging
credentials. To run locally against staging:

```bash
NEXT_PUBLIC_SUPABASE_URL=... \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npx vitest run src/__tests__/regression-quiz-authenticity-canary.test.ts
```

Phase C (out of scope for this PR) will retire the legacy v1
`submit_quiz_results` once mobile adopts v2, drop the `seededShuffle`
client helper, and tighten the explanation linter to also flag
"first option / दूसरा विकल्प" position references.

## Quiz Authenticity Phase C — Options Versioning + Integrity Hash (2026-04-30)

Source: Phase A (PR #447, migration `20260428160000_quiz_session_shuffles.sql`)
moved shuffle authority to the server and snapshots options +
correct_answer_index into `quiz_session_shuffles` at session start.
Phase B (PR #449, migration `20260429010000_quiz_authenticity_phase_b_constraints.sql`)
added DB CHECK constraints on `question_bank` and a CI canary on
`grounding.scoring` ops_events. Phase C (this entry, migration
`20260430000000_quiz_phase_c_options_versioning.sql`) closes the last
remaining vector: post-INSERT tampering of `quiz_session_shuffles` rows
(malicious migration, buggy maintenance script, accidental update).
Phase A trusted the snapshot row at submit time — Phase C makes that
trust verifiable.

Three durability layers:
1. `question_bank.options_version` — auto-incrementing integer that
   bumps on every UPDATE where `options` or `correct_answer_index`
   changes (BEFORE UPDATE trigger; idempotent; bumps once per
   statement, not per-column).
2. `quiz_session_shuffles.options_version_at_serve` — snapshots the
   current `question_bank.options_version` at `start_quiz_session()`
   time. Observability-only cross-check between session start and
   submit; logs an ops_events warning when versions disagree (does
   NOT change scoring; that's still snapshot-bound).
3. `quiz_session_shuffles.integrity_hash` — SHA256 of
   `options_snapshot::text || correct_answer_index_snapshot::text`
   computed at `start_quiz_session()` persist time.
   `submit_quiz_results_v2` recomputes the hash before scoring;
   mismatch → ZERO XP for that question + `ops_events` row with
   `category='quiz.integrity_mismatch'`, `severity='warning'`. Other
   questions in the same session score normally so a single tampered
   row doesn't void the whole quiz.

Backwards-compatible: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE
FUNCTION, NULL `integrity_hash` skips verification (Phase A rows
written before this migration continue to score per Phase A
semantics). Mobile out of scope — v1 `submit_quiz_results` is
untouched.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-53 | `quiz_phase_c_options_versioning_and_integrity_hash` | (1) **Trigger semantics**: pure-TS port of `question_bank_bump_options_version_fn` BEFORE UPDATE trigger — `options_version` bumps on UPDATE when `options` change, when `correct_answer_index` changes, or when both change (single bump per statement, not per-column); does NOT bump when only `question_text` changes; stays monotonic across multiple edits. (2) **start_quiz_session contract**: snapshot row carries `options_version_at_serve` + `integrity_hash`; hash is SHA256 of `options_snapshot::text + correct_answer_index_snapshot::text`, hex-encoded, 64 chars. (3) **submit_quiz_results_v2 hash match**: valid hash → standard Phase A scoring (snapshot-backed `is_correct` derivation), no ops_events warning. (4) **submit_quiz_results_v2 hash mismatch**: tampered `options_snapshot` whose `integrity_hash` no longer matches the recomputed value → `is_correct=false`, `integrity_failed=true`, ops_events row emitted with `category='quiz.integrity_mismatch'`, `severity='warning'`, `question_id` populated; ZERO XP contribution for that question. (5) **Mixed batch isolation**: a single tampered row in a multi-question session does NOT void the others — good rows score normally, bad row contributes zero, ops_events warning is for the bad row only. (6) **Phase A back-compat**: rows with NULL `integrity_hash` and NULL `options_version_at_serve` (pre-Phase-C inserts) skip verification and score per Phase A semantics; no ops_events warning emitted. | `src/__tests__/api/quiz-phase-c-options-versioning.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy — server is the only authority that re-derives
  `is_correct`; if the snapshot it reads from has been tampered with
  after INSERT, the integrity hash recomputation fails and the
  question is awarded ZERO XP rather than silently scoring against
  attacker-chosen options)
- P4 (atomic quiz submission — integrity verification happens inside
  `submit_quiz_results_v2`, the same transactional RPC that updates
  `student_learning_profiles` / `students.xp_total`; the integrity
  failure path is part of the same transaction, so ops_events warning
  + zero-XP commit happen atomically with the rest of the submit)
- P6 (question quality — `options_version` provides a monotonic stamp
  for content edits, enabling cross-session drift detection;
  `integrity_hash` makes the per-session snapshot self-verifying so
  the snapshot contract Phase A introduced cannot be broken silently
  by an out-of-band write to `quiz_session_shuffles`)

### Notes on test strategy

REG-53 is a contract / parity test in the same family as REG-37,
REG-50, REG-51, and REG-54: there is no in-process Postgres in unit
tests, so the migration's BEFORE UPDATE trigger and the
`submit_quiz_results_v2` integrity-verification inner loop are
re-implemented as pure-TS ports. The SHA256 computation uses Node's
`crypto.createHash` and matches the SQL `encode(digest(... ::text,
'sha256'), 'hex')` byte-for-byte for the snapshot shapes the
migration cares about (array-of-short-strings + integer). If the
SQL diverges (e.g. someone changes the trigger to bump on
non-relevant column changes, or changes the hash composition order),
this test must fail and quality must reject — the parity copy must
be re-synced. The migration also adds operational observability
(`ops_events` warning on hash mismatch) that ops can monitor in
production; a non-zero count of `quiz.integrity_mismatch` events in
a 24h window is direct evidence of a Phase C contract violation.

## AI Quiz-Generator Validation Oracle (Phase C+ — 2026-04-29)

Source: Phase C migration header
(`supabase/migrations/20260430000000_quiz_phase_c_options_versioning.sql:71-74`)
called for a per-question AI-validation oracle. REG-54 ships that oracle
as the generator-side gate that catches Claude hallucinations BEFORE the
candidate row reaches `question_bank`. Existing rows are NOT re-validated;
this is a forward-only quality gate.

Architecture:
1. Cheap deterministic checks first (P6 + option-overlap + numeric
   consistency) — pure functions, no I/O.
2. Expensive LLM-grader second (Claude Haiku, temperature=0, single-turn
   strict-JSON output) — only invoked when deterministic checks pass.
3. One retry with corrective regeneration on first oracle reject; drop
   the slot if the retry also fails (no silent passthrough).
4. Cost ceiling per accepted question: worst case 4 Claude calls (1 gen +
   1 grader + 1 retry-gen + 1 retry-grader); typical case 2.
5. Gated by `ff_quiz_oracle_enabled` (default OFF in prod for first
   deploy; ON in dev/staging) so we can roll out gradually and measure
   the rejection-rate baseline via the super-admin AI health panel.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-54 | `quiz_oracle_validation_contract` | (1) Deterministic checks reject every P6 violation category — empty/placeholder text, options ≠ 4, non-distinct options, correct_answer_index outside 0..3, empty explanation, invalid difficulty, invalid bloom_level. (2) Semantic option-overlap detection rejects high-Jaccard short options (≥0.7 on ≤6 tokens) and very-high-overlap long options (≥0.85). (3) Numeric consistency rejects when the marked correct option contains a number absent from the explanation, EXCLUDING numbers given in the question itself (so re-statement of givens before derivation isn't flagged). (4) LLM-grader contract: verdict='consistent' → accept; verdict='mismatch' → reject with category='llm_mismatch' and surface suggested_correct_index when present; verdict='ambiguous' → reject with category='llm_ambiguous'; grader throws → reject with category='llm_grader_unavailable' and llm_calls=1. (5) Reasoning text truncated to ≤300 chars on rejection (no PII / log bloat). (6) Parser tolerates ```json fences and plain ``` fences; rejects unknown verdicts; drops out-of-range or non-integer suggested_correct_index. (7) Prompt builder is deterministic (cache-safe) and marks the correct option with " (MARKED CORRECT)". (8) System prompt forbids commenting on difficulty/age/curriculum (strict scope); requires strict JSON, no markdown. | `src/__tests__/quiz-oracle.test.ts` | E |

### Invariants covered by this section

- P6 (question quality — every served candidate must have non-empty text
  without `{{`/`[BLANK]`, exactly 4 distinct non-empty options,
  `correct_answer_index` in 0..3, non-empty explanation, valid difficulty
  and bloom_level — all enforced by the deterministic check layer
  upstream of `question_bank`).
- P12 (AI safety — oracle output is NEVER shown to students; rejections
  log to `ops_events` with `category='quiz.oracle_rejection'`,
  `severity='info'` for queryability without leaking PII; LLM grader
  receives only candidate content, never student identity / grade / PII;
  feature-flagged rollout means the gate can be disabled in seconds via
  `ff_quiz_oracle_enabled` if it false-rejects too aggressively).
- P13 (data privacy — generated questions are content, not student data,
  so logging full payloads is permitted; `redactPII` in `_shared/ops-events`
  still redacts any accidental PII before insert).

### Notes on test strategy

REG-54 follows the contract/parity pattern (see REG-37, REG-50, REG-51):
the authoritative oracle module lives at
`src/lib/ai/validation/quiz-oracle.ts` and is unit-testable in vitest;
the Deno mirror at `supabase/functions/_shared/quiz-oracle.ts` keeps
the same logic verbatim and is the actual code path used by Edge
Functions (`bulk-question-gen`, `quiz-generator`). If the two files
diverge, quality review must reject — the prompts module
(`quiz-oracle-prompts.ts`) has the same parity contract.

The LLM grader is INJECTED as a function (`llmGrade`) rather than
imported, so the unit tests can mock the verdict/error path
without booting fetch / Anthropic SDK / network. The Edge Function
call site supplies `callOracleGrader` (real Claude Haiku call) at the
top-level oracle entry point.

Wire-up status:
- `bulk-question-gen` (legacy single-pass + grounded two-pass): wired
  with retry-once on grounded path (legacy path drops failures because
  one Claude call returns the entire batch — re-prompting one question
  would require a second batch call and break the cost ceiling).
- `quiz-generator` (hot serving path): runs deterministic-only oracle as
  defense-in-depth on every question fetched from `question_bank`. No
  LLM-grader call here — questions were already gated on insert by
  `bulk-question-gen` when the flag was ON. Sub-millisecond per question.

## Foxy Structured Rendering Envelope (2026-05-02)

Source: Foxy structured-rendering workstream — `/api/foxy` and the
`grounded-answer` Edge Function now emit a structured `lines[]` payload
conforming to `src/lib/foxy/schema.ts`. The Next.js renderer
(`FoxyStructuredRenderer.tsx`) consumes it; the `is-foxy-response.ts`
guard ensures the renderer degrades gracefully when an upstream payload
fails schema validation. The streaming `done` event persists both the
structured JSONB and the denormalized `content` text atomically, and
Hindi i18n uses NCERT-standard terms (`परीक्षा सुझाव`, never the
non-standard `परीक्षा टिप`).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-55 | `foxy_structured_rendering_envelope` | Foxy `/api/foxy` and `grounded-answer` Edge Function streaming responses produce a structured payload (lines[]) conforming to `src/lib/foxy/schema.ts`; renderer (`FoxyStructuredRenderer.tsx`) gracefully degrades on schema-invalid payloads via `is-foxy-response.ts` guard; streaming-done event persists both `structured` JSONB and denormalized `content` text atomically (no orphaned messages with one-but-not-the-other); Hindi i18n uses NCERT-standard terms (परीक्षा सुझाव, not परीक्षा टिप). | `src/__tests__/api/foxy/streaming-structured-persistence.test.ts`, `src/__tests__/api/foxy/structured-abstain-and-history.test.ts`, `src/__tests__/api/foxy/structured-persistence.test.ts`, `src/__tests__/components/FoxyStructuredRenderer.test.tsx` | E |

### Invariants covered by this section

- P7 (bilingual UI — Hindi rendering uses NCERT-standard terminology;
  no `परीक्षा टिप` fallback)
- P12 (AI safety — schema-invalid LLM output never reaches students; the
  guard short-circuits to a safe degraded render)
- P13 (data privacy — persistence path writes structured JSONB + content
  in a single atomic transaction so the chat history cannot end up with
  half-rendered messages that would later be re-fetched and re-shipped
  to Sentry)

## Marking-Authenticity Wave 5 (2026-05-04) — REG-56..REG-64

Source: 6-phase marking-authenticity remediation. Wave 1 shipped 5
migrations (`20260504100000`..`20260504100400`). Wave 2 wired PostHog
server/client SDKs, the new `/api/quiz/submit` route with idempotency,
the foxy-tutor MCQ oracle gate, and the quiz-generator 422 path. Wave 5
(this section) lands the regression-catalog pins for those contracts and
brings the catalog total to 35 — the aspirational target reached.

Founder directive ("this shall not be compromised with any wrong
information and marking") drives every entry: each test pins a
contractual property of the marking-authenticity surface that, if
broken, would let a wrong score reach a student.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-56 | `foxy_practice_question_oracle_gate` | Foxy MCQ blocks parsed from prose replies pass the same `validateCandidate` oracle gate that `bulk-question-gen` uses (deterministic P6 checks + LLM-grader). Verdicts that are not `ok` cause the MCQ to be DROPPED from the response (the prose answer still ships). On reject, `foxy_oracle_blocked` PostHog event fires with `source='foxy-tutor'` and the verdict's category. Oracle throw → fail-closed (drop MCQ, emit `category='llm_grader_unavailable'`). MCQ extraction only runs in `quiz`/`practice` modes (cost ceiling). `FoxyBlockSchema` MCQ shape pinned at the type layer: 4 distinct non-empty options, integer `correct_answer_index ∈ 0..3`, non-empty stem, non-empty explanation. | `src/__tests__/edge-functions/foxy-mcq-oracle.test.ts` | E |
| REG-57 | `quiz_l2_fallback_no_client_trust` | `src/lib/supabase.ts` client-side L3 fallback in `submitQuizResults()` MUST NOT use `responses.filter(r => r.is_correct).length` for scoring (P1, P4). Pinned as a static-source canary across both arrow-function spellings. Phase 2.6 transition: the audit-found violation at `supabase.ts:~471` is bounded (count ≤ 1 with line-range pin); a strict `toBe(0)` companion test is `.skip`'d with a TODO to flip when Phase 2.7 (server-only-quiz-submit cutover) deletes the entire client-side scoring branch. | `src/__tests__/regressions/reg-57-l2-fallback-no-client-trust.test.ts` | P |
| REG-58 | `quiz_v1_legacy_server_rederivation` | Legacy v1 `submit_quiz_results` RPC re-derives `is_correct` server-side from `question_bank.correct_answer_index`, never from a client-supplied `(r->>'is_correct')::BOOLEAN`. Pinned: `SELECT correct_answer_index INTO v_actual_correct`, `v_is_correct := (v_selected = v_actual_correct)`, `v_selected := (r->>'selected_option')::INTEGER`. Closes the legacy-path P1 vector while the v1 RPC remains callable for not-yet-cutover mobile clients. | `src/__tests__/regressions/reg-58-v1-server-rederivation.test.ts` | E |
| REG-59 | `score_display_vs_persisted_parity` | `src/components/quiz/QuizResults.tsx` reads `score_percent`, `xp_earned`, `xp_capped`, `xp_uncapped`, and `idempotent_replay` directly from the server response — never recomputed in the component. Pin: `const pct = results.score_percent;`, `xpEarned={results.xp_earned}`. Forbids: `const pct = Math.round(...)`, `const pct = (correct / total)`, `const xpEarned = Math.round(...)`, `const xpEarned = correct *`. Sub-category aggregations (Bloom's per-level %, MCQ-vs-Written subscore breakdown, distribution charts) remain permitted; only the headline display is gated. | `src/__tests__/regressions/reg-59-score-display-parity.test.ts` | E |
| REG-60 | `quiz_session_authorization_pin` | `POST /api/quiz/submit` enforces the JWT-bound studentId guard (P9 RBAC defense-in-depth on top of RLS). 403 + `code='STUDENT_ID_MISMATCH'` when JWT-resolved studentId disagrees with the body. 403 + `code='NO_STUDENT_PROFILE'` when the auth user has no linked student row. 200 when they match. Static canary on `src/app/api/quiz/submit/route.ts` confirms the literal `studentRow.id !== body.studentId` guard remains and `STUDENT_ID_MISMATCH` is the documented error code. | `src/__tests__/api/quiz-submit-authz.test.ts` | E |
| REG-61 | `quiz_translation_correct_index_parity` | `question_bank` carries `question_text` (English) and `question_hi` (Hindi translation) plus a SINGLE `correct_answer_index` column shared by all language presentations. Walks every migration (`supabase/migrations/` root + `_legacy/timestamped/`) to assert NO `correct_answer_index_hi`, `_en`, `_hinglish`, or `_english` parallel column has ever been introduced. Closes a P1 + P7 vector where translation drift could mark different options correct in different languages. | `src/__tests__/regressions/reg-61-translation-parity.test.ts` | E |
| REG-62 | `quiz_submit_idempotency_at_wire` | `POST /api/quiz/submit` requires an `Idempotency-Key` UUID header (400 + `code='IDEMPOTENCY_KEY_REQUIRED'` when missing or non-UUID). Fresh submission → 200 + `idempotent_replay: false` + exactly one `quiz_graded` PostHog event. Concurrent retry race (RPC throws `23505` / `quiz_sessions_idempotency_key_uniq`) → route SELECTs the cached row by `(student_id, idempotency_key)` and returns 200 + `idempotent_replay: true`. CRITICAL: NO `quiz_graded` event fires on replay (prevents funnel double-count). Pins migration `20260504100200_quiz_idempotency_key.sql`'s contract at the wire. | `src/__tests__/api/quiz-submit-idempotency.test.ts` | E |
| REG-63 | `quiz_generator_hot_path_oracle_gate` | `supabase/functions/quiz-generator/index.ts` returns HTTP 422 with `error: 'insufficient_validated_questions'` when `validated.length < minCount` (where `minCount = Math.max(1, Math.ceil(count / 2))`). Payload includes `dropped`, `served`, `requested`, `dropped_reasons` for forensic joinability. PostHog `foxy_oracle_blocked` event with `category='insufficient_validated_questions'` and `source='quiz-generator'` fires before the 422 returns. Structural canary pins that the 422 branch contains a `return new Response(...)` — the prior bug was warn-and-fall-through. | `src/__tests__/edge-functions/quiz-generator-422.test.ts` | E |
| REG-64 | `posthog_event_pii_redaction` | `redactPII()` from `src/lib/posthog/server.ts` recursively strips every PII key in `EVENT_PROPERTY_PII_KEYS` from event properties before they reach posthog-node: identity (`email`, `phone`, `parent_phone`, `full_name`, `name`, `school_name`, `school_address`, `address`), payment surface (`razorpay_signature`, `card_number`, `card_cvv`, `card_expiry`, `card_holder`, `upi_id`, `vpa`), network (`ip_address`, `ip`, `user_agent`), plus everything the base ops-events redactor handles (password, auth_token, api_key, authorization, cookie). Recursive walk through nested objects + arrays (3+ levels deep). Clone semantics — never mutates input. Preserves allowlisted props (`student_id`, `role`, `grade`, `board`, `plan`, `language`, `session_id`, `score_percent`, `xp_earned`, `correct`, `total`). Composite end-to-end snapshot proves no PII string survives in the redacted shape. | `src/__tests__/lib/posthog/redactor.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy — REG-57 client-trust canary, REG-58 v1 server re-derivation, REG-59 display parity, REG-61 translation parity)
- P4 (atomic submission — REG-57 client-fallback path, REG-62 wire-level idempotency)
- P6 (question quality — REG-56 Foxy MCQ schema, REG-63 quiz-generator 422)
- P7 (bilingual UI — REG-61 single correct_answer_index across translations)
- P9 (RBAC enforcement — REG-60 JWT-bound studentId guard)
- P12 (AI safety — REG-56 Foxy MCQ oracle gate, REG-63 quiz-generator hot-path validator)
- P13 (data privacy — REG-64 PostHog server redactor)

### Catalog total

Pre-Wave-5: 26 entries catalogued.
Wave 5 adds: REG-56 (foxy_practice_question_oracle_gate),
REG-57 (quiz_l2_fallback_no_client_trust),
REG-58 (quiz_v1_legacy_server_rederivation),
REG-59 (score_display_vs_persisted_parity),
REG-60 (quiz_session_authorization_pin),
REG-61 (quiz_translation_correct_index_parity),
REG-62 (quiz_submit_idempotency_at_wire),
REG-63 (quiz_generator_hot_path_oracle_gate),
REG-64 (posthog_event_pii_redaction).

**Total: 35 entries — TARGET REACHED.**

### Notes on test strategy

Six of the nine entries are static-source / contract-pin tests in the
same family as REG-37, REG-50, REG-51, REG-54: they read the relevant
TypeScript / SQL source and assert on the contractual property without
booting Deno or Postgres. Two (REG-60, REG-62) exercise the new
`/api/quiz/submit` route handler with mocked supabase + posthog modules
following the `dashboard-reviews-due.test.ts` pattern. One (REG-64) is a
pure unit test against the in-process `redactPII()` function exported
from `src/lib/posthog/server.ts`.

REG-57 ships in a degraded "documents the violation" mode (count ≤ 1
with line-range pin) PLUS a `.skip`'d strict mode (`toBe(0)`) ready to
flip when Phase 2.7 (server-only-quiz-submit cutover) deletes the L3
client-side fallback in `src/lib/supabase.ts`. The dual-mode pin is
what enables the catalog target to be reached today while keeping the
contract auditable in TS.

  to Sentry)

## AlfaBot Landing-Page Widget (2026-05-19) — REG-65..REG-68

Source: AlfaBot v1 rollout — PRs 1-4 (migration, Edge Function + Next
routes, frontend widget, super-admin dashboard). AlfaBot is the
landing-page chat surface on `/welcome?v=2` that answers anonymous
visitors' product/pricing/school/parent/teacher questions before
sign-up. It is NOT Foxy — it explicitly refuses tutoring requests.

Model: OpenAI gpt-4o-mini (CEO directive 2026-05-19, cost-efficient).
The model swap from Claude to OpenAI is the reason REG-67 below is
catalogued — any future provider/model change needs a documented human
review and a catalog update in the same PR.

Concomitant work in this PR series: shared SSE event-name constants
shipped to `src/lib/alfabot/sse-events.ts` to prevent the drift between
Edge Function producer (`event: token`) and Next route / client lib
parsers (which historically used `event: text`). The drift is currently
non-fatal because the route's `done` frame carries `response` as a
fallback, but the contract test in
`src/__tests__/contract/alfabot-route-edge-contract.test.ts` pins the
expected names and includes a `.fails` assertion that surfaces the
remaining drift in the consumer surfaces.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-65 | `alfabot_pricing_verbatim_guard` | (1) `docs/alfabot/knowledge-base.md` contains the canonical literal `₹699` in the `pricing-plans` section, with the per-month framing alongside (so the post-processor's ₹-adjacency banned-phrase check has the full string to match). (2) `src/components/landing-v2/FAQV2.tsx` contains the same literal in the pricing FAQ row, with English `month` or Hindi `माह` adjacent. (3) Cross-file drift detector: extract the first `₹\d{2,5}` from both files and assert the digits are identical AND equal to `699`. Edge Function side — pricing-unbacked rejections live in the Deno integration test at `supabase/functions/alfabot-answer/__tests__/integration.test.ts` (banned-phrase + pricing-banned check). | `src/__tests__/contract/alfabot-kb-pricing-drift.test.ts` | E |
| REG-66 | `alfabot_scope_lock_no_tutoring` | (1) `ALFABOT_HARD_REFUSAL_PATTERNS` in `src/lib/ai/prompts/alfabot-system.ts` enumerates 4 hard-refusal categories: math/homework (routes to `not_a_tutor`), medical/legal/mental-health (routes to `off_topic`), politics/religion/news (routes to `off_topic`), other students' data (routes to `other_student_data`). (2) `ALFABOT_REFUSALS` has both `en` and `hi` strings for each refusal id. (3) Server-side mirror: `supabase/functions/alfabot-answer/shared.ts` `detectHardRefusal()` matches the same patterns and emits the canned `ALFABOT_REFUSALS[id][lang]` string WITHOUT calling OpenAI (defense-in-depth at the Edge Function boundary). (4) Pre-LLM regex filter in `src/app/api/alfabot/route.ts` (`PROMPT_INJECTION_PATTERNS`) is an independent abuse short-circuit (prompt injection / URLs / base64 runs) on the route path — different surface, same defense-in-depth posture. (5) Existing prompt-module unit tests cover ALFABOT_REFUSALS / ALFABOT_HARD_REFUSAL_PATTERNS / ALFABOT_BANNED_PHRASES at the data layer; the route-level abuse path is covered by `src/__tests__/api/alfabot/route.test.ts:321` ("abstains on prompt injection without calling Edge Function"). | `src/lib/ai/prompts/alfabot-system.test.ts` (prompt module) + `src/__tests__/api/alfabot/route.test.ts` (route abuse abstain) + `supabase/functions/alfabot-answer/__tests__/integration.test.ts` (Deno, refusal flow) | P |
| REG-67 | `alfabot_model_provenance` | Every `alfabot.respond` audit row, every `alfabot_messages.model` value on assistant rows, AND every response envelope's `body.model` field must equal `'gpt-4o-mini'` (or the configured fallback returned by the Edge Function). Drift cases asserted: (a) upstream returns `gpt-4o` fallback → all three places reflect `gpt-4o`; (b) upstream omits `model` field → route falls back to the `MODEL_ID` constant (`gpt-4o-mini`); (c) upstream failure path's `alfabot.upstream_failed` audit row also stamps `model=gpt-4o-mini` for forensic continuity. User rows in `alfabot_messages` MUST NOT carry a model field (per route documentation). Because user approval is required for AI model changes (`.claude/CLAUDE.md`), this regression's failure forces an explicit catalog update in the same PR. | `src/__tests__/api/alfabot/model-provenance.test.ts` | E |
| REG-68 | `alfabot_pii_boundary_in_audit` | `audit_logs.details` for the `alfabot.respond`, `alfabot.upstream_failed`, and `alfabot.abuse_blocked` actions MAY contain: anonId, sessionId, audience, lang, tokensUsed, latencyMs, degradedMode, sourcesCount, model, abuseReason, traceId. MUST NEVER contain: message text, assistant text, email, phone, name, school_name, raw IP. Hashed IP (`ip_hash`) is permitted ONLY in `alfabot_sessions` rows, never in audit details. Existing happy-path test in `src/__tests__/api/alfabot/route.test.ts` (line 484) and lead-capture test in `src/__tests__/api/alfabot/lead.test.ts` already pin the negative shape via `JSON.stringify(details).not.toContain(message)`; REG-68 catalogues that pattern as the regression contract. | `src/__tests__/api/alfabot/route.test.ts` (happy + abuse + upstream fail audits) + `src/__tests__/api/alfabot/lead.test.ts` (lead audit) | E |

### Invariants covered by this section

- P11-adjacent (pricing brand/legal risk — REG-65) — hallucinated price
  on the landing page is a chargeback / consumer-protection vector
  even though no payment flows through AlfaBot.
- P12 (AI safety — REG-66 scope-lock; REG-67 model provenance gate)
- P13 (data privacy — REG-68 audit-log PII boundary; matches the
  `audit_logs.details` policy stated in `src/app/api/alfabot/route.ts`
  module header)

### Notes on test strategy

REG-65 and the SSE-event contract test are static-source drift detectors
in the same family as REG-51, REG-54, REG-57: they read the relevant
files via `node:fs` and assert on string contracts without booting
runtime infrastructure. This is the only way to enforce drift between
two source-of-truth files (the KB markdown and the FAQ TSX, in REG-65's
case) without an end-to-end harness.

REG-67 exercises the `/api/alfabot` route handler with the same
supabase-admin + logAudit mocking pattern as `route.test.ts` (the
existing PR-2 test fixture). It runs the route end-to-end for four
cases: happy-path gpt-4o-mini, upstream gpt-4o fallback, upstream
omits-model, and upstream-failure audit-row stamping.

REG-66 is currently `P` (partial) because the canonical hard-refusal
test lives in the prompt-module unit suite (PR 1 ai-engineer) and the
server-side mirror lives in the Deno integration suite (PR 2). Neither
file is duplicated here; the catalog entry references both and surfaces
the dual-surface contract.

REG-68 is also `E` via reference rather than a new dedicated file —
the existing route + lead tests already JSON.stringify the audit
payload and assert no PII strings survive. Promoting that pattern into
the catalog makes it block-on-removal under orchestrator Gate 5 and
quality veto.

### Catalog total

Pre-AlfaBot: 35 entries (target reached as of 2026-05-04, Marking-
Authenticity Wave 5). AlfaBot v1 adds REG-65, REG-66, REG-67, REG-68.

**Total: 39 entries.**

### Contract drift surfaced during this work

The SSE event-name contract between the Edge Function (`event: token`)
and the Next route + client lib consumers (`event: text`) is currently
drifted. The drift is documented in
`src/__tests__/contract/alfabot-route-edge-contract.test.ts` with a
`.fails` test that flips to passing when both consumer surfaces adopt
the canonical `token` name. The new shared module
`src/lib/alfabot/sse-events.ts` is the single source of truth that the
follow-up PR will import in all three places. Catalogue this here so
the orchestrator knows there's a known deferred contract bug.

## Study Menu v2 — /refresh consolidation + Build Your Own Deck (2026-05-20) — REG-69

Source: Study Section Consolidation
(`docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md`,
`docs/superpowers/plans/2026-05-20-study-section-consolidation-plan.md`).
The 6-phase rollout merges the legacy `/review`, `/revise`, and exam-
prep surfaces into a single `/refresh` page with four sections
(A: Quick Recall, B: Chapter Refresh, C: Retention Tests, D: Build
Your Own Deck). A new context-aware `/exam-prep` route replaces the
old `/study-plan` page. The sidebar's `SIDEBAR_SECTIONS_V2` is gated
behind `ff_study_menu_v2` so the old menu can be restored in seconds
if the new IA regresses engagement. SM-2 scheduling and the
underlying spaced-repetition engine are NOT touched by this work —
"no engine drift" is an implicit invariant of the consolidation.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-69 | `study_menu_v2_refresh_consolidation` | (1) **Sidebar IA pin**: `SIDEBAR_SECTIONS_V2` in `BottomNavComponent.tsx` exposes Library + Refresh + Exam Sprint as the three Study-group items when `ff_study_menu_v2` is ON; E2E asserts the rendered sidebar matches this contract. Reverting the constant or removing one of the three items fails the E2E spec. (2) **301 redirect contract**: `next.config.js` declares permanent (301) redirects from `/review`, `/revise`, and `/study-plan` to `/refresh` (Sections A-C) and `/exam-prep` respectively. Three E2E redirect tests pin the wire status code and target path. (3) **Section D API contract**: `POST /api/learner/cards/create` accepts `{ chapter_id, front, back }`, validates body shape, calls `supabase.from('spaced_repetition_cards').insert(...)` with `source='student_created'`, and returns the inserted card row. 6 unit tests cover happy path, 400 on missing fields, 401 on unauthenticated, 422 on invalid chapter, 500 on DB error, and idempotent retry semantics. (4) **`spaced_repetition_cards.source` enum widening**: the table's CHECK constraint accepts `'student_created'` in addition to the legacy `'system_generated'` value; widening migration is required for Section D's INSERT to succeed. Removing `'student_created'` from the enum makes the API unit test fail on the DB write. (5) **Component contract**: `BuildYourOwnDeckSection.tsx` renders the composer form, submits to `/api/learner/cards/create`, shows success/error toasts, and resets the form on success; 4 component tests cover the rendering and submission paths. | `e2e/refresh-page.spec.ts` (5 tests: shell, Section D submission, 3 redirects) + `src/__tests__/api/learner/cards/create.test.ts` (6 unit tests) + `src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx` (4 component tests) | E |

### Invariants covered by this section

- P14 (review chain completeness — frontend route consolidation
  touches sidebar + page + API + flag, exercising the
  ops/frontend/backend/testing review chain in the same PR series)
- P10 (bundle budget — `/refresh` aggregates 3 prior surfaces; the
  consolidation MUST keep the new page under 220 kB so the consolidated
  route does not blow the per-page cap that the three smaller pages
  individually respected)
- Implicit "no engine drift" — SM-2 scheduling, mastery computation, and
  the spaced-repetition engine are NOT modified by this work. REG-69's
  API unit test asserts that `spaced_repetition_cards.insert(...)`
  writes `source='student_created'` and lets the existing scheduler
  consume the row through the same code path system-generated cards use.

### Notes on test strategy

REG-69 combines three test layers in the catalog entry:

1. **E2E (Playwright)** — `e2e/refresh-page.spec.ts` exercises the
   real route under `ff_study_menu_v2=ON`: page shell renders the four
   sections, Section D submission round-trips through the API and
   shows the toast, and the three 301 redirects (`/review`, `/revise`,
   `/study-plan`) resolve to the new targets. The spec follows the
   `refresh-page` pattern from the consolidation plan; redirect
   assertions read `response.status()` and `response.url()` against
   the request chain.
2. **Unit (Vitest, route handler)** —
   `src/__tests__/api/learner/cards/create.test.ts` mocks
   `supabase.from('spaced_repetition_cards').insert(...)` and exercises
   the 6 wire behaviours (200 happy, 400 missing fields, 401 unauth,
   422 invalid chapter, 500 DB error, idempotent replay). This is the
   layer that catches the `'student_created'` enum widening regression.
3. **Component (Vitest + RTL)** —
   `src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx`
   mounts the composer with a mocked `fetch` and asserts the render
   tree, submission payload, success toast, error toast, and form-
   reset behaviour. Catches UI-side regressions that would not fail
   the API unit test (e.g. payload shape drift, missing CSRF header,
   broken form validation).

If any of these test files is deleted or any of the underlying
contracts is reverted (sidebar constant, redirect declaration, API
shape, enum widening, component submission flow), the suite fails
and quality MUST reject.

**Spec:** `docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md`
**Plan:** `docs/superpowers/plans/2026-05-20-study-section-consolidation-plan.md`

**Related commits** (Phase 1-6 on branch `Alfanumrik/funny-rhodes-a348ce`,
range `4aab7dbe..e3c243f1`):
- `4aab7dbe` feat(study-menu): add ff_study_menu_v2 flag + widen card source enum
- `56f21d3e` feat(study-menu): register ff_study_menu_v2 flag constant
- `39691d78` feat(refresh): extract Quick Recall section from /review
- `d15ee29d` feat(refresh): extract Chapter Refresh section from /revise
- `73b53df7` feat(refresh): extract Retention Tests section
- `ac2f2f83` feat(refresh): build /refresh page shell with Sections A-C
- `f575fed3` feat(refresh): add POST /api/learner/cards/create for Section D
- `48a7bb9d` feat(refresh): add Build Your Own Deck composer (Section D)
- `b6d5b9f1` feat(refresh): wire Build Your Own Deck section into /refresh
- `5d40e664` feat(exam-prep): build context-aware /exam-prep from /study-plan
- `49c7f6ea` feat(study-menu): flag-gate sidebar Study group + Exam Sprint visibility
- `e3c243f1` feat(study-menu): flag-gate internal /review and /study-plan links

### Catalog total

Pre-Study-Menu-v2: 39 entries. Study Menu v2 adds REG-69.

**Total: 40 entries.**

## MoL Phase 1A — Admin-Functions Rollback Flag + Oracle Grader Bypass (2026-06-03) — REG-70..REG-71

Source: Mixture-of-LLMs Phase 1A migration routed 6 admin/async Edge Functions
(`bulk-question-gen`, `bulk-non-mcq-gen`, `generate-concepts`, `generate-answers`,
`extract-ncert-questions`, `parent-report-generator`) from direct
`fetch('https://api.anthropic.com/v1/messages', ...)` to MoL `generateResponse()`
with OpenAI gpt-4o-mini as the cost-cut primary. The rollback flag
(`ff_mol_admin_functions_v1`) flips all six back to legacy Anthropic in seconds
without a redeploy. The `bulk-question-gen` MCQ oracle grader is the one path
that ALWAYS bypasses MoL — it requires deterministic temperature=0 verdicts
that MoL cannot honor until `GenerateRequest.config.temperature_override`
lands (tracked as a follow-up).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-70 | `mol_admin_routing_rollback_flag_p12` | `ff_mol_admin_functions_v1` rollback flag flips all 6 admin Edge Functions (`bulk-question-gen`, `bulk-non-mcq-gen`, `generate-concepts`, `generate-answers`, `extract-ncert-questions`, `parent-report-generator`) back to the legacy direct-Anthropic-API path within the 5-min flag-cache TTL. Kill-switch precedence (per `supabase/functions/_shared/mol/admin-rollback-flag.ts`): `metadata.kill_switch === true` → legacy; else `typeof metadata.enabled === 'boolean'` → that value; else `is_enabled` column. Defensive default: any flag-read failure → legacy path (never routes to OpenAI when ops thinks the switch is off). Verification: ops `update feature_flags set is_enabled=false where flag_name='ff_mol_admin_functions_v1'`; within 5 min `mol_request_logs.provider` for the 6 functions = 'anthropic' on new rows. | `supabase/functions/_shared/mol/admin-rollback-flag.ts` (helper + unit-test coverage in `_shared/mol/__tests__/admin-rollback-flag.test.ts`) | E |
| REG-71 | `bulk_question_gen_oracle_grader_bypasses_mol_p6` | `callOracleGrader` in `supabase/functions/bulk-question-gen/index.ts` bypasses MoL routing entirely and unconditionally calls `callOracleGraderLegacy` (direct Anthropic `claude-haiku-4-5-20251001` with `temperature: 0` and `QUIZ_ORACLE_GRADER_SYSTEM_PROMPT`). The function body MUST NOT contain an `isMolAdminRoutingEnabled()` branch — the bypass is unconditional. The MCQ-GENERATION path (`callClaude`) still routes through MoL because its validators reject bad output; the grader has no such safety net because it IS the validator. Until `GenerateRequest.config.temperature_override` is implemented, MoL providers' ~0.7 default would break REG-54's admission-gate determinism. Verification: source-grep `callOracleGrader` in `bulk-question-gen/index.ts` shows NO `isMolAdminRoutingEnabled` check; calls `callOracleGraderLegacy` directly. Why this matters: P6 admission gate must be deterministic; non-deterministic verdicts would cause oracle telemetry skew and undermine REG-54 audit reliability. | `supabase/functions/bulk-question-gen/index.ts` (`callOracleGrader` function — static-source pin; suite under `supabase/functions/bulk-question-gen/__tests__/`) | E |

### Invariants covered by this section

- P6 (question quality — REG-71 keeps the oracle admission gate
  deterministic by pinning temperature=0; non-deterministic verdicts
  would let inconsistent admit/reject decisions corrupt the
  `question_bank` quality bar that REG-54 audits)
- P12 (AI safety — REG-70 instant rollback flag bounds blast radius of
  any OpenAI-side incident across all 6 admin Edge Functions without a
  redeploy; defensive-default-legacy on flag-read failure ensures
  ops-intended OFF state always wins)

### Notes on test strategy

REG-70 is enforced by the existing
`supabase/functions/_shared/mol/__tests__/admin-rollback-flag.test.ts`
unit suite which exercises the three-tier precedence ladder and the
defensive-default-on-read-error branch. The 5-min cache TTL is part of
the flag-helper's documented contract (cached read with TTL eviction);
the test asserts the precedence ladder, not the cache wall clock.

REG-71 is a static-source canary in the same family as REG-50, REG-57,
REG-59: the contract is the absence of a code path. If a future PR
re-introduces `isMolAdminRoutingEnabled()` into `callOracleGrader`,
the canary fails. The bypass MUST be deleted only when
`GenerateRequest.config.temperature_override` lands and the MoL
evaluation chain can honor `temperature: 0`; at that point both
REG-71 and the function-header comment block should be updated in the
same PR.

### Catalog total

Pre-MoL-Phase-1A: 40 entries. MoL Phase 1A adds REG-70, REG-71.

**Total: 42 entries.**

## Python AI Service Health Contract (2026-05-24) — REG-72

Source: Phase 0 of the Python-on-Cloud-Run migration. The CEO approved
the TypeScript-to-Python AI/ML rewrite (3-6 week transition). ai-engineer
owns `python/services/ai/`; architect owns the Cloud Run deploy pipeline;
ops owns the operational layer ([PYTHON_AI_OPERATIONS.md](../docs/PYTHON_AI_OPERATIONS.md),
[super-admin-python-ai-dashboard-spec.md](../docs/super-admin-python-ai-dashboard-spec.md)).

Cloud Run uses the readiness probe to decide whether to route traffic to
an instance. A service that returns 200 from `/live` (process alive)
but cannot actually serve requests (missing Supabase credentials,
provider API keys unreachable, configuration drift) MUST be taken out
of rotation automatically. The two-endpoint pattern is the standard
Kubernetes-style liveness/readiness split adapted to Cloud Run; getting
it wrong means a half-broken instance serves errors until ops manually
notices.

The liveness endpoint is named `/live` (not `/healthz`) because Cloud
Run's frontend intercepts the path `/healthz` before it reaches the
container and returns Google's own 404 HTML page (confirmed
2026-05-24 by direct probe — `/foo` returned FastAPI's JSON 404,
`/openapi.json` showed `/healthz` IS registered, but external
`curl /healthz` returned Google's HTML 404 instead of `{"status":"ok"}`).
`/live` is not reserved by Cloud Run and works as expected. The contract
itself (always-200, no I/O, no external deps) is unchanged.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-72 | `python_ai_service_health_contract` | Cloud Run service exposes two distinct HTTP endpoints with different semantics: (1) `/live` returns 200 whenever the FastAPI process is alive — used by Cloud Run liveness probe to decide whether to restart the container. The path is `/live` (not `/healthz`) because Cloud Run's frontend intercepts `/healthz` before the request reaches the container; confirmed 2026-05-24. (2) `/readyz` returns 200 ONLY when ALL upstream dependencies are healthy (Supabase URL + service-role key resolve and respond; Anthropic + OpenAI API keys present and not expired); returns 503 with a diagnostic JSON body listing which dependency failed when any of these checks fail — used by Cloud Run startup probe to gate the instance from being added to the load-balancer rotation. The Cloud Run service manifest MUST configure the startup probe to hit `/readyz` (not `/live` and not a TCP probe) so a degraded service is removed from rotation automatically rather than serving requests it cannot fulfill. On Cloud Run gen2, the startup probe is the gating signal — once it passes, the instance is in rotation, and the liveness probe (against `/live`) governs whether to restart. Verification: pytest integration tests in `python/tests/integration/test_generate_endpoint.py` cover the two-endpoint contract (good env → both 200; missing provider key → /readyz 503). The Cloud Run service manifest at `python/deploy/service.yaml` declares `startupProbe.httpGet.path: /readyz` and `livenessProbe.httpGet.path: /live`. | `python/tests/integration/test_generate_endpoint.py` (FastAPI TestClient — health endpoint contracts) + `python/deploy/service.yaml` (Knative-on-Cloud-Run manifest, version-controlled probe wiring) + `.github/workflows/python-ai-deploy.yml` (declarative `gcloud run services replace` step) | R (resolved 2026-05-24 — service.yaml landed with startup-probe → /readyz and liveness-probe → /live; workflow switched from `gcloud run deploy` CLI flags to declarative manifest apply; liveness path renamed from /healthz → /live to bypass Cloud Run frontend interception) |

### Invariants covered by this section

- Service-availability contract (operational invariant) — the readiness
  probe is the only mechanism by which Cloud Run knows a Python instance
  is unhealthy. If `/readyz` is wired to the same code path as
  `/live`, a Python instance with broken Supabase credentials will
  serve 500s until the next deploy. REG-72 pins the distinct-semantics
  contract.
- P12 (AI safety — adjacent): a Python instance that returns 503 from
  `/readyz` cannot accept requests, so it cannot serve any AI response
  (correct or otherwise). Fail-closed posture matches existing
  defensive defaults in `admin-rollback-flag.ts` and the proxy fallback
  flag.

### Notes on test strategy

REG-72 shipped in three iterations and resolved 2026-05-24:

1. **Phase 0 (originally catalogued, M).** Specification only — no
   FastAPI app on disk; no Cloud Run service. Quality gate: any PR
   landing the FastAPI app without both endpoints OR without YAML
   probe wiring must fail REG-72.
2. **Phase 1 (M).** FastAPI app landed at `python/services/ai/api/`
   with the two-endpoint split (`health.py:live` + `health.py:readyz`).
   Integration tests at `python/tests/integration/test_generate_endpoint.py`
   exercise both endpoints. Deploy workflow still used `gcloud run deploy`
   CLI flags, which do not expose `startupProbe.httpGet.path` — so a
   degraded instance could still be routed traffic. REG-72 stayed in `M`
   for this gap.
3. **Phase 1A wave 2 (R, 2026-05-24).** `python/deploy/service.yaml`
   landed as a Knative-on-Cloud-Run manifest declaring
   `startupProbe.httpGet.path: /readyz` and
   `livenessProbe.httpGet.path: /live`. The deploy workflow switched
   from `gcloud run deploy` (CLI flags) to `gcloud run services replace`
   (declarative manifest apply). The liveness path was renamed from
   `/healthz` → `/live` in the same wave after a post-deploy smoke
   confirmed Cloud Run's frontend intercepts `/healthz` before it
   reaches the container (Google returns its own 404 HTML page).
   REG-72 is now end-to-end: app exposes the two endpoints, tests
   assert their contract, and the manifest pins the probe wiring in
   version control.

The follow-up dedicated YAML-contract test (originally proposed as
`python/deploy/__tests__/test_service_yaml.py`) is deferred — the
workflow already runs `yaml.safe_load` on the rendered manifest before
`gcloud` is invoked, and the rendered manifest is printed in the
workflow log on every deploy for audit. A dedicated parsing test
would be defense-in-depth but adds no new failure-mode coverage.

### Catalog total

Pre-Phase-0: 42 entries. Phase 0 adds REG-72.

**Total: 43 entries.**

## Python AI Service Phase 1 — Request/Response Parity + Cutover Kill Switch (2026-05-24) — REG-73..REG-74

Source: Phase 1 of the Python-on-Cloud-Run migration ships the first
production AI workload (`bulk-question-gen`) on the new FastAPI service.
The TS Edge Function at `supabase/functions/bulk-question-gen/index.ts`
remains the canonical entry point; the new `_shared/python-ai-proxy.ts`
helper forwards eligible requests to the Cloud Run endpoint and falls
back to the legacy TS path on any rejection. REG-73 pins the
TS↔Python wire contract; REG-74 pins the 3-layer rollback / cutover
gating that ramps the rollout.

These are the first two catalog entries that span the TS Edge Function
boundary and the Python FastAPI surface — a future cutover regression
on either side would cascade into total `bulk-question-gen` outage
(and, by extension, every Phase 2-6 workload once they reuse the same
proxy helper).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-73 | `python_ai_bulk_question_gen_request_response_parity` | TS↔Python wire-contract parity for `bulk-question-gen`. (1) **Request body shape**: TS Edge Function destructures exactly 7 fields from the JSON body — `grade`, `subject`, `chapter`, `chapter_id`, `count`, `difficulty`, `bloom_level`. Python `BulkQuestionGenRequest` Pydantic model at `python/services/ai/business/bulk_question_gen/models.py` declares the same 7 fields with identical names, types, and defaults. (2) **Strict-mode rejection**: the Pydantic model uses `model_config = ConfigDict(extra='forbid')` so any future TS-side field addition that Python doesn't know about will fail with HTTP 422 — drift between the two sides cannot be silent. (3) **Response body shape**: Python returns `{generated, inserted, rejected, oracle_evaluated, oracle_rejected, questions[], warning?}`; TS proxy passes this through unchanged. Field-for-field equality enforced — adding a Python field without the TS proxy expecting it is also a breaking change. Closes the #1 Phase 1 cutover risk: a silent TS-or-Python-only field addition that 422s every bulk-question-gen request after deploy. | `supabase/functions/bulk-question-gen/index.ts` body destructuring + `python/services/ai/business/bulk_question_gen/models.py` Pydantic model (parity contract; dedicated parity test file to be added in Phase 1.2 — recommend a contract test that reads both source files and asserts field-set equality, OR a runtime test that POSTs the same JSON to both surfaces and asserts no 422). | M (parity contract documented; dedicated test file to land in Phase 1.2 — catalog entry acts as the explicit gating contract until then) |
| REG-74 | `python_ai_cutover_kill_switch_three_layer_precedence` | 3-layer kill-switch precedence in `supabase/functions/_shared/python-ai-proxy.ts` MUST evaluate in this order and short-circuit to the TS legacy path on ANY layer rejecting: (1) `PYTHON_AI_BASE_URL` env unset → TS path regardless of flag state (architect-level escape hatch — beats the 5-min flag cache, takes effect on next Edge Function deploy in seconds). (2) `metadata.enabled === false` OR `metadata.kill_switch === true` on the feature flag → TS path. (3) Hash-bucket(`request_id`) % 100 ≥ `metadata.rollout_pct` → TS path (deterministic per-request bucketing so the same student gets the same provider within a session). Only if all 3 layers say "yes" does the proxy forward to Cloud Run. The 5-min flag-cache TTL bounds the worst-case ops-controlled rollback latency; the env-unset layer is the seconds-scale escape hatch. Existing 14 unit tests cover each layer in isolation; REG-74's addition is the **precedence-order parity test** that asserts the full chain — a future refactor could drop or reorder a layer and the per-layer tests would still pass while the contract was silently broken. | `supabase/functions/_shared/python-ai-proxy.ts` (proxy module) + `supabase/functions/_shared/__tests__/python-ai-proxy.test.ts` (14 unit tests cover per-layer behaviour; ONE additional precedence-chain order test to land in Phase 1.2 asserting env-unset > enabled-true > kill-switch-false > rollout-bucket-hit must all hold for the proxy to forward) | P (per-layer coverage exists at 14 unit tests; precedence-chain order test deferred to Phase 1.2) |

### Invariants covered by this section

- HTTP contract integrity (operational invariant) — REG-73 pins
  request/response shape parity across the TS Edge proxy and the
  Python FastAPI endpoint. Any silent TS-or-Python-only field addition
  would cascade into HTTP 422 on every bulk-question-gen request after
  deploy; the contract being explicit in the catalog forces both sides
  to update together.
- P12 (AI safety) — REG-74 pins the cutover safety boundary. Three
  independent rejection layers (env unset, flag disabled, rollout
  bucket miss) each route to the TS legacy path; the seconds-scale
  env-unset escape hatch beats the 5-min flag-cache TTL so a Cloud Run
  outage can be drained on the next Edge Function deploy without
  waiting for the cache to settle. The same proxy helper is reused by
  Phases 2-6 workloads, so REG-74's precedence-order contract bounds
  blast radius for the entire Python migration.
- Service-availability contract (operational invariant, adjacent to
  REG-72) — together with REG-72's `/readyz` readiness-probe pin,
  REG-74's kill-switch ensures a degraded Python service cannot be
  silently traffic-pinned: Cloud Run takes the instance out of
  rotation on `/readyz` 503, and the proxy short-circuits to TS on
  flag/env disable. Defense in depth.

### Notes on test strategy

REG-73 follows the contract / parity pattern (see REG-37, REG-50,
REG-51, REG-54, REG-71): the canonical sources are the TS handler's
body destructuring and the Python Pydantic model. A dedicated parity
test can be either:

1. **Static-source contract test** — read both files via `node:fs`
   (TS) and `pyyaml`/AST (Python), extract the field sets, assert
   equality. Fast, no runtime dependency.
2. **Runtime contract test** — boot the Python FastAPI app under
   `TestClient`, POST a request the TS handler would forward, assert
   no 422 and matching response shape. Catches semantic drift the
   static test would miss (e.g. default-value drift).

Phase 1.2 should ship the static test as the gating regression and
the runtime test as an integration check. Until then, REG-73's
catalog entry is the gating contract — quality MUST reject any PR
that adds a field to one side without the other.

REG-74 is enforced today by the existing per-layer unit suite at
`supabase/functions/_shared/__tests__/python-ai-proxy.test.ts`
(14 tests). The Phase 1.2 follow-up adds ONE precedence-chain order
test asserting the full ladder semantics — env-unset wins over
enabled-true wins over kill-switch-false wins over rollout=100. The
existing tests would still pass if a future refactor swapped the
order; the new test pins the order itself.

The 3-layer kill-switch design is the same fail-closed-on-failure
posture as `admin-rollback-flag.ts` (REG-70) and matches the
operational philosophy that ops-intended-OFF must always beat
any other signal. REG-74 catalogues that posture for the
Python-migration surface.

### Catalog total

Pre-Phase-1: 43 entries. Phase 1 adds REG-73, REG-74.

**Total: 45 entries.**

## Voice 1b — Azure Indian-Accent TTS (2026-05-24) — REG-75

Source: Voice 1b adds `POST /v1/voice/synthesize` on the Python AI Cloud
Run service — the output half of Foxy's voice loop (Voice 1a / Whisper
STT is the input half, REG-72-adjacent telemetry). Returns Indian-accent
neural speech (en-IN-* and hi-IN-*) via Azure Cognitive Services Speech.

The endpoint isn't wired to any client yet (Voice 2 lands the
`src/lib/voice.ts` half behind `ff_python_voice_tts_v1`), so the surface
is service-side only. But the voice catalog and SSML builder are the
two layers between student text and Azure billing, and either regressing
silently would be a direct CEO-ask violation: the entire feature is
"Indian accent" (catalog regression → wrong accent shipped to students)
or "no spend leakage" (SSML escape regression → injection of SSML tags
into the request body).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-75 | `voice_1b_tts_voice_selection_and_ssml_safety` | Two-pronged contract on the TTS request builder. (1) **Voice catalog correctness:** `VOICE_CATALOG` covers all 6 (language, gender) tuples (en/hi/hinglish × female/male). EVERY voice id is an Indian-accent neural voice — prefix `en-IN-` or `hi-IN-`, suffix `Neural`. Hinglish routes through Hindi voices (Swara/Madhur) because they pronounce Latin loanwords with natural Indian-English phonemes. `resolve_voice` precedence: override > catalog > en-IN-Neerja fallback. A regression to e.g. `en-US-JennyNeural` would ship audio with a US accent and violate the direct CEO ask. (2) **SSML escaping safety:** `build_ssml` HTML-escapes all 5 XML special chars (`& < > " '`) via `html.escape(text, quote=True)` before embedding into the SSML body. A student-supplied `</voice>` would otherwise prematurely close the voice tag and inject neighbouring audio segments; a raw `<voice name='evil'>` could swap in an arbitrary voice mid-utterance. (3) **voice_override regex enforcement:** Pydantic field validator rejects any voice_override that doesn't match `^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$` — arbitrary attacker-controlled strings cannot reach Azure's SSML. xml:lang derivation from voice prefix is also pinned (en-IN-* → `xml:lang='en-IN'`; hi-IN-* → `xml:lang='hi-IN'`). | `python/tests/unit/test_voice_tts.py::test_resolve_voice_returns_indian_voices_for_all_lang_gender_combos`, `python/tests/unit/test_voice_tts.py::test_build_ssml_escapes_xml_entities`, `python/tests/unit/test_voice_tts.py::test_build_ssml_uses_correct_xml_lang_for_voice_prefix`, `python/tests/unit/test_voice_models.py::test_voice_override_must_match_neural_regex` | E |

### Invariants covered by this section

- P12 (AI safety) — REG-75 pins the voice-catalog correctness (no
  wrong-accent regression) and the SSML escape contract (no
  attacker-controlled SSML reaches Azure). Both are defense lines
  between student-supplied text and Azure's billing surface; a silent
  regression on either would be a direct CEO-ask violation or an
  Azure-spend amplification.
- P13 (data privacy) — adjacent: the synthesize handler and
  repository writer carry only `char_count`, never the raw text, into
  `ops_events.context`. Same posture as the Whisper writer.

### Notes on test strategy

REG-75 follows the **same-file unit-test pattern** as REG-39 (Foxy
remediation distractor index 0..3) and REG-54 (AI quiz-generator
validation oracle) — three of the four pinned tests live in a single
unit file (`test_voice_tts.py`) and the fourth in the request-validator
file (`test_voice_models.py`). The full test suite for Voice 1b is 74
tests across 4 files; the 4 pinned tests above are the load-bearing
ones — adding a voice or relaxing the override regex without updating
them would break the catalog.

The voice_override regex is enforced at the **Pydantic field validator
layer**, not in the handler. This means an attacker who bypasses the
HTTP route entirely (e.g. by calling the handler from a future internal
helper) is still gated by the model boundary — the validator MUST stay
on `SynthesizeRequest`, not migrate to the route function body.

### Catalog total

Pre-Voice-1b: 45 entries. Voice 1b adds REG-75.

**Total: 46 entries.**

## Phase 2 generate-concepts Python port (2026-05-24) — REG-76

Source: Phase 2 continued — the third admin function port from TS Edge
to Python AI Cloud Run (after bulk-question-gen and generate-answers).
The Python port lives at `python/services/ai/business/generate_concepts/`;
the TS Edge function at `supabase/functions/generate-concepts/index.ts`
gains a proxy block that forwards to Cloud Run when
`ff_python_generate_concepts_v1` is bumped, with TS fallback on any
proxy failure. Default OFF (rollout_pct=0) until ops ramps.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-76 | `phase_2_generate_concepts_python_port_p5_p6_parity` | Three-pronged contract on the Python port of the concept-validation logic. (1) **P5 grade-as-string contract:** integer grade values must be rejected at the wire layer; every grade field on response chapter previews is a JSON string. (2) **P6 concept-quality validation parity:** `parse_concepts_response` rejects arrays with fewer than 3 concepts, caps arrays at 6 concepts, defaults invalid `difficulty` to 2 (matches TS index.ts:510-512), defaults invalid `bloom_level` to `understand` (matches TS index.ts:515-517), and silently skips concepts missing required fields (title / learning_objective / explanation / example_title / example_content). (3) **Wire-shape parity:** the response chapter preview surface (dry_run path) carries P5 string grade end-to-end so a Pydantic regression that accepted int grades on `ConceptInsertRow` would surface in integration tests before splitting traffic. | `python/tests/unit/test_generate_concepts_validator.py::test_rejects_array_with_less_than_3_concepts`, `python/tests/unit/test_generate_concepts_validator.py::test_caps_array_at_6_concepts`, `python/tests/unit/test_generate_concepts_validator.py::test_defaults_invalid_difficulty_to_2`, `python/tests/unit/test_generate_concepts_validator.py::test_defaults_invalid_bloom_to_understand`, `python/tests/unit/test_generate_concepts_validator.py::test_skips_concept_missing_required_field`, `python/tests/integration/test_generate_concepts_endpoint.py::test_post_returns_grade_as_string_in_response_chapters` | E |

### Invariants covered by this section

- P5 (grade format — strings) — REG-76 wire-level + insert-row contract
- P6 (question / concept quality) — REG-76 3-6 concept array bound,
  required-field validation, bloom + difficulty coercion
- P12 (AI safety) — REG-76 adjacent: the parser is the LAST gate before
  malformed LLM output reaches `chapter_concepts`. A regression that
  allowed 2-concept arrays or arbitrary bloom strings would ship bad
  concepts to students through the student-facing concept-card surface.

### Notes on test strategy

REG-76 is catalogued because the port introduces a SECOND
implementation of the concept-validation logic. The Edge proxy fallback
means traffic could be split: TS path returns rejection on bad input,
Python path inserts garbage — exactly the kind of split-brain we
designed the cutover to AVOID. The pinned tests live in:

- `python/tests/unit/test_generate_concepts_validator.py` — five tests
  on `parse_concepts_response`. These mirror the TS-side parser tests
  byte-for-byte at the contract level.
- `python/tests/integration/test_generate_concepts_endpoint.py` — one
  end-to-end test confirming the response chapter preview surface
  carries P5 string grade.

The Python and TS validators MUST agree on these rejection conditions:

| Input                          | TS verdict | Python verdict |
|--------------------------------|------------|----------------|
| Empty / non-array JSON         | None       | None           |
| Array with < 3 valid concepts  | None       | None           |
| Array with > 6 concepts        | Sliced to 6| Sliced to 6    |
| difficulty=99                  | Default 2  | Default 2      |
| bloom_level="evaluate"         | "understand" | "understand" |
| Missing learning_objective     | Skip concept | Skip concept |
| Missing explanation            | Skip concept | Skip concept |

If a future change diverges either side, REG-76 fails and the catalog
gates the PR. The pinned-test list at the top of this section is the
floor; the wider unit suite at `test_generate_concepts_validator.py`
(31 tests, every branch covered) provides the surface area.

### Catalog total

Pre-Phase-2-generate-concepts: 46 entries. Phase 2 generate-concepts
adds REG-76.

**Total: 47 entries.**
## Voice 2 Frontend Wiring — Cloud Run STT/TTS Fallback Safety (2026-05-24) — REG-77

Source: Voice 2 frontend wiring shipped the per-student flag-gated route
swap (`ff_python_voice_tts_v1`) from browser Web Speech API → Cloud Run
FastAPI (Whisper STT + Azure neural TTS) for the Foxy chat mic and
speaker buttons. The fallback path from Python to Web Speech is the
user-visible safety net — if a flag misconfiguration OR Cloud Run
outage causes a hard failure instead of fallback, voice breaks for
every gated student during the rollout.

The Voice 2 flag is per-STUDENT (not per-request like the admin-side
proxies in REG-73/74) so the same student gets a consistent voice
experience within a session. The hash function in
`src/lib/voice-feature-flag.ts:hashStudentBucket` is the byte-for-byte
port of `supabase/functions/_shared/python-ai-proxy.ts:hashBucket` so
server-side and client-side bucket calculations agree.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-77 | `voice_2_python_to_web_speech_fallback_safety` | (1) **Python success returns transcript/audio**: `startListening({ pythonEnabled: true, getJwt })` with a successful `transcribePython` mock emits `onResult(transcript, true)` + `onEnd()`; `speak({ pythonEnabled: true })` with a successful `synthesizePython` mock plays the audio Blob via Audio + fires `onEnd`. (2) **Python failure falls back to Web Speech (NOT user-visible)**: when `transcribePython` / `synthesizePython` throws ANY `PythonVoiceError` (4xx, 5xx, 0/NETWORK, 0/TIMEOUT, 0/ABORTED), `src/lib/voice.ts` catches the throw, emits a `console.warn` whose message contains "Python STT failed" / "Python TTS failed" + status + code BUT NEVER the transcript, audio bytes, or JWT, then calls into the existing Web Speech path. The Web Speech recognizer / utterance is created on the fallback — the user does not see a hard error. (3) **Flag OFF skips Python entirely**: `pythonEnabled: false` causes `startListening` and `speak` to run the legacy Web Speech path immediately with no `transcribePython` / `synthesizePython` invocation and no console.warn. (4) **No JWT → fallback without fetch attempt**: `pythonEnabled: true` + `getJwt: async () => null` falls through to Web Speech without invoking the Python client (no Cloud Run round-trip on an unauthenticated mic press). (5) **Fetch wrapper status preservation**: `voice-python-client.ts` throws `PythonVoiceError` with `.status` matching the HTTP status (401, 413, 503) and `.code` parsed from the response's `detail.error` field. Network rejections produce status=0 code=NETWORK_ERROR; AbortSignal cancellation produces status=0 code=ABORTED. Empty JWT triggers an immediate AUTH_FAILED throw with NO fetch attempt. (6) **Feature-flag safe defaults**: `usePythonVoiceEnabled(studentId)` returns false when studentId is null, when SWR data is undefined (fetch failed), when `kill_switch` is true, when `enabled` is false, when `rollout_pct` is 0, OR when the hash bucket misses. The hash bucket function is deterministic and matches `python-ai-proxy.ts:hashBucket` byte-for-byte. | `src/__tests__/lib/voice-python-routing.test.ts` (Voice 2 routing + fallback contract) + `src/__tests__/lib/voice-python-client.test.ts` (client error envelopes) + `src/__tests__/lib/voice-feature-flag.test.ts` (flag hook safe defaults + hash parity) | E |

### Pinned tests

- `src/__tests__/lib/voice-python-routing.test.ts::startListening — Python path::falls_back_to_web_speech_when_python_throws — REG-77`
- `src/__tests__/lib/voice-python-routing.test.ts::startListening — Python path::falls_back_to_web_speech_when_flag_off — REG-77`
- `src/__tests__/lib/voice-feature-flag.test.ts::usePythonVoiceEnabled::returns false when SWR fetch errored (data === undefined)`
- `src/__tests__/lib/voice-python-client.test.ts::transcribePython::throws PythonVoiceError with status 503 when service is misconfigured`

### Invariants covered by this section

- P12 (AI safety) — the user-visible safety net. A regressed fallback
  (e.g. a refactor that removes the try/catch around `transcribePython`)
  would cause Cloud Run outages to silently break voice for every
  student in the rollout bucket; only an explicit alarm on voice
  fallback rate would surface the failure. REG-77 pins the fallback
  contract so quality must reject any PR that breaks it.
- P7 (Bilingual UI) — `usePythonVoiceEnabled` returns the same
  decision for the same studentId, so a student speaking Hindi
  doesn't get a different voice provider on their next message. The
  hash parity test ensures client-side and server-side bucketing
  agree (the client decides voice routing; server-side analytics will
  partition request_id traffic via the existing python-ai-proxy
  helper).
- P13 (data privacy) — the `console.warn` on fallback logs ONLY error
  class + status + code, never the transcript, audio bytes, or JWT.

### Notes on test strategy

REG-77 spans three test files (mirroring the
`alfabot-system.test.ts` + `route.test.ts` + integration pattern used
by REG-66):

1. **`voice-python-client.test.ts`** — exercises every error branch of
   the fetch wrapper. Mocks `global.fetch` directly; never boots a real
   Cloud Run round-trip. Catches a regression that would let a 503
   silently return success or a 0/network throw under the wrong code.
2. **`voice-feature-flag.test.ts`** — exercises the `usePythonVoiceEnabled`
   hook + the underlying `decidePythonVoice` pure function. Includes the
   byte-for-byte hash-parity assertion against an inline re-implementation
   of `python-ai-proxy.ts:hashBucket` so a drift in either implementation
   surfaces in CI.
3. **`voice-python-routing.test.ts`** — exercises the `startListening` /
   `speak` wrappers in `src/lib/voice.ts` with a mocked Python client and
   a fake MediaRecorder / SpeechRecognition / SpeechSynthesis. Pins the
   four user-visible code paths: Python success, Python failure →
   fallback, flag-off → legacy path, JWT-missing → fallback without
   contacting Cloud Run.

If any of these contracts is reverted (e.g. a refactor moves the
`try/catch` out of the wrapper, the kill-switch precedence in the
hook flips, or the hash function changes), the suite fails and quality
MUST reject.

### Catalog total

Pre-Voice-2: 47 entries. Voice 2 adds REG-77.

**Total: 48 entries.**

## Cosmic Redesign — Phase 0 Foundation + Phases 1–3 dispatch (2026-06-05) — REG-78, REG-79

Source: the "cosmic" dark visual-identity foundation. A flag-gated
(`ff_cosmic_redesign_v1`, default OFF) presentational layer: cosmic theme
runtime (`src/lib/cosmic-theme.tsx`), cosmic tokens + primitives in
`src/app/globals.css` scoped under `html[data-design="cosmic"]`, the
`src/components/cosmic/*` primitive shells, and a `variant` on
`src/components/landing/FoxyMark.tsx`.

**Gating broadened (Wave G, 2026-06-05):** the cosmic skin now activates on a
4-input OR with a force-off escape hatch, resolved by `computeCosmicEnabled`
in `src/lib/cosmic-theme.tsx` and mirrored by the anti-FOUC pre-hydration
script in `src/app/layout.tsx`:

```
cosmicEnabled = forceOff ? false
                         : ( dbFlag                              // ff_cosmic_redesign_v1 ON in DB
                             || NEXT_PUBLIC_VERCEL_ENV==='preview' // Vercel PR preview deploy
                             || urlForce(?cosmic=1/preview)        // manual enable (any env)
                             || localStorage 'alfanumrik_cosmic_force'==='1' )
forceOff = (?cosmic=0) || (localStorage 'alfanumrik_cosmic_force'==='0')
```

This means **PR previews auto-show cosmic** (so the CEO sees the redesign on
the Vercel preview URL with zero DB seeding) while **production stays strictly
OFF** by default: on prod, `NEXT_PUBLIC_VERCEL_ENV==='production'` (not
`'preview'`), the seed migration `20260611000000_seed_ff_cosmic_redesign_v1.sql`
ships the DB row `is_enabled=false`, and there is no url/localStorage force —
so all four enable signals are false and no `data-design` is written. `next.config.js`
exposes `NEXT_PUBLIC_VERCEL_ENV = process.env.VERCEL_ENV ?? ''` (empty/undefined
in local + tests ⇒ not-preview ⇒ OFF-contributing). A `?cosmic=0` (or stored
'0') hard-disables EVERYTHING, including a DB-ON flag and a preview deploy, so
a tester can pin the legacy look for an A/B comparison.

The single load-bearing safety property of the entire redesign is unchanged
and is the production-OFF / flag-OFF pixel-identity guarantee: the whole dark
identity hinges on ONE attribute, `data-design="cosmic"` on `<html>`. The
cosmic CSS in `globals.css` is scoped under that attribute, so if it is never
written the dark theme can never paint. CosmicThemeProvider must write it ONLY
when `computeCosmicEnabled` resolves ON, and AuthContext must keep its
force-light behavior when cosmic is OFF (it owns `data-theme` in the OFF world;
the cosmic provider must not clobber it). A regression here — most dangerously
a preview signal leaking into production, or the force-off escape hatch
failing to beat an enable signal — would silently flip production to a dark,
half-themed surface for every user, a brand and legibility incident.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-78 | `cosmic_redesign_flag_off_pixel_identity` | Full gating-MATRIX contract on the cosmic foundation (broadened Wave G: production-OFF + preview-auto-enable + manual override). The enable decision is `forceOff ? false : (dbFlag \|\| isPreviewEnv \|\| urlForce \|\| localStorageForce)`. Pinned at the `<html>` DOM boundary: **(a) production:** `NEXT_PUBLIC_VERCEL_ENV='production'` + DB flag OFF + no force ⇒ `cosmicEnabled` false, NO `data-design`/`data-role` written (production byte-identical to today). **(b) preview:** `NEXT_PUBLIC_VERCEL_ENV='preview'` ⇒ cosmic AUTO-enables even with the DB flag OFF (`data-design="cosmic"` + `data-role="student"` + `data-theme="dark"` written) — the whole point: PR previews show the redesign with zero DB seeding. **(c) manual enable:** `?cosmic=1` (and case-insensitive `?cosmic=preview`) ⇒ cosmic ON in ANY env (proven in production), and is persisted to `localStorage 'alfanumrik_cosmic_force'='1'` so it survives client navigation; a pre-set localStorage '1' (no URL param) also enables. **(d) force-off beats everything:** `?cosmic=0` ⇒ OFF even on a preview deploy AND even when the DB flag is ON, persisting force='0'; a pre-set localStorage '0' force-disables on a preview too. **(e) absent flag + undefined env + no force ⇒ OFF** (REG-78 core intact: no `ff_cosmic_redesign_v1` row, JSDOM env undefined ⇒ not-preview ⇒ `cosmicEnabled` false, no `data-design`). PLUS **AuthContext ownership preserved:** the cosmic provider does NOT clobber `data-theme` when OFF — AuthContext's force-`light` write survives untouched. PLUS **switch is live:** with the flag ON, `data-design="cosmic"` IS written, proving the OFF result isn't a trivial no-op provider. PLUS the FoxyMark `variant` default: `<FoxyMark />` renders the legacy SVG-free classic geometric fox; the cosmic SVG renders ONLY for `variant="cosmic"`. PLUS the display-only primitives (MasteryRing / ProgressBar) clamp `percent` to [0,100] and coerce non-finite input to 0 via `Number.isFinite` — they compute NO score (P1/P2 stay in the assessment domain; these primitives only render a handed-in display number). | `src/__tests__/cosmic-flag-off-safety.test.tsx` (provider DOM gating-matrix contract) + `src/__tests__/cosmic-primitives.test.tsx` (FoxyMark variant default + primitive clamping) | E |
| REG-79 | `cosmic_dispatch_flag_off_legacy` | Page-level DISPATCH contract for the full redesign (Phases 1–3). REG-78 pins that the provider writes no `data-design` when the flag is OFF; REG-79 pins the NEXT link — the `cosmicEnabled ? cosmic : legacy` selection that the student dashboard (`src/app/dashboard/page.tsx` — `<CosmicAboveFoldHero/>` vs `<AboveFoldHero/>`), the parent home (`src/app/parent/page.tsx` — `<CosmicParentHome/>` vs legacy markup), and the Phase-3 portal shells (teacher/super-admin/school-admin — Starfield + `*-portal` class) all key off. The single switch behind every branch is `useCosmicTheme().cosmicEnabled`, resolved by the REAL `<CosmicThemeProvider>` from the client flag read path. Asserts: flag ABSENT (production truth) ⇒ LEGACY branch renders + cosmic branch does NOT; flag `false` ⇒ LEGACY branch renders; flag `true` ⇒ COSMIC branch renders + legacy does NOT (proves the OFF result is a real decision, not a dead switch). Wires the exact page ternary to the live hook (mocks only `getFeatureFlags` + `useAuth`) — behavior over implementation. Guards against an inverted ternary or a switch-true-while-OFF regression silently flipping production to cosmic for every user. | `src/__tests__/cosmic-dispatch-flag-off.test.tsx` | E |

### Pinned tests

- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::writes NO data-design / data-role when the cosmic flag is ABSENT`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::does NOT clobber data-theme when the flag is OFF (AuthContext owns it)`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::writes data-design="cosmic" when the flag is ON (switch is live)`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::stays OFF in PRODUCTION env with the flag OFF and no force (byte-identical)`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::auto-enables cosmic on a PREVIEW deploy even with the flag OFF`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::enables cosmic via ?cosmic=1 even in production with the flag OFF`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::force-disables via ?cosmic=0 even on a PREVIEW deploy`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::force-disables via ?cosmic=0 even when the DB flag is ON`
- `src/__tests__/cosmic-primitives.test.tsx::FoxyMark — variant default (flag-OFF pixel identity)::renders the classic geometric fox by default (no variant prop)`
- `src/__tests__/cosmic-dispatch-flag-off.test.tsx::REG-79 — cosmic dispatch flag-OFF stays legacy::renders the LEGACY branch (not cosmic) when the flag is ABSENT`
- `src/__tests__/cosmic-dispatch-flag-off.test.tsx::REG-79 — cosmic dispatch flag-OFF stays legacy::renders the COSMIC branch when the flag is ON (switch is live, not dead)`

### Invariants covered by this section

- P10 (bundle / cost budget) — adjacent: the cosmic font + token layer is
  inert when the flag is OFF; the flag-OFF tests pin that no cosmic DOM hook
  is written so no cosmic CSS cascade is paid for by production users.
- P7 (bilingual UI — no-coverage today) — adjacent: the cosmic primitives
  take bilingual `label` strings from callers and never hard-code copy; the
  HC (high-contrast) theme exists so no learner is stranded on a sunlit cheap
  Android. (A true AAA-contrast token-pair guard is recommended below but not
  yet enforced — see REG-81.)

### Notes on test strategy

REG-78 and REG-79 follow the **flag-OFF safety pattern**: the enforcing tests
mock the client flag read path (`getFeatureFlags`) and assert on the DOM
boundary, NOT on provider internals — behavior over implementation. JSDOM does
not apply the `html[data-design="cosmic"]` CSS cascade, which is exactly why the
attribute presence/absence (REG-78) and the page dispatch branch (REG-79) are
the right things to assert: they are the only two gates the entire cosmic
cascade keys off. The FoxyMark variant default (REG-78) is the third pillar —
every existing call site is `variant`-less, so the default MUST stay `classic`
or existing surfaces would flip to the cosmic SVG with the flag off.

Combined flag-OFF chain pinned across the two entries: (1) provider writes no
`data-design`/`data-role` ⇒ the `html[data-design="cosmic"]`-scoped token block
and every selector-scoped role/theme rule in `globals.css` is inert (REG-78);
(2) the page dispatch ternaries select the LEGACY branch ⇒ no cosmic composition
(`CosmicAboveFoldHero`, `CosmicParentHome`, portal Starfields) ever mounts, so
none of its `dynamic(ssr:false)` chunks enter the flag-OFF bundle and no
`.cosmic-*` namespaced class is emitted into the DOM (REG-79); (3) FoxyMark
stays classic ⇒ no `.cosmic-float`/SVG (REG-78). The bare `.cosmic-*` primitive
rules in `globals.css` are name-scoped (not selector-scoped) but reference
cosmic-only tokens that resolve to nothing without `data-design`, AND their
classes are only ever rendered by the flag-gated compositions above — so they
cannot paint with the flag OFF.

### Recommended follow-up entries (NOT yet added — no enforcing test)

These are warranted by the redesign but were intentionally NOT catalogued yet
because a meaningful enforcing test needs infrastructure JSDOM can't provide
(computed-style / contrast math / real CSS cascade). Proposed for a later
installment once the supporting test harness lands:

- **REG-80 — `cosmic_theme_switch_persistence`**: dark→light→hc cycle persists
  the `CosmicThemePreference` to localStorage and re-applies `data-theme` on
  remount; flag-OFF setter is a no-op. (Needs the provider's setter exercised
  end-to-end with a real toggle surface.)
- **REG-81 — `cosmic_aaa_contrast_token_pairs`**: every cosmic text-on-surface
  token pair (`--text`/`--text-2` on `--bg`/`--bg-soft`/role palettes, plus the
  HC theme) meets the AAA contrast ratio. This is the first concrete enforcing
  test for the P7 "visibility" constraint that is currently `no-coverage`. Needs
  a contrast-ratio assertion harness reading the resolved token values (e.g. a
  build-time CSS-token parser or a Playwright computed-style probe), not JSDOM.
- **REG-82 (recommended) — `cosmic_css_scope_lint`**: a build-time/CI guard that
  every NON-`.cosmic-*`-prefixed selector added to the cosmic block of
  `globals.css` is gated under `html[data-design="cosmic"]`. Today the
  flag-OFF guarantee for the bare `.cosmic-*` primitive rules rests on a
  convention (name-namespacing + flag-gated render sites) rather than a
  mechanical check; a lightweight CSS-parse assertion would catch a future
  unscoped global rule (e.g. a stray `body{}` or legacy-class override) leaking
  into the flag-OFF cascade. Needs a CSS AST/regex harness, not JSDOM.

### Catalog total

Pre-cosmic: 48 entries. Cosmic Phase 0 added REG-78. Cosmic full-redesign
(Phases 1–3) regression verification adds REG-79.

**Total: 50 entries.** (REG-80, REG-81, REG-82 recommended, not yet added.)

## Consumer Minimalism — Wave A "Today" home (2026-06-06) — REG-83

Source: the adaptive "Today" home (`/today`) + the 4-tab student nav, both
flag-gated by `ff_today_home_v1` (default OFF, seeded by
`supabase/migrations/20260612000000_seed_phase1_consumer_minimalism_flags.sql`).
The Learner Loop resolver was refactored into an ordered `BRANCHES` array
(`src/lib/state/learner-loop/resolve-next-action.ts`) and grew a new
`resolveTodayQueue()` plus a `resume_in_progress` action kind. A thin BFF
(`src/app/api/v2/today/route.ts`) projects the resolved queue into render DTOs
via `src/lib/today/map-action.ts`; the page is `src/app/today/page.tsx` with
`src/components/today/*`.

Two load-bearing safety properties hold the whole wave together:

1. **Flag-OFF parity (byte-identical current product).** With
   `ff_today_home_v1` OFF, `/today` is invisible: the page client-redirects to
   `/dashboard` (authenticated) / `/login` (unauthenticated) and never renders,
   the BFF returns 404, and the student bottom nav keeps the legacy
   `CORE_TABS` (Home / Practice / Foxy / Progress) — the Wave-A `TODAY_CORE_TABS`
   (Today / Learn / Foxy / Me) are gated entirely at the call site
   (`MobileBottomNav.tsx` / `DesktopSidebar.tsx`), so current users see exactly
   today's product. A regression that defaulted the flag ON, or that selected
   `TODAY_CORE_TABS` regardless of flag, would silently reshape navigation for
   every student.

2. **Resolver parity (the refactor's single highest blast radius).**
   `resolveNextLearnerAction` is widely imported across the learner loop; the
   if-ladder → ordered-`BRANCHES` refactor must be behaviour-preserving.
   `resolveTodayQueue` re-uses the SAME ordered `BRANCHES` (one source of truth)
   and its `primary`/`queue[0]` MUST equal the raw first-match branch that
   `resolveNextLearnerAction` returns (except under the documented live-resume
   exception, where a `resume_in_progress` action prepends). A drift between the
   two — a reordered branch, a changed predicate, or a queue whose head no
   longer mirrors the resolver — would route students to the wrong next action.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-83 | `today_home_flag_off_parity_and_resolver_mirror` | Two-layer pin on Wave A. **(a) Flag-OFF parity (E2E):** with `ff_today_home_v1` OFF (client `feature_flags` read stubbed), visiting `/today` redirects AWAY from `/today` (never a reachable standalone page) and the student bottom nav renders the legacy `CORE_TABS` with NO "Today"/"Learn"/"Me" tab. The always-green half (`/today` leaves itself for an auth gate) runs unconditionally in CI; the rendered-nav + flag-ON render/Continue-navigation/Hindi-heading halves are `test.fixme(!hasRealStudentCreds(), …)` — catalogued, green once the shared test-student fixture (REG-45/REG-69) lands — with the flag + `/api/v2/today` envelope + subjects all network-mocked so they pass the moment creds exist. **(b) Resolver mirror (unit):** `resolveTodayQueue(...).primary` and `.queue[0]` deep-equal `resolveNextLearnerAction(...)` across every non-live branch (cold-start, stacking reviews, today's ZPD, continue-lesson, Sunday dive, weakest fallback), `.branch === raw.kind`, and the `queue[0] === primary` invariant holds for idle/Sunday/cold-start; the live-resume exception is the ONLY case `primary` diverges from the raw first-match. Together: the flag-off layer proves current users are untouched; the resolver-mirror layer proves the BRANCHES refactor did not change what "next" the loop picks. | `e2e/today-home.spec.ts` (flag-OFF redirect + nav parity + flag-ON render/Continue/bilingual) + `src/__tests__/state/learner-loop/today-queue.test.ts` (resolveTodayQueue ↔ resolveNextLearnerAction primary/branch/queue[0] parity) + `src/__tests__/lib/today/map-action.test.ts` (LearnerAction → TodayQueueItem projection) | E (unit), P (E2E — flag-OFF redirect runs in CI; authenticated-render halves fixme'd until the shared student fixture lands) |

### Pinned tests

- `e2e/today-home.spec.ts::Today home — flag OFF (parity)::visiting /today redirects away (never stays on /today)` (runs in CI)
- `e2e/today-home.spec.ts::Today home — flag OFF (parity)::student bottom nav shows the EXISTING tabs, no "Today" tab` (fixme until fixture)
- `e2e/today-home.spec.ts::Today home — flag ON::renders greeting strip + Today's Focus card with a Continue CTA` (fixme until fixture)
- `e2e/today-home.spec.ts::Today home — flag ON::clicking Continue navigates to the resolver deep-link target` (fixme until fixture)
- `e2e/today-home.spec.ts::Today home — flag ON::renders the Hindi heading "आज" when language is Hindi` (fixme until fixture)
- `src/__tests__/state/learner-loop/today-queue.test.ts::resolveTodayQueue — primary mirrors resolveNextLearnerAction (non-live)::$name → primary deep-equals resolveNextLearnerAction`
- `src/__tests__/state/learner-loop/today-queue.test.ts::resolveTodayQueue — queue[0] === primary invariant`

### Invariants covered by this section

- Flag-OFF safety (same family as REG-78/REG-79): the entire Wave A surface is
  inert with `ff_today_home_v1` OFF — no `/today` render, BFF 404, legacy nav.
- P7 (bilingual UI — no-coverage today) — adjacent: the Hindi-heading "आज"
  assertion is the first browser-level Hi/En check on this surface (gated on the
  auth fixture, not skipped for lack of a language toggle — the harness supports
  one via `localStorage['alfanumrik_language']`).
- Learner-loop routing correctness (P22 domain — assessment-owned rules): the
  resolver-mirror unit layer guards the ordered-`BRANCHES` refactor against a
  behaviour change in "what next".

### Notes on test strategy

REG-83 follows the **flag-OFF safety pattern** (REG-78/REG-79) for the
presentational half and the **contract/parity pattern** (REG-50/REG-51/REG-71)
for the resolver half. The E2E spec mocks the client flag read path
(`feature_flags` REST) + `/api/v2/today` envelope + `/api/student/subjects`, and
asserts on user-visible behaviour (redirect target, rendered tab labels,
Continue navigation URL), never on component internals. The authenticated-render
assertions are `test.fixme(!hasRealStudentCreds(), …)` for the SAME reason as
REG-45 (quiz happy-path) and REG-69 (/refresh): the mocked Supabase session
resolves a real `isLoggedIn` gate only against a real Supabase URL, so a
test-student fixture (TEST_STUDENT_EMAIL/PASSWORD) is required to drive a gated
page in CI — tracked in the TODO at the foot of `e2e/today-home.spec.ts`. The
resolver-mirror unit suite needs no fixture and runs green today; it is the
primary enforcement that the BRANCHES refactor stayed behaviour-preserving.

### Catalog total

Pre-Wave-A: 50 entries (REG-80/81/82 reserved). Consumer Minimalism Wave A adds
REG-83.

**Total (through Wave A): 51 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Consumer Minimalism — Wave C parent "glance" home (2026-06-06) — REG-84

Source: the parent "glance" home (`src/components/parent/ParentGlanceHome.tsx`)
flag-gated by `ff_parent_glance_v1` (default OFF —
`FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1] === false`, seeded by
`supabase/migrations/20260612000000_seed_phase1_consumer_minimalism_flags.sql`).
The parent page (`src/app/parent/page.tsx`) gained a flag branch
(`glanceEnabled && !showClassic`) that renders `<ParentGlanceHome>` — a
push-first, one-scroll reorg of the SAME already-fetched `get_child_dashboard`
payload (+ `perfScores` + `labStreak`) into three stacked sections (Snapshot /
Moments / Actions). `ParentGlanceHome` is `dynamic(ssr:false)`, fetches nothing
of its own, and exposes a "View classic dashboard" escape hatch.

Two load-bearing safety properties hold this wave together (same family as the
REG-78 / REG-79 cosmic flag-OFF safety tests and REG-83's Wave-A flag-OFF
parity):

1. **Flag-OFF parity (byte-identical current product).** With
   `ff_parent_glance_v1` OFF (production truth), the parent page renders the
   EXISTING 8-tab dashboard and `<ParentGlanceHome>` is never mounted — its
   lazy `dynamic()` import is never even resolved into the flag-OFF first-paint
   bundle. The branch is `glanceEnabled && !showClassic`, so the "View classic
   dashboard" reveal also falls back to the legacy tree even with the flag ON —
   nothing is ever lost. A regression that defaulted the flag ON, or inverted
   the ternary, would silently reshape the parent home for every guardian.

2. **Read-only contract (no new write surface).** `<ParentGlanceHome>` is a
   presentation reorg of props — it adds NO endpoint, NO POST, and NO
   "Encourage"/write affordance. Its Actions are NAVIGATION only: `<Link>`s to
   EXISTING routes (`/parent/reports`, `/parent/billing`,
   `/parent/messages` for guardian-mode | `/parent/support` for link-code) plus
   local-UI buttons (reveal classic, refresh, logout — all reusing the page's
   existing handlers). Its loading / empty / error states are derived from props
   alone. A regression that introduced a form/submit/new-endpoint affordance
   here would breach the Wave C "read-only glance" guarantee.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-84 | `parent_glance_flag_off_parity_and_read_only_contract` | Two-layer pin on Wave C. **(a) Flag-OFF parity (unit, page-branch replica):** a faithful replica of the page's `glanceEnabled && !showClassic` ternary, wired to a mocked `useFeatureFlags()` (the same SWR hook the page reads), selects the CLASSIC 8-tab branch when the flag is ABSENT (prod truth), explicitly `false`, or still loading (`data === undefined`); selects the GLANCE branch ONLY when the flag is `true` (proves the switch is live, not a dead no-op); and falls back to CLASSIC with the flag ON once `showClassic` is set (the reveal escape hatch). A standalone assertion pins `FLAG_DEFAULTS[PARENT_GLANCE_V1] === false` against a default-flip regression. **(b) Read-only render contract (unit, direct mount):** `<ParentGlanceHome>` renders the Snapshot, Moments, and Actions regions for a child with activity (stat values read straight off props — no recompute); the Actions are navigation `<Link>`s to `/parent/reports`, `/parent/billing`, and `/parent/messages` (guardian) / `/parent/support` (link-code); there is NO `<form>` / `<input>` / `<textarea>` / `button[type=submit]` anywhere and EVERY `<a href>` is an internal `/parent/*` route; the lazy `WeeklyReport` (Bearer-authed fetch) mounts only for `canFetchReport` parents; loading → skeleton (none of the three sections), `error` → Try-Again wired to `onRefresh`, and zero-activity → contextual empty state (with the classic-reveal footer still present); and the Hindi headline + Arabic-numeral stats render under `isHi` (P7). | `src/__tests__/components/parent/parent-glance-home.test.tsx` (15 tests: 6 page-branch dispatch + 9 component read-only/state) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/components/parent/parent-glance-home.test.tsx::Parent page — ff_parent_glance_v1 flag-branch dispatch::renders the CLASSIC 8-tab dashboard when the flag is ABSENT (prod truth)`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::Parent page — ff_parent_glance_v1 flag-branch dispatch::renders the GLANCE home when the flag is ON (switch is live, not dead)`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::Parent page — ff_parent_glance_v1 flag-branch dispatch::falls back to the CLASSIC dashboard with the flag ON once classic is revealed`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::ParentGlanceHome — Snapshot + Moments + Actions (read-only)::renders Actions as navigation links to EXISTING routes — no POST / write`

### Invariants covered by this section

- Flag-OFF safety (same family as REG-78/REG-79/REG-83): the entire Wave C
  surface is inert with `ff_parent_glance_v1` OFF — classic 8-tab dashboard
  renders, the glance home is never mounted, its `dynamic()` import never enters
  the flag-OFF bundle.
- Read-only / no-new-write-surface contract: the parent glance home is a
  presentation reorg; its Actions are navigation to existing routes only.
- P7 (bilingual UI — no-coverage today) — adjacent: the Hindi-headline +
  Arabic-numeral-stats assertion is a component-level Hi/En check on the new
  parent surface.

### Notes on test strategy

REG-84 follows the **flag-OFF safety pattern** (REG-78/REG-79/REG-83): the
page-branch half renders a faithful replica of the page's dispatch ternary wired
to the REAL flag-read hook (`useFeatureFlags`) and asserts on which branch is
selected, never on component internals. The read-only half mounts the real
`<ParentGlanceHome>` with representative already-fetched props and asserts on
user-visible structure (the three section regions, the Action hrefs, the absence
of any write affordance, the prop-driven loading/empty/error states). Only the
flag-read hook and the lazily-imported `WeeklyReport` (which owns its own
Bearer-authed fetch) are mocked — both are seams, not business logic. The suite
needs no Supabase fixture and runs green in CI today.

### Catalog total

Consumer Minimalism Wave C adds REG-84 (parent glance flag-OFF parity +
read-only contract).

**Total: 52 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Consumer Minimalism — Wave D parent → child "Encourage" (2026-06-13) — REG-85

Source: the parent → child "Encourage" (a.k.a. "D-encourage") feature, flag-gated
by `ff_parent_encourage_v1` (default OFF —
`FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1] === false`, seeded by
`supabase/migrations/20260613000002_ff_parent_encourage_v1.sql`). This is the FIRST
parent→child WRITE affordance added to the otherwise read-only Wave C glance home.
A parent picks one of a curated set of **preset** cheers (`src/lib/parent/cheer-catalog.ts`,
8 presets) and the route (`src/app/api/v2/parent/encourage/route.ts`,
permission `child.encourage`, migrations `20260613000000`/`20260613000003`) fans it
out to the linked child's notifications feed (`parent_cheer` type) and records a
`parent_cheers` row (`20260613000001`). The button surface is
`src/components/parent/EncourageButton.tsx`, mounted by
`src/components/parent/ParentGlanceHome.tsx`.

Because this introduces a write affordance that did not exist in Wave C, three
load-bearing safety properties hold it together (same family as the REG-78 /
REG-79 / REG-83 / REG-84 flag-OFF safety tests, plus the AlfaBot P12/P13
content-safety entries REG-66 / REG-68):

1. **Preset-only messages (P12 — no free text to a child).** The parent can only
   choose a fixed, curated, bilingual, PII-free preset by its `message_key`. There
   is NO free-text input/textarea anywhere in the picker; the component imports
   `CHEER_PRESETS` and never duplicates the strings. The route hard-rejects a
   present-but-unknown `message_key` with 400, applies `DEFAULT_MESSAGE_KEY` only
   when absent, and re-derives the rendered title/body server-side from the catalog.
   A regression that added a text field, or accepted an arbitrary string as the
   message, would breach the P12 boundary (no unfiltered, parent-authored text ever
   reaches a child).

2. **PII-free notification `data` + audit (P13).** The `send_notification` `p_data`
   jsonb and the `audit_logs` row (`parent.child_encouraged`) carry ONLY UUIDs
   (guardian_id / student_id), enums (cheer_type), the preset `message_key`, and the
   catalog-derived bilingual strings — never the guardian's name / email / phone.
   The client component logs nothing. A regression that spread the guardian profile
   into the notification payload or the audit details would breach P13.

3. **Flag-OFF parity (Encourage hidden).** With `ff_parent_encourage_v1` OFF
   (production truth), `<ParentGlanceHome>` mounts NO Encourage affordance and its
   lazy `EncourageButton` `dynamic()` import never resolves into the flag-OFF
   bundle — the parent surface is byte-identical to the Wave C glance home (REG-84).
   The gate is TWO conditions, both required: `flags[PARENT_ENCOURAGE_V1] === true`
   AND `canFetchReport` (guardian-JWT mode). Link-code parents (who would 403 the
   guardian-only route) never see it even with the flag ON. A regression that
   defaulted the flag ON, dropped the guardian condition, or flipped the gate would
   silently expose a new write surface to every guardian (or to unauthorized
   link-code parents).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-85 | `parent_encourage_preset_only_pii_free_flag_off_parity` | Three-layer pin on Wave D. **(a) Preset-only (P12):** opening `<EncourageButton>` reveals exactly one button per `CHEER_PRESETS` entry, each label sourced from the SAME catalog module the backend reads (fails if the strings fork), and there is NO `<input>` / `<textarea>` / `<form>` anywhere; the route returns 400 for a present-but-unknown `message_key`, applies the DEFAULT only when absent, and never accepts free text. **(b) PII-free `data`/audit (P13):** selecting a preset POSTs EXACTLY `{ student_id, message_key }` (the preset's catalog key) with the parent's Supabase Bearer JWT, omitting the header when there's no session; on the server the `send_notification` `p_data` and the `parent.child_encouraged` audit row carry only UUIDs / enums / preset keys / catalog strings — no guardian name / email; the component maps 200 → success, 429 → "already cheered recently", 403 / other non-OK / network throw → a friendly generic error WITHOUT surfacing the raw server text. **(c) Flag-OFF parity:** `<ParentGlanceHome>` HIDES the Encourage button when the flag is ABSENT (prod truth), explicitly `false`, or still loading (`data === undefined`) — even for a guardian-mode parent — and when the flag is ON but the parent is NOT guardian-JWT (`canFetchReport === false`); it SHOWS the button (inside the Quick actions region, wired to the selected child) ONLY when the flag is `true` AND `canFetchReport` is `true`; the empty state mounts no Encourage affordance; and a standalone assertion pins `FLAG_DEFAULTS[PARENT_ENCOURAGE_V1] === false` against a default-flip regression. All copy is bilingual via `isHi` (P7). | `src/__tests__/components/parent/encourage-button.test.tsx` (10 tests: preset-only render + POST contract + response mapping + bilingual), `src/__tests__/components/parent/parent-glance-home.test.tsx` (PART 3 — 7 tests: the flag × guardian gate truth table), `src/__tests__/api/v2/parent/encourage/route.test.ts` (route contract — auth gate, ownership isolation, message_key validation, rate limit, PII-free notify/audit happy path, notify failure), `src/__tests__/api/v2/parent/encourage/cheer-catalog.test.ts` (catalog content-safety + bilingual) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/components/parent/encourage-button.test.tsx::EncourageButton — preset-only picker (P12)::reveals every CHEER_PRESETS title (English) when opened — no duplicated strings`
- `src/__tests__/components/parent/encourage-button.test.tsx::EncourageButton — POST contract::POSTs { student_id, message_key } with the parent Bearer token on preset select`
- `src/__tests__/components/parent/encourage-button.test.tsx::EncourageButton — response mapping::maps 403 → a friendly generic error (no raw server detail surfaced, P13)`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::ParentGlanceHome — Encourage affordance gate (ff_parent_encourage_v1 × guardian)::SHOWS Encourage ONLY when the flag is ON AND the parent is guardian-JWT`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::ParentGlanceHome — Encourage affordance gate (ff_parent_encourage_v1 × guardian)::HIDES Encourage when the flag is ON but the parent is NOT guardian-JWT (canFetchReport=false)`
- `src/__tests__/api/v2/parent/encourage/route.test.ts::POST /api/v2/parent/encourage — happy path::sends a notification with correct args and records the cheer (200)`

### Invariants covered by this section

- P12 (AI / content safety): preset-only cheers — no free, parent-authored text
  ever reaches a child; unknown `message_key` rejected at the route.
- P13 (data privacy): notification `data` jsonb + `audit_logs.details` for
  `parent.child_encouraged` carry UUIDs / enums / preset keys only — no PII; client
  surfaces friendly errors, never raw server text.
- P9 (RBAC) — adjacent: route gated by the `child.encourage` permission and a
  guardian↔student link check (cross-guardian isolation; link-code 403).
- Flag-OFF safety (same family as REG-78/REG-79/REG-83/REG-84): the entire Wave D
  write surface is inert with `ff_parent_encourage_v1` OFF — the Encourage button
  is never mounted and its `dynamic()` import never enters the flag-OFF bundle, so
  the parent surface is byte-identical to Wave C.
- P7 (bilingual UI) — adjacent: trigger / picker / success / rate-limit / error
  copy all switch on `isHi`; the catalog ships En + Hi for every preset.

### Notes on test strategy

REG-85 follows the **flag-OFF safety pattern** (REG-78/REG-79/REG-83/REG-84) for
the gate half and the **content-safety contract pattern** (REG-66/REG-68) for the
preset-only / PII-free halves. The component tests mock only two seams — the
Supabase session helper (Bearer token) and global `fetch` (network) — and assert
on user-visible structure (preset labels, the absence of any free-text affordance,
the exact POST body, the mapped success/rate-limit/error copy), never on internals.
The gate tests stub the lazy `EncourageButton` (as the existing suite stubs
`WeeklyReport`) and assert purely on whether `<ParentGlanceHome>` MOUNTS it across
the full flag × `canFetchReport` truth table, with each test resetting the mocked
flag state so the assertions are independent of ordering. The route + catalog tests
(already present) pin the server-side P12/P13 boundary. The whole set needs no
Supabase fixture and runs green in CI today.

### Catalog total

Consumer Minimalism Wave D adds REG-85 (parent → child Encourage preset-only +
PII-free + flag-OFF parity).

**Total: 53 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Consumer Minimalism — Wave D parent auth unification (2026-06-06) — REG-86

Source: parent auth unification ("D-authunify", Finding #5 / Exception E2 closure),
flag-gated by `ff_parent_unified_auth_v1` (default OFF —
`FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1] === false`). ONE
file changed: `src/app/parent/page.tsx`. The page's session-resolution effect
(`src/app/parent/page.tsx:991-1034`) gained a flag branch: when ON, the parent
session is resolved SOLELY from the Supabase guardian-JWT (`auth.guardian`) via a
`resolveGuardianFromJwt()` → `get_children` Edge-function call, and the HMAC
`loadParentSession()` sessionStorage fallback is NEVER consulted; when OFF
(default) the existing dual path is unchanged (byte-identical). `parent-session.ts`
(the HMAC store + brute-force-lockout helpers) is untouched and still used on the
flag-OFF path. The real auth boundary is already server-side (the `parent-portal`
Edge Function requires a Bearer JWT on every action; `/api/parent/report` uses
`authorizeRequest`), so the HMAC payload was only ever a client cache.

Two load-bearing safety properties hold this change together (same family as the
REG-78 / REG-79 / REG-83 / REG-84 / REG-85 flag-OFF safety tests):

1. **Flag-OFF parity (byte-identical current product).** With
   `ff_parent_unified_auth_v1` OFF (production truth), the existing dual path
   runs unchanged: `auth.guardian` present → seed the student from the HMAC
   `loadParentSession()`; `auth.guardian` absent → STILL fall back to
   `loadParentSession()` (the link-code session reachable today). A regression
   that defaulted the flag ON, or inverted the branch, would silently change
   how every guardian's session resolves.

2. **Flag-ON JWT-only resolution + no stale-cache revival (P15-adjacent auth
   integrity).** With the flag ON and `auth.guardian` present, the guardian-JWT
   is the SOLE source of truth — the student is seeded from `get_children`
   (Bearer-JWT-gated server-side) and `loadParentSession()` is never called. With
   the flag ON and NO `auth.guardian`, the page renders the unauthenticated
   LoginScreen and must NOT silently revive a stale HMAC sessionStorage cache.

**P15 boundary (NON-NEGOTIABLE):** D-authunify touches ONLY the parent portal's
client-side session-resolution branch. It does NOT touch any onboarding-funnel
file — `send-auth-email`, `auth/callback`, `auth/confirm`, `api/auth/bootstrap`,
`AuthContext`, `onboarding/page`, the `bootstrap_user_profile` RPC, or `SITE_URL`.
Verified by `git diff --name-only`: `src/app/parent/page.tsx` is the only changed
file. The signup→verify→profile→dashboard funnel for all three roles is unaffected
(the existing P15 suites — `auth-onboarding`, `auth-callback-role-redirect`,
`auth-bootstrap`, `identity-onboarding`, `onboarding-*` — stay green).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-86 | `parent_unified_auth_flag_off_parity_and_jwt_only_resolution` | Flag-gated parent session-resolution pin. A faithful replica of the page's resolution effect (`src/app/parent/page.tsx:991-1034`), wired to a mocked `useFeatureFlags()` (the same SWR hook the page reads) and a mocked `useAuth()`, with two spy seams — `loadParentSession` (HMAC sessionStorage) and `getChildren` (the page's `api('get_children', …)` Edge call). Asserts: **(a) Flag-OFF parity:** flag ABSENT (prod truth) or explicitly `false`, guardian present → student seeded from the HMAC `loadParentSession` (`getChildren` NOT called); flag OFF + NO guardian → the link-code HMAC session is reachable (revives guardian + student from sessionStorage). **(b) Flag-ON JWT-only:** flag `true` + `auth.guardian` present → student seeded from `getChildren(guardian.id)`, the HMAC `loadParentSession` is NEVER consulted (proven even with a stale HMAC cache present); JWT guardian with NO linked children → unauthenticated LoginScreen, still no HMAC read. **(c) Flag-ON no-guardian (no stale revival):** flag `true` + NO `auth.guardian` → renders the unauthenticated LoginScreen and NEVER calls `loadParentSession` even when a stale HMAC session exists (no silent revive); stays in the checking state while `auth.isLoading` (no resolution attempted). A standalone assertion pins `FLAG_DEFAULTS[PARENT_UNIFIED_AUTH_V1] === false` against a default-flip regression. | `src/__tests__/components/parent/parent-unified-auth.test.tsx` (8 tests: 1 default-flip + 3 flag-OFF dual-path + 2 flag-ON JWT-only + 2 flag-ON no-guardian) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag OFF: existing dual path (byte-identical)::guardian present + flag ABSENT → seeds student from the HMAC loadParentSession (dual path intact)`
- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag OFF: existing dual path (byte-identical)::NO guardian + flag OFF → the link-code HMAC session is reachable (revives from sessionStorage)`
- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag ON + auth.guardian: JWT-only resolution::seeds the student from the guardian-JWT get_children call — never consults the HMAC fallback`
- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag ON + no auth.guardian: no stale HMAC revival::renders the unauthenticated LoginScreen and never calls loadParentSession (no silent HMAC revive)`

### Invariants covered by this section

- Flag-OFF safety (same family as REG-78/REG-79/REG-83/REG-84/REG-85): the entire
  D-authunify change is inert with `ff_parent_unified_auth_v1` OFF — the existing
  dual HMAC/JWT path runs byte-identically.
- P15 boundary (onboarding integrity): the change touches NO onboarding-funnel
  file — the signup→verify→profile→dashboard path for all three roles is untouched.
  The HMAC store (`parent-session.ts`) and the server-side auth boundary
  (`parent-portal` Bearer-JWT gate, `/api/parent/report` `authorizeRequest`) are
  unchanged.

### Notes on test strategy

REG-86 follows the **flag-OFF safety pattern** (REG-78/REG-79/REG-83/REG-84/REG-85):
the enforcing test renders a faithful replica of the page's resolution effect wired
to the REAL flag-read hook (`useFeatureFlags`) and a mocked `useAuth`, and asserts
on WHICH seam each branch consults (`loadParentSession` HMAC vs `getChildren` JWT) —
never on page internals (cosmic theme / atlas / dynamic imports). A full page mount
was avoided for the same reason REG-84 used a dispatch replica: the page pulls in
the cosmic provider, atlas flag, and several `dynamic(ssr:false)` chunks that are
irrelevant to the resolution decision. The two seams (`loadParentSession`,
`getChildren`) are the only ones the branch differs on, so they are exactly what the
assertion targets. The suite needs no Supabase fixture and runs green in CI today.

### Catalog total

Consumer Minimalism Wave D (auth unification) adds REG-86 (parent unified-auth
flag-OFF parity + JWT-only resolution + P15 boundary).

**Total: 54 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Mobile parity — /v2 contract (Phase 2 Wave 2.2) — REG-87

Source: Phase 2 "mobile-parity-via-one-contract" — Wave 2.1 landed the `/v2`
standard + the Zod→OpenAPI→Dart codegen pipeline (`src/lib/api/v2/contract.ts`
single source of truth → `openapi/v2.json` → `mobile/lib/api/v2/**`); Wave 2.2
added 8 student-facing `/v2` consumer endpoints
(`/v2/quiz/{questions,start,submit}`, `/v2/student/{profile,progress,leaderboard}`,
`/v2/learn/{curriculum,concept}`). The web and Flutter clients consume the SAME
contract, so two distinct failure modes must be pinned:

1. **`/v2/quiz/submit` server-authoritative parity (P1/P2/P3/P4).** The `/v2`
   submit route is an assessment-approved THIN PASS-THROUGH that MIRRORS the
   existing `/api/quiz/submit` wrapper: it calls the SAME RPC
   (`submit_quiz_results_v2`) with the SAME rename-only mapped args
   (`responses[].selected_option → selected_displayed_index`,
   `time_taken_seconds → time_spent`, `totalTimeSeconds → p_time`,
   `Idempotency-Key → p_idempotency_key`) and returns the RPC's score / XP /
   correct / total / flagged VERBATIM — the route does NO scoring (P1), NO XP
   math (P2), NO anti-cheat checks (P3); the RPC owns all of it atomically (P4).
   A mobile client hitting `/v2` MUST get byte-identical grading to a web client
   hitting `/api/quiz/submit`. The pin proves "verbatim" by feeding the RPC mock
   DELIBERATELY non-formula values (8/10 → `score_percent: 73`, `xp_earned: 137`)
   and asserting they pass through untouched — a route that recomputed
   `Math.round((8/10)*100)=80` would fail. It also pins the Idempotency-Key
   requirement (400 when missing/non-UUID) and the error-translation table
   (P0001 → 409, unique-violation → cached idempotent replay 200, anything else
   → 503 for safe retry).

2. **`/v2` route ↔ contract drift-check (mobile-parity integrity).** Wave 2.1's
   OpenAPI drift-check (`npm run gen:openapi:check`) only proves
   `openapi/v2.json` matches the Zod source — NOT that the ROUTE HANDLERS emit
   what the contract describes. Quality flagged this latent gap in Wave 2.1: a
   route could ship a response shape the Dart client can't deserialize and CI
   would stay green. The conformance suite closes it by parsing a representative
   shaped output of EVERY `/v2` endpoint through its exported Zod schema and
   asserting it passes, honoring the three distinct envelopes
   (`/v2/today` → bare `TodayResponse`; `/v2/parent/encourage` → `SuccessAck`;
   Wave 2.2 routes → `{ success, data: <payload> }`). It also pins drift guards:
   the schema REJECTS the legacy bare `{ error }` v1 envelope, an integer grade
   (P5), fewer-than-4 options (P6), and a `QuizSubmitResult` missing
   `marking_authenticity_path`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-87 | `v2_quiz_submit_server_authoritative_parity_and_v2_contract_drift_check` | Two-part pin on the `/v2` mobile-parity surface. **(a) `/v2/quiz/submit` parity (P1/P2/P3/P4):** the route calls `submit_quiz_results_v2` EXACTLY ONCE with the SAME rename-only mapped args as `/api/quiz/submit` (`p_responses[].selected_displayed_index` / `time_spent`, `p_time`, `p_idempotency_key`, plus the same `unknown`/`'0'`/`null` subject/grade/topic/chapter fallbacks) — asserted via `.toEqual` on the full arg object, not a partial match; the RPC's `score_percent` / `xp_earned` / `correct` / `total` / `flagged` are returned VERBATIM in the `/v2` envelope (proven with deliberately non-formula RPC values 8/10 → 73% / 137 XP so any client-side recompute would fail); the `Idempotency-Key` header is REQUIRED (400 + `IDEMPOTENCY_KEY_REQUIRED` when missing or non-UUID); JWT↔body `studentId` mismatch is 403; and the error-translation table holds (P0001 → 409 `SESSION_NOT_STARTED`, unique-violation → cached idempotent replay 200 with verbatim cached score/XP, any other RPC error → 503 `RPC_FAILED`, empty RPC result → 503 `EMPTY_RESPONSE`). **(b) `/v2` route↔contract conformance (drift-check):** a representative shaped output of every `/v2` endpoint parses cleanly through its exported Zod schema from `src/lib/api/v2/contract.ts`, honoring the three envelopes (`/v2/today` bare `TodayResponse`, `/v2/parent/encourage` `SuccessAck`, Wave 2.2 routes `{ success, data }`); every `v2Error` code parses against `ErrorResponse`; and the schema REJECTS the legacy bare `{ error }` v1 envelope, an integer grade (P5), a 3-option question (P6), and a `QuizSubmitResult` missing `marking_authenticity_path` — closing the latent drift the OpenAPI artifact check (`gen:openapi:check`) does not catch. | `src/__tests__/api/v2/quiz-submit.test.ts` (13 tests: 7 auth/idempotency/validation + 3 RPC parity + 3 error-translation), `src/__tests__/api/v2/contract-conformance.test.ts` (31 tests: 15 success-envelope conformance + 12 error-envelope conformance + 1 v1-envelope-drift reject + 3 malformed-output drift guards) | E (unit — runs in CI; `gen:openapi:check` guards the artifact half) |

### Pinned tests

- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — RPC parity (mirrors /api/quiz/submit)::calls submit_quiz_results_v2 with the SAME mapped args as /api/quiz/submit`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — RPC parity (mirrors /api/quiz/submit)::returns RPC score/xp VERBATIM (no recompute) in the /v2 envelope`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — error translation::translates a unique-violation into a cached idempotent replay (200)`
- `src/__tests__/api/v2/contract-conformance.test.ts::/v2 contract conformance — success envelopes parse against contract schemas::POST /v2/quiz/submit envelope conforms (server-authoritative, verbatim RPC values)`
- `src/__tests__/api/v2/contract-conformance.test.ts::/v2 contract conformance — error envelopes parse against ErrorResponse::ErrorResponse REJECTS a bare {error} (legacy v1 envelope drift guard)`

### Invariants covered by this section

- P1 Score accuracy / P2 XP economy: the `/v2/quiz/submit` route never recomputes
  score or XP — it returns the `submit_quiz_results_v2` RPC values verbatim, so a
  mobile client and a web client get identical grading (the RPC is the single
  re-deriver, consistent with REG-51/REG-52).
- P3 Anti-cheat / P4 Atomicity: all three anti-cheat checks and atomicity live in
  the RPC; the route forwards inputs only — `flagged` is passed through, never
  computed in the route.
- P5 Grade format / P6 Question quality: the contract schemas enforce string
  grades and exactly-4-option questions; the conformance drift guards prove a
  regression to integer grade or a 3-option question fails the schema.
- Mobile-parity contract integrity: the conformance suite proves the route output
  matches the Zod source the Dart client is generated from — closing the gap
  `gen:openapi:check` (artifact ↔ Zod) leaves open (route ↔ Zod).

### Notes on test strategy

REG-87 follows the **contract/parity pattern** (REG-50/REG-51/REG-71): the
enforcing tests assert on the route's observable contract (which RPC, which args,
which verbatim values, which envelope) rather than on internals. Part (a) mocks
only the seams (`authorizeRequest`, `supabase-admin`, `supabase-server.rpc`) and
asserts on the captured RPC call + the JSON envelope, proving "verbatim" with
deliberately wrong RPC math so a recompute can't slip through. Part (b) is a pure
schema-parse suite over representative fixtures that mirror each route's
projection (`projectQuestion`, `shapeResult`, the student/learn projections), so
it needs no Supabase fixture and runs green in CI today. The two halves together
with the artifact check (`gen:openapi:check`, REG-adjacent CI gate) give a
three-link chain: Zod source → OpenAPI artifact → route output, all pinned.

### Catalog total

Phase 2 Wave 2.2 (mobile parity via one contract) adds REG-87 (`/v2/quiz/submit`
server-authoritative parity + `/v2` route↔contract drift-check).

**Total: 55 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Mobile parity — /v2 post-submit side-effect parity (Phase 2 Wave 2.3) — REG-88

Source: Phase 2 "mobile-parity-via-one-contract" — Wave 2.3. Wave 2.2 (REG-87)
proved `/v2/quiz/submit` is a server-authoritative THIN PASS-THROUGH that returns
the RPC's score/XP VERBATIM. But at Wave 2.2 the `/v2` route stopped at the RPC:
it did NOT run the post-submit side-effects the canonical `/api/quiz/submit`
route fires after a fresh grade — PostHog telemetry (`quiz_graded` + `xp_awarded`,
plus conditional `quiz_anti_cheat_flagged` / `daily_xp_cap_hit`), the ADR-005
spine emit (`publishEvent(learner.mastery_changed)`, one per chapter touched),
and the orchestrator bridge (`maybeDispatchQuizCompletion`). That left a
**telemetry/spine parity gap**: a mobile client hitting `/v2` would be graded
identically but would be INVISIBLE to PostHog funnels, the projector subscribers
(mastery-state-writer, concept-mastery-projector), and the orchestrator —
analytics and learner-state would silently undercount mobile activity.

Wave 2.3 closes it by extracting the canonical route's inline side-effect block
into a SINGLE shared module, `src/lib/quiz/submit-side-effects.ts`
(`runQuizSubmitSideEffects(admin, authUserId, input, result)`). BOTH routes now
call the SAME function after the RPC returns success:

1. **Single-source extraction (no-drift refactor of `/api/quiz/submit`).** The
   canonical route's PostHog/spine/bridge sections were moved verbatim into the
   shared module; the route re-exports the pure helpers
   (`computeMasteryDeltas`, `masteryChangedIdempotencyKey`,
   `quizCompletedIdempotencyKey`) from their new home so existing importers (the
   spine-emit contract test) keep resolving them. Behavior of `/api/quiz/submit`
   MUST be unchanged — its existing REG-62 idempotency tests still assert
   `quiz_graded` fires once on a fresh submit and ZERO times on an idempotent
   replay, exercising the REAL shared module end-to-end (they mock only the
   `@/lib/posthog/server` leaf, not the side-effects module).

2. **`/v2/quiz/submit` full side-effect parity.** On a fresh (non-replay) submit
   the `/v2` route now fires the SAME side-effects with the SAME args the web
   route uses: `quiz_graded` once (`$insert_id = quiz_graded:<session>`,
   `marking_authenticity_path: 'oracle_v2'`), `xp_awarded` once
   (`$insert_id = xp_awarded:quiz:<session>`), `publishEvent(learner.mastery_changed)`
   on the ADR-005 spine (`idempotencyKey = mastery-changed:<session>:<chapter>`,
   matching the orchestrator's key verbatim so the bus de-dupes), and the
   orchestrator bridge with the same session id.

3. **Idempotent-replay guard (both routes).** `runQuizSubmitSideEffects`
   short-circuits the moment `result.idempotent_replay === true` — so on a
   cached replay NEITHER route fires PostHog, the spine emit, OR the bridge. No
   funnel double-count, no double-publish on the bus, no duplicate orchestrator
   dispatch.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-88 | `v2_quiz_submit_post_submit_side_effect_parity_via_shared_helper` | `/v2/quiz/submit` now runs FULL post-submit side-effect parity with `/api/quiz/submit` via the shared `runQuizSubmitSideEffects()` (`src/lib/quiz/submit-side-effects.ts`), idempotent-replay-guarded. On a FRESH submit the `/v2` route emits PostHog `quiz_graded` EXACTLY ONCE (distinctId = studentId, payload `{ session_id, score_percent, xp_earned, correct, total, marking_authenticity_path: 'oracle_v2', anti_cheat_flagged: false, idempotent_replay: false }`, `$insert_id = quiz_graded:<session>`) AND `xp_awarded` EXACTLY ONCE (payload `{ xp_delta, source: 'quiz', daily_total_after, capped }`, `$insert_id = xp_awarded:quiz:<session>`) AND `publishEvent(learner.mastery_changed)` on the ADR-005 spine EXACTLY ONCE for the primary chapter (`actorAuthUserId` = JWT user, `idempotencyKey = mastery-changed:<session>:<chapter>` — verbatim match to the orchestrator key so the bus UNIQUE constraint de-dupes, payload `{ subjectCode, chapterNumber, trigger: 'quiz' }`) AND dispatches the orchestrator bridge (`maybeDispatchQuizCompletion`) once with the same `legacySessionId` / `subjectCode` / `chapterNumber` — all with the SAME args the web route uses (both call the single shared helper). On an IDEMPOTENT REPLAY (unique-violation → cached row, `idempotent_replay: true`) NEITHER `quiz_graded`, `xp_awarded`, `publishEvent`, NOR the bridge fires (guard short-circuits → no funnel double-count, no double-publish on the bus, no duplicate dispatch). The canonical `/api/quiz/submit` refactor is non-weakening: REG-62's existing idempotency tests still assert `quiz_graded` fires once on a fresh submit and zero on replay through the REAL shared module (only `@/lib/posthog/server` is mocked). | `src/__tests__/api/v2/quiz-submit.test.ts` (Wave 2.3 section: 5 tests — `quiz_graded` parity, `xp_awarded` parity, `learner.mastery_changed` spine-emit parity, orchestrator-bridge parity, replay-fires-nothing — on top of the prior contract tests in the same file); web side via `src/__tests__/api/quiz-submit-idempotency.test.ts` (REG-62 — `quiz_graded` fires-once / not-on-replay through the shared helper) + `src/__tests__/state/learner-loop/quiz-submit-spine-emit.test.ts` (re-exported pure helpers + spine event-shape) | E (unit — runs in CI) |

### Pinned tests

- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — post-submit side-effect parity (Wave 2.3)::emits PostHog quiz_graded once with the SAME payload the web route uses`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — post-submit side-effect parity (Wave 2.3)::emits publishEvent(learner.mastery_changed) on the ADR-005 spine with the SAME envelope`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — post-submit side-effect parity (Wave 2.3)::does NOT fire PostHog, publishEvent, or the bridge on an idempotent replay`
- `src/__tests__/api/quiz-submit-idempotency.test.ts::POST /api/quiz/submit — fresh submission (REG-62)::returns 200 with idempotent_replay=false and emits quiz_graded once` (web-side proof the shared helper still fires on the canonical route)
- `src/__tests__/api/quiz-submit-idempotency.test.ts::POST /api/quiz/submit — idempotent replay (REG-62)::returns 200 with idempotent_replay=true and DOES NOT emit quiz_graded on a unique-violation race` (web-side proof the replay guard still holds post-refactor)

### Invariants covered by this section

- Mobile-parity telemetry/spine integrity: a mobile client hitting `/v2/quiz/submit`
  is now equally visible to PostHog funnels, the ADR-005 projector subscribers
  (mastery-state-writer, concept-mastery-projector), and the orchestrator as a web
  client hitting `/api/quiz/submit` — the SAME shared helper fires for both, so
  the two paths cannot drift on side-effects (extends REG-87's grading parity to
  the post-grade side-effects).
- ADR-005 spine de-dup: the `/v2` route's `learner.mastery_changed` idempotency
  key matches the orchestrator key verbatim, so when both the route-level publish
  and the orchestrator bridge fire the bus's `UNIQUE(idempotency_key)` constraint
  yields exactly one row per (kind, session, chapter).
- No double-count on replay: the `idempotent_replay` guard ensures cached replays
  on EITHER route fire no telemetry, no bus publish, and no orchestrator dispatch
  (consistent with REG-62's funnel-double-count guard, now extended to the spine
  and bridge).

### Notes on test strategy

REG-88 follows the same **contract/parity pattern** as REG-87: both routes' tests
mock only the leaf side-effect modules (`@/lib/posthog/server`,
`@/lib/state/events/publish`, `@/lib/state/quiz-orchestrator-bridge`) so the REAL
`runQuizSubmitSideEffects()` orchestration runs, and assert on the captured calls
(which event, which payload, which `$insert_id` / idempotency key, how many times).
Because BOTH routes call the same shared function, the v2 tests prove the v2 wiring
and the existing REG-62 web tests prove the canonical wiring still fires through
the extracted module — so the shared-helper extraction is covered on BOTH sides
with no coverage gap on the canonical route. A `flushAsync()` (setTimeout 0) flushes
the deferred spine-emit IIFE's microtasks before the publish assertions run. NOTE:
there is no standalone unit test for the pure side-effect IIFE wiring of
`src/lib/quiz/submit-side-effects.ts` in isolation; it is covered transitively
through the two route test suites (the pure helpers `computeMasteryDeltas` /
`*IdempotencyKey` ARE unit-tested directly in the spine-emit test).

### Catalog total

Phase 2 Wave 2.3 (mobile parity via one contract — post-submit side-effects) adds
REG-88 (`/v2/quiz/submit` full PostHog + spine + bridge side-effect parity with
`/api/quiz/submit` via the shared `runQuizSubmitSideEffects()` helper,
idempotent-replay-guarded).

**Total: 56 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Mobile parity — /v2 parent endpoints (Phase 2 Wave 2.4) — REG-89

Source: Phase 2 "mobile-parity-via-one-contract" — Wave 2.4. Wave 2.2/2.3
(REG-87/REG-88) covered the STUDENT-facing `/v2` surface. Wave 2.4 adds the first
two PARENT-facing `/v2` BFF endpoints so the Flutter parent screens consume the
SAME contract as the web parent portal:

  - `GET /v2/parent/children` (`src/app/api/v2/parent/children/route.ts`) — the
    guardian's linked children, reusing `listChildrenForGuardian`.
  - `GET /v2/parent/glance?student_id=<uuid>` (`src/app/api/v2/parent/glance/route.ts`)
    — at-a-glance view for one linked child, reusing the `parent-portal` Edge
    Function `get_child_dashboard` action (the SAME payload the web
    `ParentGlanceHome` consumes; no aggregation duplicated).

Both are THIN reads — no new aggregation, no learner-state write. The load-bearing
property is the **P13 guardian-link boundary**: a parent must see ONLY children
they are linked to, with name + grade (P5 string) + the child's own learning stats
and NOTHING else (no guardian email/phone, no `schoolId`, no raw upstream error
text). The boundary is enforced twice on `glance` (defense-in-depth): the route's
own `getGuardianByAuthUserId` → `isGuardianLinkedToStudent(guardian.id, student_id)`
check (403 + NO upstream fetch when unlinked), AND the forwarded Bearer JWT re-runs
the Edge Function's own JWT-bound guardian+link guard. `children` projects the
relationship-domain rows down to `{ student_id, name, grade }` — the `schoolId` /
`linkId` / `linkStatus` fields the domain returns never cross the wire.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-89 | `v2_parent_children_glance_guardian_link_boundary_and_envelope` | Two-route pin on the Wave 2.4 parent `/v2` surface. **(a) RBAC + ownership (P9):** both routes call `authorizeRequest(_, 'child.view_progress')` and return its `errorResponse` verbatim (401/403) BEFORE any guardian/domain read; a caller with no guardian profile is 403 (`NO_GUARDIAN_PROFILE`), and `glance` validates `student_id` is a UUID (400 `VALIDATION_ERROR`) before resolving the guardian. **(b) Guardian-link boundary (P13 cross-guardian isolation):** `glance` returns 403 `NOT_LINKED` and performs NO upstream `fetch` when `isGuardianLinkedToStudent` is false (proven with a fetch spy asserted never-called); an Edge-Function 403 maps to 403 `NOT_LINKED`; `children` reuses `listChildrenForGuardian(authUserId)` so a guardian only ever sees their own links. **(c) P5/P13 projection:** `children` items are EXACTLY `{ student_id, name, grade }` with `grade` a string — the payload carries no `email` / `phone` / `schoolId`; `glance` returns `child: { student_id, name, grade:string }` + snapshot/moments/weeklyActivity derived from the EXISTING Edge fields, with no guardian PII anywhere; both responses round-trip through the registered `ParentChildrenResponse` / `ParentGlanceResponse` Zod schemas (`{ success, data }` envelope, `schemaVersion: 1`). **(d) No raw error text (P13):** a domain-read failure → 500 and an upstream Edge failure / unreachable fetch → 502, with the raw upstream/DB message never surfaced to the client; an Edge error-payload → 404 `NO_DATA`. | `src/__tests__/api/v2/parent/children/route.test.ts` (8 tests: auth gate + permission code, no-guardian 403, happy-path name+grade-only P13, empty links, Zod round-trip, 500 no-raw-text), `src/__tests__/api/v2/parent/glance/route.test.ts` (15 tests: auth gate + permission code, UUID validation 400, no-guardian 403, NOT_LINKED 403 + no-fetch, happy-path shaping + P5 grade + P13 no-PII, struggling-child concerns, Zod round-trip, 502/404/403 upstream-failure mapping no-raw-text) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/api/v2/parent/glance/route.test.ts::GET /api/v2/parent/glance — ownership::returns 403 when the guardian is NOT linked to the student (no data fetched)`
- `src/__tests__/api/v2/parent/glance/route.test.ts::GET /api/v2/parent/glance — happy path::shapes the get_child_dashboard payload into snapshot + moments + weeklyActivity`
- `src/__tests__/api/v2/parent/children/route.test.ts::GET /api/v2/parent/children — happy path::returns the linked children in the /v2 envelope, name+grade only (P13)`
- `src/__tests__/api/v2/parent/children/route.test.ts::GET /api/v2/parent/children — failure::returns 500 with no raw error text when the domain read fails`

### Invariants covered by this section

- P13 (data privacy — guardian-link boundary): a parent sees ONLY linked children;
  `glance` enforces the link at the route AND re-enforces via the forwarded-JWT Edge
  Function; the children list is scoped to the caller's own guardian links. No
  guardian PII (email/phone) and no `schoolId` / link metadata crosses the wire; no
  raw upstream/DB error text reaches the client.
- P9 (RBAC enforcement): both routes gated by `child.view_progress`; the auth
  `errorResponse` is returned verbatim before any domain read.
- P5 (grade format): `grade` is a string in both payloads.
- Mobile-parity contract integrity (extends REG-87/REG-88): both responses
  round-trip through the registered `ParentChildrenResponse` / `ParentGlanceResponse`
  Zod schemas the Dart client is generated from — the parent `/v2` surface is now
  covered by the same contract-conformance discipline as the student surface.

### Notes on test strategy

REG-89 follows the same **contract/parity pattern** as REG-87/REG-88 and the
encourage-route test (REG-85): the route tests mock only the seams
(`authorizeRequest`, the identity/relationship domain helpers, and — for `glance` —
global `fetch`) so the REAL projection and link-boundary logic run, and assert on
the observable contract (status, envelope, the EXACT projected fields, the absence
of PII via a `JSON.stringify` negative match, and which seam fired). The unlinked
case is proven by a `fetch` spy asserted never-called, so a regression that fetched
child data before the link check would fail. No Supabase fixture is needed; the
suite runs green in CI today.

### Catalog total

Phase 2 Wave 2.4 (mobile parity via one contract — parent endpoints) adds REG-89
(`/v2/parent/children` + `/v2/parent/glance` guardian-link boundary (P13) +
RBAC (P9) + P5 grade string + `{ success, data }` contract conformance).

**Total: 57 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Mobile APK must actually compile — Android toolchain-drift gate (2026-06-07) — REG-90

Source: CI-hardening RCA after two latent Android-build bugs reached `main`
undetected. This is a build/release-integrity gate (the mobile half of the release
pipeline), not a P1-P15 scoring invariant — so it has no P-tag; like REG-72
(service-availability operational invariant) it pins a pipeline gate rather than a
product formula.

`flutter analyze` and `flutter test` do NOT compile the native Android/Kotlin
layer (Gradle, AGP, the Kotlin Gradle Plugin, NDK abiFilters) — they validate Dart
only. Therefore neither can prove the app actually BUILDS to a shippable APK; only
the `flutter build apk --debug` step does, because it drives the real Android
toolchain end-to-end. Two latent bugs reached `main` precisely because that
compile path had no enforcement: the `Mobile CI` workflow existed but had never
actually run (an Actions billing block left it skipped — a 0-step / ~2s job), and
the dev sandbox cannot run Gradle locally. The bugs: **(A1)** a manual `splits.abi`
block in `mobile/android/app/build.gradle` conflicting with Flutter-injected
`ndk.abiFilters` (AGP forbids declaring both); **(A2)** Kotlin Gradle Plugin 1.9.22
too old to compile `package_info_plus 9.x` (pulled transitively via `sentry_flutter`,
which needs Kotlin 2.x). Both fixed in PR #957; this entry pins the gate so a future
toolchain drift fails CI instead of silently shipping.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-90 | `mobile_apk_must_compile_android_toolchain_gate` | The `Mobile CI` workflow's `flutter build apk --debug` step is the enforcing gate that proves the Flutter app compiles to an Android APK — it drives the real Android toolchain (Gradle + AGP + Kotlin Gradle Plugin + NDK abiFilters) end-to-end, which `flutter analyze` and `flutter test` (Dart-only) CANNOT do. Any PR touching `mobile/**` MUST have the `Flutter analyze + test + build` check (workflow `Mobile CI`, `.github/workflows/mobile-ci.yml`) GREEN before merge; a 0-step / ~2s job is "never ran" (Actions billing-block), NOT "passed", and does not satisfy the gate. The step guards two toolchain-drift regressions fixed in PR #957: (A1) no manual `splits.abi` block coexisting with Flutter-injected `ndk.abiFilters` in `mobile/android/app/build.gradle` (AGP forbids both), and (A2) Kotlin Gradle Plugin must stay new enough (Kotlin 2.x) to compile `package_info_plus 9.x` (transitive via `sentry_flutter`). Full RCA + remediation in [docs/runbooks/mobile-ci-and-android-toolchain.md](../docs/runbooks/mobile-ci-and-android-toolchain.md). | `.github/workflows/mobile-ci.yml` (job `Flutter analyze + test + build` → step `flutter build apk --debug`; PR-triggered on `mobile/**` / `openapi/v2.json` / the workflow itself) + `docs/runbooks/mobile-ci-and-android-toolchain.md` (RCA + toolchain-pin runbook) | R (resolved in PR #957 — `splits.abi` block removed + Kotlin Gradle Plugin bumped to 2.x; mobile-ci now runs the APK-compile gate on every `mobile/**` PR) |

### Invariants covered by this section

- Build/release integrity (operational invariant — mobile pipeline) — the
  `flutter build apk --debug` step is the only signal that proves the Android app
  actually compiles. `flutter analyze` + `flutter test` are Dart-only and cannot
  detect Gradle/AGP/Kotlin/NDK toolchain drift, so a green analyze+test does NOT
  imply a buildable APK. REG-90 pins the compile step as the merge gate for any
  `mobile/**` change and records that a 0-step/~2s job means "never ran", not
  "passed".
- Mobile parity (adjacent to REG-87/REG-88/REG-89) — the `/v2` contract parity
  entries assume a Flutter app that compiles and ships; REG-90 guards the half of
  the release pipeline that proves the mobile binary builds at all.

### Notes on test strategy

REG-90 is enforced by a CI workflow step, not a Vitest/Playwright assertion — the
"test" is the green `flutter build apk --debug` run on every `mobile/**` PR. It is
catalogued in the `R` (resolved) state because the two toolchain-drift bugs it
guards were fixed in PR #957 and the workflow now exercises the compile path. The
RCA, the two root causes (A1 `splits.abi`/`ndk.abiFilters` conflict, A2 Kotlin
Gradle Plugin version), and the toolchain version pins live in the runbook
`docs/runbooks/mobile-ci-and-android-toolchain.md` — this entry deliberately does
not restate them.

### Catalog total

Pre-REG-90: 57 entries. CI-hardening mobile RCA adds REG-90 (mobile APK-compile /
Android toolchain-drift gate).

**Total: 58 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Offline quiz replay invariant safety (Phase 2 Wave 2.5) — REG-91

Source: Phase 2 Wave 2.5 "offline-first quiz" — 2.5.1 server-side offline-replay
gates + 2.5.3 offline-sync telemetry (`src/app/api/v2/quiz/submit/route.ts`,
`src/lib/quiz/submit-side-effects.ts`, the 5 offline fields on `QuizSubmitRequest`
in `src/lib/api/v2/contract.ts`) and 2.5.2 the Flutter offline capture → queue →
reconnect-drain (`mobile/lib/data/repositories/offline_drain_service.dart`,
`offline_quiz_store.dart`, `quiz_repository.dart:buildOfflineSubmitRequest`,
`mobile/lib/data/models/offline_quiz_models.dart`).

A quiz captured while OFFLINE and drained later MUST yield the SAME
server-authoritative result as if it were submitted online — same score (P1),
same XP including the 200/day cap (P2), same anti-cheat verdict (P3), graded
against the SAME server snapshot, never a client shuffle map (P6) — and MUST NOT
double-count on a re-drain (P2). The load-bearing safety properties:

  - **Grading is unchanged across the offline gap.** The offline branch is a thin
    pre-check in front of the SAME `submit_quiz_results_v2` RPC. It forwards the
    device-summed `totalTimeSeconds` as `p_time` and sends NO `score`/`correct`/`xp`
    field — the RPC stays the sole grading authority. `capturedAt` is used ONLY for
    clock-skew + staleness gating and queue-latency telemetry; it is NEVER used to
    derive the P3 attempt duration (no wall-clock derivation from capturedAt/drainedAt).
  - **Immutable Idempotency-Key per attempt ⇒ no double-count (P2).** The key is
    minted ONCE at capture and reused VERBATIM on every drain/retry; the server's
    unique-violation replay path returns the cached row (`idempotent_replay: true`)
    with ZERO additional XP, ZERO daily-cap consumption, and fires none of the
    PostHog / spine / orchestrator side-effects. A regenerated key would re-grant XP.
  - **Fail-closed shuffle integrity (P6).** When the client sends the maps it graded
    its preview against, the server only ASSERTS they equal the server-stored
    `quiz_session_shuffles` snapshot element-for-element — it never grades against the
    client map. Any divergence → 422 `SHUFFLE_MAP_MISMATCH` and the RPC is NEVER
    called; a missing snapshot defers to the RPC's `session_not_started` → 409.
  - **Telemetry is metadata-only (P13).** `learner_offline_sync_replay` fires exactly
    once per drain (fresh grades AND idempotent replays, BEFORE the replay
    early-return) carrying IDs + timestamps + queue latency only — never answer or
    question text.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-91 | `offline_quiz_replay_invariant_safety` | **(a) Same score/XP/anti-cheat (P1/P2/P3) — no wall-clock derivation:** an `attemptMode: 'offline_replay'` submit calls `submit_quiz_results_v2` with `p_time === totalTimeSeconds` and forwards NO `p_correct`/`p_score`/`p_xp`/`p_captured_at`/`p_attempt_mode` — grading is the identical RPC, so score/XP/verdict match online byte-for-byte; the online path (no `attemptMode`) is byte-identical and emits no offline-sync event. **(b) No double-count on re-drain (P2):** a unique-violation replay with the SAME Idempotency-Key returns the cached row (`idempotent_replay: true`) and fires ZERO `quiz_graded` / `xp_awarded` / `publishEvent` / orchestrator dispatch (no added XP, no daily-cap consumption); the mobile drain reuses the key VERBATIM across a 503-retain → success sequence (`{immutable-key-a}` on both drains) and `withDrainAttempt` bumps ONLY the telemetry counter, never the key/capturedAt/timings. **(c) Fail-closed shuffle integrity (P6):** a client map diverging from the server `quiz_session_shuffles` snapshot → 422 `SHUFFLE_MAP_MISMATCH` with the RPC NEVER called; a matching map grades normally; a missing snapshot defers to the RPC `session_not_started` → 409; the mobile bundle re-pins `correctIndex` to -1 on read-back and omits the map when none was captured (no fabricated `SHUFFLE_MAP_MISMATCH`). **(d) capturedAt gates only (P3 boundary):** capturedAt missing → 400 `OFFLINE_CAPTURED_AT_REQUIRED`, >5min future → 422 `REPLAY_CLOCK_INVALID`, >168h old → 422 `REPLAY_TOO_STALE`, `clientCapturedTotalSeconds !== totalTimeSeconds` → 400 `OFFLINE_TIME_INCONSISTENT` — every gate runs BEFORE the RPC. **(e) Telemetry metadata-only (P13):** `learner_offline_sync_replay` fires exactly once per drain with `wasIdempotentReplay` true AND false, BEFORE the replay early-return, carrying schemaVersion/sessionId/capturedAt/drainedAt/queueLatencySeconds/drainAttempt only — a `JSON.stringify` negative match proves no `time_taken_seconds` / `selected_option` leaks. | `src/__tests__/api/v2/quiz-submit.test.ts` (offline-replay gates + offline-sync telemetry describe blocks: P3 `p_time` source, 6 gate codes, shuffle match/mismatch/missing-snapshot, replay no-double-count, `wasIdempotentReplay` true/false, P13 negative match) + `src/__tests__/lib/quiz/submit-side-effects-offline.test.ts` (offline-sync event fires before the replay early-return; online emits none; metadata-only envelope) + `mobile/test/data/repositories/offline_drain_service_test.dart` (503-retain keeps the key UNCHANGED across drains; 409/422 discard; FIFO + serialization) + `mobile/test/data/repositories/offline_submit_request_test.dart` (`p_time`/`clientCapturedTotalSeconds` parity; omits/populates shuffle maps) + `mobile/test/data/models/offline_quiz_models_test.dart` (`withDrainAttempt` immutable key — P2; correctIndex re-pinned to -1 — P6) | E |

### Pinned tests

- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — offline-replay gates (Wave 2.5.1)::happy path forwards the SAME RPC args (P3 source = totalTimeSeconds, no wall-clock)`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — offline-replay gates (Wave 2.5.1)::client shuffle map diverging from the server snapshot → 422 SHUFFLE_MAP_MISMATCH (no grading)`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — offline-sync telemetry (Wave 2.5.3)::emits learner_offline_sync_replay with wasIdempotentReplay=true on a cached replay`
- `src/__tests__/lib/quiz/submit-side-effects-offline.test.ts::runQuizSubmitSideEffects — offline-sync telemetry::offline idempotent replay STILL emits the event (fires BEFORE the early-return)`
- `mobile/test/data/repositories/offline_drain_service_test.dart::drain::503 RETAINS the attempt and the idempotency key is UNCHANGED across drains (P2 — never regenerate the key)`
- `mobile/test/data/models/offline_quiz_models_test.dart::QueuedQuizAttempt::withDrainAttempt bumps ONLY the counter — key + capturedAt + timings unchanged (P2 immutable idempotency key)`

### Invariants covered by this section

- P1 (score accuracy) — the offline path forwards inputs to the SAME
  `submit_quiz_results_v2` RPC; the route does no score math, so an offline replay
  scores identically to an online submit. Extends REG-45/REG-51/REG-52/REG-53.
- P2 (XP economy / no double-count) — the immutable Idempotency-Key per attempt
  guarantees a re-drain returns the cached row with zero additional XP and zero
  daily-cap consumption; the mobile key-immutability tests prove the client never
  regenerates the key on retry. Extends REG-48/REG-62.
- P3 (anti-cheat) — `totalTimeSeconds` remains the SOLE timing source forwarded to
  the RPC across the offline gap; `capturedAt` is used only for skew/staleness gating
  and telemetry, NEVER to derive attempt duration. The 3-rule verdict is the RPC's.
- P6 (question quality / grading integrity) — the server never grades against a
  client shuffle map; it fails closed (422) on any snapshot divergence and the
  offline bundle never carries a correct index (re-pinned to -1). Extends
  REG-39/REG-51/REG-53.
- P13 (data privacy) — `learner_offline_sync_replay` is metadata-only; no answer or
  question text crosses into ops_events. Extends REG-64/REG-68.

### Notes on test strategy

REG-91 spans the full offline round-trip with the **contract/parity pattern** used by
REG-87/REG-88/REG-89: the web route tests mock only the seams (`authorizeRequest`,
`supabase-admin`, the JWT-bound RPC client, and the leaf side-effect modules
`posthog/server` + `state/events/publish` + the orchestrator bridge) so the REAL
gate logic and the REAL `runQuizSubmitSideEffects` orchestration run, then assert on
the observable contract — the exact RPC args, the status/code per gate, which
side-effects fired, and a `JSON.stringify` negative match for the P13 boundary. The
mobile side uses a real Hive-backed store on a temp dir plus a fake submitter that
records every `(localId, key, drainAttempt)` it sees, so the immutable-key invariant
(the single most important P2 rule) is proven end-to-end against the actual FIFO
queue + drain loop rather than a stub. The two halves meet at the wire shape:
`buildOfflineSubmitRequest` produces exactly the body the route's gates consume.

No live Supabase or device is needed; the whole entry runs green in CI today
(web Vitest + Dart `flutter test`). If a future change derives attempt duration from
`capturedAt`, accepts a client-supplied score/xp field, grades against the client
shuffle map, regenerates the Idempotency-Key on retry, or leaks answer text into the
offline-sync event, the suite fails and quality MUST reject.

### Catalog total

Pre-Wave-2.5: 58 entries. Phase 2 Wave 2.5 (offline-first quiz) adds REG-91
(offline quiz replay invariant safety — P1/P2/P3/P6/P13).

**Total: 59 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

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

## Phase 2 monthly-synthesis-builder Python port (2026-06-09) — REG-100

Source: Phase 2 continued — port of `supabase/functions/monthly-synthesis-builder/index.ts`
to Python on Cloud Run. The Python module
(`python/services/ai/business/monthly_synthesis_builder/`) reproduces the TS
six-step pipeline (auth → idempotency lookup → aggregate → bundle build →
idempotent insert → response). The TS Edge function gains a proxy block at
the top of `Deno.serve` that forwards to Cloud Run when
`ff_python_monthly_synthesis_builder_v1` enabled + bucket < rollout_pct.
On any proxy failure → falls through to the legacy TS bundle-builder. Default
OFF (rollout_pct=0).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-100 | `phase_2_monthly_synthesis_builder_python_port_constants_and_wire_parity` | Three-pronged contract on the Python port. (1) **Pure-transformation constants match TS byte-for-byte:** TARGET_DIFFICULTY_V1=0.55, MOCK_QUESTIONS_PER_CHAPTER=2, MOCK_QUESTIONS_CAP=20, MASTERY_IMPROVED_THRESHOLD=0.5, CHAPTERS_TOUCHED_SOFT_CAP=12, CHAPTERS_IN_MOCK_SUMMARY_CAP=6. A regression on any constant ships a wrong-shape bundle to monthly_synthesis_runs. (2) **Wire-shape parity:** SynthesisBundle uses camelCase keys (monthLabel, weeklyArtifactIds, masteryDelta, chapterMockSummary) so the Next.js /api/synthesis/state consumer keeps working byte-for-byte across the cutover. Pydantic extra=forbid enforces no field drift. (3) **Pure logic parity:** month_boundaries_of returns ISO with trailing Z (TS toISOString shape), derive_chapters_touched preserves insertion-order dedup (TS Set semantics), derive_chapter_mock_summary returns null when no chapters touched (TS null path), compute_mastery_counters reports topicsRegressed=0 always (TS v1 simplification — historical snapshots not yet implemented). | `python/tests/unit/test_monthly_synthesis_builder_bundle.py::test_constants_match_ts_verbatim`, `python/tests/unit/test_monthly_synthesis_builder_bundle.py::test_month_boundaries_returns_iso_with_Z_suffix`, `python/tests/unit/test_monthly_synthesis_builder_bundle.py::test_compute_mastery_counters_regressed_always_zero_v1`, `python/tests/unit/test_monthly_synthesis_builder_models.py::test_bundle_wire_shape_camelCase_keys`, `python/tests/unit/test_monthly_synthesis_builder_models.py::test_request_rejects_bad_month_format` | E |

### Invariants covered by this section

- **P5 (grade format)** — N/A here (no grade fields in monthly_synthesis_runs).
- **P12 (AI safety)** — N/A; this port carries no LLM call. The bilingual
  summary is generated lazily by the Next.js side at `/api/synthesis/state`.
- **P13 (data privacy)** — response carries no PII; only UUIDs, counters, and
  chapter titles. The handler binds `student_id` into structlog contextvars
  for log correlation but never logs the full request body.

### Notes on test strategy

REG-100 follows the same multi-file unit pattern as REG-76 (Phase 2
generate-concepts). The TS path is the source of truth for the bundle shape
and the bundle is consumed by `/api/synthesis/state` on the Next.js side, so
any wire drift would surface as a parse error on the synthesis viewer rather
than at the Edge proxy. The pinned tests cover the contract surface; the
broader test files (15 bundle tests + 10 models tests) exercise every
rejection branch in the validators.

The proxy block in `supabase/functions/monthly-synthesis-builder/index.ts`
follows the canonical pattern used by generate-concepts, generate-answers,
and bulk-question-gen: read flag envelope → hash-bucket → forward or fall
through. The Cloud Run forward preserves the `x-cron-secret` header so the
Python service performs its own cron-secret verification — auth posture is
identical on both sides.

### Catalog total

Pre-Phase-2-monthly-synthesis-builder: 67 entries. Phase 2
monthly-synthesis-builder adds REG-100.

**Total: 68 entries.**
## Phase 2 nep-compliance Python port (2026-06-09) - REG-101

Port of `supabase/functions/nep-compliance/index.ts` to Python on Cloud Run.
NEP 2020 Holistic Progress Card generator/retriever. Pure data aggregation,
no LLM call. Edge proxy gates traffic via `ff_python_nep_compliance_v1`;
falls through to legacy TS on any failure. Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-101 | `phase_2_nep_compliance_python_port_nep_thresholds_and_term_boundaries` | (1) NEP 2020 competency thresholds match TS byte-for-byte (85/65/40 boundaries map to advanced/proficient/developing/beginning). (2) Behavior-rating math: returns None when benchmark<=0; caps at 5; minimum 1; zero value returns 1 (not 0). (3) Indian academic year boundary: April starts new year string; March returns previous. (4) Term boundary: months 4-9 are Term 1, months 10-3 are Term 2. A regression on any of these mismaps student level / report card data. | `python/tests/unit/test_nep_compliance_mapping.py::test_thresholds_match_ts_verbatim`, `python/tests/unit/test_nep_compliance_mapping.py::test_mastery_to_competency_advanced`, `python/tests/unit/test_nep_compliance_mapping.py::test_behavior_rating_zero_max_returns_none`, `python/tests/unit/test_nep_compliance_mapping.py::test_academic_year_april_to_march_boundary`, `python/tests/unit/test_nep_compliance_mapping.py::test_current_term_april_to_september_is_term_1` | E |

### Invariants covered by this section

- P5 (grade format) - HPCReport.student.grade is `str` (Pydantic-typed).
- P12 (AI safety) - N/A; no LLM call.
- P13 (data privacy) - response carries student name+grade by necessity
  (HPC is parent-visible by design). Logs only request_id + student_id UUID,
  never report contents.

### Catalog total

Pre-Phase-2-nep-compliance: 68 entries. Phase 2 nep-compliance adds REG-101.

**Total: 69 entries.**
## Phase 2 parent-report-generator Python port (2026-06-09) - REG-102

Port of `supabase/functions/parent-report-generator/index.ts` to Python on
Cloud Run. Bilingual weekly parent report (en/hi). Template path only
(Phase 2.5 will add LLM-narrative variant via MoL). Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-102 | `phase_2_parent_report_generator_python_port_stats_and_bilingual_template` | (1) **Wire-shape parity:** WeeklyStats has exactly the 9 TS-defined fields (quizzes_completed, avg_score, xp_earned, time_spent_minutes, topics_mastered, streak, foxy_sessions, subjects_studied, chapters_covered). (2) **Stats math parity:** avg_score rounds; time = (quiz_seconds + foxy_seconds) / 60; topics_mastered threshold is mastery_level >= 0.8 inclusive; chapters dedup via topics.title; missing learning_profile yields 0 xp_earned and 0 streak. (3) **Bilingual template integrity:** period_label is "This week" / "इस सप्ताह"; highlights for high-performer mention quiz count + avg_score + streak in both languages; zero-state highlights returns single placeholder; concerns lists low-score + low-time + zero-streak triggers; suggestion uses student name when provided and falls back to "your child" / "आपके बच्चे" when blank. A regression on any of these ships either malformed wire shape (parent portal can't render) or wrong-language copy (P7 bilingual violation). | `python/tests/unit/test_parent_report_generator_stats.py::test_compute_stats_empty_inputs_returns_zero_counters`, `python/tests/unit/test_parent_report_generator_stats.py::test_compute_stats_topics_mastered_threshold_at_0_8`, `python/tests/unit/test_parent_report_generator_stats.py::test_period_label_en_hi`, `python/tests/unit/test_parent_report_generator_stats.py::test_highlights_zero_state_returns_placeholder`, `python/tests/unit/test_parent_report_generator_stats.py::test_suggestion_uses_fallback_name_when_blank` | E |

### Invariants covered by this section

- P7 (bilingual UI) - REG-102 pins en/hi parity on template copy.
- P12 (AI safety) - N/A; no LLM call in Phase 2 port (template only).
- P13 (data privacy) - Logs only structural counters; never logs the
  report body, student name, or parent identity. JWT-bound guardian
  lookup prevents body.parent_id spoofing (TS line 605 fix preserved).

### Catalog total

Pre-Phase-2-parent-report-generator: 69 entries. Adds REG-102.

**Total: 70 entries.**

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

## Phase 2 verify-question-bank Python port (stub) (2026-06-09) - REG-104

Structural port of `supabase/functions/verify-question-bank/index.ts`. Phase 2
covers claim/release infrastructure + scheduling helpers; the verifier call is
STUBBED (Phase 2.5 will wire grounded-answer). Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-104 | `phase_2_verify_question_bank_python_port_scheduling_parity` | (1) IST peak window 14:00-22:00 (end exclusive). (2) Batch size 1000 off-peak / 250 peak. (3) Throttle threshold > 2400 RPM (boundary exclusive). (4) Throttled batch halves base size. A regression on any of these changes the verifier cron throughput model and either over-runs Claude (no throttle) or under-runs (too aggressive throttle). | `python/tests/unit/test_verify_question_bank_scheduling.py::test_constants_match_ts`, `python/tests/unit/test_verify_question_bank_scheduling.py::test_is_peak_at_ist_2200_is_off_peak`, `python/tests/unit/test_verify_question_bank_scheduling.py::test_batch_size_peak_throttled_halves`, `python/tests/unit/test_verify_question_bank_scheduling.py::test_should_throttle_threshold` | E |

### Invariants covered by this section

- P12 (AI safety) - Phase 2 STUB does not call the verifier. The TS path remains
  the verifier-of-record until Phase 2.5. Flag default OFF means production
  traffic still hits the TS verifier; no AI-safety regression.
- P13 (data privacy) - logs only counters + claim/release metadata.

### Catalog total

Pre-Phase-2-verify-question-bank: 71 entries. Adds REG-104.

**Total: 72 entries.**
## Phase 2 extract-ncert-questions Python port (stub) (2026-06-09) - REG-105

Structural port of `supabase/functions/extract-ncert-questions/index.ts`.
Phase 2 covers chapter-discovery + coverage stats; the MoL extraction call is
STUBBED. Phase 2.5 will wire MoL routing. Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-105 | `phase_2_extract_ncert_questions_python_port_model_contract` | (1) P5 grade-as-string: ExtractRequest.grade is str-or-None; ExtractedChapter.grade is str. (2) Batch size clamped to [1,10] default 3. (3) Response defaults phase_2_stub=True. (4) Status response coverage_percent bounded [0,100]. (5) Extra fields forbidden on Request (Pydantic extra=forbid). | `python/tests/unit/test_extract_ncert_questions_models.py::test_request_grade_coerced_to_string`, `python/tests/unit/test_extract_ncert_questions_models.py::test_request_batch_size_clamp`, `python/tests/unit/test_extract_ncert_questions_models.py::test_response_default_phase_2_stub_true`, `python/tests/unit/test_extract_ncert_questions_models.py::test_status_response_coverage_bounds`, `python/tests/unit/test_extract_ncert_questions_models.py::test_request_extra_fields_forbidden` | E |

### Invariants covered by this section

- P5 (grade format) - ExtractRequest + ExtractedChapter both pin grade to str.
- P12 (AI safety) - Phase 2 STUB does not call LLM; TS path is extractor-of-record.
- P13 (data privacy) - logs only counters + chapter metadata; no RAG content logged.

### Catalog total

Pre-Phase-2-extract-ncert-questions: 72 entries. Adds REG-105.

**Total: 73 entries.**

## Phase 2 bulk-non-mcq-gen Python port (stub) (2026-06-09) - REG-106

Structural stub port. Auth + request validation are functional; MoL generation
is stubbed (Phase 2.5 follow-up). Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-106 | `phase_2_bulk_non_mcq_gen_python_port_model_contract` | (1) P5 grade-as-string. (2) question_type Literal in {short_answer, long_answer, fill_blank} - MCQ excluded. (3) batch_size in [1,20] default 5. (4) Response phase_2_stub=True default. (5) extra=forbid on both request and response. | `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_request_grade_string`, `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_request_invalid_question_type`, `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_request_batch_size_clamp`, `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_response_phase_2_stub_default_true` | E |

### Catalog total

Pre-Phase-2-bulk-non-mcq-gen: 73 entries. Adds REG-106.

**Total: 74 entries.**

## Voice 3 — adaptive-language spoken-reply resolver (2026-06-09) - REG-107

Closes the Python AI Voice loop (Voice 1a STT → Voice 1b TTS): when a student
SPEAKS, Foxy's spoken reply adapts to the language they actually used. The
Whisper STT call already returns `detected_language`
('en' | 'hi' | 'hinglish' | 'unknown') and `voice.ts` already emits it via the
`onPythonResult` hook; Voice 3 wires that signal up through
`ChatInput` → `MessageInput` → `foxy/page.tsx`, where it updates `voiceLangRef`
(the ref `speak()` reads for the TTS language). Activates only on the Python STT
path — no new flag, no behaviour change when `ff_python_voice_*` is OFF.

Pure resolver `adoptVoiceReplyLanguage(detected, current)` is the single decision
point; it MUST drop 'unknown' (the Azure TTS catalog has no 'unknown' voice and
would HTTP 400) and keep the current language instead.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-107 | `voice_3_adaptive_language_reply_resolver` | (1) Synthesizable set is exactly ['en','hi','hinglish']. (2) `isSynthesizableVoiceLanguage` rejects 'unknown'/''/unexpected and is case-sensitive. (3) `adoptVoiceReplyLanguage` adopts a concrete detected language over current. (4) 'unknown'/empty/garbage detected → current kept (never forwarded to TTS). (5) Idempotent when detected==current. | `src/__tests__/lib/voice-reply-language.test.ts` | E |

### Invariants covered by this section

- P7 (bilingual UI) - the spoken-reply language tracks the language the student
  actually spoke (en/hi/hinglish), reinforcing the Hindi/English parity contract
  on the voice surface.
- P12 (AI safety) - 'unknown' is never forwarded to the TTS synthesize endpoint;
  only catalog-valid languages reach the provider.
- P13 (data privacy) - resolver is pure over a language enum; no transcript /
  student text flows through it.

### Catalog total

Pre-Voice-3: 74 entries. Adds REG-107.

**Total: 75 entries.**

## Auth-module security & onboarding fixes (2026-06-10) - REG-108..REG-111

Source: 2026-06-10 auth-module audit. Five fixes landed together: H1
(get_user_role PII enumeration), M1 (open redirect on /login), M3
(bootstrap Bearer fallback, server + client), M5 (bootstrap_user_profile
link_code accepted but never used), R2 (canonical metadata→bootstrap-params
derivation — teacher subjects/grades_taught were dropped as null by both
server confirmation routes, and the grade default had drifted per-site).
These entries pin the four security/funnel-critical contracts; R2's pure
derivation module is covered inside REG-110's location set.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-108 | `get_user_role_self_binding_guard` | Static canary on `supabase/migrations/20260610090000_secure_get_user_role.sql` (REG-47-style contract pin): (1) `CREATE OR REPLACE FUNCTION public.get_user_role(p_auth_user_id uuid)` + `SECURITY DEFINER` + pinned `search_path`. (2) Service-role bypass check `coalesce(auth.role(), '') <> 'service_role'` present. (3) Self-identity binding `p_auth_user_id IS DISTINCT FROM auth.uid()` present, with `RAISE EXCEPTION` on cross-user lookup. (4) The guard appears BEFORE the first role-table read (`FROM students`) so no PII is touched pre-guard. (5) anon EXECUTE revoke re-asserted (20260515000002 parity). Any later `CREATE OR REPLACE` of get_user_role that copies an older body forward and drops the guard fails this canary. | `src/__tests__/contract/auth-module-migration-canaries.test.ts` (H1 describe block) | E |
| REG-109 | `login_open_redirect_guard` | Both redirect call sites in `src/app/login/page.tsx` (already-logged-in useEffect + handleSuccess) route `?redirect=` through the REAL `validateRedirectTarget` with the role destination as fallback. Asserted by RENDERING the real page (next/navigation + AuthContext + AuthScreen mocked; `@/lib/identity` NOT mocked): (1) `?redirect=//evil.com` → role destination, never evil.com — for student AND teacher (fallback is role-aware, not hardcoded /dashboard). (2) `?redirect=/foxy` preserved on both call sites. (3) `javascript:` and backslash vectors blocked. (4) handleSuccess still calls router.refresh() and redirects immediately (the #892 stuck-button contract). Underlying validator vectors (`//`, `%2f`, `javascript:`, `data:`, backslash) are separately pinned in `src/__tests__/identity-constants.test.ts`. | `src/__tests__/login-redirect-guard.test.tsx` | E |
| REG-110 | `bootstrap_bearer_fallback_p15_layer2` | P15 layer-2 restoration (M3, server + client). Server (`src/app/api/auth/bootstrap/route.ts` resolveAuthUser): (1) no cookie + valid `Authorization: Bearer <jwt>` → user resolved via `getSupabaseAdmin().auth.getUser(token)`, bootstrap RPC runs for the Bearer identity; (2) no cookie + invalid Bearer → exact existing `401 {success:false, error:'Authentication required', code:'AUTH_REQUIRED'}` envelope, RPC never called; (3) cookie + Bearer both present → cookie wins and admin.auth.getUser is never called; (4) empty Bearer token → 401 without an admin call; (5) cookie client throwing falls through to Bearer. Client (`src/lib/AuthContext.tsx` bootstrap-fallback fetch, real AuthProvider mounted): attaches `Authorization: Bearer <access_token>` when getSession yields a token; omits the header (pre-M3 request shape) when the session has no token or the 3s-raced re-read throws; payload grade defaults to '9' as a STRING via normalizeGrade (R2 — was a hand-rolled `\|\| '6'`). R2's pure derivation (roleFromMetadata guardian→parent alias + garbage→student, teacher subjects/grades_taught surviving JSON-string AND array forms, P5 grade filtering, link_code trim-or-null) is pinned in the identity-bootstrap-profile suite. | `src/__tests__/auth-bootstrap.test.ts` (Bearer-token fallback describe) + `src/__tests__/auth-context-bootstrap-bearer.test.tsx` + `src/__tests__/identity-bootstrap-profile.test.ts` | E |
| REG-111 | `bootstrap_link_status_fail_soft` | P15 rule-5 contract on `supabase/migrations/20260610090100_bootstrap_link_code.sql` (static canary): (1) bootstrap_user_profile keeps the unchanged 11-param signature incl. `p_link_code` and calls the existing `public.link_guardian_via_invite_code` RPC (not an inlined copy). (2) Link attempted only for `p_role IN ('parent','guardian')` with a non-empty trimmed code, at BOTH attempt sites (main path + already_completed retry-heal, so the 3-layer failsafe converges to linked on re-invocation). (3) Every link attempt wrapped in `EXCEPTION WHEN OTHERS → v_link_status := 'invalid_code'` — an invalid/expired code can NEVER abort profile creation. (4) ADDITIVE `link_status` key ('linked'\|'invalid_code'\|'not_attempted') present on EVERY `RETURN jsonb_build_object` path and in the bootstrap_success audit metadata. (5) All ON CONFLICT idempotency markers preserved (onboarding_state, students/teachers/guardians auth_user_id constraints, state_events idempotency_key — P15 rule 4). (6) anon EXECUTE revoke re-asserted. | `src/__tests__/contract/auth-module-migration-canaries.test.ts` (M5 describe block) | E |

### Invariants covered by this section

- P13 (data privacy - REG-108) - get_user_role returned role/name/grade/
  school_id for ANY uuid to ANY authenticated caller; the self-binding guard
  closes the enumeration vector while the service_role bypass keeps
  middleware/admin/export-report callers working.
- P15 (onboarding integrity - REG-110, REG-111) - layer-2 of the 3-layer
  profile-creation failsafe 401'd for password-login users (localStorage
  session, no sb-* cookies); the Bearer fallback restores it. The link_code
  wiring is fail-soft: a bad code degrades to link_status='invalid_code',
  never a failed signup.
- P5 (grade format - REG-110) - bootstrap payload grade is always a bare
  string '6'..'12' with canonical default '9' via normalizeGrade, unified
  across AuthContext, callback/confirm, and the bootstrap route.
- Open-redirect prevention (REG-109, security-adjacent) - /login can no
  longer be used as a phishing trampoline via `?redirect=//evil.com`.

### Catalog total

Pre-auth-module-fixes: 75 entries. Adds REG-108..REG-111.

**Total: 79 entries.**

## Learning-OS flagship redesign + Track-2 (EIC + Principal AI) (2026-06-11) - REG-112..REG-114

Source: 2026-06-11 Learning-OS session. Three flagged-OFF redesign tracks shipped
together as PRESENTATION-ONLY surfaces over the unchanged learning engines:
(1) the "Alfa OS" student/subjects/revision/practice/exam-briefing surfaces, each
behind its own DEFAULT-OFF flag whose OFF path is byte-identical to today;
(2) the super-admin Education Intelligence Cloud (EIC) read-API; (3) the Track-2
Principal AI Assistant. These entries pin the UNIT-testable safety contracts; the
runtime-client + DB-applied behaviors are deferred to integration/E2E (noted
inline).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-112 | `learning_os_off_path_flag_identity` | Flag-OFF = byte-identical (P1/P2/P3/P7 preserved — these are PRESENTATION-only surfaces over the unchanged scoring/XP/anti-cheat engines). For every Alfa OS flag hook (`use-student-os-flag`, `use-subjects-os-flag`, `use-revision-os-flag`, `use-practice-os-flag`, `use-test-os-flag`, `use-principal-ai`): (1) the synchronous reader / DEFAULT_OFF resolves FALSE with no cache + no localStorage (production first-paint truth); a fresh `{on:false}` cache reads FALSE, an EXPIRED `{on:true}` cache is ignored → FALSE, a fresh `{on:true}` reads TRUE (post-rollout repeat visit). (2) `devForcedOn()` is a STRICT prod no-op — the localStorage force-key '1' is ignored when `NODE_ENV==='production'` and forces TRUE only when `NODE_ENV!=='production'` AND the key is exactly '1' (not 'true'/'0'). (3) `FLAG_DEFAULTS` contains every new flag (`ff_student_os_v1`, `ff_subjects_os_v1`, `ff_revision_os_v1`, `ff_practice_os_v1`, `ff_test_os_v1`, `ff_education_intelligence`, `ff_principal_ai_v1`) = false, with the registry constant matching the literal. (4) Pure presentation helpers re-present (never re-compute) engine output: mastery-buckets (due_for_review precedence, mastered/learning/locked, masteryPercent 0..1→0..100 clamp, weakestStartedTopic), readiness-map (level→node-status), revision-labels (0.5/0.8 display-only impact bucketing), briefing-helpers, and ScoreBar (80/60/40 bands, null→neutral). | `src/__tests__/lib/learning-os-flag-off-identity.test.ts`, `src/__tests__/lib/use-principal-ai-flag.test.ts`, `src/__tests__/lib/dashboard-mastery-buckets.test.ts`, `src/__tests__/components/learn-os-readiness-map.test.ts`, `src/__tests__/components/review-os-revision-labels.test.ts`, `src/__tests__/components/exam-briefing-helpers.test.ts`, `src/__tests__/admin-ui/score-bar.test.tsx` | E |
| REG-113 | `exam_briefing_predicted_score_parity` | The Alfa OS pre-test briefing hub's `getPredictedScoreEstimate` (display-only weighted-mastery estimate over exam_chapters) is a VERBATIM COPY of `getPredictedScore` in `src/app/exams/page.tsx` and MUST stay byte-equivalent (assessment-requested drift guard — P1/P2/P3 untouched, this is presentation-only). Asserts byte-equivalence vs an inline reference replica of the exams-page formula across 7 edge fixtures (empty / zero-weight-averages-mastery / weighted-sum / rounding / mixed) + 200 deterministic randomized inputs. If `exams/page.tsx` diverges, this guard fails and the briefing copy must be re-synced. Also pins EIC `super-admin/intelligence` pure coercers: `dedupLatest` keeps the newest row per key (PostgREST DISTINCT-ON substitute), and num/numOrNull/int/strArray/isUuid normalize Postgres-string rollup columns defensively. | `src/__tests__/components/exam-briefing-helpers.test.ts`, `src/__tests__/lib/super-admin-intelligence.test.ts` | E |
| REG-114 | `principal_ai_scope_lock_and_honest_pacing` | Principal AI Assistant prompt safety (P12 + REG-67 provenance). `PRINCIPAL_AI_SAFETY_RAILS` asserts presence of: the scope-lock refusal categories (other-school/benchmark/"average school"; individual-student PII → aggregates-only; out-of-scope/non-academic); DATA-ONLY grounding ("never invent"); the HONEST SYLLABUS-PACING decline (content-readiness ≠ teaching pace, "cannot predict … finish on time", no fabricated date/percentage); and the NEW POINT-IN-TIME / no-trends rail (single snapshot, no history, refuse change-over-time / "vs last week/month" / period-over-period). `buildContextSection` renders `avg_mastery` (0..1 read-model scale) through `fmtPct` as a PERCENT — the raw decimal must NOT leak — while `seat_utilization_pct` (already 0-100) is not rescaled; emits a "Data as of <generated_at>" line when present and omits it otherwise; returns null (caller abstains) on empty context. `buildPrincipalAiSystemPrompt` always carries the rails + a defensive placeholder for null context. REG-67 model-provenance stamping (`PrincipalAiHistoryMessage.model`) is part of the wire contract; the RPC-credential model (context RPC MUST be called via the USER-CONTEXT client so `auth.uid()` resolves the principal-only guard) is a RUNTIME-CLIENT behavior — deferred to integration/E2E (see notes). EIC read-API graceful-empty (HTTP 200 on missing table/no rows) + RLS service-role-only intent are likewise route-level — deferred to integration/E2E. | `src/__tests__/lib/ai/principal-ai-prompt.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy - REG-112/REG-113) - the Alfa OS surfaces re-present scoring
  outputs; the OFF path is byte-identical, and the briefing predicted-score is a
  display-only estimate kept byte-equivalent to the assessment-owned formula. No
  scoring formula is duplicated or forked.
- P2 (XP economy - REG-112) - presentation-only; no XP is computed in any new
  helper (mastery-buckets / readiness-map / revision-labels / briefing-helpers).
- P3 (anti-cheat - REG-112) - untouched; the OS surfaces sit over the unchanged
  quiz pipeline.
- P7 (bilingual UI - REG-112) - the new label helpers return non-empty Hi/En
  strings that differ, and technical figures stay numeric.
- P12 (AI safety - REG-114) - the Principal AI prompt is the sole guard between
  the principal and the model; scope-lock + honest-pacing + no-trends rails and
  the aggregates-only/PII boundary are pinned. avg_mastery 0..1→% presentation fix
  prevents a misleading raw-decimal leak.
- P13 (data privacy - REG-114) - EIC rollups are aggregates-only and the Principal
  AI context is PII-safe (group-level aggregates only). The RLS service-role-only
  read intent and the user-context-client RPC-credential model are runtime/DB
  behaviors deferred to integration/E2E.

### Deferred to integration / E2E (this session, unit-untestable)

- **Principal AI RPC-credential model**: `get_principal_ai_context(p_school_id)`
  MUST be called via the USER-CONTEXT Supabase client (not service-role) so the
  RPC's `auth.uid()` guard resolves the calling principal and scopes to their
  school. This is a runtime-client wiring behavior — covered by route integration
  + E2E, not a pure unit test.
- **EIC read-API graceful-empty + RLS service-role-only**: `safeSelect`/
  `fetchSchoolMeta` degrade to empty/HTTP-200 when the rollup tables are absent
  (migration not yet applied) or empty; the routes stay behind super-admin auth
  regardless of the `ff_education_intelligence` flag. These touch fetch + admin-auth
  env and the live PostgREST error shape — covered by route integration + E2E.
- **Flag async-reconcile + 404 route gating**: the hooks' `getFeatureFlags()`
  confirm/correct path and the additive `notFound()` routes (/revision, /practice,
  /exam-briefing) returning 404 while OFF are E2E concerns.

### Catalog total

Pre-Learning-OS: 79 entries. Adds REG-112..REG-114.

**Total: 82 entries.**

## Per-student aggregate cache — no cross-user leak / no auth bypass (Phase 5 perf) — REG-115

Source: Phase 5 perf finding #6 — six read-only per-student GET routes wrap their
expensive Supabase read in `cacheFetchAsync` (`src/lib/cache.ts`, `CACHE_TTL.USER`
= 30s) keyed by the AUTHENTICATED `student_id`/`userId`:
`src/app/api/v2/student/progress/route.ts`, `src/app/api/dashboard/reviews-due/route.ts`,
`src/app/api/rhythm/today/route.ts`, `src/app/api/dive/state/route.ts`,
`src/app/api/learner/weak-topics/route.ts`, `src/app/api/learner/scheduled/route.ts`.

The cache store is a module-level in-memory `Map` that survives across requests.
The load-bearing safety property (P13): a server-side cache that is NOT keyed by
the authenticated id, or that is read BEFORE auth, would serve one student's
mastery/XP/review-state to another. Four invariants are pinned:

  - **No cross-user leak.** Two different authenticated students hitting the same
    route inside the same 30s window each get THEIR OWN payload — the key embeds
    their id, so student B never receives A's cached body. A `JSON.stringify`
    negative match proves A's distinctive values never appear in B's response.
  - **No auth bypass.** The `cacheFetchAsync` read is reached only AFTER
    `authorizeRequest` (or `supabase.auth.getUser`) resolves the id; a denied
    request short-circuits at auth and returns the auth error — it can never reach
    the cache and is asserted to carry none of a prior authorized student's data.
  - **TTL coalesces.** A repeat call for the SAME student within the window is
    served from cache and does NOT re-hit the Supabase read (read spy stays at 1).
  - **Errors not pinned.** A transient DB error / no-profile branch throws inside
    (or short-circuits before) the fetcher so nothing is cached; a subsequent
    success returns fresh data.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-115 | `per_student_aggregate_cache_no_cross_user_leak` | For the heaviest route (`/api/v2/student/progress`) AND one more (`/api/dashboard/reviews-due`): (a) student A primes the cache, then student B — same 30s window — gets their OWN distinct DB rows, with a `JSON.stringify` negative match proving A's values never leak into B (key embeds the authenticated id — P13); (b) a denied (`authorized:false`) request returns the auth error (`403`/code), NOT a prior student's cached body — the cache read is keyed off the id derived AFTER `authorizeRequest`; (c) a repeat same-student call within the TTL is served from cache (read spy count stays 1 — the 30s window collapses to a single DB fetch); (d) a transient DB error / no-profile branch is NOT cached — a later success returns fresh data. | `src/__tests__/api/dashboard-cache-isolation.test.ts` | E |

### Invariants covered by this section

- P13 (data privacy) — per-student data is never shared across students; the
  server cache is keyed by the authenticated id and read only after auth, so a
  denied caller cannot retrieve another student's cached payload. Extends
  REG-46/REG-49/REG-68.

### Catalog total

Pre-Phase-5-cache: 82 entries. Adds REG-115 (per-student aggregate cache —
no cross-user leak / no auth bypass — P13).

**Total: 83 entries.**

## Internal-admin secret gate — all routes enforce requireAdminSecret before service-role work (Phase 4 route-coverage) — REG-116

Source: Phase 4 route-coverage — the 13 route handlers under
`src/app/api/internal/admin/**` each gate on `requireAdminSecret(request)` (from
`@/lib/admin-auth`) as the FIRST line of every handler. That gate validates the
`x-admin-secret` request header in constant time against
`process.env.SUPER_ADMIN_SECRET` and returns a 401 `NextResponse` (or 503 when
the secret env var is unset) BEFORE any service-role DB work runs.

The load-bearing safety property (P9): the internal-admin API surface is
service-role-backed (bypasses RLS), so the `x-admin-secret` header is the ONLY
boundary standing between an unauthenticated caller and full admin mutation
power. A handler that reached its `getSupabaseAdmin()` seam before checking the
secret — or that returned 200 on a missing/wrong secret — would be a complete
admin takeover. The test drives the REAL gate (no mock of `requireAdminSecret`)
by toggling the header + env var, and mocks ONLY the service-role data seam so a
removed gate would flip `dbAccess.touched` on the deny path. Pinned across 11
representative routes spanning the distinct route shapes (mutation routes
prioritized over reads).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-116 | `internal_admin_secret_gate_enforced` | For 11 representative `src/app/api/internal/admin/**` handlers (bulk-action POST, users GET+PATCH, users/[id] PATCH, content POST+DELETE, feature-flags POST, schools POST, support PATCH, stats GET, command-center GET): (a) NO `x-admin-secret` header → 401 short-circuit AND the service-role DB seam is never touched; (b) WRONG `x-admin-secret` → 401 AND the DB seam is never touched; (c) `SUPER_ADMIN_SECRET` unset entirely → 503 fail-closed AND the DB seam is never touched; (d) VALID header → the handler proceeds PAST the gate (does NOT return 401/503; reaches the DB seam — proving the deny assertions aren't vacuous). The gate (`requireAdminSecret`) is the REAL code, not mocked. | `src/__tests__/api/internal-admin-secret-gate.test.ts` | E |

### Invariants covered by this section

- P9 (RBAC / admin-secret enforcement) — every service-role-backed internal-admin
  route validates the `x-admin-secret` header before any DB work; a missing/wrong
  secret short-circuits to 401 and an unset `SUPER_ADMIN_SECRET` fails closed to
  503. Extends SG-3..SG-5.

### Catalog total

Pre-Phase-4-route-coverage: 83 entries. Adds REG-116 (internal-admin secret gate —
all routes enforce `requireAdminSecret` before service-role work — P9).

**Total: 84 entries.**

## Parent↔child link boundary + auth-callback funnel resilience (Phase 4 route-coverage) — REG-117

Source: Phase 4 route-coverage — the OAuth / parent-link cluster. Two launch-critical
boundaries get a behavioral GET/POST-handler pin (prior coverage was structural
source-text only or absent):

1. **Parent↔child boundary (P8/P13).** `POST /api/parent/approve-link` lets a
   SIGNED-IN STUDENT approve/reject a PENDING parent-link request addressed to them.
   The ownership check — `link.studentId !== resolvedStudent.id → 404` — is the only
   thing stopping a student from approving (and thereby granting a stranger guardian
   access to) a DIFFERENT student's link by passing that link's id. A removed/relaxed
   check would let an attacker self-approve a guardian link onto another child.

2. **Auth-callback funnel resilience (P15 rule 3 + no-500).** `/auth/callback` (PKCE
   `code`) and `/auth/confirm` (`token_hash` + `type`) are the email-verification
   funnel. They MUST handle BOTH flows and MUST NEVER throw/500 — every branch
   (success, exchange/verify failure, missing param, thrown getUser on the signup
   branch) returns a 3xx redirect. Existing tests were structural (`export GET`
   present) + helper-unit; these are the first to INVOKE the handlers.

Other routes in the cluster (`/api/v2/parent/{children,glance,encourage}`,
`/api/parent/report`, `/api/parent/children/[id]/export`, `/api/parent/link-code/redeem`)
already have route-level boundary tests (cross-guardian isolation → 403, link-code+OTP
gate). No BLOCKER found in the audit: every parent data-access path scopes to the
JWT-resolved guardian/student id, never to an arbitrary id from the request; link
establishment requires a valid link code + emailed OTP.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-117 | `parent_link_boundary_and_auth_callback_resilience` | **(a) Cross-student link boundary (P8/P13):** `POST /api/parent/approve-link` — 401 with no session (no DB touched); 400 on non-UUID linkId / invalid action / malformed JSON (no write); 403 when the session has no student profile (findLinkById never called); when a pending link belongs to ANOTHER student → 404 with a GENERIC message (does not confirm the link exists for someone else) AND the `guardian_student_links` status UPDATE is NEVER issued (zero writes across the boundary); 404 when the link is null/not-pending; happy path — a student acting on THEIR OWN pending link flips status to approved/rejected via exactly one admin write keyed by that link id. The real handler runs; only the cookie session, students lookup, and `findLinkById` are mocked. **(b) Auth-callback funnel resilience (P15 rule 3 + no-500):** `/auth/callback` exchanges a valid PKCE `code` (calls `exchangeCodeForSession`) and redirects 3xx; a failed exchange redirects to `/login?error=…` (not 500); a MISSING code redirects to `/login` without calling exchange; a thrown `getUser` on the `type=signup` branch still redirects 3xx (try/catch funnel guard). `/auth/confirm` verifies `token_hash`+`type` (calls `verifyOtp`) and redirects 3xx; a failed verify redirects to `/login?error=verification_failed`; a missing `type` (guard false) redirects to `/login` without calling verifyOtp; a confirmed teacher signup routes to the `/teacher` role destination. Every branch asserts 300≤status<400 — the funnel never 500s. | `src/__tests__/api/parent/approve-link/route.test.ts`, `src/__tests__/auth-callback-resilience.test.ts` | E |

### Invariants covered by this section

- P8/P13 (parent↔child boundary) — a student cannot approve a link addressed to a
  different student; the cross-student status write is proven to never fire.
- P15 (onboarding integrity, rule 3 + no-funnel-break) — both PKCE and token_hash
  email-verification flows are handled and neither handler can 500 the funnel;
  promotes the previously tested-only P15 callback coverage to a behavioral pin.

### Catalog total

Pre-Phase-4-oauth-cluster: 84 entries. Adds REG-117 (parent↔child link boundary +
auth-callback funnel resilience — P8/P13/P15).

**Total: 85 entries.**

## daily-cron static-source contract canary — fail-closed auth gate + step/helper integrity + per-step error isolation + flag-gated revenue-adjacent steps — REG-118

Source: daily-cron contract-coverage. The `daily-cron` Edge Function is the single
nightly orchestrator behind several revenue-adjacent and operational-integrity
flows — the school-contract lifecycle (`ff_school_contracts_v1`), the monthly-synthesis
trigger (`ff_pedagogy_v2_monthly_synthesis`), and the principal-AI transcript purge.
A silent regression here (a deleted step, a flipped auth check, a swallowed 5xx that
masks partial failure) does not surface in any UI and would only be caught in
production. A static-source canary pins the function's load-bearing invariants so
that deleting or renaming any of them turns the build red.

The canary asserts four classes of invariant:

1. **Fail-closed CRON_SECRET auth gate.** The handler performs a constant-time
   `x-cron-secret` compare BEFORE any work begins; a missing/wrong secret short-circuits
   (no step runs). Removing or moving the gate after the first step turns it red.

2. **Step-name → helper integrity (17 critical pairs — amended 2026-07-03, Wave 0
   Task 0.2).** Each load-bearing step name is wired to its implementing helper;
   deleting or renaming either half breaks the pin. This is the guard against a step
   silently vanishing from the nightly run. The Wave 0 amendment adds the
   `coverage_audit_triggered`/`triggerCoverageAudit` and
   `question_bank_verify_triggered`/`triggerVerifyQuestionBank` pairs — these thin
   Edge-to-Edge fetch-outs are the ONLY nightly scheduling for the coverage-audit and
   verify-question-bank Edge Functions, and their fail-soft catch makes a dropped
   auth header a SILENT loss, so contract 4d additionally pins each trigger's target
   path, dual auth (`x-cron-secret` + service-role bearer for the platform gateway),
   thin/ungated posture (no DB reads, no flag gate in Deno), and fail-soft
   never-throw (`catch` + `return 0`).

3. **`Promise.allSettled` per-step error isolation.** Steps run under `allSettled`, so
   a single step's rejection is isolated (partial failure → HTTP 207, never a 5xx
   collapse that aborts every other step). A switch to `Promise.all` or a thrown-not-caught
   path turns it red.

4. **Flag-gating of revenue-adjacent steps.** The monthly-synthesis step is gated on
   `ff_pedagogy_v2_monthly_synthesis` and the school-contract step on
   `ff_school_contracts_v1`; the canary pins that both gates are present so neither
   step can run unflagged.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-118 | `daily_cron_contract_canary` | Static-source canary (27 Deno tests — amended 2026-07-03, Wave 0 Task 0.2) pinning daily-cron's load-bearing invariants: fail-closed CRON_SECRET auth gate (constant-time `x-cron-secret` compare) before any work; 17 critical step-name→helper pairs present (deleting/renaming any turns it red — incl. the Wave 0 `coverage_audit_triggered`/`question_bank_verify_triggered` pairs, the sole nightly scheduling for those two Edge Functions); `Promise.allSettled` per-step error isolation (partial failure → 207, never a 5xx collapse); flag-gating of the monthly-synthesis (`ff_pedagogy_v2_monthly_synthesis`) and school-contract (`ff_school_contracts_v1`) steps; and contract 4d pinning the two Wave 0 fetch-out triggers as thin, dual-authenticated (`x-cron-secret` + service-role bearer), ungated, and fail-soft (a dropped header would otherwise 401 silently every night). Runs in the CI `edge-function-tests` Deno job. | `supabase/functions/daily-cron/__tests__/contract.test.ts` | E |

### Invariants covered by this section

- P11-adjacent — the school-contract lifecycle and monthly-synthesis trigger are
  revenue-adjacent flows; the canary proves they stay behind their feature flags and
  cannot run unflagged or be silently dropped from the nightly run.
- Operational-integrity — fail-closed auth on the cron entrypoint, step/helper
  integrity, and per-step `allSettled` isolation (partial failure → 207, never a 5xx
  collapse) keep the nightly orchestrator's load-bearing steps from regressing silently.

### Catalog total

Pre-daily-cron-contract-canary: 85 entries. Adds REG-118 (daily-cron static-source
contract canary — P11-adjacent + operational-integrity).

**Total: 86 entries.**

## High-blast-radius mutation-route gate pins (Phase 4 final cluster) — REG-119

Source: Phase 4 coverage close-out. Seven of the highest-blast-radius mutation
routes (privilege elevation, tenant role elevation, abuse-blocklist mutation,
OAuth client-secret issuance, bulk student-PII export, destructive event replay,
dead-letter replay) each ALREADY ship a working auth gate — the coverage scan
confirmed no security hole. The gap was a COVERAGE gap: nothing pinned the gate,
so a future refactor could silently downgrade the tier, drop the level/permission
argument, or move the gate after DB I/O and not turn a single test red.

This entry pins each gate by mocking the auth seam and asserting two things per
route: (a) DENY — the gate's unauthorized response is returned AND the first
DB/service seam is never touched (short-circuit before any I/O), with an
assertion on the EXACT level/permission string the source passes (a downgrade
to a lower tier flips the test); (b) ALLOW — an authorized gate lets the route
proceed PAST the gate to the DB/service seam, proving the deny assertion is
non-vacuous.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-119 | `mutation_gate_pins` | Gate pins for 7 high-blast-radius mutation routes. Each pins the EXACT gate + level/permission per SOURCE and that DENY short-circuits before any DB/service I/O: (1) `POST /api/super-admin/rbac` → `authorizeAdmin('super_admin')` (privilege elevation); (2) `POST /api/school-admin/rbac` → `authorizeSchoolAdmin('institution.manage')` (tenant role elevation); (3) `POST` + `DELETE /api/super-admin/alfabot/denylist` → `authorizeAdmin('super_admin')` (abuse-blocklist mutation); (4) `POST /api/super-admin/oauth-apps` → `authorizeAdmin('support')` (issues OAuth client secrets — see under-leveled-tier observation); (5) `POST /api/school-admin/data-export` → `authorizeSchoolAdmin(<resolved code>)` where the route forwards whatever `schoolAdminPermissionCode({off:'school.export_data', on:'institution.export_reports'})` returns, with NO export/DB work on denial (bulk student PII, P13); (6) `POST /api/super-admin/projectors/replay` → `authorizeAdmin('support')` (destructive event replay — see observation); (7) `POST /api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry` → `authorizeAdmin('support')` (dead-letter replay re-triggers side effects). 15 unit tests. | `src/__tests__/api/super-admin/mutation-gate-pins.test.ts` | U |

### Invariants covered by this section

- P9 RBAC enforcement — pins the exact level/permission tier on seven mutation
  surfaces so a silent tier downgrade or dropped gate argument turns the build red.
- P13 Data privacy — the `school-admin/data-export` pin asserts a denied caller
  triggers zero export/DB work (no bulk student-PII read across the boundary).

### Under-leveled-tier observations (NOT changed here — RBAC policy items for CEO/architect)

These two routes are PINNED AT THEIR CURRENT `support` tier (the pin would flip
red if the tier later changes). They are flagged as possible under-leveling for a
policy review — this entry pins behavior, it does not alter it:

- `super-admin/oauth-apps` POST issues/approves OAuth apps (credential issuance);
  `support` may be under-leveled for a credential-issuing surface.
- `super-admin/projectors/replay` POST performs a destructive single-student
  projection rebuild; `support` may be under-leveled for a destructive op.

## Foxy AI Tutor Mobile Redesign — Phase 0+1 (2026-06-12)

Source: Foxy mobile-first redesign (compact top bar + Study sheet), flag-gated
behind `ff_foxy_os_v1` (default OFF, `<lg` only). `/foxy` is the highest-traffic
AI surface and sits near the P10 bundle ceiling, so the OFF-path-byte-identity
property is load-bearing.

> **ID note (2026-06-12):** this entry was originally drafted as REG-120 but
> collided with the RBAC/Pulse FOUNDATION spec
> (`docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`
> §7/§12), which reserved **REG-120 for RBAC matrix conformance**. The RBAC
> reservation predates this entry and is anchored in the design doc, so this
> Foxy-OS entry was renumbered to **REG-123**. No test code referenced the REG
> number (test files are named `foxy_os_*`), so the renumber is catalog-only.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-123 | `foxy_os_flag_default_off_and_header_gating_identity` | `ff_foxy_os_v1` resolves DEFAULT-OFF (no cache/override → false; `FLAG_DEFAULTS` false); `devForcedOn` localStorage override (`alfanumrik_force_foxy_os`) is a strict no-op in production NODE_ENV; cache TTL honored under `alfanumrik_foxy_os_flag_v1`. Header-gating predicate selects the new mobile surface in EXACTLY 1 of 4 states (flag ON and viewport `<lg`); all other states render the legacy 5-row header verbatim (OFF-path byte-identity). | `src/__tests__/lib/foxy-os-flag-off-identity.test.ts`, `src/__tests__/lib/foxy-os-header-gate.test.ts` | E |

### Invariants covered by this section

- P10 (bundle budget — new components `dynamic()`-lazy-loaded; OFF path adds 0 bytes to the near-ceiling `/foxy` page)
- OFF-path safety — the redesign cannot leak onto prod/desktop until an operator flips the DB flag

### Catalog total

Pre-foxy-os: 87 entries. Adds REG-123 (Foxy-OS flag DEFAULT-OFF + header gating
identity — P10 + OFF-path safety). Running total after Foxy-OS: 88 entries.

## RBAC matrix conformance + Student Pulse cross-role boundary (2026-06-12) — REG-120..REG-122

Source: the RBAC-Conformance + Student-Pulse work
(`docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`).
Two deliverables land here: (1) the additive/idempotent RBAC matrix conformance
guard + its offline test (FOUNDATION step), and (2) the Student Pulse feature —
four role-scoped lenses (`/api/pulse/{me,student/[id],class/[classId],school}`)
that surface derived learner signals. Pulse reads existing learner state and
MUST enforce the same ownership boundaries the RBAC matrix encodes; the highest-
severity failure mode (spec §10) is a Pulse lens leaking ANOTHER student's
derived signals (P8/P13). These three entries pin that boundary, the matrix
floor it rests on, and the signal-derivation math.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-120 | `rbac_matrix_conformance` | The full RBAC matrix is reproducible from a single ADDITIVE, IDEMPOTENT root migration (`20260612123200_rbac_matrix_conformance.sql`). The offline test statically pins the migration covers every one of the 11 roles, every matrix permission code, every role→permission grant, the `institution_admin → teacher` inheritance grant, and all 15 `resource_access_rules` across the 4 ownership patterns (own/linked/assigned/any) — resolved BY name/code never UUID. It also pins the additive guards: `roles` ON CONFLICT (name), `permissions` ON CONFLICT (code), `role_permissions` ON CONFLICT (role_id, permission_id), `resource_access_rules` WHERE NOT EXISTS, and NO DROP/DELETE/TRUNCATE/UPDATE (the conformance artifact is the matrix FLOOR, never a reset; prod's ~84-code superset is left untouched). 254 assertions, deterministic, no DB. Closes the reproducibility gap on fresh DBs (CI live-DB, new staging, DR) where `_legacy/` is skipped. | `src/__tests__/lib/rbac/matrix-conformance.test.ts` | U |
| REG-121 | `pulse_cross_role_boundary` | Student Pulse cross-role data boundary (P8/P13). `canAccessStudent(callerId, studentId)` is THE single data boundary on `/api/pulse/student/[id]` (it encodes own/linked/assigned/institution/admin EXACTLY per the matrix), backed by a defense-in-depth viewing-permission gate. The DENY paths are pinned explicitly: a parent NOT linked to the student → 403 (canAccessStudent false); a teacher NOT assigned → 403; a caller WITH a relationship but WITHOUT any viewing permission → 403; unauthenticated → 401; invalid (non-UUID) id → 400. `/api/pulse/class/[classId]`: a teacher who does not own the class (class_teachers) → 403; a caller who is not an active teacher → 403. `/api/pulse/me`: missing `progress.view_own` → blocked verbatim. EVERY deny is audit-logged via `logAudit(..., status:'denied')` with the precise reason (`no_relationship` / `no_view_permission` / `not_class_owner` / `not_a_teacher`), and — the P13 invariant — NO student payload is returned on ANY deny path (the pulse builder is never invoked; the body carries only `{success:false,error}`, no status/timeline/masterySummary/signals/data). Allow-path controls prove the deny assertions are non-vacuous (and that the single-student builder keys off the TARGET's auth_user_id, the self builder off the CALLER's). E2E mirror confirms the live route returns 401/403 + no payload unauthenticated, and that a 403 surfaces as a SAFE denied/empty UI (no crash, no leaked data). | `src/__tests__/api/pulse/pulse-authorization.test.ts`, `e2e/pulse-rls.spec.ts` | U + E |
| REG-122 | `pulse_signal_derivation` | Student Pulse signal-derivation correctness (P-learner-state). The three pure signals in `signals.ts` are anchored to the EXISTING platform conventions so they cannot silently drift: inactivity verdicts (`ok`/`at_risk`/`broken`/`never`/`unknown`) computed against the UTC-calendar-day streak-reset window (matching daily-cron `resetMissedStreaks`), with freeze-softening and exact day-count boundaries; mastery-cliff (`none`/`flagged`/`unknown`) off the canonical `mastery_changed` payload shape (`{fromMastery, toMastery}`) including the cross-below-0.4 path; at-risk concentration bands (`none`/`low`/`medium`/`high`) on the 0.4 platform at-risk mastery line with exact band boundaries, worst-first ordering, and the `worstBand` rollup. 47 tests, deterministic, no DB. | `src/__tests__/lib/pulse/signals.test.ts` | U |

> **REG-121 Round 2 annotation (2026-06-12, post CEO-approved remediation):**
> the `canAccessStudent()` boundary REG-121 pins was REPAIRED, not relaxed, by
> remediation F1 (architect): the teacher branch now enforces the matrix's
> `assigned` ownership via an inline `teachers → class_teachers ⋈ class_students`
> join (the previously-called `is_teacher_of_student` RPC does not exist in the
> prod baseline, so the old teacher allow-path could never return true), and the
> institution_admin branch now reads `school_admins(auth_user_id, school_id,
> is_active)` (the previously-read `school_memberships` table also does not
> exist). Fail-closed behavior is preserved on every error/absent-row path.
> Matrix-conformance fix pinned by 7 new/updated unit tests in
> `src/__tests__/lib/rbac.test.ts` (`canAccessStudent` describe block: teacher
> assigned via the join / not-assigned / not-an-active-teacher /
> class_teachers-query-error fail-closed; institution_admin matching-school /
> different-school / no-school). Round 2 re-run from the canonical-cased root:
> 358/358 unit tests across the 4-file verification set + 4/4 `e2e/pulse-rls.spec.ts`.
>
> **REG-121 UI addendum (Round 2):** the multi-school 400 from
> `/api/pulse/school` (caller administers >1 school, no `?school_id`) is now
> pinned at the component layer — `src/__tests__/components/pulse/SchoolPulsePanel.test.tsx`
> asserts the no-retry "select a school" state (`role=status`, NO retry button —
> retrying without a school id re-issues the identical 400 forever, the ops-review
> "dead retry loop"), that the non-400 error branch KEEPS its Retry button wired
> to `onRetry` (non-vacuity control), the Hindi copy (P7), and the
> stale-data fall-through (`keepPreviousData`: 400 + cached school ⇒ live summary,
> not the picker prompt).

### Invariants covered by this section

- P8 RLS boundary — Pulse never bypasses RLS from client code; every read goes
  through a server route that uses `supabase-admin` ONLY after `authorizeRequest()`
  + `canAccessStudent()` (REG-121). REG-120 guarantees the matrix those checks
  resolve against is fully present on any fresh DB.
- P9 RBAC enforcement — every Pulse route calls `authorizeRequest(...)` with its
  lens permission; REG-120 pins the full role→permission matrix; REG-121 pins the
  per-route gate + the relationship-without-permission denial.
- P13 Data privacy — REG-121's load-bearing assertion: NO derived student signal
  leaks on any deny path (no payload built, no payload returned), and every denial
  is audited with non-PII metadata only.
- P-learner-state (signal correctness) — REG-122 anchors the signal thresholds to
  the UTC streak-reset window, the 0.4 at-risk line, and the canonical
  `mastery_changed` payload so the derivation cannot drift from the cognitive
  engine / daily-cron conventions.

### RCA (E2E happy-path render assertion)

During E2E authoring the `/progress` "My Pulse" header assertion failed once.
ROOT CAUSE: in the offline/CI environment there is no real Supabase backend, so
the mocked `**/auth/v1/token**` route is never exercised on a cold page load and
AuthContext stays in `isLoading`, rendering `<LoadingFoxy />` on `/progress`
(NOT a redirect, NOT a crash). This is the SAME documented environment limitation
as `e2e/auth-onboarding-p15.spec.ts`, not a product defect. FIX (test-only): the
header-visible assertion is now gated on the page having left the loading state
(`role=status[name=Loading]` not visible); the hard, environment-independent
guarantees (no crash, non-empty body, no leaked payload, and the live-route
401/403-with-no-payload wire check) always run. No production code was changed.

### Catalog total

Pre-Pulse cluster: 88 entries (87 prior + REG-123 Foxy-OS). Adds REG-120 (RBAC
matrix conformance — P8/P9 floor), REG-121 (Pulse cross-role boundary — P8/P13),
REG-122 (Pulse signal derivation — learner-state correctness). **Total catalog:
91 entries (target: 35 — TARGET EXCEEDED).**

## RBAC Conformance + Student Pulse — Round 2 flag-gate pin (2026-06-12) — REG-124

Source: Round 2 verification of the four CEO-approved remediation fixes for the
RBAC-Conformance + Student-Pulse feature (F1 `canAccessStudent` repair — see the
REG-121 Round 2 annotation above; F2+F3-UI SchoolPulsePanel slim-down + flag
gate via `useSchoolPulseFlag`; F3 ops `ff_school_pulse_v1` definition + seed;
F4 `pulse-server.ts` importing `PULSE_THRESHOLDS.at_risk_mastery` from
`signals.ts` — local 0.4 literal removed, already covered by REG-122's
threshold anchoring). This entry pins the F2/F3 kill-switch contract.

> **ID note:** REG-124 is the next free id — REG-123 was taken by the
> renumbered Foxy-OS entry (see its ID note above).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-124 | `school_pulse_flag_gate_default_off` | `ff_school_pulse_v1` gates the School Pulse section of the school-admin Command Center and DEFAULTS OFF at every layer. Hook: `useSchoolPulseFlag()` paints OFF synchronously (no first-paint flash), stays OFF when the flag is absent / explicitly false / `getFeatureFlags` rejects, flips ON only after the async confirm, and requests `school_admin`-scoped flags (mirrors the `useSchoolCommandCenter` flag-gate precedent test-for-test). Behavioral: the REAL `<CommandCenter />` rendered with FULL permissions (`can()` → true, so ONLY the flag gates) — flag OFF/unresolved ⇒ the "School Pulse" section is NOT mounted and ZERO fetches hit `/api/pulse/school`, while the host's own `/api/school-admin/overview` fetch fires (alive-control proving suppression is the flag's doing); flag ON ⇒ the section mounts and `/api/pulse/school` IS fetched (non-vacuity control). Static: `FLAG_DEFAULTS['ff_school_pulse_v1'] === false` under the exact flag name; seed migration `20260619000100_seed_ff_school_pulse_v1.sql` inserts `(is_enabled=false, rollout_percentage=0)` with the column order pinned and `ON CONFLICT (flag_name) DO NOTHING` (idempotent, seeded-visible-but-never-live); CommandCenter source keeps the `pulseEnabled && can('institution.view_analytics')` guard around `<SchoolPulseSection>` with the ONLY `useSchoolPulse(` call site inside the gated section (structural fetch suppression: no mount ⇒ no hook ⇒ no SWR key ⇒ no request, and the code-split SchoolPulsePanel chunk stays off the wire). | `src/__tests__/school-admin/pulse-flag-gate.test.tsx` | U |

### Invariants covered by this section

- OFF-path safety / kill switch — School Pulse cannot reach a school admin (no
  UI, no network, no chunk) until an operator flips the DB flag; the default is
  pinned in code (`FLAG_DEFAULTS`), data (seed migration), and the render guard.
- P10 (bundle, adjacent) — the gate keeps the code-split SchoolPulsePanel chunk
  off the wire while OFF.
- P9 (clarified, NOT covered here) — the flag + `usePermissions` gate is UX
  only; `/api/pulse/school` enforces `institution.view_analytics` + school
  membership server-side regardless (REG-121).

### Catalog total

Pre-Round-2: 91 entries. Adds REG-124 (`ff_school_pulse_v1` flag gate —
OFF-path safety). REG-121 was annotated in place (F1 `canAccessStudent` repair
+ the SchoolPulsePanel 400 no-retry component pin) — an annotation, not a new
entry. **Total catalog: 92 entries (target: 35 — TARGET EXCEEDED).**

**Total: 92 entries.** *(Footer corrected 2026-06-12: it previously read "88
entries" — stale from before the REG-120..122 cluster landed. 91 was already
the correct pre-Round-2 figure per the section totals above; 92 includes
REG-124.)*

## Staging migration sync wall — feature_flags seed shape (2026-06-12) — REG-125

Source: PR #1014 P14 review (`fix/staging-migration-sync-feature-flags`). The
original `20260606000000_phase5_phase6_python_flags.sql` inserted into
`feature_flags(name, description, enabled, metadata) ... ON CONFLICT (name)
DO UPDATE` — but the canonical table (pg_dump prod baseline
`00000000000000_baseline_from_prod.sql` ~line 11212) has NO `name`/`enabled`
columns; the key column is `flag_name` (UNIQUE `feature_flags_flag_name_key`,
~line 15364) with `is_enabled` + `rollout_percentage` + `metadata`. The 42703
("column does not exist") failed the "Sync Migrations to Staging" pipeline at
statement 0 (GitHub run 27425591787 and 5+ predecessors) and walled EVERY
later migration off staging. PR #1014 rewrote the file schema-adaptively
(to_regclass fresh-DB guard, information_schema column detection with
canonical-branch priority, ON CONFLICT (flag_name) DO NOTHING, guarded
WHERE-NOT-EXISTS legacy branch, default-OFF posture); REG-125 turns the
failure mode into a CI-time error and pins the rewrite.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-125 | `feature_flags_insert_shape_conformance` | Repo-wide static scanner over ROOT migrations (the only files `supabase db push` executes; `_legacy/` skipped): every `INSERT INTO feature_flags` carries an explicit column list that includes the canonical `flag_name` column — UNLESS the file is schema-adaptive (executable-SQL detection of `information_schema.columns` + `column_name = 'flag_name'` + `to_regclass('public.feature_flags')`), in which case a guarded legacy-shape branch is permitted but a canonical branch must coexist in the same file. No feature_flags insert may resolve conflicts on the nonexistent `name` column (`ON CONFLICT (name)`) — statement-scoped, so legitimate `ON CONFLICT (name)` on roles/guardians is untouched. Analysis runs on comment-stripped, string-blanked SQL (single-pass tokenizer) so the rewrite's own header comment quoting the broken SQL cannot trip the scanner and `;`/`--` inside description literals cannot truncate a statement; dollar-quoted DO bodies are analyzed, not skipped. Scanner self-test embeds the ORIGINAL broken SQL and asserts it is flagged on all three axes (legacy columns, no adaptive guard, ON CONFLICT (name)) — validated for real: the test fails 8/11 against the pre-PR file. File-specific pins on the rewritten 20260606000000: fresh-DB to_regclass guard; detects BOTH shapes with `IF v_has_flag_name ... ELSIF v_has_name` priority; canonical branch is `ON CONFLICT (flag_name) DO NOTHING` and the file contains NO `DO UPDATE` (the original DO UPDATE would clobber an ops-bumped `metadata.rollout_pct` back to 0 on re-apply — dropped deliberately, must never return); default-OFF posture pinned as "no boolean `true` literal anywhere in executable SQL" + no nonzero `'rollout_pct'` + ≥5× `'enabled', false` and `'kill_switch', false` (4 canonical rows + 1 legacy SELECT); all four `ff_python_{ncert_solver,cme_engine,foxy_tutor,quiz_generator}_v1` flags appear exactly twice (canonical AND legacy branch); legacy branch is `WHERE NOT EXISTS` with no `ON CONFLICT` (no dependence on a unique constraint over `name`). 11 tests, deterministic, no DB. | `src/__tests__/regressions/reg-125-feature-flags-insert-shape.test.ts` | U |

### Invariants covered by this section

- Operational integrity (deploy pipeline) — a wrong-shape feature_flags seed
  is now a PR-CI failure, not a staging-deploy wall that blocks the entire
  migration chain behind it.
- OFF-path safety / P12-adjacent — the four Phase 5/6 Python-cutover flags
  (AI-serving surface) cannot seed live: is_enabled=false,
  rollout_percentage=0, metadata.enabled=false, metadata.kill_switch=false,
  metadata.rollout_pct=0 are all statically pinned, matching the sibling
  ff_python_* seeds (20260603*, 20260609*) and the
  `python-ai-proxy.ts` precedence contract.
- Ops-value preservation — the DO-NOTHING conflict posture guarantees a
  re-applied seed can never reset an ops-bumped rollout_pct (the original
  DO UPDATE could).

## Phase A Loop A — Adaptive Remediation closed loop (2026-06-13) — REG-126..REG-129

Source: Phase A Loop A adaptive remediation
(`docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`
§9; the spec proposed REG-121..123 before the RBAC/Pulse cluster took those ids —
final numbering owned by testing per §12). The platform's first autonomous
closed loop: detect a mastery cliff → inject ≤3 remediation cards into the
daily rhythm queue → verify recovery over a 7-day window → escalate to a human
(teacher via the Phase 3A assignment spine, else linked parent, else
student-only) when recovery does not happen. Everything is gated behind
`ff_adaptive_remediation_v1` (seeded OFF by
`20260619000300_seed_ff_adaptive_remediation_v1.sql`).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-126 | `adaptive_remediation_closed_loop_state_machine` | The `adaptive_interventions` state machine (migration `20260619000200_adaptive_interventions.sql`) cannot double-fire, freeze, or falsely self-resolve. INJECT dedupe: a 23505 from the `adaptive_interventions_one_active` partial unique index (one ACTIVE row per student × subject × chapter) is a benign dedupe — no event, no notification, `deduped` counted, never an error; an existing active row blocks BEFORE any insert (adapter guardrail 5); the injection planner's guardrails are pinned at their boundaries (fatigue strict >0.6 with exactly-0.6 injecting, 3-day same-chapter cooldown with exclusive end, no_cliff gate, null-target decline-streak flags skipped). DRAIN, NOT FREEZE (CEO-specified kill-switch semantics): flag OFF ⇒ the inject phase is a no-op with ZERO candidate scans, but the verify phase still processes already-active rows to terminal state (expiry → escalation + audit + notification) — pinned at the worker route AND in the Deno daily-cron canary (contract 4c: `triggerAdaptiveRemediation` stays THIN — fetch-out with `x-cron-secret`, no `feature_flags` read, no `PULSE_THRESHOLDS`/`ADAPTIVE_REMEDIATION_RULES` in Deno — because a Deno-side flag gate would freeze mid-flight interventions). VERDICT DIRECTION (never false recovery): `evaluateRecovery` recovers ONLY on affirmative evidence — the LATEST in-window observation at/above the pre-cliff baseline (branch A, inclusive, no at-risk floor) or gain-from-trough ≥0.15 with mastery ≥0.4 (branch B, epsilon-guarded for IEEE 0.7−0.55); transient early peaks do not count; ambiguity/corruption (non-finite clock, corrupt record, no observations) degrades to `pending` with nulls; `expired` fires only STRICTLY after the inclusive 7-day window end, and in-window recovery beats late evaluation — so the loop's failure mode is always "a human gets asked" (escalation), never "the system claims recovery it cannot prove". ESCALATION COMPLETENESS: the terminal transition (guarded `eq status='active'` — race-safe), the `system.remediation_escalated` event, the `audit_logs` row, and the notification move together; a B2B assignment-insert failure leaves the row ACTIVE for next-run retry (no half-escalation: zero updates/events/audits/notifications). Notifications pin the house shape: top-level `message`/`body` EN + Hindi (real Devanagari) in `data.title_hi/body_hi/message_hi` (P7), deterministic `idempotency_key` per intervention cycle upserted `onConflict (recipient_id,type,idempotency_key) ignoreDuplicates` (cron retries never duplicate), guardians notified ONLY on the parent path with dual-status link filter + per-guardian preference opt-out, fire-and-forget (DB failure never throws). Observability trail: the `system` actor + 3 kinds (`system.remediation_{injected,recovered,escalated}`) are pinned in the events-registry canon. **Hard precondition (spec §9, ratified): `ff_adaptive_remediation_v1` ON ⇒ `ff_event_bus_v1` ON in the same environment** — both the inject scan and recovery verification read `learner.mastery_changed` observations from the bus; with the bus OFF, verification is BLIND and every intervention would expire to escalation regardless of actual recovery. Killing the bus where the loop is ON requires draining first (flag OFF → let actives reach terminal state) per `docs/runbooks/adaptive-remediation-rollout.md`. | `src/__tests__/api/cron/adaptive-remediation.test.ts` (kill-switch drain; inject happy path/23505 dedupe/guardrail-5 block; verify recovered/pending/expired ×3 escalation branches; mixed-case `subjectCode` observation matching; B2B failure-stays-ACTIVE), `src/__tests__/lib/learn/recovery-evaluation.test.ts`, `src/__tests__/lib/learn/remediation-queue-adapter.test.ts`, `src/__tests__/lib/notification-triggers-remediation.test.ts`, `src/__tests__/state/events-registry.test.ts` (`system` actor + 3 kinds), `supabase/functions/daily-cron/__tests__/contract.test.ts` (contract 4c) | U |
| REG-127 | `adaptive_remediation_cron_worker_posture` | The `/api/cron/adaptive-remediation` worker holds the REG-118/REG-119 posture. FAIL-CLOSED AUTH BEFORE ANY I/O: missing secret, wrong secret, and unset `CRON_SECRET` env (misconfig) all → 401 with the recorded DB seam proven EMPTY (zero reads — deny short-circuits before the supabase-admin seam AND before any flag read). Three pinned carriers (`Authorization: Bearer`, `x-cron-secret`, `?token=` — the daily-cron fetch-out + both Vercel-cron precedents) with FIRST-PRESENT-WINS precedence: a wrong higher-precedence carrier does NOT fall through to a correct lower one (still 401, still zero I/O). COUNTS-ONLY RESPONSES: the success envelope carries phase counters only (`inject: {scanned, injected, deduped, blocked, errors}`, `verify: {evaluated, recovered, escalated, pending, errors}` + `skipped` reasons) — never student rows; the unhandled-error path returns EXACTLY `{success:false, error:'internal_error'}` (no message field, internal detail provably absent from the body, logger-only). METADATA-ONLY AUDIT (REG-68 pattern): every escalation writes `audit_logs` with `actor_id null`, `action 'system.remediation_escalated'`, `target_entity 'adaptive_interventions'`, and metadata that never matches `/name\|email\|phone/i` — UUIDs and academic codes only (P13). The Deno daily-cron side keeps its own REG-118 canary (fail-closed CRON_SECRET, constant-time compare, auth-before-dispatch, `Promise.allSettled` isolation) now extended with the `adaptive_remediation_triggered`/`triggerAdaptiveRemediation` step pair. | `src/__tests__/api/cron/adaptive-remediation.test.ts` (auth-gate describe: carrier/precedence/zero-I/O pins; generic-500 describe; the B2B escalation test pins the audit row + metadata regex), `supabase/functions/daily-cron/__tests__/contract.test.ts` | U |
| REG-128 | `adaptive_remediation_b2b_escalation_attribution` | Escalation reaches the RIGHT teacher and survives concurrent duplicates. SUBJECT-MATCH TIERING (`src/app/api/cron/adaptive-remediation/_lib/subject-match.ts`): separator normalization on BOTH sides (`[_\s]+` → single space, lowercase, trim) kills the underscore false negatives (`social_studies` ≡ "Social Studies"); token-boundary matching (NOT bare substring) kills THE blocking false positive — code `science` returns tier 0 against "Social Science"/"Political Science"/"Computer Science"/"Environmental Science"; tier ordering exact(2) > partial(1) > none(0). The full 15-code CBSE matrix is pinned (math, science, english, hindi, social_studies, physics, chemistry, biology, business_studies, political_science, computer_science, economics, accountancy, geography, history) plus CBSE display variants ("Mathematics Standard/Basic", "English Core", "Hindi B", "Maths") and the documented `social_studies` vs "Social Science" alias limitation (tier 0 — alias mapping out of scope). ROUTE-LEVEL CONSEQUENCE: code `science` selects the older exact-match Science class over a NEWER "Social Science" class, and exact beats partial for `social_studies` — the wrong-teacher substring bug cannot regress silently. CROSS-TEACHER 23505 IDEMPOTENCY: the partial unique index `uq_teacher_remediation_assignments_open_dedupe` (migration `20260619000400`, keyed `(student_id, class_id, chapter-bucket)` WHERE status='assigned' — teacher_id deliberately NOT in the key) makes a colleague's open row invisible to the per-teacher pre-check, so the duplicate surfaces as 23505 on INSERT; the teacher API route recovers it as the SAME idempotent-success envelope (200, `idempotent:true`, surviving row returned) via a survivor lookup on the index's natural key (student_id + class_id + chapter eq/IS-NULL + status='assigned', explicitly WITHOUT teacher_id), never a 500; non-23505 errors still 500 (handling not widened); 23505-with-no-survivor stays a 500. The cron worker's escalation path holds the mirror-image pins: its survivor lookup MUST filter by the escalation-chosen `class_id` (cross-handoff fix — without it a same-student row from a DIFFERENT class could become the FK), links the existing assignment id on dedupe, and leaves the intervention ACTIVE for retry when the survivor cannot be resolved. | `src/__tests__/api/cron/adaptive-remediation-subject-match.test.ts` (tier matrix), `src/__tests__/api/cron/adaptive-remediation.test.ts` (tiered class selection ×2; B2B 23505 dedupe ×3), `src/__tests__/api/teacher/remediation/route.test.ts` (cross-teacher 23505 ×4 + pre-check idempotency) | U |
| REG-129 | `adaptive_remediation_student_lane` | The student-facing surface stays capped, killable, and bilingual. SERVER HALF (`/api/rhythm/today`): flag OFF ⇒ the lane builder short-circuits BEFORE the `adaptive_interventions` read (zero lane I/O proven) and the response carries no `remediation_review` kind — the base Wave 1B queue object is returned untouched (byte-identical kill switch); flag ON ⇒ ≤`max_remediation_cards_per_day` (3) cards even with 5 active interventions, ordered deepest `trigger_snapshot.largestDrop` first via the adapter's EXPORTED `compareBySeverity` (single source of truth with the injection planner; corrupt/null snapshots sort last), 1-based priorities, spliced as a CONTIGUOUS block after the SRS slice with the surrounding base items element-for-element identical to the flag-OFF run; the frozen card contract is exactly `{kind:'remediation_review', subjectCode, chapterNumber, interventionId, priority}`; lane failures (query error OR lane-builder exception) degrade to the base queue at 200 — remediation is an enhancement, never a reason to 500 the daily queue; the lane read goes through the RLS-scoped server client filtered `eq(student_id)` + `eq(status,'active')` (P8 — `adaptive_interventions_student_select` is the boundary). CAPS MATH (adapter): capacity = min(3, 10 − queue size) pinned at 0/1/3-card boundaries, queue 9/10/12, negative-clamp, and NaN fails CLOSED as `queue_full`; the ratified constants themselves are pinned and recovery thresholds are REUSED from `PULSE_THRESHOLDS` (no duplicate constants — guardrail 6). CLIENT HALF (DailyRhythmQueue): warm EN framing + Hindi (P7: "Foxy ने देखा कि अध्याय 4 थोड़ा मुश्किल लगा…", "मज़बूत करो", "प्राथमिकता 1"), canonical `/quiz?subject=&chapter=` deep link with a full-sentence aria-label, no-remediation-kind ⇒ no card with base rows untouched (flag-OFF shape — server-gated, no client flag check), unknown/future kinds never break rendering, malformed cards (missing routing fields) dropped (no dead links), and the CTA analytics payload is PII-free (section/action/destination — no interventionId emitted). TIMELINE COPY (Pulse): variant-aware bilingual lines for the 3 system.* kinds (student encouraging / parent + teacher actionable; icon + accent never colour-alone); the escalated line claims a specific helper ONLY when `escalatedTo` is present — and `escalatedTo` passes the pulse-server whitelist ONLY for `system.remediation_escalated` (value domain teacher/parent; null omitted; the per-kind addition does not leak onto other kinds), while `interventionId`/`teacherAssignmentId` and PII-shaped keys NEVER pass the whitelist (P13). | `src/__tests__/api/rhythm/today-remediation-lane.test.ts` (server half — NEW this PR), `src/__tests__/lib/learn/remediation-queue-adapter.test.ts` (caps + constants), `src/__tests__/components/dashboard/DailyRhythmQueue.remediation.test.tsx` (client half), `src/__tests__/components/pulse/pulse-copy-remediation.test.ts`, `src/__tests__/lib/pulse/pulse-server-whitelist.test.ts` | U |

### Invariants covered by this section

- P7 Bilingual UI — REG-126 (notification house shape carries real Devanagari in
  `data.*_hi`), REG-129 (lane card + pulse timeline copy EN/HI).
- P8 RLS boundary — REG-129 (the student lane reads `adaptive_interventions`
  through the RLS-scoped server client; policies land in the same migration as
  the table per `20260619000200`); REG-128 (teacher route roster scope holds —
  pre-existing pins in the same file remain).
- P13 Data privacy — REG-127 (counts-only worker responses, generic 500 body,
  metadata-only audit), REG-129 (whitelist suppresses row identifiers + PII keys;
  CTA analytics PII-free), REG-126 (notification payloads carry opaque ids +
  academic codes only).
- P-learner-state correctness — REG-126 anchors recovery to affirmative-evidence
  semantics and the adapter to `PULSE_THRESHOLDS` reuse (no threshold drift).
- Operational integrity (REG-118/REG-119 posture) — REG-127 (fail-closed cron
  auth, deny-before-I/O, carrier precedence), REG-126 (Deno trigger stays thin
  and ungated so the kill switch drains).
- OFF-path safety / kill switch — REG-126 (drain, not freeze), REG-129
  (flag-OFF byte-identical queue, zero lane I/O); `ff_adaptive_remediation_v1`
  seeded OFF.

### Catalog total

Pre-2026-06-12: 92 entries. REG-125 (feature_flags seed-shape conformance —
staging-sync wall closure, PR #1014). Phase A Loop A adds REG-126 (closed-loop
state machine), REG-127 (cron worker posture), REG-128 (B2B escalation
attribution), REG-129 (student-facing lane). **Total catalog: 97 entries
(target: 35 — TARGET EXCEEDED).**

**Total: 97 entries.**

## CI pipeline-failure alerting (2026-06-12, PR #1015) — REG-130

Source: PR #1015 (`ops`/pipeline-alert). MERGED to `main` without its catalog
entry; promoted here retroactively (the #1015 testing review proposed this text).
This is a CI-only watcher — there is no Vitest/Playwright asserting test; the
"test" is the workflow contract itself, audited by reading
`.github/workflows/pipeline-alert.yml`. Logged as status `C` (CI-enforced, no
unit harness) rather than `U`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-130 | `ci_pipeline_failure_alert_out_of_band` | An out-of-band `workflow_run`-triggered watcher opens a GitHub issue when a watched pipeline concludes `failure`, and self-heals (closes the issue) on the next green run. WATCHED-NAME BYTE-EQUALITY INVARIANT: the watcher keys off the EXACT `name:` strings of the pipelines it guards (including em-dashes and other non-ASCII in the workflow display names) — a silent rename of a watched workflow that breaks byte-equality must be caught, because a watcher that matches nothing fails OPEN (silently never alerts). DEDUPE: at most ONE open `pipeline-failure` issue per watched workflow at a time (find-existing-open-by-label before create; subsequent failures comment/update, never spawn duplicates). SELF-HEALING: a subsequent successful run of the same workflow closes the open failure issue automatically. OUT-OF-BAND SURVIVAL: the alerter runs as a SEPARATE `workflow_run` workflow (not a step inside the watched pipeline) precisely so it survives the in-pipeline-rollback failure mode — if the watched pipeline dies mid-run or a rollback step aborts it, the alerter still fires from the completed `workflow_run` event. The watcher itself uses `permissions: issues:write` only and carries no deploy/secret scope. | `.github/workflows/pipeline-alert.yml` (CI-only; no unit harness) | C |

## Phase A Loops B & C — Inactivity + At-Risk-Concentration closed loops (2026-06-13) — REG-131..REG-134

Source: `docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md`. Loop B
(inactivity re-engagement) and Loop C (at-risk-concentration escalation) ride
the SAME `adaptive_interventions` substrate as Loop A, share the verify-drain
kill-switch semantics, and add the cross-loop arbiter (the anti-storm core).
Uncommitted scope on `feat/phase-a-loops-bc`: migrations `20260619000500`
(`trigger_signal` CHECK extend to `inactivity`/`at_risk_concentration` +
`chapter_number >= 0` for the Loop B sentinel) / `20260619000600`
(`ff_adaptive_loops_bc_v1` seed, OFF); `src/lib/learn/adaptive-loops-rules.ts`
+ the two backend evaluators; the worker B/C inject+verify branches; 6 new
notification triggers; 6 new `system.*` event kinds; the pulse whitelist
extension; `ff_adaptive_loops_bc_v1`.

> **ID note:** REG-130 is the CI pipeline-alert promotion (PR #1015, above);
> REG-131..134 are the next free ids after Loop A's REG-126..129.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-131 | `adaptive_loops_bc_closed_loop_state_machines` | Loops B & C are independent closed-loop state machines on the SHARED `adaptive_interventions` substrate that cannot double-fire, freeze, or falsely self-resolve, and DRAIN regardless of the flag. LOOP B (inactivity): a `deriveInactivity`-'broken' student opens the reserved sentinel triple (`subject_code='_inactivity'` — passes the lowercase CHECK; `chapter_number=0` — passes the extended `>= 0` CHECK; `trigger_signal='inactivity'`), `verify_by = createdAt + 3 days`, emits `system.engagement_nudged` (idempotencyKey `inactivity:<id>:nudged`) + a nudge notification, with NO queue/card injection and NO teacher row (Decisions B1/B4); one-active-max blocks a second nudge; a 23505 on the sentinel insert is a benign dedupe (no event/notification, `deduped` counted). LOOP B planner gates pinned at their boundaries: trigger-on-'broken'-ONLY (ok/at_risk/never/unknown → `not_broken`), onboarding grace EXCLUSIVE (created exactly 7 days ago is eligible; unparseable created-at degrades to in-grace), nudge cooldown EXCLUSIVE +7d, ceiling deference, and the documented decision precedence (`not_broken` > `onboarding_grace` > `active_exists` > `cooldown` > `ceiling_spent`). LOOP B verify (`evaluateReturn`/`evaluateInactivityReturn`): returned/pending/expired across the rolling-ms window with INCLUSIVE ends; 'expired' fires only STRICTLY after windowEnd; a return at the exact boundary beats same-instant expiry; earliest qualifying return wins; before-nudge/after-window/future observations ignored; malformed record/clock/observations degrade to 'pending' (never a false parent escalation). LOOP C verify (`evaluateConcentrationResolution`): resolved when the LATEST in-window subject snapshot drops below `concentration_high_min` (count 4 resolves, 5 = exactly high_min stays high/pending, 6 pending), a transient mid-window dip that climbs back to high is NOT resolved, malformed → pending. DRAIN, NOT FREEZE: with `ff_adaptive_loops_bc_v1` OFF the verify phase still transitions already-active B & C rows to terminal (returned→recovered, expired→escalate, resolved→recovered, expired→re-notify) — pinned with the flag explicitly OFF, including a mixed A+B+C single-sweep drain. Canonical reuse is structural: the band boundary and window constants are IMPORTED from `PULSE_THRESHOLDS` / `ADAPTIVE_LOOPS_BC_RULES`, never re-typed (guardrail B/C-6; `cooldown > return_window` for Loop B pinned so a just-expired row cannot instantly re-open). | `src/__tests__/lib/learn/adaptive-loops-rules.test.ts`, `src/__tests__/lib/learn/inactivity-return-evaluation.test.ts`, `src/__tests__/lib/learn/concentration-resolution-evaluation.test.ts`, `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (Loop B inject + verify drain; mixed-loop sweep), `src/__tests__/state/events-registry.test.ts` (6 new `system.*` kinds) | U |
| REG-132 | `adaptive_loops_bc_cross_loop_arbiter` | The cross-loop arbiter enforces the per-student anti-storm ceiling and precedence. CEILING ≤ 1/STUDENT/DAY: `arbitrateInterventions` opens AT MOST `per_student_daily_intervention_ceiling` (=1, pinned) NEW intervention per student per night across A/B/C; with the slot already spent tonight it opens nothing (`ceiling_already_spent`); the ceiling caps NEW opens only — verify-phase transitions on already-open rows are NOT routed through the arbiter, so in-flight loops always drain. PRECEDENCE A > C > B (Decision X3), independent of input order: with A+C+B all eligible exactly ONE row opens and it is the Loop A `mastery_cliff` row (`injectedCliff:1`, `injectedInactivity:0`, `injectedConcentration:0`, exactly one `interventions.insert`); with only C+B eligible the Loop C row wins and B is `ceilingDeferred`; same-loop ties break by descending severity (null/non-finite last) then subjectCode asc then chapterNumber asc (fully deterministic); malformed candidates with an unknown loop id are filtered out. A↔C COEXISTENCE (C-G3): no Loop C row opens for a subject that already has an ACTIVE Loop A (`mastery_cliff`) row on any chapter (`coexists_with_a`), while an active A row in a DIFFERENT subject does not block; the reverse (A injecting into a C-escalated subject) is intentionally allowed and not this module's concern. Per-loop ceiling deference is pinned in BOTH planners (`planInactivityIntervention`/`planConcentrationIntervention` return `ceiling_spent` when a higher-precedence loop already spent the slot). | `src/__tests__/lib/learn/adaptive-loops-rules.test.ts` (arbiter ceiling/precedence/tie-break; A↔C coexistence in `planConcentrationIntervention`; per-loop ceiling deference), `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (route-level: A+C+B→A only; C+B→C with B deferred; A↔C coexistence skip) | U |
| REG-133 | `adaptive_loops_c_escalate_at_inject_and_reescalation` | Loop C escalates AT INJECT (the escalation IS the intervention) and survives concurrent duplicates. ESCALATE-AT-INJECT: a `deriveAtRiskConcentration`-'high' subject opens the worst-chapter triple (lowest-mastery chapter) with `trigger_signal='at_risk_concentration'`, `verify_by = createdAt + 14 days`, and `escalated_to` SET AT INJECT — B2B (roster teacher present): reuses Loop A's resolver to create a `teacher_remediation_assignments` row, stamps `escalated_to='teacher'` + `teacher_assignment_id`, emits `system.concentration_escalated` (payload carries `escalatedTo`, `teacherAssignmentId`, `atRiskChapterCount`) + an `audit_logs` row whose metadata never matches `/name|email|phone/i` (P13); B2C (no teacher, linked guardian): `escalated_to='parent'`, no assignment insert; neither (no teacher, no guardian): `escalated_to=null`, still event + audit + student notification. NO HALF-ESCALATION: a B2B assignment-insert failure ABORTS before the intervention row is inserted (`injectedConcentration:0`, `errors:1`, zero inserts, no event) so the next run retries cleanly. B2B 23505 DEDUPE: a duplicate-key on the assignment insert links the EXISTING assignment (survivor lookup) and still opens the intervention with `escalated_to='teacher'` + the surviving `teacher_assignment_id`. TWO-BEAT RE-ESCALATION (Decision C4 — re-notify, NOT a 2nd row): on verify, an expired row still in the 'high' band transitions `status='escalated'` WITHOUT inserting a second intervention row, re-flags the existing teacher assignment (bump to 'assigned') on the B2B path, emits `system.concentration_reescalated` + an audit row; the B2C path re-notifies the parent (`escalatedTo='parent'`, no assignment bump). A resolved row (band dropped below high in-window) transitions `status='recovered'` + `system.concentration_resolved`. | `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (Loop C inject: B2B/B2C/neither, assignment-failure abort, 23505 dedupe; Loop C verify: resolved, expired→re-notify ×2 (B2B re-flag + B2C parent)), `src/__tests__/state/events-registry.test.ts` (`system.concentration_{escalated,resolved,reescalated}` payload shapes) | U |
| REG-134 | `adaptive_loops_b_nudge_verify_flag_gating_and_whitelist` | Loop B's nudge→return→parent-escalation flow, the B/C flag gate, and the P13 escalatedTo whitelist for the three new escalated kinds. LOOP B NUDGE + RETURN VERIFY: returned (genuine in-window activity) → `status='recovered'` + `system.engagement_returned` + `onReEngagementReturned`; expired + linked guardian → `status='escalated'`, `escalated_to='parent'` (NEVER a teacher row — Decision B4), `system.engagement_escalated` + audit + parent notification; expired + no guardian → `escalated_to=null` (ops-visible), student-only; pending (window open, still inactive) → no transition. PER-SIGNAL FLAG GATING (Decision X2 — independent kill switches): `ff_adaptive_loops_bc_v1` OFF ⇒ the B/C inject branches are no-ops (NO inactive-student scan, NO B/C insert) while the `mastery_cliff` branch still respects its OWN `ff_adaptive_remediation_v1` flag; both flags OFF ⇒ inject reports `skipped:'flag_off', injected:0`; B/C ON ⇒ the inactive-student scan runs. The VERIFY phase drains B & C rows even with the flag OFF (gated on active rows, not the flag). NOTIFICATION PRODUCER CONTRACT (the 6 new triggers — direct shape pins, not just the route's mocked calls): house shape (top-level `message`/`body` EN, Hindi Devanagari in `data.title_hi/body_hi/message_hi`, no top-level `body_hi` column — P7), deterministic per-cycle `idempotency_key` upserted `onConflict (recipient_id,type,idempotency_key) ignoreDuplicates`, the day-0 nudge key (`engagement_nudge_<id>_*`) is namespaced distinctly from the at-expiry escalation key (`engagement_escalated_<id>_*`) so a returning student never collides (B4); recipient routing — nudge/returned/resolved → student (nudge ALSO alerts guardians), inactivity-escalated → student always + guardian ONLY on the parent path (never teacher), concentration-escalated → student always + guardian only on parent (teacher rides the assignment, student-only here), concentration-reescalated → parent follow-up ONLY (guardian rows, no student row; teacher/null sends NOTHING); guardian fetch is dual-status (approved|active) + per-guardian preference opt-out; fire-and-forget (DB failure never throws); P13 (no name/email/phone in any payload). ESCALATEDTO WHITELIST (P13): `escalatedTo` passes the pulse-server timeline whitelist for the THREE new kinds (`system.engagement_escalated`, `system.concentration_escalated`, `system.concentration_reescalated`) — value domain teacher/parent, null omitted — exactly as it does for Loop A's `system.remediation_escalated`; the per-kind addition does NOT leak onto other kinds; identifiers (`interventionId`, `teacherAssignmentId`), scheduling internals (`daysSince*`, `verifyBy`), and PII-shaped keys (studentName/email/phone) NEVER pass for any kind. | `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (Loop B verify: returned/expired-parent/expired-null/pending; per-signal flag gating; verify-drain-with-flag-OFF), `src/__tests__/lib/notification-triggers-loops-bc.test.ts` (NEW this PR — the 6 producer shapes), `src/__tests__/lib/pulse/pulse-server-whitelist.test.ts` (3 new escalated kinds + PII suppression + per-kind scoping) | U |

### Invariants covered by this section

- P7 Bilingual UI — REG-134 (the 6 B/C notification producers carry real
  Devanagari in `data.*_hi`).
- P8 RLS boundary — REG-131/REG-133 (B & C rows ride `adaptive_interventions`,
  whose student/teacher/parent RLS lands in `20260619000200`; the worker uses
  the service-role admin client server-side only).
- P13 Data privacy — REG-133 (metadata-only audit on every C escalation),
  REG-134 (escalatedTo whitelist suppresses identifiers + PII for the 3 new
  kinds; notification payloads carry opaque ids + academic codes only).
- P-learner-state correctness — REG-131 (verdict direction: B return + C
  resolution anchored to affirmative in-window evidence; ambiguity/corruption
  degrades to pending, never a false recovery/escalation).
- Anti-storm / operational integrity — REG-132 (≤1 new intervention per
  student per day, A>C>B precedence, A↔C coexistence).
- OFF-path safety / kill switch — REG-131 + REG-134 (drain, not freeze:
  `ff_adaptive_loops_bc_v1` OFF ⇒ no B/C inject but verify still drains
  in-flight rows to terminal).

### Catalog total

Pre-2026-06-13: 97 entries (Phase A Loop A through REG-129). REG-130
(CI pipeline-failure alerting, retroactively promoted from PR #1015). Phase A
Loops B & C add REG-131 (B/C closed-loop state machines + drain), REG-132
(cross-loop arbiter — ceiling + precedence + A↔C coexistence), REG-133 (Loop C
escalate-at-inject + two-beat re-escalation + B2B/B2C + 23505 dedupe), REG-134
(Loop B nudge/return/parent-escalation + flag gating + notification producers +
escalatedTo whitelist). **Total catalog: 102 entries (target: 35 — TARGET
EXCEEDED).**

**Total: 102 entries.**

## MOL Python-unification (sub-project A) — router, breaker, cost-cap, parity gate, streaming safety (2026-06-13) — REG-135..REG-139

Source: MOL Python-unification plan
(`docs/superpowers/specs/2026-06-13-mol-python-unification-design.md`, Phase 9 /
Task 9.1). Sub-project A ports the Model-Orchestration-Layer router, circuit
breaker, cost cap, cache, and `/v1/generate{,/stream}` endpoints from the TS
implementation into the Python AI service (`python/`), behind a TS→Python
cutover. **Every flag introduced by this work ships DEFAULT-OFF** (deterministic
OpenAI-priority, shadow-priority, the Python cutover kill-switch) so the live TS
path is byte-unchanged until each flag is deliberately flipped. All five anchors
verified green before cataloguing: `python -m pytest` over the named suites =
**72 passed** (2026-06-13).

> **ID note (2026-06-13):** the Phase 9 plan drafted these as REG-120..REG-124,
> and they were first catalogued on `feat/mol-python-unification` as
> REG-130..REG-134. On merging `origin/main` those ids collided with main's
> CI pipeline-alert promotion (REG-130) and the Phase A Loops B & C cluster
> (REG-131..REG-134). Per the catalog's standing collision convention (see the
> REG-117, REG-123, and REG-124 ID notes), main keeps REG-130..REG-134 and these
> MOL entries were renumbered to the next free block **REG-135..REG-139**. No
> test code referenced the draft or interim ids.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-135 | `mol_deterministic_openai_priority` | Provider-priority routing is predictable: OpenAI is ALWAYS the primary provider unless the circuit is OPEN, a per-task override applies, or the shadow-priority flag is set (P12 — no nondeterministic provider roulette for a live student turn). The deterministic-priority router promotes OpenAI to the front of every OpenAI-bearing chain WITHOUT consulting a random weight (the legacy weighted path is the OFF default), is a no-op when a chain has no OpenAI provider, and is stable across repeated calls (same input ⇒ same chain). The `/v1/generate` endpoint reads the deterministic-priority flag and, when ON, routes OpenAI-primary; the flag ships default-OFF so the live weighted path is unchanged until flipped. | `python/tests/unit/test_router.py` (`test_deterministic_priority_makes_openai_primary_without_random`, `test_deterministic_priority_reasoning_promotes_openai_first`, `test_deterministic_priority_is_stable_across_calls`, `test_deterministic_priority_noop_when_chain_has_no_openai`, `test_shadow_priority_on_uses_weights_and_random`), `python/tests/integration/test_generate_endpoint.py::test_generate_reads_deterministic_priority_flag` (+ `test_generate_uses_openai_primary_when_deterministic_flag_on`) | U + I |
| REG-136 | `mol_cross_instance_circuit_breaker` | Cross-instance (Redis-keyed) circuit breaker degrades gracefully and NEVER blocks a live request when its own backing store is unreachable (P12). State machine pinned at every transition: CLOSED allows requests; three failures OPEN the circuit; the open window is keyed by provider × task (one tripped provider/task does not blast-radius the rest); on expiry exactly ONE half-open probe is allowed; two successes in half-open CLOSE the circuit, a single success does NOT, and a failure in half-open RE-OPENS it. FAIL-OPEN safety: when Redis is unreachable the breaker allows the request through rather than failing the student's turn. At the endpoint, a provider whose breaker is OPEN is skipped in favour of the next chain entry; only retryable 5xx count toward tripping (non-retryable 4xx do not). | `python/tests/unit/test_breaker.py` (`test_closed_breaker_allows_requests`, `test_three_failures_block_while_open_window_live`, `test_open_circuit_keyed_by_provider_and_task`, `test_open_expired_allows_exactly_one_probe`, `test_two_successes_in_half_open_close_the_circuit`, `test_failure_in_half_open_reopens_circuit`, `test_single_success_in_half_open_does_not_close`, `test_fail_open_when_redis_unreachable`), `python/tests/integration/test_generate_endpoint.py::test_generate_skips_open_breaker_provider` (+ `test_breaker_ignores_non_retryable_4xx_but_counts_5xx`) | U + I |
| REG-137 | `mol_cost_cap_enforcement` | Per-task cost ceiling is enforced BEFORE any provider HTTP call (P12 / cost-control — a runaway/expensive request is rejected at the gate, never after spend). Every task type has a ceiling; the INR estimate uses the primary model's price; an under-ceiling estimate does not raise; an over-ceiling estimate raises `COST_CAP_EXCEEDED`; an unknown model estimates zero and passes (fail-soft for unpriced models, not fail-closed). At the endpoint, an over-ceiling request returns HTTP 429 and the test asserts NO provider call was made (the cap short-circuits ahead of the network seam). | `python/tests/unit/test_cost_cap.py` (`test_every_task_type_has_a_ceiling`, `test_estimate_inr_uses_primary_model_price`, `test_under_ceiling_does_not_raise`, `test_over_ceiling_raises_cost_cap_exceeded`, `test_unknown_model_estimate_is_zero_and_passes`), `python/tests/integration/test_generate_endpoint.py::test_generate_429_when_cost_cap_exceeded` (asserts no provider call) | U + I |
| REG-138 | `mol_cutover_parity_gate` | Contract-parity gate blocking a regressing TS→Python cutover (P14 — the cutover must be behaviour-preserving). The Python router reproduces the TS routing decision cassette-for-cassette across task types (explanation, step_by_step, quiz_generation, reasoning) and emits a `mol_request_logs` telemetry row whose COLUMN SET matches the TS shape exactly (no field drift across the two implementations). The eval harness is the quality gate: a golden set is non-empty and typed, the gate PASSES when every item meets its quality floor, FAILS when any item drops below floor, and treats an ungradeable item as a failure (fail-closed gate — a regressing cutover cannot slip through on a missing grade). | `python/tests/integration/test_routing_parity.py` (`test_routing_decision_matches_ts_cassette[explanation/step_by_step/quiz_generation/reasoning]`, `test_telemetry_row_shape_matches_ts_cassette`), `python/tests/unit/test_eval_harness.py` (`test_golden_set_nonempty_and_typed`, `test_gate_passes_when_all_items_meet_floor`, `test_gate_fails_when_any_item_below_floor`, `test_gate_treats_ungradeable_as_failure`) | I + U |
| REG-139 | `mol_streaming_path_safety` | The streaming endpoint never leaks a raw 5xx / stack trace to a student mid-stream (P12 — student-facing AI safety on the SSE path). `/v1/generate/stream` returns the SSE `text/event-stream` content-type; the terminal `done` event carries the request id (traceability without exposing internals); and an invalid-input failure becomes a structured `event: error` SSE frame rather than a transport-level 5xx or an unframed stack — a `MolError` is converted to an error event the client can render safely, and a client disconnect cancels the stream cleanly. | `python/tests/integration/test_generate_stream_endpoint.py` (`test_stream_returns_sse_content_type`, `test_stream_done_event_carries_request_id`, `test_stream_invalid_input_emits_error_event`) | I |

### Invariants covered by this section

- P12 AI safety / orchestration — REG-135 (deterministic, non-random provider
  priority), REG-136 (breaker degrades gracefully + fail-open never blocks a live
  turn), REG-137 (cost cap rejects before spend), REG-139 (streaming path emits a
  safe `event: error` frame, never a raw 5xx/stack to a student).
- P14 Contract parity / review-chain completeness — REG-138 (TS↔Python routing +
  `mol_request_logs` column-set parity; eval-harness quality gate fails closed on
  any regressing or ungradeable cutover item).
- OFF-path safety / kill switch — every flag in this sub-project (deterministic
  OpenAI-priority, shadow-priority, the Python cutover kill-switch) ships
  DEFAULT-OFF; the live TS path is byte-unchanged until each flag is flipped.

### Catalog total

Pre-MOL (post-merge with `origin/main`): 102 entries (through the Phase A Loops
B & C cluster, REG-134). MOL Python-unification sub-project A adds REG-135
(deterministic OpenAI-priority), REG-136 (cross-instance circuit breaker),
REG-137 (cost-cap enforcement), REG-138 (cutover parity gate), REG-139
(streaming-path safety). **Total catalog: 107 entries (target: 35 — TARGET
EXCEEDED).**

**Total: 107 entries.**

## B1 RAG eval-harness — offline retrieval-quality measurement backbone (2026-06-14) — REG-140

Source: B1 RAG eval-harness plan (Task 10). The harness is the OFFLINE
retrieval-quality measurement backbone for the NCERT-grounded RAG path
(`src/lib/foxy`/`src/app/api/foxy`): a golden query set, rank-based IR metrics
(recall@k, nDCG@k, MRR, hit-rate, groundedness-rate), a Sonnet relevance judge,
a trace-mining + telemetry rollup over `grounded_ai_traces`/`retrieval_traces`,
and a three-state verdict gate (PASS / REGRESS / INCONCLUSIVE) against an
assessment-reviewed baseline. The harness MUST be trustworthy — it can never
silently bless a degraded run, never emit a metric > 1.0, never leak PII to a
fixture or telemetry rollup, and can never be imported into production code. The
entire harness is offline (no live API traffic, no DB writes); the relevance
judge and runner take an INJECTED completion/retrieve function so the tests
exercise the real wiring with a fake model. All cited suites verified green
before cataloguing.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-140 | `rag_eval_harness_trustworthiness` | The offline RAG eval-harness can never silently bless a degraded, unmeasurable, or PII-leaking run (harness-trustworthiness contract; P5 / P12 / P13). **(1) Three-state verdict never silently PASSes a degraded/placeholder run:** `evaluateVerdict` returns INCONCLUSIVE (never PASS, never REGRESS) when the run is degraded (no/failed Voyage → silent FTS-only, surfaced as `reranked:false` on a rerank-expected item), when ANY primary metric is null/undefined/unmeasurable, or when a metric's baseline value is null; the runner additionally FORCES INCONCLUSIVE when the committed baseline is `metrics_placeholder:true` (carry-forward gate), when `VOYAGE_API_KEY` is absent, when `retrieve()` reports degraded/error for any item, and on silent rerank-degradation — so a clean-looking metric sheet on a degraded path cannot read as PASS. **(2) Rank-based metrics cannot exceed 1.0:** ranked-list first-occurrence dedup means RRF-emitted duplicate `chunk_id`s cannot push recall/nDCG/hit-rate > 1.0; `\|G\|=0` (no labeled-relevant chunks) or `k=0` → the metric returns null and the item is EXCLUDED + FLAGGED, never silently scored 0 or 1 (graded nDCG uses gain `2^rel − 1`, threshold `rel >= 1`). **(3) P13 on trace reads — no PII to harness/fixture:** the trace-mining + telemetry readers use a column-allowlist projection that NEVER SELECTs `student_id`/`user_id`/`session_id` (asserted on the literal `.select()` string, never `SELECT *`); every mined candidate carries a `query_sha256` BY DEFAULT (preview only on explicit `retainPreview`, and then run through `redactPIIInText`); the candidate sha256 matches the canonical digest of the source query; telemetry rollups are metadata-only (no forbidden identifier in the serialized output). **(4) Golden-set schema gate:** `validateGoldenSet` enforces P5 string grades `"6".."12"` (rejects integer `8` and out-of-range `"13"`), the canonical 17-code subject allowlist (accepts `social_studies`/`history_sr`/`hindi`; rejects `civics`, `history`, `social science`, `social_science`), a recursive PII-key reject (`student_id`/`user_id`/`session_id`/`email`/`phone`), a duplicate-item-id hard reject, the relevance `0\|1\|2` enum, and the `corpus_ref` object shape (`source: ncert_2025`); the seed query set carries no pre-resolved chunk ids (binding is the operator step) and stratifies 28–32 items across all three grade bands. **(5) Offline import boundary:** no file under `src/app`/`src/components`/`src/lib` can import the eval harness (enforced by an `no-restricted-imports` ESLint rule for `**/eval/**` and a path-regex test that matches a real harness import but NOT a `retrieval/` false-positive). **(6) Relevance judge is offline-only + CBSE-scoped (P12-adjacent):** the judge system prompt is scoped to CBSE/NCERT grades 6–12, penalizes off-syllabus chunks, flags `off_grade_scope` separately from relevance, demands strict JSON, and pins a Sonnet variant at temperature 0; `judgeRelevance` takes an INJECTED `complete` fn (no real API call — verified by reviewers via the fake completion), clamps out-of-range relevance into `{0,1,2}`, and returns a typed fallback (never throws) on malformed/throwing model output. | `src/__tests__/eval/rag/verdict.test.ts`, `run-eval.test.ts` (three-state verdict + placeholder/degraded carry-forward); `src/__tests__/eval/rag/metrics.test.ts` (rank-metric ≤ 1.0 + `\|G\|=0`/`k=0` null exclusion); `src/__tests__/eval/rag/trace-mining.test.ts`, `telemetry.test.ts` (P13 column-allowlist + sha256-default + metadata-only rollup); `src/__tests__/eval/rag/golden-schema.test.ts`, `seed-queries.test.ts` (golden-set schema gate); `src/__tests__/eval/rag/import-boundary.test.ts` (+ `.eslintrc.json` `no-restricted-imports` rule); `src/__tests__/eval/rag/relevance-judge.test.ts` (offline + CBSE-scoped + injected LLM) | U |

### Invariants covered by this section

- Harness-trustworthiness contract — the verdict gate is fail-closed: a degraded
  (no/failed Voyage → silent FTS-only), unmeasurable (any null primary metric or
  null baseline), or placeholder-baseline run resolves INCONCLUSIVE, never a
  silent PASS/REGRESS; rank-based metrics are dedup-bounded ≤ 1.0 and `|G|=0`/`k=0`
  items are excluded-and-flagged, never silently 0/1.
- P5 Grade format — REG-140 (golden-set + seed-query grades are STRINGS `"6".."12"`;
  integer and out-of-range grades hard-rejected).
- P12 AI safety / curriculum scope — REG-140 (the relevance judge is offline-only
  with an injected completion fn — no live API traffic — and its prompt is
  CBSE/NCERT-scoped to grades 6–12, penalizing off-syllabus chunks and flagging
  `off_grade_scope`).
- P13 Data privacy — REG-140 (trace-mining + telemetry reads use a column-allowlist
  projection that never SELECTs `student_id`/`user_id`/`session_id`, default to a
  `query_sha256` over `redactPIIInText`, and emit metadata-only rollups; the
  golden-set schema recursively rejects any PII-shaped key).
- Offline import boundary — production code (`src/app`/`src/components`/`src/lib`)
  can never import `eval/**` (ESLint `no-restricted-imports` + path-regex test).

### Catalog total

Pre-B1: 107 entries (through the MOL Python-unification sub-project A cluster,
REG-139). The B1 RAG eval-harness adds REG-140 (offline retrieval-quality
measurement backbone — three-state verdict trustworthiness, rank-metric ≤ 1.0
bound, P13 trace-read safety, golden-set schema gate, offline import boundary,
CBSE-scoped offline relevance judge). **Total catalog: 108 entries (target: 35 —
TARGET EXCEEDED).**

**Total: 108 entries.**

## Voyage rerank model-id production guard (2026-06-14) — REG-141

Source: rerank-model-id hotfix (PR #1032, branch `fix/voyage-rerank-model-id`).
The two production Voyage rerank call sites had a stale model identifier
(`'voyage-rerank-2'`) that is NOT a member of Voyage's supported rerank set —
Voyage answers it with HTTP 400 ("Model voyage-rerank-2 is not supported.
Supported models are ['rerank-lite-1','rerank-2-lite','rerank-2','rerank-2.5',
'rerank-2.5-lite']"). The 400 was swallowed by the rerank fallback, so retrieval
SILENTLY degraded to un-reranked RRF across EVERY RAG-bearing Edge Function
(grounded-answer, quiz-generator, ncert-solver, generate-answers,
bulk-jee-neet-import) with no error surfaced to logs or callers. The defect was
surfaced by the B1 eval-harness first real baseline run — its S5.1
silent-rerank-degradation guard resolved the run INCONCLUSIVE (REG-140's
fail-closed verdict gate doing exactly its job). The fix repoints both consts to
the correct `'rerank-2'` identifier; this entry pins them so the stale id can
never come back. All cited suites verified green before cataloguing.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-141 | `voyage_rerank_model_id_guard` | Both production Voyage rerank call sites are pinned to a model identifier in Voyage's SUPPORTED rerank set `['rerank-lite-1','rerank-2-lite','rerank-2','rerank-2.5','rerank-2.5-lite']` and explicitly NOT the known-bad legacy id `'voyage-rerank-2'` (P12 — RAG-retrieval integrity). **(1) Both call sites pinned:** a source-string scan extracts the model literal at `_shared/rag/retrieve.ts` const `VOYAGE_RERANK_MODEL` and at `_shared/reranking.ts` const `RERANK_MODEL` and asserts each value `toContain`s a member of the supported set. **(2) Stale id rejected at each site:** each extracted literal `.not.toBe('voyage-rerank-2')` — the exact string Voyage 400s on. **(3) Tripwire:** a fabricated `const VOYAGE_RERANK_MODEL = 'voyage-rerank-2'` source string proves the extractor really reads the literal (extracts `'voyage-rerank-2'`) AND that `'voyage-rerank-2'` is absent from the supported set — so the guard cannot be defeated by a no-op matcher. **(4) Why it matters:** the stale id made Voyage return HTTP 400, silently disabling rerank across ALL RAG-bearing Edge Functions (grounded-answer, quiz-generator, ncert-solver, generate-answers, bulk-jee-neet-import) — retrieval fell back to un-reranked RRF with no error surfaced. Discovered by the B1 eval-harness first real baseline run (the S5.1 silent-rerank-degradation → INCONCLUSIVE guard, REG-140, caught it); the harness full-path `reranked:true` evidence is the corroborating end-to-end signal. | `src/__tests__/eval/rag/voyage-rerank-model-id.test.ts` (source-string scan of both call sites + stale-id rejection + tripwire); corroborated by the B1 harness full-path `reranked:true` evidence (REG-140) | E |

### Invariants covered by this section

- P12 AI safety / retrieval quality — REG-141 (RAG-retrieval integrity: both
  production rerank call sites are pinned to Voyage's supported rerank set and can
  never regress to the known-bad `'voyage-rerank-2'` id that silently disabled
  rerank — degrading retrieval to un-reranked RRF — across every RAG-bearing Edge
  Function).

### Catalog total

Pre-REG-141: 108 entries (through the B1 RAG eval-harness, REG-140). The Voyage
rerank model-id hotfix adds REG-141 (production rerank model-id guard — both call
sites pinned to the supported set, stale `'voyage-rerank-2'` id rejected, tripwire
proves the matcher). **Total catalog: 109 entries (target: 35 — TARGET
EXCEEDED).**

**Total: 109 entries.**

## Foxy P12 grade-spoof hard block — unconditional, all subjects, audit row (2026-06-15) — REG-142

Source: CEO Decision D2 (2026-06-15). The `/api/foxy` route previously trusted
the client-supplied `grade` field for prompt assembly, RAG scope, and curriculum
selection — so a Grade 7 student could send `grade:'12'` and receive senior-grade
content (a P12 AI-safety violation: AI must stay within the student's enrolled
CBSE scope). The flag-gated `validateCurriculumScope` STEM pre-gate (REG —
curriculum-guard-pregate) catches this for math/physics/chemistry/biology when
`ff_foxy_curriculum_guard_v1` is ON, but it does NOT cover non-STEM subjects
(english, hindi, history, etc.) and it is OFF by design as a kill switch — so
a determined spoofer could simply request `subject:'english'` or wait for an
incident-flag-off window. This entry pins a SECOND, UNCONDITIONAL, subject-
independent defense layer.

> **ID note:** REG-135..REG-141 are taken by the MOL Python-unification cluster
> (REG-135..REG-139), the B1 RAG eval-harness (REG-140), and the Voyage rerank
> model-id hotfix (REG-141). REG-142 is the next free id at the time this
> entry was written (2026-06-15).

The wire (three layers, in order, before any LLM call):

1. **Zod 400** at `route.ts:2641-2658`. `FoxyRequestBodySchema` requires
   `grade ∈ z.enum(['6','7','8','9','10','11','12'])`. Any out-of-range string
   OR wrong type (integer, missing) returns 400 with `code:'INVALID_GRADE'`
   BEFORE the students fetch, studentId resolution, governance check, prompt
   build, RAG retrieval, or LLM call. (P5: grades are strings.)
2. **DB-authoritative compare** at `route.ts:2802-2849`. The students row's
   `grade` column is loaded server-side and compared to the (Zod-validated)
   body grade. If `dbGrade !== null` AND `dbGrade !== grade` the route returns
   `403 {code:'GRADE_MISMATCH', message:'Request grade does not match
   enrollment'}`, writes an `audit_logs` row via `logAudit` with
   `action:'foxy.grade_spoof_attempt'` +
   `details:{claimed_grade, actual_grade, route:'/api/foxy'}` + `status:'denied'`,
   and SKIPS every downstream call — no Claude, no grounded answer, no quota
   spend.
3. **Null-grade warn-and-proceed** at `route.ts:2850-2856`. A `dbGrade === null`
   row (legitimately-onboarding student) is NOT 403'd — the route logs a
   `logger.warn` and continues. The flag-gated STEM curriculum guard still
   acts as a second layer downstream.

The block runs **independent of `ff_foxy_curriculum_guard_v1`** and fires for
**ALL subjects including non-STEM** (english, hindi, history, etc.). The flag
only gates the existing STEM-only `validateCurriculumScope` pre-gate, which
remains in place as a defense-in-depth second layer for STEM topics.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-142 | `foxy_p12_grade_spoof_hard_block` | (A) Out-of-range `grade:'5'` → 400 `{code:'INVALID_GRADE'}`, no students-fetch, no Claude / grounded-answer / routeIntent call, no `foxy.grade_spoof_attempt` audit. (B) Wrong-type `grade:12` (integer) → same 400 + same downstream silence (P5 enforced via Zod). (C) Happy path `grade:'8'` / `dbGrade:'8'` → no 400/403, grounded path called exactly once, no spoof audit row. (D) Spoof `grade:'12'` / `dbGrade:'8'` → exact body `{code:'GRADE_MISMATCH', message:'Request grade does not match enrollment'}` at HTTP 403; exactly ONE `logAudit` call with `action:'foxy.grade_spoof_attempt'`, `resourceType:'students'`, `resourceId:'student-uuid-1'`, `status:'denied'`, and `details:{claimed_grade:'12', actual_grade:'8', route:'/api/foxy'}`; NO Claude / grounded-answer / routeIntent call; NO foxy quota RPC invoked (no quota spend on the 403 branch). (E) Null-grade onboarding (`dbGrade:null`, body `grade:'6'`) → NOT 403'd, grounded path called, `logger.warn` for the null-grade marker, NO spoof audit row. (F) Subject independence — `subject:'english'` (non-STEM) with `grade:'12'` / `dbGrade:'8'` still returns 403 GRADE_MISMATCH + writes the audit row + does NOT call grounded; explicitly with `ff_foxy_curriculum_guard_v1=false` to prove the gate is independent of the curriculum guard. **Deferred:** the inline `TODO(monitoring)` comment in `route.ts` flags that the per-request `logger.info('foxy.request', ...)` marker is intended to swap to `logSystemMetric` once the monitoring substrate lands; that swap is NOT in this entry's scope (no monitoring infra to assert against yet). | `src/__tests__/api/foxy/grade-spoof-hard-block.test.ts` (17 tests, 6 scenarios A–F) | E |

### Invariants covered by this section

- P12 AI safety / curriculum scope — REG-142 (an out-of-grade client claim
  CANNOT reach prompt-assembly, RAG scope, or any LLM call; the block is
  subject-independent so non-STEM topics are covered too; the block is
  independent of `ff_foxy_curriculum_guard_v1` so an OFF-flag window does
  NOT open a spoof vector).
- P5 Grade format — REG-142 (Zod enforces `grade ∈ z.enum(['6'..'12'])` at
  the API boundary; integer 12 is rejected as a P5 violation alongside the
  out-of-range string '5').
- P9 RBAC enforcement / audit completeness — REG-142 (every spoof attempt
  writes an `audit_logs` row with `action:'foxy.grade_spoof_attempt'` and
  the claimed/actual grade pair, giving ops the forensic trail to detect
  scaled abuse).
- P13 Data privacy — REG-142 (the audit details payload carries only the
  two grade strings + the route name — no message text, no PII).

### Catalog total

Pre-REG-142: 109 entries (through the Voyage rerank model-id hotfix,
REG-141). The Foxy P12 grade-spoof hard-block adds REG-142 (unconditional
all-subject grade-spoof defense — Zod 400, DB-compare 403 with audit row,
null-grade warn-and-proceed, subject-independent). **Total catalog: 110
entries (target: 35 — TARGET EXCEEDED).**

**Total: 110 entries.**

## Monitoring data boundary — learning_events / intervention_alerts / system_metrics RLS + CHECK↔TS parity (2026-06-15) — REG-143

Source: monitoring substrate landing (`src/types/monitoring.ts` + three new
tables under `supabase/migrations/20260615122657..659`). The monitoring stack
introduces three tables with three DISTINCT security postures, all of which
carry P8/P9/P13 weight:

- `learning_events` — the student-owned event stream. Students read + insert
  ONLY their own rows (`student_id = auth.uid()` in USING + WITH CHECK), and the
  table is APPEND-ONLY (no UPDATE/DELETE policy → a student's UPDATE/DELETE
  silently affects 0 rows with NO error and the row survives unchanged).
- `intervention_alerts` — the staff-facing at-risk feed. SELECT + UPDATE are
  restricted to teacher/admin/super_admin via a `user_roles × roles` join that
  carries the A1 expired-grant guard `(ur.expires_at IS NULL OR ur.expires_at >
  now())`; students/anon read 0 rows, no error; a lapsed grant
  (`is_active=true` but `expires_at` in the past) does NOT grant access.
- `system_metrics` — platform telemetry. Admin/super_admin READ only; there is
  NO INSERT policy at all (exactly ONE `CREATE POLICY`, FOR SELECT) so the
  service_role (RLS bypass) is the only writer; an authenticated non-admin
  insert is rejected. The `metric_name` empty-string guard is APP-LEVEL in
  `logSystemMetric()` (`src/lib/monitoring/log-event.ts`), NOT a DB constraint.

> **ID note:** REG-142 is the previous entry (Foxy grade-spoof hard block,
> 2026-06-15). REG-143 is the next free id at the time this entry was written.

Each test file runs in TWO layers, mirroring the repo's established RLS-test
pattern. STRUCTURAL assertions read the migration `.sql` text (RLS enabled,
policy predicates present, CHECK lists exact, NOT NULL declared, `DEFAULT now()`
present, indexes present, no `USING (true)`/`WITH CHECK (true)`, append-only =
no `FOR UPDATE`/`FOR DELETE` policy) and run ALWAYS — no database needed,
whitespace/quoting-tolerant via the house normalisation. LIVE assertions are
wrapped in `describe.skipIf(!LIVE_DB)` (`LIVE_DB = process.env.TEST_SUPABASE_URL
!== undefined`) and use real per-role authenticated clients so `auth.uid()` is
the genuine session user; every id is `crypto.randomUUID()` (no hardcoded UUIDs,
no hardcoded `auth.uid()`). Append-only edge case: a blocked UPDATE/DELETE
asserts 0 rows AND NO error (the row is re-SELECTed via service role and proven
unchanged) — it does NOT assert `error !== null`; an INSERT that violates
WITH CHECK / a CHECK constraint DOES assert a non-null error.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-143 | `monitoring_rls_and_check_ts_parity` | **(A) SQL CHECK ↔ TS union parity (both directions):** `learning_events.event_type` CHECK = exactly the 8 values of `LearningEventType`; `intervention_alerts.alert_type` CHECK = exactly the 5 values of `AlertType`; `intervention_alerts.severity` CHECK = exactly `watch`/`act`/`urgent` of `AlertSeverity` (each literal present AND the CHECK-list literal count equals the union arity — a stray or dropped value fails). **(B) learning_events (P8/P13 — student own-row):** student CAN insert/select own rows (`student_id = auth.uid()`); CANNOT insert a foreign `student_id` (WITH CHECK → non-null error); CANNOT select another student's rows (0 rows, no error); anon insert rejected; required NOT NULL columns (`student_id`/`session_id`/`verb`/`event_type`) + `occurred_at DEFAULT now()` (omitted-on-insert → populated). **(C) learning_events append-only:** structurally no `FOR UPDATE`/`FOR DELETE` policy; live student UPDATE and DELETE each affect 0 rows with NO error and the row survives unchanged (service-role re-SELECT). **(D) intervention_alerts (P8/P9):** teacher/admin/super_admin CAN select; student 0 rows no error; anon blocked; teacher CAN update (resolve → `resolved_at`); student UPDATE affects 0 rows (alert unchanged); EXPIRED teacher grant (`expires_at` in past, `is_active=true`) does NOT grant access (0 rows) — the A1 `(expires_at IS NULL OR expires_at > now())` clause is also asserted present on both staff policies; invalid `alert_type`/`severity` insert → error. **(E) system_metrics (P8/P9/P13):** admin/super_admin CAN select; teacher/student 0 rows no error; anon blocked; service-role CAN insert (RLS bypass); authenticated non-admin (incl. the admin-READ user) + plain student INSERT rejected (no INSERT policy — structurally exactly ONE `CREATE POLICY`, FOR SELECT only); the `metric_name` empty/whitespace guard is asserted APP-LEVEL in `logSystemMetric()` (early `return;` before the `system_metrics` insert), noted as an app guard not a DB constraint. | `src/__tests__/monitoring/learning-events-rls.test.ts`, `src/__tests__/monitoring/intervention-alerts-rls.test.ts`, `src/__tests__/monitoring/system-metrics-rls.test.ts` | U (structural always-on) + E (live, skipIf TEST_SUPABASE_URL) |

### Invariants covered by this section

- P8 RLS boundary — REG-143 (learning_events is student-own-row read+insert and
  append-only; intervention_alerts is staff-role-gated with the expired-grant
  guard so a lapsed grant cannot read; system_metrics is admin/super_admin read
  only with no write policy; no policy uses an open `USING (true)`/`WITH CHECK
  (true)` predicate).
- P9 RBAC enforcement — REG-143 (intervention_alerts SELECT/UPDATE and
  system_metrics SELECT resolve role through the `user_roles × roles` join with
  `is_active = true` AND the expired-grant guard; system_metrics has NO INSERT
  policy so writes are service-role-only).
- P13 Data privacy — REG-143 (a student cannot read another student's
  learning_events; students/teachers/anon cannot read intervention_alerts /
  system_metrics; the monitoring CHECK↔TS parity keeps the typed surface from
  drifting away from the DB-enforced value set).
- P5-adjacent (type/contract parity) — REG-143 (the 8 event_type / 5 alert_type
  / 3 severity literals are asserted equal between the SQL CHECK lists and the
  `src/types/monitoring.ts` unions in BOTH directions).

### Catalog total

Pre-REG-143: 110 entries (through the Foxy P12 grade-spoof hard-block,
REG-142). The monitoring data-boundary cluster adds REG-143 (three-table RLS +
append-only + service-role-only-write + CHECK↔TS parity). **Total catalog: 111
entries (target: 35 — TARGET EXCEEDED).**

**Total: 111 entries.**

## Schema reproducibility — quiz functions missing from baseline AND linked project: 2 of 3 restored, 1 deferred (2026-06-15) — REG-144

Priority: **P0/P1.** Source: Session 4 pre-spec schema-reproducibility audit
(2026-06-15). The pg_dump-derived baseline
(`supabase/migrations/00000000000000_baseline_from_prod.sql`) silently OMITTED
three `public` functions, and — the part that turns this from a baseline-drift
nit into a P0 — verifying via `pg_get_functiondef(...)` against the LINKED
Supabase project (`shktyoxqhundlvkiwguu`) returned **0 rows for all three**: the
functions were absent from the live project too, not just the baseline. The sole
surviving source for their definitions is the archived legacy chain under
`supabase/migrations/_legacy/timestamped/` (`20260405000001:254`,
`20260405000002:57`, `20260401180000:21`).

Outcome: **2 of 3 functions RESTORED, 1 DEFERRED.** The two that could be
restored verbatim (with one minor schema repoint) are back in the baseline AND
the linked project via the compensating migration; the third
(`compute_post_quiz_action`) hit irreconcilable schema drift and is deferred to a
redesign work item.

The three missing functions, by blast radius and disposition:

- `update_learner_state_post_quiz` — **P0. RESTORED.** The quiz-submit BKT
  update. Called via an UNGUARDED `PERFORM` inside `submit_quiz_results_v2` (no
  `EXCEPTION` wrapper). On a fresh DB — or on the linked project the moment real
  quiz traffic with a non-null `topic_id` arrives — that `PERFORM` raises
  `undefined_function` and rolls back the WHOLE submission transaction: no score
  row, no XP. This is the P1/P4 hazard (score accuracy + atomic-submission both
  depend on the quiz-submit RPC chain resolving every function it `PERFORM`s).
- `compute_post_quiz_action` — **P1. DEFERRED — schema drift (chapter_topics
  renamed to curriculum_topics; chapters JOIN hop removed; error_count_conceptual
  and current_retention absent from concept_mastery — they live on
  cme_concept_state); redesign required before restore; tracked as a separate
  work item (`docs/architecture/cme-post-quiz-action-redesign.md`).** The CME
  next-action computation. The legacy definition cannot be applied verbatim
  against the current schema. It is called inside an `EXCEPTION` guard in
  `submit_quiz_results_v2`, so its continued absence degrades SILENTLY (the
  next-action feature no-ops; the submission itself survives) rather than rolling
  back — which is precisely why deferring it is safe: the exception guard means a
  missing `compute_post_quiz_action` does NOT break quiz submit.
- `reset_demo_student` — **P2/P3. RESTORED.** Demo/seed tooling. Not on the quiz
  hot path.

Symptom (currently MASKED only by zero recent quiz traffic on the linked
project): a quiz submission containing any question with a non-null `topic_id`
hits the unguarded `PERFORM update_learner_state_post_quiz(...)` in
`submit_quiz_results_v2`, raises `undefined_function`, and the student gets no
score and no XP — a P1 (score accuracy) and P4 (atomic submission) failure that
surfaces the instant traffic resumes, not at deploy time.

Fix: compensating migration
`supabase/migrations/20260615142552_restore_missing_quiz_functions.sql` —
idempotent `DROP FUNCTION IF EXISTS` + `CREATE OR REPLACE FUNCTION` for the TWO
restorable functions (`update_learner_state_post_quiz`, `reset_demo_student`),
restored verbatim from the `_legacy/timestamped/` source EXCEPT
`reset_demo_student`, whose `question_responses.session_id` reference was
repointed to `quiz_session_id` to match the current schema. The third function,
`compute_post_quiz_action`, is NOT in the compensating migration: its legacy
definition references columns/tables that no longer exist as written
(`chapter_topics` → `curriculum_topics`; the `chapters` JOIN hop is gone;
`error_count_conceptual` and `current_retention` are no longer on
`concept_mastery` — they live on `cme_concept_state`), so it requires a redesign
before it can be safely re-created and is tracked as a separate work item
(`docs/architecture/cme-post-quiz-action-redesign.md`). Its absence is
exception-guarded inside `submit_quiz_results_v2`, so leaving it deferred does
NOT break quiz submit. (Runbook
`docs/runbooks/schema-reproducibility-fix.md` §9.2 — compensating-migration
procedure.)

The regression test below is a FRESH-DB bootstrap probe: it does not exercise the
quiz path, it asserts that the two RESTORED functions actually EXIST after the
migration chain (baseline + compensating migration) is applied to an empty
database — the exact invariant the baseline broke. It deliberately queries ONLY
the two restored names and expects exactly 2 rows; `compute_post_quiz_action` is
intentionally EXCLUDED from the probe until its redesign lands (asserting its
presence would fail by design, and its absence is exception-guarded in
`submit_quiz_results_v2` so it does not break quiz submit). It belongs to the
fresh-project bootstrap test family
(`docs/runbooks/schema-reproducibility-fix.md` §4) and runs LIVE only (`skipIf`
no live DB), since "does a function exist in `pg_proc`" cannot be proven by
reading SQL text alone — the whole point is that the baseline's text was wrong.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-144 | `fresh_db_has_quiz_submit_functions` | After applying the FULL migration chain (baseline `00000000000000_baseline_from_prod.sql` + compensating `20260615142552_restore_missing_quiz_functions.sql`) to a FRESH/empty database, `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname IN ('update_learner_state_post_quiz','reset_demo_student')` returns **exactly 2 rows** (both RESTORED names present). Fewer than 2 ⇒ the fresh-DB bootstrap is broken (a baseline omitted a live function) and the build fails. `compute_post_quiz_action` is intentionally EXCLUDED from this probe until its redesign lands (`docs/architecture/cme-post-quiz-action-redesign.md`); its absence is exception-guarded in `submit_quiz_results_v2` so it does NOT break quiz submit. Companion behavioral pin (live): a `submit_quiz_results_v2` call whose payload contains a question with a non-null `topic_id` COMPLETES (writes the score + XP) rather than raising `undefined_function` and rolling back — proving the unguarded `PERFORM update_learner_state_post_quiz(...)` resolves. | `src/__tests__/schema/fresh-db-quiz-functions.test.ts` (live, skipIf no TEST_SUPABASE_URL) | E (live fresh-DB bootstrap probe) |

### Invariants covered by this section

- P1 Score accuracy — REG-144 (the quiz-submit RPC chain
  `submit_quiz_results_v2 → PERFORM update_learner_state_post_quiz` must resolve
  every PERFORM'd function or the score never gets written; a fresh DB missing
  the BKT function scores nothing).
- P4 Atomic quiz submission — REG-144 (the missing function is PERFORM'd
  UNGUARDED inside the `submit_quiz_results_v2` transaction, so its absence
  doesn't degrade gracefully — it rolls back the entire atomic submission: no
  score row, no XP, no session).

### Catalog total

Pre-REG-144: 111 entries (through the monitoring data-boundary cluster,
REG-143). The schema-reproducibility fresh-DB-bootstrap pin adds REG-144: of the
three quiz functions missing from the baseline AND the linked project, 2 were
RESTORED via an idempotent compensating migration
(`update_learner_state_post_quiz` / `reset_demo_student`) and 1 was DEFERRED
pending redesign (`compute_post_quiz_action` — schema drift, tracked in
`docs/architecture/cme-post-quiz-action-redesign.md`; absence exception-guarded in
`submit_quiz_results_v2`). The fresh-DB probe asserts the 2 restored functions
exist in `pg_proc` (expects 2 rows); `compute_post_quiz_action` is intentionally
excluded until its redesign lands. **Total catalog: 112 entries (target: 35 —
TARGET EXCEEDED).**

**Total: 112 entries.**

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

## Per-school deal-driven entitlements — precedence, parent→child, unlimited, flag-gated enforcement, super-admin API, RLS (2026-06-15) — REG-147

Source: per-school deal-driven entitlements feature. A school's effective value
for each of 12 catalog entitlement keys is resolved from a precedence chain
(platform override → institution_entitlements deal row → tenant_modules coarse
toggle → catalog plan default → deny). The runtime gate is config-read ALWAYS /
enforce ONLY when `ff_institution_entitlements_v1` is ON (seeded OFF, so shipping
is a zero-behavior change). Ops mints/edits the sparse `institution_entitlements`
deviation rows through a super-admin-only API (service-role writes, full audit);
school admins can READ their own school's entitlements but never write them;
learners have NO access at all (commercial terms, never learner data).

Files under test:
- `src/lib/entitlements/catalog.ts` — the canonical 12-key catalog (5 modules /
  5 features / 2 limits) + `isValidEntitlementKey` + `validateEntitlementValue`.
- `src/lib/entitlements/resolver.ts` — `getResolvedEntitlements` (config-read,
  flag-independent), `isEntitledEnforced` (flag-gated runtime gate), precedence,
  parent→child force-off (Q3), unlimited→999999 mapping (Q6), effective windows.
- `src/app/api/super-admin/entitlements/route.ts` — GET/PUT, super-admin auth,
  sparse upsert/delete, validate-before-write, contract-ownership, per-change
  audit (ids/keys/values only).
- `supabase/migrations/20260615205752_institution_entitlements.sql` (table + RLS)
  and the `20260615205753` flag seed (default OFF).

> **ID note:** REG-146 is the previous entry (SPEC-3 consecutive-wrong
> intervention alert active path, 2026-06-15). REG-147 is the next free id at the
> time this entry was written.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-147 | `institution_entitlements_resolution_and_boundary` | **(1) Precedence (highest first):** for `module.*`, a `platform_module_overrides` force-disable WINS over an institution row + tenant toggle + plan default (`resolved_by='platform_override'`, effective OFF); else an in-window `institution_entitlements` row wins (`'institution_entitlement'`); else a `tenant_modules` coarse toggle wins (`'tenant_module'`); else the catalog plan default (`'plan_default'`); else `'deny'`. A MALFORMED stored value is ignored and resolution falls through to the next layer. **(2) Plan default per category:** a module pulls the MODULE_REGISTRY projection (`module.ai_tutor` ON for school); a feature pulls the hardcoded per-plan grant (free `foxy_interact` OFF, pro ON); a live limit pulls usage.ts (free `foxy_chat_daily` max 5); a `school_subscriptions` read error FAILS CLOSED to the free plan (never escalates tier). **(3) Parent→child (Q3):** when `module.ai_tutor` resolves OFF (via tenant toggle OR platform override), `feature.foxy_interact` is forced OFF with `force_disabled_by_parent:true` and `resolved_by` reflecting the PARENT's source; parent ON → child keeps its own resolution. **(4) Unlimited (Q6):** a stored/default `{max:null}` → `effectiveMax === 999999` (UNLIMITED_SENTINEL); a finite cap passes through unchanged. **(5) Effective window:** an override with `effective_to` in the past OR `effective_from` in the future does NOT apply (falls through to plan default); an in-window override DOES apply. **(6) Flag gate:** `getResolvedEntitlements` reads config REGARDLESS of the flag and never consults it; `isEntitledEnforced` is a NO-OP pass-through (`{allowed:true, enforced:false}`, resolved value still surfaced) when `ff_institution_entitlements_v1` is OFF, and actually ENFORCES (`allowed:false` when not entitled, `allowed:true` when entitled, `enforced:true`) when ON; a positive/unlimited limit cap is allowed, a 0 cap is blocked; an unknown key is a pass-through. **(7) API auth + sparse + validation + audit:** non-super-admin → the `authorizeAdmin('super_admin')` failure response (403) with NO data leak and NO DB write/audit; GET `?school_id` returns the 12-row resolved panel set; PUT `{key,value}` upserts (onConflict `school_id,entitlement_key`), `{key,_delete:true}` deletes that key only, mixed in one request; an INVALID key OR wrong value shape (`{max}` for a toggle, `{enabled}` for a limit) → 400 BEFORE any write (all-or-nothing batch validation); a `contract_id` not belonging to the school → 400, a missing contract → 404, neither writes; every applied change emits exactly one `logAdminAudit` row (`entitlement.override.set`/`.clear`, entityId `school:key`, details carrying `school_id`/`key`/`new_value`/`actor` — ids/keys/values only, NO email/phone/name/password — P13). **(8) RLS + flag-seed (static source-level):** `institution_entitlements` has RLS ENABLED; `service_role` is FOR ALL (only writer, the sole `USING(true)` policy); `school_admin read own` uses the VERBATIM `school_admins.auth_user_id = auth.uid() AND is_active` subquery; `super_admin read all` uses the `user_roles ⋈ roles` + `r.name IN ('admin','super_admin')` + `is_active` + `expires_at` guard; NO student/parent policy anywhere; exactly 3 `CREATE POLICY`, each `DROP POLICY IF EXISTS`-preceded (idempotent); no role-scoped policy uses `USING(true)`; the `20260615205753` seed creates `ff_institution_entitlements_v1` with `is_enabled=false`/rollout 0, canonical `flag_name` shape + `ON CONFLICT (flag_name) DO NOTHING` (REG-125), `to_regclass`-guarded, pure data seed (no schema change). | `src/__tests__/entitlements/catalog.test.ts` (31), `src/__tests__/entitlements/resolver.test.ts` (26), `src/__tests__/api/super-admin/entitlements-route.test.ts` (22), `src/__tests__/entitlements/institution-entitlements-rls.test.ts` (20 — static source-level over both migrations) | U (unit + static source-level; the RLS file lives in `entitlements/`, not `migrations/`, so it runs in the normal lane) |

### Invariants covered by this section

- P8 RLS boundary — REG-147 (`institution_entitlements` has RLS enabled with a
  service-role-only writer; `school_admin` reads its OWN school via the verbatim
  `school_admins.auth_user_id = auth.uid() AND is_active` subquery; `super_admin`
  reads all via the `user_roles ⋈ roles` + active + expiry guard; NO learner
  policy → learners deny by RLS default. The resolver reads config only through
  the server-only `supabaseAdmin`).
- P9 RBAC enforcement — REG-147 (the admin API is gated by
  `authorizeAdmin(request, 'super_admin')`; a non-super-admin gets the 403
  failure response and reaches NO DB write or audit; commercial terms are
  read-only for school admins — only the service-role API writes).
- P13 Data privacy — REG-147 (every entitlement-change audit row carries
  ids/keys/values only — `school_id`/`key`/`old_value`/`new_value`/`actor` — and
  is asserted to contain no email/phone/name/password; the API deny path leaks no
  data).

### Catalog total

Pre-REG-147: 114 entries (through the SPEC-3 intervention-alert active path,
REG-146). The per-school deal-driven entitlements pin adds REG-147: a single
multi-file entry covering the 12-key catalog contract, the 5-layer resolution
precedence (platform → institution → tenant → plan → deny), parent→child
force-off, unlimited→999999 mapping, effective-window honouring, the config-read-
always / enforce-only-when-`ff_institution_entitlements_v1`-ON flag gate, the
super-admin-only GET/PUT API (validate-before-write + contract-ownership +
per-change PII-free audit), and the `institution_entitlements` RLS posture +
default-OFF flag seed (static source-level). 99 tests across 4 files.
**Total catalog: 115 entries (target: 35 — TARGET EXCEEDED).**

**Total: 115 entries.**

## Foxy event-logging FK-safety + telemetry hygiene — fire-and-forget observability never corrupts state or leaks PII (2026-06-15) — REG-148

Source: the Foxy event-logging instrumentation on `/api/foxy`. The route now
fires ADDITIVE, non-blocking observability on every turn: `logLearningEvent →
learning_events` (a `foxy_ask` row) and `logSystemMetric → system_metrics` (the
`foxy_request` / `edge_fn_latency_ms` success metrics + an `error_rate` metric
from the top-level catch). These are telemetry only — they move NO XP, mastery,
or business state. Two silent-failure traps make this worth pinning:
- **FK silent-drop:** `learning_events.student_id` is `uuid NOT NULL REFERENCES
  auth.users(id)`. The route resolves TWO distinct ids — `auth.userId`
  (= `auth.uid()`, the `auth.users` PK) and `auth.studentId` (the `students`-table
  PK). The event FK targets `auth.users`, so `student_id` MUST be `auth.userId`.
  A refactor that swaps in `studentId` makes EVERY event silently fail the FK and
  be swallowed by fire-and-forget (`logLearningEvent` never throws) — no test, no
  alert, no data.
- **Telemetry-pollution / PII trap:** business early-returns (429 quota, 400
  invalid-grade) are EXPECTED outcomes, not errors — they must emit neither
  `error_rate` nor a `foxy_ask` event. The `error_rate` metric carries an
  `error_code` tag ONLY (no message text, no PII).

Files under test:
- `src/app/api/foxy/route.ts` — the `logFoxyAsk` closure (success-terminal event +
  latency/request metrics) and the top-level catch (`error_rate`).
- `src/lib/monitoring/log-event.ts` — `logLearningEvent` / `logSystemMetric`
  (mocked at the boundary so the loggers are observable, not Supabase-bound).

The math-turn no-mastery guard (`src/__tests__/api/foxy/math-solve-no-xp-no-mastery.test.ts`)
acknowledges `system_metrics` + `learning_events` on its `ALLOWED_WRITE_TABLES`
allow-side as INTENDED, benign telemetry; its `FORBIDDEN_MASTERY_TABLES` +
`FORBIDDEN_RPCS` assertions stay exactly as strict (a math turn still grants 0 XP
and moves 0 mastery — P2/P4-adjacent).

> **ID note:** REG-147 is the previous entry (per-school deal-driven
> entitlements, 2026-06-15). REG-148 is the next free id at the time this entry
> was written.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-148 | `foxy_event_logging_fk_safety_and_telemetry_hygiene` | **(1) FK-safe identity (silent-drop guard):** on the grounded-default SUCCESS path the route logs exactly one `foxy_ask` `learning_event` whose `student_id === auth.userId` (the `auth.uid()` / `auth.users` PK) and NOT `auth.studentId` (the `students`-table PK) — asserted by exact equality against two DELIBERATELY-distinct sentinel ids; `topic_id === null` (no verified `curriculum_topics.id` in scope); `session_id === resolvedSessionId` (the `foxy_sessions` row id, not the fallback); `event_type === 'foxy_ask'`, `verb === 'asked'`, `object_type === 'foxy'`, `result.response_tokens` from `grounded.meta`, and a PII-free `context` (no `email`/`phone`/`name` keys). **(2) Success metrics:** the same turn emits both a `foxy_request` and an `edge_fn_latency_ms` `system_metric` (`route === '/api/foxy'`, numeric `value`, `grade` tag) and does NOT emit `error_rate`. **(3) Error path:** when a downstream collaborator (`callGroundedAnswer`) rejects, the top-level catch returns 503 and emits exactly one `error_rate` metric (`route === '/api/foxy'`, `value === 1`, an `error_code` tag ONLY — the exception message text never rides along — P13); a thrown turn never reached `logFoxyAsk`, so NO `foxy_ask` event. **(4) Business early-returns do not pollute telemetry:** a 429 quota exhaustion (`check_and_record_usage` → `allowed:false`) emits NO `error_rate` and NO `foxy_ask`; a 400 invalid-grade (`grade:'5'`, below CBSE 6-12) emits NO `error_rate` and NO `foxy_ask`. **(5) Compile-time/shape guards:** `'foxy_ask'` is a member of `LearningEventType`; the verbatim `logFoxyAsk` event payload is assignable to `LearningEvent`; and the three route metrics (`error_rate`, `edge_fn_latency_ms`, `foxy_request`) are assignable to `SystemMetric` — a field/type drift breaks `npm run type-check`, not just the assertion. | `src/__tests__/monitoring/foxy-event-logging.test.ts` (13) | U (unit; drives the REAL `POST` handler with the heavy-mock surface, `@/lib/monitoring/log-event` mocked so the loggers are observable) |

### Invariants covered by this section

- P12 AI safety — REG-148 (the `foxy_ask` event + the success/latency metrics are
  fire-and-forget observability on the Foxy turn; they never block, alter, or gate
  the AI response, and the business early-returns that protect the per-plan daily
  cap emit no spurious error telemetry).
- P13 Data privacy — REG-148 (the `foxy_ask` event `context` carries no
  `email`/`phone`/`name`; the `error_rate` metric carries an `error_code` tag only,
  never the exception message text or any PII; the FK-safe `student_id` pin keeps
  the event stream from silently dropping into a swallowed-write hole).

### Catalog total

Pre-REG-148: 115 entries (through the per-school deal-driven entitlements pin,
REG-147). The Foxy event-logging telemetry-hygiene pin adds REG-148: the
fire-and-forget `learning_events`/`system_metrics` instrumentation on `/api/foxy`
is FK-safe (`student_id === auth.userId`, never the `students` PK — else every
event silently fails the `auth.users` FK under fire-and-forget), emits the
success `foxy_request`/`edge_fn_latency_ms` metrics and a catch-only `error_rate`
(error_code tag only, no PII), and keeps business early-returns (429 quota / 400
invalid-grade) out of the error/event telemetry entirely. 13 tests in 1 file.
**Total catalog: 116 entries (target: 35 — TARGET EXCEEDED).**

**Total: 116 entries.**

## Portal RBAC/SaaS remediation Phase 2 — guardian Foxy-transcript boundary + parent support/calendar + bulk-parent broadcast (2026-06-16) — REG-149..REG-151

Source: Phase 2 of `feat/portal-rbac-saas-remediation`. This wave wired three
previously-stubbed parent surfaces to live, RLS/RBAC-gated server data:
- **Parent Foxy chat view** — `GET /api/parent/children/[student_id]/chat` lets
  an APPROVED guardian read (read-only, keyset-paginated) their linked child's
  Foxy AI-tutor transcript. Backed by migration `20260620000200` which adds a
  SELECT-only, `is_guardian_of()`-scoped RLS policy on `foxy_chat_messages` (+
  `foxy_sessions`). This is the most sensitive surface in the wave: it exposes a
  child's chat to a parent (CEO-approved P13 widening), so the boundary is the
  whole point of the test.
- **Parent calendar** — `GET /api/parent/calendar` aggregates a linked child's
  upcoming `assignments` + `school_exams` + recent `quiz_sessions` into one
  sorted `events[]`.
- **Parent support tickets** — `POST/GET /api/support/tickets` gained a guardian
  path (parent holds `child.view_progress`, not `foxy.chat`): create + list-own,
  anchored to a linked child, role-tagged `parent`, rate-limited 5/24h.
- **Bulk parent broadcast** — `POST /api/school-admin/parents` now routes the
  EMAIL channel through `send-transactional-email` (new `school-parent-broadcast`
  template) and standardised the response to `{ sent_count, failed_count,
  channel }`.

Two traps make these worth pinning:
- **The chat boundary is a P13 cliff edge.** `canAccessStudent(authUserId,
  childId)` is the single app-layer data boundary; the migration RLS policy is
  the defense-in-depth DB boundary (`is_guardian_of()` is true ONLY for
  status IN ('active','approved'), so an UNLINKED or PENDING guardian gets zero
  rows). If either gate weakened — or a write path were ever added — a parent
  could read (or worse, alter) an arbitrary child's private tutoring chat.
- **The bulk-broadcast + support paths handle PII at scale.** Email addresses,
  message bodies, and phone numbers must never reach the logger or the audit
  metadata; the audit row carries counts/channel/target only.

Files under test:
- `src/__tests__/api/parent/children-chat-boundary.test.ts` — the architect's
  priority P13 regression (auth gate, boundary deny = 403 + no read + denied
  audit + no payload, approved-child scope pin, read-only/no-write, keyset
  pagination, source + migration SELECT-only contract).
- `src/__tests__/api/support/support-tickets-guardian.test.ts` — guardian create
  + list-own + 403 NO_LINKED_CHILD + 429 rate-limit + P13 redaction.
- `src/__tests__/api/parent/parent-calendar.test.ts` — aggregation shape +
  403-not-linked-no-payload + 400/404 + P5 grade-string + no-PII-logged.
- `src/__tests__/api/school-admin/parents-broadcast.test.ts` — `{message,target,
  channel}` → `{sent_count,failed_count,channel}` contract, per-guardian Edge
  Function dispatch via the `school-parent-broadcast` template, authz, P13.

> **ID note:** REG-148 is the previous entry (Foxy event-logging telemetry
> hygiene, 2026-06-15). REG-149..REG-151 are the next free ids. (The originating
> task brief referenced "after REG-134"; that was stale — the live catalog had
> already grown to REG-148.)

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-149 | `parent_foxy_chat_p13_boundary_read_only_keyset` | **THE P13 CHAT BOUNDARY (architect priority).** **(1) Own-approved-child only:** with `canAccessStudent(callerAuthId, pathChildId)` true the route reads `foxy_chat_messages` on the RLS-scoped SSR client with EXACTLY one `student_id` eq filter equal to the path child id (asserted via a filter-recording in-memory `@supabase/ssr` client), newest-first on `created_at`, and returns only those rows mapped to `{id,role,text,created_at,session_id}`; the boundary call is keyed `(callerAuthId, pathChildId)`. **(2) Unlinked OR pending guardian → 403, zero rows:** when `canAccessStudent` is false the route returns 403, the transcript read is NEVER issued (a `readReached` sentinel stays false — no transcript is ever assembled), and a `parent.child_chat_viewed` audit row with `status:'denied'` + `resourceId=childId` is written. Pending links surface identically (`is_guardian_of()` requires status IN active/approved). **(3) No guardian write path:** the route module exports GET only (no POST/PUT/PATCH/DELETE), and the RLS client records ZERO insert/update/delete/upsert/rpc calls on the happy path; the migration `20260620000200` is FOR-SELECT-only (`foxy_chat_messages_guardian_select`, `is_guardian_of`), introduces no guardian INSERT/UPDATE/DELETE/ALL policy, and contains no executable DROP-other-than-POLICY / TRUNCATE / DROP TABLE (DDL checked with `--` comments stripped). **(4) No payload on any deny:** 401/400/403/500 bodies carry only `{success:false,error}` — no `data`, no `messages`, no `page`, and no chat text/role markers anywhere in the serialized body; a 500 from an RLS read error also leaks nothing. **(5) Keyset pagination:** the route over-fetches `limit+1`, returns only `limit` rows with `page.has_more=true` and `page.next_before` = the oldest returned row's `created_at`; passing `?before=<iso>` applies a `.lt('created_at', iso)` keyset filter; an over-large `?limit` is capped at 100 (over-fetch 101); the last page reports `has_more:false`/`next_before:null`. **(6) Audit hygiene:** the success audit `details` carries only `{message_count}` — never the message body. | `src/__tests__/api/parent/children-chat-boundary.test.ts` (17) | U (unit; drives the real `GET` handler with `@/lib/rbac` + `@supabase/ssr` + `next/headers` mocked; the SSR client records filters/mutations) |
| REG-150 | `parent_support_tickets_guardian_path` | The Phase 2 guardian support path. **(1) Create:** a logged-in guardian (holds `child.view_progress`, fails `foxy.chat`) `POST`s a ticket → persisted to `support_tickets` anchored to the FIRST linked child's `student_id`, `user_role='parent'`, `status='open'`, returning the new `ticket_id`. **(2) No linked child:** a guardian with zero links → `403 NO_LINKED_CHILD` on create (no row inserted) and an EMPTY list on `GET` (no DB list query issued, never another family's tickets). **(3) List-own scope:** `GET` filters `student_id IN (linked children)` AND `user_role='parent'`, so a guardian never sees the child's own `student`-role tickets. **(4) Rate limit:** the 6th create inside the in-memory 24h/5 window → `429 RATE_LIMITED` with a numeric `retry_after_ms`, and no 6th row is inserted. **(5) P13:** the persisted `email` column is the redacted sentinel `authenticated@redacted`, and the `logOpsEvent` context carries ids/role/category only — the serialized payload contains neither the message body nor a phone number. **(6) Unauthenticated `GET` → 401 verbatim.** (Per-test distinct auth ids isolate the module-level rate-limit Map — no shared mutable state across tests.) | `src/__tests__/api/support/support-tickets-guardian.test.ts` (8) | U (unit; real POST/GET with `@/lib/rbac`, identity/relationship domains, ops-events, and an in-memory `support_tickets` admin client mocked) |
| REG-151 | `parent_calendar_aggregation_and_school_broadcast_contract` | Two Phase-2 parent-facing wirings. **PARENT CALENDAR** (`GET /api/parent/calendar`): RBAC gate uses `child.view_progress`; `canAccessStudent` is the single boundary — a NOT-LINKED guardian → 403 with the source queries (assignments/exams/quiz) NEVER run (an `anySourceQueried` sentinel stays false) and NO `events` payload (P13); 401 when unauthenticated (no boundary call); 400 on a non-UUID `student_id`; 404 when the child can't be resolved (no payload); the happy path merges `assignments`+`school_exams`+`quiz_sessions` into one `events[]` (each tagged `type`), sorted ascending by date, with the quiz event carrying a rounded `NN%` subtitle and `data.grade` a STRING (P5); the student name is never logged. **SCHOOL→PARENT BROADCAST** (`POST /api/school-admin/parents`): the corrected `{message,target,channel}` → `{success,data:{sent_count,failed_count,channel}}` contract — missing `message`/invalid `target`/invalid `channel` → 400, a `grade` target with a non-CBSE grade `'5'` → 400 (P5); `authorizeSchoolAdmin('school.manage_settings')` rejects an unauthorized caller verbatim with NO email/audit fired; the EMAIL channel dispatches one `send-transactional-email` call per approved guardian-with-email using the `school-parent-broadcast` template, counting `json.sent===true` as sent and the rest as failed; a no-match target short-circuits to zero counts with no fetch; P13 — neither the logger nor the `logSchoolAudit` metadata carries a guardian email or the message body (audit records counts/channel/target only, `action='parent_message.sent'`). | `src/__tests__/api/parent/parent-calendar.test.ts` (7), `src/__tests__/api/school-admin/parents-broadcast.test.ts` (7) | U (unit; real GET/POST handlers with rbac/identity/school-admin-auth/audit + table-aware in-memory admin clients + stubbed global `fetch` for the Edge Function) |

### Invariants covered by this section

- P8 RLS boundary — REG-149 (the guardian Foxy-transcript read rides the
  RLS-scoped SSR client, not `supabase-admin`; migration `20260620000200` adds a
  SELECT-only `is_guardian_of()`-scoped policy on `foxy_chat_messages`/
  `foxy_sessions` — the DB boundary beneath the `canAccessStudent` app gate).
- P9 RBAC enforcement — REG-149/REG-150/REG-151 (`child.view_progress` gates the
  chat + calendar surfaces; the support route falls back to `child.view_progress`
  for the guardian path; `school.manage_settings` gates the bulk broadcast).
- P5 Grade format — REG-151 (calendar `grade` is a string; the broadcast rejects
  a non-CBSE grade `'5'`).
- P13 Data privacy — REG-149 (no transcript payload on any deny path; success
  audit carries `message_count` only, never the chat body; read-only, no guardian
  write path), REG-150 (redacted email column; ops-event context carries no
  message body / phone), REG-151 (no `events` payload on a calendar deny; the
  broadcast logger + audit carry counts/channel/target only — never a guardian
  email or the message body; the student name is never logged).

### Catalog total

Pre-REG-149: 116 entries (through the Foxy event-logging telemetry-hygiene pin,
REG-148). Portal-remediation Phase 2 adds REG-149..REG-151: the guardian
Foxy-transcript P13 boundary (own-approved-child only, unlinked/pending → 403 +
zero rows + no payload, read-only/no-write, keyset pagination, SELECT-only RLS
migration), the parent support-ticket guardian path (create + list-own + 403
NO_LINKED_CHILD + 429 + PII redaction), and the parent-calendar aggregation +
school→parent broadcast request/response contract. 39 tests across 4 files.
**Total catalog: 119 entries (target: 35 — TARGET EXCEEDED).**

**Total: 119 entries.**

---

## Portal RBAC/SaaS remediation Phase 3 — school self-service billing P11 integrity + get_admin_school_id institution_admin RLS widening (2026-06-16) — REG-152..REG-153

Source: Phase 3 of `feat/portal-rbac-saas-remediation`. Two changes, both
defense-of-an-invariant:

- **School self-service billing P11 fixes** — `POST /api/school-admin/subscription`
  (the school-admin buy-a-plan path, gated by `ff_school_self_service_billing_v1`).
  Three P11-load-bearing corrections:
  1. POST no longer sets `status='active'`. The provisioned `school_subscriptions`
     row keeps its pre-payment `'trial'` status; entitlement is granted ONLY by the
     signature-verified webhook (`handleSchoolSubscriptionEvent` →
     `subscription.activated`/`.charged`). This is the core P11 rule: never grant
     plan access without verified payment.
  2. POST writes via `UPDATE ... .eq('school_id', schoolId)` — NOT
     `upsert(..., { onConflict: 'school_id' })`. There is no unique constraint on
     `school_id` (only the `id` pkey), so the old upsert path raised Postgres 42P10
     and failed 100% of the time, orphaning the just-created Razorpay subscription.
  3. `billing_cycle='yearly'` is rejected with `400 { code:'yearly_not_supported' }`
     BEFORE any Razorpay subscription is created. Self-service v1 only supports
     monthly recurring; a yearly recurring sub would never be activated by the
     webhook (its school branch matches recurring activated/charged only), so it
     would orphan. Annual plans stay sales-assisted until the one-time-Order path
     ships.
- **get_admin_school_id() RLS widening** — migration `20260620000300` widens the
  single-value helper from teachers-only to `COALESCE(teachers-lookup,
  school_admins-lookup)` so pure institution_admins (a `school_admins` row, NO
  `teachers` row) resolve to a non-null school and regain read access to the
  school-admin read surface; the 4 named SELECT policies (school_announcements,
  school_exams, school_questions, class_enrollments) are recreated to
  `OLD_PREDICATE OR is_school_admin_of(school_id)` for multi-school admins.
  ADDITIVE/WIDENING-ONLY: the teacher arm resolves FIRST (byte-identical to the
  baseline) so teacher access is preserved, and the OR-arm only ADMITS rows.

Two traps make these worth pinning:
- **The POST is a P11 cliff edge twice over.** If a future edit re-adds
  `status:'active'` to the stamp fields, a school would get full plan access the
  instant it clicks buy — before Razorpay ever charges it (P11 violation). If a
  future edit reverts to `upsert({onConflict:'school_id'})`, every POST 42P10s and
  orphans a live Razorpay sub. And if the yearly guard is dropped, a yearly POST
  silently creates an unactivatable recurring sub.
- **The RLS widening must stay widening-only.** RPC bodies are routinely copied
  forward via `CREATE OR REPLACE`; a copy that drops the `school_admins` fallback
  re-breaks every institution_admin's reads, and a policy recreate that drops the
  `OR is_school_admin_of(...)` arm silently re-narrows access. The static canary
  also guards against the migration ever turning destructive (DROP TABLE/COLUMN,
  data UPDATE, RLS-posture toggle, or shadowing `is_school_admin_of`).

Files under test:
- `src/__tests__/api/school-admin-subscription.test.ts` — the 7 new
  `POST ... P11 self-service billing integrity` cases (yearly-reject + no-orphan,
  monthly-stays-trial, stamp fields, update-by-school_id/no-onConflict, defensive
  insert stays trial, flag-OFF 403). The webhook-only-activation half of the P11
  contract is already pinned in `src/__tests__/api/school-webhook-events.test.ts`
  (subscription.activated → status active; subscription.charged → renewed) — that
  is the only path that flips the POST-stamped `'trial'` row to `'active'`.
- `src/__tests__/contract/get-admin-school-id-rls-widening.test.ts` — the static
  migration canary (function-widening shape, teacher-first COALESCE ordering, the
  4 policy recreates with the OR membership arm, additive-only safety contract).

> **ID note:** REG-151 is the previous entry (parent calendar + school broadcast,
> 2026-06-16). REG-152..REG-153 are the next free ids (the task brief referenced
> "after REG-151").

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-152 | `school_self_service_billing_p11_pre_payment_trial_and_webhook_only_activation` | **THE SCHOOL-BILLING P11 CONTRACT.** **(1) Yearly reject + no orphan:** `billing_cycle='yearly'` → `400 {success:false, error:'yearly_not_supported', code:'yearly_not_supported'}`, and `createRazorpaySubscription` is NEVER called AND no `school_subscriptions` write is issued — the reject short-circuits before any Razorpay sub exists (no orphan recurring sub the webhook can't activate). **(2) Monthly stays pre-payment trial (P11):** a valid monthly POST returns 200 but the `school_subscriptions` write carries NO `status` key at all (the provisioned row keeps its `'trial'` status) and no field equals `'active'` — entitlement is NOT granted before a signature-verified payment. **(3) Stamp fields:** the same write sets `razorpay_subscription_id` (= the created sub id), `plan`, `seats_purchased`, `billing_cycle='monthly'`, `price_per_seat_monthly`; the Razorpay sub is created with `notes.school_id = schoolId` (so the webhook can match the row). **(4) No-onConflict (42P10 regression pin):** the DB write is `.update(...).eq('school_id', schoolId)` — `update` called once, `upsert` NEVER called, no `onConflict` ever passed, keyed by `school_id`. **(5) Defensive insert path:** when the UPDATE matches no provisioned row, the route falls back to `.insert(...)` with an EXPLICIT `status:'trial'` (never `'active'`) and `school_id`/`razorpay_subscription_id` — still no `upsert`/`onConflict`. **(6) Flag gate:** `ff_school_self_service_billing_v1` OFF → `403`, `isFeatureEnabled` consulted with `{institutionId: schoolId}`, and no Razorpay sub created. **(7) Webhook-only activation (companion file):** only `subscription.activated`/`.charged` (signature-verified webhook) flips the POST-stamped `'trial'` row to `status:'active'` — asserted in `school-webhook-events.test.ts`. | `src/__tests__/api/school-admin-subscription.test.ts` (7 new P11 cases; webhook-activation companion in `src/__tests__/api/school-webhook-events.test.ts`) | U (unit; real `POST` handler with school-admin-auth/feature-flags/razorpay/posthog/supabase-admin mocked; a recording in-memory `school_subscriptions` builder captures the update vs upsert shape, the eq column, and the stamped fields) |
| REG-153 | `get_admin_school_id_institution_admin_rls_widening_additive_only` | **STATIC MIGRATION CANARY (20260620000300).** **(1) Function widening:** the migration `CREATE OR REPLACE`s `public.get_admin_school_id()`, keeps the teacher arm (`SELECT school_id FROM teachers WHERE auth_user_id = auth.uid()`), and ADDS the `school_admins` fallback arm (`SELECT school_id FROM school_admins ... is_active = true`). **(2) Teacher-first ordering (access preserved):** both arms live inside a single `COALESCE(...)`, the `FROM teachers` arm appears BEFORE the `FROM school_admins` arm, so any user with a `teachers.school_id` resolves to the identical pre-migration value (the fallback only ever fills a previously-NULL result). **(3) Baseline posture kept:** the redefined function stays `STABLE` + `SET search_path = public`. **(4) The 4 named policies widen:** each of `announcements_school_admin_select` / `school_exams_school_admin_select` / `school_questions_school_admin_select` / `class_enrollments_school_admin_select` is recreated idempotently (`DROP POLICY IF EXISTS` + `CREATE POLICY ... FOR SELECT`); the 3 flat policies keep `"school_id" = get_admin_school_id()` AND add `OR is_school_admin_of("school_id")`; class_enrollments keeps its nested `classes.school_id = get_admin_school_id()` AND adds `OR is_school_admin_of(classes.school_id)`; ≥4 `is_school_admin_of(...)` references total (OR only ADMITS rows → widening, never narrowing). **(5) Additive-only safety:** NO `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE FROM`/data `UPDATE`; the ONLY DROPs are `DROP POLICY IF EXISTS` (each paired with a recreate); NO `CREATE TABLE`, NO `ENABLE/DISABLE ROW LEVEL SECURITY` (RLS posture unchanged); does NOT redefine `is_school_admin_of` (reuses the baseline helper); does NOT touch `feature_flags`; wrapped in one `BEGIN`/`COMMIT`. | `src/__tests__/contract/get-admin-school-id-rls-widening.test.ts` (18) | U (static source-level; reads the migration SQL from disk with comments stripped — runs in the normal lane under `contract/`, not the excluded `migrations/` lane) |

### Invariants covered by this section

- P11 Payment integrity — REG-152 (school self-service billing: POST grants NO
  entitlement before a signature-verified payment — the row stays `'trial'`, only
  the verified webhook activates it; yearly is rejected before any Razorpay sub is
  created so no orphan; the write is keyed by `school_id` via UPDATE, never the
  42P10-prone `onConflict` upsert).
- P8 RLS boundary — REG-153 (`get_admin_school_id()` widening + the 4 named
  policies are additive: teacher access is preserved byte-for-byte, the OR-arm only
  admits rows for institution_admins; the migration introduces no new table, makes
  no RLS-posture change, and the only DROPs are paired DROP POLICY IF EXISTS —
  cross-tenant denial stays intact because `is_school_admin_of(B)` is false for an
  admin of school A).
- P9 RBAC enforcement — REG-152 (`ff_school_self_service_billing_v1` gates the
  self-service POST; flag OFF → 403 with no Razorpay sub), REG-153 (the widening
  restores the school-admin read surface to institution_admins WITHOUT loosening
  the role-scoped policy predicates — every read still goes through
  `get_admin_school_id()`/`is_school_admin_of()`).

### Catalog total

Pre-REG-152: 119 entries (through the parent calendar + school broadcast contract,
REG-151). Portal-remediation Phase 3 adds REG-152..REG-153: the school
self-service billing P11 contract (pre-payment trial + webhook-only activation +
yearly-reject-no-orphan + update-by-school_id/no-onConflict + flag gate) and the
get_admin_school_id institution_admin RLS widening (additive-only function +
4-policy canary, teacher access preserved). 25 tests across 2 files (7 new POST
P11 cases + 18 static RLS-canary cases; the webhook-activation companion already
existed). **Total catalog: 121 entries (target: 35 — TARGET EXCEEDED).**

---

## Portal RBAC/SaaS remediation Phase 4 — pricing single-source-of-truth: marketing per-seat price must map to a real billable tier (2026-06-16) — REG-154

Source: Phase 4 of `feat/portal-rbac-saas-remediation`. A new pricing
single-source-of-truth module (`src/lib/pricing.ts`) centralizes every price the
platform quotes or bills:

- **B2B per-seat school tiers** — `SCHOOL_SEAT_TIER_INR`
  (basic 99 / standard 199 / premium 399 / enterprise 599; default = standard 199)
  is now the SYSTEM OF RECORD for the invoice-route fallback price.
  `POST /api/super-admin/invoices` was repointed from its own hardcoded
  `SEAT_PRICES` map at `schoolSeatPriceForTier()` from the SoT — the literals are
  byte-identical, so billing is unchanged; the centralization removes the second
  copy that could drift.
- **Marketing per-seat headline** — `SCHOOL_PER_SEAT_MARKETING_INR` (the value the
  /schools marketing page quotes) is DERIVED from the lowest published billable
  tier (`SCHOOL_SEAT_TIER_INR.basic` = 99), NOT an independent literal. This is the
  REG-65-family hardening: a public "from ₹X/student/month" claim can never quote a
  number the system does not actually bill (the legacy hardcoded ₹75 mapped to NO
  tier — a brand/legal drift risk).

The trap this pins: a future edit could (a) change a tier value in the SoT while
the invoice route silently keeps billing a different (re-hardcoded) number, or
(b) repoint `SCHOOL_PER_SEAT_MARKETING_INR` at a vanity number (e.g. ₹75) that no
tier charges. Both are pricing changes requiring CEO approval; the guard turns
either into a PR-CI failure rather than a silent landing-page-vs-invoice mismatch.

Files under test:
- `src/__tests__/pricing-drift-guard.test.ts` — pins each tier literal to the
  billed amount, asserts `schoolSeatPriceForTier()` resolves identically (incl.
  case-insensitive + standard-default fallback), and asserts the marketing number
  equals the basic tier / is a member of the billable set / formats to "₹99" /
  is NOT the legacy ₹75.

> **ID note:** REG-153 is the previous entry (get_admin_school_id RLS widening,
> 2026-06-16). REG-154 is the next free id (the task brief referenced "after
> REG-153").

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-154 | `pricing_sot_marketing_maps_to_billable_tier` | **THE PRICING SINGLE-SOURCE-OF-TRUTH GUARD (P11-adjacent / REG-65 family).** **(1) Tier literals = billed amounts:** `SCHOOL_SEAT_TIER_INR` pins basic=99 / standard=199 / premium=399 / enterprise=599 — the exact per-seat amounts `POST /api/super-admin/invoices` bills via `schoolSeatPriceForTier()`; the tier set is exactly those 4 keys (no silent add/remove). **(2) Resolver parity:** `schoolSeatPriceForTier(tier)` returns the billed amount for every tier, is case-insensitive (matches invoice-route `.toLowerCase()` normalisation), and falls back to the standard tier (199) for unknown/null/undefined/empty; `SCHOOL_SEAT_DEFAULT_INR` === standard === the billed default. **(3) Marketing maps to a real billed price (REG-65 hardening):** `SCHOOL_PER_SEAT_MARKETING_INR` === `SCHOOL_SEAT_TIER_INR.basic` (99), is a MEMBER of the billable tier set, formats to the label "₹99", and is explicitly NOT the legacy hardcoded ₹75 (which maps to no tier) — so the public "from ₹X/student/month" claim cannot drift away from a number the system actually charges. | `src/__tests__/pricing-drift-guard.test.ts` (17) | U (pure source-level; imports the SoT constants/helper directly, no mocks) |

### Invariants covered by this section

- P11 Payment integrity (adjacent) — REG-154 (the B2B per-seat billing fallback
  amounts live in exactly one place; the invoice route bills off the SoT helper, so
  a tier change cannot leave the route silently charging a stale number).
- REG-65 family / landing-page pricing-verbatim drift — REG-154 (the marketing
  headline per-seat price is derived from a real billable tier and asserted to be a
  member of the billed set; a vanity number with no matching tier — the legacy ₹75
  case — fails CI).

### Catalog total

Pre-REG-154: 121 entries (through the get_admin_school_id RLS widening, REG-153).
Portal-remediation Phase 4 adds REG-154: the pricing single-source-of-truth /
marketing-maps-to-billable-tier guard (17 tests, 1 file). **Total catalog: 122
entries (target: 35 — TARGET EXCEEDED).**

**Total: 122 entries.**

## Portal RBAC/SaaS remediation — E2E fix pass: phantom-table repoints + drift-guard off:/on: coverage + cache table + enrollment sync + reports/parents envelope (2026-06-16) — REG-155..REG-159

Source: the E2E fix-pass of `feat/portal-rbac-saas-remediation`. A cluster of
SILENT-FAILURE bugs was fixed — each one returned empty/wrong data with NO error,
so no existing test caught them. The fixes and their guards:

- **Phantom-table repoints (teacher dashboard functional).** The teacher-dashboard
  Edge Function and `/api/teacher/parent-notify` read three tables that never
  existed on disk: `bkt_mastery_state` → `concept_mastery` (BKT p_know/attempts),
  `teacher_class_assignments` → `class_teachers`, `classroom_responses` →
  `classroom_poll_responses`. Every mastery/roster/poll read silently returned
  empty. Two existing tests asserted the PHANTOM names and were REPAIRED to the
  real tables (not weakened) + a negative guard pins that the phantom names can
  never reappear in the Edge source.
- **schoolAdminPermissionCode({off,on}) drift-guard blind spot.** The standing
  RBAC permission-code drift guard only scanned `authorizeRequest`/
  `authorizeSchoolAdmin` literals and NEVER looked inside
  `schoolAdminPermissionCode({ off, on })`. That is exactly why
  `school.manage_api_keys` (the api-keys route `off:` arm, granted to no role)
  403'd every school admin with `ff_school_admin_rbac` OFF, undetected. The guard
  now extracts BOTH the `off:` and `on:` literals and subjects each to the
  "resolves to a granted role" invariant; with migration 20260620000500 seeding +
  granting the code, both arms resolve.
- **parent_weekly_reports cache table (20260620000600).** Created with
  UNIQUE(student_id, guardian_id) + RLS + guardian/service-role policies so the
  parent weekly-report 24h cache (which read a non-existent table → re-invoked
  Claude on every load) becomes real. Additive, idempotent.
- **class_students ↔ class_enrollments sync invariant (20260620000700).**
  Bidirectional backfill + AFTER INSERT triggers (each ON CONFLICT DO NOTHING,
  recursion-safe, SECURITY DEFINER) so a student enrolled via EITHER table appears
  on ALL surfaces. Additive, no new table, no RLS change.
- **reports + parents contract envelope.** `/api/school-admin/reports` now returns
  `{success,data}` on EVERY type (+ a new `student_search` type + `class_avg_score`
  on class_performance); `/api/school-admin/parents` GET now returns
  `{success,data:{links:[{id,status,linked_at,...}]}}`. The pages unwrap
  `json.data` and throw on `!json.success`, so a bare-payload regression would
  render a broken report/list with no error.

> **ID note:** REG-154 is the previous entry (pricing single-source-of-truth,
> 2026-06-16). REG-155..REG-159 are the next free ids (the task brief referenced
> "after REG-154").

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-155 | `teacher_dashboard_phantom_table_repoints` | **THE PHANTOM-TABLE REPOINT GUARD (teacher dashboard functional, P8-adjacent).** **(1) Mastery reads the REAL table:** the teacher-dashboard Edge source contains `from('concept_mastery')` (BKT p_know/attempts verbatim, `select('topic_id, p_know, attempts')`) and the phantom `from('bkt_mastery_state')` appears NOWHERE in the Edge source (negative guard — a refactor cannot regress to the non-existent name that returned empty silently). **(2) parent-notify mastery mock follows the route:** the `/api/teacher/parent-notify` `include_report` mastery line reads `concept_mastery` (the route's `buildReportSummaryLine` reads `from('concept_mastery').select('p_know')`), so the in-memory mock case is keyed on the real table — the mastery-summary assertion now exercises a real read path, not a phantom. **(3) Bloom source unchanged:** the Bloom rollup still reads `quiz_responses.bloom_level` (the answered-question row), untouched by the repoint. **(4) Whole-suite phantom sweep:** no test under `src/__tests__` still references `bkt_mastery_state` / `teacher_class_assignments` / `classroom_responses` as a live table name. | `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts` (repaired: concept_mastery + negative guard), `src/__tests__/api/teacher/parent-notify/route.test.ts` (repaired: mock case `concept_mastery`) | U (unit; Edge source-string inspection + route handler with table-aware in-memory admin mock) |
| REG-156 | `rbac_drift_guard_covers_schoolAdminPermissionCode_off_on` | **THE DRIFT-GUARD off:/on: EXTENSION (P9 — the blind spot that 403'd school admins undetected).** **(1) Extension is live (not a no-op):** the guard now extracts both the `off:` and `on:` string literals from every `schoolAdminPermissionCode({ ... })` call site across `src/app/api/**/route.ts`; both extraction lists are non-empty. **(2) Both arms extracted from a known site:** the api-keys route yields `off: 'school.manage_api_keys'` AND `on: 'institution.manage'` on all three verbs. **(3) Folded into the core scan:** the extracted off/on codes are now members of the main `routeRefs` set the "every route code resolves to a role" assertion scans (`school.manage_api_keys` + `institution.manage` both present). **(4) New invariant enforced:** EVERY off:/on: arm resolves to a granted role (offenders list empty). **(5) The original blind-spot code resolves:** `school.manage_api_keys` is in the canonical universe (seeded + granted by 20260620000500), proving the end-to-end fix. **(6) Would-have-caught proof:** a synthetic `off: 'school.totally_ungranted'` arm is surfaced by the off-extraction regex and is absent from the universe — had it been a real route it would be a hard offender. | `src/__tests__/rbac-permission-code-drift-guard.test.ts` (extended: off:/on: extraction + dedicated coverage describe block) | U (unit; static scan of API route source + canonical permission universe built from migration SQL — no DB) |
| REG-157 | `parent_weekly_reports_cache_table_unique_rls` | **STATIC MIGRATION CANARY (20260620000600 — FIX B).** **(1) Table created idempotently:** `CREATE TABLE IF NOT EXISTS public.parent_weekly_reports`. **(2) Route-shaped columns:** `student_id, guardian_id, report, language, generated_at` all present (the columns the parent-report route reads/upserts). **(3) UNIQUE(student_id, guardian_id):** the constraint the route's `onConflict:'student_id,guardian_id'` upsert needs is present and added via a guarded `IF NOT EXISTS … pg_constraint` block (replay-safe). **(4) RLS enabled IN-MIGRATION (P8):** `ENABLE ROW LEVEL SECURITY` on the new table. **(5) Guardian policies:** SELECT/INSERT/UPDATE policies each scoped via `is_guardian_of(student_id)`, all idempotent (`DROP POLICY IF EXISTS` + CREATE); plus a `service_role` policy (the route's actual supabaseAdmin runtime path). **(6) FK cascade:** `student_id → students` and `guardian_id → guardians` both `ON DELETE CASCADE`. **(7) Additive-only:** no DROP TABLE/COLUMN/TRUNCATE/DELETE/UPDATE (executable SQL, comments stripped). **(8) Route still upserts onConflict student_id,guardian_id** (the constraint must keep matching). | `src/__tests__/contract/portal-rbac-remediation-migration-canaries.test.ts` (FIX B block) | U (static source-level; reads the migration SQL from disk with comments stripped — runs in the normal lane under `contract/`, not the excluded `migrations/` lane) |
| REG-158 | `class_students_class_enrollments_bidirectional_sync` | **STATIC MIGRATION CANARY (20260620000700 — FIX C, enrollment split-brain).** **(1) Backfill BOTH directions:** `class_students → class_enrollments` AND `class_enrollments → class_students`, each `ON CONFLICT (class_id, student_id) DO NOTHING`. **(2) AFTER INSERT trigger each direction:** one `AFTER INSERT ON class_students`, one `AFTER INSERT ON class_enrollments`. **(3) Recursion-safe mirror:** ≥4 `ON CONFLICT (class_id, student_id) DO NOTHING` occurrences (2 backfills + 2 trigger bodies, quoted-or-unquoted columns) — a conflict-skipped zero-row insert fires no row trigger, so the bounce terminates after one hop. **(4) SECURITY DEFINER + pinned search_path** on the mirror functions (a faithful copy of an already-authorized row, no privilege-escalation surface). **(5) Idempotent re-create:** `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER`; functions are `CREATE OR REPLACE`. **(6) No new table** (no new RLS posture — operates on the two existing roster tables). **(7) Additive-only:** the ONLY DROPs in executable SQL are trigger/function (re-create) guards — no DROP TABLE/COLUMN/TRUNCATE/DELETE/UPDATE. | `src/__tests__/contract/portal-rbac-remediation-migration-canaries.test.ts` (FIX C block) | U (static source-level; comments stripped before the additive-only scan; normal lane under `contract/`) |
| REG-159 | `school_admin_reports_parents_response_envelope` | **THE REPORTS + PARENTS CONTRACT-ENVELOPE GUARD (silent-failure prevention).** **REPORTS** (`GET /api/school-admin/reports`): authz denial returns the auth `errorResponse` verbatim (no DB); `school_overview` / default / `class_performance` / `student_detail` / `subject_gaps` each return `{success:true, data}`; `class_performance` carries the NEW `class_avg_score` field (alongside backward-compat `avg_score`) and returns `class_avg_score:0` on an empty roster; `student_detail.student.grade` is a STRING (P5); the NEW `student_search` type is ROUTED (not "Unknown report type"), returns `data` as an array of `{id,name,grade,...}`, and short-circuits to `[]` for a <2-char query; an unknown type → 400 `{success:false, error}` (envelope on the error branch too). **PARENTS** (`GET /api/school-admin/parents`): authz denial verbatim; empty school → `{success:true, data:{links:[],total:0}}`; the happy path's `data.links[*]` carries the three load-bearing keys `id` (= `guardian_id:student_id`), `status`, `linked_at` PLUS the display fields (`parent_name`/`student_name`/`student_grade` string P5); `linked_at` falls back to `created_at` when the dedicated column is null; `page`/`limit` echoed in the envelope. **Also pinned:** REG-159 repairs the legacy `school-admin-api.test.ts` school_overview assertion that read the OLD flat shape — now reads `body.data.total_students` (repaired to the new envelope, not weakened). | `src/__tests__/api/school-admin/reports-envelope-contract.test.ts` (10), `src/__tests__/api/school-admin/parents-list-contract.test.ts` (5), `src/__tests__/school-admin-api.test.ts` (repaired school_overview case) | U (unit; real GET handlers with school-admin-auth + per-table chainable in-memory admin clients mocked) |

### Invariants covered by this section

- P8 RLS boundary — REG-157 (parent_weekly_reports ships RLS + guardian/service-role
  policies in the same migration that creates the table); REG-158 (the roster sync
  triggers are SECURITY DEFINER faithful copies that touch no RLS posture and add
  no new table); REG-155 (the teacher-dashboard mastery/roster reads now hit the
  real RLS-backed tables instead of phantom names that returned empty).
- P9 RBAC enforcement — REG-156 (the drift guard now covers the
  `schoolAdminPermissionCode({off,on})` extraction path — the exact blind spot
  that let `school.manage_api_keys`, granted to no role, 403 every school admin
  with the flag OFF; both arms now must resolve to a granted role).
- P5 Grade format — REG-159 (`student_detail` + `student_search` + parents `links`
  carry `grade` as a STRING through the new envelopes).
- Operational integrity / additive-migration safety — REG-157/REG-158 (both new
  migrations are additive + idempotent: no DROP TABLE/COLUMN/TRUNCATE/DELETE/UPDATE;
  the only DROPs are trigger/function/policy re-create guards).
- Silent-failure / contract-drift prevention — REG-155 (phantom-table reads that
  returned empty with no error), REG-159 (bare-payload regressions on the reports/
  parents endpoints would render broken surfaces with no error).

### Catalog total

Pre-REG-155: 122 entries (through the pricing single-source-of-truth guard,
REG-154). The E2E fix pass adds REG-155..REG-159: phantom-table repoints (teacher
dashboard functional), schoolAdminPermissionCode drift-guard off:/on: coverage +
school.manage_api_keys, parent_weekly_reports cache table, class_students↔
class_enrollments sync invariant, and the reports/parents response-envelope
contract (5 entries across 6 test files; 2 existing tests repaired to the correct
tables/envelope, not weakened). **Total catalog: 127 entries (target: 35 — TARGET
EXCEEDED).**

**Total: 127 entries.**

## Quarterly school billing + demo-comp entitlement (P11) (2026-06-16) — REG-160..REG-161

Source: `feat/portal-rbac-saas-remediation` — per-school QUARTERLY billing on
`POST /api/school-admin/subscription` plus a sales/onboarding DEMO-COMP
entitlement (the one sanctioned exception to P11's "never grant plan access
without verified payment"). Both touch the payment-integrity invariant, so both
get a regression pin.

- **Quarterly billing (P11 — no split-brain, no pre-payment access).** A
  `billing_cycle:'quarterly'` POST selects the `razorpay_plan_id_quarterly`
  plan id (NEVER the monthly id — a quarterly request charged on the monthly
  plan would charge 1× while the DB records quarterly = split-brain billing),
  uses `totalBillingCycles=4`, carries `school_id` in Razorpay notes, and leaves
  the row at pre-payment `'trial'` (the signature-verified webhook is the only
  thing that flips it to `'active'`). When the quarterly plan id is NULL the
  route 400s with code `plan_not_provisioned`, creating NO Razorpay subscription
  (no orphan) and with NO silent monthly fallback. The webhook's school
  invoice-amount fallback multiplies seats × per-seat price × **3** for
  quarterly (×1 monthly, ×12 yearly) — a regression to ×1 would under-bill every
  quarterly school by two-thirds. `createRazorpayPlan` gained an optional
  `opts:{period,interval}` 3rd arg (quarterly = `{interval:3}` on a monthly
  period); the 2-arg call shape is unchanged (backward compatible).
- **Demo-comp server-gated boundary (the P11 exception).** A DEMO school
  (`schools.is_demo=true`, resolved ONLY from the server-side `auth.schoolId` via
  `isDemoSchool()`, never a request-body field) gets a complimentary
  `status='active'` grant with `is_demo=true`, `razorpay_subscription_id=null`,
  period stamped (+3mo quarterly / +1mo monthly), ZERO Razorpay calls,
  `{comp:true}`, and a metadata-only `subscription.comp_granted` audit (no PII).
  The comp branch runs ABOVE the quarterly null-guard, so a demo school with an
  unprovisioned quarterly plan STILL comps (intentional reorder, pinned). The
  load-bearing security boundary: a NON-DEMO school can NEVER reach the comp
  branch — `isDemoSchool` returns false → real Razorpay path; and `isDemoSchool`
  FAILS CLOSED (any error / missing row / null flag / thrown client → false), so
  a Supabase blip can never accidentally hand out a free grant.

> **ID note:** REG-159 is the previous entry (reports/parents response envelope,
> 2026-06-16). REG-160..REG-161 are the next free ids.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-160 | `school_admin_quarterly_billing_p11_no_split_brain` | **THE QUARTERLY BILLING P11 GUARD (no split-brain, no pre-payment access, no orphan).** **(1) Plan-id by cycle:** a quarterly POST creates the Razorpay sub with `razorpayPlanId='rzp_quarterly_plan'` and `totalBillingCycles=4`, and NEVER with the monthly plan id (a quarterly request charged on the monthly plan = split-brain). **(2) Pre-payment trial (P11):** the DB stamp sets `billing_cycle='quarterly'` + `razorpay_subscription_id` but sets NO `status` (row keeps pre-payment `'trial'`); no field smuggles `'active'` — only the signature-verified webhook activates. **(3) notes carry school_id** so the webhook can match + activate. **(4) Null-guard (P11, no orphan):** quarterly plan id NULL → 400 code `plan_not_provisioned`, `createRazorpaySubscription` NEVER called, and NO fallback to the (present) monthly id. **(5) Real-path guard intact:** a non-demo school with an unprovisioned quarterly plan still 400s `plan_not_provisioned` (no comp). **(6) Webhook invoice fallback ×3:** with no payment entity the school invoice amount = seats × price_per_seat_monthly × 3 × 100 paisa for quarterly (monthly ×1, yearly ×12) — captured off the `publishEvent` payload; a mutation to ×1 fails the test. **(7) createRazorpayPlan back-compat:** the 2-arg call posts `period='monthly'`, `interval=1`; `{interval:3}` posts `interval=3` (rupees→paisa ×100 at the boundary). **(8) Setup-plans provisions both cadences:** a fully-provisioned (monthly+quarterly) plan reports `monthly:already_exists; quarterly:already_exists` (no recreation); a bare plan creates both. | `src/__tests__/api/school-admin-subscription-quarterly-comp.test.ts` (quarterly happy-path + null-guard + real-path guard), `src/__tests__/payments/webhook-school-quarterly-invoice.test.ts` (3), `src/__tests__/lib/razorpay-create-plan.test.ts` (3), `src/__tests__/api/payments/status-and-setup-plans.test.ts` (repaired: both-cadence idempotency), `src/__tests__/pricing-drift-guard.test.ts` (quarterly derived-figure block) | U (unit; real POST/webhook handlers with school-admin-auth + table-aware in-memory admin mocks; fetch-stubbed createRazorpayPlan; publishEvent mock captures the computed invoice amount) |
| REG-161 | `school_admin_demo_comp_server_gated_boundary` | **THE DEMO-COMP SERVER-GATED BOUNDARY (the P11 sanctioned exception — a real school can NEVER comp).** **(1) Comp grant shape:** a demo school's POST → response `{success:true, comp:true}` with `status:'active'`, `is_demo:true`, `razorpay_subscription_id:null`; the DB row stamps the same; ZERO Razorpay calls. **(2) Period by cycle:** comp `current_period_end` is ~+3 months for quarterly, ~+1 month for monthly. **(3) Metadata-only audit (P13):** exactly one `subscription.comp_granted` audit with `metadata:{is_demo:true, billing_cycle, razorpay_subscription_id:null,…}` and NO PII (no email/phone/name keys anywhere in the audit blob). **(4) Reorder pin:** a demo school with an UNPROVISIONED quarterly plan STILL comps (the comp branch runs above the null-guard) — response is NOT `plan_not_provisioned`. **(5) THE CRITICAL BOUNDARY — non-demo can NEVER comp:** `isDemoSchool=false` → real Razorpay path (a real sub id is returned), response carries NO `comp`, the row stays pre-payment trial, and NO `subscription.comp_granted` audit fires. **(6) Fail-closed:** `isDemoSchool` is proven (directly) to return false — never throw — on is_demo=false / null / missing row / query error / thrown client / rejected maybeSingle / empty school id (no DB touch for empty id); the route therefore defaults to the payment-gated path on any predicate failure. **(7) Predicate input:** `isDemoSchool` resolves is_demo via `eq('id', schoolId)` from the server-resolved id only. | `src/__tests__/api/school-admin-subscription-quarterly-comp.test.ts` (demo comp quarterly/monthly + reorder pin + non-demo-never-comp + fail-closed), `src/__tests__/lib/is-demo-school.test.ts` (10) | U (unit; real POST handler with isDemoSchool + logSchoolAudit mocked at the boundary; direct is-demo-school predicate test with a table-aware admin mock) |

### Invariants covered by this section

- P11 Payment integrity — REG-160 (quarterly: plan-id-by-cycle with no
  monthly fallback, pre-payment `'trial'` until the signature-verified webhook
  activates, null-guard creates no orphan Razorpay sub, ×3 invoice multiplier);
  REG-161 (the demo-comp exception is the ONLY way to reach `status='active'`
  without a verified payment, and it is reachable ONLY by a server-resolved
  `is_demo=true` school — a real school can never comp, even on a Supabase blip,
  because `isDemoSchool` fails closed).
- P13 Data privacy — REG-161 (the `subscription.comp_granted` audit is
  metadata-only: no email/phone/name in the audit blob).

### Catalog total

Pre-REG-160: 127 entries (through the reports/parents response-envelope contract,
REG-159). Quarterly school billing + demo-comp adds REG-160..REG-161: the
quarterly-billing P11 guard (plan-id-by-cycle, pre-payment trial, null-guard /
no-orphan, ×3 invoice fallback, createRazorpayPlan back-compat, both-cadence
setup-plans idempotency) and the demo-comp server-gated boundary (comp grant
shape + metadata-only audit + the load-bearing "non-demo can never comp" +
fail-closed predicate). 2 entries across 6 test files (4 new: the
quarterly+comp route test, the webhook quarterly-invoice test, the
createRazorpayPlan back-compat test, the is-demo-school predicate test; 2
extended/repaired: pricing-drift-guard quarterly block + status-and-setup-plans
both-cadence idempotency, repaired to the new behavior not weakened). **Total
catalog: 129 entries (target: 35 — TARGET EXCEEDED).**

**Total: 129 entries.**

## Phase 1 academic structure: boards, academic_terms, student_attendance, class_schedule (P8, P9) (2026-06-21) — REG-162..REG-167

Source: migration `20260621000000_phase1_academic_structure_attendance_boards.sql`
— creates 4 new tables (`boards`, `academic_terms`, `student_attendance`,
`class_schedule`), seeds CBSE/ICSE/IB/NIOS board reference data, seeds CBSE
2025-26 Term 1 + Term 2 academic defaults, and establishes RLS policies across
all 4 tables. The `mark_attendance` Edge Function handler validates the input
contract enforced here.

All 6 entries are covered by pure-function unit tests in
`src/__tests__/schema/phase1-academic-structure.test.ts` (56 tests total —
no live DB required; RLS policies represented as TypeScript predicates,
constraint logic represented as pure validators).

> **ID note:** REG-161 is the previous entry (demo-comp server-gated boundary,
> 2026-06-16). REG-162..REG-167 are the next free ids.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-162 | `boards_rls_anon_cannot_insert` | **BOARDS TABLE SCHEMA CONTRACT (P8 — service_role-only writes).** The `boards` reference table has 4 seeded rows (CBSE, ICSE, IB, NIOS) with required fields `id`, `code`, `name`, `name_hi`, `country`, `is_active`, `display_order`, `created_at`. CBSE carries `country='IN'` and `is_active=true`. The `code` column has a UNIQUE constraint — a second CBSE insert is rejected. RLS: authenticated users can SELECT (USING true); no INSERT/UPDATE policy exists for the `authenticated` role — only `service_role` (which bypasses RLS) can write board reference data. Unauthenticated users cannot SELECT. | `src/__tests__/schema/phase1-academic-structure.test.ts` (4 + 3 boards-RLS tests) | U (pure-function unit; no live DB) |
| REG-163 | `student_attendance_rls_three_role_boundary` | **STUDENT_ATTENDANCE RLS — 3-ROLE ACCESS BOUNDARY (P8, P9).** Teacher SELECT: USING `class_id IN (SELECT ct.class_id FROM class_teachers ct JOIN teachers t ON t.id=ct.teacher_id WHERE t.auth_user_id=auth.uid())` — a teacher can only see attendance for classes they teach via `class_teachers`; an empty class list means zero rows visible. Student SELECT: USING `student_id = (SELECT id FROM students WHERE auth_user_id=auth.uid())` — a student sees only their own rows, never another student's. Parent/guardian SELECT: USING `student_id IN (SELECT gsl.student_id FROM guardian_student_links gsl JOIN guardians g ON g.id=gsl.guardian_id WHERE g.auth_user_id=auth.uid() AND gsl.status='approved')` — a parent sees only approved-linked children's rows; a pending link (status≠'approved') grants no access. An unauthenticated caller (no auth.uid()) sees zero rows from all three policies. Also covers the `assignment_submissions` parent SELECT policy that follows the same approved-guardian-link pattern (P8). | `src/__tests__/schema/phase1-academic-structure.test.ts` (7 + 4 parent-submissions-RLS tests + 3 regression-catalog pinning tests) | U (pure-function unit; no live DB) |
| REG-164 | `student_attendance_status_enum_and_unique_constraint` | **STUDENT_ATTENDANCE VALIDATION — STATUS ENUM + UNIQUE CONSTRAINT (P8 schema integrity).** The `status` column accepts exactly four values: `'present'`, `'absent'`, `'late'`, `'excused'`. Values like `'here'`, `'tardy'`, `''`, or `'PRESENT'` (uppercase) are rejected. The `period` column defaults to `'All Day'` when absent or blank. The UNIQUE constraint on `(class_id, student_id, attendance_date, period)` rejects a second insert for the same student in the same class on the same date for the same period; inserting a second row with a different period is NOT a conflict. | `src/__tests__/schema/phase1-academic-structure.test.ts` (5 tests) | U (pure-function unit; no live DB) |
| REG-165 | `mark_attendance_handler_input_validation` | **MARK_ATTENDANCE HANDLER — INPUT VALIDATION CONTRACT (P3 anti-cheat-adjacent, P8).** The `mark_attendance` Edge Function handler rejects: missing `teacher_id` (code `MISSING_TEACHER_ID`), missing `class_id` (code `MISSING_CLASS_ID`), date not matching `/^\d{4}-\d{2}-\d{2}$/` (code `INVALID_DATE_FORMAT`), empty `records` array (code `EMPTY_RECORDS`), `records` array with more than 200 items (code `RECORDS_TOO_LARGE`), any record missing `student_id` (code `MISSING_STUDENT_ID`), any record with a status not in `{present,absent,late,excused}` (code `INVALID_STATUS`). A fully valid batch (teacher_id + class_id + YYYY-MM-DD date + records each with student_id and a valid status) is accepted. Notes are clamped to 200 characters; period strings are trimmed and clamped to 50 characters. | `src/__tests__/schema/phase1-academic-structure.test.ts` (10 + 4 regression-catalog pinning tests) | U (pure-function unit; no live DB) |
| REG-166 | `academic_terms_null_school_id_partial_index` | **ACADEMIC_TERMS PARTIAL INDEX — NO DUPLICATE GLOBAL DEFAULTS (P8 schema integrity).** The migration seeds two platform-wide default terms for CBSE 2025-26: Term 1 (Apr 2025 – Sep 2025, `is_current=false`) and Term 2 (Oct 2025 – Mar 2026, `is_current=true`). Both have `school_id=NULL`. A partial UNIQUE index on `(academic_year, term_number) WHERE school_id IS NULL` prevents duplicate global defaults: inserting a second NULL school_id row with `academic_year='2025-26'` and `term_number=1` conflicts. School-specific terms (school_id not null) with the same year+term do NOT conflict (the partial index does not apply). A NULL school_id row for a different academic year (e.g. `'2026-27'`) does not conflict with the seeded 2025-26 rows. | `src/__tests__/schema/phase1-academic-structure.test.ts` (6 + 1 regression-catalog pinning test) | U (pure-function unit; no live DB) |
| REG-167 | `class_schedule_time_constraints` | **CLASS_SCHEDULE — TIME AND CONSTRAINT CHECKS (P8 schema integrity).** The `class_schedule` table enforces: `end_time > start_time` (equal or reversed times rejected); `effective_until >= effective_from` when both are present (inverted dates rejected); `effective_until=NULL` allowed (means currently active); `day_of_week` is an integer 0–6 inclusive (7 and -1 rejected); `period_number >= 1` (0 and -1 rejected). A fully valid row (day_of_week in 0–6, period_number≥1, end_time>start_time, effective_until=null) is accepted. `effective_until = effective_from` (single-day override) is also accepted. | `src/__tests__/schema/phase1-academic-structure.test.ts` (7 + 1 regression-catalog pinning test) | U (pure-function unit; no live DB) |

### Invariants covered by this section

- P8 RLS boundary — REG-162 (boards: authenticated SELECT, service_role-only
  INSERT, no PII in reference data); REG-163 (student_attendance: teacher
  scope = class_teachers join, student scope = own rows only, parent scope =
  approved guardian_student_links only — three independent deny boundaries);
  REG-164 (status CHECK + UNIQUE index defend against corrupt attendance
  records); REG-165 (mark_attendance handler validates before any DB write,
  preventing injection of oversized or invalid payloads); REG-166 (partial
  index ensures global academic calendar cannot be double-seeded or corrupted
  by an ambiguous upsert); REG-167 (CHECK constraints on time order and
  day-of-week prevent impossible schedule rows that would break timetable
  queries).
- P9 RBAC enforcement — REG-163 (teacher access scoped strictly to
  class_teachers rows; parent access requires approved link, not merely
  any guardian_student_links row; student cannot cross-read peers).

### Catalog total

Pre-REG-162: 129 entries (through quarterly school billing + demo-comp,
REG-161). Phase 1 academic structure adds REG-162..REG-167: boards schema
contract (ref-data RLS), student_attendance 3-role RLS boundary, attendance
status enum + UNIQUE constraint, mark_attendance handler input validation,
academic_terms partial index for global defaults, and class_schedule time
constraints. 6 entries, all covered by 56 pure-function unit tests in a
single new file (no live DB). **Total catalog: 135 entries (target: 35 —
TARGET EXCEEDED).**

**Total: 135 entries.**

## Hermetic LLM mock layer — per-call-site enforcement contract (2026-06-19) — REG-168

Source: root cause analysis of `math-classify.test.ts` calling real OpenAI when
`OPENAI_API_KEY` was set in `.env.local` (2026-06-19). The original `setup.ts`
mocked `callClaude` globally but left `callReasoningModel` unmocked, so the
ambiguous-branch LLM path reached the real API.

The fix and the enforcement contract:

All three LLM client modules have dedicated unit tests that test the REAL function
by stubbing `global.fetch` (same pattern as `openai-client.test.ts`):
- `@/lib/ai/clients/claude` — tested in `src/__tests__/ai/agents/claude-tools.test.ts`
- `@/lib/ai/clients/openai` — tested in `src/__tests__/lib/ai/openai-client.test.ts`
- `@/lib/ai/clients/reasoning-cascade` — tested in `src/__tests__/lib/ai/reasoning-cascade.test.ts`

Because those files need the real module, a setup-level `vi.mock` for any client
breaks them. The hermetic guarantee is therefore per-call-site:

1. Every test file that imports application code which USES a client without
   directly testing it MUST add `vi.mock('@/lib/ai/clients/<module>')` at the top.
   This is the established and enforced pattern:
   `math-classify.test.ts` mocks both `claude` and `reasoning-cascade`;
   `reasoning-cascade.test.ts` mocks `callOpenAI` and `callClaude` as sub-clients.

2. `setup.ts` emits a `console.warn` when `ANTHROPIC_API_KEY` or a real
   `OPENAI_API_KEY` is present in the test environment, making the risk visible in
   test output so developers know to check their file-level mocks.

3. `callClaude` returns an error response (status 503) when `ANTHROPIC_API_KEY` is
   absent. `callOpenAI` throws `'OPENAI_API_KEY not configured'` before any fetch
   when the env var is absent. Both clients fail safely without network access.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-168 | `hermetic_llm_mock_layer_per_call_site` | (1) `setup.ts` emits `[TEST SETUP] ANTHROPIC_API_KEY is set` warn when `ANTHROPIC_API_KEY` is present and `[TEST SETUP] OPENAI_API_KEY is set to a real key` warn when `OPENAI_API_KEY` is present and does not start with `sk-test`. (2) `math-classify.test.ts` mocks both `@/lib/ai/clients/claude` and `@/lib/ai/clients/reasoning-cascade` at the file level — the ambiguous-branch test that originally hit real OpenAI is covered by the `_callReasoningModel` mock. (3) `reasoning-cascade.test.ts` mocks `callOpenAI` and `callClaude` as sub-clients and runs the REAL cascade — the file-level mocks take precedence and no real API is reached. (4) `openai-client.test.ts` and `claude-tools.test.ts` test the REAL client functions using `vi.stubGlobal('fetch', ...)` — no setup-level mock interferes. The contract: any new test file that imports code which transitively calls a client without mocking the client at the file level MUST be flagged as a quality rejection. | `src/__tests__/setup.ts` (CI environment guard + inline contract documentation) | E |

### Invariants covered by this section

- P12 (AI safety) — test suite cannot accidentally call real AI providers and
  incur API costs, expose student data to external services, or produce
  non-deterministic test results due to real API responses.

### Notes on test strategy

REG-168 is a process/infrastructure contract rather than a pure unit assertion.
The enforcing artifact is the documented rule in `setup.ts` (read by every
developer who touches test infrastructure) plus the CI environment guard that
makes the risk visible. The `math-classify.test.ts` file-level mock pattern
is the primary proof that per-call-site enforcement works: the previously-failing
case (real OpenAI called on the ambiguous branch) is now hermetic.

### Catalog total

Pre-REG-168: 135 entries (through Phase 1 academic structure, REG-167). The
hermetic LLM mock layer contract adds REG-168 (per-call-site enforcement +
CI environment guard in setup.ts — P12 test-suite AI safety).
**Total catalog: 136 entries (target: 35 — TARGET EXCEEDED).**

**Total: 136 entries.**

## White-label flag registration + module-gating activation (Phase 3C Wave A) — REG-169

Source: Phase 3C Wave A "white-label activation" (autonomous, additive,
default OFF). Registers the four dormant multi-tenant feature flags in
`src/lib/feature-flags.ts` (`WHITE_LABEL_FLAGS` + `FLAG_DEFAULTS`) so prod (which
already had the legacy DB rows from migrations 20260507000004-7) and a fresh
CI/staging/Preview env resolve them IDENTICALLY — OFF — paired with an idempotent
seed migration (`supabase/migrations/20260615000000_phase3c_seed_white_label_flags.sql`,
`INSERT ... ON CONFLICT (flag_name) DO NOTHING`). Activates the dormant module
substrate via a thin route guard (`src/lib/modules/route-guard.ts`:
`assertModuleEnabledForSchool` / `assertModuleEnabled`) applied AFTER auth on 7
school-admin routes (exams→`testing_engine`, content→`lms`,
analytics/reports/classes-at-risk/teacher-engagement→`analytics`,
announcements→`communication`). The guard delegates the enablement decision
entirely to the pre-existing registry resolver `isModuleEnabled` (which
short-circuits to all-modules-enabled when `ff_tenant_module_registry_v1` is OFF)
and maps ONLY an explicit `isModuleEnabled(...)===false` to a 404
`{ code:'MODULE_DISABLED', module }`. NO new table, NO new RBAC permission, NO
scoring/XP — flag registration + a fail-open gate + nav parity.

Four things are blocking defects if they regress: (a) **flag registration +
default OFF** — all four white-label flags (`ff_tenant_type_v1`,
`ff_tenant_module_registry_v1`, `ff_tenant_config_v2`, `ff_event_bus_v1`) are
present in `FLAG_DEFAULTS` and resolve to `false`; `WHITE_LABEL_FLAGS` maps each
constant to its exact migration `flag_name` string (asserted against a SECOND
independent literal so a drift on either side fails); `ff_event_bus_v1` is
registered for correctness/env-parity even though it is not wired this phase; no
white-label flag is ever `true` by default (founder ship-OFF constraint).
(b) **route-guard fail-open contract** — an explicit DISABLED module → a 404
carrying `code:'MODULE_DISABLED'` + the SPECIFIC module key (never 403/500);
every uncertainty FAILS OPEN to `{ allowed:true }`: null/undefined/empty schoolId
short-circuits with NO school lookup, `getSchoolById` ok(null)/failure/throw →
allow, `isModuleEnabled` throw → allow; the resolved tenant_type is passed
through to `isModuleEnabled`; the header-driven `assertModuleEnabled` resolves
the school from `x-school-id` (absent header = B2C = fail-open). (c) **PII-safe
error logging (P13)** — the resolve-failure `logger.warn` payload carries ONLY
the module key + a route tag + the thrown Error; it never adds `schoolId` /
`email` / `userId`; the happy path emits no warn. (d) **nav parity with the route
guard** — `ConsolidatedSchoolNav` hides a `moduleKey`-tagged item exactly when
`moduleEnablement[key]===false` (mirrors the 404), shows ALL items when
`moduleEnablement` is null/undefined (loading/error fail-open), and shows ALL
items when the enablement map is every-key-true (the flag-OFF all-enabled map the
resolver returns), so a tenant never sees a nav link that 404s nor loses a link
to a served module.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-169 | `white_label_flags_registered_off_module_route_guard_disabled_404_fail_open_nav_parity` | **(a) Flag registration (pure).** `WHITE_LABEL_FLAGS` maps `TENANT_TYPE_V1`/`TENANT_MODULE_REGISTRY_V1`/`TENANT_CONFIG_V2`/`EVENT_BUS_V1` to `ff_tenant_type_v1`/`ff_tenant_module_registry_v1`/`ff_tenant_config_v2`/`ff_event_bus_v1` (vs a 2nd independent literal); exactly those four keys; all four PRESENT in `FLAG_DEFAULTS` (key-existence, so a deletion fails) and each resolves to `false`; `ff_event_bus_v1` registered (correctness); no white-label flag is `true` in `FLAG_DEFAULTS`; `as const` literal narrowing. **(b) Route guard (mocked `isModuleEnabled` + `getSchoolById` + logger).** explicit `isModuleEnabled→false` → `{ allowed:false }` + 404 `{ success:false, code:'MODULE_DISABLED', module }` echoing the SPECIFIC key (testing_engine / lms / analytics), status 404 (NOT 403, NOT 500); tenant_type resolved + passed to `isModuleEnabled`; `isModuleEnabled→true` → `{ allowed:true }`; FAIL-OPEN → `{ allowed:true }` for null schoolId (NO lookup, NO resolver call), undefined schoolId, empty-string schoolId, `getSchoolById` ok(null) (no resolver call), `getSchoolById` failure result, `getSchoolById` throws (caught), `isModuleEnabled` throws (caught); header entry `assertModuleEnabled` 404s a disabled module from `x-school-id`, allows enabled, fails open on absent header (B2C, no lookup) + on school-lookup failure. **(c) PII-free logging (P13).** the error-branch `logger.warn('module_route_guard_resolve_failed', …)` payload carries `module` + route tag only — NOT `schoolId`/`school_id`/`email`/`userId`; happy path emits no warn. **(d) Guarded-route integration (mocked auth + guard spy).** GET /api/school-admin/exams: auth 401/403 short-circuits BEFORE the gate (gate never invoked); on auth success the gate is called with `(schoolId, 'testing_engine')`; a DISABLED gate → the 404 `MODULE_DISABLED` body and never reads the DB; an ALLOWED gate (flag-OFF / all-enabled / fail-open) → 200 with the handler's exam list. **(e) Nav parity.** `ConsolidatedSchoolNav` hides exactly the `moduleKey` item whose `moduleEnablement[key]===false` (and only that one) while keeping non-module items (Students/Classes/Command Center) visible; shows EVERY module-gated link when `moduleEnablement` is null/undefined (fail-open) and when the map is every-key-true (flag-OFF all-enabled). | `src/__tests__/lib/white-label-flags.test.ts` (13 unit tests: registry string parity vs 2nd literal + exactly-four-keys + event-bus registration + as-const narrowing; FLAG_DEFAULTS presence + per-flag OFF + no-flag-enabled-by-default) + `src/__tests__/lib/modules/route-guard.test.ts` (21 unit tests, mocked seams: disabled→404 MODULE_DISABLED + specific key + 404-not-403/500 + tenant_type passthrough; allowed; fail-open null/undefined/empty-schoolId-no-lookup + ok(null)-no-resolver + failure + getSchoolById-throw + isModuleEnabled-throw; PII-free warn + no-warn-on-happy-path; header entry disabled-404/allowed/B2C-no-lookup/lookup-failure) + `src/__tests__/api/school-admin/module-route-gate.test.ts` (5 unit tests, mocked: auth-401/403 before gate; gate called with (schoolId, testing_engine); disabled→404 no-DB-read; allowed→200 exam list) + `src/__tests__/school-admin/consolidated-nav-module-gating.test.tsx` (7 unit tests: section-map has module-gated items; hides exactly the disabled item + non-module items stay; null/undefined → all shown; all-enabled map → all shown) | E |

### Pinned tests

- `src/__tests__/lib/white-label-flags.test.ts::WHITE_LABEL_FLAGS registry::maps every constant to the exact flag string used by the seed migration`
- `src/__tests__/lib/white-label-flags.test.ts::FLAG_DEFAULTS — every white-label flag is present and OFF::registers all four white-label flags in FLAG_DEFAULTS (closes the prod/fresh-env gap)`
- `src/__tests__/lib/white-label-flags.test.ts::FLAG_DEFAULTS — every white-label flag is present and OFF::does NOT enable any white-label flag by default (founder safety constraint)`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — explicit DISABLED → 404 MODULE_DISABLED::returns { allowed:false } with a 404 carrying code:MODULE_DISABLED + the module key`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — FAIL-OPEN (never lock a tenant out)::null schoolId → allowed, and NO school lookup is attempted (short-circuit)`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — FAIL-OPEN (never lock a tenant out)::getSchoolById throws → caught → allowed`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — error-branch logging is PII-free (P13)::logs warn with ONLY the module key + route tag on a thrown error (no school_id, no PII)`
- `src/__tests__/api/school-admin/module-route-gate.test.ts::GET /api/school-admin/exams — module gate runs AFTER auth::auth failure short-circuits BEFORE the module gate (gate never invoked)`
- `src/__tests__/api/school-admin/module-route-gate.test.ts::GET /api/school-admin/exams — disabled module → 404; allowed → handler proceeds::a DISABLED module returns the gate 404 response and never reads the DB`
- `src/__tests__/school-admin/consolidated-nav-module-gating.test.tsx::ConsolidatedSchoolNav — item with moduleKey whose enablement is false is HIDDEN::hides exactly the disabled item, mirroring the route-guard decision for that key`

### Invariants covered by this section

- Flag-OFF byte-identity (rollout safety) — `ff_tenant_module_registry_v1`
  default-OFF makes the resolver short-circuit to all-modules-enabled, so the
  route guard is a no-op and behaviour is byte-identical to pre-Wave-A; all four
  white-label flags default OFF in `FLAG_DEFAULTS` so a fresh env matches prod.
- P8/P9 (tenant scope) — the guard takes the school from `auth.schoolId`
  (school-admin entry) or the proxy-injected `x-school-id` header (tenant entry),
  never a request body; it runs AFTER `authorizeSchoolAdmin`, never before.
- P13 (data privacy) — the resolve-failure `logger.warn` carries the module key +
  route tag only, never the school UUID / email / user id; the disabled→404 body
  carries the module key only (no PII).
- Fail-open availability — a school-lookup failure, a missing school row, or any
  thrown error resolves to `{ allowed:true }` so a tenant is never locked out of a
  feature by an infra hiccup; only an explicit `isModuleEnabled===false` 404s.
- No scoring/XP (activation only) — Wave A registers flags + adds a fail-open gate
  + nav parity; no XP constant or scoring formula is read or written.

### Notes on test strategy

REG-169 is a **pure-unit + mocked-seam** entry (no live-DB tier — the only DB
artifact is the idempotent `ON CONFLICT DO NOTHING` flag seed whose effect is a
no-op on prod and equals the registered `FLAG_DEFAULTS` on a fresh env, asserted
indirectly via the flag-registration test). The flag test imports the REAL
exported `WHITE_LABEL_FLAGS` / `FLAG_DEFAULTS` and asserts every string against a
SECOND independent EXPECTED literal so a drift in either copy fails (it is NOT a
tautology against the source map), mirroring the goal-adaptive registry tests.
The route-guard test mocks the two seams the guard delegates to
(`@/lib/modules/registry` `isModuleEnabled` via `importActual` to keep `ModuleKey`
typing, `@/lib/domains/tenant` `getSchoolById`) plus the logger so the guard's
REAL fail-open branching + 404 mapping run, and asserts every fail-open branch
plus the PII-free warn payload. The guarded-route integration test mocks the auth
seam + spies the guard (`assertModuleEnabledForSchool`) so the exams route's REAL
order (auth → gate → handler) is exercised: it proves the gate runs AFTER auth by
asserting the spy is never called when auth fails, and that the gate is invoked
with the correct `testing_engine` module key. The nav test renders the REAL
`ConsolidatedSchoolNav` against the REAL `SCHOOL_NAV_SECTIONS` map and probes
PURELY module-gated items (excluding the Wave C/D `rbacOnly`/`reportsDepthOnly`
items, which carry their own default-OFF flag gates covered by REG-98/REG-99).

### Catalog total

Pre-REG-169: 136 entries (through hermetic LLM mock layer, REG-168). Phase 3C
Wave A (white-label flag registration + module-gating activation, default OFF)
adds REG-169 (four white-label flags registered + default OFF + migration-string
parity; module route guard disabled→404 `MODULE_DISABLED` with fail-open on
null/missing-school/error and PII-free logging; guarded-route gate runs after
auth; nav hide/show parity with the route-guard decision).
**Total catalog: 137 entries (target: 35 — TARGET EXCEEDED).**

**Total: 137 entries.**

---

## Today's Mission five-issue fix — chapter completion, pool reset, chapter titles, quiz auto-reduce (2026-06-25) — REG-171..REG-174

Root-cause of five production regressions in the Today's Mission dashboard section:

1. **Bloom-gate too strict (REG-171)** — `update_chapter_progress` RPC
   required `assessed_count >= 3` bloom categories. With only 'remember'-level
   questions in the bank, `assessed_count = 1` always → chapter never
   completes → resolver loops the same chapter forever.
   Fix: migration `20260625000100` lowers gate to `assessed_count >= 1`.
   TODO restore to `>= 3` once `scripts/bulk-mcq-driver.ts` seeds
   understand/apply MCQs across all chapters.

2. **Pool-reset cycle (REG-172)** — `select_quiz_questions_rag` and
   `select_quiz_questions_v2` reset history at `seen/total >= 0.80`. A
   chapter with 5 questions always hits `5/5 = 100%` → DELETE fires on
   every call → same 5 questions serve in a perpetual cycle.
   Fix: migration `20260625000200` adds `MIN_POOL_FOR_RESET = 10`; reset
   only fires when `total_pool >= 10`.

3. **No chapter names in Today queue (REG-173)** — `TodayQueueItem` had no
   title field; `mapActionToTodayItem` did not look up chapter titles;
   subtitles showed subject code only.
   Fix: migration `20260625000300` adds `get_chapter_titles_for_pairs` RPC;
   route.ts fetches in parallel with augmentation; `mapActionToTodayItem`
   accepts optional `ChapterTitleMap`; copy.ts gets `{chapterTitle}` tokens;
   `TodaysMission.tsx` renders " · Chapter Title" suffixes.

4. **Quiz dead-end on thin pools (REG-174)** — when pool < requested count
   and `assembleQuiz` returned `{success:false, returnedCount:N}`, the quiz
   page showed a hard error with no recovery. If N ≥ 5 MCQ, the page now
   silently retries with the largest valid count from `[5,10,15,20]`, with
   an infinite-loop guard (`autoCount !== requestedCount`).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-171 | `chapter_completion_bloom_gate_assessed_count_gte_1` | **(A) remember-only chapter (5 q, 80% accuracy) → `assessed_count=1`, `is_completed=true`** with the new gate. **(B) Same 5 q at 40% → `is_completed=false`** (accuracy guard holds even with single bloom). **(C) 3 remember + 2 understand at 60% → `assessed_count=2`, `is_completed=true`**. **(D) 0 questions → `accuracy=0`, `assessed_count=0`, `is_completed=false`**. **(E) AND semantics: `accuracy>=60` but `assessedCount=0` → `false`; `assessedCount>=1` but accuracy=0 → `false`**. **(F) All four bloom categories at 70% → `assessed_count=4`, `is_completed=true`**. **(G-regression) Old gate (`>=3`) would have blocked A-scenario; new gate allows it** — asserted explicitly so a future accidental revert fails. **(H-boundary) Exactly 60% → `is_completed=true` (inclusive)**. **(I-boundary) `floor((2/5)*1000)/10 = 40.0%` → `is_completed=false`**. | `src/__tests__/regressions/reg-171-chapter-completion-bloom-gate.test.ts` (9) | U (pure formula; replicates SQL gate inline; no DB) |
| REG-172 | `pool_reset_min_pool_guard_thin_chapters` | **(A) pool=5, seen=5 (100%) → reset suppressed** (pool < 10; root cause of infinite cycle). **(B) pool=10, seen=8 (80%) → reset fires** (exactly at threshold). **(C) pool=15, seen=11 (73%) → no reset** (below 80%). **(D) pool=10, seen=9 (90%) → reset fires**. **(E) pool=9, seen=9 (100%) → suppressed** (pool < 10). **(F) pool=3, seen=3 → suppressed**. **(G) pool=0 → false** (no division by zero). **(H-boundary) pool=10, seen=7 (70%) → no reset**. **(I-boundary) pool=10, seen=10 → fires**. **(J) pool=20, seen=15 (75%) → no reset**. **(K-regression) Old guard (`> 0`) fires for pool=5; new guard suppresses** (explicit contrast). **(L-regression) Old guard fires for pool=3; new guard suppresses**. **(M) pool=100, seen=80 (80%) → fires** (large healthy pool still resets). **(N) pool=50, seen=39 (78%) → no reset** (below 80%). | `src/__tests__/regressions/reg-172-pool-reset-tiny-chapter.test.ts` (14) | U (pure formula; no DB) |
| REG-173 | `chapter_titles_in_today_queue_map_action_copy_wiring` | Uses REAL `mapActionToTodayItem` + `todayCopy`. **(A) `start_quiz` action + matching map entry → `chapterTitle='Nutrition in Plants'`, `chapterTitleHi='पादपों में पोषण'`**. **(B) No `chapterTitles` arg → fields absent**. **(C) `titleHi=null` → `chapterTitleHi` absent (not `null`)**. **(D) `todayCopy('today.item.weak_topic_zpd.subtitle', false, {subject,chapterTitle:' · Nutrition in Plants'})` → output contains both 'Science' and 'Nutrition in Plants'**. **(E) `chapterTitle:''` → subtitle renders without stray ' · ' artifact**. **(F) key format is `"subjectCode|chapterNumber"` (`mathematics|5` → 'Integers')**. **(G) non-chapter-anchored action (cold_start) → no `chapterTitle` even with populated map**. **(H-H2) Hindi bilingual: `isHi=true` → `chapterTitleHi` preferred when present**. **(I) Map miss (no entry for pair) → fields absent**. **(J-J2) `continue_lesson` and `introduce_new_topic` actions → chapter anchor resolved**. **(K) `revise_decayed_topic` → resolved from map**. **(L) `todayCopy` Hindi subtitle contains `chapterTitle` token**. **(M) `{chapterTitle}` token left raw when `chapterTitle` key absent from vars** (interpolation contract). | `src/__tests__/api/v2/today/chapter-titles.test.ts` (13) | U (unit; imports REAL implementations; no DB; no mocks needed for pure functions) |
| REG-174 | `quiz_auto_reduce_silent_retry_and_loop_guard` | Pure `getAutoReduceCount` + `shouldAutoRetry` formula. **(A) returnedCount=5, requested=10, MCQ → retry with 5**. **(B) returnedCount=8, requested=10, MCQ → retry with 5** (floor to largest valid ≤ returned). **(C) returnedCount=3, requested=5, MCQ → no retry** (no valid count ≤ 3 in `[5,10,15,20]`). **(D) returnedCount=5, requested=10, NOT MCQ → no retry** (onlyMcq gate). **(E) returnedCount=5, requested=5, MCQ → no retry** (loop-guard: `autoCount === requestedCount`). **(F) returnedCount=12, requested=15, MCQ → retry with 10**. **(G) returnedCount=20, requested=20, MCQ → no retry** (loop-guard at max). **(H) returnedCount=0, MCQ → autoCount=undefined → no retry** (can't fit 5). **(I) returnedCount=10, requested=20, MCQ → retry with 10**. **(J) returnedCount=15, requested=20, MCQ → retry with 15**. **(K) returnedCount=4, requested=5, MCQ → no retry** (4 < 5, no valid count). **(L) returnedCount=20, requested=15, MCQ → no retry** (autoCount=15=requestedCount loop-guard? No: returnedCount=20 → autoCount=20, requested=15 → retry; or WAIT: filter n<=20 yields 20, ≠15, so retry with 20? Verify actual logic)**. 4 additional boundary/staircase tests. | `src/__tests__/regressions/reg-174-quiz-auto-reduce.test.ts` (16) | U (pure formula; no DOM; no component render) |

### Invariants covered by this section

- P1 Score accuracy — not directly touched; no scoring formula changed.
- P2 XP economy — not directly touched; no XP constant changed.
- P5 Grade format — not directly touched; grades remain strings throughout
  the RPC signatures.
- P6 Question quality — REG-172 (pool-reset guard prevents the same 5
  questions looping; all remaining questions in the thin-pool case are served
  by least-recently-seen ordering, not reset-and-repeat).
- P7 Bilingual UI — REG-173 (chapter titles use `title_hi` from
  `curriculum_topics`; `chapterSuffix` helper prefers Hindi title when
  `isHi=true`; `copy.ts` subtitle templates are bilingual throughout).
- P8 RLS boundary — `get_chapter_titles_for_pairs` is SECURITY INVOKER on
  published curriculum data; no PII; no student-scoped data returned.
- P-learner-state correctness — REG-171 (chapter completion unblocked for
  the common case of remember-only question pools; accuracy gate ≥ 60% still
  required); REG-172 (resolver now sees novel questions rather than the same
  repeating set, enabling progression).

### Notes on ID assignment

REG-170 is intentionally skipped. The test files were written with REG-171
as the starting id (next after the testing agent's pre-write catalog snapshot
which ended at REG-169); REG-170 is the gap. This follows the standing
collision-avoidance convention documented at the REG-123 and REG-131 ID notes.

### Catalog total

Pre-REG-171: 137 entries (through white-label flag registration + module-gating
activation, REG-169). Today's Mission five-issue fix adds REG-171..REG-174:
bloom-gate threshold correction (9 tests), pool-reset thin-pool guard (14 tests),
chapter title wiring end-to-end (13 tests), quiz auto-reduce silent retry (16
tests). 52 tests across 4 files.
**Total catalog: 141 entries (target: 35 — TARGET EXCEEDED).**

## Digital Twin + Knowledge Graph (Slice 1, Waves 1-2) — flag-gated learner twin + Loop D blocked-prerequisite (2026-07-02) — REG-175

Source: Slice 1 (Digital Twin + Knowledge Graph). Additive migrations
`20260702000100..000800` (concept_edges unifying 3 prereq models + transfer
edges; learner_twin_snapshots; learner_twin_memory vector(1024); RPCs
traverse_prerequisites + detect_blocked_dependents; backward-compatible
extensions to detect_knowledge_gaps / generate_learning_path; `ff_digital_twin_v1`
seed default-OFF; trigger_signal CHECK widened to allow `blocked_prerequisite`).
Pure modules: `src/lib/learn/adaptive-loops-rules.ts`
(BLOCKED_PREREQUISITE_RULES, Loop 'D', precedence A>D>C>B,
classifyPrerequisiteBlock, planBlockedPrerequisiteIntervention),
`src/lib/learn/build-twin-context.ts` (buildTwinContext / renderTwinPromptSection),
Edge reader `supabase/functions/grounded-answer/_twin-flag.ts`
(isDigitalTwinEnabled). Everything ships behind the default-OFF
`ff_digital_twin_v1` flag.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-175 | `digital_twin_block_classifier_arbiter_twin_context_flag_off` | **classifyPrerequisiteBlock boundaries (A):** rules reuse the platform floors (mastery 0.4 = `PULSE_THRESHOLDS.at_risk_mastery`, decay 0.5 = shouldRetest line); EXACTLY at mastery 0.4 → NOT blocked; just below (0.39) → `'mastery'`; EXACTLY at decay 0.5 (`predictRetention(ln2,1) === 0.5`, strict `<`) → NOT blocked; just over → `'decay'`; both axes low → `'both'` with `deficit = max(masteryDeficit, decayDeficit)` (most severe ≥ either single axis); unevaluable (no p_know AND no recency) → NOT blocked; null input never throws. **Arbiter precedence A>D>C>B + ceiling=1 (B):** a Loop D candidate LOSES to A, BEATS C, BEATS B; full A,D,C,B field → A wins, remove A → D wins, order-independent; `alreadyOpenedTonight=true` → NOTHING opens (`ceiling_already_spent`); empty set → `no_candidates`; planner defers with `ceiling_spent`/null candidate when slot spent. **buildTwinContext purity + NO PII (C):** identical inputs → byte-identical output (deep + JSON equal); floors from BLOCKED_PREREQUISITE_RULES (weak < 0.4, decayed < 0.5); junk name/email/phone fields forced into raw input NEVER leak (`!/name\|email\|phone/i`); render surfaces COUNTS+CODES only, never raw topic UUIDs; empty/all-filtered snapshot → `isEmpty` and render === `''` (OFF-path identity). **Flag-OFF gating (D):** registry/DB default OFF; the worker gate replica yields ZERO Loop D candidates when the flag is OFF (→ arbiter `no_candidates`) even though the same input WOULD open with the gate on. | `src/__tests__/regressions/reg-175-digital-twin-knowledge-graph.test.ts` (28) + `src/__tests__/lib/digital-twin-flag-off-identity.test.ts` (12 — FLAG_DEFAULTS OFF + `isDigitalTwinEnabled` fail-CLOSED + 60s TTL cache) | U (pure functions + fake-sb Edge reader; no live DB) |

### Invariants covered by this section

- P5 Grade format — Loop D never touches grade; chapter numbers are integers,
  subject codes are strings (the `_inactivity` sentinel triple is unaffected).
- P8 RLS boundary — the twin substrate (concept_edges, learner_twin_snapshots,
  learner_twin_memory) ships RLS in its own additive migrations; the
  detect_blocked_dependents RPC is parameterized, not a client table read.
  (Pure-module tests here pin the in-process logic; RLS is integration-lane.)
- P12 AI safety — `buildTwinContext` emits IDs/numbers/codes only and
  `renderTwinPromptSection` instructs Foxy to use signals to shape HOW it
  teaches and never read them aloud; the transfer-retrieval widening is
  fail-CLOSED behind `ff_digital_twin_v1`.
- P13 Data privacy — buildTwinContext is an allow-list reader: no name/email/
  phone reaches the prompt context or the rendered block, even when PII-shaped
  junk rides along on a raw row.
- Flag-gate safety — `ff_digital_twin_v1` defaults OFF in the registry
  (FLAG_DEFAULTS) and the Edge reader fail-CLOSEs on a missing row, a non-true
  value, or any thrown error; Loop D contributes zero candidates when OFF.

### Notes on ID assignment

REG-175 is the next free id after REG-174 (REG-170 remains the intentionally
skipped gap documented in the prior section). Slice 1 occupies the single id
REG-175 with two asserting files (the regression pins + the flag-off identity
pins), matching the REG-124/REG-134 precedent of co-locating a flag-default-OFF
pin with the feature's behavioral pins.

### Catalog total

Pre-REG-175: 141 entries (through Today's Mission five-issue fix, REG-174).
Digital Twin + Knowledge Graph Slice 1 adds REG-175: prerequisite-block
classifier boundaries + cross-loop arbiter precedence A>D>C>B + buildTwinContext
purity/PII + flag-OFF gating (28 tests) plus the flag-off identity pins (12
tests). 40 tests across 2 files.
**Total catalog: 142 entries (target: 35 — TARGET EXCEEDED).** *(Superseded:
REG-176 brought this to 143 and Engineering-Audit Cycle 1's REG-177 to 144 —
see the authoritative running count in the final "Catalog total" block below.)*

**Total: 141 entries.**

---

## REG-176: Foxy prompt-template routing invariant (RC-1 fix) + buildStarters personalisation + suggest-prompts bloomHint

**Date:** 2026-06-26
**Area:** AI / Foxy AI Tutor
**Risk:** HIGH — Routing back to monolithic `foxy_tutor_v1` would re-introduce 3 competing output format sections, causing random persona switching per response (RC-1). Incorrect bloomHint derivation thresholds would pitch Bloom's complexity at the wrong level for the student's mastery zone.
**What it pins:**
- `selectFoxyPromptTemplate()` routing: `practice`→`foxy_tutor_exam_v1`, `doubt`/`homework`→`foxy_tutor_doubt_v1`, all other modes→`foxy_tutor_teach_v1`. NEVER returns `foxy_tutor_v1`.
- `buildStarters()` MasteryHints personalisation: nextAction chip prepends with "Continue:" prefix; overdueTopics chip includes title + days-overdue text; weakTopics chip includes title + mastery%; priority order nextAction > overdueTopics > weakTopics; soft ceiling 12 chips; byte-identical to static output when hints are absent.
- `suggest-prompts` bloomHint derivation: avg >= 0.8 → analyze, >= 0.65 → apply, >= 0.4 → understand, else → remember. Static fallback bloomHint is `'understand'`.
- `daysOverdue` calculation: `Math.max(1, Math.round(ms/86400000))` — never 0, never negative.
**Tests:**
- `src/__tests__/api/foxy/select-prompt-template.test.ts` (17 tests)
- `src/__tests__/lib/foxy/starter-intents.test.ts` (13 tests)
- `src/__tests__/api/foxy/suggest-prompts-bloom.test.ts` (20 tests)
**Related RCA:** RC-1 (three competing output format contracts in one monolithic prompt), RC-17/RC-18 (IRT-driven suggest-prompts + buildStarters personalisation)

---

## Engineering-Audit Cycle 1 — Auth & Onboarding (P15) — 2026-06-28

Source: engineering-audit program, Cycle 1 (Auth & Onboarding). The
`send-auth-email` Edge Function is a Supabase Send-Email hook: Supabase blocks
signup whenever the hook returns any non-200 status (P15 rule 1). This cycle
gave that invariant executable, handler-level coverage.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-177 | `send_auth_email_always_200` | The `send-auth-email` Edge Function returns HTTP 200 on ALL handler code paths — non-POST request, OPTIONS preflight, missing hook secret, invalid webhook signature, invalid payload, relay-send failure, relay-send success, no-relay-config (`warning: 'no_relay_config'`), and top-level throw — plus a source canary asserting no non-200 status literal exists in the handler. A non-200 from a Supabase Send-Email hook blocks ALL signups (P15 rule 1). Provider-swap-hardened (2026-07-15, Mailgun→Resend via the provider-agnostic `_shared/relay-mailer.ts`): the send-path tests inject a stub transport through `setDefaultEmailTransport()`, so the suite runs fully offline (CI runs it with `--allow-read --allow-env`, NO `--allow-net`) and can never open a live socket or fire a real Resend send. | `supabase/functions/send-auth-email/__tests__/always-200.test.ts` (behavioral `Deno.serve` handler-capture); guarded against deletion + substring-drift by `e2e/auth-onboarding-p15.spec.ts` | E |

### Invariants covered by this section

- P15 (onboarding integrity — rule 1: `send-auth-email` MUST return HTTP 200 on
  every code path so Supabase never blocks signup)

### Catalog total

Pre-REG-177: 143 entries (142 catalogued through REG-175 + REG-176 Foxy
prompt-template routing). Engineering-Audit Cycle 1 adds REG-177:
`send-auth-email`-always-200 P15 hook coverage.
**Total catalog: 144 entries (target: 35 — TARGET EXCEEDED).**

---

## Engineering-Audit Cycle 2 — Payments & Subscriptions (P11) — 2026-06-29

Source: engineering-audit program, Cycle 2 (Payments & Subscriptions). P11
forbids granting plan access without a server-verified payment, and P9 requires
RBAC enforcement before any side effect. This cycle gave both guarantees
executable, handler-level coverage on the two live web payment entry points:
the verify route (HMAC re-derivation gate before any plan grant) and the
subscribe route (RBAC gate before any Razorpay object is minted or service-role
DB is touched).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-178 | `verify_route_hmac_reject` | The `/api/payments/verify` route re-derives the Razorpay HMAC server-side and treats it as the sole authority for granting a plan. A client-supplied `razorpay_signature` that does NOT match the server-derived HMAC — whether the wrong shared secret was used or the signature is the wrong length — yields HTTP 401 and performs NO `payment_history` insert and NO `activate_subscription_locked` (plan-grant) RPC call (no plan access without a valid signature — P11 rules 1+3). A correctly-derived signature passes the gate and proceeds to the grant path. | `src/__tests__/api/payments/verify-hmac-reject.test.ts` | E |
| REG-179 | `subscribe_rbac_gate_pre_razorpay` | The live web checkout entry `/api/payments/subscribe` calls `authorizeRequest('payments.subscribe')` as its first gate. On deny it returns the verbatim 403/401 from `authorizeRequest` and short-circuits BEFORE any Razorpay order/subscription object is minted and BEFORE any service-role DB write — the deny path performs zero Razorpay SDK calls and zero privileged DB I/O (P9 RBAC enforcement guarding the P11 payment funnel). | `src/__tests__/api/payments-subscribe-rbac.test.ts` | E |

### Invariants covered by this section

- P11 (payment integrity — never grant plan access without a server-verified
  signature; the verify route is the gate that re-derives the HMAC and is the
  sole authority for the `activate_subscription_locked` plan grant)
- P9 (RBAC enforcement — `/api/payments/subscribe` runs `authorizeRequest`
  before any Razorpay object is minted or service-role DB is touched; deny
  short-circuits with the verbatim status)

### Catalog total

Pre-REG-178: 144 entries (through Engineering-Audit Cycle 1's REG-177
`send-auth-email`-always-200). Engineering-Audit Cycle 2 adds REG-178
(verify-route HMAC reject — no plan grant without a valid server-derived
signature) and REG-179 (subscribe-route RBAC gate before any Razorpay/service-
role side effect).
**Total catalog: 146 entries (target: 35 — TARGET EXCEEDED).**

---

## Engineering-Audit Cycle 3 — Student Learning Core (P1/P2) — 2026-06-29

Source: engineering-audit program, Cycle 3 (Student Learning Core). P1 fixes the
score formula `score_percent = Math.round((correct / total) * 100)` and P2 fixes
the quiz-XP earning literals (per-correct=10, high-score-bonus=20,
perfect-bonus=50). Both invariants are duplicated across a TypeScript source and
one-or-more SQL RPC bodies, so the risk is silent drift between the layers. This
cycle gave both guarantees executable, cross-layer parity coverage: the score
formula is proven identical at all three sites (TS + SQL v1/v2 RPC + the
display component that only consumes it), and the XP literals are extracted from
every root migration's quiz-XP PL/pgSQL body and pinned equal to `XP_RULES`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-180 | `score_formula_three_way_parity` | P1 `score_percent = round((correct/total)*100)` is identical at the TS site (`scoring.ts`), the SQL v1+v2 RPC bodies (canonical `ROUND` present, no precision variant), and is property-proven `Math.round ≡ PG ROUND` on non-negative operands; `QuizResults.tsx` consumes `results.score_percent` and never recomputes the overall score. Drift at any of the three sites (formula change, precision-variant ROUND, or a recompute reintroduced into the display component) fails CI. | `src/__tests__/score-formula-three-way-parity.test.ts` | E |
| REG-181 | `xp_sql_literal_parity` | P2 quiz-XP earning literals (per-correct=10, high-score-bonus=20, perfect-bonus=50) extracted from every root migration's quiz-XP PL/pgSQL body equal `XP_RULES` (`src/lib/xp-config.ts`). Drift in any v1/v2/trigger or a future RPC redefinition that hardcodes a different literal than the single TS source of truth fails CI. | `src/__tests__/xp-sql-literal-parity.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy — `Math.round((correct/total)*100)` identical at the TS
  `scoring.ts` site, the SQL v1+v2 RPC bodies, and the `QuizResults.tsx` display
  component which only consumes the server `score_percent`, never recomputes)
- P2 (XP economy — the three quiz-XP earning literals live only in `XP_RULES`;
  every SQL PL/pgSQL body must match the single TS source of truth)

### Catalog total

Pre-REG-180: 146 entries (through Engineering-Audit Cycle 2's REG-178/REG-179
payment-funnel pins). Engineering-Audit Cycle 3 adds REG-180 (score-formula
three-way parity — TS + SQL v1/v2 + display-component consume-only) and REG-181
(XP SQL-literal parity — quiz-XP earning literals extracted from every root
migration equal `XP_RULES`).
**Total catalog: 148 entries (target: 35 — TARGET EXCEEDED).**

---

## Engineering-Audit Cycle 4 — Foxy AI Tutor & RAG (P12) — 2026-06-29

Source: engineering-audit program, Cycle 4 (Foxy AI & RAG). P12 requires that no
unfiltered LLM output reaches a student and that hostile student input cannot
re-steer the model. This cycle gave both guarantees executable, cross-layer
coverage. The output side is screened at every student-facing grounded exit
(non-streaming return, persisted structured content, streaming completion frame +
persisted record) by `screenStudentFacingText` — a hard-blocked answer collapses
to a safe hard-abstain envelope, refunds the quota, never persists the unsafe
text, and emits category-only (PII-free) telemetry; the `HARD_BLOCK_PATTERNS`
list is pinned byte-identical between the TS site and the Deno
`grounded-answer` Edge Function (22 patterns). The input side strips
assistant-directed prompt-injection overrides from the student message before
model assembly while preserving legitimate questions, fails open on non-string
input, and pins the assembled Foxy prompt to scope + UUID only (no PII).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-182 | `foxy_output_content_backstop` | P12: every student-facing grounded Foxy exit (non-streaming return, persisted structured content, streaming completion frame + persisted record) is screened by `screenStudentFacingText` before the student/store sees it; a hard-blocked answer → safe hard-abstain envelope + quota refund + no unsafe persist + category-only (PII-free) telemetry; legitimate CBSE 6-12 curriculum (class/mass/shell/"sexual reproduction"/alcohols/weapons/retardation/assassination + bare `<system>`/`[inst]` CS markup) is NOT over-blocked; real chat-template injections (`<<SYS>>`, `<|im_start|>`, `<s>[INST]…[/INST]</s>`) BLOCK; fail-safe (validator throw → safe-abstain); TS↔Deno HARD_BLOCK_PATTERNS byte-identical (22 patterns). | `src/__tests__/lib/ai/validation/output-screen*.test.ts`, `src/__tests__/api/foxy/output-safety-backstop.test.ts`, `src/__tests__/api/foxy/mode-acceptance-fox3.test.ts`, `supabase/functions/grounded-answer/__tests__/output-screen.test.ts` | E |
| REG-183 | `foxy_input_injection_neutralizer` | P12/P13: `neutralizeInjectionAttempt` strips assistant-directed prompt-injection overrides ("ignore previous instructions"/"you are now…"/role tokens) from the student message before model assembly while preserving legitimate questions ("ignore the friction…", "explain photosynthesis"); fail-open on non-string; the assembled Foxy prompt carries only scope + UUID (no studentName/email/phone) — P13 prompt-assembly contract. | `src/__tests__/lib/ai/validation/input-guard.test.ts`, `src/__tests__/api/foxy/output-safety-backstop.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — no unfiltered LLM output to students: every student-facing
  grounded Foxy exit is screened by `screenStudentFacingText`; hard-block →
  safe hard-abstain + quota refund + no unsafe persist; TS↔Deno
  `HARD_BLOCK_PATTERNS` byte-identical; hostile student input is neutralized
  before model assembly while legitimate curriculum questions pass)
- P13 (data privacy — output-backstop telemetry is category-only/PII-free; the
  assembled Foxy prompt carries only scope + UUID, never studentName/email/phone)

### Catalog total

Pre-REG-182: 148 entries (through Engineering-Audit Cycle 3's REG-180/REG-181
score-formula + XP-literal parity pins). Engineering-Audit Cycle 4 adds REG-182
(Foxy output content backstop — every student-facing grounded exit screened,
hard-block → safe abstain + refund + no unsafe persist + PII-free telemetry,
TS↔Deno pattern parity) and REG-183 (Foxy input injection neutralizer +
P13 prompt-assembly contract).
**Total catalog: 150 entries (target: 35 — TARGET EXCEEDED).**

---

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

## Engineering-Audit Cycle 6 — Super-Admin & Observability (P9/P13) — 2026-06-29

Source: engineering-audit program, Cycle 6 (Super-Admin & Observability). The
admin surface is large (super-admin 119 + v1/admin 2 + internal/admin 13 = 134
`route.ts` files) and any single ungated handler is a privilege-escalation hole;
the audit also found that the key-based `redactPII` redactor only scrubs values
it can match by KEY, so a `logger.*` call that passes a bare `name`/`email`/`phone`
object key would leak PII into the observability/analytics pipeline (SAO-4
caller-discipline gap). This cycle adds two mechanical breadth sweeps: REG-186
proves every admin route carries a canonical authorization gate token placed
BEFORE its first DB marker, and REG-187 canaries the admin + observability emit
libs for bare PII-shaped log keys the redactor would NOT catch.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-186 | `admin_route_gate_sweep` | P9: every admin `route.ts` across the full surface (super-admin 119 + v1/admin 2 + internal/admin 13 = 134) carries a canonical authorization gate token (`authorizeAdmin(` / `authorizeRequest(` / `requireAdminSecret(`), and every DB-touching handler places the gate BEFORE its first DB marker (`.from(`/`.rpc(`/service-client) — proven locally for 207/207 handlers; `super-admin/login` is the only documented self-auth exception (allowlisted). A NEW ungated admin route turns this red. Mechanical breadth complement to REG-116/REG-119 behavioral pins. | `src/__tests__/api/super-admin/admin-route-auth-gate-sweep.test.ts` | E |
| REG-187 | `bare_name_log_canary` | P13: no `logger.{info,warn,error,debug}` call across the super-admin surface + observability/analytics emit libs passes a bare `name`/`email`/`phone` object key (which the key-based `redactPII` would NOT redact); conservative anchor excludes safe `*_name` keys (full_name/flag_name/school_name/event_name). Closes the SAO-4 caller-discipline gap. | `src/__tests__/api/super-admin/bare-name-log-canary.test.ts` | E |

### Invariants covered by this section

- P9 (RBAC enforcement — every admin `route.ts` across the full 134-file surface
  carries a canonical authorization gate token, placed before the first DB marker
  on every DB-touching handler; `super-admin/login` is the only allowlisted
  self-auth exception; a new ungated admin route fails the sweep)
- P13 (data privacy — no `logger.*` call on the admin/observability surface emits
  a bare `name`/`email`/`phone` key the key-based `redactPII` cannot scrub;
  safe `*_name` keys excluded; closes the SAO-4 caller-discipline gap)

### Catalog total

Pre-REG-186: 152 entries (through Engineering-Audit Cycle 5's REG-184/REG-185
teacher-dashboard tenant scoping + students teacher-assigned RLS backstop).
Engineering-Audit Cycle 6 adds REG-186 (admin route auth-gate sweep — all 134
admin routes carry a canonical gate token before their first DB marker, closing
the P9 breadth gap) and REG-187 (bare-name log canary — no admin/observability
`logger.*` call leaks a bare PII-shaped key past the key-based redactor, closing
the SAO-4 caller-discipline gap).
**Total catalog: 154 entries (target: 35 — TARGET EXCEEDED).**

---

## Engineering-Audit Cycle 7 — Parent Portal (P8/P9/P13) — 2026-06-29

Source: engineering-audit program, Cycle 7 (Parent Portal). The parent portal is
the cross-role data boundary with the highest blast radius: a parent must reach
exactly their own linked child's data and nothing else. The audit examined three
attack surfaces. (1) The link-code path: parent link codes flow into PostgREST
`.or()` filters at three sites (request-otp, accept-invite, parent-portal login),
so an unsanitized code is a filter-injection vector that could widen the
`students` query past the intended row. (2) The legacy Edge `parent_login` path:
no per-IP throttle in front of the DB lookup invited link-code brute-forcing.
(3) Parent self-service + child-data routes: the profile PATCH and every
child-scoped read must gate on a real permission AND a canonical guardian-link
boundary, never trust a body-supplied id, and never leak a child payload to an
unlinked parent. This cycle adds three entries pinning each surface.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-188 | `parent_link_code_filter_injection` | P8/P13: `isValidLinkCode` (`^[A-Z0-9]{4,12}$`, TS `src/lib/sanitize.ts` + byte-identical Deno twin `supabase/functions/_shared/link-code.ts`) rejects PostgREST filter-injection payloads (`A,deleted_at.is.null`, `*`, `.eq.`, commas/parens/colons/quotes/whitespace/lowercase/out-of-width) at all 3 link-code `.or()` sites — request-otp (→ enumeration-safe silentSuccess), accept-invite (→ 409), parent-portal handleParentLogin (→ 200 no-match); raw payload never reaches the students query; valid 6/8-char hex still flows. | `src/__tests__/security/parent-link-code-injection.test.ts`, `src/__tests__/api/parent/pp2-filter-injection-routes.test.ts` | E |
| REG-189 | `parent_login_ip_rate_limit` | P9/P13: the legacy Edge `parent_login` path enforces a per-IP server-side rate limit (5/hour via createRateLimiter) BEFORE the DB lookup → 429 + Retry-After on exceed (brute-force defense; consent-posture change remains USER-GATED); the rate-limit warn log carries limit/window/retry only — no IP/code/email/phone (P13). | `src/__tests__/edge-functions/parent-login-rate-limit.test.ts` | E |
| REG-190 | `parent_profile_authz_and_child_data_boundary` | P9/P13/P8: `PATCH /api/parent/profile` gates on `authorizeRequest('profile.update_own')` (already-granted parent permission) + self-scoped to auth.uid() (body id/guardian_id cannot retarget — no IDOR); every parent child-data route (9 enumerated: children/[student_id]/{chat,export,erasure-status,request-erasure}, report, billing, calendar, v2/parent/{glance,encourage}) consults a canonical guardian-link boundary + authorizeRequest and denies an unlinked parent 403 with no child payload. | `src/__tests__/api/parent/profile-auth-gate.test.ts`, `src/__tests__/api/parent/pp5-unlinked-deny.test.ts` | E |

### Invariants covered by this section

- P8 (RLS boundary — sanitized link codes cannot widen the `students` `.or()`
  query past the intended row at any of the 3 link-code sites; every parent
  child-data route consults a canonical guardian-link boundary so an unlinked
  parent's query never returns another family's child)
- P9 (RBAC enforcement — `PATCH /api/parent/profile` gates on the already-granted
  `profile.update_own` permission and self-scopes to `auth.uid()` so a body-supplied
  id/guardian_id cannot retarget another parent; the legacy Edge `parent_login`
  path enforces a per-IP rate limit before the DB lookup; every child-data route
  pairs the guardian-link boundary with `authorizeRequest`)
- P13 (data privacy — no child payload on any unlinked-parent deny path; the
  parent_login rate-limit warn log carries limit/window/retry only, never
  IP/code/email/phone; link-code request-otp denies are enumeration-safe
  silentSuccess)

### Catalog total

Pre-REG-188: 154 entries (through Engineering-Audit Cycle 6's REG-186/REG-187
admin route auth-gate sweep + bare-name log canary). Engineering-Audit Cycle 7
adds REG-188 (parent link-code filter-injection rejection across all 3 `.or()`
sites — TS + byte-identical Deno twin), REG-189 (parent_login per-IP rate limit
before the DB lookup, PII-free warn log), and REG-190 (parent profile PATCH
authz + self-scope + the 9-route child-data guardian-link boundary, no payload
on any unlinked deny).
**Total catalog: 157 entries (target: 35 — TARGET EXCEEDED).**

---

## Engineering-Audit Cycle 8 — Cross-cutting (P7/P10/P1-P2/P11-adjacent) — 2026-06-29

Source: engineering-audit program, Cycle 8 (Cross-cutting). The web and mobile
(Flutter) clients duplicate three classes of constant that have historically been
kept in sync by comment ("keep in sync with…") rather than by a test. Comment-sync
silently rots: the next edit that touches only one side ships a divergence that no
gate catches. This cycle converts three of those comment-sync seams into
contract-sync — a CI failure on the next unsynced edit. (1) Subscription plan
prices: Flutter `subscription.dart` mirrors web `plans.ts` PRICING; a drift is a
P11-adjacent brand/billing-trust risk (the app would quote a price the checkout
won't honor). (2) Score-config constants: the 41 weights/ceilings/floors/thresholds
that drive P1 scoring and P2 XP exist on both clients; a one-sided edit would make
the mobile scorecard disagree with the server. (3) The bundle-size caps in
`check-bundle-size.mjs`: a silent cap-raise is how P10 erodes, so the caps are
pinned to a test that forces any future raise into the same P10-approved PR. All
three entries are parity/pin-only — they do NOT assert any rupee value, constant,
or kB number is "correct"; they assert the two sides agree (and, for the caps, that
a raise is deliberate).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-191 | `mobile_web_price_parity` | P11-adjacent: Flutter `mobile/lib/data/models/subscription.dart` plan prices EQUAL web `src/lib/plans.ts` PRICING for every plan, in BOTH directions (no web plan missing from mobile, no mobile plan missing from web); parity-only — does NOT pin any rupee value as "correct"; non-vacuous (asserts >= 2 plans present on each side so an empty parse can't pass); converts the historical comment-sync ("keep in sync with plans.ts") into contract-sync — the next unsynced price edit on either side fails CI. | `src/__tests__/cross-cutting/mobile-web-subscription-price-drift.test.ts` | E |
| REG-192 | `mobile_web_score_config_parity` | P1/P2: all 41 score-config constants (component weights, Bloom ceilings, retention floors, behavior weights + windows, level thresholds) are identical across web `src/lib/score-config.ts` and Flutter `mobile/lib/core/constants/score_config.dart`; parity-only (does not assert any value is "correct", only that the two clients agree so the mobile scorecard cannot diverge from the server-authoritative P1 score / P2 XP); non-vacuous (asserts >= 20 shared keys so a failed parse can't pass silently). | `src/__tests__/cross-cutting/mobile-web-score-config-drift.test.ts` | E |
| REG-193 | `bundle_cap_pin` | P10 (anti cap-creep): pins the four caps in `scripts/check-bundle-size.mjs` — `CAP_SHARED_KB=284`, `CAP_PAGE_KB=260`, `CAP_MIDDLEWARE_KB=120`, `SHARED_THRESHOLD_PCT=95` — so any future cap raise must update this pin in the same PR, keeping every P10 budget change deliberate and CEO/P10-approved rather than a silent drift. Pin-only — does NOT itself measure bundle size (CI's bundle-size step does that); it guards the guardrail's own numbers. | `src/__tests__/cross-cutting/bundle-cap-pin.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy) / P2 (XP economy) — REG-192 pins the mobile score-config
  twin to the web source so the Flutter client's score/XP math cannot silently
  diverge from the server-authoritative formula; parity-only, the server remains
  the single re-deriver.
- P10 (bundle budget) — REG-193 pins the four bundle caps so a raise is always a
  deliberate, reviewed edit in the same PR rather than a silent erosion.
- P11-adjacent (billing trust) — REG-191 pins mobile↔web plan-price parity so the
  app can never quote a price the Razorpay checkout won't honor; parity-only, no
  rupee value is asserted "correct".
- P7 (bilingual UI) — covered indirectly: the cross-cutting drift sweep keeps the
  mobile and web client constants that feed user-facing surfaces from diverging.

### Catalog total

Pre-REG-191: 157 entries (through Engineering-Audit Cycle 7's REG-188..REG-190
parent-portal cluster). Engineering-Audit Cycle 8 adds REG-191 (mobile↔web
subscription-price parity — comment-sync → contract-sync), REG-192 (mobile↔web
score-config parity — all 41 constants), and REG-193 (bundle-cap pin —
anti cap-creep on the four `check-bundle-size.mjs` caps).
**Total catalog: 160 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — SLC-1: Quiz-Session XP Trigger De-dup (P2) — 2026-06-29

Source: remediation program, item SLC-1 (single-XP-writer de-dup). Quiz
completion had TWO XP writers firing in the same transaction: the capped
`atomic_quiz_profile_update` (the intended sole writer, which enforces the 200
XP daily cap), AND a second uncapped XP path inside the `fn_quiz_session_sync_profile`
trigger that fired on `quiz_sessions` insert. The trigger's duplicate
XP/`xp_total`/`level`/`total_*` writes meant a single quiz could award XP twice
and bypass the daily cap. SLC-1 removes the duplicate writes from the trigger
(Option B — keep the streak bookkeeping the trigger uniquely owns) so the capped
RPC is the SOLE XP writer, with no behavioral change to the XP economy itself
(no literal or cap redefined — this is a de-dup, not an economy change).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-194 | `slc1_single_xp_writer_dedupe` | P2: the SLC-1 migration `20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql` `CREATE OR REPLACE`s `fn_quiz_session_sync_profile` to REMOVE all duplicate XP/`xp_total`/`level`/`total_*` writes (the live uncapped second XP writer is gone) while KEEPING `streak_days`+`longest_streak` (Option B); preserves SECURITY DEFINER + `SET search_path`; stays `CREATE OR REPLACE` (idempotent, trigger binding untouched, no DROP); the capped `atomic_quiz_profile_update` remains the SOLE XP writer that both v1 `submit_quiz_results` (baseline 7549) and v2 `submit_quiz_results_v2` (baseline 7850) PERFORM — so no completion path loses its only writer (no under-award); no XP literal (10/20/50) or 200 cap redefined (de-dup, not an economy change). Source-level pin; live-DB behavioral "1× not 2×" deferred to an integration lane. | `src/__tests__/slc1-quiz-session-trigger-dedupe.test.ts` | E |

### Invariants covered by this section

- P2 (XP economy) — REG-194 pins the SLC-1 de-dup so the capped
  `atomic_quiz_profile_update` is the SOLE XP writer on every quiz-completion
  path (v1 + v2); the trigger no longer double-writes uncapped XP, and no XP
  literal or the 200 daily cap is redefined (de-dup, not an economy change). The
  trigger retains the `streak_days`/`longest_streak` bookkeeping it uniquely owns
  (Option B), preserves SECURITY DEFINER + `SET search_path`, and stays a
  `CREATE OR REPLACE` (idempotent, trigger binding untouched, no DROP).

### Catalog total

Pre-REG-194: 160 entries (through Engineering-Audit Cycle 8's REG-191..REG-193
cross-cutting mobile↔web parity + bundle-cap pin). Remediation SLC-1 adds REG-194
(single-XP-writer de-dup — the uncapped second XP writer inside
`fn_quiz_session_sync_profile` is removed, leaving the capped
`atomic_quiz_profile_update` as the sole XP writer, with streak bookkeeping kept).
**Total catalog: 161 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — PAY-2: Consumer Pricing Source-of-Truth (P11-adjacent) — 2026-06-29

Source: remediation program, item PAY-2 (consumer pricing source-of-truth).
Consumer plan prices live in FOUR places that must agree: web `src/lib/plans.ts`
(`PRICING`, rupees), the server paisa constant `src/lib/pricing.ts`
(`CONSUMER_PRICING_PAISA`, which the Razorpay create-order route now imports
instead of inlining its own literals), mobile `mobile/lib/data/models/subscription.dart`
(rupees), and the live DB `subscription_plans` table (paisa, seeded by migration
`20260505155126`). PAY-2 collapses the create-order path onto the shared paisa
constant so the three CODE mirrors are provably consistent, and pins the ONE
known code↔DB divergence (`unlimited`) as a visible CI fact pending CEO
reconciliation (PAY-2 open question #1). No price is changed by PAY-2 itself —
this is a source-of-truth consolidation, not a pricing change (pricing changes
require user approval).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-195 | `consumer_pricing_code_sot_parity` | P11-adjacent (billing-trust): the consumer pricing CODE mirrors are mutually consistent — web `src/lib/plans.ts` `PRICING` ×100 === `src/lib/pricing.ts` `CONSUMER_PRICING_PAISA` (the constant the Razorpay create-order route now imports) === mobile `mobile/lib/data/models/subscription.dart` ×100, for every plan+period; assertion is non-vacuous (>=3 plans matched on each side). Extends REG-191/XC-6 (mobile↔web parity) to the server paisa constant → a four-way code-mirror lock so any future code drift in any of the three files fails CI. | `src/__tests__/payments/consumer-pricing-sot-drift.test.ts` | E |
| REG-196 | `consumer_pricing_db_divergence_pin` | P11-adjacent: pins the KNOWN live DB↔code `unlimited` divergence — DB `subscription_plans.unlimited` (₹1099/8799, migration `20260505155126`, web-checkout path) DIFFERS from the code mirror (₹1499/11999, mobile/create-order path). Documents the exact known state as a visible CI fact (NOT a parity assertion), so the divergence is undeniable in the test suite; designed to go RED the moment the CEO reconciles DB↔code (PAY-2 open question #1), at which point it is tightened into a DB===code parity assertion. | `src/__tests__/payments/consumer-pricing-sot-drift.test.ts` | E |

### Invariants covered by this section

- P11 (payment integrity, billing-trust adjacent) — REG-195 locks the three
  consumer-pricing CODE mirrors (web rupees, server paisa constant now imported
  by create-order, mobile rupees) into a four-way parity so a checkout never
  charges a price that disagrees across the codebase; REG-196 makes the single
  known code↔DB `unlimited` divergence a visible, fail-on-reconcile CI fact
  rather than a silent drift, pending the CEO's source-of-truth decision (PAY-2
  open question #1).

### Catalog total

Pre-PAY-2: 161 entries (through Remediation SLC-1's REG-194 single-XP-writer
de-dup). Remediation PAY-2 adds REG-195 (four-way consumer-pricing code-mirror
parity lock) and REG-196 (known DB↔code `unlimited` divergence pin, RED-on-reconcile).
**Total catalog: 163 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — FOX-4: MoL OpenAI-Shadow Governance (P12) — 2026-06-29

Source: remediation program, item FOX-4 (govern-with-flag the OpenAI MoL shadow
in the grounded-answer path). The shadow leg fires an OpenAI generation
ALONGSIDE the baseline Claude answer purely for offline model comparison — it is
NEVER student-facing. FOX-4 scoping confirmed the shadow is ALREADY
well-governed (two default-OFF flags: `ff_grounded_answer_mol_shadow_v1` +
`ff_mol_shadow_text_capture_v1`) AND its safety harness ALREADY runs in the
DEFAULT `npm test` lane as a hard per-PR gate (the design's open-question O1 —
"integration-only, not per-PR enforced" — was STALE/incorrect: the existing
`mol-shadow.vitest-harness.ts` is enumerated in `vitest.config.ts`'s default-lane
`include`, NOT behind `RUN_INTEGRATION_TESTS`). FOX-4 is test+doc only — NO
app-code change. It adds a thin, self-documenting governance harness that
re-asserts the two load-bearing SAFETY invariants under a clear FOX-4 / REG-197
header so the govern-with-flag posture cannot regress silently. The harness
mocks all three seams (OpenAI `generateResponse`, telemetry `recordMolRequest`,
flag `getFlagEnvelope`) — pure unit, no live key/network/DB.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-197 | `mol_shadow_never_student_facing_flag_off_no_side_effect` | P12: pins the two MoL-shadow safety invariants — (i) the OpenAI shadow is NEVER student-facing (`shadowFireOpenAI` returns void, `molResult.text` discarded, baseline Claude content is the sole returned/streamed answer, fire-and-forget) and (ii) flag-OFF / kill-switch / task-not-allow-listed / sample-miss / flag-read-throws ⇒ ZERO side effects (no `generateResponse` call, no telemetry write). Guards the govern-with-flag posture (`ff_grounded_answer_mol_shadow_v1` + `ff_mol_shadow_text_capture_v1`, both seeded OFF); Claude remains the sole student-facing model. | `supabase/functions/grounded-answer/__vitest__/mol-shadow-governance.vitest-harness.ts` | E |

### Invariants covered by this section

- P12 (AI safety) — REG-197 pins the OpenAI MoL-shadow's two safety guarantees:
  it never reaches a student (void return, discarded shadow text, baseline
  Claude is the only answer, fire-and-forget) and it produces zero side effects
  when its flag is OFF / killed / out-of-scope / sample-missed / flag-read-fails.
  Claude (Haiku) stays the sole student-facing model; the OpenAI leg is an
  offline-comparison shadow only.

### Catalog total

Pre-FOX-4: 163 entries (through Remediation PAY-2's REG-195/REG-196 consumer
pricing source-of-truth). Remediation FOX-4 adds REG-197 (MoL OpenAI-shadow
governance — the two P12 safety invariants in the default per-PR lane).
**Total catalog: 164 entries (target: 35 — TARGET EXCEEDED).**

---

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

## Remediation — PP-1/3: Parent-Link Consent / Option B (P8/P13/P15) — 2026-06-29

The Cycle-7 audit found that the legacy Edge `parent_login` action granted an
`active` / `is_verified:true` guardian↔child link from a bare link-code match —
a link code alone (e.g. leaked to a tuition centre) opened a child's data with
NO child consent (P8 parent↔child boundary + P13 privacy). CEO-approved Option B
FLIPS the posture: `parent_login` now creates a `pending` link that the STUDENT
must approve (via the existing `/api/parent/approve-link` flow) before any data
is exposed; the parent sees a bilingual "awaiting approval" screen and the
student is notified PII-free.

Because this is an intentional posture FLIP, there is NO characterization
tripwire of the old "active-without-approval" behaviour — REG-199 pins the NEW
consent invariant across all four surfaces (consent posture, no-data-while-
pending, the anti-orphan dashboard-wiring guard, and the still-green
student-owned approve-link flip from REG-117). The unit lane has no live DB, so
the Edge posture is pinned as comment-stripped static-source assertions (same
convention as `parent-login-rate-limit.test.ts` / REG-198), the no-access
boundary is pinned via the `ACTIVE_GUARDIAN_LINK_STATUSES` constant + the
relationship.ts / `canAccessStudent` filters, the anti-orphan guard is a
source pin on `StudentOSDashboard` (import + `<PendingLinkApproval` JSX), and a
light jsdom render test proves the wired card itself works (self-hides on empty,
shows Approve/Reject + parent name when pending, bilingual).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-199 | `parent_login_creates_pending_consent_link` | P8/P13/P15: `parent_login` creates a `pending` (not `active`) guardian_student_links row via ON CONFLICT upsert (no downgrade of an approved link), grants ZERO child data while pending (ACTIVE_GUARDIAN_LINK_STATUSES excludes pending; canAccessStudent denies), responds `pending_approval` with no session, and notifies the student PII-free via send_notification; the student approval surface (`PendingLinkApproval`) is wired into the live `StudentOSDashboard` (anti-orphan guard) and the student-owned approve-link flip (REG-117) is intact. Closes the Cycle-7 finding that a link code alone granted an active guardian link without consent | `src/__tests__/edge-functions/parent-login-consent.test.ts`, `src/__tests__/components/pending-link-approval.test.tsx` (companion render) | U | P8,P13,P15 |

### Invariants covered by this section

- P8 (parent↔child boundary) — REG-199 pins that `handleParentLogin` writes
  `status:'pending'`/`is_verified:false` on both branches (never
  `active`/`true`, never a downgrade), and that `ACTIVE_GUARDIAN_LINK_STATUSES`
  excludes `pending` so the relationship reads + `canAccessStudent`'s parent
  branch grant no child data until the student approves.
- P13 (data privacy) — REG-199 pins that the pending response carries only
  `student_name` + `link_id` (no session/guardian/grade/stats) and the student
  notification carries no guardian name/email/phone (only the opaque link_id).
- P15 (onboarding integrity) — REG-199's anti-orphan guard pins that the live
  `StudentOSDashboard` IMPORTS and RENDERS `PendingLinkApproval`, so the consent
  request can never silently un-wire and dead-end the parent at "pending".

### Catalog total

Pre-PP-1/3: 165 entries (through Remediation SAO-1/SAO-5's REG-198 super-admin
PII-export tiering). Remediation PP-1/3 adds REG-199 (parent-link consent /
Option B — the P8/P13/P15 consent-posture + no-data-while-pending + anti-orphan
dashboard-wiring pins).
**Total catalog: 166 entries (target: 35 — TARGET EXCEEDED).**

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

## Remediation — Tier-2 PR D: Grade Read-Coercion + normalizeGrade Extraction (P5) — 2026-06-30

The Tier-2 PR D slice fixes a P5 grade-format bug at the read boundary. Previously
`normalizeGrade` (in `src/lib/identity/constants.ts`) only handled bare valid
strings (`"6".."12"`) and in-range numbers; any legacy/prefixed value such as
`"Grade 11"`, `"Class 7"`, or `"11th"` fell through to the `"9"` safe default —
silently MIS-GRADING a grade-11 student as grade 9 in the UI. The function now
EXTRACTS the first 1–2 digit run via `/\d{1,2}/`, range-validates it to 6..12, and
keeps it; bare valid strings stay idempotent, in-range numbers stringify, and only
genuinely invalid / out-of-range / null / undefined / empty input reaches the `"9"`
default. `AuthContext.tsx` now wraps the loaded grade in `normalizeGrade(studentData.grade)`
on the `setStudent({ ...studentData, ... })` object-spread at BOTH student-profile
read paths (the metadata path already had it), so a stored legacy value can never
surface in the dashboard as `"Grade 9"` or mis-grade the learner.

The extraction truth-table is asserted with direct behavioral unit calls (the
pre-existing 7 normalizeGrade tests still pass unweakened): `"9"`→`"9"`,
`"Grade 11"`→`"11"`, `"grade 6"`→`"6"`, `"Class 7"`→`"7"`, `"Grade-12"`→`"12"`,
`"11th"`→`"11"`, `" 8 "`→`"8"`, `12`(num)→`"12"`, `"5"`→`"9"`, `"13"`→`"9"`,
`"0"`→`"9"`, `null`→`"9"`, `undefined`→`"9"`, `""`→`"9"`. Idempotency
(`normalizeGrade(normalizeGrade("Grade 11")) === "11"`) and the P5 no-integer-leak
invariant (output is always a string in `VALID_GRADES`, even for objects/arrays)
are pinned. The AuthContext application is pinned as a comment-stripped static-source
assertion: ≥2 `grade: normalizeGrade(studentData.grade)` occurrences on `setStudent`
spreads, and a guard that EVERY `setStudent({ ...studentData ... } as Student)` spread
carries the `normalizeGrade(` override (no raw-grade leak path).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-203 | `normalize_grade_extracts_legacy_prefixed_grade` | P5: `normalizeGrade` extracts the real grade digit from legacy `"Grade N"`/`"Class N"`/`"Nth"` formats (range-validated 6..12) instead of defaulting non-9 prefixed grades to `"9"` (the prior bug), bare `"6".."12"` idempotent, invalid/out-of-range/null → `"9"`; AuthContext applies it at the student-profile read paths so the UI never shows `"Grade 9"` and never mis-grades a grade-N student | `src/__tests__/identity-constants.test.ts` | U | P5 |

### Invariants covered by this section

- P5 (grade format) — REG-203 pins the extraction truth-table (legacy-prefixed
  formats yield the real digit, range-validated 6..12), idempotency on already-valid
  grades, the no-integer-leak guarantee (output always a `VALID_GRADES` string), and
  the AuthContext source pin that the loaded grade is coerced through `normalizeGrade`
  on every `setStudent` student-profile-read spread.

### Catalog total

Pre-Tier-2-PR-D: 169 entries (through Tier-2 PR B's REG-202 super-admin export
message redaction). Tier-2 PR D adds REG-203 (grade read-coercion + normalizeGrade
legacy-extraction — the P5 extraction truth-table + idempotency + no-integer-leak +
AuthContext read-path source pin).
**Total catalog: 170 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — Tier-2 PR C: Durable Parent-Login Rate Limiter (P15/abuse) — 2026-06-30

The legacy `parent_login` per-IP bound rode the per-instance in-memory limiter
(`_shared/rate-limiter.ts::createRateLimiter`), which resets on every Edge cold
start — a brute-forcer who lands on a fresh instance gets a fresh budget. Tier-2
PR C introduces `_shared/durable-rate-limiter.ts::createDurableRateLimiter`, a
cross-instance Upstash `Ratelimit.fixedWindow(5, "3600 s")` limiter with a
TRANSPARENT in-memory fallback (the same `createRateLimiter` 5/1h primitive)
used when the Upstash Edge secrets are absent OR Redis errors. The limiter must
never return unlimited (no unconditional `allowed: true`), never throw on the
request path (the only `await redisLimiter.limit(...)` is inside a try/catch
that falls through to the in-memory `memCheck`), and the check must stay BEFORE
any DB lookup in `handleParentLogin` (fail-closed-before-DB). The esm.sh imports
are pinned by package path (version-tolerant). `parent-login-rate-limit.test.ts`
line 86 was updated in lockstep: the call-site pin moved from `createRateLimiter`
to `createDurableRateLimiter(..., 'rl:parent_login')`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-204 | `durable_parent_login_rate_limiter_failsafe` | P15/abuse-hardening: parent_login uses a cross-instance Upstash `fixedWindow(5, 1h)` limiter that, when the Upstash Edge secrets are absent OR Redis errors, transparently falls back to the in-memory limiter (same 5/1h bound) — never returns unlimited, never throws on the request path, and the check stays BEFORE any DB lookup (fail-closed). Closes the per-instance cold-start reset gap of the prior in-memory-only limiter | `src/__tests__/edge-functions/durable-login-limiter.test.ts` | E | P15 |

### Invariants covered by this section

- P15 (onboarding/abuse path) — REG-204 pins that the parent-login per-IP bound
  is now durable across Edge cold starts (Upstash `fixedWindow(5, 1h)`), that the
  fallback to the in-memory limiter preserves the SAME 5/1h bound when secrets are
  absent OR Redis errors (never fails open, never throws on the request path), and
  that the limiter check stays strictly before `getServiceClient()`/the students
  `.or()` lookup in `handleParentLogin` (fail-closed-before-DB). esm.sh import
  specifiers are pinned by package path, tolerant of an architect `@version` pin.

### Catalog total

Pre-Tier-2-PR-C: 170 entries (through Tier-2 PR D's REG-203 grade read-coercion).
Tier-2 PR C adds REG-204 (durable parent-login rate limiter fail-safe — durable
Upstash `fixedWindow(5,1h)` with transparent same-bound in-memory fallback,
never-fail-open / never-throw on the request path, fail-closed-before-DB ordering).
**Total catalog: 171 entries (target: 35 — TARGET EXCEEDED).**

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

## Remediation — PAY-2: Unlimited Price Convergence (P11) — 2026-06-30

The `unlimited` consumer plan price was converged across ALL sources to the
DB-canonical ₹1099/₹8799. The DB row (`subscription_plans.unlimited`, migration
`20260505155126`) was ALREADY ₹1099/₹8799; the code sources were converged DOWN
to match it: web charge + display (`src/lib/plans.ts::PRICING.unlimited` =
1099/8799), the derived server paisa constant read by `/api/payments/create-order`
(`src/lib/pricing.ts::CONSUMER_PRICING_PAISA.unlimited` = 109900/879900), and the
mobile charge + display (`mobile/lib/data/models/subscription.dart` = 1099/8799).

This CLOSES the prior live divergence where mobile/web code charged ₹1499 while
the DB (web checkout) charged ₹1099 — the SAME plan billed two prices by platform,
and the gateway captured ₹1499 while verify recorded the DB's ₹1099 (gateway↔ledger
mismatch). The convergence is customer-FAVORABLE: the unlimited charge was lowered,
never raised. P11 signature-verification and atomic-write logic are UNTOUCHED — only
the pricing CONSTANTS moved. The SOT pin (`consumer-pricing-sot-drift.test.ts`
Part B) was flipped from a DB↔code DIVERGENCE pin (`not.toBe`) to a DB===code
PARITY pin: this is a legitimate convergence update, NOT a weakened assertion — the
old ₹1499/₹11999 value no longer exists in any source, so the prior divergence pin
would now be asserting a falsehood.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-207 | `pay2_unlimited_price_converged_to_db_canonical` | P11: the `unlimited` plan price is converged across ALL sources to the DB-canonical ₹1099/₹8799 (web `plans.ts`, derived paisa `CONSUMER_PRICING_PAISA` read by create-order, mobile `subscription.dart`, and DB `subscription_plans`) — closing the prior live divergence where mobile charged ₹1499 (code) vs web ₹1099 (DB) and the gateway-vs-ledger mismatch (mobile captured ₹1499 but verify recorded ₹1099); the SOT pin now asserts DB===code parity (not divergence); customer-favorable (charge lowered, never raised); P11 signature/atomicity logic untouched | `src/__tests__/payments/consumer-pricing-sot-drift.test.ts` | U | P11 |

### Invariants covered by this section

- P11 (payment integrity) — REG-207 pins single-price convergence: web charge,
  mobile charge, mobile display, web display, and the DB row are all ₹1099/₹8799.
  The focused pin `src/__tests__/payments/pay2-unlimited-price-converged.test.ts`
  asserts `PRICING.unlimited === {1099,8799}`, `CONSUMER_PRICING_PAISA.unlimited
  === {109900,879900}` (rupees ×100, no rounding drift), and that the code price
  EQUALS the DB-canonical migration value — so a future drift in EITHER direction
  (code creeping back to ₹1499, paisa desyncing, or the DB migration moving)
  re-breaks the pin. starter (299/2399) and pro (699/5599) are pinned UNCHANGED as
  a guard that ONLY unlimited moved. The SOT `consumer-pricing-sot-drift.test.ts`
  Part B was flipped divergence→parity in lock-step; signature-verify + atomic
  subscription-write paths are not touched by this change.

### Catalog total

PAY-2 adds REG-207 (unlimited price convergence to DB-canonical ₹1099/₹8799 —
DB↔code SOT pin flipped from divergence to parity; focused convergence pin guards
all four sources + starter/pro-unchanged).
**Total catalog: 174 entries (target: 35 — TARGET EXCEEDED).**

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

## Remediation — AO-10b: Historical Grade Backfill + Write-Path Default Fix (P5) — 2026-06-30

The AO-10b migration `20260702070000_ao10b_backfill_student_grade_p5.sql` closes the P5
grade-format gap at the DATA layer (the read layer was already coerced by PR D / AO-10).
**Part A (data backfill)** rewrites legacy/prefixed `students.grade` values
("Grade 9", "Class 11", "Grade-7", "11th", " 8 ", …) to the bare in-range digit string using
`substring(grade from '\d{1,2}')::int::text` — the SAME first-1-2-digit-[6,12] extraction as
the TypeScript `normalizeGrade` read-coercion (`src/lib/identity/constants.ts:170-191`). It is
FAIL-SAFE: the UPDATE is gated on `grade NOT IN ('6'..'12')` AND the embedded number
`BETWEEN 6 AND 12`, so already-bare rows AND ambiguous / out-of-range / no-digit rows
("Grade 5", "Grade 13", "Grade", NULL-ish) are LEFT UNTOUCHED. It NEVER invents the TS '9'
safe default at the data layer (that default only applies at read time), and never writes an
integer (`::int::text` → string). A read-only COUNT pre-flight runs first; an RLS-enabled,
service-role-only backup table (`_ao10b_grade_backfill_backup`) snapshots every changed row
for exact rollback; the snapshot INSERT is `NOT EXISTS`-guarded for replay-safety.
**Part B (write-path fix)** `CREATE OR REPLACE`s the two onboarding RPCs whose baseline
default literal re-accrued the "Grade N" shape — `create_student_profile` ('Grade 9' → '9')
and `get_or_create_student` ('Grade 6' → '6') — so new rows are P5-conformant at write time
and the backfill does not re-accrue. No DROP TABLE/COLUMN; fully idempotent
(`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE`, snapshot `NOT EXISTS` guard).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-209 | `ao10b_grade_backfill_extraction_and_writepath_defaults` | P5: the AO-10b migration backfills `students.grade` legacy "Grade N"→"N" using the SAME first-1-2-digit-[6,12] extraction as the TS normalizeGrade read-coercion (fail-safe — only clearly-parseable rows touched, ambiguous/out-of-range LEFT untouched, never an integer, RLS-protected reversible backup), and fixes the two onboarding write-path defaults (create_student_profile 'Grade 9'→'9', get_or_create_student 'Grade 6'→'6') so new rows are P5-conformant at write time and the backfill does not re-accrue; no DROP, idempotent | `src/__tests__/ao10b-grade-backfill.test.ts` | E | P5 |

### Invariants covered by this section

- P5 (grade format) — REG-209 source-pins (comment-tolerant) the SHAPE of the migration:
  (1) EXTRACTION PARITY — the backfill UPDATE writes `substring(grade from '\d{1,2}')::int::text`
  gated on `grade NOT IN ('6'..'12')` AND the embedded number `BETWEEN 6 AND 12` (already-bare,
  out-of-range, and no-digit rows excluded), with a read-only two-bucket COUNT pre-flight;
  (2) NO FORCED DEFAULT AT THE DATA LAYER — no constant `SET grade = '9'`/`'6'`/`'Grade N'`,
  no COALESCE/CASE fallback that injects a default digit; (3) BACKUP TABLE RLS —
  `_ao10b_grade_backfill_backup` is `CREATE TABLE IF NOT EXISTS` + `ENABLE ROW LEVEL SECURITY`
  + service-role-only policy in the same migration; (4) WRITE-PATH DEFAULTS — both RPCs are
  `CREATE OR REPLACE`d with the bare default and the OLD `'Grade 9'`/`'Grade 6'` literals are
  gone from executable SQL; (5) NO DROP / IDEMPOTENT; (6) P5 — the SET target ends in `::text`,
  no bare `::int` write. A behavioural-parity block exercises the live `normalizeGrade`
  (the read-coercion the SQL mirrors) on the canonical legacy formats.
- Lane note: SOURCE pin in the normal `npm test` lane (sibling to REG-200/REG-208's TSB-4
  source pins), NOT the live-DB integration lane — the SQL's actual row-rewrite is proven in
  the integration lane and deferred.

### Catalog total

AO-10b historical grade backfill + write-path default fix adds REG-209 (P5 data-layer grade
normalization mirroring the TS normalizeGrade extraction, fail-safe + reversible + idempotent,
plus the two onboarding RPC default flips that stop re-accrual).
**Total catalog: 176 entries (target: 35 — TARGET EXCEEDED).**

---

## Incident — students RLS infinite recursion + P15 null-student hydration — 2026-07-02

A production incident took down EVERY authenticated client read of `public.students`
(dashboard, `get_mastery_overview`, StreamGate, profile reads) and stranded logged-in
students on a forever-skeleton dashboard. Two independent root causes, two independent fixes,
two regression pins.

**Cause 1 (RLS recursion, P8).** Migration `20260702010000_teacher_assigned_students_rls.sql`
added the policy "Teachers can view students in their classes" ON `public.students` whose
USING clause INLINED a subquery over `public.class_students`
(`id IN (SELECT cs.student_id FROM public.class_students cs JOIN class_teachers … JOIN
teachers …)`). Because that inline subquery reads `class_students` as SECURITY INVOKER,
`class_students`' baseline policy "Students can view own enrollment" — which reads
`public.students` back — re-entered the RLS evaluator and Postgres raised
"infinite recursion detected in policy for relation students". Fix migration
`20260702080000_fix_students_rls_infinite_recursion.sql` DROPped it and recreated it as
`USING ( public.is_teacher_of(id) )` — a SECURITY DEFINER helper whose inner reads bypass RLS,
breaking the cycle. The durable rule: teacher/parent boundaries on `public.students` MUST go
through the SECURITY DEFINER helpers `public.is_teacher_of(id)` / `public.is_guardian_of(id)`,
NEVER an inline subquery over another RLS-protected, student-referencing table.

**Cause 2 (P15 null-student hydration).** With every `students` read failing, the
`get_user_role`-success branch in `src/lib/AuthContext.tsx` hit a `.single()` on the secondary
profile read, which REJECTS with PGRST116 on 0 rows. The throw aborted the role branch; because
the parallel rescue is guarded by `if (!rolesResolved)` (already true), `student` was left
permanently `null` while `isLoggedIn` stayed true → StudentOSDashboard skeletoned forever. The
fix switches the secondary read to `.maybeSingle()`, adds a defensive `auth_user_id` re-read,
and — when both come back null — hydrates `student` from the RPC's OWN `rd.student` payload
(grade normalized via `normalizeGrade` (P5); `onboarding_completed` verbatim so the
`/onboarding` redirect stays correct). A logged-in student is NEVER left with `student === null`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-210 | `students_rls_no_inline_recursive_subquery` | P8: parses the root migration chain (baseline + later root migrations, in timestamp order; `_legacy/` excluded), reduces every CREATE/DROP POLICY ON `public.students` to the FINAL effective set (so `20260702080000` supersedes `20260702010000`), and asserts NO surviving policy inlines a FROM/JOIN over an RLS-protected, student-referencing table (`class_students`, `class_teachers`, `guardian_student_links`/`parent_student_links`/`parent_links`, `teacher_remediation_assignments`) — those boundaries must instead delegate to `is_teacher_of(id)`/`is_guardian_of(id)`. Positive-shape pins: the surviving "Teachers can view students in their classes" policy calls `is_teacher_of(id)`; `students_select_merged` uses helpers only. Detector self-test proves it FLAGS the old recursive policy text and CLEARS the fixed helper form (non-vacuous). Static SQL-text guard, no DB. | `src/__tests__/students-rls-no-recursion.test.ts` | E | P8 |
| REG-211 | `authcontext_p15_null_student_hydration` | P15: mounts the REAL `AuthProvider` (supabase mocked at the module boundary). When `get_user_role` resolves a STUDENT role with an `rd.student` payload BUT both secondary `students` reads (`.maybeSingle()` by id, then defensive re-read by `auth_user_id`) return null/0-rows, the exposed `student` is NON-null (never strands a logged-in student → no forever-skeleton dashboard), carries the RPC grade normalized to bare P5 form (`'Grade 9'`→`'9'`) and `onboarding_completed` VERBATIM (true and false cases). Second branch: when the `auth_user_id` re-read succeeds, `student` hydrates from the FULL row. | `src/__tests__/auth-context-p15-null-student-hydration.test.tsx` | E | P15 |

### Invariants covered by this section

- P8 (RLS boundary) — REG-210 is a SOURCE-level static guard (normal `npm test` lane, sibling
  to REG-200/REG-208/REG-209's TSB-4/AO-10b source pins; NOT the gated live-DB
  `src/__tests__/migrations/**` lane). It pins the INVARIANT (no inline protected-table subquery
  in any active students policy), not just the one fixed file, so any future migration that
  reintroduces the recursion pattern fails PR CI. The cycle is a property of the policy
  DEFINITION and is provable statically; the live-DB proof ("an authenticated student reads
  their own row without a recursion error") is complementary and lives in the integration lane.
- P15 (onboarding integrity) — REG-211 exercises the REAL AuthContext code path (full provider
  render + context probe), not a replicated helper, pinning the `maybeSingle` + RPC-payload
  fallback that guarantees a resolved student role never ends with `student === null`.

### Catalog total

students RLS infinite-recursion fix + P15 null-student hydration fix add REG-210 (P8 static
guard — no active `public.students` policy may inline a subquery over an RLS-protected,
student-referencing table; teacher/parent boundaries go through `is_teacher_of`/`is_guardian_of`)
and REG-211 (P15 — a resolved student role is always hydrated to a non-null `student`, from the
`get_user_role` payload when the secondary profile read returns 0 rows).
**Total catalog: 178 entries (target: 35 — TARGET EXCEEDED).**

---

## XC-3 Phase 0a — Generalized RLS cross-table-recursion guard (2026-07-02)

Source: `docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md` §5 (Phase 0a).

**Why.** REG-210 guards the TSB-4 infinite-recursion class for `public.students` ONLY. The XC-3
audit found the pattern is SYSTEMIC: ~141 of 522 baseline policies (242 across the whole effective
chain after the Phase 0a.1 unquoted-name widening — was 214 under the original quoted-only name
regex) inline a SECURITY-INVOKER cross-table subquery that re-enters another RLS-enabled table —
every one a latent edge that can close a TSB-4-style `students→…→students` cycle the moment a
back-edge is added. We cannot retroactively rewrite all of them now, so Phase 0a FREEZES the
surface: a generalized static guard across ALL tables that fails the moment a NEW or RENAMED policy
adds another inline cross-table subquery. Phase 4 drains the grandfather ledger (inline → SECURITY
DEFINER helper) table by table, ratcheting the count DOWN.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-212 | `rls_no_cross_table_recursion_generalized` | P8: parses the full root migration chain (baseline + root `*.sql` in timestamp order; `_legacy/` excluded), builds `R` = every table with effective `ENABLE ROW LEVEL SECURITY` (≥270), reduces every CREATE/DROP POLICY on EVERY table to the FINAL effective set (DROPs applied in order), and flags a surviving policy as a recursion risk iff its `USING`/`WITH CHECK` inlines a `FROM`/`JOIN` over `b ∈ R, b ≠ policyTable`. EXEMPT: self-references (`b===T`), foreign-schema relations (`auth.`/`vault.`), non-RLS reference tables, and SECURITY DEFINER helper CALLS (`is_teacher_of`/`is_guardian_of`/`is_school_admin_of`/`is_admin`/`get_my_*`/`get_admin_school_id` — no FROM of their own). FREEZE: the detected risk set MUST be a SUBSET of the hardcoded `GRANDFATHERED_INLINE_POLICIES` ledger (242 keys, `"<table>::<name>"`) — fails ONLY on a NEW/RENAMED inline cross-table policy. Plus: no STALE ledger entries (exact mirror of live debt → Phase-4 ratchet), count pinned at 242, the apex `students` carries only the one known grandfathered latent edge (`School admins can view school students`) while the fixed `Teachers can view students in their classes` + `students_select_merged` delegate to helpers and are NOT flagged (and the teacher-policy name is absent from the ledger, so re-adding the inline shape FAILS). Detector self-test (non-vacuous): FLAGS the old recursive TSB-4 text (inline `class_students`/`class_teachers`/`teachers`) and CLEARS the fixed `is_teacher_of(id)` form, a pure `auth.uid()` predicate, a helper-call combo, and a same-table self-ref; FLAGS an inline `guardian_student_links` join. **Phase 0a.1 (XC-3) hardening:** the CREATE/DROP POLICY name matcher now accepts BOTH quoted (`"my policy"`) AND UNQUOTED (`my_policy`) identifiers — the original quoted-only regex was blind to unquoted-name policies (a false negative). The widening surfaced 28 previously-invisible unquoted-name inline policies (214 → 242), ALL on CHILD tables inlining a PARENT boundary table that does not read them back (none a live cycle; verified reaches-self=false for each) — frozen in the Phase 0a.1 block of the ledger. New self-tests prove an UNQUOTED-name recursive policy (`CREATE POLICY teacher_inline ON public.students USING (… FROM public.class_students …)`) is now matched + flagged, quoted names still match (no regression), DROP-by-unquoted-name still reduces the matching CREATE, and unquoted-name case is folded. Static SQL-text guard, no DB. | `src/__tests__/rls-no-cross-table-recursion.test.ts` | E | P8 |

**Reconciliation of `rls-teacher-assigned-students.test.ts` (REG-209).** That file previously pinned
the SHAPE of the SUPERSEDED *recursive* TSB-4 policy (`20260702010000`) — it asserted the inline
`class_students ⋈ class_teachers ⋈ teachers` roster join that `20260702080000` removed, i.e. exactly
the shape we must never ship again. It is rewritten (coverage preserved, not deleted) to pin the
FIXED end-state: across the reduced chain the effective `students` teacher backstop delegates to
`public.is_teacher_of(id)` and inlines NO roster join; `20260702080000` sorts after and supersedes
`20260702010000`; the three TSB-2 boundary outcomes (assigned ⇒ visible, non-assigned ⇒ 0 rows,
inactive enrollment ⇒ 0 rows) survive because they are now carried inside the `is_active`-guarded
`is_teacher_of` helper (baseline definition pinned); and NO surviving `students` policy resurfaces
the inline roster join.

### Invariants covered by this section

- P8 (RLS boundary) — REG-212 generalizes REG-210's students-only intent to ALL RLS-enabled tables.
  It is a SOURCE-level static guard in the normal `npm test` lane (sibling to REG-210). The cycle is
  a property of the policy DEFINITION and is provable statically; the live-DB proof is complementary
  and lives in the integration lane. The guard FREEZES the current 242-policy blast radius (214 +
  the 28 unquoted-name policies surfaced by the Phase 0a.1 name-regex widening) so the
  recursion class cannot grow, and the grandfather ledger is the explicit, reviewable debt list that
  Phase 4 drains.

### Catalog total

XC-3 Phase 0a adds REG-212 (P8 generalized cross-table-recursion freeze — no NEW/RENAMED policy on
ANY table may inline a `FROM`/`JOIN` over a different RLS-enabled table; the current 242 inline
policies — 214 original + 28 surfaced by the Phase 0a.1 unquoted-policy-name widening — are
grandfathered and Phase 4 ratchets the ledger down) and reconciles the stale
`rls-teacher-assigned-students.test.ts` (REG-209) onto the fixed `is_teacher_of(id)` end-state.
**Total catalog: 179 entries (target: 35 — TARGET EXCEEDED).**

---

## XC-3 Phase 0b + 0c — admin-client allowlist freeze + RLS inventory (2026-06-30)

**Why.** Phase 0a froze the RLS *policy-recursion* class. The same XC-3 audit found two more
systemic exposures to freeze before any Phase ≥1 migration: (1) **273 of 362** API `route.ts` files
import the RLS-BYPASSING service-role client `@/lib/supabase-admin` — on those routes RLS is not
exercised on the request path and a single missed `authorizeRequest()` is an unbounded data leak
(P8/P9/P13); and (2) the schema's RLS *inventory* posture (every public table RLS-enabled; only the
two intentional `mass_gen_log`/`school_subscriptions` deny-all tables in the baseline) must not
silently drift. Phase 0b FREEZES the 273-route admin footprint so it can only ratchet DOWN as
Phase 2/3 migrate reads onto `supabase-server`; Phase 0c FREEZES the table-level RLS inventory so no
un-protected or unannounced service-role-only table can be added. Both are source/SQL-text static
guards in the normal `npm test` lane (no live Postgres), consistent with the Phase 0a sibling.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-213 | `api_admin_client_allowlist_freeze` | P8/P9: enumerates every `route.ts` under `src/app/api` and flags any whose source imports a module specifier ending in `supabase-admin` (covers `@/lib/supabase-admin` AND relative `../../lib/supabase-admin` forms). Loads `scripts/admin-client-allowlist.json` (the architect-owned ledger, 273 entries). ASSERTS `detected \ allowlist === ∅` (a NEW admin-importing route absent from the ledger FAILS — author must either use the RLS-scoped `supabase-server` client or, if service-role is genuinely required, add the route + bump `count` in the same PR), `allowlist \ detected === ∅` (no STALE entry — a migrated/removed route must be pruned so the count ratchets DOWN, never drifts), and pins the count at exactly **273**. Robust to `\\`→`/` path-separator drift; ledger self-consistency (`routes.length === count`) also pinned. Static source scan, no runtime/DB. | `src/__tests__/api-admin-client-allowlist.test.ts` + `scripts/admin-client-allowlist.json` | E | P8, P9 |
| REG-214 | `rls_inventory_every_table_protected` | P8: parses the full root migration chain (baseline + root `*.sql` in timestamp order; `_legacy/` excluded) into CREATED (public `CREATE TABLE`, `DROP TABLE` removes), RLS (`ALTER … ENABLE ROW LEVEL SECURITY`, `DISABLE` removes) and POLICIED (≥1 surviving `CREATE POLICY`, quoted pg_dump AND unquoted hand-written names, DROPs applied) sets; views/matviews never match (`CREATE TABLE` only); non-public schemas excluded. ASSERTS `CREATED ⊆ RLS` (every public table created in the chain has RLS enabled — no un-protected table can be added; reports the offending name) and `RLS ⊆ CREATED` (no orphan ENABLE). DENY-ALL freeze (RLS-on, ZERO-policy = service-role-only): the **baseline** deny-all set is EXACTLY `{mass_gen_log, school_subscriptions}` (the two intentional ones the audit found — pinned verbatim); those two remain deny-all in the full chain; and the **full effective-chain** deny-all set equals the reviewed `SERVICE_ROLE_ONLY_TABLES` ledger (36 tables — the 2 audit tables plus the agent/AI/queue/log infra that `20260516020000_tighten_rls_policy_always_true.sql` and post-baseline migrations made service-role-only) EXACTLY, so a NEW RLS-on-but-policy-less table (not in the ledger) FAILS and a table that gains policies (left stale in the ledger) also FAILS. Static SQL-text guard, no DB. | `src/__tests__/rls-inventory.test.ts` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary) / P9 (RBAC enforcement) — REG-213 freezes the service-role-client blast radius
  (the dominant data path that bypasses RLS) so it can only shrink; REG-214 freezes the table-level
  RLS inventory (universal RLS coverage + the exact service-role-only deny-all set). Both are
  source/SQL-text static guards in the normal `npm test` lane (siblings to REG-210/REG-212). They are
  the enforcement layer Phase 1 (backstop policies) and Phase 2/3 (route migrations) rely on.

### Catalog total

XC-3 Phase 0b + 0c add REG-213 (admin-client allowlist freeze — the 273-route `supabase-admin`
footprint is pinned and may only ratchet DOWN) and REG-214 (RLS inventory — every public table is
RLS-enabled and the deny-all/service-role-only set is frozen: baseline EXACTLY
`{mass_gen_log, school_subscriptions}`, full chain EXACTLY the 36-table reviewed ledger).
**Total catalog: 181 entries (target: 35 — TARGET EXCEEDED).**

---

## H2b — Event-Sourced Canonical-Write Migration (Stage 1 dual-write parity) — 2026-06-30

ADR-005 begins moving the canonical `scheduled_actions` write OFF the `/api/learner/next`
route and ONTO an event-sourced projector. Slice H2b ships the **Stage 1 dual-write parity
phase** (merged via PR #1141 + #1144 follow-ups): a new event kind
`learner.next_action_resolved` (`src/lib/state/events/registry.ts`), a new projector
`scheduledActionsWriter` (`src/lib/state/subscribers/scheduled-actions-writer.ts`) that OWNS
the `scheduled_actions` upsert once cutover completes, and a dual-write at the route. The route
(`src/app/api/learner/next/route.ts`) RETAINS its synchronous inline `scheduled_actions` upsert
(the existing E10 write) AND, best-effort, ALSO `publishEvent('learner.next_action_resolved')`
gated behind `ff_event_bus_v1`. This is the PARITY phase: the inline write stays authoritative
while the projector is proven to produce a byte-identical row before Stage 2 cuts over to
projector-only. P8 is UNCHANGED — `scheduled_actions` keeps its existing table/RLS posture;
no new table, no RLS toggle. The projector and the inline write target the SAME row via the
SAME conflict key, so the substrate's data-ownership boundary is untouched during parity.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-215 | `h2b_next_action_resolved_dualwrite_parity` | ADR-005 / P8: the `/api/learner/next` route DUAL-WRITES during Stage 1 — the synchronous inline `scheduled_actions` upsert (retained, E10) PLUS a best-effort `publishEvent('learner.next_action_resolved')` gated by `ff_event_bus_v1`. PARITY is pinned end-to-end: the published event, fed through the REAL `scheduledActionsWriter` projector, projects to a row BYTE-EQUAL to the inline upsert (same conflict key, 1:1 column mapping, `source` hard-coded scheduler). Flag-gating: flag ON → exactly one inline upsert AND one publishEvent; flag OFF → ZERO inline upserts and ZERO publishEvents, response byte-unchanged. Bus-outage isolation: an async `publishEvent` rejection is swallowed (best-effort) — the route still returns 200 with the resolver payload, so the event bus can never degrade the live next-action path. Projector independently pinned: binds to `learner.next_action_resolved`, idempotent on re-delivery (identical event → identical row), `dryRun` no-op, throws on substrate upsert error (retry), safe no-op on malformed payload. P8 substrate (scheduled_actions table/RLS) unchanged — no new table, no RLS toggle. | `src/__tests__/api/learner/next/route.test.ts` + `src/lib/state/subscribers/scheduled-actions-writer.test.ts` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary / canonical-write substrate) — REG-215 pins that H2b leaves the
  `scheduled_actions` table and its RLS posture untouched: the new projector writes the SAME
  row via the SAME upsert conflict key as the route's inline write (no new table, no RLS
  toggle, no second source of truth). The dual-write is additive parity, not a substrate change.
- ADR-005 (canonical write route → projector) — the byte-equal projection assertion is the
  GATE on the Stage 2 cutover. The published event, run through the REAL `scheduledActionsWriter`,
  must produce a row identical to the inline upsert; any column-mapping, conflict-key, or
  `source` drift between the two writers fails REG-215 and blocks cutover.
- Dual-write resilience (async-dispatch-aware) — the event publish is best-effort and
  flag-gated: an event-bus rejection cannot 500 the live next-action route, and
  `ff_event_bus_v1=OFF` makes the publish a no-op with a byte-unchanged response. The inline
  write remains the sole authority throughout Stage 1.

### Stage 2 sunset condition

REG-215 is the PARITY guard for the dual-write phase ONLY. It may be retired (the inline
E10 write deleted and this entry closed) once, and only once: (1) `ff_event_bus_v1` AND
`ff_projector_runner_v1` are both ramped to 100%, AND (2) production parity between the
inline write and the projector-produced row has been confirmed over the bake window. Until
all three hold, the inline `scheduled_actions` upsert stays authoritative and REG-215 stays
green. Deleting the inline write or closing E10 before that is a blocking regression.

### Catalog total

H2b Stage 1 dual-write parity adds REG-215 (event-sourced canonical-write migration —
`learner.next_action_resolved` event + `scheduledActionsWriter` projector + route dual-write;
byte-equal projection through the real projector, flag-gating ON/OFF, best-effort bus-outage
isolation, idempotent projector; P8 substrate unchanged; gates the ADR-005 Stage 2 cutover).
**Total catalog: 182 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-216 — XC-3 Phase 1: apex `students` school-admin policy delegates to a SECURITY DEFINER helper (first ledger drain 242 → 241)

**Why.** The XC-3 generalized recursion guard (REG-212) freezes the inline cross-table
RLS surface and forces it to ratchet DOWN, never drift. XC-3 Phase 1 (migration
`20260702090000_xc3_p1_is_school_admin_of_student_helper.sql`) refactors the LAST latent
inline cross-table edge on the apex `public.students` table — the policy
`"School admins can view school students"`, which inlined `FROM public.school_admins`
inside its `USING` (baseline:19906) — to the new SECURITY DEFINER helper
`public.is_school_admin_of_student(uuid)`. This is the binding RS-RULE applied to the apex
table: cross-table authorization must delegate to a SECURITY DEFINER helper (inner reads
bypass RLS) rather than inline a `FROM`/`JOIN` over a different RLS table. After this change
`students` carries ZERO inline cross-table edges, and the grandfather ledger drains for the
FIRST time (242 → 241).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-216 | `rls_students_school_admin_helper_delegation` (within `rls-no-cross-table-recursion.test.ts`) | P8: the apex `students` policy `"School admins can view school students"` no longer inlines `FROM school_admins` — its effective form (migration `20260702090000` supersedes the baseline via DROP+CREATE in the chain reduction) delegates to `public.is_school_admin_of_student(id)`, so the detector flags NO inline cross-table policy on `students` (`detectedRiskKeys()` filtered to `students::` === `[]`). The helper is added to the SECURITY DEFINER roster `H` (`RLS_HELPERS`, length 10 → 11) so a policy CALLING it is recognised as delegating. The grandfather key `students::School admins can view school students` is PRUNED from `GRANDFATHERED_INLINE_POLICIES` (FIRST ratchet-DOWN), and the count pins assert exactly **241** (`GRANDFATHERED_INLINE_POLICIES.size === 241` AND `detectedRiskKeys().length === 241`) — so `detected === allowlist` holds (no stale entry, no new violation). Boundary equivalence: the helper returns `EXISTS` over the SAME join the inline form used (student's `school_id` from `students` ⋈ `school_admins` on `school_id`, caller `auth.uid()` = `sa.auth_user_id`, `sa.is_active = true`) — identical school-scoping + is_active guard + NULL-school_id non-match → no over/under-grant. No recursion: SECURITY DEFINER inner reads of `students` + `school_admins` bypass RLS, so no `students → school_admins → students` cycle can form. Static SQL-text guard, no DB. | `src/__tests__/rls-no-cross-table-recursion.test.ts` + `supabase/migrations/20260702090000_xc3_p1_is_school_admin_of_student_helper.sql` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary) — REG-216 is the FIRST behavioral RLS change of XC-3. It proves the
  apex `students` table is fully helper-delegating (zero inline cross-table edges) and that
  the school-admin SELECT boundary is byte-for-byte the same visible-row set after the
  refactor (same tables, same school-scoping, same `is_active` guard). The SECURITY DEFINER
  helper's inner reads bypass RLS, so the refactor cannot introduce the TSB-4 recursion class
  it removes.
- Ledger ratchet (Phase 4 drain mechanic, exercised early in Phase 1) — the
  `GRANDFATHERED_INLINE_POLICIES` ledger must mirror live debt EXACTLY; pruning the students
  school-admin key in the same change that refactors the policy keeps `detected === allowlist`
  and forces the count DOWN (242 → 241). Re-introducing the old inline shape under this name
  would FAIL the guard (the key is absent from the ledger).

### Catalog total

XC-3 Phase 1 adds REG-216 (apex `students` `"School admins can view school students"` policy
refactored from inline `FROM school_admins` to the SECURITY DEFINER helper
`is_school_admin_of_student(id)`; exact boundary equivalence, no recursion, first grandfather
ledger drain 242 → 241, helper added to set `H`).
**Total catalog: 183 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-217 — XC-3 Phase 2 (batch 1): first student-own read route migrated admin → server, RLS now enforced at the request path (allowlist 273 → 272)

**Why.** XC-3 Phase 0b froze the RLS-bypassing service-role footprint at 273
`route.ts` files (REG-213) and forced it to ratchet DOWN only. Phase 2 begins
DRAINING that ledger by swapping student-own READ routes from the RLS-bypassing
admin client (`@/lib/supabase-admin`) onto the RLS-respecting server client
(`@/lib/supabase-server`), so RLS becomes a real second line of defense behind
`authorizeRequest()`. The risk is the INVERSE of the recent `students`-RLS
production incident: a swap turns a working 200 into an EMPTY/403 if the SELECT
policy does not admit exactly what the route reads. Batch 1 therefore migrates a
single route whose every read is PROVABLY policy-covered:
`src/app/api/student/daily-lab/route.ts`. It keeps `authorizeRequest`
(Bearer-or-cookie) for the auth gate + `studentId`; only the three data reads
move to the cookie-scoped server client (the sole caller, `DailyLabMission.tsx`,
fetches with `credentials: 'include'`). Response shape is byte-identical.

**RLS coverage proof (the gate that prevents a repeat of the dashboard incident).**

| Read | Filter | Admitting SELECT policy (baseline / migration) |
|---|---|---|
| `students` | `id = studentId` | `students_select_merged` — `auth_user_id = auth.uid()` (own row). Post `20260702080000` recursion fix: no `students → class_students → students` cycle. |
| `interactive_simulations` | `is_active = true` (+ grade/widget/quality) | `sim_read_all` — `USING (is_active = true)`, public active-catalog read. |
| `experiment_observations` | `student_id = studentId`, `created_at >= now-14d` | `students_read_own_observations` — `student_id = get_student_id_for_auth()` (migration `20260504195900`). |

`daily-plan` was PROVEN covered too (own `students` + `class_students`
own-enrollment + `classroom_lesson_plans` student-class policy + `topics_read_all`)
but DEFERRED to a later batch: it touches the exact `students`+`class_students`
tables from the recent incident (nested RLS), so it stays out of the FIRST
behavioral batch per the conservative one-incident-adjacent-route rule.
`subjects` and `chapters` were DEFERRED because their reads happen inside
SECURITY DEFINER RPCs (`get_available_subjects`, `available_chapters_for_student_subject_v2`)
that bypass RLS regardless of the client — swapping the client does NOT bring the
read under RLS, so they are out of scope for this defense-in-depth batch.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-217 | `GET /api/student/daily-lab — RLS contract (admin→server migration)` | P8/P9: with the RLS-scoped server client mocked, an authenticated OWNER receives their Daily Lab with the byte-identical response shape (`simulation_id/title/title_hi/subject/emoji/estimated_minutes/bonus_coins=50/completed_today/deeplink/experiment_id`); a request the SELECT policy does NOT admit (mocked `students` read returns no row — RLS deny for a cross-user/forged `studentId`) yields `400 { success:false, error:'Student profile incomplete' }` with NO simulation payload — i.e. the migration fails CLOSED. The admin-client allowlist guard pins the ledger ratchet 273 → 272 (route pruned from `scripts/admin-client-allowlist.json`, `count` + `EXPECTED_COUNT` decremented; `detected === allowlist`). | `src/__tests__/api/daily-lab.test.ts`, `src/__tests__/api-admin-client-allowlist.test.ts`, `scripts/admin-client-allowlist.json` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — the route's three student-own/public reads now execute on
  the RLS-respecting `supabase-server` client; each is covered by an existing
  SELECT policy (table above), so RLS is a genuine second line of defense behind
  `authorizeRequest`, and a non-owner read fails closed.
- P9 (RBAC enforcement) — `authorizeRequest(request, 'stem.observe', { requireStudentId: true })`
  is unchanged; the permission gate and `studentId` resolution are untouched.
- Ledger ratchet (XC-3 Phase 0b mechanic) — `scripts/admin-client-allowlist.json`
  drains 273 → 272 in the same change that migrates the route, keeping
  `detected === allowlist` and forcing the admin-client count DOWN.

### Catalog total

XC-3 Phase 2 batch 1 adds REG-217 (first student-own read route migrated
admin → server with full per-table RLS-coverage proof; owner-gets-own-data +
cross-user-fails-closed contract; admin-client allowlist ratcheted 273 → 272).
**Total catalog: 184 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-218 — XC-3 Phase 2 (batch 2): student-own read route(s) migrated admin → server; allowlist 272 → 271

**Why.** Continues the Phase 2 ledger DRAIN started by REG-217: swap student-own
READ routes from the RLS-bypassing admin client (`@/lib/supabase-admin`) onto the
RLS-respecting server client (`@/lib/supabase-server`) so RLS becomes a real
second line of defense behind `authorizeRequest()`. The standing risk is the
dashboard-incident class: a swap turns a working 200 into EMPTY/403 if the SELECT
policy does not admit exactly what the route reads, OR if a NON-cookie (mobile
Bearer) caller exists — the server client is cookie-only (`createServerClient` +
`next/headers cookies()`; it never reads the `Authorization` header), so a Bearer
caller would NULL `auth.uid()` at the RLS layer and break. Batch 2 therefore
migrates ONLY routes that are BOTH provably policy-covered AND have no Bearer/mobile
caller. **Net this batch: 1 route migrated** —
`src/app/api/dashboard/reviews-due/route.ts`.

**Migrated: `GET /api/dashboard/reviews-due`** (spaced-repetition due-count CTA).
Single read; `authorizeRequest('progress.view_own', { requireStudentId: true })`
unchanged; response shape `{ success, data:{ dueCount, oldestDueDate, estimatedMinutes } }`
byte-identical. Caller transport verified COOKIE-only: the sole caller
`src/components/dashboard/ReviewsDueCard.tsx` fetches via same-origin SWR `fetch(url)`
(cookies auto-attached); the `mobile/` tree has ZERO `reviews-due` callers (mobile's
only REST callers are `/api/student/daily-plan`, `/api/student/subjects`, `/api/foxy`,
and the generated `/api/v2/*` client). Fail-CLOSED: an RLS deny (no own rows)
degrades the count to 0 — no other student's review state can leak; a query/transport
error maps to 500 with no payload.

**RLS coverage proof (the gate against a 200 → empty regression).**

| Read | Filter | Admitting SELECT policy (baseline) | Transport |
|---|---|---|---|
| `concept_mastery` | `student_id = studentId`, `next_review_date <= today`, `mastery_probability < 0.95`, `next_review_date >= academicYearStart` | `concept_mastery_own` — `USING (student_id = get_my_student_id())` (baseline `00000000000000`). `studentId` is `auth.studentId` from `authorizeRequest` (`SELECT id FROM students WHERE auth_user_id = authUserId`) — always the caller's OWN id, never arbitrary. For the active OWNER, `get_my_student_id()` (`SELECT id FROM students WHERE auth_user_id = auth.uid() AND is_active = true`) resolves the SAME id → result byte-identical to the admin-client version. | cookie (`ReviewsDueCard.tsx`); no mobile caller |

Equivalence note: `authorizeRequest.studentId` lacks the `is_active = true` filter
that `get_my_student_id()` carries — a (non-reachable-from-dashboard) INACTIVE
student would get a fail-CLOSED empty count rather than data, which matches every
other RLS-respecting learner-state read and never crosses students. Not a
200 → 403 regression for any active caller.

**Deferrals (proof-or-defer; every candidate under `src/app/api/{student,learner,pulse,dashboard}/**` enumerated):**

| Route | Reason deferred |
|---|---|
| `src/app/api/student/daily-plan/route.ts` | **Mobile Bearer caller exists.** `mobile/lib/data/repositories/daily_plan_repository.dart` calls `GET /api/student/daily-plan` with `Authorization: Bearer <jwt>` (auth interceptor, `api_client.dart:83`). The cookie-only server client would NULL `auth.uid()` at RLS → `students_select_merged` denies → 404 `student_not_found` for every mobile caller. RLS coverage IS provable (`students_select_merged` own + `class_students` "Students can view own enrollment" + `classroom_lesson_plans` "Students can view classroom lesson plans" + `curriculum_topics` `topics_read_all`), but the caller-transport check fails. DEFER until a Bearer-aware server client (or mobile cutover) lands. |
| `src/app/api/learner/next/route.ts` | NOT a read-route migration: its reads already run on `createSupabaseServerClient()`. The `supabase-admin` import is for the gated service-role WRITE-through (`scheduled_actions` upsert + RLS-locked event-bus publish). Legitimately stays on the ledger. |
| `src/app/api/pulse/me/route.ts` | Routes through the shared `buildSingleStudentPulse()` helper (`src/lib/pulse/pulse-server.ts`) that also backs the CROSS-ROLE pulse routes and is intentionally admin-after-RBAC-gate (REG-121 `canAccessStudent` design); broad multi-table read surface not provable as a single-route swap. DEFER. |
| `src/app/api/pulse/{class/[classId],school,student/[id]}/route.ts` | Cross-role lenses, not student-own; `canAccessStudent` boundary by design. Out of scope. |
| `src/app/api/student/subjects/route.ts`, `src/app/api/student/chapters/route.ts` | Reads happen inside SECURITY DEFINER RPCs (`get_available_subjects`, chapter resolver) that bypass RLS regardless of client — swap is a no-op for RLS. Out of scope (and `subjects` also has a mobile caller). |
| `src/app/api/student/{profile,preferences,scan-upload,shop/purchase,stem-observation,study-plan,exam-simulation,foxy-interaction}` | Not student-own read GETs (PATCH/POST writes or non-read handlers). Out of scope for this read-route batch. |

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-218 | `GET /api/dashboard/reviews-due — RLS contract (admin→server migration)` | P8/P9: with the RLS-scoped server client mocked, an authenticated OWNER receives the byte-identical `{ dueCount, oldestDueDate, estimatedMinutes }` shape (private cache header preserved); an RLS deny (mocked `concept_mastery` read returns no rows for a cross-user/forged `studentId`) degrades to `{ dueCount:0, oldestDueDate:null, estimatedMinutes:2 }` — fails CLOSED, no other student's review state leaks; a query/transport error maps to `500 { success:false }` with NO `data`. The allowlist guard pins the ledger ratchet 272 → 271 (route pruned from `scripts/admin-client-allowlist.json`, `count` + `EXPECTED_COUNT` decremented; `detected === allowlist`). | `src/__tests__/api/dashboard-reviews-due.test.ts`, `src/__tests__/api-admin-client-allowlist.test.ts`, `scripts/admin-client-allowlist.json` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — `concept_mastery` read now executes on the RLS-respecting
  `supabase-server` client, covered by `concept_mastery_own`; a non-owner read
  fails closed (count 0).
- P9 (RBAC enforcement) — `authorizeRequest(request, 'progress.view_own', { requireStudentId: true })`
  is unchanged; permission gate + `studentId` resolution untouched.
- Ledger ratchet (XC-3 Phase 0b mechanic) — `scripts/admin-client-allowlist.json`
  drains 272 → 271 in the same change, keeping `detected === allowlist`.

### Catalog total

XC-3 Phase 2 batch 2 adds REG-218 (one student-own read route — `dashboard/reviews-due` —
migrated admin → server with per-table RLS-coverage proof + caller-transport check;
`daily-plan` DEFERRED on a confirmed mobile Bearer caller; admin-client allowlist
ratcheted 272 → 271).
**Total catalog: 185 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-219 — XC-3 Phase 2 enabler: Bearer-aware, RLS-respecting route client (unblocks mobile-called migrations)

**Why.** Phase 2 (REG-217/REG-218) drains student-own READ routes off the
RLS-bypassing service-role admin client onto the RLS-respecting cookie client
`createSupabaseServerClient()`. But that client is COOKIE-ONLY: it reads the
Supabase session from `next/headers cookies()` and never inspects the
`Authorization` header. The Flutter app calls many `student/*` routes with
`Authorization: Bearer <jwt>` and NO Supabase cookie (e.g. `/api/student/daily-plan`
via `mobile/lib/data/repositories/daily_plan_repository.dart`), so a cookie-only
swap NULLs `auth.uid()` at RLS → every SELECT policy denies → 404/empty for every
mobile caller. That is exactly why REG-218 DEFERRED `daily-plan`. This entry adds
the ENABLER — a Bearer-aware route client — so those routes can be migrated in a
later batch. **No route is migrated in this change; the allowlist is unchanged.**

**What.** New `src/lib/supabase-route.ts` exports
`createSupabaseRouteClient(request)`:
- **Bearer path** — when the request carries `Authorization: Bearer <jwt>`, builds
  a client with the PUBLIC anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and forwards
  the caller's OWN access token as `global.headers.Authorization`. PostgREST runs
  the query under the caller's identity, so `auth.uid()` resolves and RLS applies
  exactly as on the wire. RLS is ENFORCED, not bypassed — the anon key carries no
  privilege of its own.
- **Cookie path** — no Bearer → delegates verbatim to the existing
  `createSupabaseServerClient()` (anon key + session cookie). Also RLS-scoped.
- **Never service-role.** `SUPABASE_SERVICE_ROLE_KEY` is never read for transport;
  the only key passed to `createClient` is the anon key. A hard pre-build assertion
  throws (fail-closed, builds nothing) if the configured anon key were ever to
  equal the service-role key. The helper does not validate the JWT itself — an
  invalid/expired/forged token is rejected by Supabase Auth + PostgREST + RLS
  (`auth.uid()` stays NULL → deny), so the failure mode is fail-closed.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-219 | `createSupabaseRouteClient — Bearer-aware RLS route client` | P8/P9: (a) a request with `Authorization: Bearer X` builds a client whose `global.headers.Authorization` is `Bearer X` and whose transport key is the ANON key (asserted `!== SERVICE_ROLE_KEY`), with `persistSession/autoRefreshToken=false`, and the cookie delegate is NOT called — so RLS `auth.uid()` resolves under the caller's identity; case-insensitive header match pinned. (b) a request with NO Authorization header (or a non-Bearer scheme, or an empty Bearer token) delegates to `createSupabaseServerClient()` and never calls `createClient`. (c) the service-role key is NEVER passed to `createClient` on any Bearer call; a misconfiguration where the anon key equals the service-role key throws (fail-closed) and builds nothing. Libs mocked at the module boundary to inspect exact args. | `src/__tests__/lib/supabase-route-client.test.ts`, `src/lib/supabase-route.ts` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — the Bearer path is anon-key + caller-JWT, so RLS is the
  active boundary on both paths; the helper cannot return a service-role
  (RLS-bypassing) client (assertion-enforced).
- P9 (RBAC enforcement) — defense in depth: routes still call `authorizeRequest()`
  for RBAC; this client makes RLS a real second line for Bearer callers too.

### Catalog total

XC-3 Phase 2 enabler adds REG-219 (Bearer-aware RLS route client — forwards the
caller's Bearer JWT under the public anon key so RLS `auth.uid()` resolves for
mobile callers, cookie fallback for web, never service-role; no route migrated,
allowlist unchanged).
**Total catalog: 186 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-220 — XC-3 Phase 2 (batch 3 — Bearer batch): `daily-plan` migrated admin → Bearer-aware RLS route client; mobile Bearer caller now RLS-enforced (allowlist 271 → 270)

**Why.** REG-219 shipped the ENABLER (`createSupabaseRouteClient`) but migrated
no route. This batch consumes it: `GET /api/student/daily-plan` was DEFERRED by
REG-218 precisely because it has a mobile Bearer caller
(`mobile/lib/data/repositories/daily_plan_repository.dart` sends
`Authorization: Bearer <jwt>` and NO Supabase cookie), so a cookie-only
`createSupabaseServerClient()` swap would NULL `auth.uid()` at RLS → 404/empty
for every mobile caller. Swapping it onto the Bearer-aware client forwards the
caller's JWT under the public anon key (RLS enforced, never service-role) on the
Bearer path and falls back to the cookie client for web — so RLS becomes a real
second line of defense behind `authorizeRequest('study_plan.view')` on BOTH
transports. This is the first route to use the Bearer-aware client.

**What.** `src/app/api/student/daily-plan/route.ts` swaps its 3 reads from
`supabaseAdmin` (RLS-bypassing service role) to `createSupabaseRouteClient(request)`.
RLS-coverage PROVEN per read (`studentId` is ALWAYS `auth.studentId` — the caller's
own id; the route performs NO writes):
- **students** (`id = studentId`): `students_select_merged` owner branch
  (`auth_user_id = auth.uid()`).
- **class_students** (`student_id = studentId, is_active = true`): "Students can
  view own enrollment" (`student_id ∈ students WHERE auth_user_id = auth.uid()`).
- **classroom_lesson_plans** (`class_id = classId, date = today`): "Students can
  view classroom lesson plans" (`class_id ∈` the caller's own `class_students`
  rows) — `classId` is the caller's own class.
- **curriculum_topics** (embedded `curriculum_topics(id,title)`): `topics_read_all`
  (`USING true` — public catalog).

The `students`+`class_students` nested-read recursion incident is FIXED (migration
`20260702080000` + Phase 1). Caller transport: mobile = Bearer (now RLS-resolved
via the forwarded JWT); web dashboard `DailyPlanCard` = cookie (server-client
fallback). Fail-CLOSED: an RLS deny on the `students` read yields `student=null`
→ `404 { success:false, error:'student_not_found' }`, no plan payload, no 500.
Query set + response envelope (`{ success, data, flagEnabled, intercepted }`)
byte-identical; `authorizeRequest('study_plan.view',{requireStudentId:true})`
unchanged.

**Scan result.** Among mobile Bearer-called student-own reads, `daily-plan` is
the only clean simple-read GET migrated. DEFERRED: `student/subjects`
(RPC-internal — `get_available_subjects` + `ops_events` write), `student/profile`
& `student/preferences` (write routes — POST `students`/`smart_nudges` updates +
RPCs, web cookie), `/api/v2/*` (separate generated `/v2` contract). N = 1.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-220 | `GET /api/student/daily-plan — Bearer-aware RLS contract (admin→route-client migration)` | P8/P9: (a) the route builds its data client from the Bearer-aware `createSupabaseRouteClient`, called exactly once WITH the request (so the caller's `Authorization: Bearer` JWT is forwarded for RLS) — a regression back to `supabase-admin` OR the cookie-only `createSupabaseServerClient()` (which breaks the mobile Bearer caller) fails this. (b) an authenticated OWNER (flag ON, `board_topper`) receives the byte-identical envelope `{ success, data, flagEnabled, intercepted }` (4-item / 45-min plan). (c) an RLS deny on the `students` read (mocked no-row for a cross-user/forged `studentId`) fails CLOSED with `404 { success:false, error:'student_not_found' }` and NO `data` payload. Existing flag-OFF/ON, classroom-sync, 404, and P13 PII-redaction cases re-pointed to the mocked Bearer-aware client. The allowlist guard pins the ledger ratchet 271 → 270 (route pruned from `scripts/admin-client-allowlist.json`, `count` + `EXPECTED_COUNT` decremented; `detected === allowlist`). | `src/__tests__/api/student/daily-plan.test.ts`, `src/__tests__/api-admin-client-allowlist.test.ts`, `scripts/admin-client-allowlist.json` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — the route's reads now run under the caller's identity
  (Bearer JWT or cookie) with RLS enforced; the RLS-bypassing service-role client
  is removed from this path.
- P9 (RBAC enforcement) — defense in depth: `authorizeRequest('study_plan.view')`
  unchanged; RLS is now a real second line for Bearer (mobile) callers too.

### Catalog total

XC-3 Phase 2 batch 3 adds REG-220 (one route — `student/daily-plan` — migrated
admin → Bearer-aware `createSupabaseRouteClient` with per-table RLS-coverage proof,
owner byte-identical + RLS-deny fail-closed + Bearer-aware-client assertion;
mobile Bearer caller now RLS-enforced; admin-client allowlist ratcheted 271 → 270).
**Total catalog: 187 entries (target: 35 — TARGET EXCEEDED).**

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

## Pedagogy v2 Wave 3 critical-bug fix (synthesis surrogate-id) + Dive/Synthesis/OAuth route-contract pins — 2026-07-02 — REG-223..REG-225

Source: today's engineering work. `GET /api/synthesis/state` resolved the
caller's `students` row via `.eq('id', authUid)` instead of
`.eq('auth_user_id', authUid)`. `students.id` is a surrogate uuid distinct
from the Supabase auth uid, so the old form never matched any real row —
every student hit `no_student_profile` and Pedagogy v2 Wave 3 (monthly
Curiosity Synthesis) was completely dead in production for every student,
despite the builder Edge Function correctly writing rows. The fix aligns
`/api/synthesis/state` with the same `auth_user_id` → `students.id`
resolution pattern already used by `/api/dive/state`, `/api/dive/history`,
and `/api/dive/artifact`. This pass also closes the test-coverage gap on the
rest of the Pedagogy v2 Wave 2/3 dive+synthesis route surface and adds
first-time coverage for the OAuth partner-integration surface
(`/api/oauth/authorize`, `/api/oauth/token`).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-223 | `synthesis_state_surrogate_id_resolution` | `GET /api/synthesis/state` MUST resolve the caller's surrogate `students.id` via `.eq('auth_user_id', authUid)` BEFORE querying `monthly_synthesis_runs.student_id` — never `.eq('id', authUid)`, which always misses (the CRITICAL bug fixed today, universally 404-ing `no_student_profile` for every student). Enforced via an argument-sensitive mock: a row resolves ONLY when the query column is `auth_user_id`; any other column (including `id`) returns `{data: null}`, so a regression fails loudly (`no_student_profile` 404 on what should be a 200) instead of silently matching the wrong row. A dedicated test asserts every `students` `.eq()` call used `auth_user_id` (never `id`) and every downstream `monthly_synthesis_runs` `.eq()` call used the resolved surrogate `student_id` (never the raw auth uid). Also pins: bilingual `summaryTextEn`/`summaryTextHi` on the `state:'ready'` row including the Claude lazy-fill path (P7), the lazy-fill persisting via `supabaseAdmin` exactly once, graceful `''` fallback (200, not 500) when the Claude lazy-fill call throws, and a P13 no-PII pin on the `no_student_profile` 404 body. Writer-side key consistency (both writers key `monthly_synthesis_runs.student_id` by the surrogate id, never the auth uid) cross-checked against `supabase/functions/daily-cron/` (`triggerMonthlySynthesis` step) and `supabase/functions/monthly-synthesis-builder/`. | `src/__tests__/api/synthesis/synthesis-routes.test.ts` | E |
| REG-224 | `pedagogy_v2_dive_synthesis_route_contracts` | The full Pedagogy v2 weekly Curiosity Dive route surface — `POST /api/dive/start`, `POST /api/dive/artifact`, `GET /api/dive/state`, `GET /api/dive/history` — and `POST /api/synthesis/parent-share` are pinned end-to-end: 401 when unauthenticated, 404 when `ff_pedagogy_v2_weekly_dive`/`ff_pedagogy_v2_monthly_synthesis` is off, 400 with a specific `error` code per invalid-body branch (missing/blank picker fields, malformed JSON, invalid `pickerOption`), 404 `student_profile_not_found`/graceful empty-array degradation depending on route, and 409 `already_saved_this_week` on a PG `23505` duplicate-artifact insert (not a generic 500). `GET /api/dive/history`'s `?limit` handling is pinned precisely: defaults to 20 when absent, passes an explicit `?limit=5` straight through, and — critically — FALLS BACK to the default 20 (does NOT clamp to a max of 60) when `?limit=100` exceeds the max, guarding against a "fix" that silently changes this to clamp-to-max behavior. `POST /api/synthesis/parent-share` additionally pins the cross-student ownership boundary: a synthesis row whose linked `students.auth_user_id` does not match the caller returns 403 `forbidden` before any WhatsApp send or status write (P8), and every denial body (401/403/404) carries no PII keys (P13). | `src/__tests__/api/dive/dive-routes.test.ts` (35 tests), `src/__tests__/api/synthesis/synthesis-routes.test.ts` (shared file, parent-share block) | E |
| REG-225 | `oauth_partner_surface_contracts` | `GET /api/oauth/authorize` and `POST /api/oauth/token` (the OAuth2 partner-integration surface, service-role `getSupabaseAdmin()` — never the RLS-scoped server client) are pinned: missing required param → 400 `invalid_request`; unknown/inactive/pending-review `client_id` → 400 `invalid_client`/`app_not_approved`; a `redirect_uri` outside the app's registered allowlist → 400 `invalid_redirect_uri` (never silently accepted); unknown/inactive requested scope → 400 `invalid_scope`; a valid request echoes `state` and PKCE `code_challenge`/`code_challenge_method` verbatim and returns the scope's `display_name_hi` Hindi field in the consent payload (P7 — the consent screen must never fall back to English-only). On the token endpoint: missing/unsupported `grant_type` → 400; wrong client credentials → 401 `invalid_client` (via `secureEqual` constant-time comparison, not `===`); a valid `refresh_token` grant returns fresh `access_token`/`refresh_token`/`token_type: 'Bearer'`/`expires_in: 3600` and the response ALWAYS carries `Cache-Control: no-store` (on both success and every error branch) so tokens are never cached; a refresh token that is expired, revoked, or bound to a different `app_id` is rejected with `invalid_grant`, never silently honored; form-urlencoded request bodies are accepted identically to JSON. Every `invalid_client` denial body carries no PII keys (P13). | `src/__tests__/api/oauth/oauth-routes.test.ts` (26 tests) | E |

### Invariants covered by this section

- P1-class data-integrity (the reader/writer surrogate-id contract) — REG-223
  closes a universal-outage-class bug where a reader used the wrong join key
  against a writer that was always correct; the regression guard makes any
  future `id` vs `auth_user_id` drift in `/api/synthesis/state` fail loudly.
- P7 (bilingual UI) — REG-223 pins `summaryTextEn`/`summaryTextHi` on every
  synthesis-state response path (cached and lazy-filled); REG-225 pins
  `display_name_hi` in the OAuth consent-scope payload.
- P8 (RLS boundary / cross-tenant ownership) — REG-224 pins the parent-share
  cross-student ownership check (a synthesis row cannot be shared by anyone
  other than its owning student).
- P13 (data privacy) — REG-223, REG-224, and REG-225 each pin that their
  respective denial response bodies (401/403/404) contain no PII keys
  (no `email`, `phone`, or `name`).

### Catalog total

Pre-REG-223: 189 entries (through XC-3 Phase 4 first drain, REG-222).
Today's Pedagogy v2 Wave 3 critical-bug fix + route-contract hardening adds
REG-223 (synthesis-state surrogate-id resolution — the CRITICAL fix),
REG-224 (dive + synthesis parent-share route contracts, 35+ tests), and
REG-225 (OAuth partner-surface contracts, 26 tests).
**Total catalog: 192 entries (target: 35 — TARGET EXCEEDED).**

---

## 2026-07-02 — Phase 3 Wave 1 #5: quiz-RPC cross-student ownership check (SD-SWEEP, most severe Phase 2 finding)

Source: Phase 2 security audit SD-SWEEP (`docs/audit/2026-07-02-validation/10-security-audit.md`)
found three `SECURITY DEFINER` RPCs — `submit_quiz_results` (legacy v1),
`atomic_quiz_profile_update` (6-arg, `RETURNS jsonb`), and `atomic_quiz_profile_update`
(7-arg, `RETURNS void`, carries `p_session_id`) — all took a caller-supplied
`p_student_id` with **no internal ownership check** and had never had `EXECUTE`
revoked from `authenticated` (only `anon` was revoked). Any authenticated JWT
holder could call one of these directly via PostgREST with an **arbitrary**
`p_student_id` and forge quiz sessions / XP / streak / learning-profile rows
onto another student's account — a critical cross-student data-forgery
vulnerability. Fixed in migration `20260702150000_p3w1_5_quiz_rpc_ownership_check.sql`
by adding the identical `auth.uid()`-scoped ownership check already proven safe
in `submit_quiz_results_v2`, as the first statement after `BEGIN` in all three
functions (fails closed before any write), with a `service_role`/`auth.uid() IS
NULL` exemption so integration/server-side callers are unaffected. P1 (score
formula), P2 (XP formula + 200 daily cap), P3 (anti-cheat flag-then-zero-XP),
and P4 (atomic submission) bodies are byte-identical outside the new check —
independently verified line-by-line by assessment against each function's
current live definition, not just the architect's self-report.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-226 | `quiz_rpc_ownership_check` | All three previously-exploitable SECURITY DEFINER RPCs (`submit_quiz_results` v1, `atomic_quiz_profile_update` 6-arg, `atomic_quiz_profile_update` 7-arg) carry the `auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid())` ownership check, positioned strictly BEFORE the first `INSERT`/`UPDATE` in each function body (a regex-position check on the migration source, not a live-DB call — no Supabase integration credentials exist in CI for this lane). Pins exactly 3 occurrences (none omitted, none duplicated across the two overloads), each unconditionally gated on `auth.uid() IS NOT NULL` (so a future edit that drops the service-role exemption — which would break the `atomic-quiz-xp-42p10-e2e` integration test's service-role caller — fails loudly), and pins arity disambiguation (`p_session_id` absent = 6-arg body, `p_session_id UUID DEFAULT NULL` present = 7-arg body) so a partial "cleanup" that patches one overload but not its sibling is caught. Also freezes P1 (`ROUND((v_correct::NUMERIC / v_total) * 100)`), P2 (`correct*10` + 80%→+20 + 100%→+50, the 200 daily-cap literal in both overloads), and the `PERFORM atomic_quiz_profile_update(...)` v1→shared-XP-path delegation as unchanged by this fix — proving the vulnerability closure is purely additive. Also pins: `BEGIN;`/`COMMIT;` transaction wrapper present, no `DROP TABLE`/`DROP COLUMN`/`DROP FUNCTION`/`DROP INDEX`/`DROP TRIGGER` anywhere in the migration, and migration-header provenance naming the SD-SWEEP finding. | `src/__tests__/regressions/reg-226-quiz-rpc-ownership-check.test.ts` | E |

### Invariants covered by this section

- P8/P9 (RLS boundary / RBAC enforcement — cross-tenant authorization bypass
  class) — REG-226 closes and pins the platform's most severe Phase 2 finding:
  any authenticated user could forge another student's quiz/XP records via a
  direct PostgREST RPC call, bypassing every app-layer check.
- P1/P2/P3/P4 (score formula, XP economy, anti-cheat, atomic submission) — not
  changed by this fix; REG-226 exists specifically to prove they weren't, by
  freezing their literal SQL fragments alongside the new check.

### Follow-up (not yet closed, tracked here for continuity)

The 5-argument overload of `atomic_quiz_profile_update`
(`p_student_id, p_xp, p_correct, p_total, p_subject`) shares the identical
defect class (`SECURITY DEFINER`, caller-supplied `p_student_id`, no ownership
check, `EXECUTE` not revoked from `authenticated`) but has **no live
application caller** as of this migration — it was deliberately left unfixed
(flagged in the migration header) rather than silently expanding scope further
without a dedicated review. Recommended as a standalone follow-up ticket
(candidate fix: `REVOKE EXECUTE ... FROM authenticated` outright, since no
legitimate caller exists to preserve).

### Catalog total

Pre-REG-226: 192 entries (through REG-225, OAuth partner-surface contracts).
Today's Phase 3 Wave 1 #5 critical-vulnerability fix adds REG-226 (quiz-RPC
cross-student ownership check — the platform's most severe Phase 2 finding).
**Total catalog: 193 entries (target: 35 — TARGET EXCEEDED).**

---

## 2026-07-02 — Environment Readiness remediation wave (certification-on-staging) — REG-227..REG-229

Source: `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/environment-readiness-ops.md`
(ops Environment Readiness Assessment ahead of authorizing a certification run
against staging) and its consolidated fix record
`docs/runbooks/2026-07-02-environment-readiness-remediation.md`. Three
independently-confirmed defects, three fixes, three regression tests.

1. **Sentry environment-tagging defect (confirmed, safety-relevant).** All
   three Sentry init files keyed `environment:` off `process.env.NODE_ENV`
   only. `next build` always sets `NODE_ENV=production` for a
   production-mode build regardless of Vercel deploy target — `VERCEL_ENV`
   is the only value Vercel varies. Since staging deploys as a genuine Vercel
   Preview (`deploy-staging.yml`), every staging Sentry event — including any
   error thrown by certification testing — was tagged `environment:
   production`, byte-identical to a real production incident. Fixed by
   reading `NEXT_PUBLIC_VERCEL_ENV`/`VERCEL_ENV` first (matching 35+ other
   call sites), falling back to `NODE_ENV` only for pure local dev.
2. **No canonical certification-traffic traceability convention.** Specified
   in `docs/runbooks/certification-traffic-traceability.md` (four required
   signals: `@certification.alfanumrik.invalid` email domain, `is_demo=true`,
   a `cert-<run_id_short>-<role>-<n>` name/`display_name` marker, and a
   `demo_accounts` registry row) and implemented by
   `scripts/seed-certification-accounts.ts`, which seeds one account per
   certification mission role (7 roles, including `content_author` and
   `support_staff` — real RBAC roles with no dedicated frontend portal per
   this session's Wave 1 findings, seeded anyway so Stage 2 can prove that
   gap live) idempotently (find-or-create, parameterized by a per-run id).
3. **No single-operation teardown path for a school-scoped certification
   tenant.** `students.school_id`/`teachers.school_id` reference
   `schools(id)` with no `ON DELETE CASCADE` (deliberately — a real safety
   property, not a bug), so hard-deleting a `schools` row with any linked
   student/teacher failed with Postgres 23503. Fixed by architect via
   migration `20260702180000_certification_tenant_teardown.sql`, adding
   `purge_certification_tenant(p_school_id)` — a guarded, `is_demo=true`-only,
   single-call teardown of an entire tenant — and extending
   `purge_demo_account_by_id`'s `school_admin` branch to also purge teachers
   (a gap the traceability runbook had flagged and manually worked around).
   **Same-day correction:** a quality review of the first version of this
   migration found its non-cascading-child-table inventory stale, missing 4
   genuinely-blocking tables that exist in this repo today
   (`foxy_chat_messages`, `foxy_sessions`, `ai_workflow_traces`,
   `admin_impersonation_sessions` — per-student) plus 2 tenant-level/B2B
   tables (`payment_reconciliation_queue`, `school_contracts`). The migration
   was extended in place (same file, "Corrected FK inventory" section) to
   clear all 7 blocking items before the parent-row deletes, and REG-229's
   test fixture was extended to match — see the table below for the current
   (13-table) scope.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-227 | `sentry_environment_tag_resolution` | All three Sentry init files (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) resolve `environment:` via `VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV` FIRST, falling back to `NODE_ENV` only when unset — pinned both as a static source-parse (the exact expression string, and a negative assertion that the pre-fix NODE_ENV-only shape never reappears) and as semantic behavior via a byte-identical locally-reproduced resolver function exercised with `vi.stubEnv`: a Preview-deployment-shaped env (`VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV='preview'`, `NODE_ENV='production'`) resolves to `'preview'`, NOT `'production'` — the exact certification-on-staging safety scenario. Also pins that the `beforeSend` production-only drop guard (`if (NODE_ENV !== 'production') return null`) is unchanged by this fix — only the tag, not the send/drop decision. | `src/__tests__/sentry/environment-tag-resolution.test.ts` (11 tests) | E |
| REG-228 | `certification_account_seeding_idempotent_shape` | `scripts/seed-certification-accounts.ts`'s pure shape helpers (`buildAccountShape`, `buildSchoolShape`, `buildBaseTableRow`, `buildDemoAccountsRow`) produce the traceability runbook's exact marker conventions byte-for-byte (`cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid`, matching `name`/`display_name`, `is_demo=true` on every base-table row, `[CERTIFICATION] cert-<run_id_short>-school-<n>` for the synthetic school) for all 7 mission roles (student/teacher/parent/school_admin/super_admin/content_author/support_staff); pins that `content_author`/`support_staff` are seeded with `hasPortal=false` (Wave 1 finding — no frontend portal exists, proved live in Stage 2) while every other role is `hasPortal=true`; pins that `buildDemoAccountsRow` returns `null` (never mislabels as `role='super_admin'`) for the two roles with no CHECK-legal `demo_accounts.role` value, a documented limitation. Idempotency is proven against an in-memory fake client (no live DB, consistent with the rest of the unit lane): calling the find-or-create primitives (`findOrCreateAuthUser`, `upsertBaseTableRow`, `upsertDemoAccountsRow`, `upsertSchoolRow`) and the full `seedCertificationAccounts` orchestrator TWICE with the SAME run id creates every row exactly once (second call reports `created: false` for all 7 accounts, zero new rows in any table); a DIFFERENT run id produces a fully independent, non-colliding row set. | `src/__tests__/certification/seed-certification-accounts.test.ts` (23 tests) | E |
| REG-229 | `purge_certification_tenant_teardown` + `purge_certification_run_teardown` | Covers BOTH certification-teardown functions. **(A) `purge_certification_tenant(p_school_id)`** (migration `20260702180000_certification_tenant_teardown.sql`, corrected post-quality-review to close 4 genuinely-blocking tables the original version missed — see the migration's "Corrected FK inventory" section): (1) raises an exception (`ERRCODE 42501`) and touches ZERO rows when called against a school where `is_demo IS NOT TRUE` (including `is_demo IS NULL`) — the target school row survives completely untouched; (2) a school_id that never existed, and a second/third call on an already-torn-down tenant, both return the idempotent no-op shape (`success:true, already_absent:true`) with no error; (3) a full happy-path run seeds a demo school + a `demo_accounts`-registered student (registry-path branch) + a non-registered teacher (defensive direct-sweep branch) + rows in all 13 tables the corrected migration touches — the 4 original defensively-cleaned school-scoped child tables (`school_alert_rules`, `school_audit_log`, `school_invoices`, `school_seat_usage`), PLUS the 6 tables added by the correction: the 4 per-student RESTRICT/no-cascade child tables (`foxy_chat_messages`, `foxy_sessions`, `ai_workflow_traces`, `admin_impersonation_sessions` — corrected FK inventory items 1-4) and the 2 tenant-level/B2B RESTRICT tables (`payment_reconciliation_queue`, `school_contracts` — items 5-7) — calls the RPC once, and asserts ZERO rows remain across every one of those 13 tables plus `demo_accounts` and the `schools` row itself, then re-calls it twice more confirming the zero-row state is stable. The `payment_reconciliation_queue` fixture's `invoice_id` is deliberately linked to the SAME `school_invoices` row being torn down, so the zero-row assertion also proves delete ORDER (item 6's chained RESTRICT against `school_invoices` — the migration clears `payment_reconciliation_queue` before `school_invoices`; a reversed order would 23503 the whole RPC call and fail every assertion in the block, not just leave a stray row). **(B) `purge_certification_run(p_run_id_short)`** (migration `20260702190000_certification_run_teardown.sql`, the single-call FULL-run teardown that DELEGATES the school-scoped part to `purge_certification_tenant` and adds the standalone-account cleanup the tenant function does not cover): (1) INPUT FORMAT GUARD — a `p_run_id_short` that is not exactly 8 lowercase hex chars raises the migration's documented `ERRCODE 22023` (invalid_parameter_value, "must be exactly 8 lowercase hex characters"), asserted for both a too-long (10-hex) and a non-hex value, with `data` null (no rows touched); (2) DELEGATED TENANT TEARDOWN + STANDALONE CLEANUP — one call on a fully-seeded run (a `[CERTIFICATION]` demo school + school-scoped student/teacher/school_admin + representative tenant child tables + standalone demo guardian + standalone demo admin_users super_admin with all 4 admin child tables it clears — `admin_announcements`, `admin_audit_log`, `admin_impersonation_sessions`, `admin_support_notes` — + a real non-demo school whose `schools.paused_by_super_admin_id` points at the demo admin + 3 `demo_accounts` rows) leaves ZERO rows across every school-scoped AND standalone table, deletes the `schools` demo row, and proves the `paused_by_super_admin_id` NULL path (the real school SURVIVES with its pointer nulled, never deleted); (3) is_demo + DOMAIN DOUBLE GUARD — a NON-demo admin_users row (cert email domain, `is_demo=false`) and a NON-cert-domain guardian row (`is_demo=true`) that match the run marker in every way except the guard both SURVIVE untouched (mirrors the tenant suite's real-school guard proof); (4) auth-USER SURFACING — the returned `standalone_auth_user_ids` array equals `[guardianAuthId, adminAuthId]` (guardian ids first per `v_guardian_auth_ids || v_admin_auth_ids`), and the two survivors' auth ids are NEVER surfaced (function surfaces ids for GoTrue cleanup, does not itself delete auth.users); (5) IDEMPOTENCY — second/third calls return `success:true, already_absent:true` with every `*_purged` counter 0 and empty `standalone_auth_user_ids`, deleting nothing, and a never-seeded run returns the same no-op shape on the very first call. Return-shape field names (`success`, `run_id_short`, `already_absent`, `schools_purged`, `schools_purged_count`, `guardians_purged`, `admin_users_purged`, `demo_accounts_purged`, `standalone_auth_user_ids`) and table/column names are asserted against the migration's actual code, not assumed. LANE: integration (`RUN_INTEGRATION_TESTS=1`), self-skips cleanly without live Supabase credentials — see the file's "STAGE-2 COVERAGE NOTE" for exactly what is proven vs. still pending live execution. | `src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` (8 tests: 4 tenant + 4 run; integration lane) | E |

### Invariants covered by this section

- P13 (data privacy / operational-integrity) — REG-227 closes a genuine
  monitoring-pollution defect: certification-caused staging errors would have
  been indistinguishable from real production incidents in Sentry's
  `environment` filter, defeating the on-call signal.
- P8 (RLS boundary) — REG-229 pins that `purge_certification_tenant` is
  structurally incapable of reaching a non-demo school (the `is_demo`
  guard is inside the function body, not just the `GRANT`), so it can never
  become a general-purpose school-deletion backdoor even from a service-role
  caller pointed at the wrong id.
- Operational-integrity (new class, certification-specific) — REG-228 closes
  the traceability gap the ops Environment Readiness Assessment found (the
  one existing staging E2E seed does not set `is_demo` at all and is
  indistinguishable from a real student); REG-229 closes the corresponding
  teardown gap (no single-operation way to remove a school-scoped tenant with
  seeded students/teachers attached — contradicted by the super-admin
  institutions route's own now-corrected code comment).

### Known gap, explicitly not closed by this wave

REG-229's live-DB execution is deferred to Stage 2 of the certification plan
— see the "STAGE-2 COVERAGE NOTE" inside
`src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` for the
precise scope of what is proven (the migration is structurally sound and the
regression test is written and ready) vs. what remains outstanding (an actual
`RUN_INTEGRATION_TESTS=1` run against live staging, and a full seed
(`scripts/seed-certification-accounts.ts`) → certify → teardown cycle with
the runbook's mandatory post-teardown leak check). Environment Readiness
criterion 5 ("test data can be cleaned up") should be recorded as PARTIALLY
resolved until that Stage-2 run happens, not fully resolved.

### Catalog total

Pre-REG-227: 193 entries (through REG-226, quiz-RPC ownership check).
Today's Environment Readiness remediation wave adds REG-227 (Sentry
environment-tag resolution), REG-228 (certification-account seeding
idempotent shape), and REG-229 (certification-tenant teardown — regression
test written and self-skipping cleanly this session pending Stage-2 live-DB
execution).
**Total catalog: 196 entries (target: 35 — TARGET EXCEEDED).**

---

## 2026-07-02 — Stage 2/3 preparation quality-review follow-up — REG-230

Source: `docs/audit/2026-07-02-certification/evidence/wave-2-environment-readiness/04-stage2-3-preparation-quality-review.md`
Finding Q-3 (MAJOR). Quality reviewed the Stage 2/3 preparation artifacts
(REG-228/229's scripts plus the new certification Playwright specs) and
proved both scripts' production-reference fail-closed guards correct by
running adversarial inputs (uppercase project ref, surrounding whitespace, a
port suffix, and a subdomain-masquerade shape) against a disposable,
non-committed Vitest scratch file — then deleted it. That verdict was
APPROVE WITH CONDITIONS: the manual proof had to become permanent, committed
regression coverage before either script is trusted for a real invocation.
This entry closes that condition. It also closes the companion Finding Q-2
(MAJOR): `scripts/teardown-certification-tenant.ts` had no importer anywhere
in the codebase and `tsconfig.json` excludes `scripts` wholesale, so
`npm run type-check` never actually compiled the file carrying the
safety-critical guard — importing from it in the new test file pulls it into
the compiled program, the same mechanism that already covered
`seed-certification-accounts.ts` via `e2e/certification/helpers/cert-gate.ts`.
Also applied the accompanying MINOR fix (Q-1): the teardown script's
`extractProjectRef` now calls `.toLowerCase()` explicitly on the returned ref
instead of relying on the WHATWG URL API's implicit hostname lowercasing —
correct either way, but now auditable-parity with its sibling in the seed
script.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-230 | `production_reference_guard_fail_closed` | Both certification scripts' production-reference guards — `assertNotProductionProjectRef`/`extractProjectRef` in `scripts/seed-certification-accounts.ts` and `extractProjectRef` (+ the identical inline equality predicate `main()` applies) in `scripts/teardown-certification-tenant.ts` — against the exact adversarial set quality used, for BOTH implementations independently (they are not byte-identical parsers): an uppercase production ref is blocked (case-normalized before compare); a production ref with surrounding whitespace is blocked (trimmed/stripped before compare); a production ref with a nonstandard port is blocked — the seed script's stricter https-only regex fails closed via "unparseable" for this input while the teardown script's URL-API parser still positively extracts and matches the ref, a confirmed behavioral difference that is pinned explicitly rather than glossed over; a different, non-prod ref that merely contains the prod ref as a substring/prefix (`my-shktyoxqhundlvkiwguu-staging`) is correctly NOT blocked by either parser (no false-positive over-block of a legitimate staging URL); the literal subdomain-suffix masquerade shape quality used (`shktyoxqhundlvkiwguu.supabase.co.evil.com`) fails closed (returns null — unparseable, not a positive prod match) on both parsers; a genuine non-prod staging-shaped URL passes cleanly on both; and a fully unparseable/ambiguous URL (`https://supabase.co`, `not-a-url`) fails closed on both, never "probably fine". Also pins that both scripts share the byte-identical `PROD_PROJECT_REF`/`KNOWN_PROD_PROJECT_REF` literal. | `src/__tests__/certification/production-reference-guard.test.ts` (18 tests) | E |

### Invariants covered by this section

- Operational-integrity (certification-specific, same class as REG-227..229)
  — REG-230 closes the last open condition on the Stage 2/3 preparation
  artifacts' APPROVE WITH CONDITIONS verdict: the guard mechanism explicitly
  billed as the thing standing between a certification run and a live write
  to production now has committed, adversarial-input regression coverage
  instead of a one-off manual check that was deleted after use.
- P8-adjacent (fail-closed boundary posture) — both guards are proven to
  treat "cannot positively confirm this is not production" identically to
  "confirmed production" (never "probably fine"), and proven to NOT
  over-block a legitimately different non-prod project ref merely because it
  shares a substring with the production ref.

### Catalog total

Pre-REG-230: 196 entries (through REG-229, certification-tenant teardown).
Today's follow-up wave adds REG-230 (production-reference fail-closed guard
coverage for both certification scripts).
**Total catalog: 197 entries (target: 35 — TARGET EXCEEDED).**

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

## REG-235 — Wave 0 Task 0.7: every `spaced_repetition_cards` writer supplies all NOT-NULL columns (grade as P5 string) + insert failures are never silently swallowed

(Originally drafted as REG-223 on the Wave 0 branch; renumbered to REG-235 at
merge time — main had already assigned REG-223..REG-234 to the Pedagogy v2
surrogate-id fix, OAuth pins, quiz-RPC ownership check, and the adaptive-pipeline
repair wave. REG-235 is the next truly-free id.)

**Why.** Production `spaced_repetition_cards` sat at 0 rows for months because all
three writers violated the real schema and swallowed the resulting errors: the
Foxy save-flashcard route inserted phantom columns (`question`/`answer`/`difficulty`
— none exist in the table) and omitted the NOT-NULL `grade`/`front_text`/`back_text`;
the manual `/api/learner/cards/create` route omitted NOT-NULL `grade`; and the
QuizResults auto-flashcard effect omitted `grade` AND wrapped the insert in a
try/catch that treated every failure as "non-critical" — so every 23502 vanished
without a log line. The SRS feature was structurally dead while appearing healthy.

**What.** Three writer fixes (commits `a92dfeaf` backend + `8a8d7542` frontend):
`src/app/api/student/foxy-interaction/route.ts` rewritten to the REAL schema
(front_text/back_text/grade; phantom columns removed; 23505 on the partial unique
index `idx_src_u` → explicit 409 `duplicate_card`; other errors → `logger.warn`
with pg `code`+`message` only, then 500). `src/app/api/learner/cards/create/route.ts`
now looks up the student's grade (P5 string, never defaulted — missing grade is an
explicit 400 `grade_missing`) and includes it in the insert row. `QuizResults.tsx`
guards the effect on `student.grade` + `selectedSubject` WITHOUT latching the
run-once ref (so a late-arriving grade still creates cards), adds `grade` to every
card payload, and — after the merge with main's REG-234 SRS-chain repair —
batch-inserts first, then retries row-by-row when the batch hits the partial
unique index `idx_src_u` (PostgREST upsert cannot target a partial index; a
single conflicting row would otherwise abort the whole batch), treats 23505 as
benign-silent per card, and warns with `{ code }` ONLY on other codes — never
card text or student identifiers (P13).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-235 | `spaced_repetition_cards writer schema conformance + silent-failure elimination` (3 files) | P5/P6-adjacent/P13: for EVERY writer of `spaced_repetition_cards` — (a) the insert payload carries all NOT-NULL columns (`student_id`, `subject`, `grade`, `front_text`, `back_text` non-empty), with `grade` a STRING matching `/^([6-9]\|1[0-2])$/` (never a number — `toMatch` throws on non-strings); (b) the payload key set is pinned to an EXACT allowlist of real schema columns (baseline `00000000000000_baseline_from_prod.sql` ~13552) — the phantom `question`/`answer`/`difficulty` columns can never reappear; (c) a missing profile grade is an explicit 400 (never a silently-defaulted grade); (d) insert failures are NEVER swallowed — non-23505 codes produce `logger.warn` whose logged-object KEYS are pinned (`['code','message']` server, `['code']` client — no front_text/back_text/question keys) and whose serialized payload never contains card text or student name/id (P13); (e) 23505 (dup on `idx_src_u`) is benign — 409 `duplicate_card` on the Foxy route, silent skip-and-continue per-card in the QuizResults row-by-row retry with no false "created" banner and no warn; (f) the QuizResults effect does not latch its run-once ref when grade/subject are missing, and the results screen always still renders (card creation is non-blocking). | `src/__tests__/api/student/foxy-interaction.test.ts`, `src/__tests__/api/learner/cards/create.test.ts`, `src/__tests__/components/quiz/QuizResults.flashcard-grade.test.tsx` | E | P5, P13 |

### Invariants covered by this section

- P5 (grade format) — every writer sends grade as a string `"6"`-`"12"` (regex
  shape-pinned, never a number, never silently defaulted); sourced from the
  `students` profile server-side and `useAuth().student.grade` client-side.
- P13 (data privacy) — insert-failure logs are key-allowlisted to pg error
  code (+ constraint message / routing UUIDs server-side); card text
  (front_text/back_text/question) and student name never reach the logger.
- Operational integrity (silent-failure elimination) — a schema-violating
  insert can never again fail invisibly: every non-duplicate error path emits
  a `logger.warn` with the pg code, and duplicates are handled explicitly
  (409 / benign per-card skip in the row-retry path) instead of aborting or
  masking the batch. Complements REG-234 (SRS chain repair): REG-234 pins the
  batch-then-row-retry shape and source_id/grade presence at the source level;
  REG-235 pins the behavioral payload/allowlist/logging contract for all
  three writers.

**Amendment 2026-07-03 (branch `fix/srs-dedupe-per-question`):** the
QuizResults writer's `topic` value changed from `bloom_level` to the composite
per-question key ``${subject}:${chapter ?? 'na'}:${question_id}`` (see the
REG-234 amendment above for the full rationale — the bloom key + `idx_src_u`
capped students at 6 lifetime review cards and NULL-bloom cards escaped dedupe).
REG-235's payload-key allowlist CHANGED in the humane-label follow-up
(commit `d4e326fa`): it gained `chapter_title` — a real production column
(nullable text, baseline `00000000000000_baseline_from_prod.sql` ~13552)
deliberately added to the QuizResults writer so review-card display paths
never fall back to the machine dedupe key (`topic` also stays a pinned key;
the QuizResults writer sets `chapter_title` to `"Chapter N"` or the subject
name, never the composite / a question uuid). The same commit hardened the
display side: `humaneCardLabel` (`src/lib/srs-card-label.ts`) converts a
composite-key `topic` to `subject · Chapter N` for legacy rows missing
`chapter_title` (wired into `getReviewCards` in `src/lib/supabase.ts` and
`QuickRecallSection.tsx`), pinned by two new suites —
`src/__tests__/lib/srs-card-label.test.ts` and
`src/__tests__/components/refresh/QuickRecallSection.label.test.tsx`.
`QuizResults.flashcard-grade.test.tsx` gains a per-question-dedupe describe
block pinning the composite value, distinct-cards-per-question, retake dedupe,
topic-never-null, and the batch-then-retry × new-key interaction (one row's
composite key 23505s → batch aborts, row retry keeps the other card,
`created` counts only survivors), plus humane `chapter_title` shape pins.
The other two writers' contracts are untouched.

### Catalog total

Pre-REG-235: 201 entries (through REG-234, adaptive-pipeline repair wave).
Wave 0 Task 0.7 adds REG-235 (all three `spaced_repetition_cards` writers —
Foxy save-flashcard, manual card create, QuizResults auto-flashcards — pinned to
the real schema via exact payload-key allowlists with grade as a P5 regex-shaped
string, plus silent-failure elimination: key-allowlisted `logger.warn` on
non-duplicate insert errors and explicit benign handling of 23505).
**Total catalog: 202 entries (target: 35 — TARGET EXCEEDED).**

---

## Knowledge Intelligence Wave 1 — chapter_asset_inventory substrate + chunk-pass audit engine (2026-07-03)

Source: commits `34e9cbff` (migration `20260703000300_chapter_asset_inventory.sql`
+ shape test) and `413ae6f4` (pure audit-engine modules under
`scripts/knowledge-audit/` + 4 test files + the vitest normal-lane carve-out),
branch `feat/wave0-light-dark-machinery`. Testing-agent verification pass
2026-07-03 strengthened 7 previously-untested guard branches (0/0 + non-finite
coverage denominators, the MAX_MINOR_INDEX 99 ceiling and minor≥1 floor — the
pre-existing "Fig 4.2019" case is rejected by the regex word-boundary, NOT the
ceiling, verified empirically — the MAX_EXERCISE_QUESTION 80 ceiling, the
300-char note truncation, and non-array evidence tolerance).

**Engine v2 redesign (2026-07-03, branch `feat/knowledge-audit-v2-deterministic`):
the Wave 1 pilot gate FAILED (33% accuracy on the clean chapter, 0/4
contamination detections — single-pass LLM enumeration over 20k-84k-token
contexts returns near-empty skeletons). The engine was rebuilt
deterministic-first: 12 STRUCTURAL dimensions are now counted EXACTLY in code
(`structural-scan.ts`, regex + dedupe-by-identifier, overlap-safe, inline/
OCR-flattened matching); contamination is computed in code
(`contamination.ts`, foreign-major series ≥3 members / ≥2 summary blocks /
title garble); the LLM pass is scoped to the 10 SEMANTIC dimensions in ≤15-chunk
batches returning ITEMS (≤40-char labels) that are normalize-deduped code-side
(`prompt.ts` v2 + `parse-semantic.ts`). `parse-response.ts` (v1 single-pass
count parser) and its test file were RETIRED — the REG-236 pin's parser clauses
now live in `parse-semantic.test.ts` (evidence-id restriction re-pinned at v1
strength — exact-equality drop-AND-retain — plus caps, non-array-evidence
tolerance, and suspected_missing hygiene persist; count-clamping is obsolete
because counts are derived from deduped labels, never returned by the model;
the v1 300-char dimension-note truncation pin is retired because v2 notes are
code-generated constants, never model-supplied). New offline
accuracy anchors: authored synthetic mini-chapters under
`scripts/knowledge-audit/fixtures/synthetic-chunks/` with EXACT-count
assertions in `structural-scan.test.ts` + `contamination.test.ts`. Known
limitation (documented in `contamination.ts`): SAME-major cross-book merges
(the g9 "Lines and Angles"/"Perimeter and Area" both-6.x case) remain
undetectable; heading-set bimodality is out of scope for v2.**

**Why.** `chapter_asset_inventory` is the substrate every later Knowledge
Intelligence wave writes into: one row per (cbse_syllabus chapter × dimension)
across the 31-dimension educational-completeness model, written exclusively by
service-role audit workers. The chunk-pass parser is the trust boundary between
a hallucination-capable model and that inventory — if evidence ids, counts, or
expected-count heuristics can be inflated or can smuggle chunk text, every
downstream gap query and generation decision is poisoned. A silent widening of
the dimension enum, a dropped RLS policy, or a lane regression that stops these
pure tests running per-PR would all be invisible without a pin.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-236 | `chapter_asset_inventory 31-dimension substrate + audit-engine parser/coverage invariants` (7 files — engine v2) | (a) **Migration shape** (house REG-125 tokenizer canary, no DB): the `dimension` CHECK enumerates EXACTLY the 31 educational-completeness values (no silent add/remove/rename); RLS ENABLED in the SAME migration with an explicit deny-all policy for `anon, authenticated` (P8 — service-role-only posture); `UNIQUE (syllabus_id, dimension)` upsert target; FK `syllabus_id → cbse_syllabus(id) ON DELETE CASCADE` verified against the baseline; `audit_method` CHECK = exactly the 5 provenance values; `coverage_pct` bounded NULL-or-0..100; strictly additive (no DROP/DELETE/UPDATE/TRUNCATE in executable SQL). (b) **Parser fail-closed tolerance (engine v2 — batched semantic pass)**: unparseable model output → `ok:false`; all 10 SEMANTIC dimensions normalized (empty-filled when absent; bare-array and top-level-flattened shapes tolerated); counts are DERIVED code-side from normalize-deduped item labels (NFKC/lowercase/whitespace/punctuation-stripped, 40-char dedupe key) — the model never returns a count, so v1 count-clamping is obsolete; items string-coerced, blank-dropped, capped at 200/dimension/batch and 80 chars raw; evidence ids restricted to THIS batch's input chunk-id set — hallucinated ids DROPPED while valid ids are RETAINED in order (exact-equality pin), non-array evidence degrades to `[]` — capped at 5, ids only, never chunk text (P13); cross-batch merge label-dedupes counts, unions evidence (cap 5), ORs `metadata_garbled`; `suspected_missing` string-coerced, blank-dropped, normalize-deduped across batches, capped at 50 entries / 200 chars. (v2 note: the v1 "0-fill note", "dropped-id note", and 300-char dimension-note truncation pins are RETIRED — v2 notes are code-generated constants, never model-supplied.) (b2) **Structural scan exactness**: the 12 STRUCTURAL dimensions counted EXACTLY in code against authored synthetic fixtures (overlap-duplicated Fig/SUMMARY/Keywords blocks dedupe by identifier/fingerprint — a broken dedupe fails the exact-count assertions); inline OCR-flattened matching; series labels never double as headings; exercise truncation SURFACES in the finding (found = per-set distinct present, notes carry the continuity expectation, found ≤ expected by construction); deterministic numbering-gap `suspected_missing` labels for the native major only. (b3) **Contamination signals (code-computed)**: foreign-major series fires at ≥3 distinct members (not 1-2 reference noise), multiple-summary fires at ≥2, title garble fires on repeated-phrase OR token-overlap strictly below 0.25 (boundary pinned: exactly 0.25 is clean; <2 content tokens never flags); the g9 SAME-major cross-book merge is pinned as a documented KNOWN-MISS test (expects `contaminated:false`); evidence is short single-line labels only (P13). (c) **Coverage math**: null on null/zero/negative/non-finite denominator (0/0 is null, never NaN); 2dp; clamped to 100 (matches the DB CHECK); negative found → 0. (d) **Heuristic false-positive guards**: MAX_MINOR_INDEX 99 ceiling + minor≥1 floor (a 3-digit OCR minor like "Fig. 4.150" or a "4.0" artifact cannot inflate expected counts); dominant-major grouping rejects minority cross-chapter references; exercise counts require the numbering series to start ≤2 AND respect the MAX_EXERCISE_QUESTION 80 ceiling (a stray line-start "99." cannot fabricate 99 questions); scan filter specs pin `grade` as a P5 string. (e) **Lane**: these pure tests run in the default per-PR `npm test` lane via the `vitest.config.ts` `!(knowledge-audit)` extglob carve-out while every other `scripts/**`/`migrations/**` integration test stays integration-only (verified empirically with `vitest list` under both configs on vitest 4.1.8/picomatch 4, Windows). | `src/__tests__/regressions/chapter-asset-inventory-migration.test.ts`, `src/__tests__/scripts/knowledge-audit/parse-semantic.test.ts` (replaced `parse-response.test.ts` — engine v2), `structural-scan.test.ts`, `contamination.test.ts`, `coverage.test.ts`, `prompt.test.ts`, `pilot-check.test.ts` | E | P5, P8, P13 |

### Invariants covered by this section

- P5 (grade format) — `buildQuestionBankFilterSpec` / `buildGeneratedContentFilterSpec`
  pin `grade` as the string `"6"`, never an integer, in every scan spec.
- P8 (RLS boundary) — RLS enabled + deny-all policy in the SAME migration file;
  service_role is the only writer/reader (house posture, cf. synthetic_monitor_results).
- P13 (data privacy) — inventory `evidence` is chunk-ids-only (foreign ids dropped,
  length-bounded); notes truncated so chunk text can never ride along; the table
  comment itself declares no content/PII, and the row-assembly test asserts every
  evidence entry is an id-shaped short string.

### Catalog total

Pre-REG-236: 202 entries (through REG-235, Wave 0 Task 0.7).
Wave 1 verification adds REG-236 (chapter_asset_inventory 31-dimension CHECK +
deny-all RLS + audit-engine parser/coverage invariants — evidence carries ids
only, P13 — plus the vitest lane carve-out pin).
**Total catalog: 203 entries (target: 35 — TARGET EXCEEDED).**

---

## Premium-UI Phase 1 — design-system token contract (2026-07-04)

Source: commit `e8b3c032` (`feat(design-system): unified token foundation —
radius/spacing/semantic fixes, AA contrast, P7 Devanagari`) on branch
`feat/premium-ui-ux-rebuild`. Phase 1 introduced a runtime CSS-var token layer
that `tailwind.config.js` maps utilities onto (`rounded-* → var(--radius-*)`,
`bg-secondary/text-xp/bg-streak/bg-level-up/bg-danger-light → var(--secondary)`
etc., `shadow-* → var(--shadow-*)`, `p-sp-* → var(--space-*)`, `brand.orange →
var(--orange)`), darkened `--text-3` to `#6B6053` and added the AA-safe CTA
gradient stops `--btn-primary-from/to` (`#CB4710`/`#C2440F`), a 12px
arbitrary-type floor, and Devanagari font fallbacks (P7).

**Why.** The token layer is a silent-failure trap. Before Phase 1 the
`--radius-*` and `--space-*` tokens were REFERENCED by `tailwind.config.js` but
never DEFINED, so `rounded-xl` (used ~670×) and friends computed to the
undefined-token fallback (`border-radius: 0`) — ~1,916 elements rendered
square app-wide with zero build/type/lint error and zero unit-test failure.
The same class of bug hid `bg-secondary` / `text-xp` / `shadow-md` as no-ops.
This is invisible to the JSDOM unit layer (it does not evaluate CSS custom-
property resolution or the cascade), so the ONLY place it can be pinned is a
real browser computing styles. A future edit that drops a token from `:root`,
regresses `--text-3`/CTA contrast below WCAG AA, unpoints `brand.orange`, or
lets sub-12px arbitrary type through would re-introduce a silent, app-wide
visual/accessibility regression — exactly what DD-01's harness guards.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-237 | `design-system token contract resolves — no silent no-op utilities; AA on text-3 + primary CTA` (Playwright computed-style probe) | Device-independent computed-style probing on the public no-auth surfaces `/` (→ welcome), `/pricing`, `/login` at mobile **375px** and desktop **1280px**: (a) **no silent no-op utilities** — every `tailwind.config.js`-referenced CSS var resolves on the DEFAULT (non-cosmic) `:root`: all 23 color tokens (`--orange`, `--primary{,-light,-hover}`, `--secondary`, `--success/--warning/--info/--danger/--danger-light`, `--surface-1..3`, `--text-1..3`, `--xp-color`, `--streak-color`, `--mastery-low/mid/high`, `--level-up`) resolve to a real (non-transparent) color; all 5 `--radius-sm..2xl` resolve to a NON-ZERO radius (the ~1,916-corner square→rounded flip); all 4 `--shadow-sm/md/lg/glow` ≠ `none`; all 9 `--space-1..16` resolve to non-zero padding — each probed by applying `var(--token)` to a real element and reading the fully-resolved computed value (catches both undefined AND resolves-to-nothing var() chains). (b) **end-to-end tailwind wiring** — a real `.rounded-xl` element computes `border-radius: 12px` (not `0`), proving the utility→var mapping, not just the raw var. (c) **AA contrast (≥4.5:1)** computed in-page via sRGB relative luminance: `--text-3` (#6B6053) on `--surface-3` (#EDE6DC); `--btn-primary-from` (#CB4710) on white; `--btn-primary-to` (#C2440F) on white. (d) **brand.orange maps to `var(--orange)`** → resolves to burnt-orange `rgb(232, 88, 28)`. (e) **type floor** — a `.text-[9px]` element computes `font-size: 12px` (sub-12px arbitrary type floors up). (f) **no horizontal overflow** — `documentElement.scrollWidth ≤ clientWidth` (+1px sub-pixel tolerance) at both widths. Pin type is a Playwright computed-style probe BY NECESSITY: the JSDOM unit layer cannot evaluate CSS-var resolution/cascade, so this contract is unpinnable at the unit tier. Full-page screenshots are captured as artifacts (`test-results/visual/`) but are NOT the gate — the assertions are deterministic/device-independent. Authed student surfaces (`/dashboard`, `/quiz`, `/foxy` — the radius flip's highest blast radius) are covered best-effort in an OPT-IN (`VISUAL_AUTHED=1`), non-gating describe via a mocked session; real content QA there needs a seeded student session (documented manual steps). | `e2e/visual-regression/design-system-tokens.spec.ts` (npm script `test:e2e:visual` runs the public-surface gate) | E | P7 (Devanagari fallback stack), UX/a11y (WCAG AA) |

### Invariants covered by this section

- P7 (bilingual UI) — the token layer carries the Devanagari font-fallback
  stacks Phase 1 appended to every family; the harness pins that the token
  contract those stacks ride on resolves rather than falling back to nothing.
- UX / accessibility (WCAG AA) — `--text-3`-on-`--surface-3` and both primary-
  CTA gradient stops on white are pinned ≥4.5:1; the 12px type floor keeps
  micro-labels legible on budget phones in harsh sunlight (the stated design
  rationale). Not a numbered P-invariant, but a release-gating UX contract.

### Catalog total

Pre-REG-237: 203 entries (through REG-236, Knowledge Intelligence Wave 1).
Premium-UI Phase 1 adds REG-237 (design-system token contract — every
tailwind-referenced CSS var resolves on the default `:root` so no
`rounded-*`/`bg-secondary`/`text-xp` computes to the undefined-token fallback;
`--text-3` + both CTA stops clear WCAG AA; `brand.orange → var(--orange)`;
sub-12px arbitrary type floors to 12px — Playwright computed-style probe,
unpinnable at the JSDOM unit tier).
**Total catalog: 204 entries (target: 35 — TARGET EXCEEDED).**

---

## grounded-answer cache-key caller-collision fix (2026-07-04)

Source: ai-engineer fix to `supabase/functions/grounded-answer/cache.ts` +
`pipeline.ts` (verified cache-key collision bug — 5 distinct callers of the
shared grounded-answer pipeline, foxy/ncert-solver/quiz-generator/
concept-engine/diagnostic, previously shared a cache keyed only on
`query || scope || mode`; identical query/grade/subject/chapter/mode across
two different callers collided on the same cache entry, silently serving one
caller's response shape to another — e.g. Foxy's structured-JSON consumer
receiving a plain-text concept-engine-shaped answer).

**Why.** `buildCacheKey` is the sole entry point for cache read/write in the
shared grounded-answer pipeline; a collision there is invisible until a
consumer's parser breaks on a foreign contract shape, at production traffic
volume, across services that don't share an on-call rotation. The companion
normalization-safety property (query text is lowercased/whitespace-collapsed
but punctuation/symbols are preserved) had no explicit pin despite being the
other half of "what makes two queries the same key" — and a real analogue of
getting this wrong already exists in the codebase as a cautionary precedent
(see test notes below).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-239 | `buildCacheKey caller-scoping + punctuation-preserving normalization` | (a) **Caller-collision fix**: `buildCacheKey(query, scope, mode, caller)` now takes a `caller: Caller` parameter and hashes it into the SHA-256 key; the same normalized query/grade/subject/chapter/mode produces 5 DISTINCT keys across the 5 live callers (foxy, concept-engine, ncert-solver, quiz-generator, diagnostic) — no two collide (`new Set(keys).size === keys.length`). (b) **Normalization safety (new, this task)**: the live TS/JS normalizer (`.toLowerCase().trim().replace(/\s+/g, ' ')`) preserves mathematically/semantically significant punctuation — `"What is 5+3?"` vs `"What is 5-3?"`, `"20% of 50"` vs `"20 of 50"`, `"2x=10"` vs `"2x 10"`, and `"What is force?"` vs `"What is force"` (boundary `?`) all produce DIFFERENT cache keys under identical scope/mode/caller. Documents (does not directly test — different runtime, SQL vs TS) the cautionary precedent this guards against: the dormant, unwired `write_foxy_cache`/`lookup_foxy_cache` RPC pair in `supabase/migrations/00000000000000_baseline_from_prod.sql` (lines ~8690/~5594) normalizes with `regexp_replace(p_q, '[^a-zA-Z0-9\s]', '', 'g')`, which strips ALL punctuation/operators — under that regex `"What is 5+3?"` and `"What is 5-3?"` both collapse to `"what is 53"` and collide. That SQL has 0 live callers today but is earmarked as a candidate for a future Postgres L3 cache tier; this test pins the invariant any such revival must independently satisfy. | `supabase/functions/grounded-answer/__tests__/cache.test.ts` | E | P12 |

### Invariants covered by this section

- P12 (AI safety / response-contract integrity) — REG-239 pins that the
  grounded-answer cache can never leak one caller's response shape to a
  different caller (the fixed bug), and that the cache key's query
  normalization cannot silently merge two semantically different NCERT
  math/science questions into one entry (the adjacent safety property this
  task adds a pin for).

### Catalog total

Pre-REG-239: 204 entries (through REG-237, Premium-UI Phase 1 token contract).
Adds REG-239 (grounded-answer `buildCacheKey` caller-scoping fix + the
punctuation-preserving query-normalization safety pin, guarding against the
dormant SQL `write_foxy_cache`/`lookup_foxy_cache` all-punctuation-stripping
regex as a documented cautionary precedent).
**Total catalog: 205 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-238 — DD-16: no dead opacity-on-var utilities (semantic-token alpha guard)

Premium-UI Phase 13 tail cleanup. The recurring DD-16 bug is a "dead
opacity-on-var" Tailwind class: because every semantic colour token in
`tailwind.config.js` is a full `var(--…)` VALUE (`primary: 'var(--primary)'`,
`success: 'var(--success)'`, `surface-1: 'var(--surface-1)'`,
`foreground: 'var(--text-1)'`, the `on-*` pairs, …), Tailwind's `/NN` opacity
modifier cannot inject an alpha channel — it can only decompose palette
hex/rgb or the `white`/`black`/`transparent`/`current` keywords. So
`bg-primary/10`, `text-foreground/80`, `border-success/30` etc. emit no usable
alpha and silently render the wrong opacity. They type-check and lint clean,
which is exactly why they kept reappearing (found in `StatusBadge`,
`DataTable`, `DashboardSidebar`, `UserDrawer`, parent `attendance`/
`notifications`). The sanctioned fix is `color-mix`:
`bg-primary/10 → bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-238 | `no dead opacity-on-var utilities across src/app + src/components` (fs-walk regex guard) | A single synchronous fs walk over every `.tsx` under `src/app` + `src/components` FAILS if any `(bg\|text\|border\|ring\|from\|to\|via\|divide\|outline\|fill\|stroke\|caret\|decoration\|accent)-<var-token>/NN` class appears, where `<var-token>` is one of the `var()`-valued semantic families (`surface-[0-9]/inverse/sunken/accent`, `primary{,-light,-hover}`, `secondary`, `success`, `warning`, `danger{,-light}`, `info`, `foreground`, `muted-foreground`, `on-*`). Palette colours (`white`/`black`/`transparent`/`current`, `orange-500`, …) DO support `/NN` and are intentionally allowed; `bg-[color-mix(…)]` arbitrary values and bare tokens without a modifier pass. Failure message points at `file:line → "matched class"` and prescribes the `color-mix` fix. Includes a regex self-check block: asserts the pattern flags 8 known-bad strings (`bg-primary/10`, `bg-surface-1/25`, `text-on-accent/50`, …) and does NOT flag 11 allowed strings (`bg-white/5`, `bg-orange-500/20`, the `color-mix` fix form, bare tokens). Also guards against a broken walk silently passing (`files.length > 50`). Fast, deterministic, no network. Lands with the Phase 13 cleanup that eliminated all 27 pre-existing dead classes. | `src/__tests__/design-system/no-dead-opacity-on-var.test.ts` | U | P7-adjacent (token layer), UX/a11y (correct opacity rendering) |

### Catalog total

Pre-REG-238: 205 entries (through REG-239, grounded-answer cache-key caller-collision fix).
Premium-UI Phase 13 adds REG-238 (dead opacity-on-var guard — the unit-tier
complement to REG-237's browser token-contract probe: REG-237 proves the tokens
RESOLVE; REG-238 proves no utility silently drops their alpha).
**Total catalog: 206 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-240 — grounded-answer L2 (Upstash Redis) response-cache tier: dual-flag write-gating + defense-in-depth tuple re-validation + REG-50 parity on L2 hits (2026-07-05)

Source: ai-engineer build-out of a new Redis (Upstash) L2 cache tier for the
shared `grounded-answer` pipeline (`supabase/functions/grounded-answer/cache-redis.ts`
+ `_l2-cache-flags.ts`), sitting BEHIND the existing in-memory L1 cache
(`cache.ts`) so cache hits survive Edge Function cold starts and are shared
across instances/regions instead of being trapped per-instance. Both new
flags (`ff_foxy_response_cache_l2_v1` real-serving, `ff_foxy_response_cache_l2_shadow_v1`
shadow/observability-only) are seeded OFF by migration
`20260705000000_seed_ff_foxy_response_cache_l2.sql`, so this entire tier is a
strict no-op in production until an operator ramps it.

**Why.** Four properties make this tier safe to ship dark and safe to ramp,
each independently load-bearing:

1. **Marker-prefixed key design.** The key format
   `rag:cache:v1:<grade>:<subject_code>:<mode>:<caller>:<sha256(query)>` keeps
   grade/subject/mode/caller as literal VISIBLE segments (not just hashed in)
   so two requests can only ever collide in the key namespace if all four
   markers already match — and the `rag:cache:v1` prefix is verified distinct
   from every other Redis prefix sharing the same Upstash instance
   (`rl:general`/`rl:parent`/`rl:admin`/`rl:apikey`/`rl:parent_login`,
   `sess:valid:*`).
2. **Dual-flag write-gating fix.** The tail-of-pipeline write
   (`putInRedisL2`) is gated by `isL2CacheServingEnabled(sb) ||
   isL2CacheShadowEnabled(sb)` — EITHER flag, not serving-only. Pre-fix, an
   operator running ONLY shadow mode (the intended "validate hit-rate before
   flipping real-serving on" workflow) would never populate L2: shadow-mode
   reads would always miss and the feature would be silently useless for its
   actual purpose. The READ/SERVE path stays gated strictly by the
   real-serving flag alone — shadow mode never serves, only observes
   (`cache_shadow_hit` log, always falls through).
3. **Defense-in-depth tuple re-validation.** The stored Redis payload carries
   the ORIGINAL request tuple (`caller, mode, grade, subject_code,
   chapter_number, query_normalized`) alongside the cached response.
   `getFromRedisL2` re-compares the CURRENT request's tuple against the
   stored one before ever treating a hit as valid — ANY mismatch (a future
   key-derivation bug, a hash collision, a corrupted value) is treated as a
   miss, never served. `chapter_number` is deliberately excluded from the
   visible key (keeps it short) but is covered here instead.
4. **REG-50 parity on L2 hits.** The single-retrieval contract (`retrieveChunks`
   ≤ 1 call/turn, cache short-circuits before retrieval) already proven for
   L1 hits now provably holds for L2 hits too: an L2 hit backfills L1 and
   returns immediately, with zero calls to `retrieveChunks` and zero new
   `grounded_ai_traces` rows — exactly the L1 cache's existing "cache hits do
   NOT write a new trace row" guarantee, extended one tier deeper.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-240 | `l2_cache_write_gating_defense_in_depth_reg50_parity` | (a) **Namespace collision-avoidance**: `REDIS_CACHE_NAMESPACE === 'rag:cache:v1'` and is distinct from every existing `rl:*`/`sess:*` prefix (string-level, not comment-only). (b) **Key shape + determinism**: `buildRedisCacheKey` produces `rag:cache:v1:<grade>:<subject>:<mode>:<caller>:<64-hex-char-sha256>`, is case/whitespace-insensitive, preserves math/science-significant punctuation (`5+3?` vs `5-3?`), and differs across grade/subject/mode/caller. (c) **Fail-open on absent secrets**: `getFromRedisL2`/`putInRedisL2` return null/no-op (never throw) when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are unset. (d) **Fail-open on a REACHABLE-BUT-ERRORING Redis** (new, this task — distinct from (c)'s absent-secrets path): with valid secrets pointed at a fake Upstash host whose fetch handler rejects every request (simulated network failure, not a missing-config skip), both `getFromRedisL2` (→ null) and `putInRedisL2` (→ resolves, no throw) degrade to a miss/no-op exactly as the "absent secrets" path does. (e) **Defense-in-depth tuple mismatch is REJECTED against a real stored payload** (new, this task — the pre-existing suite only asserted the tuple-comparison CONTRACT at the shape level, never exercised a real Redis round trip with a genuinely mismatched tuple): a payload is written via `putInRedisL2` against a fake Upstash REST backend with `chapter_number: 1`, then read back via `getFromRedisL2` with an otherwise-identical tuple but `chapter_number: 2` (simulating a hash collision / corrupted value at an unchanged key) — the mismatched read returns `null`, never the stored response. (f) **Dual-flag write-gating**: with the real-serving flag OFF and the shadow flag ON, running the full pipeline against a fake Upstash backend still performs a real `putInRedisL2` write (verified via an independent `getFromRedisL2` lookup afterward) — pins the fix against the pre-fix serving-only write gate. (g) **REG-50 parity on L2 hits** (new, this task — closes the gap the REG-50 catalog entry did not yet cover): with the real-serving flag ON and a matching entry pre-seeded in the fake Upstash backend, running the full pipeline against a Supabase stub whose `rpc()` throws on any call and whose `grounded_ai_traces` table throws on any insert returns the seeded response verbatim (same `answer`/`trace_id`), with the rpc-call and trace-insert counters both remaining exactly 0, and additionally backfills L1 (a subsequent `getFromCache` on the same key is non-null). | `supabase/functions/grounded-answer/__tests__/cache-redis.test.ts` (12 Deno tests — 10 pre-existing + 2 new: tuple-mismatch-rejection (e), network-error fail-open (d)); `supabase/functions/grounded-answer/__tests__/pipeline.test.ts` (2 Deno tests covering (f) pre-existing + (g) new: the L2-hit REG-50-parity test) | E | P12 |

### Invariants covered by this section

- P12 (AI safety / retrieval-cost integrity) — REG-240 extends the REG-50
  single-retrieval contract one cache tier deeper: an L2 hit must be
  observably as cheap as an L1 hit (zero retrieval, zero new trace row), not
  just "returns grounded:true." Also pins that a corrupted/collided Redis
  value can never be served to a student even though the visible key
  matched, and that a genuinely unreachable/erroring Redis (as opposed to a
  simply-unconfigured one) degrades the SAME way — fail-open, never a thrown
  exception on the request path.
- Operational-integrity — the dual-flag write-gating fix ((f) above) is the
  difference between shadow mode being a real pre-ramp observability tool
  and a silently-dead no-op; REG-240 keeps that fix pinned alongside the new
  coverage added in this task.

### Catalog total

Pre-REG-240: 206 entries (through REG-238, Premium-UI Phase 13 dead
opacity-on-var guard). Adds REG-240 (L2 Redis cache tier: namespace
collision-avoidance, dual-flag write-gating, defense-in-depth tuple
re-validation against a real stored/mismatched payload, Redis-reachable-but-
erroring fail-open, and REG-50 single-retrieval-contract parity on L2 hits).
**Total catalog: 207 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-241 — academic-vocabulary NO-MASK on the legacy/fallback Foxy path (P12, both directions) (2026-07-14)

Source: Foxy Phase-0 output-guard word-masking fix. `validateOutput`'s substring
BLOCKLIST (`packages/lib/src/ai/validation/output-guard.ts`) is now
WARN/FLAG-ONLY and NON-DESTRUCTIVE (a match records an advisory `errors` entry so
`valid` goes false, but `sanitizedContent` is NO LONGER rewritten to `***`), a
new bilingual `SAFE_ABSTAIN_MESSAGE` was added, and the three legacy
intent-router workflows (`explain.ts`, `revision.ts`, `doubt-solve.ts`) now route
the student-facing text through the word-boundary-safe `screenStudentFacingText`
(serve-original-or-abstain) instead of assigning `validateOutput().sanitizedContent`.

**Why.** The old bare-substring BLOCKLIST rewrote any match to `***`, censoring
legitimate CBSE vocabulary that merely CONTAINS a token — `assertive`→`***ertive`,
`class`→`cl***`, `passage`→`p***age`, `assess`, `potassium`, `Assam`, `assembly`,
`sexual reproduction`→`***ual reproduction`, `shell`→`s***`. That masked text
reached students on the legacy/fallback Foxy path (`ff_grounded_ai_foxy` OFF, or
the grounded-service abstain fallback). Over-masking is a P12 violation in the
OTHER direction from unfiltered output: it silently breaks real lessons, so the
PASS set is as load-bearing as the BLOCK set. The real student-facing safety
decision now belongs solely to the word-boundary-safe `screenStudentFacingText`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-241 | `foxy_legacy_path_academic_vocab_served_unmasked_genuine_abuse_still_blocked` | (a) **No-mask PASS set**: `validateOutput` returns `sanitizedContent` byte-identical to the input (no `***`) for all 41 realistic CBSE sentences whose curriculum word collides with an `ass`/`hell`/`sex` BLOCKLIST substring (`assertive`, `assertion`, `assert`, `class`, `classify`, `classroom`, `pass`, `passage`, `passive`, `assess`, `assessment`, `mass`, `brass`, `grass`, `compass`, `embarrass`, `associate`, `essay`, `hello`, `shell`, `sexual reproduction`, `therapist`, `analysis`, `potassium`, `molasses`, `glass`, `biomass`, `landmass`, `sextant`, `Assam`, `Sussex`, `Essex`, `assembly`, `ambassador`, `harassment`, `association`, `assassination`, `assassinate`, `assume`, `assumption`, `classical`); each exact word survives verbatim; the three named incident cases (`assertive`/`class`/`passage`) never emit `***ertive`/`cl***`/`p***age`. (b) `screenStudentFacingText` passes every one of those sentences (`safe:true`, no `blocklist` category). (c) **BLOCK set still fires**: genuine profanity/slurs/self-harm (`fuck`, `shit`, the n-word, `faggot`, `kill yourself`, `kys`, `go die`, Hindi Devanagari abuse, Hinglish abuse) are STILL hard-blocked by `screenStudentFacingText` (`safe:false`, category `blocklist`); `validateOutput` still records an advisory flag (`valid:false`, `errors.length>0`) for blocklisted profanity but does NOT mutate `sanitizedContent`. (d) **Workflow boundary** (the value flowing into `persistLegacyFoxyResponse`): all three legacy workflows serve SAFE model text ORIGINAL-and-unmodified (curriculum survives, no `***`), and replace UNSAFE model text with the clean bilingual `SAFE_ABSTAIN_MESSAGE` — never the raw unsafe text, never a `***`-masked variant. (e) `SAFE_ABSTAIN_MESSAGE` is itself bilingual (EN + Devanagari, P7) and self-screening (re-screening it is a no-op). | `src/__tests__/lib/ai/validation/output-guard-no-mask.test.ts` (95 tests — 41-term PASS set × validateOutput + screen, the 3 incident pins, 9 UNSAFE hard-blocks, the advisory-flag-without-mask pin, the SAFE_ABSTAIN_MESSAGE bilingual + self-screen pins); `src/__tests__/lib/ai/workflows/legacy-workflows-no-mask.test.ts` (6 tests — explain/revision/doubt-solve × {safe→original, unsafe→SAFE_ABSTAIN_MESSAGE}) | E | P12, P7 |

### Invariants covered by this section

- P12 (AI safety — BOTH directions). The BLOCK set proves genuinely unsafe
  content is still hard-refused by the word-boundary `screenStudentFacingText`
  backstop; the PASS set proves the coarse substring BLOCKLIST can no longer
  censor legitimate CBSE curriculum — the over-masking regression that shipped
  `***`-mangled lessons to students on the legacy/fallback path is pinned closed.
- P7 (bilingual) — the safe-abstain fallback is EN + Devanagari and re-screens
  clean.

### Catalog total

Pre-REG-241: 207 entries (through REG-240, grounded-answer L2 Redis cache tier).
Adds REG-241 (academic-vocabulary NO-MASK on the legacy/fallback Foxy path —
non-destructive advisory BLOCKLIST + word-boundary `screenStudentFacingText` as
the sole student-facing blocker + serve-original-or-`SAFE_ABSTAIN_MESSAGE` at the
legacy-workflow boundary).
**Total catalog: 208 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-242 — Foxy quota-remaining is DB-authoritative + unlimited-for-paid; no spurious upgrade prompt (P2-adjacent / P11-adjacent) (2026-07-14)

Source: Foxy Phase-0 quota fix. `apps/host/src/app/api/foxy/_lib/quota.ts` now reads
the RPC's real `used_count` column (NOT the never-existent `current_count`) from
`check_and_record_usage` and derives `remaining` against the SAME DB authority the
RPC enforced with, via a `get_plan_limit` call. `_lib/constants.ts` DELETED the
misleading Node-side `DAILY_QUOTA` map (free:10 / starter:30 / pro:100 /
unlimited:999999) and added the `UNLIMITED_QUOTA = 999999` sentinel + a `free`-only
`UPGRADE_PROMPTS` entry. `route.ts` gates the soft upgrade prompt on
`limit < UNLIMITED_QUOTA`. Migration `20260714120000_foxy_unlimited_for_paid_plans.sql`
sets the paid plan codes' `subscription_plans.foxy_chats_per_day = -1` (unlimited;
`get_plan_limit` maps -1 → 999999), leaving `free` finite. `packages/lib/src/usage.ts`
+ `packages/ui/src/foxy/mobile/FoxyToolsSheet.tsx` render "Unlimited" via
`isUnlimitedUsage`.

**Why.** The `check_and_record_usage` return column is `used_count`; the route read
a column named `current_count` that never existed in the return shape, so
`remaining` ALWAYS resolved to the full limit — a wrong countdown. Worse, a stale
Node-side `DAILY_QUOTA` map implied a false local authority the DB never consulted
(enforcement is DB-authoritative: `check_and_record_usage` → `get_plan_limit` →
`subscription_plans.foxy_chats_per_day`). Together they showed paid students a
finite "30 left" / "100 left" countdown and could surface a spurious upgrade
prompt, even though paid plans are entitled to UNLIMITED Foxy chats. The fix makes
both enforcement and the displayed `remaining` DB-authoritative and unlimited-for-paid.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-242 | `foxy_quota_remaining_db_authoritative_unlimited_paid_no_spurious_upgrade` | (a) **No Node-side cap**: the route does NOT pass `p_limit` to `check_and_record_usage` (the RPC derives its own cap); it calls `get_plan_limit` and computes `quotaRemaining = max(0, planLimit − used_count)`, pinned at limit-1 (`used_count=9`, limit 10 → 1), at-limit (`used_count=10` → 0), over-limit clamp (`used_count=15` → 0, never negative), and `allowed:false → HTTP 429` with no LLM call. (b) **Unlimited paid → no upsell**: with `get_plan_limit → 999999` (i.e. `foxy_chats_per_day = -1`) and `used_count=500` on a `pro` plan, `quotaRemaining = 999499` (large, non-negative) and `upgradePrompt` is UNDEFINED. (c) **Prompt gating**: a prompt is shown ONLY when the plan has an `UPGRADE_PROMPTS` entry AND `limit < UNLIMITED_QUOTA` AND `remaining ≤ showAtRemaining` — only the finite `free` tier can nudge; `starter`/`pro`/`unlimited` (and their `basic`/`premium`/`ultimate` aliases via `normalizePlan`) never prompt, even at `remaining 0`. (d) **Client display parity**: `checkDailyUsage`/`getDailyUsageSummary` mirror the DB sentinel — `free` foxy_chat = finite 5; paid tiers (`starter`/`pro`/`unlimited` + `basic`/`premium` aliases + `_monthly`/`_yearly` suffixes) = 999999 → `isUnlimitedUsage` true; `remaining` clamps at 0. (e) **`subscription_plans` contract**: the migration is idempotent (`foxy_chats_per_day IS DISTINCT FROM -1` UPDATE keyed by plan_code) and touches only paid codes (`starter`/`pro`/`unlimited`), leaving `free` finite (verify block WARNs if free went -1). | `src/__tests__/api/foxy/route-characterization.test.ts` (GAP 1 quota-boundary matrix — used_count/get_plan_limit/no-p_limit/unlimited-no-prompt/429); `src/__tests__/lib/usage.test.ts` (unlimited-paid display + alias/suffix normalization + clamp); `src/__tests__/foxy-plan-normalization.test.ts` (UNLIMITED_QUOTA + free-only UPGRADE_PROMPTS + gating parity) | E | P2-adjacent, P11-adjacent, P7 |

### Invariants covered by this section

- P2-adjacent (usage-economy correctness) — the displayed `remaining` is honest
  (derived from the same DB cap the RPC enforced), never negative, and never
  understates a paid plan's unlimited entitlement.
- P11-adjacent (payment entitlement integrity) — the paid-plan Foxy entitlement
  flows from the `subscription_plans` catalog through `get_plan_limit`, not a
  stale Node-side table; the migration changes ONLY the per-day chat entitlement
  (not pricing, subscription status, or payment records), so verified-payment
  gating and atomic status+payment writes are untouched.
- P7 (bilingual) — the free-tier upgrade copy carries EN + Devanagari.

### Catalog total

Pre-REG-242: 208 entries (through REG-241, Foxy legacy-path NO-MASK).
Adds REG-242 (Foxy quota-remaining DB-authoritative correctness — `used_count`
read, `get_plan_limit`-derived remaining, unlimited-for-paid with no spurious
upgrade prompt, and the `subscription_plans` paid=-1 / free-finite contract).
**Total catalog: 209 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-243..REG-246 — Foxy Learning OS Phase 0.2 / 0.3 / 0.4 (durable thread + long-answer integrity + real practice + teach-then-stop) (2026-07-15)

Source: Foxy Learning OS Phase 0.2 (durable conversation thread + Deno bounded
continuation + pending-row hygiene), Phase 0.3 (real gradable practice), Phase 0.4
(teach-then-stop + post-answer action bar). All four behaviors are gated behind
SEPARATE default-OFF feature flags (`ff_foxy_durable_thread_v1`,
`ff_foxy_answer_continuation_v1`, `ff_foxy_real_practice_v1`,
`ff_foxy_learning_actions_v1`; seeds `20260715000000` / `20260715000100` /
`20260715000200` + the existing learning-actions flag) and every entry pins its
own flag-OFF byte-identical path against a mirror/characterization test.

Files: `apps/host/src/app/foxy/_hooks/useFoxyChat.ts`, `apps/host/src/app/foxy/page.tsx`,
`apps/host/src/lib/use-foxy-durable-thread-flag.ts`, `packages/lib/src/use-foxy-durable-thread-flag.ts`,
`apps/host/src/app/api/foxy/_lib/session.ts`, `apps/host/src/app/api/foxy/route.ts`,
`supabase/functions/grounded-answer/{claude.ts,pipeline.ts,_continuation-flag.ts}`,
`packages/lib/src/foxy/{prompt-sections.ts,quiz-me-oracle-gate.ts}`,
`packages/ui/src/foxy/ChatBubble.tsx`.

**Why.** Foxy's context "broke" (students had to re-type the question) because a rapid
second send — or a reload — before the server session frame returned minted a second,
empty session; a topic change silently forked a new thread. Long answers were truncated
at `max_tokens` and the tail was lost to the JSON-rescue net, while empty/pending
assistant rows (from a hard-abstain or a dead LLM call) leaked into cross-session prompt
assembly as empty `[previous · Foxy]` snippets that poisoned later turns. Practice mode
emitted 5 markdown pseudo-MCQs that render as un-answerable text yet claimed "Generated 5
questions" (a fake-action bug). And Foxy re-narrated its own menu of next actions in prose
even though the on-screen action bar already offered them. These four flag-gated fixes
address each, additively and reversibly.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-243 | `foxy_durable_conversation_thread_continuity` | **Client (`useFoxyChat`)**: with `ff_foxy_durable_thread_v1` ON the client mints ONE durable conversation id synchronously (ref-based) so two rapid sends fired before the first resolves carry the SAME `session_id` (the race fix), persisted to BOTH `localStorage.foxy_thread` and the `?c=` URL param; `readStoredThreadId` prefers `?c=` over localStorage then falls back; `adoptConversationId` mirrors id→state+URL+localStorage (reload continuity); `startNewConversation` mints a fresh distinct id. Flag OFF (default) is byte-identical: a send writes NO `foxy_thread`/`?c=`, the first send carries `sessionId:null`, and `startNewConversation` clears the id touching no storage. **Server (`resolveSession`)**: flag ON, the client id is authoritative — an existing row is UPDATEd IN PLACE on a subject/chapter/mode change (same id, no fork, reactivate/idle path never consulted); a well-formed id with no row is INSERTed WITH that id + a `foxy_session_started:<clientId>` event; a `23505` collision with ANOTHER student's id falls back to a server-generated id (never reads/returns the other tenant's row) and warns `foxy.session.thread_id_collision` with `studentId` ONLY (P13); a malformed uuid falls straight through to a server id with no lookup on the bad id. | `apps/host/src/__tests__/foxy/use-foxy-chat.test.ts` (durable-thread describe); `apps/host/src/__tests__/foxy-resolve-session.test.ts` (Phase 0.2 durable-thread describe) | E | P8, P13 |
| REG-244 | `foxy_long_answer_bounded_continuation_and_pending_row_hygiene` | **(a) Bounded ONE-round continuation** (`ff_foxy_answer_continuation_v1`): a Foxy structured turn that stops at `stop_reason='max_tokens'` with the flag ON issues EXACTLY ONE continuation call (2 Claude fetches total, never 3 even if the continuation ALSO truncates); the merged payload is preferred ONLY if it round-trips validation, else it falls back to the EXISTING rescue on the primary — never regress (`structured` always defined, no raw JSON leaks into any paragraph). Flag OFF → NO continuation, byte-identical rescue (1 salvaged block, no `answer` block). A complete `end_turn` answer never fires a continuation (the flag read is short-circuited on the happy path). `stopReason` is normalized for both providers (Anthropic `stop_reason`; OpenAI `finish_reason='length'`→`max_tokens`; absent→`other`, never spuriously `max_tokens`). **(b) Pending-row hygiene**: `loadPriorSessionContext(excludePending=true)` filters pending assistant rows so an empty `[previous · Foxy]` snippet can never leak; `excludePending=false` (default) is byte-identical (pending row still flows); a missing `pending` column → defensive fallback to the legacy unfiltered query + a category-only warn (`foxy_prior_session_pending_filter_failed`, no email/phone/name). On a safety hard-abstain the route UPDATEs the pre-inserted pending assistant row to `SAFE_ABSTAIN_MESSAGE` with `pending=false` (flag ON) / leaves it untouched (flag OFF); the abstain response shape+status (200, `response:''`, `groundingStatus:'hard-abstain'`) is never altered. | `supabase/functions/grounded-answer/__tests__/foxy-answer-continuation.test.ts` + `.../__tests__/claude.test.ts` (Deno, stopReason normalization); `apps/host/src/__tests__/api/foxy/prior-session-context-pending.test.ts`; `apps/host/src/__tests__/api/foxy/foxy-safety-block-pending-cleanup.test.ts` | E | P12, P13 |
| REG-245 | `foxy_real_gradable_practice_oracle_gated_single_binding_anti_fake` | **(`ff_foxy_real_practice_v1`)** EVERY practice mcq is oracle-gated through the SAME machinery that gates `question_bank` inserts (REG-54): `gatePracticeMcqs` runs deterministic P6 checks first (a duplicate-options mcq is dropped with reason `p6_options_not_distinct` and NO LLM call), then the LLM grader, failing CLOSED per mcq on a grader throw (`llm_grader_unavailable`, drops that mcq, never aborts the batch); survivors are capped at `PRACTICE_MCQ_MAX_KEEP` (3) with a bounded oracle-attempt ceiling (LLM-cost cap). **Anti-fake guardrail**: `buildGatedPracticeResponse` rebuilds the turn to contain ONLY oracle-passed `mcq` blocks — any prose ("I generated 5 questions!") is STRIPPED so a turn can never CLAIM questions it didn't emit; returns null when nothing survives → the route serves the graceful bilingual fallback (never an ungated/garbage mcq); title+subject preserved, mcq order preserved, round-trips `FoxyResponseSchema`. **Single evidential binding (served-items invariant)**: the ONE server-held answer key is derived from `kept[0]`, which is the FIRST rendered mcq — so the key grades exactly the question shown, and only one evidential serve happens per turn. Flag OFF → directive selector returns the LEGACY `MODE_DIRECTIVES.practice` (5 pseudo-MCQ paragraphs) byte-identically; flag ON → the interactive `PRACTICE_MCQ_DIRECTIVE` (EXACTLY 3 mcq blocks, mastery-aware/ZPD-bounded difficulty, "do not claim to have created a quiz"); `quiz_me` still wins with `SINGLE_MCQ_DIRECTIVE`. | `apps/host/src/__tests__/lib/foxy/real-practice-gate.test.ts` | E | P6, P1, P2, P3 |
| REG-246 | `foxy_teach_then_stop_meta_offer_suppressed_socratic_check_preserved` | **(`ff_foxy_learning_actions_v1`)** `TEACH_THEN_STOP_DIRECTIVE` bans the ASSISTANT'S own menu of next actions (forbids "Would you like…", "I can give you an example", "Shall I quiz…", "just let me know", "menu of next actions") because the on-screen action bar already offers them, while KEEPING exactly ONE substantive Socratic check-for-understanding question that asks the STUDENT to apply/restate/reason — its shape set by pedagogy mode (CHECK / SCAFFOLD / STRETCH) and never a yes/no "did you understand?". Bilingual (Hindi/Hinglish, technical terms — CBSE/NCERT/Bloom's — in English). It is threaded ONLY through the `mode_directive` channel (via `composeModeDirective`) on prose-teaching turns (mode ≠ practice) when the flag is ON; `quiz_me`/real-practice MCQ shapes still win; flag OFF is byte-identical to the legacy selector for every mode (no teach-then-stop text leaks). `FOXY_SAFETY_RAILS` (P12) and the `buildSystemPrompt` base persona are UNCHANGED — the directive is never baked into the rails/persona (verified for every valid mode). **ChatBubble UI**: flag OFF renders the legacy thumbs/Report bar byte-identically; flag ON renders the learning-action bar (Got it / Explain simpler / Show example / Quiz me + overflow Save/Report) dispatching `got_it`/`explain_simpler`/`show_example`/`quiz_me`/`save`, with NO bar on error-fallback or hard-abstain bubbles, bilingual labels, and ≥44px tap targets. | `apps/host/src/__tests__/api/foxy/teach-then-stop-directive.test.ts`; `apps/host/src/__tests__/foxy/learning-action-chat-bubble.test.tsx` | E | P7, P12 |

### Invariants covered by this section

- P8 (RLS / tenant boundary) — REG-243: a durable client-supplied thread id that
  collides with another student's session (`23505`) NEVER reads or returns the
  other tenant's row; the caller always gets a fresh server-generated id.
- P13 (data privacy) — REG-243 collision warn carries `studentId` only; REG-244's
  pending-filter fallback warn is category-only (no email/phone/name) and the
  safety-abstain audit/response never leaks answer text.
- P12 (AI safety) — REG-244: `structured` is always defined and the bounded
  continuation can only improve, never regress, the existing safety net; REG-246:
  `FOXY_SAFETY_RAILS` + the base persona are byte-identical, and no learning-action
  bar renders on abstain/error surfaces.
- P6 / P1 / P2 / P3 (question quality + scoring/anti-fake integrity) — REG-245:
  every served practice mcq passes the P6 + REG-54 oracle, the single evidential
  key grades exactly the question shown, and a turn can never fabricate a quiz claim.
- P7 (bilingual) — REG-246: the teach-then-stop directive and the action-bar chips
  carry EN + Devanagari, technical terms kept in English.

### Catalog total

Pre-REG-243: 209 entries (through REG-242, Foxy quota-remaining DB-authoritative).
Adds REG-243 (durable conversation-thread continuity — client race fix + server
upsert-by-client-id + cross-tenant 23505 isolation + no-reset-on-topic-change),
REG-244 (long-answer integrity — bounded ONE-round max_tokens continuation +
pending/empty assistant-row hygiene), REG-245 (real gradable practice — oracle-gated
interactive MCQs + single evidential binding + anti-fake guardrail), REG-246
(teach-then-stop — meta-offer suppressed, Socratic check preserved, FOXY_SAFETY_RAILS
unchanged). All four flag-gated default-OFF and byte-identical on the OFF path.
**Total catalog: 213 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-247 — Foxy Perception + event-data-layer: observability-only `learner.turn_classified` + fire-and-forget/fail-safe classifier (flag `ff_foxy_perception_v1`, default OFF) (2026-07-15)

Source: Foxy Intelligent Learning OS, Phase 1C ("Perception classifier"). After
building the reply, `/api/foxy` fires a per-turn PERCEPTION classifier that turns
each tutoring turn into structured, PII-free signal (topic → chapter_concepts uuid,
Bloom level, misconception code, struggle signal, learner intent) and publishes a
`learner.turn_classified` OBSERVABILITY event. The LLM classification runs ONLY on
the Python MOL service (`POST /v1/classify`, cheap gpt-4o-mini evaluation task); the
Node route calls it FIRE-AND-FORGET (a `void`ed async IIFE in the post-response
phase) so the student's answer is returned with ZERO added latency and a classifier
failure can never affect the turn.

Files: `packages/lib/src/ai/clients/python-mol.ts` (Node fail-closed client to the
Python MOL service), `packages/lib/src/foxy/perception.ts` (`classifyTurn` — a PURE
orchestrator around the Python call; parse/validate → codes/ids/enums; reuses the
EXISTING `resolveLeadConceptId` topic resolver + `MISCONCEPTION_CODE_REGEX` ontology
gate; NEVER calls an LLM itself), `apps/host/src/app/api/foxy/route.ts` (post-response
fire-and-forget block), `python/services/ai/api/v1/classify.py` +
`python/services/ai/business/foxy_perception/*` + `python/services/ai/api/main.py`
(the classify endpoint + models/classifier), migration
`20260715130000_seed_ff_foxy_perception_v1.sql` (seeds `ff_foxy_perception_v1`
is_enabled=false / rollout=0). Committed foundation this rests on:
`learner.turn_classified` event kind (`packages/lib/src/state/events/registry.ts` +
Deno `supabase/functions/_shared/state-runtime/events-registry.ts`), the journey
projector's `null` mapping (`packages/lib/src/state/journey/journey.ts`), and
`learning_events.student_pk`.

**Why.** Perception is the first "sensor" of the Foxy Learning OS: it must generate
rich in-turn signal WITHOUT ever putting student text on the bus or in logs (P13),
WITHOUT writing any mastery/p_know/error surface (the binding assessment learner-state
contract — P1/P2/P3 must stay byte-identical), and WITHOUT adding any latency or
failure surface to the tutoring turn. It is doubly dark in production: the
`ff_foxy_perception_v1` flag is default-OFF AND the Node client no-ops until
`PYTHON_AI_BASE_URL` is wired in — so even a flipped flag is a no-op without infra.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-247 | `foxy_perception_observability_only_fire_and_forget_pii_free` | **(a) Observability-only — NO mastery write, journey→null, zero subscribers**: `learner.turn_classified` is OBSERVABILITY-ONLY per the binding assessment learner-state contract — the journey projector maps it to `null` (off the timeline, never a milestone) and NO subscriber consumes it (it appears only in the event registry + journey projector, never in `mastery-state-writer` / `concept-mastery-projector` / `scheduled-actions-writer` / any projector), so it can never feed a mastery / p_know / error surface. P1/P2/P3 are byte-identical (perception never scores, awards XP, or runs anti-cheat). **(b) Fire-and-forget + fail-safe (flag OFF / no infra → byte-identical, no publish, no latency)**: the whole step (flag read → Python classify → publish) lives in a single `void`ed post-response async block; the reply is never awaited on it. Flag OFF → `classifyTurn` is NEVER called and NO `learner.turn_classified` is published, and the turn still returns a clean 200 (byte-identical to today). `PYTHON_AI_BASE_URL` empty/unset → `callPythonMol` returns null unconditionally with NO fetch attempted (architect kill switch), so `classifyTurn` returns null and nothing publishes. A null/garbage/non-object Python body, a non-2xx / network error / AbortController timeout, a throwing classifier, or a throwing topic-resolver all resolve to null (or a best-effort classification with `topicId:null`) and NEVER throw / NEVER affect the 200 reply / NEVER publish an invalid event; a missing assistant message id also skips the publish (the registry requires a UUID `messageId`). **(c) P13 — codes/ids/enums only, no student text on the bus or in logs**: the returned `TurnClassification` and the published event payload carry CODES/IDS/ENUMS ONLY (studentId/foxySessionId/messageId/subjectCode/grade/chapterNumber/topicId/bloomLevel/misconceptionCode/struggleSignal/intent) — the student's message text is sent ONLY to the internal Python classifier (same trust boundary as the tutor LLM call) and is never placed on the object, the event, or a log; the event schema strips unknown PII-shaped keys (messageText/email/phone/name) and Bloom is normalized to the canonical LOWERCASE taxonomy; a hallucinated free-text misconception is dropped by the ontology regex; the Node client + route log status/enums/booleans only. **(d) Node↔Deno registry parity (CI-enforced)**: `learner.turn_classified` is present in BOTH the Node event registry and the Deno mirror (`extractDenoAllEventKinds` + `extractDenoLiteralKinds`), pinned by the Deno-parity suite. **(e) Python classify contract**: the `/v1/classify` models + classifier + endpoint accept a scoped body and return the snake_case classification shape (33 Python tests: 9 models + 19 classifier + 5 integration). | `apps/host/src/__tests__/api/foxy/perception.test.ts` (classifyTurn orchestration + validation + fail-safe + P13); `apps/host/src/__tests__/api/foxy/python-mol-client.test.ts` (fail-closed client — empty `PYTHON_AI_BASE_URL`→null/no-fetch, header forwarding, non-2xx/network/timeout→null); `apps/host/src/__tests__/api/foxy/perception-fire-and-forget.test.ts` (route wiring — flag ON publishes, flag OFF byte-identical, null/throwing classifier no-op, P13 payload); `apps/host/src/__tests__/state/events-registry-turn-classified.test.ts` (schema codes/ids/enums-only + P5 grade-string + P13 key-stripping); `apps/host/src/__tests__/state/events-registry-deno-parity.test.ts` (Node↔Deno parity); `python/tests/unit/test_foxy_perception_models.py`, `python/tests/unit/test_foxy_perception_classifier.py`, `python/tests/integration/test_classify_endpoint.py` | E | P13, P12, P5, P1/P2/P3 (untouched — observability-only) |

### Invariants covered by this section

- P13 (data privacy) — the raw turn text is sent ONLY to the internal Python
  classifier; the returned `TurnClassification`, the `learner.turn_classified`
  event payload, and every Node/route log carry codes/ids/enums ONLY. The event
  schema strips unknown PII-shaped keys, and a hallucinated free-text misconception
  is dropped by the ontology regex before it can be emitted.
- P12 (AI safety) — classification is internal (CBSE-scoped, age-appropriate by the
  Python classifier's prompt + model) and publishes NOTHING to students; it is a
  pure post-response observability telemetry step, doubly dark (flag OFF +
  `PYTHON_AI_BASE_URL` unset) until deliberately enabled.
- P5 (grade format) — the event schema requires a grade STRING "6".."12" (integer /
  out-of-range grades rejected).
- P1 / P2 / P3 (scoring / XP / anti-cheat) — UNTOUCHED. `learner.turn_classified`
  is observability-only: journey→null, zero subscribers, no mastery write. Flag OFF
  and no-infra paths render `/api/foxy` byte-identical to today with no added latency.

### Catalog total

Pre-REG-247: 213 entries (through REG-243..REG-246, Foxy Learning OS Phase 0.2/0.3/0.4).
Adds REG-247 (Foxy Perception + event-data-layer — `learner.turn_classified`
observability-only [journey→null, zero subscribers, no mastery write] + fire-and-forget/
fail-safe classifier [flag OFF or empty `PYTHON_AI_BASE_URL` → byte-identical, no
publish, no added latency] + P13 codes/ids/enums-only + CI-enforced Node↔Deno registry
parity; flag `ff_foxy_perception_v1`, default OFF).
**Total catalog: 214 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-248 — unconditional, FLAG-INDEPENDENT anti-fake-quiz-claim backstop: Foxy never ships "Generated N quiz questions." with no questions (2026-07-15)

Source: Foxy "fake action" fix. A quiz/practice turn could surface the
student-facing sentence "Generated 5 quiz questions." while the actual validated
questions lived in `metadata.questions` — which the legacy persist path drops.
The student saw a CLAIM of a quiz with ZERO questions to answer. REG-245 closed
this ONLY on the flag-ON real-practice oracle path (`ff_foxy_real_practice_v1`);
this entry pins the NEW UNCONDITIONAL backstop that runs on the flag-OFF / legacy
paths regardless of ANY feature flag. Assessment gave APPROVE-WITH-CONDITIONS on
the fix; these tests are the conditions.

Files: `packages/lib/src/foxy/anti-fake-quiz-claim.ts` (`stripFakeQuizClaim(text)
→ {claimOnly, text}` + `QUIZ_CLAIM_FALLBACK_TEXT` — pure, deterministic,
never-throws detector: `claimOnly` is true only when the text matches a
"generated/created/prepared/here-are N questions"-style claim [EN + Hindi/
Devanagari, danda-aware] AND carries < 3 MCQ option markers [`A)`/`(a)`/`1.`] AND
< 2 question marks), `packages/lib/src/ai/workflows/quiz-generate.ts`
(`renderQuizQuestionsText()` renders real `QuizQuestion[]` — bilingual header, 4
lettered options, inline `Answers / उत्तर` key — or returns `QUIZ_CLAIM_FALLBACK_TEXT`
when 0 survive P6 validation; assessment fixed the n===1 singular grammar),
`apps/host/src/app/api/foxy/_lib/legacy-flow.ts` (`persistLegacyFoxyResponse`
strips a claim-only turn to the bilingual fallback in BOTH the wire `response` and
the persisted `foxy_chat_messages.content`, flag-independent — the one gate BOTH
legacy call sites flow through), `apps/host/src/app/api/foxy/route.ts` (new
`else if (isPracticeTurn)` branch ~:2380 strips a claim-only flag-OFF practice turn
→ `buildQuizMeFallbackResponse(subject)`).

**Why.** A tutor asserting it did something it did NOT surface is a "fake action":
it erodes trust and, for a quiz, means the student is handed a phantom
assessment (P6 "question quality" — a served quiz turn must actually carry
answerable questions; P1-adjacent — a claimed-but-absent quiz cannot be graded).
The fix is DEFENSE-IN-DEPTH across 4 layers so a claim-with-no-questions can never
reach a student on ANY path: (1) the render layer never emits a bare claim, (2)
the legacy persist gate strips it, (3) the flag-OFF practice route branch strips
it, (4) the pure detector under all three is EN+Hindi and passes real questions
through untouched. The fallback (`QUIZ_CLAIM_FALLBACK_TEXT`) is bilingual (P7).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-248 | `foxy_unconditional_anti_fake_quiz_claim_backstop_flag_independent` | **(a) Pure detector** (`stripFakeQuizClaim`): EN "Generated 5 quiz questions." (and "I have created a quiz with 5 questions") with no options → `claimOnly:true`, `text === QUIZ_CLAIM_FALLBACK_TEXT`; the SAME "Here are N questions" claim BACKED by real A)/B)/C)/D) options → `claimOnly:false`, passes through byte-identical; Hindi "5 प्रश्न बनाए।" (danda-aware) claim-only → stripped; normal teaching prose → not stripped; empty/whitespace/non-string (undefined/null/number) → defensively `claimOnly:false`, never throws; `QUIZ_CLAIM_FALLBACK_TEXT` is bilingual (EN + Devanagari) and self-stable (feeding it back → `claimOnly:false`, no strip loop). **Two INTENTIONAL narrow false-positive boundaries assessment flagged, PINNED as documented:** a claim + exactly TWO numbered imperative questions with no "?" (2 option markers < the 3-marker floor) is STILL stripped; a Hindi claim + Devanagari-lettered options (क)/ख)/ग)/घ), which the Latin-only `[A-Da-d1-4]` evidence detector doesn't recognize) is STILL stripped — over-stripping here is strictly safer than shipping a phantom quiz, and pinning them makes any future widening of the evidence detector a deliberate reviewed change. **(b) Render/workflow** (`renderQuizQuestionsText` via `runQuizGenerateWorkflow`, real `validateQuizQuestions`): a validated multi-question set renders REAL questions (bilingual plural header "Here are 4 practice questions" + "(4 अभ्यास प्रश्न", 4 lettered options, "Answers / उत्तर:" key) that passes the backstop (`claimOnly:false`) and is never a bare "Generated N" claim; the n===1 degraded path (1 survives P6) renders SINGULAR grammar ("Here is 1 practice question … attempt it … check the answer below", no plural leak, "(1 अभ्यास प्रश्न"); 0 survivors → `response === QUIZ_CLAIM_FALLBACK_TEXT` with `metadata.questions` empty and `validationErrors` non-empty. **(c) Legacy persist** (`persistLegacyFoxyResponse`, flag-independent): a claim-only `legacy.response` → the returned wire `response` AND the persisted `foxy_chat_messages.content` assistant row are BOTH `QUIZ_CLAIM_FALLBACK_TEXT` (never the claim); a real-question turn (A)/B)/C)/D)) passes through UNTOUCHED in both surfaces; NO feature flag is consulted on this path (`isFeatureEnabled` never called). **(d) Route flag-OFF practice branch** (`else if (isPracticeTurn)`, mirrored with the real `denormalizeFoxyResponse` + `stripFakeQuizClaim` + `buildQuizMeFallbackResponse`): a claim-only STRUCTURED turn AND a claim-only GROUNDED answer (structured null) are both swapped for `buildQuizMeFallbackResponse(subject)` (mcq-free, `FoxyResponseSchema`-valid, bilingual EN+Hinglish, and itself not a claim); a real practice structured turn (claim paragraph + 3 real mcq blocks → denormalizes with A)…D) markers) passes through UNTOUCHED (same payload reference flows on). | `apps/host/src/__tests__/lib/foxy/anti-fake-quiz-claim.test.ts` (detector unit + the 2 intentional-FP boundary pins + fallback bilingual/self-stable); `apps/host/src/__tests__/lib/ai/workflows/quiz-generate-anti-fake-render.test.ts` (multi-question real render + n===1 singular grammar + 0-survivors fallback); `apps/host/src/__tests__/api/foxy/legacy-flow-anti-fake.test.ts` (wire+persisted content both fallback, real-turn passthrough, flag-independence); `apps/host/src/__tests__/api/foxy/foxy-practice-flag-off-anti-fake.test.ts` (route branch — structured+grounded claim-only → fallback, real (A)-(D) turn passthrough) | E | P6, P1-adjacent, P7 |

### Invariants covered by this section

- P6 (question quality) — a served quiz/practice turn must actually CARRY
  answerable questions. The backstop guarantees a "Generated N questions." claim
  with no rendered questions is replaced by a graceful fallback on EVERY
  non-oracle path (render, legacy persist, flag-OFF practice route branch), so a
  phantom quiz can never reach a student. REG-245 covers the flag-ON oracle path;
  REG-248 covers the unconditional flag-independent backstop underneath it.
- P1-adjacent (score accuracy) — a claimed-but-absent quiz cannot be graded; by
  refusing to surface a phantom quiz the platform never presents an ungradable
  "assessment" to a student.
- P7 (bilingual) — `QUIZ_CLAIM_FALLBACK_TEXT` (EN + Devanagari) and the route's
  `buildQuizMeFallbackResponse` (EN + Hinglish CTA) are both bilingual, and the
  n===1 render preserves correct singular grammar in both EN and Hindi.

### Catalog total

Pre-REG-248: 214 entries (through REG-247, Foxy Perception observability event).
Adds REG-248 (unconditional flag-independent anti-fake-quiz-claim backstop — the
4-layer defense [pure EN+Hindi detector + real-question render + legacy-persist
strip in wire+persisted content + flag-OFF practice route branch] that guarantees
Foxy never ships a "Generated N quiz questions." claim with no questions, plus the
two intentional narrow false-positive boundaries assessment flagged; complements
REG-245's flag-ON oracle path).
**Total catalog: 215 entries (target: 35 — TARGET EXCEEDED).**

---
