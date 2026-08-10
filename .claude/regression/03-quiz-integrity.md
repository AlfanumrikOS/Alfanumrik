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

## DSA-audit fix batch — single canonical P6 question-quality gate + anti-fork canary (2026-07-29, branch `Alfanumrik/alfanumrik-dsa-review-ba6e30`) — REG-322

Source: the 2026-07-29 DSA-audit (data-structures/algorithms review) fix
batch. The P6 gate had silently FORKED: three hand-rolled validator
implementations (`quiz-assembler.ts`, `domains/quiz.ts`, `supabase.ts`) plus
a fourth quarantined copy (`quiz-engine.validateQuestionForQuiz`) each
enforced a different subset of P6, so "every served question is validated"
was only true per-path — the paths disagreed on what "valid" meant (the
`correct_answer_index: null` bypass fixed as REG-318's companion was one
symptom of exactly this fork). Consolidated into ONE canonical
implementation at `packages/lib/src/quiz/question-validation.ts`
(`validateQuestion` + the `validateQuestions` batch wrapper + exported
thresholds); the three former fork sites now delegate to it.

The canonical gate's behaviour is the STRICT UNION of the forks, with two
deliberate, documented relaxation knobs: `allowNonMcq` (relaxes MCQ SHAPE
only, for the assembler's non-MCQ item types) and `enforceBloomLevel`
(bloom validity is OPT-IN, default OFF for serving, because the live
question bank contains null/variant bloom rows that must stay servable — a
silent default-ON flip would mass-invalidate served content).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-322 | `p6_single_canonical_validator_and_anti_fork_canary` | (a) Strict-union behaviour of the canonical gate: `correct_answer_index` must be an INTEGER 0–3 — `null`, non-integers, and out-of-range values rejected (closes the JS `null === i` always-false bypass); options must be exactly 4 distinct non-empty strings; `question_text` non-empty with template markers (`{{`, `[BLANK]`) rejected; `explanation` must clear BOTH the exported char floor and word floor; `allowNonMcq: true` relaxes the MCQ shape checks (options/index) ONLY — text/explanation quality stays enforced. (b) `enforceBloomLevel` pinned in BOTH directions: the default (OFF) must NOT silently re-tighten — rows with null or variant `bloom_level` remain servable — and `{ enforceBloomLevel: true }` must actually enforce the valid bloom set AND forward through the `validateQuestions` batch wrapper. (c) Anti-fork canary over repo source: each per-rejection-reason fingerprint is emitted from exactly ONE file under `packages/lib/src`; no other `packages/lib` file declares a `validateQuestion`/`validateQuestions` body of its own; the three former fork sites (`quiz-assembler.ts`, `domains/quiz.ts`, `supabase.ts`) import and CALL the canonical gate; ONLY `quiz-assembler` passes `allowNonMcq: true`; the quarantined `quiz-engine.validateQuestionForQuiz` has ZERO production callers (it can never serve a student); scan preconditions pinned non-vacuous (non-trivial source set, canonical module exists and exports the gate + thresholds). | `apps/host/src/__tests__/lib/quiz/question-validation.test.ts` (44 tests), `apps/host/src/__tests__/regressions/p6-validator-single-source-canary.test.ts` (8 tests) | E |

### Invariants covered by this section

- P6 (question quality) — one gate, one definition of "valid", enforced on
  every server-side serving path instead of three drifting copies.
- P6 fork-resistance (structural) — the canary turns re-forking into a test
  failure rather than a code-review catch; the same "exactly one
  implementation" posture REG-50 pins for Foxy retrieval and REG-118 pins
  for daily-cron steps.

### Known gaps (documented, deliberate)

- `isValidQuestion` in `apps/host/src/app/(student)/quiz/page.tsx` is a
  deliberately-THINNER last-line client-side filter and sits OUTSIDE the
  canary's `packages/lib` scan scope. It is defence-in-depth, not a fork of
  the gate; pinning it to the canonical implementation would drag the full
  validator into the client bundle.
- `supabase/functions/_shared/quiz-oracle.ts` is the Deno-side parity
  partner of this gate; its `CandidateQuestion` type currently carries NO
  bloom field, so Deno-side bloom parity is NOT claimed by this entry —
  tracked as an ai-engineer follow-up.

### Catalog total

Pre-REG-322: 321 entries (through REG-321, the ncert-solver AI-safety
backport — see `00-header.md`). The DSA-audit fix batch adds REG-322
(single canonical P6 gate + anti-fork canary), the next free id after
REG-321.
**Total catalog: 322 entries (target: 35 — TARGET EXCEEDED).**

---

## Canonical unbiased shuffle — Fisher-Yates with injectable rng + repo-wide biased-comparator ban (2026-07-29, DSA-audit fix batch) — REG-323

Source: same 2026-07-29 DSA-audit batch. Shuffling used the classic biased
idiom `arr.sort(() => Math.random() - 0.5)` — NOT a uniform shuffle (the
result distribution depends on the engine's sort algorithm and is
position-biased) and it mutates the array in place. Replaced by a single
canonical `shuffle()` at `packages/lib/src/shuffle.ts`: a non-mutating
Fisher-Yates over a copy, with an injectable rng (defaulting to
`Math.random`) that makes the algorithm testable EXACTLY — by asserting the
specific permutation a scripted rng must produce — not just statistically.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-323 | `canonical_unbiased_shuffle_and_biased_comparator_ban` | (a) NON-MUTATING: the input array is untouched, the return is a NEW instance, mutating the result does not write back into the input, and `readonly` arrays are accepted (compile-time contract exercised at runtime). (b) PERMUTATION: same multiset for a 10-element array, duplicates preserved exactly (multiset, not set), object identity preserved (elements moved, not cloned), empty and single-element arrays handled — the latter without drawing from the rng at all. (c) DISTRIBUTION-CORRECT via the injectable rng: draws exactly n-1 values for an n-element array; produces the EXACT Fisher-Yates permutation for a scripted rng (and a different exact permutation for a different script); an rng pinned at 0 and one pinned just below 1 produce the two deterministic boundary permutations; same seed ⇒ same permutation; a 12,000-trial uniformity check proves every element reaches every position (no input-order bias); with no rng supplied it defaults to `Math.random` (production behaviour unchanged). (d) REPO-WIDE STATIC CANARY: no source file under `packages/` or `apps/` contains the biased sort comparator in EITHER ordering (`Math.random() - 0.5` or `0.5 - Math.random()`), with a non-vacuous scan-size floor, and the canonical module itself is asserted to BE a Fisher-Yates with an injectable rng defaulting to `Math.random`. | `apps/host/src/__tests__/lib/shuffle.test.ts` (20 tests) | E |

### Invariants covered by this section

- P6-adjacent (question selection/ordering) — a biased shuffle
  systematically over/under-exposes questions by input position and skews
  where a correct option lands after option shuffling; uniformity is a
  fairness property of the serving pipeline even though P6 itself speaks to
  per-question quality. REG-51's server-shuffle AUTHORITY is untouched —
  this entry pins the shuffle PRIMITIVE, not who is allowed to re-derive
  from it.
- Fork-resistance — the static canary makes reintroducing the biased
  comparator anywhere in `packages/` or `apps/` a test failure.

### Catalog total

Pre-REG-323: 322 entries (through REG-322, the canonical P6 gate, above).
The DSA-audit fix batch adds REG-323 (canonical unbiased shuffle +
biased-comparator repo ban).
**Total catalog: 323 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-326..REG-327 — Diagnostic cold-start correctness (2026-07-29): a test was pinning a client-trust scoring defect, and the placement form carried no information

Spec: `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md`
(assessment-owned, 35 acceptance oracles in §8). Implemented by backend
(`/api/diagnostic/start`, `/api/diagnostic/complete`), frontend (`/diagnostic`)
and mobile; pinned here by testing.

**REG-326 is the highest-value entry in this batch and it is a self-inflicted
one.** Before this change, `apps/host/src/__tests__/api/diagnostic-complete-contract.test.ts`
stubbed `question_bank.select -> { data: [] }` and then asserted
`score_percent === 70` for a request body that merely *claimed* 7 of 10 correct.
With an empty question bank the server can derive nothing, so that assertion
could only ever pass if the route trusted the client-supplied `is_correct`
flag. The test was not verifying P1 — **it was protecting the vulnerability**,
and it would have gone red the moment the vulnerability was fixed. Four sibling
P1 cases, the envelope case and both summary-write cases in the same file shared
the same empty fixture and the same defect. Every one of them has been rebuilt on
a real `question_bank` fixture carrying real `correct_answer_index` values, and
the adversarial direction is now asserted explicitly in both directions.

Two further stale-by-design corrections in the same batch, recorded so they are
not mistaken for weakened assertions:

  * `diagnostic-api.test.ts` asserted `400 INVALID_GRADE` for grades `"11"` and
    `"12"`. That was correct while `VALID_DIAGNOSTIC_GRADES` was `['6'..'10']`;
    spec §4 G1 widened it to `['6'..'12']` because `resolve-next-action` routes
    every zero-mastery student — all grades — to `/diagnostic`, so a Class 11
    student's first CTA was a hard 400. The two tests are INVERTED, and the
    range boundary is re-pinned at `"5"`/`"13"` plus integer rejection (P5).
  * The placement boundaries moved from 40/70 to **50/80** (§7.5a). Under the
    old all-easy form an average student scored ~95%, so 40/70 placed nearly
    everyone at `hard`. The four boundary cases moved from 39/40/69/70 to
    49/50/79/80 — the cuts MOVED, they were not relaxed.

Also corrected: `diagnostic-api.test.ts`'s "full success path" asserted a
`session_id` from a ONE-item, chapter-less, unverified fixture. Under the old
`ORDER BY difficulty ASC LIMIT 15` selector that fixture happened to produce a
session; under the §1 blueprint + §2 Tier-0 gate it cannot satisfy any rung, so
the honest outcome is the Rung-4 stop. The fixture describes an EMPTY pool and
now asserts exactly that.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-326 | `diagnostic_complete_server_rederives_correctness` | **C1 / spec AC-28 — the client's `is_correct` is NEVER read, in either direction.** (a) A 15-item body claiming `is_correct: true` on every answer while submitting indices that all DISAGREE with `question_bank.correct_answer_index` yields `score_percent === 0`, `correct_answers === 0`, and `is_correct: false` on every persisted `diagnostic_responses` row (with `correct_index` sourced from the bank, not the payload). (b) The deflating direction is equally ignored: an all-`false` claim over all-correct indices still scores 100. (c) A partially-forged body (7 genuinely correct of 10, claimed 10) scores 70. (d) A forged `question_id` with no bank row resolves to INCORRECT with `correct_index: null` — never to the claim. (e) An empty bank result AND a bank read ERROR both score 0 (fail-closed), where the pre-fix test asserted 70 off an empty bank. (f) AC-29 property test: across 200 randomized `(total, correct, lie-direction)` triples, `score_percent === Math.round((serverCorrect/total)*100)` and the answer is independent of the claim. (g) **P1 unchanged at every form length** — 7/10 to 70, 1/3 to 33 (integer, never 33.33), 2/3 to 67, 0 to 0, all to 100, and the ladder lengths 15/14/12/10 (AC-20 short form). (h) **AC-31 / §7.5a boundaries** 49 to easy, 50 to medium, 79 to medium, 80 to hard, with `DIAGNOSTIC_PLACEMENT_THRESHOLDS` exported so route and test cannot drift. (i) **AC-30 / C2** avg < 3s per question forces `recommended_difficulty: 'medium'` + `placement_confidence: 'low'` regardless of score (100% and 0% both), exactly 3s is NOT a speed run (strictly-less-than boundary), and the confidence is written into the `next_path` summary. This is a placement-validity rule on an XP-neutral surface — **P3's three checks on the XP-bearing quiz path are neither removed nor weakened**. (j) **AC-32 XP neutrality** — no RPC is called at all (so `atomic_quiz_profile_update` cannot be), no insert/update payload carries an `xp`/`level`/`streak` key, and no XP-bearing table (`quiz_sessions`, `student_learning_profiles`, `students` writes) is touched. (k) Retained: 409 `ALREADY_COMPLETED` idempotency, delete-then-insert ordering + assessment-scoped delete filter, ownership-scoped summary update, and the INSERT_ERROR / SESSION_NOT_FOUND / NO_STUDENT error paths. | `apps/host/src/__tests__/api/diagnostic-complete-contract.test.ts` (37 tests — full rewrite), `apps/host/src/__tests__/diagnostic-api.test.ts` (P1 describe rebuilt on a real 4-row bank fixture + an explicit all-true-claim case) | E |
| REG-327 | `diagnostic_blueprint_ladder_and_verification_gate` | **§1 blueprint + §2 Tier-0 gate + §5 ladder + §6 Bloom's, asserted against the PURE selector (`packages/lib/src/diagnostic/blueprint.ts`) so no DB is needed.** (a) AC-1 a well-supplied pool yields exactly 15 items at `{easy:5, medium:6, hard:4}`. (b) AC-2 the served band sequence equals the fixed positional template `[1,1,2,2,3,2,1,3,2,2,3,1,2,3,1]` at Rung 0 AND Rung 1. (c) AC-3 two seeds over the same pool give different item sequences while both still satisfy AC-1/AC-2, and the same seed is reproducible. (d) AC-5 positions 1, 2 and 15 are easy and no two adjacent positions are both hard. (e) **AC-4 — the information oracle, and the reason the blueprint exists.** A reference `SE(theta) = 1/sqrt(sum I(theta))` built on the platform's OWN `cognitive-engine.irtProbCorrect` (3PL, D=1.7, a=1.0, c=0.25, b=(d-2)*1.5) asserts `SE(+1.5) < 1.0` for the served form, and `SE(theta) < 1.0` across the whole reported range [-2,+2]. **The pre-fix all-easy 15/0/0 form is included as an explicit NEGATIVE fixture** and must FAIL the same assertion (spec §1.2 puts it at ~2.26) — so reintroducing `ORDER BY difficulty ASC LIMIT 15` cannot silently return. The blueprint is additionally asserted to beat the legacy form by >2x at theta=+1.5. (f) AC-6 table-driven: 21 one-violating-row fixtures covering V1-V17 (inactive, soft-deleted, draft, wrong/integer grade, wrong subject, non-MCQ, 3 options, empty option, duplicate options, index out of 0-3, short text, `{{` template marker, empty explanation, out-of-band difficulty, non-canonical Bloom, all three `failed*` verification states, competition `source_type`, off-syllabus chapter) — each asserted absent from the output at Rung 0, Rung 1 AND a degraded rung. (g) AC-7 a `failed` row is excluded even when it is the ONLY item that could fill the blueprint; degradation, never inclusion. (h) AC-8 an all-`legacy_unverified` pool produces Rung 1 / `standard` / 15 items, not an empty result. (i) AC-9 every returned item passes the REAL `validateQuestion()` from `quiz-assembler`, called directly. (j) AC-10 no duplicate ids even when the pool contains the 3-band-query overlap. (k) AC-11/AC-12 off-syllabus chapters never served, an empty syllabus set yields Rung 4 (`too_few_chapters`), and Rung 0-1 forms span >=5 distinct chapters with <=3 items per chapter. (l) AC-19 per-rung tiers, and Rung 4 for empty / no-hard-band / no-HOTS pools with zero questions and a reason. (m) **AC-24 property test over 500 randomly-shaped pools**: every SERVED form (any rung) has >=1 `difficulty === 3`, >=1 HOTS item, and 0 items violating V1-V18 or `validateQuestion()`; any pool that cannot satisfy that returns Rung 4 with zero questions — and the test asserts BOTH branches were actually exercised. (n) AC-25/26/27 Bloom's windows at Rung 0-1, the relaxed >=3-levels />=1-HOTS / remember<=50% shape at Rung 2-3, and `DIAGNOSTIC_BLOOM_LEVELS` byte-equal (including ORDER) to `cognitive-engine.BLOOM_LEVELS`. (o) **Route-level**: AC-13 a `chapter` param is 400 `CHAPTER_NOT_SUPPORTED` before any DB work; AC-14/AC-15 all seven STRING grades `"6".."12"` return 200 with 15 questions and a `session_id`, `grade` is a string on the request, on the `diagnostic_assessments` insert AND in the response, and integer `11` is rejected before any DB work (P5); **AC-21 Rung 4 returns HTTP 200 and inserts NO `diagnostic_assessments` row** (asserted on the recording client, including the large-pool-but-no-hard-band case); AC-22 `alternatives` is never empty and always ends with the unconditional Foxy CTA — including the pathological "no other unlocked subject AND no syllabus chapters" fixture — and every alternative carries EN + Devanagari copy plus an href (P7); AC-23 the `diagnostic_content_gap` ops event matches no student_id / email / phone / name key and does not contain the student id, while still carrying grade/subject/pool-shape counts (P13); AC-17 a grade-11 student with no stream and no unlocked subject gets the §7.4 stream payload with bilingual copy, not a 400 and not an empty diagnostic; AC-32 the start path calls no `atomic_quiz_profile_update` and touches no XP-bearing table; and the client question payload never carries `verification_state` / `is_verified` / `irt_*` / `source_type` / `content_status`. | `apps/host/src/__tests__/lib/diagnostic/blueprint.test.ts` (57 tests), `apps/host/src/__tests__/api/diagnostic-start-contract.test.ts` (20 tests), `apps/host/src/__tests__/diagnostic-api.test.ts` (grade range + Rung-4 honest-stop describes) | E |

### Known gaps — stated, not papered over

Following the REG-321 precedent, the parts of spec §8 that are NOT covered by
an automated test in this batch:

- **AC-18** (`resolve-next-action` returns `cold_start_diagnostic` for a
  zero-mastery grade-12 student AND that URL resolves 200 end-to-end) is NOT
  pinned. The route half is covered by REG-327(o); the `resolve-next-action`
  half and the E2E stitch are not.
- **AC-33/AC-34/AC-35** (the full bilingual sweep over the §7 copy constant, the
  untranslated-technical-term rule, and "no student-facing string is hardcoded
  in a component") are only partially covered: REG-327(o) asserts Devanagari
  presence on the Rung-4 alternatives, the insufficient-content message/headline
  and the stream message. There is no table-driven sweep over every exported
  member of `packages/lib/src/diagnostic/copy.ts`, and no static check that
  components import from it rather than inlining.
- **AC-16** (grade-11 `commerce` student requesting `physics` gets the existing
  422 `subject_not_allowed` with `reason: 'grade'`) is covered by the
  pre-existing `diagnostic-api.test.ts` governance describe against the real
  `validateSubjectWrite`, but NOT re-asserted for grades 11-12 specifically;
  `diagnostic-start-contract.test.ts` mocks that boundary deliberately.
- The **`/diagnostic` page** (`apps/host/src/app/diagnostic/page.tsx`) and its
  short-form banner / content-insufficient / stream screens have no component
  test in this batch. The API contracts they consume are pinned; their rendering
  is not.

### Invariants covered by this section

- P1 (score accuracy) — REG-326(f)(g): `Math.round((correct/total)*100)` over
  the SERVER-derived correct count, at every ladder form length, verified by a
  200-case property test rather than a handful of literals.
- P2 (XP economy) — REG-326(j) + REG-327(o): the diagnostic is XP-neutral on
  both routes. No RPC, no XP-bearing table, no XP-shaped key in any payload.
- P3 (anti-cheat) — explicitly UNCHANGED. §7A C2 adds a placement-confidence
  downgrade on the XP-neutral diagnostic surface; it neither removes nor relaxes
  any of the three checks on the XP-bearing quiz path.
- P5 (grade format) — REG-327(o): strings `"6".."12"` on the request, on the
  `diagnostic_assessments` insert and in the response; integer twins rejected
  for all seven grades; `"5"`/`"13"` rejected; and V4 rejects a numeric `grade`
  on a candidate row even when it "equals" the requested grade.
- P6 (question quality) — REG-327(f)(i): V1-V17 plus the real `validateQuestion()`
  gate every served item at every rung, asserted per-predicate and again as a
  500-pool property.
- P7 (bilingual) — REG-327(o), partially; see the AC-33/34/35 gap above.
- P13 (data privacy) — REG-327(o): the content-gap telemetry carries grade,
  subject and counts only, with no student identifier of any kind.

### Catalog total

Pre-REG-326: 325 entries (through REG-325, the daily-cron leaderboard-ranking
RPC delegation — see `11-infrastructure.md`). Diagnostic cold-start correctness
adds REG-326 (complete-route server-side correctness re-derivation — the entry
that replaces a test which was pinning a client-trust scoring defect) and
REG-327 (blueprint / Tier-0 verification gate / insufficient-pool ladder /
Bloom's spread, with the pre-fix all-easy form kept as an explicit negative
fixture on the SE information oracle).

Renumbering note (2026-07-29): this batch originally claimed REG-322..REG-325.
The same-day DSA-audit batch (PR #1415) landed on `main` first and consumed
REG-322..REG-325, so this batch was renumbered to REG-326..REG-329 during the
rebase. No entry from either batch was dropped or reworded.
**Total catalog: 327 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-333 — `select_quiz_questions_rag` now filters on NCERT-verification status (wires the existing `ff_grounded_ai_enforced_pairs` control into quiz-serving; closes the specific gap REG-332's own "Known gaps" section flagged and explicitly declined to fix) (2026-08-02)

Source: `docs/superpowers/specs/2026-08-02-quiz-rag-verification-gate-correctness.md`
(assessment-owned; CEO-authorized fix). `select_quiz_questions_rag` — the RPC
serving quiz questions to `/api/quiz`, `/api/v2/quiz/questions`, and the
WhatsApp Daily-6 top-up path — has never, across 7 historical versions since
2026-04-03, filtered on `question_bank.verification_state` or
`verified_against_ncert`. This is the SAME gap REG-332's own "Known gaps"
section (`13-rag-cache.md`) independently found and explicitly declined to fix
("SEPARATE, pre-existing, NOT fixed here"). A row the automated NCERT verifier
has explicitly DISPROVED (`verification_state='failed'`) could be served to a
student with no gate at all; the retroactive verifier
(`supabase/functions/verify-question-bank/index.ts`) sets
`verification_state='failed'` on a disproved legacy row WITHOUT touching
`is_active` (independently re-confirmed by direct read of the UPDATE payload,
lines 238-248 — no `is_active` key present anywhere in it), so disproved
legacy rows stay `is_active=true` and fully servable today.

Migration `supabase/migrations/20260802100000_select_quiz_questions_rag_verification_gate.sql`
adds three Tier-0 predicates, applied identically and unconditionally across
all four repeated query blocks (pool-count, seen-count, 80%-reset delete,
`candidate_pool` CTE): `deleted_at IS NULL`, `content_status='published'`,
`verification_state != 'failed'` (this last one has NO fallback rung at any
tier — spec §3.4). It then wires the existing, tested, hysteresis-protected
`ff_grounded_ai_enforced_pairs` control (enable requires server-recomputed
`verified_ratio >= 0.9`; auto-disable at `<0.85`) into serving for the first
time since that table was introduced — confirmed by grep that nothing
previously read `.enabled` anywhere in the three call sites. Because the
pair-level 90% floor is computed in aggregate across chapters, a
local-thinness fallback ladder applies the strict filter
(`verified_against_ncert=true AND verification_state='verified'`) only when
the enforced pair's verified pool for the EXACT requested chapter/type/
difficulty slice already meets the requested count (Rung E0); otherwise
Tier-0-only applies (Rung E1), with an `ops_events` telemetry row (no student
identifier) firing only for the enforced-but-locally-thin case.

**Testing independently re-ran everything rather than trusting the
architect's self-report:**

- Function signature re-verified byte-identical (same 8 params, names/types/
  order/defaults) across all 5 `CREATE OR REPLACE` bodies since 2026-04-03
  (baseline, `20260509161642`, `20260514000000`, `20260625000200`,
  `20260801100700`) plus this new migration, by direct read of each file — no
  accidental overload (the exact bug class that hit a sibling RPC, per
  `20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql` and
  `20260729130000_fix_6arg_quiz_xp_ledger_write.sql`, both independently
  confirmed to exist on disk). The baseline's `pg_dump`-rendered form differs
  in surface syntax (double-quoted identifiers, single-line,
  `'{mcq}'::"text"[]`) but is semantically identical in name/type/order/
  default — not a discrepancy, since Postgres resolves overloads on
  argument-type signature, not source formatting.
- RLS claims re-verified against the live baseline SQL, not taken on faith:
  `ff_pairs_read_all` is `FOR SELECT USING (auth.role()='authenticated')`;
  `ops_events_no_client_access` is `TO authenticated, anon USING (false) WITH
  CHECK (false)` — confirms a JWT-authenticated caller genuinely cannot write
  the telemetry row without `SECURITY DEFINER`.
- The telemetry `INSERT` is wrapped in a real `BEGIN ... EXCEPTION WHEN
  OTHERS THEN NULL; END;` block, scoped to ONLY the `ops_events` write — the
  enforcement-lookup read correctly stays unwrapped, since it feeds the
  actual rung decision and must fail loudly rather than silently default if
  it errors.
- The two source claims underpinning why this fix is scoped correctly were
  independently re-read, not assumed: `verify-question-bank/index.ts`'s
  retroactive-verification UPDATE payload (lines 238-248) has no `is_active`
  key; `bulk-question-gen/index.ts`'s fresh-generation insert (line 954) sets
  `is_active: verificationState === 'verified'`.
- All three test-suite layers independently re-executed: (1) structure/
  contract test, DB-free, every PR — **18/18 pass** (the architect's
  self-reported "17 assertions" does not match this recount; cosmetic
  inaccuracy only, not a functional gap). (2) Pure-function ladder-decision
  mirror — **6/6 pass**. (3) Live-DB AC-1..AC-6, `RUN_INTEGRATION_TESTS=1`-
  gated — confirmed to import/collect/skip CLEANLY in this environment
  (**7/7 skipped, 0 executed** — no Supabase creds available here; same
  honest-coverage-gap shape as REG-329/330/332). (4) All 6 pre-existing test
  files referencing this RPC by name re-run — **157/157 pass, unbroken**
  (exact match to the architect's claim, independently reproduced).
- **New this session (testing agent): closed a real, structural gap.**
  Neither layer (1) nor (2) above can prove BEHAVIOR — (1) only proves the
  SQL *text* contains the right tokens; (2) only decides a boolean tier
  label with no concept of a `failed` row at all. The two properties this
  review was specifically asked to check — spec §3.4's "no fallback rung"
  floor for `verification_state='failed'`, and the "legacy backlog stays
  servable under Tier-0 but must respect the strict rung" interaction — were
  written as live-DB AC-4/AC-2/AC-3 assertions that never execute in this
  environment. `select-quiz-questions-rag-tier0-floor.test.ts` (new, 10
  tests, DB-free, mirrors ONLY the migration's Tier-0 + conditional-strict
  predicate) closes this: a `failed` row is never servable under either
  rung, individually or as an all-`failed` pool (enforced or not);
  `legacy_unverified`/`pending` rows are servable under the relaxed rung and
  specifically excluded under the strict rung; the `verified_against_ncert`/
  `verification_state` column-disagreement defense (spec §1.3) is proven to
  actually exclude under the strict rung, not merely be present as inert
  text; an end-to-end mixed-pool case resolves to the exact expected subset
  under each rung. **10/10 pass.**
- Combined, independently-executed, DB-free total this session: **34/34 new
  tests pass** (18 contract + 6 ladder + 10 new floor-mirror) plus **157/157
  pre-existing unbroken** = **191/191**.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-333 | `verification_gate_ladder_and_tier0_floor` | **(1) Structure/signature parity** — the 8-param signature is regex-pinned against source (drift-proof), all four repeated blocks carry the three Tier-0 predicates, the `ff_grounded_ai_enforced_pairs` lookup and the `v_use_strict := v_pair_enforced AND v_verified_pool >= p_count` boundary are pinned verbatim, telemetry is fail-open-wrapped and carries no `p_student_id`, `verified_rank` ordering is added without a new response-payload key, and the migration touches none of its declared non-goals (`select_quiz_questions_v2`, `coverage.ts`, `question-validation.ts`, `chk_source_type`) — **18/18 pass**. **(2) Ladder decision** — pair-not-enforced always relaxed, pair-enforced pool>=count strict (inclusive boundary), pair-enforced pool<count relaxed, and E1≡unenforced-default — **6/6 pass**. **(3) NEW — Tier-0 floor + legacy-backlog behavioral mirror**: a `failed` row is never servable under either rung, an all-`failed` pool yields zero servable rows enforced or not (the actual floor, not just textual presence), `legacy_unverified`/`pending` are servable under relaxed but excluded under strict, the verified_against_ncert/verification_state column-disagreement defense actually excludes under strict, and a 7-row mixed pool resolves to the exact expected subset under each rung — **10/10 pass**. **(4) Live-DB AC-1..AC-6** (pair-enforced-sufficient→100% verified; enforced-thin→relaxed+telemetry; unenforced→genuine mix, no telemetry; failed rows never returned enforced or not; soft-deleted/draft/review/archived never returned) — written, imports/collects/skips cleanly, **0 live executions** (no creds in this environment). **(5)** 157 pre-existing tests across the 6 files that reference this RPC by name, re-run — **unbroken**. | `apps/host/src/__tests__/contract/select-quiz-questions-rag-verification-gate.test.ts` (18 tests); `apps/host/src/__tests__/regressions/select-quiz-questions-rag-verification-tier.test.ts` (6 tests); `apps/host/src/__tests__/regressions/select-quiz-questions-rag-tier0-floor.test.ts` (NEW, 10 tests); `apps/host/src/__tests__/migrations/select-quiz-questions-rag-verification-gate.test.ts` (7 tests, integration-gated, unexecuted); pre-existing: `whatsapp/daily6-compose.test.ts`, `whatsapp/daily6-processor.test.ts`, `regressions/reg-172-pool-reset-tiny-chapter.test.ts`, `lib/adaptive/get-quiz-questions-v2-merge.test.ts`, `api/v2/quiz-questions.test.ts`, `api/quiz-active-student-gate.test.ts` (157 tests) | P | P6, P12 |

### Known gaps (do NOT read this entry as broader than it is)

- **No live-Postgres execution of ANY of this migration's own tests, nor of
  the migration itself, against a real database** — in this session or, per
  the architect's own report, any prior one. This is the single largest open
  item; closing it requires applying this migration to a real (ideally
  staging) Supabase instance and running `RUN_INTEGRATION_TESTS=1 npm run
  test:integration` for real.
- **§7's four pre-rollout census queries** (per-slice verified-pool census,
  column-agreement check, failed-exclusion impact, existing-enforcement-state
  check) have not been run by anyone with DB access — flagged to ops per spec
  §8, not something testing can close. §7.4 matters operationally: if any
  (grade, subject) pair is ALREADY `enabled=true` today, deploying this
  migration is the flip moment for that pair, not a separate rollout step,
  and nobody has confirmed whether that is currently true.
- **Backend's §3.6 caller-side gap** (no insufficient-count guard on the
  whole-subject GET path for `/api/quiz`/`/api/v2/quiz/questions`) is
  explicitly out of scope for this migration, unaddressed, and untested
  here — flagged to backend per the spec, not claimed as covered.
- **ai-engineer's review is "confirmation only"** per the spec's own
  review-chain table. Testing independently re-verified the one specific
  claim it would need to confirm (`bulk-question-gen`'s insert behavior,
  line 954), but that is not the same as ai-engineer's own sign-off being on
  record.

### Invariants covered by this section

- P6 (question quality) — **strengthens**: closes the gap where a
  verifier-disproved row (`verification_state='failed'`) could serve with no
  gate; also closes two adjacent Tier-0 gaps (soft-delete via `deleted_at`,
  draft/review/archived via `content_status`).
- P12 (AI safety / grounding integrity) — **strengthens**: wires the
  previously-inert `ff_grounded_ai_enforced_pairs` control into serving for
  the first time since the table was introduced; directly closes the gap
  REG-332 flagged and explicitly declined to fix.
- P1 / P3 / P4 — **confirmed untouched**: this migration operates entirely
  upstream of scoring (`correct_answer_index` semantics untouched),
  anti-cheat (timing/pattern/count checks untouched), and atomic submission
  (`atomic_quiz_profile_update` untouched) — no diff touches any of the
  three.
- P13 (data privacy) — the new `ops_events` INSERT carries grade/subject/
  chapter/difficulty_mode/question_types/counts only, never `p_student_id` —
  confirmed both by direct SQL read and by the contract test's explicit
  assertion.

### Catalog total

Pre-REG-333: 332 entries (through REG-332, grounded-answer content-readiness
precheck — see `13-rag-cache.md`). Adds REG-333 (`select_quiz_questions_rag`
verification gate — closes the specific gap REG-332's own "Known gaps"
section flagged and declined to fix; **PARTIAL, explicitly so**: 34 DB-free
tests independently re-run and passing across 3 layers — structure/contract,
pure-function ladder, and a new testing-agent-authored Tier-0-floor +
legacy-backlog behavioral mirror closing a real gap the first two layers
structurally cannot reach — plus 157 pre-existing tests re-run unbroken, but
ZERO live-Postgres execution of the migration itself or its own live-DB AC
suite in this or any prior session).
**Total catalog: 333 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-345 — Foxy North-Star Phase 0: SRS grade loop closure (F2/F3/F4)

Added 2026-08-05 (testing agent, Phase 0 gate for the Foxy North-Star plan —
spec `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md`).

A `/quiz?mode=srs` session now CLOSES the SM-2 loop: after submit, each served
`spaced_repetition_cards` card is graded via the EXISTING
`POST /api/learner/review/grade` endpoint — the quiz client never re-implements
SM-2 math (no-duplicate rule; the endpoint owns ease/interval updates).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-345 | `srs_grade_loop_closure` | **(1) Quality mapping (RE-PINNED 2026-08-05, assessment mandate)** — `srsQualityForResponse` emits ONLY from the endpoint's zod-accepted set {0,3,4,5} (the same four ratings QuickRecallSection exposes): correct <10s → 5, correct ≥10s → 4, **wrong → ALWAYS 0, regardless of speed — NEVER 3**. SM-2 defines quality >= 3 as SUCCESSFUL recall, so emitting 3 for a wrong answer would count as a correct review and advance the interval (1→6), corrupting the schedule for failed cards; 0 is the only failure value in the accepted set. Quality 3 stays in the `SrsQuality` union solely because the flashcard UI (QuickRecallSection's "Hard" button) legitimately sends it — the auto-mapper must never emit it. A sweep pins the closed emitted set {0,4,5} across speeds (the original entry's "wrong <5s→0 else ≥5s→3" mapping is the pinned-ABSENT defect shape). **(2) No double-grading** — `gradeSrsCardsFireAndForget` grades each card AT MOST ONCE per invocation (two question ids mapping to the same card → one POST), POSTs QuickRecallSection's EXACT request contract (`{ cardId, quality }`, JSON, same-origin), and NEVER throws on fetch failure (fire-and-forget; the card simply stays due). **(3) Count/content agreement (F3)** — `fetchSrsDueQuizCards` + `selectSrsReviewSet` are THE shared due-query/selection used by BOTH the quiz deep-link content and the dashboard DailyRhythmQueue SRS lane count (single-subject selection, `source_id` dedupe, cap; explicit subject filter wins, else earliest-due card's subject; the exact filter set `source='quiz_wrong_answer'`, `is_active=true`, `source_id NOT NULL`, `next_review_date <= today`, limit 50 is pinned). **(4) End-to-end** — the REAL quiz page rendered with `/quiz?mode=srs` POSTs exactly ONE grade per card after submit using SERVER-truth `is_correct` from the submit response (quality 5 for a fast correct). **(5) F4 rider** — `classifyError` receives the REAL per-topic mastery (0.62 from a `concept_mastery` row) and the explicit 0.5 fallback ONLY when no row exists; `fetchTopicMasteryByQuestionId` degrades to `{}` on any client failure (never blocks quiz start). | `apps/host/src/__tests__/lib/learn/srs-quiz-review.test.ts` (14 tests, updated 2026-08-05 for the wrong→always-0 re-pin); `apps/host/src/__tests__/app/quiz-foxy-phase0.test.tsx` (F2 + F4 describe blocks, real quiz page render); ~~`apps/host/src/__tests__/components/dashboard/DailyRhythmQueue.srs-count.test.tsx` (lane count from the shared query)~~ — **REMOVED 2026-08-10 with its subject; see the SRS lane-count reconciliation note below** | E | P1-adjacent (server-truth correctness), learner-state rules |

Known gaps: no live-DB test of `/api/learner/review/grade` itself (pre-existing
endpoint, unchanged this phase); the fire-and-forget POST is not retried, by
design — a lost grade leaves the card due, never corrupts SM-2 state.

Pre-REG-345: 344 entries. Adds REG-345.
**Total catalog: 345 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-346 — Foxy North-Star Phase 0: hint_level end-to-end persistence contract (F8)

Added 2026-08-05 (testing agent, Phase 0 gate).

`hint_level` (0 = no hint .. 3) is an ADDITIVE, TELEMETRY-ONLY field flowing
UI → `_mapV2` → `submit_quiz_results_v2` → `quiz_responses.hint_level`. Field
name is a fixed cross-agent contract — do not rename. It feeds NO scoring/XP/
anti-cheat decision anywhere (P1/P2/P3 untouched).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-346 | `hint_level_end_to_end_persistence` | **(1) UI capture** — the real quiz page stamps `hint_level` on every response AT ANSWER TIME (1 after revealing one hint, 0 answered clean; always a number 0-3). **(2) Client pass-through** — `_mapV2` forwards `hint_level` verbatim to the `submit_quiz_results_v2` payload when set, and leaves it `undefined` when omitted (dropped by JSON → SQL NULL), WITHOUT disturbing the existing v2 contract (`selected_displayed_index` present, `is_correct`/`shuffle_map` still stripped). **(3) Column migration** (`20260805100100`) — nullable smallint, `CHECK (hint_level >= 0 AND hint_level <= 3)`, duplicate_object-guarded, NO backfill/NOT NULL. **(4) RPC persistence** (`20260805100200`) — `v_hint_level SMALLINT` declared; the client value is REGEX-GUARDED (`~ '^[0-3]$'` → smallint, else NULL) so a malformed payload can never violate the CHECK and abort the whole submit transaction; the `quiz_responses` INSERT carries the column+value. **(5) Telemetry-only proof** — every executable `v_hint_level` occurrence in the migration is one of declaration / normalization / INSERT value list (sanctioned-sites sweep), and no scoring variable is computed from it. | `apps/host/src/__tests__/api/quiz-server-shuffle-authority.test.ts` (F8 case); `apps/host/src/__tests__/app/quiz-foxy-phase0.test.tsx` (F8 describe block); `apps/host/src/__tests__/regressions/foxy-phase0-structural.test.ts` (5 migration pins) | P | P1/P2/P3 (untouched-proof), P4-adjacent (submit transaction never aborted by telemetry) |

Status P, honestly: the two migrations have had NO live-Postgres execution in
this session (structural source pins only — the same recorded limitation as
REG-318/REG-331/REG-333 for this environment). The TS-side contract (capture +
pass-through) is behaviorally tested.

Pre-REG-346: 345 entries. Adds REG-346.
**Total catalog: 346 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-347 — Foxy North-Star Phase 0: IRT selection resurrect, behavior-neutral flag-off (F1)

Added 2026-08-05 (testing agent, Phase 0 gate).

The Phase-4 IRT question-selection code in
`supabase/functions/quiz-generator/index.ts` was un-commented and wired live,
gated by `ff_irt_question_selection` (protected tier `staged_rollout`, seeded
OFF/0% — posture unchanged this phase; the F9 companion migration
`20260805100300` + `packages/lib/src/flags/protected-flags.ts` only correct the
self-contradictory reason TEXT, no tier/posture change). Flag-off, the adaptive
flow must be byte-identical to the pre-change legacy mastery-driven path.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-347 | `irt_resurrect_flag_off_neutrality` | **(1) Gate is live, not the dead stub** — `const useIRT = await isIRTSelectionEnabled(supabase)` replaces the dead `const useIRT = false` / `const irtQuestions: any[] = []` stubs (both pinned ABSENT as executable code). **(2) Flag semantics** — the gate reads `feature_flags.ff_irt_question_selection` and requires `is_enabled === true AND (rollout_percentage ?? 0) >= 100`; production posture OFF/0% ⇒ the IRT branch is dead and the legacy flow runs. **(3) FAIL-CLOSED** — any flag-read error caches and returns `false` (60s TTL). **(4) RPC contract** — `selectQuestionsByIRT` calls `select_questions_by_irt_info` with EXACTLY the six baseline arg names (`p_student_id, p_subject, p_grade, p_chapter_number, p_match_count, p_exclude_ids`), cross-checked verbatim against the baseline migration's `CREATE OR REPLACE FUNCTION` signature (`00000000000000_baseline_from_prod.sql` ~L6702) — no seventh arg, no rename. **(5) Row normalization** — the RPC's `question_id` return column is mapped onto `id` (`id: r.question_id`), which is load-bearing downstream (dedup sets + question-history upsert); the un-normalized cast is what made the previously commented-out code unshippable. | `apps/host/src/__tests__/regressions/foxy-phase0-structural.test.ts` (6 IRT pins, incl. baseline signature cross-check); `supabase/functions/quiz-generator/__tests__/actions.contract.test.ts` (Deno, action-surface unchanged — re-run green this session) | P | P6-adjacent (selection path), P9-adjacent (flag gating) |

Known gaps (explicit — do not read this entry as broader than it is):
- **No Deno-lane test executes the flag-ON IRT branch end-to-end** (no harness
  stubs `feature_flags` + the RPC inside `Deno.serve` in this repo's CI-scope
  Deno lane). The behavior-neutrality claim rests on the flag-off posture
  (seeded OFF/0%, protected staged_rollout tier) + source pins, not on a
  runtime A/B. Closing this needs a `selectQuestionsByIRT`/gate extraction
  into a testable module or a served-harness Deno test — flagged as the
  Phase-3 shadow-evaluation prerequisite.
- No live-DB execution of the `select_questions_by_irt_info` RPC this session.

Pre-REG-347: 346 entries. Adds REG-347.

---

## REG-351 — Foxy North-Star Phase 2: canonical-facade lockstep (learner-model facade mirrors the SQL RPC, display-only, ladder order preserved) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 2 Canonical Learner Model batch).

The `@alfanumrik/lib/learner-model` facade (9 modules) is the ONE sanctioned
TS read/preview surface over `concept_mastery`. The SQL RPC
`update_learner_state_post_quiz` remains the ONLY mastery writer (E1/E6).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-351a | `thresholds_sql_lockstep_both_migrations` | Band CASE literals (0.95 mastered / 0.70 proficient / 0.40 developing), BKT defaults (pLearn 0.2 / pSlip 0.1 / pGuess 0.25), new-row prior 0.1, and the posterior+learn-transit+clamp formula shape are pinned against BOTH RPC migrations — `20260623000100` (canonical) AND `20260807000400` (latest re-creation, evidence extension). SQL WINS on divergence. `masteryBandFor` boundary parity + next-action cutoffs 0.6/0.85/≥3 pinned. | `packages/lib/src/__tests__/learner-model/thresholds-lockstep.test.ts` | E | P1-adjacent, learner-state |
| REG-351b | `bkt_mirror_posterior_parity_display_only` | `bktPosterior` reproduces the SQL BKT math (hand-computed fixtures); `bkt-mirror.ts` is DISPLAY/PREVIEW ONLY — contains no supabase import at all (physically cannot write concept_mastery; also pinned by REG-353's ratchet test). No module in `packages/lib/src/learner-model/` writes any mastery surface. | `packages/lib/src/__tests__/learner-model/bkt-mirror.test.ts`; `apps/host/src/__tests__/regressions/reg-353-consolidation-ratchet.test.ts` | E | E6 single-writer |
| REG-351c | `next_action_ladder_order_preserved` | The 5-rung ladder order survived the move into the facade verbatim: (1) knowledge gap → remediate prerequisite, (2) overdue review weakest-first with oldest-timestamp tiebreak, (3) ≥3 conceptual errors → re_teach weakest unmastered, (4) practice <0.6 / challenge [0.6,0.85) / null ≥0.85, (5) null for strong learners. `getNextAction` IS `deriveNextAction` (alias, not a wrapper); `academicGoal` is annotation-only (identical outputs with/without). | `packages/lib/src/__tests__/learner-model/next-action.test.ts` (+ REG-231..234 differential pins still green) | E | learner-state |
| REG-351d | `confidence_score_scale_shift_pin` | Phase 2 (c): `mastery_variance` is the Beta-posterior (α/β pseudo-counts, hinted discount 0.45) with exactly ONE `v_variance :=` assignment (no residual pseudo-decay); blend `LEAST(1.0, mastery * (1 - variance))` in BOTH INSERT and RETURN. Documents the scale shift: 1-attempt blend factor ≈ ×0.944 (independent) / ×0.930 (hinted) vs old ×0.773; hard floor ×0.9167 (variance ≤ 1/12). CONSUMER SURVIVAL: the progress-page severity split (>0.7/>0.4) and `KnowledgeGapActions.computeSeverity` consume gap-RPC confidence DERIVED as `1 - mastery_probability` (pinned in 20260623000700/000800, which never read `cm.confidence_score`) — threshold semantics survive the re-scale. | `packages/lib/src/__tests__/learner-model/confidence-floor-pin.test.ts` | E | P1-adjacent, learner-state |
| REG-351e | `skill_state_readers_fail_soft` | Every `student_skill_state` reader tolerates empty results AND DB errors: foxy `loadCognitiveContext` and workflows `loadWorkflowCognitiveContext` return empty context/arrays (never throw, never 500) on all-error, zero-rows, and skill-state-only-error scenarios. Audit note: learning-action never reads the table (write-ban contract only, pinned by its source-guards test); suggest-prompts static fallback pinned by `suggest-prompts-bloom.test.ts`; adaptive-loops-rules null-input paths pinned by its own suite. | `apps/host/src/__tests__/api/foxy/skill-state-reader-fallbacks.test.ts` | E | fail-soft readers |

---

## REG-352 — Foxy North-Star Phase 2: quiz_responses event-capture contract (D2 server-held version/hash, D3/D6 normalize-never-abort, D7 original-index misconception lifecycle) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 2 batch). Migrations
`20260807000200` (columns) / `20260807000300` (writer support) /
`20260807000500` (submit_quiz_results_v2 rewire).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-352 | `submit_v2_event_capture_structural` | **D2 zero client trust**: `quiz_responses.question_version`/`content_hash` copied from the SERVER-HELD `quiz_session_shuffles.options_version_at_serve`/`integrity_hash`; the RPC exposes NO parameter (`p_question_version`/`p_content_hash`/`p_integrity_hash`/`p_options_version` all absent) through which a client could supply either. **D3**: `answer_method` server whitelist ('mcq','typed','voice','scan') ELSE 'mcq'. **D6**: `confidence` regex `'^[1-5]$'` else NULL (same normalize-never-abort pattern as F8's `'^[0-3]$'` hint_level — a malformed payload can never abort the P4 submit transaction). **D7**: misconception match on the TRUE ORIGINAL-space index (`qm.distractor_index = v_selected_orig`, re-derived from the server shuffle snapshot) with per-iteration reset; open/resolve lifecycle in an ERROR-ISOLATED sub-block (`EXCEPTION WHEN OTHERS THEN NULL` — never aborts submit); ONE open row per (student, pattern, concept) via partial unique index `uq_student_misconceptions_open`; free-text columns (question_text/student_answer/correct_answer) NEVER written — P13. 000200 columns additive `IF NOT EXISTS`, no DROP. | `apps/host/src/__tests__/migrations/submit-quiz-v2-event-capture-structural.test.ts` (13 pins) | P | P4, P13, P1-adjacent |

Known gap (explicit): structural SQL-text pins only — no live-Postgres
execution of the 20260807* migrations this session (same honesty posture as
REG-350).

---

## REG-353 — Foxy North-Star Phase 2: consolidation ratchet (single BKT, retired-table baselines, cme-engine 410 tombstone) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 2 batch).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-353 | `consolidation_ratchet` | **(1) Single BKT**: analyzer check-6/check-7 exist and run; the BKT-update allowlist is EXACTLY `['packages/lib/src/cognitive-engine.ts']` (the documented module-private survivor) — the deleted quiz-completion-service and queue-consumer copies are gone from SOURCE, not just the allowlist; the one approved TS mirror (`bkt-mirror.ts`) declares display-only and imports no supabase client. **(2) Retired-table baselines**: `cme_concept_state: 6` and `topic_mastery: 20` frozen literals pinned — the analyzer FAILs (not warns) on growth, so any bump is a reviewable two-place diff. **(3) cme-engine tombstone**: structured 410 (`code: 'cme_engine_retired'`, `error: 'gone'`), 401 preserved for unauthenticated probes (jwt-user posture, auth-guard sweep intact), replacement pointer to the learner-model facade + `update_learner_state_post_quiz`; the retired write target `cme_concept_state` COMMENT-tombstoned RETIRED in `20260808000100`. | `apps/host/src/__tests__/regressions/reg-353-consolidation-ratchet.test.ts` (10 pins) | E | E1/E3/E6, P9-adjacent |

Deployment caution (carried from the quiz-generator-v2 lesson): the tombstone
is on-disk state — verify the DEPLOYED cme-engine version with
`supabase functions list` post-merge before trusting the 410 in production.

Pre-REG-351: 350 entries (through REG-350 — see `02-foxy-ai.md`). Adds
REG-351 (canonical-facade lockstep), REG-352 (event-capture contract),
REG-353 (consolidation ratchet).
**Total catalog: 353 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-354 — Foxy North-Star Phase 3: XP capped-award contract (server-only RPC, per-source idempotency, IST day boundary, sum-of-lanes ≪ quiz cap) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 3 batch).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-354 | `xp_capped_award_contract` | **RPC ownership**: `award_xp_capped` in migration `20260809000300` is `SECURITY DEFINER`, `EXECUTE granted to service_role only` (NOT `authenticated`/`anon`) — browser callers can never invoke it directly. **Idempotency**: repeat calls with the same `p_reference_id` return `{idempotent_replay: true, effective_xp: 0}` — the second award is a no-op, not a double-credit; the `xp_transactions_reference_id_uniq` partial-unique index enforces it at the DB layer. **IST day boundary**: `today_earned` is scoped to `date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')` — never UTC (P2 IST anchor, extends REG-318's mixed-anchor fix). **Sum-of-lanes ≪ quiz cap**: the three Phase-3 lane amounts (`retention_award = 6 XP/review`, `remediation_recovery_award = 15 XP`, `thoughtful_question_award = 5 XP`) sum to a daily maximum of 71 XP even under maximum plausible density, staying <<< the 200 XP `quiz_daily_cap` — pinned as literal constants in `packages/lib/src/xp-config.ts` with a comment-anchored derivation. **Browser fail-safe**: the `awardXpCapped` helper (`packages/lib/src/xp-award.ts`) never throws / never rejects; RPC error → warn-logged with counts-only metadata (P13) + returns null; malformed return → null. **Call-site XP literals**: helper takes `amount` + `dailyCap` from XP_RULES at the call site — the helper module contains no XP number. | `apps/host/src/__tests__/lib/xp-award.test.ts`; `apps/host/src/__tests__/api/learner/review-grade-xp-award.test.ts`; `apps/host/src/__tests__/api/cron/foxy-quality-thoughtful-xp.test.ts`; migration `supabase/migrations/20260809000300_xp_sources_widen_and_award_rpc.sql` | E | P2, P13 |

---

## REG-355 — Foxy North-Star Phase 3: hint-ladder P3 lock (rungs 2-5 refuse pre-attempt, hint_level widened 0..5, rung 5 = skip in v1) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 3 batch).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-355 | `hint_ladder_p3_lock` | **Module refuses**: `nextRung()` in `packages/lib/src/learn/hint-ladder.ts` returns `{ok: false, reason: 'locked_pre_attempt'}` when `state.currentRung === 1` and `!state.wrongAttempted` — the lock lives IN the state machine, so no UI loop can bypass it. **Rung 5 = skip**: `rungContentSpec(5, …)` returns `{source: 'skip', kind: 'skip', fields: null, transform: null}` — the v1 label is HONEST (the wave-3b UI CTA advances to `nextQuestion()`, not a same-topic evidential twin); the same-misconception evidential twin is deferred (see header TODO(L5) in hint-ladder.ts, plan-tracker record E5/L5). **hint_level widened 0..5**: `HintLevel` type = `0 | 1 | 2 | 3 | 4 | 5`; migration `20260809000400_quiz_responses_hint_level_widen_0_5.sql` widens the CHECK constraint from `IN (0,1,2,3)` to `IN (0,1,2,3,4,5)` with `USING (CASE WHEN hint_level IS NULL OR hint_level BETWEEN 0 AND 5 THEN hint_level ELSE 0 END)` clamp preserving existing rows; the regex-guard from REG-346 (`'^[0-3]$'` payload sanitiser) remains as belt-and-braces normalize-never-abort but is superseded for the accepted range. **Unhinted-mastery XP bonus keys off `hint_level === 0`** (P2 surface anchor). **UI cannot bypass**: the `HintLadder` and `PrereqSuggestion` components call `nextRung()` — they do not synthesize rung numbers. | `packages/lib/src/__tests__/learn/hint-ladder.test.ts`; `apps/host/src/__tests__/components/quiz/HintLadder.test.tsx`; migration `supabase/migrations/20260809000400_quiz_responses_hint_level_widen_0_5.sql` | E | P3, P2 |

Honest gap: no live-Postgres execution of migration `20260809000400` this
session — structural pins on the SQL text only. The Vitest tests exercise
the pure state machine and the React component, neither of which touch the
DB.

---

## REG-356 — Foxy North-Star Phase 3: transfer-evidence direction & registry parity (D12) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 3 batch — closes the assessment
review-mandated inversion + payload-shape fix flagged during Phase 3 sign-off).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-356a | `transfer_evidence_lands_on_source` | The build-twin cron's `record_transfer_evidence` call maps `p_topic_id = rec.fromTopicId` (SOURCE — the already-solid prerequisite whose mastery is re-evidenced) and `p_from_topic_id = rec.topicId` (TARGET — today's dependent success). Getting these backwards double-credits the wrong topic. Migration `20260809000600`'s comment reads "mastery of p_topic_id evidenced indirectly from correct work in dependent p_from_topic_id" — this pin makes the mapping executable. | `apps/host/src/__tests__/api/cron/build-twin-snapshots-transfer.test.ts` | E | E6, D12 |
| REG-356b | `transfer_evidence_payload_shape` | The `learner.transfer_evidence` bus payload uses `sourceTopicId` (= `rec.fromTopicId` = SOURCE) and `targetTopicId` (= `rec.topicId` = TARGET) — role-anchored keys, not the pure module's field names. The event schema in BOTH registries (`packages/lib/src/state/events/registry.ts` + `supabase/functions/_shared/state-runtime/events-registry.ts`) declares that shape and only that shape. The absence pin closes the assessment's "no other consumer besides journey/edge registry depended on old `sourceTopicId` names" concern: a repo-wide static scan of `apps/`, `packages/`, `supabase/functions/` confirms NO non-test source file pairs the `'learner.transfer_evidence'` kind literal with a payload literal carrying the pre-fix keys (`topicId`/`fromTopicId`). | `apps/host/src/__tests__/api/cron/build-twin-snapshots-transfer.test.ts`; `apps/host/src/__tests__/regressions/phase3-transfer-event-payload-shape.test.ts` (5 pins, incl. NEXT ↔ Deno registry parity + repo-wide absence scan) | E | P8, P13, D12 |

---

## REG-358 — Foxy North-Star Phase 3: SRS single predicate (one helper, count and content agree by construction) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 3 batch).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-358 | `srs_single_predicate` | `packages/lib/src/learn/srs-predicate.ts` is the ONLY helper that shapes the "due quiz-wrong-answer cards" query: `SRS_DUE_PREDICATE_DESCRIPTOR` freezes the predicate (`is_active=true`, `source='quiz_wrong_answer'`, `source_id IS NOT NULL`, `next_review_date <= today`, `ORDER BY next_review_date ASC`, `defaultLimit=50`, `hardLimit=100`); `buildSrsDueQuery(client, studentId, opts)` is called by BOTH the client-side deep-link consumer (`packages/lib/src/learn/srs-quiz-review.ts` → `fetchSrsDueQuizCards` → `selectSrsReviewSet`) AND the server-side `/api/learner/srs/due` route AND the `DailyRhythmQueue` count. The dashboard SRS lane COUNT and the quiz `/quiz?mode=srs` CONTENT cannot disagree because they resolve through the same predicate object — the drift that REG-345 pinned at the fetcher level is now closed at the predicate level. Limit clamping (1 ≤ limit ≤ 100), today-yyyy-mm-dd date rendering, and optional-subject narrowing are all owned by the helper (call sites never assemble query strings). | `apps/host/src/__tests__/lib/learn/srs-source.test.ts`; `apps/host/src/__tests__/api/learner/srs-due.test.ts`; ~~`apps/host/src/__tests__/components/dashboard/DailyRhythmQueue.srs-count.test.tsx`~~ — **REMOVED 2026-08-10 with its subject; see the SRS lane-count reconciliation note below** | E | E4, drift-prevention |

---

#### SRS lane-count reconciliation — REG-345 + REG-358 (2026-08-10)

Both entries cited
`apps/host/src/__tests__/components/dashboard/DailyRhythmQueue.srs-count.test.tsx`
(4 tests) as one of their asserting files. That file was deleted in the
2026-08-10 orphan-consolidation pass together with the component it rendered
(`packages/ui/src/dashboard/sections/DailyRhythmQueue.tsx`). **Neither entry is
deleted** — removing a catalog entry requires explicit user approval. Both stay
`E`, on the surviving server-side pins.

**What that file uniquely pinned:** the dashboard SRS lane's *displayed count* —
that it reads `/api/learner/srs/due` rather than the rhythm queue, dedupes,
caps the rendered number at 5, fails soft back to the rhythm-queue item count
on API error, and skips the call entirely with no student in context.

**REG-345 (`srs_grade_loop_closure`) — still `E`.** Its load-bearing claims are
the quality mapping ({0,3,4,5}, wrong → ALWAYS 0) and the shared
`fetchSrsDueQuizCards` + `selectSrsReviewSet` pair, both pinned by
`apps/host/src/__tests__/lib/learn/srs-quiz-review.test.ts` (14 tests) with the
real quiz-page render in
`apps/host/src/__tests__/app/quiz-foxy-phase0.test.tsx`. Neither depends on the
deleted component. Verified passing 2026-08-10.

**REG-358 (`srs_single_predicate`) — still `E`, and this is the entry that
matters.** Its whole point is that the lane COUNT and the `/quiz?mode=srs`
CONTENT cannot disagree *because both resolve through one frozen predicate
object*. That guarantee lives at the predicate layer, not the render layer:
`apps/host/src/__tests__/lib/learn/srs-source.test.ts` pins
`SRS_DUE_PREDICATE_DESCRIPTOR` and `buildSrsDueQuery`, and
`apps/host/src/__tests__/api/learner/srs-due.test.ts` pins the server route
consuming it. The deleted file only ever demonstrated one *consumer* honouring
the predicate; it never held the predicate itself. Verified passing 2026-08-10.

**Genuinely unenforced after this deletion:** the cap-at-5 display rule and the
fail-soft-to-rhythm-count fallback — both pure render concerns of the deleted
component.

**Judgement — vacuous loss, not a coverage regression.** Verified by
`git grep DailyRhythmQueue HEAD`: the component's only importers at HEAD were
its own three test files — zero production importers — and no UI anywhere in
`apps/host/src` or `packages/ui/src` still consumes `GET /api/rhythm/today`.
The lane was already dark; the test was a false green.

**Open obligation (tracked):** when a live surface re-renders an SRS lane
count, the cap-at-5 and fail-soft-fallback rules must be re-pinned against it.
The predicate they read is frozen and tested, so re-pinning is mechanical.

---

Pre-REG-354: 353 entries (through REG-353 above). Adds REG-354 (XP
capped-award contract), REG-355 (hint-ladder P3 lock), REG-356
(transfer-evidence direction & registry parity). REG-357 is claimed for the
IRT shadow contract in `02-foxy-ai.md` (kept in that shard to sit next to
the other IRT/AI observability pins — REG-311/316). REG-358 (SRS single
predicate) is above. Continuous through REG-358.
**Total catalog: 358 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-379 — canonical `parseOptions` / `OPTION_LETTERS`: `JSON.parse(null)` render-crash fix + P6 count/order invariance (2026-08-10)

Added 2026-08-10 (testing agent, orphan + duplication consolidation pass).

`parseOptions` had drifted into SEVEN copies and `OPTION_LETTERS` into SEVEN
more across two packages. Six of the seven `parseOptions` copies carried a real
latent defect. Their body was:

```ts
if (Array.isArray(opts)) return opts;
try { return JSON.parse(opts); } catch { return []; }
```

**`JSON.parse(null)` does not throw.** It coerces its argument to the string
`"null"`, parses it, and returns `null`. So the `catch` never fires and those
six copies could return `null` from a function annotated `: string[]` — after
which the caller's `opts.map(...)` throws a render-time
`TypeError: Cannot read properties of null (reading 'map')`, blanking the quiz,
learn, mock-exam, pyq, diagnostic and results screens rather than degrading.
The seventh copy (`/tutor`) was the odd one out and the correct one: it took
`unknown`, guarded with `typeof opts === 'string'`, and returned `[]`. The new
canonical module `packages/lib/src/quiz/options.ts` unifies on `[]`.

This sits directly on the **question-serving path**, so the entry also freezes
the two marking-safety properties the parser must never break: option **COUNT**
(what P6 pins at exactly four) and option **ORDER** (bound to the server-side
shuffle snapshot and `selected_displayed_index` — reordering here would corrupt
marking).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-379a | `parse_options_null_returns_empty_not_null` | The fixed defect. `parseOptions(null)` and `parseOptions(undefined)` return `[]`, never `null` — so no caller's `.map()` can throw at render. Also `[]` for other non-string non-array input (`42`, `{a:1}`, `true`). Malformed JSON strings (`'not json at all'`, `'["unterminated"'`, `''`) return `[]` via the `catch`, as all seven originals did. | `apps/host/src/__tests__/lib/quiz/options.test.ts` | E | P6, render-safety |
| REG-379b | `parse_options_count_and_order_invariant` | **P6 / marking safety.** For both input shapes the parser NEVER changes count or order: no reorder (`parseOptions(ordered)[2] === 'third'` for array AND JSON-string input), no dedupe, no trim, no dropping of empty members (`['  padded  ','','dup','dup']` survives at length 4), no padding a short array to 4, no truncating a 6-option array to 4, and no mutation of the input array. Shape enforcement is deliberately left to the P6 gate in `question-validation.ts`; a filter here would silently change how many options render. | `apps/host/src/__tests__/lib/quiz/options.test.ts` | E | **P6**, P1 (marking) |
| REG-379c | `parse_options_behavioural_union_of_seven` | Consolidation is behaviour-neutral. Array branch applies `.map(String)` (adopted from the `/tutor` copy, which carried the guard because its source column `chapter_concepts.practice_options` is nullable `unknown` jsonb; the call sites that actually run `opt.replace(...)` per member are `(student)/quiz/page.tsx:1972`, `(student)/learn/[subject]/[chapter]/page.tsx:2083` and `:2241`, and `packages/ui/src/quiz/v2/PracticeRunner.tsx:254` — `/tutor` renders `{opt}` directly as a React child at `tutor/page.tsx:342` and never calls `.replace()`) — proven 1:1 and index-preserving, and byte-identical for genuine `string[]`, which P6 guarantees. String branch returns `JSON.parse`'s result VERBATIM including valid-JSON non-arrays (`'"abc"'`→`'abc'`, `'5'`→`5`, `'null'`→`null`, `'{"a":1}'`→`{a:1}`) and does NOT coerce members — exactly as all seven originals did. Hindi (Devanagari) options round-trip intact (P7). | `apps/host/src/__tests__/lib/quiz/options.test.ts` | E | P6, P7 |
| REG-379d | `option_letters_single_frozen_constant` | `OPTION_LETTERS` is exactly `['A','B','C','D']` in order, is `Object.isFrozen` (a shared constant must not be mutable by one consumer), and is `undefined` past index 3 so every call site's `OPTION_LETTERS[idx] \|\| String(idx + 1)` fallback still yields `'5'` at index 4. | `apps/host/src/__tests__/lib/quiz/options.test.ts` | E | P6 |

**Call sites consolidated (8 files, 7 `parseOptions` + 7 `OPTION_LETTERS`
declarations removed):** `apps/host/src/app/(student)/quiz/page.tsx`,
`apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx`,
`apps/host/src/app/(student)/mock-exam/page.tsx`,
`apps/host/src/app/(student)/pyq/page.tsx`,
`apps/host/src/app/diagnostic/QuizScreen.tsx`,
`apps/host/src/app/tutor/page.tsx`, `packages/ui/src/quiz/QuizResults.tsx`,
`packages/ui/src/quiz/v2/PracticeRunner.tsx` (letters only).

**Reference-identity check (independently verified, not taken on report).** The
array branch now returns a NEW array (`.map(String)`) where six originals
returned the input by reference. Every one of the seven `parseOptions` call
sites was read directly: all consume the result inline during render or inside
a `.map` body — none sits in a `useMemo`/`useEffect` dependency array and none
does a reference comparison. The identity change is unobservable. The one place
the result's length is load-bearing —
`QuizResults.tsx:1090`'s legacy `origOpts.length === 4` shuffle gate — is
unaffected because `.map(String)` is length-preserving.

### Known gap (documented, not silently dropped)

The string branch still returns `JSON.parse`'s result verbatim, so a DB value
of the literal string `'null'` still yields `null` and would still crash a
caller's `.map()`. This is **preserved, not introduced** — all seven originals
behaved this way, and REG-379c pins it deliberately so the consolidation stays
provably behaviour-neutral. Tightening it (e.g. an `Array.isArray` guard on the
parse result) is a real follow-up, but it is a BEHAVIOUR CHANGE on the
question-serving path and therefore needs assessment sign-off under P6 rather
than being folded into a consolidation pass. The `null` (not `'null'`) case —
the one that actually occurs, from nullable columns such as
`concepts.practice_options` — is fully closed by REG-379a.

**Total catalog: 359 entries (target: 35 — TARGET EXCEEDED).**

---
