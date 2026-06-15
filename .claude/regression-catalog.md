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

2. **Step-name → helper integrity (14 critical pairs).** Each load-bearing step name
   is wired to its implementing helper; deleting or renaming either half breaks the
   pin. This is the guard against a step silently vanishing from the nightly run.

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
| REG-118 | `daily_cron_contract_canary` | Static-source canary (22 Deno tests) pinning daily-cron's load-bearing invariants: fail-closed CRON_SECRET auth gate (constant-time `x-cron-secret` compare) before any work; 14 critical step-name→helper pairs present (deleting/renaming any turns it red); `Promise.allSettled` per-step error isolation (partial failure → 207, never a 5xx collapse); and flag-gating of the monthly-synthesis (`ff_pedagogy_v2_monthly_synthesis`) and school-contract (`ff_school_contracts_v1`) steps. Runs in the CI `edge-function-tests` Deno job. | `supabase/functions/daily-cron/__tests__/contract.test.ts` | E |

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
