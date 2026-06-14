# RAG Retrieval-Quality Eval Harness (B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **offline, read-only** measurement backbone for Alfanumrik's live NCERT retrieval path (the TypeScript `retrieve()` contract + the `match_rag_chunks_ncert` RRF RPC). It scores a versioned golden query set with human/LLM-validated relevance labels, emits rank-based metrics (recall@k, nDCG@k, MRR, hit-rate@k, multi_hop full-coverage@k) + a groundedness-rate, and produces a deterministic `PASS | REGRESS | INCONCLUSIVE` verdict vs a committed baseline. This GATES sub-project B2 tuning the way A's eval harness gated the MOL cutover. **B1 changes ZERO production behavior** — it only READS retrieval and the already-P13-scrubbed trace tables, and WRITES only its own on-disk report artifacts.

**Spec:** `docs/superpowers/specs/2026-06-13-rag-retrieval-quality-design.md` (revised 2026-06-13 to incorporate assessment A1-A7 + architect B1-B6 + Q1/Q2/Q3/Q5). This plan implements that spec verbatim.

**Relationship to the existing `eval/rag/` harness:** the repo already has an `eval/rag/` harness (`runner.ts`, `scoring.ts`, `fixtures/`) that measures the **grounded-answer Edge Function END-TO-END** (HTTP POST, checks citations/scope/abstain). Its README explicitly flags "Known gap 1: No rerank-quality eval — we do not check whether Voyage rerank actually surfaces the most relevant chunk." **B1 is the harness that closes that gap**: it measures the `retrieve()` RETRIEVAL path directly with rank-based relevance metrics. B1 lives under NEW subdirs (`eval/rag/harness/`, `eval/rag/golden/`, `eval/rag/baseline/`) and touches NONE of the existing files. The two are complementary and coexist.

**Tech Stack:** TypeScript, Vitest (pure-fn lane + the existing `RUN_INTEGRATION_TESTS=1` live-DB lane), the live `retrieve()` + `match_rag_chunks_ncert` RRF RPC (read-only), Voyage `voyage-3` embeddings + `voyage-rerank-2` (measured as-is), an offline Sonnet relevance judge (golden-set build time only), `redactPIIInText()` for PII scrub.

---

## File Structure

| File | Create / Modify | Single responsibility |
|---|---|---|
| `eval/rag/harness/golden-schema.ts` | Create | TS types for the golden fixture + a pure runtime validator (P5 grade-string, query_type enum, relevance ∈ {0,1,2}, optional `off_grade_scope`, subject allowlist incl. `social_studies` (A6), UUID check, no-PII-key check). |
| `eval/rag/harness/metrics.ts` | Create | Pure metric functions: `recallAtK`, `ndcgAtK` (2^rel−1 gain), `mrr`, `hitRateAtK`, `multiHopCoverageAtK` (A5). Zero IO. |
| `eval/rag/harness/relevance-judge.ts` | Create | Offline Sonnet retrieval-relevance judge (machinery patterned on `quality-eval.ts`); emits `{ relevance, off_grade_scope, reason }` (A2). Golden-set build time only — never on metric runs. |
| `eval/rag/harness/trace-mining.ts` | Create | Trace-mining tool: SELECT built from the A1 non-PII column allowlist (never `SELECT *`); `redactPIIInText` + `query_sha256`-default (B3). |
| `eval/rag/harness/scrub.ts` | Create | Second-pass PII scrub wrapper over `redactPIIInText()` (`_shared/redact-pii.ts`) for any trace-mined text (§7). |
| `eval/rag/harness/telemetry-baseline.ts` | Create | Read-only `retrieval_traces` / `grounded_ai_traces` rollups (§B1.6), sliced grade × subject, A1 projection, RRF-scale labels. |
| `eval/rag/harness/baseline.ts` | Create | Baseline load + per-metric-band verdict logic (A7): nDCG@10 2% rel, recall@10 2% rel, MRR 3% rel, hit-rate@10 2pp abs, groundedness 3pp abs. Emits `PASS \| REGRESS \| INCONCLUSIVE`. |
| `eval/rag/harness/run-eval.ts` | Create | Orchestrator: load golden fixture → construct least-privilege/service-role client (`makeServiceSupabase`) → call real `retrieve()` per item → score → A4 per-cell breakdown → compare to baseline → write report artifact + verdict. |
| `eval/rag/golden/ncert-golden-v1.json` | Create | The ~28-32-item assessment-authored golden set (versioned, schema-valid, PII-clean). |
| `eval/rag/baseline/ncert-baseline-v1.json` | Create | The metric baseline + per-metric bands (assessment-reviewed, never auto-refreshed). |
| `src/__tests__/eval/rag/metrics.test.ts` | Create | Pure-fn unit tests for every metric vs hand-computed fixtures (normal lane). RED-first. |
| `src/__tests__/eval/rag/golden-schema.test.ts` | Create | Fixture conforms to schema; subject allowlist incl. `social_studies`; P5 grade strings; UUID; no PII keys (normal lane). |
| `src/__tests__/eval/rag/relevance-judge.test.ts` | Create | Judge parse/clamp/`off_grade_scope` with a mocked LLM (normal lane). RED-first. |
| `src/__tests__/eval/rag/trace-mining.test.ts` | Create | SELECT projection contains NONE of the forbidden identifier columns (A1); `redactPIIInText` + sha256-default applied (B3) (normal lane). RED-first. |
| `src/__tests__/eval/rag/import-boundary.test.ts` | Create | Fails if any `src/app/**` file imports an `eval/rag/harness/**` module (B6) (normal lane). |
| `src/__tests__/eval/rag/run-eval.integration.test.ts` | Create | Live-DB harness entry. Runs golden set through real `retrieve()`; emits verdict + per-cell report (integration lane). |
| `vitest.config.ts` | Modify (lines 11-14, 23-24) | Add `src/__tests__/eval/**` to `INTEGRATION_TEST_PATTERNS` (B1). **Architect-reviewed.** |
| `.github/workflows/ci.yml` | Modify (lines 372-375) | Add `VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}` to the `integration-tests` job env block (B2). **Architect-reviewed.** |
| `package.json` | Modify (scripts) | Wire `eval:rag:retrieval` (or reuse the `eval:rag` slot) → `npx tsx eval/rag/harness/run-eval.ts`. |
| `.claude/regression-catalog.md` | Modify (append) | REG-140 entry (next-free; current max is REG-139). |
| `eval/rag/README.md` | Modify (append) | Document the new retrieval-path harness alongside the existing end-to-end one; cross-reference "Known gap 1". |

> **No migration. B1 touches ZERO schema.** (Future-phase note: WRITING eval traces would need `grounded_ai_traces.caller`'s CHECK widened to include `rag-eval-harness` — explicitly deferred to B5.)

> **No production-path file is edited.** `retrieve.ts`, `mmr.ts`, `match_rag_chunks_ncert`, `grounded-answer/*`, `ncert-retriever.ts` are all READ/IMPORTED only.

---

## Prerequisites / Dependencies

These are operational prerequisites surfaced by the architect review. **None blocks B1 from shipping or measuring** — they only gate *full-path CI enforcement* (which B2 consumes). They are tracked here so the orchestrator/ops can clear them in parallel.

1. **`VOYAGE_API_KEY` GitHub secret (B2 — ops/architect).** The harness runs full-path when `VOYAGE_API_KEY` is present and emits `INCONCLUSIVE` when absent. Task 8 adds the env wiring in `ci.yml`; the *secret provisioning itself* is an ops/architect prerequisite. Until provisioned, CI integration runs degrade to `INCONCLUSIVE` (FTS-only) and stay green — B1 ships regardless. **Not a code blocker.**
2. **Corpus parity (Q1 — assessment + architect/ops).** The golden set MUST be authored against the same DB CI reads (the `STAGING_SUPABASE_*` live-DB project), OR staging must be verified as a same-source `ncert_2025` clone of prod, so every `relevant_chunk_id` UUID resolves to a live `rag_content_chunks.id`. Verified at Task 9 (seeding) via the corpus-ref resolve check; a mismatch fails the integration run loudly (not silently). **Blocks Task 9 completion, not Tasks 1-8.**
3. **Seat-enforcement red gate (B5 — ops/architect).** The integration lane is currently RED on `main` due to the unrelated `seat-enforcement.test.ts`. **B1's verdict lands in its OWN report artifact, so B1 measurement is unaffected.** **B2's** tuning gate must read THAT artifact, not the umbrella `integration-tests` job exit code, until seat-enforcement is fixed/quarantined. **This is a B2 prerequisite, NOT a B1 blocker** — flagged here so it is not forgotten when B2 starts.

---

## Phase 1 — Golden-set fixture schema + schema-validation test (pure)

The contract everything else hangs off. Pure TS, no DB, no LLM.

### Task 1 — Golden-set schema + runtime validator + schema test

**Files:**
- Create: `eval/rag/harness/golden-schema.ts`
- Create: `src/__tests__/eval/rag/golden-schema.test.ts`
- (the golden JSON itself is seeded in Task 9; this task validates a tiny inline fixture)

**Goal:** Define the versioned fixture TS types and a pure runtime validator that enforces every shape rule from spec §B1.3: P5 grade-string `"6"`..`"12"`; `query_type ∈ {factual, conceptual, definition, multi_hop}`; per-chunk `relevance ∈ {0,1,2}`; optional `off_grade_scope: boolean` (A2); the canonical snake_case subject allowlist `{ math, science, social_studies, english, physics, chemistry, biology, history, geography, civics, economics }` (A6 — `social_studies` NOT "social science"); every `relevant_chunk_id` a valid UUID; the document contains NO PII-shaped key (`student_id`/`user_id`/`session_id`/`email`/`phone`) anywhere (recursively).

**RED first:** write `golden-schema.test.ts` asserting the validator (a) accepts a valid inline fixture, (b) rejects a `subject: "social science"` item (must be `social_studies`), (c) rejects an integer grade `8`, (d) rejects `relevance: 3`, (e) rejects a fixture containing a `student_id` key anywhere, (f) accepts `off_grade_scope` present or absent. Run → FAIL (module missing). Implement `golden-schema.ts` minimally → PASS.

**DoD:**
- `validateGoldenSet(doc)` returns a typed result (`{ ok: true, value } | { ok: false, errors: string[] }`); every spec §B1.3 rule enforced.
- The PII-key recursion catches a forbidden key at ANY nesting depth.
- Subject allowlist pins `social_studies` and REJECTS "social science"/"social_science".
- `npx vitest run src/__tests__/eval/rag/golden-schema.test.ts` passes; lint + type-check clean.

**Reviewers:** assessment (subject allowlist + query_type taxonomy + relevance scale + `off_grade_scope` are curriculum/correctness artifacts), testing (the validator test is the schema gate).

**Risk:** Low. Pure function, no IO, no production path.

---

## Phase 2 — Pure metrics module

### Task 2 — Metric pure functions + unit tests (RED first)

**Files:**
- Create: `eval/rag/harness/metrics.ts`
- Create: `src/__tests__/eval/rag/metrics.test.ts`

**Goal:** Implement the spec §3 metrics as pure functions over `(rankedChunkIds: string[], golden: { chunk_id: string; relevance: 0|1|2 }[], k: number)`:
- `recallAtK` (§3.1) — `|{ c ∈ R[0:k] : rel(c) ≥ 1 }| / |G|`; exclude+flag items where `|G| = 0`.
- `ndcgAtK` (§3.2) — `DCG@k / IDCG@k` with **graded gain `2^rel − 1`** and `log2(i+1)` discount; ideal ordering = golden sorted by `rel` desc.
- `mrr` (§3.3) — `1 / rank_of_first_relevant`; 0 if none in `R[0:maxK]`.
- `hitRateAtK` (§3.4) — fraction of items with ≥1 relevant chunk in `R[0:k]`.
- `multiHopCoverageAtK` (§3.6, A5) — over multi_hop items, fraction where the full required-primary set `P = { c : rel(c) == 2 }` ⊆ `R[0:k]`; exclude+flag multi_hop items with empty `P`.
- An `aggregate()` helper that produces overall + per-(grade-band × subject) cells (A4), with per-cell item counts.

**RED first:** write `metrics.test.ts` with **hand-computed** expected values (the spec's exact formulas) for a handful of fixtures: a perfect ranking, a partial ranking, an all-miss ranking, a graded-relevance nDCG case where `2^rel−1` differs visibly from binary gain, an MRR case where the first relevant is at rank 3, a multi_hop case where one of two required-primary chunks is missing (coverage = 0) and one where both are present (coverage = 1), and an A4 two-cell aggregate. Run → FAIL. Implement → PASS.

**DoD:**
- Every metric matches its hand-computed value to full precision; nDCG uses `2^rel−1` gain (NOT binary).
- `|G|=0` recall items and empty-`P` multi_hop items are excluded AND flagged in the returned shape (never silently counted as 1.0 or 0.0).
- All functions are pure (no IO, no Date, no randomness) — scale-independent of the RRF score.
- A4 aggregate returns per-cell + overall with item counts.
- `npx vitest run src/__tests__/eval/rag/metrics.test.ts` passes; type-check clean.

**Reviewers:** assessment (metric definitions are the correctness contract — nDCG gain, multi_hop coverage strictness, A4 cell stratification), testing (hand-computed-fixture coverage).

**Risk:** Low. Pure functions; the only subtlety is the graded-gain formula and the multi_hop full-coverage strictness — both are pinned by hand-computed tests.

---

## Phase 3 — Retrieval-relevance judge (offline)

### Task 3 — Sonnet relevance judge + mocked-LLM tests

**Files:**
- Create: `eval/rag/harness/relevance-judge.ts`
- Create: `src/__tests__/eval/rag/relevance-judge.test.ts`

**Goal:** A retrieval-specific relevance judge, machinery patterned on `src/lib/foxy/quality-eval.ts` (Sonnet `claude-sonnet-4-20250514`, temperature 0, strict JSON, fenced-recovery parse, clamp, spot-checkable raw response) but with the **retrieval rubric** from spec §B1.3 — it emits `{ relevance: 0|1|2, off_grade_scope: boolean, reason: string }` (A2). Exported pure helpers mirror quality-eval: `buildJudgeSystemPrompt()` (CBSE-scoped, grade-aware, age-context — P12), `buildJudgeUserMessage(query, grade, subject, chunkText)`, `parseJudgeJson(raw)` (handles `off_grade_scope` default false when absent), `clampRelevance()`. The judge is invoked ONLY during golden-set expansion/refresh (Task 9), never on a metric run. **Reuses** `runGroundingCheck` (imported from `grounded-answer/grounding-check.ts`) for the §3.5 groundedness-rate — no new groundedness logic.

**RED first:** write `relevance-judge.test.ts` with a **mocked LLM** (no live model call). Assert: (a) `buildJudgeSystemPrompt()` contains the CBSE grade-scope + age-appropriateness + "judge relevance, flag off_grade_scope separately" language; (b) `parseJudgeJson` parses a clean JSON, a fenced ```json block, and defaults `off_grade_scope` to `false` when the key is absent; (c) `parseJudgeJson` returns `null` (not throw) on garbage; (d) `clampRelevance` clamps out-of-range to {0,1,2}; (e) an `off_grade_scope: true` label round-trips. Run → FAIL. Implement → PASS.

**DoD:**
- Judge prompt is P12-compliant (CBSE grade/subject-scoped, age-aware, sees only query preview + chunk text — no PII).
- `off_grade_scope` is parsed independently of `relevance` (A2); absent → `false`.
- `parseJudgeJson` is conservative-fail (returns `null`, never throws on malformed model output).
- No live model call in tests (mocked); the judge module exports the pure helpers for unit testing.
- `npx vitest run src/__tests__/eval/rag/relevance-judge.test.ts` passes.

**Reviewers:** assessment (the judge prompt is a P12 curriculum-scope + age-appropriateness artifact — MANDATORY review of prompt wording + `off_grade_scope` semantics), testing (parse/clamp/mocked-LLM coverage).

**Risk:** Medium. The judge prompt is a P12 artifact; assessment review is mandatory before merge. No production path touched (offline, build-time only).

---

## Phase 4 — Trace-mining tool

### Task 4 — Trace-mining with column-allowlist projection + PII scrub

**Files:**
- Create: `eval/rag/harness/trace-mining.ts`
- Create: `eval/rag/harness/scrub.ts`
- Create: `src/__tests__/eval/rag/trace-mining.test.ts`

**Goal:** A read-only tool that samples distinct queries from `grounded_ai_traces` (preferred) / `retrieval_traces` for distribution realism (Tier 2). **A1: the SELECT is built from an explicit non-PII column-allowlist constant** — `grounded_ai_traces`: `caller, grade, subject_code, chapter_number, query_hash, query_preview, retrieved_chunk_ids, top_similarity, chunk_count, grounded, confidence, created_at`; `retrieval_traces`: `caller, grade, subject, chapter_number, concept, query_text, query_sha256, embedding_model, reranked, chunk_ids, match_count, latency_ms, created_at`. **Never `SELECT *`. Never the forbidden columns `grounded_ai_traces.student_id` / `retrieval_traces.user_id` / `retrieval_traces.session_id`.** `scrub.ts` wraps `redactPIIInText()` from `supabase/functions/_shared/redact-pii.ts` (free-form email + Indian-phone + Razorpay-ID redactor; documented NOT to strip names). **B3: trace-mined candidates default to `query_sha256`-only storage**; a query preview is retained only where provably PII-free. Mined queries carry NO trustworthy labels — they are handed to the Task 3 judge.

**RED first:** write `trace-mining.test.ts` with a mocked Supabase client. Assert: (a) the projection list exposed by the module contains NONE of `student_id`/`user_id`/`session_id`; (b) the projection list is a subset of the documented A1 allowlist for each table; (c) a mined candidate stores `query_sha256` by default and only stores a preview after `redactPIIInText` has been applied; (d) `scrub.ts` strips an embedded email/phone from a sample string. Run → FAIL. Implement → PASS.

**DoD:**
- The SELECT projection is a single exported constant per table; the test pins it against the A1 allowlist and the forbidden-column denylist.
- `query_sha256`-only is the default; previews only post-`redactPIIInText`.
- Read-only — zero writes to any DB table; uses the least-privilege client where the trace read permits, service-role only where RLS bypass is required (B6).
- `npx vitest run src/__tests__/eval/rag/trace-mining.test.ts` passes.

**Reviewers:** assessment (trace-mined items feed the judge → curriculum-scope relevance correctness), testing (the projection/denylist assertion is the P13 gate). architect (P13 column-allowlist + B6 least-privilege client posture).

**Risk:** Medium (P13 surface). Mitigated by the column-allowlist constant + the denylist test + sha256-default + `redactPIIInText`.

---

## Phase 5 — Live-DB harness runner

### Task 5 — `run-eval.ts` runner + integration entry

**Files:**
- Create: `eval/rag/harness/run-eval.ts`
- Create: `eval/rag/harness/baseline.ts`
- Create: `src/__tests__/eval/rag/run-eval.integration.test.ts`

**Goal:** The orchestrator. It (1) loads + validates `ncert-golden-v1.json` (Task 1 validator), (2) constructs the read-only client via the EXISTING `makeServiceSupabase()` (`src/__tests__/migrations/_helpers/supabase-runtime.ts`) and skips cleanly via the EXISTING `hasSupabaseIntegrationEnv()` (`src/__tests__/helpers/integration.ts`) when no live DB — **no bespoke env auto-detect** (B4); (3) calls the REAL `retrieve()` per golden item with `caller: 'rag-eval-harness'`, `limit = max(k) = 20`, `candidateCount = 40`, `rerank = true` — nothing stubbed; (4) scores via the Task 2 metrics, builds the A4 per-(grade-band × subject) breakdown; (5) records whether the run was full-path (`VOYAGE_API_KEY` present) or degraded (FTS-only); (6) compares to baseline via `baseline.ts` per-metric bands (A7) and emits `PASS | REGRESS | INCONCLUSIVE` (INCONCLUSIVE whenever degraded — never gate on a degraded run); (7) writes the scored report + verdict to **B1's own report artifact** under `eval/rag/reports/` (independent of the umbrella integration-job exit code — B5). The integration test (`run-eval.integration.test.ts`) is the live-DB entry; it also verifies every `relevant_chunk_id` resolves to an active `rag_content_chunks.id` (corpus-parity check, Q1 — fail loudly on a miss).

**RED first (integration lane):** the integration test `describe` evaluates to `describe.skip` without live-DB env, so on a no-secret PR it is a clean skip (green). Where the live DB IS present, the test asserts: (a) a verdict is emitted and is one of the three values; (b) a degraded run (no `VOYAGE_API_KEY`) yields `INCONCLUSIVE`; (c) the report artifact is written with the A4 per-cell breakdown; (d) corpus-parity: all golden chunk-ids resolve. (The RED-first discipline here is at the unit boundary — `baseline.ts` verdict logic gets pure tests folded into Task 7.)

**DoD:**
- Runner reuses `hasSupabaseIntegrationEnv()` + `makeServiceSupabase()` (B4) — no new env-detect code.
- Calls real `retrieve()` + `match_rag_chunks_ncert`, read-only, ZERO DB writes; only writes to `eval/rag/reports/`.
- Emits a per-metric-band verdict; degraded runs are always `INCONCLUSIVE`.
- A4 per-cell breakdown present in the report; corpus-parity check fails loudly on an unresolved chunk-id.
- Verdict lands in B1's own artifact (B5 decoupling from the umbrella job).
- Integration test skips cleanly without live-DB secrets (PR CI stays green).

**Reviewers:** assessment (the scored output + verdict are the retrieval-correctness contract), architect (live-DB / service-role posture, `makeServiceSupabase` reuse, report-artifact decoupling B5), testing (integration-lane wiring + skip-guard reuse).

**Risk:** Medium. Hits a live DB + external Voyage API; mitigated by read-only posture, the skip-guard, the degraded→INCONCLUSIVE guard, and the corpus-parity check.

---

## Phase 6 — Production-telemetry rollup

### Task 6 — `telemetry-baseline.ts` read-only rollups

**Files:**
- Create: `eval/rag/harness/telemetry-baseline.ts`
- (covered by the Task 5 integration test + a small pure-fn test for the rollup math)

**Goal:** Read-only aggregates over `retrieval_traces` / `grounded_ai_traces` (spec §B1.6) via the A1 column-allowlist projection: non-empty-retrieval rate (hit-rate proxy), top-similarity percentiles **explicitly labeled RRF-scale `[0, ~0.033]`** (Correction #3 — avoid the 2026-05-10 confidence-threshold misread), rerank rate, grounded rate + confidence distribution. **All rollups sliced by grade × subject_code** so weak cells are visible (the real-world signal that tells B2 where to focus). Read-only; written only to the report.

**DoD:**
- Aggregates use the A1 column-allowlist projection (no `student_id`/`user_id`/`session_id`).
- Top-similarity percentiles carry an explicit RRF-scale label in the report.
- Sliced by grade × subject_code.
- Pure percentile/rollup math has a small unit test; the live read rides the Task 5 integration test.

**Reviewers:** assessment (which slices matter for tuning), architect (A1 projection on the student-adjacent trace read; B6 least-privilege), testing (rollup-math unit test).

**Risk:** Low-Medium. Read-only over already-scrubbed tables; A1 projection is the guardrail.

---

## Phase 7 — Baseline JSON + verdict/gate logic

### Task 7 — Baseline file (per-metric bands) + verdict pure tests

**Files:**
- Create: `eval/rag/baseline/ncert-baseline-v1.json`
- (verdict logic lives in `eval/rag/harness/baseline.ts` from Task 5; this task pins it with pure tests)
- Extend: `src/__tests__/eval/rag/metrics.test.ts` (or a new `baseline.test.ts`) with verdict cases

**Goal:** Author the committed baseline holding the metric values on the current production settings (RRF k=60, MMR λ=0.7, fetch-N=40, floor=0.5 via `retrieve()`) **plus the A7 per-metric bands stored inline**: `nDCG@10` 2% relative, `recall@10` 2% relative, `MRR` 3% relative, `hit-rate@10` 2pp absolute, `groundedness-rate` 3pp absolute. The verdict logic (`baseline.ts`) is pinned by pure tests: a within-band drop → PASS; a beyond-band drop on ANY single primary metric → REGRESS; an improvement → PASS with deltas; a degraded run → INCONCLUSIVE regardless of metrics. The baseline values themselves are populated by a full-path run on current settings during Task 9/10 (a reviewed action) — the band STRUCTURE ships in this task.

**RED first:** `baseline.test.ts` asserts the verdict function on synthetic (baseline, run) pairs: each band boundary (just-inside vs just-outside) for all five metrics, the absolute-vs-relative distinction (a 2% relative move on a 0.5 hit-rate must NOT trip the 2pp-absolute band, but a 0.03 absolute drop MUST), the degraded→INCONCLUSIVE short-circuit, and the "any single metric regresses ⇒ REGRESS" rule. Run → FAIL. Implement `baseline.ts` verdict → PASS.

**DoD:**
- Bands stored in the JSON, never auto-refreshed; a comment block states they are assessment-reviewed.
- Verdict logic enforces per-metric bands with correct relative-vs-absolute math.
- Degraded run → INCONCLUSIVE short-circuits before any band comparison.
- `npx vitest run src/__tests__/eval/rag/baseline.test.ts` passes.

**Reviewers:** assessment (the bands are the regress-tolerance contract — Q3/A7; MANDATORY), testing (verdict boundary cases).

**Risk:** Low (band logic) / Medium (the band VALUES are an assessment correctness call). Mitigated by assessment review + boundary tests.

---

## Phase 8 — CI wiring (architect-reviewed)

### Task 8 — `vitest.config.ts` pattern + `ci.yml` VOYAGE_API_KEY + package.json script

**Files:**
- Modify: `vitest.config.ts` (lines 11-14 `INTEGRATION_TEST_PATTERNS`; lines 23-24 include glob; the exclude at 62-77 already maps `INTEGRATION_TEST_PATTERNS`)
- Modify: `.github/workflows/ci.yml` (lines 372-375 `integration-tests` job env)
- Modify: `package.json` (scripts)
- Create: `src/__tests__/eval/rag/import-boundary.test.ts`

**Goal:** (1) Add `'src/__tests__/eval/**'` to `INTEGRATION_TEST_PATTERNS` so the existing `RUN_INTEGRATION_TESTS=1` glob catches `run-eval.integration.test.ts` (B1; rejected alt: place under `migrations/**` to avoid the config change — chosen against for cleaner separation/quarantinability). (2) Add `VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}` to the `integration-tests` job env block alongside the existing `STAGING_SUPABASE_*` → `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` mappings (B2). (3) Wire a `package.json` script for local runs. (4) Add the B6 import-boundary test: greps `src/app/**` for any import of `eval/rag/harness/**` and fails on a hit (harness must never reach a shipped bundle).

**DoD:**
- `INTEGRATION_TEST_PATTERNS` includes `src/__tests__/eval/**`; the normal lane still EXCLUDES it (no DB in PR unit run); the integration lane INCLUDES it.
- `ci.yml` `integration-tests` job env carries `VOYAGE_API_KEY`; absence degrades to INCONCLUSIVE (Task 5 guard), CI stays green.
- `import-boundary.test.ts` passes (no `src/app/**` import of the harness) and would FAIL if one were added.
- `npm test` (normal lane) green; `RUN_INTEGRATION_TESTS=1` lane picks up the new pattern.

**Reviewers:** architect (the `vitest.config.ts` `INTEGRATION_TEST_PATTERNS` change AND the `ci.yml` secret-env addition are BOTH architect-reviewed infra changes), testing (lane behavior + import-boundary test). ops/architect (the `VOYAGE_API_KEY` secret PROVISIONING is the operational prerequisite, Prerequisite #1).

**Risk:** Medium. Touches CI config + vitest config (build-impacting). Mitigated by architect review and the degrade-to-green behavior when the secret is absent.

---

## Phase 9 — Seed the golden set (assessment-authored)

### Task 9 — Author + verify the ~28-32-item golden set

**Files:**
- Create/populate: `eval/rag/golden/ncert-golden-v1.json`

**Goal:** Assessment authors the stratified seed (Q2): grade bands 6-8 / 9-10 / 11-12 × core subjects × 4 query types, ≥2 items/cell where the cell exists, ≥1 multi_hop per (band × subject); ≈28-32 items. **A3: `relevant_chunk_ids` are authored from curriculum/corpus inspection** (chapter+concept lookup against `rag_content_chunks` filtered `source='ncert_2025'`, `grade_short`, `subject_code`, then reading `chunk_text` to confirm the chunk truly answers the query) — NOT from the current retriever's candidate list. Grades 11-12 substitute `physics` for combined `science` and a humanities subject (e.g. `history`) for `social_studies` (A6/Q2). Each chunk gets graded `relevance` (2/1/0) + `off_grade_scope`. Trace-mined Tier-2 items (optional in v1) get judge labels (Task 3) with ≥20% assessment spot-check. **Corpus-parity verification:** run the Task 5 integration test against the live DB to confirm every `relevant_chunk_id` resolves (Prerequisite #2).

**DoD:**
- `ncert-golden-v1.json` passes `golden-schema.test.ts` (Task 1): subject allowlist incl. `social_studies`, P5 grade strings, UUIDs, no PII keys.
- Stratification satisfied (≥2/cell, ≥1 multi_hop per band×subject); seed labels are candidate-pool-independent (A3).
- Every `relevant_chunk_id` resolves to an active `rag_content_chunks.id` (corpus-parity, Q1).
- `off_grade_scope` set on every labeled chunk.

**Reviewers:** assessment (OWNS this content — curriculum-scope correctness, candidate-pool independence A3, stratification Q2, grade-substitution at 11-12; MANDATORY). testing (schema-test gate + corpus-parity integration run). architect (corpus-parity / staging-clone confirmation, Prerequisite #2).

**Risk:** Medium. Content authoring is the long-pole correctness task; mitigated by the schema test + corpus-parity check + assessment ownership.

---

## Phase 10 — Baseline population, regression catalog, docs

### Task 10 — Populate baseline values + REG-140 + docs

**Files:**
- Populate: `eval/rag/baseline/ncert-baseline-v1.json` (metric values from a full-path run)
- Modify: `.claude/regression-catalog.md` (append REG-140)
- Modify: `eval/rag/README.md` (append the retrieval-path-harness section)

**Goal:** Run the harness full-path (with `VOYAGE_API_KEY`) on the current production settings over the Task 9 golden set and commit the resulting metric values into `ncert-baseline-v1.json` (the bands shipped in Task 7; the VALUES ship here, a reviewed action). Append the regression-catalog entry at the **next-free id REG-140** (current catalog max is **REG-139** after the MOL merge). Append the README section documenting the new harness alongside the existing end-to-end one (cross-reference the existing "Known gap 1: No rerank-quality eval").

**REG-140 (proposed):** `rag_retrieval_eval_harness_gate` — **Invariant guarded: P12 (AI safety — retrieval-quality measurement backbone) + the B2-tuning gate contract.** The offline read-only harness measures the REAL `retrieve()` + `match_rag_chunks_ncert` path against a versioned, candidate-pool-independent (A3), PII-clean (A1 column-allowlist + B3 sha256-default + `redactPIIInText`) golden set; metrics are scale-independent rank metrics (recall/nDCG-2^rel−1/MRR/hit-rate/multi_hop-coverage); the verdict applies per-metric regress bands (A7: nDCG/recall 2% rel, MRR 3% rel, hit-rate 2pp abs, groundedness 3pp abs), is INCONCLUSIVE on a degraded (no-Voyage) run, and never auto-refreshes the baseline; the harness writes ZERO DB rows and is never imported by client code (B6). Enforced by `src/__tests__/eval/rag/{metrics,golden-schema,relevance-judge,trace-mining,baseline,import-boundary}.test.ts` (normal lane) + `src/__tests__/eval/rag/run-eval.integration.test.ts` (live-DB lane).

**DoD:**
- Baseline values populated from a full-path run; the run was full-path (not degraded).
- REG-140 appended; the catalog's running total is incremented; the entry names the enforcing tests.
- README documents the new harness + its relationship to the existing one.

**Reviewers:** assessment (baseline values are a correctness snapshot; the catalog entry's invariant framing), testing (REG-140 tests exist + pass; catalog total reconciled), ops (catalog/docs are ops-adjacent; the README's CI-usage section).

**Risk:** Low (docs/catalog) / Medium (the baseline VALUES gate B2 — but they are a snapshot of current behavior, reviewed by assessment).

---

## Review chain (P14)

This is a RAG/retrieval change owned by **ai-engineer**. Per the constitution's review matrix (RAG/retrieval → ai-engineer reviewed by assessment + testing; CI/infra → architect):

- **ai-engineer** — implements all `eval/rag/harness/**` modules, the golden-schema, metrics, judge, trace-mining, runner, baseline logic.
- **assessment** — MANDATORY on: golden-set content + stratification (Q2) + candidate-pool-independent labels (A3); the relevance-judge prompt (P12 curriculum-scope + age-appropriateness + `off_grade_scope` semantics A2); the metric definitions (nDCG gain, multi_hop coverage A5, A4 cell breakdown); the per-metric regress bands (A7/Q3); the baseline values snapshot.
- **architect** — MANDATORY on: the `vitest.config.ts` `INTEGRATION_TEST_PATTERNS` change (B1); the `ci.yml` `VOYAGE_API_KEY` env addition (B2); the live-DB / service-role + B6 least-privilege client posture; the import-boundary guard; the report-artifact decoupling from the umbrella job (B5); corpus-parity / staging-clone confirmation (Q1).
- **testing** — runs after every task (every phase ends green); confirms the pure-fn lane + integration-lane wiring + the skip-guard reuse (B4) + REG-140 catalogued and CI-enforced.
- **ops/architect** (operational prerequisites, NOT code review): provision the `VOYAGE_API_KEY` GitHub secret (Prerequisite #1); fix/quarantine the seat-enforcement integration red gate before B2 consumes the verdict (Prerequisite #3, a B2 prerequisite).

**No CEO gate:** no production model/provider change (Voyage + Sonnet judge are existing; judge runs offline — Q5); no new CBSE subject; no P1-P13 invariant change. B1 was CEO-approved as the first phase of "fine-tune the Voyage RAG" on 2026-06-13.

---

## Definition of done (B1, plan-level)

- All 10 tasks complete; every phase ends with a green test run (pure-fn lane +, where live-DB present, the integration lane).
- `eval/rag/golden/ncert-golden-v1.json` + `eval/rag/baseline/ncert-baseline-v1.json` committed and schema-valid.
- The harness emits a per-metric-band `PASS | REGRESS | INCONCLUSIVE` verdict + A4 per-cell breakdown to its own report artifact, read-only, zero DB writes.
- CI wiring (vitest pattern + `VOYAGE_API_KEY` env) landed and architect-reviewed; import-boundary guard passing.
- REG-140 catalogued and CI-enforced; spec invariants (P12/P13/P8/P9/P5 + zero production behavior change) intact.
- B2 is unblocked: any RRF-k / MMR-λ / fetch-N / floor change can be run through the harness and gated against the committed baseline (reading B1's report artifact until the seat-enforcement red gate is resolved — Prerequisite #3).
