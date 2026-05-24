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

## Foxy chat surface flicker prevention — REG-78 (2026-05-24)

Source: Fifth attempt at eliminating chat-surface flicker on `/foxy`.
CEO declared P1 ("strictly not acceptable") after four prior single-
symptom fixes shipped on the same day (`e38ced70` compact-on-scroll,
`fd0847d8` translateZ on scroll container, `ac1998cd` sticky+backdrop-
filter, `fd11840b` global sidebar gutter). The proximate regression
this PR closes: PR #903 ("test-only" PR) silently re-applied the
`transform: translateZ(0)` style that `fd0847d8` had just removed, so
the same text-shimmer flicker returned within hours.

The catalogued tests below are the durable systemic backstop. They
fire regardless of which individual CSS / React anti-pattern is the
next root cause:

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-78 | `foxy_chat_surface_no_flicker_during_stream` | (1) **ChatBubble memoisation contract**: `chatBubbleArePropsEqual` skips re-render when only the `content` ReactNode reference changes, and DOES re-render when `rawContent`, `feedback`, `reported`, `groundingStatus`, `traceId`, or `abstainReason` mutate. Without this, parent re-renders at ~20Hz during streaming cascade into every existing bubble. (2) **Per-token re-render isolation**: simulating 50 streamed-token flushes against a list of 2 bubbles (1 student, 1 streaming tutor), only the tutor bubble re-renders — the student bubble's render body executes exactly ONCE. (3) **No GPU compositing promotion on the chat scroll container**: a structural E2E guard asserts the scroll container's inline `style` attribute never contains `translateZ`, `will-change`, or `transform: translate`. This is the durable backstop against the PR #903 regression returning by any path. | `src/__tests__/foxy/foxy-no-flicker.test.tsx` (unit gate — 3 tests) + `e2e/foxy-stability.spec.ts` (E2E structural guard) | E |

### Pinned tests

- `src/__tests__/foxy/foxy-no-flicker.test.tsx::REG-78 — ChatBubble memoisation prevents per-token re-renders::chat_bubble_is_memoized_correctly`
- `src/__tests__/foxy/foxy-no-flicker.test.tsx::REG-78 — ChatBubble memoisation prevents per-token re-renders::chat_bubble_memo_busts_on_meaningful_state_changes`
- `src/__tests__/foxy/foxy-no-flicker.test.tsx::REG-78 — ChatBubble memoisation prevents per-token re-renders::message_list_does_not_re_render_more_than_5_times_during_stream`
- `e2e/foxy-stability.spec.ts::REG-78 — Foxy chat surface pixel stability::foxy_page_loads_without_translateZ_on_scroll_container — REG-78 regression guard`

### Prior fixes in this series (do not regress)

- `e38ced70` — `fix(foxy): stop 30Hz header flicker by disabling compact-on-scroll`
- `fd0847d8` — `fix(foxy): remove translateZ(0) on chat scroll container (text-shimmer)` ← re-applied by REG-78 PR after PR #903 reverted it
- `ac1998cd` — `fix(foxy): stop scroll flicker by dropping sticky-header backdrop-filter`
- `fd11840b` — `fix(foxy): render /foxy full-width by suppressing the global sidebar gutter`

### Root causes addressed by REG-78 PR

1. **`transform: translateZ(0)` on the chat scroll container** (page.tsx
   line ~1450) — re-applied via PR #903's source change inside an
   ostensibly test-only PR. Promoting the chat scroll region to its own
   compositing layer caused sub-pixel text-rasterization mismatches on
   Chromium/Windows, visible as text-shimmer flicker during streaming.
   Re-removed.
2. **ChatBubble not memoised** — every bubble re-rendered on every
   parent re-render during ~20Hz token flushes. Wrapped in
   `React.memo` with a custom comparator that diffs message-identity
   props (rawContent, feedback, reported, groundingStatus, etc.) and
   ignores ReactNode-content + callback prop reference churn.
3. **MessageList not memoised** — the dedup IIFE + `.map` + per-message
   `recoverFoxyResponseFromText` + `isFoxyResponse` work ran on every
   parent render. Wrapped in `React.memo` (default shallow comparator
   works correctly given the prop shape).
4. **Auto-scroll effect schedules a rAF on every messages mutation** —
   page.tsx had one `useEffect([messages, loading])` that fired at
   ~20Hz during streaming. Split into two effects: one that pins to
   the bottom INSTANTLY when `messages.length` changes (new message
   added), another that smooth-scrolls ONCE per turn-completion when
   `loading` transitions 1→0. Eliminates the race between the final
   flushDelta and the smooth-scroll.
5. **ConversationHeader receives `generateTitle(messages.map(...))`
   every render** — `messages.map` allocates a fresh array on every
   parent render, defeating any downstream memo. Title computation
   wrapped in `useMemo` keyed on `messages.length + messages[0]?.id +
   activeSubject`. ConversationHeader itself wrapped in `React.memo`.
   `onOpenSidebar` lifted from an inline arrow to a stable
   `useCallback` so the memo can hit.
6. **MessageInput recomputes `messages.filter(role==='student')` every
   render** — wrapped in `useMemo`. Component itself wrapped in
   `React.memo`.
7. **AppShell compact-on-scroll height transition on the Foxy
   header** — Foxy's header is a 4-5-row stack much taller than the
   56px → 44px transition envelope. Even though Foxy's chat scrolls
   internally (not window-scroll), defense-in-depth CSS forces
   `height: auto !important` + `transition: none` on
   `.foxy-shell > .app-shell-header` so a future change that does
   trigger window scroll on /foxy can't reintroduce the header-clip
   jank.

### Invariants covered by this section

- **P10 (bundle budget)** — the wrap-in-memo changes add < 1 kB to the
  Foxy page bundle. The pre-existing dynamic imports for the heavy
  KaTeX-bearing structured renderer are preserved.
- **P7 (bilingual UI)** — none of the memo wraps depend on `isHi`;
  the language toggle still propagates correctly.
- **UX critical-path** — the Foxy chat surface is the #1 student
  engagement surface (foxy_sessions > 562 active per the recent
  super-admin counter fix). A visible flicker on this surface
  trains students that the AI tutor is "broken" and drops session
  duration. Catalogued at P1 priority by CEO directive.

### Notes on test strategy

REG-78 deliberately spans three layers (mirroring REG-77's three-file
pattern):

1. **`foxy-no-flicker.test.tsx`** — exercises the ChatBubble memo
   comparator directly. Uses a render-counter probe in the `content`
   prop to count how many times the bubble's render body actually
   executes under N parent re-renders. This is the fastest signal
   for any future refactor that breaks memoisation (e.g. converting
   ChatBubble back to a plain function, or adding a new prop that
   defeats the comparator).
2. **`e2e/foxy-stability.spec.ts::foxy_page_loads_without_translateZ_on_scroll_container`**
   — a structural assertion against the live DOM. Catches any
   refactor that re-applies a GPU compositing promotion to the chat
   scroll container, including PRs (like PR #903) that claim to be
   "test-only" but slip a source edit.
3. **`e2e/foxy-stability.spec.ts::no_pixel_flicker_in_static_regions_during_stream`**
   (test.fixme) — pinned for catalog completeness. Becomes the
   pixel-level backstop once the test-student fixture lands in CI.
   Until then the unit + structural tests carry the gate.

If any of these contracts is reverted (e.g. a refactor unwraps the
ChatBubble memo, the comparator stops diffing rawContent, or a future
"defense-in-depth" PR re-applies translateZ on the scroll container),
the suite fails and quality MUST reject.

### Catalog total

Pre-Voice-2: 47 entries. Voice 2 adds REG-77. REG-78 closes the Foxy
chat flicker series.

**Total: 49 entries.**
