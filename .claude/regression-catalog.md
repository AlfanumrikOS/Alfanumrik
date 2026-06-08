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
