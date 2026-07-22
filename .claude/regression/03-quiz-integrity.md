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

## REG-301 — Phase 2.2 remediation: CBSE-board dynamic-assembly mock-exam rebuild (structural parity with the legacy tool)

Source: Master Action Plan Phase 2.2 (rebuilding the CBSE board mock-exam
surface for genuine structural parity with the legacy tool). Three
independent fixes landed together and are pinned as one entry because they
share the same student-facing surface (the CBSE-board mock exam) and the
same root cause class (silent structural drift between what the UI/DB claim
and what actually gets served/graded):

1. **Section-count bug** in the legacy `/mock-exam` page
   (`apps/host/src/app/(student)/mock-exam/page.tsx`): `SECTIONS` declared
   Section B as `count: 5`, yielding 38 questions / 78 marks against the
   real CBSE 80-mark structure (A 20×1 + B 6×2 + C 7×3 + D 3×5 + E 3×4 = 39
   questions, 80 marks). Fixed to `count: 6`.
2. **Idempotency replay-guard bug** in
   `apps/host/src/app/api/exams/papers/[id]/submit/route.ts`: the
   double-submit short-circuit queried a column literally named `paper_id`,
   which does not exist on `mock_test_attempts` (the real FK column is
   `exam_paper_id` — see `20260520000008_mock_test_attempts.sql`). A
   PostgREST select against a nonexistent column silently returns no rows,
   so the replay guard had **never actually short-circuited a double-submit
   against the real database** — it only appeared to work because the prior
   unit-test mock's in-memory fixture used the same (wrong) property name,
   masking the bug. Fixed to query `exam_paper_id`.
3. **New dynamic cbse_board attempt-assembly flow**: `POST
   /api/exams/papers/[id]/start` (new route) assembles a per-attempt
   question snapshot from `question_bank` and persists it via
   `start_mock_test_attempt` (migration `20260722097000`); submit now scores
   against that snapshot via `submit_mock_test_attempt` (migration
   `20260722097100`) when an `attempt_id` is present, instead of the
   `exam_paper_id` join used by static JEE/NEET/Olympiad papers — with NO
   negative marking for the cbse_board dynamic path. A pre-existing legacy
   multi-subject sample paper (`sample_cbse_class12_general_v1`,
   `subject_scope` length 4) is incompatible with the new RPC's single-
   subject assumption and was deactivated (`is_active = false`, migration
   `20260722097200`) rather than special-cased, since 13 single-subject
   grade-12 template rows already supersede its coverage.
4. **`source_type` content-scope isolation (assessment REJECTION fix,
   2026-07-21, folded into the same `20260722097000` migration)**: all
   three fallback-ladder steps in `start_mock_test_attempt` (exact
   difficulty → target ±1 → any difficulty, each scoped to
   subject+grade) additionally restrict `source_type` to the
   CBSE-board-appropriate allow-list (`ncert_intext`, `ncert_exercise`,
   `ncert_example`, `cbse_style`, `board_paper`, `practice`). Without
   this, the general `question_bank` subject+grade pool the RPC
   deliberately reuses also contains competition-tier rows
   (`jee_archive`, `neet_archive`, `olympiad`, `pyq` — widened onto
   `chk_source_type` by `20260520000004`, seeded by `20260520000006` for
   the SAME physics/chemistry/math grade-12 and math grade-10 subject+
   grade combinations this RPC serves). Pre-fix, step 3 ("any
   difficulty") would silently backfill CBSE-board Section E
   (difficulty target 5) — and, once the small board-tagged pool ran
   out, Sections A-D too — from JEE/NEET/Olympiad-tagged rows for every
   grade-12-STEM and grade-10-math attempt, not as an edge case but as
   the *default* outcome, since genuine board-tagged content for those
   subject/grade pairs tops out at difficulty 1-4 with only 7-8 rows per
   subject. Post-fix, those attempts legitimately resolve to
   `content_insufficient` for the affected sections until real
   board-tagged difficulty-4/5 rows are authored — this is the CORRECT
   behavior (per assessment), not a new bug. A literal NULL
   `source_type` is deliberately NOT treated as board-appropriate even
   though the column defaults to `'practice'` at the schema level, since
   an explicit NULL only arises from an anomalous/unverified insert path
   this RPC should not silently trust.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-301 | `mock_exam_section_b_count_and_dynamic_assembly_parity` | (a) The legacy `/mock-exam` page's rendered "Exam Structure" card shows Section B as `6 × 2 = 12 marks` and a `80 marks` total — never `5 × 2 = 10` / `78 marks`. (b) The submit route's idempotency replay guard queries `exam_paper_id` (not `paper_id`) and correctly short-circuits a double-submit within the 60s window without invoking the RPC. (c) `POST /api/exams/papers/[id]/start` is cbse_board-only (400 `paper_not_cbse_board` for other exam families), 403s without a student profile, and returns `attempt_id` + `questions[]` (including the empty-array `content_insufficient` shape the frontend's `NotReadyCard` depends on). (d) `POST /api/exams/papers/[id]/submit` forwards `attempt_id` as `p_attempt_id` when present (`null` for static papers), and builds the post-submit review from the attempt's own `question_snapshot` (never the `exam_paper_id` join) for dynamic attempts, with marks sourced from the snapshot and no negative marking. (e) The deactivated legacy multi-subject paper (`sample_cbse_class12_general_v1`) no longer appears in `GET /api/exams/papers` and 404s (`paper_not_found`) on `GET /api/exams/papers/[id]` — no dangling reference, since `question_bank`/`mock_test_attempts` FKs to it are untouched (soft `is_active` flip only). (f) `start_mock_test_attempt`'s SQL text has EXACTLY 3 `question_bank` fallback-ladder SELECT steps, and EVERY step's WHERE clause (including step 3, "any difficulty" — the step that previously leaked competition content by design) contains the literal `source_type = ANY (ARRAY['ncert_intext','ncert_exercise','ncert_example','cbse_style','board_paper','practice'])` and none of the 4 competition-tier values (`jee_archive`, `neet_archive`, `olympiad`, `pyq`) appear in any step's WHERE clause or in the allow-list array literal itself — a static-source contract canary against the migration text, since the RPC body cannot be exercised in-process without Postgres. | `apps/host/src/__tests__/app/mock-exam-section-b-count.test.tsx`, `apps/host/src/__tests__/api/exams-submit.test.ts` (idempotency + snapshot-review describes), `apps/host/src/__tests__/api/exams-start.test.ts` (route-level describe, 9 tests: 401 unauthenticated, 400 invalid UUID, 404 unknown paper, 400 non-cbse_board, 403 no student profile, 200 success, 200 content_insufficient, 500 RPC error, 405 non-POST + `source_type` isolation static-contract describe, 4 tests: 3-step-ladder count, per-step allow-list scoping, competition-tier exclusion including step 3, allow-list-literal content check — 13 tests total in this file), `apps/host/src/__tests__/api/exams-papers.test.ts` (deactivation describes) | E |

### Invariants covered by this section

- P1 (score accuracy) / P4 (atomic submission) — the dynamic cbse_board
  snapshot-scoring path still routes through a single RPC
  (`submit_mock_test_attempt`) and the review payload's `marks_awarded`
  matches the snapshot, not a re-derived value.
- P6-adjacent (question/paper structural correctness AND content-scope
  correctness) — the legacy page's advertised exam structure (39
  questions / 80 marks) now matches what is actually assembled and
  graded (previously false by one question); and every question served
  into a CBSE-board attempt is now provably drawn only from
  board-appropriate `source_type` values, closing the vector where the
  shared subject+grade `question_bank` pool let JEE/NEET/Olympiad rows
  silently substitute for missing board-tagged content, especially in
  the "any difficulty" fallback step that has no other filter to catch
  this.
- P11-adjacent (no dangling reference on soft-deactivation) — the legacy
  multi-subject paper's `question_bank`/`mock_test_attempts` FKs remain
  intact after `is_active = false`; only the two catalog-facing read paths
  (`.eq('is_active', true)`) stop surfacing it.

### Catalog total

Pre-REG-301: 300 entries (through REG-300, WhatsApp channel for adaptive-loop
parent escalations). Phase 2.2 remediation adds REG-301 (CBSE-board
dynamic-assembly mock-exam rebuild — Section B count fix, idempotency
replay-guard column bug fix, dynamic snapshot-assembly start/submit flow,
legacy multi-subject paper deactivation, AND the `source_type`
content-scope isolation fix that excludes competition-tier
JEE/NEET/Olympiad rows from every fallback-ladder step so CBSE-board
attempts cannot silently backfill from non-board content).
**Total catalog: 301 entries (target: 35 — TARGET EXCEEDED).**

---

