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

## REG-264..REG-269 — Response-cache v2 (gen_ctx full-context keys + fail-closed cache_scope + per-caller serving + durable L3 + env-pair split + PII-free telemetry) (2026-07-16)

Source: response-cache v2 (CEO-approved decisions 1-3, 2026-07-16). Supersedes
the v1 L2 tier pinned by REG-240 (whose enforcing tests were EDITED, not
weakened, in the same PR — the shadow-flag write-gating, fail-open-on-Redis-error,
no-abstain-caching, tuple re-validation, and REG-50 zero-retrieval/zero-trace
L2-hit pins all survive with v2 keys). Root production bug fixed: the v1 key
(grade/subject/mode/caller/query-hash) collapsed Foxy learn/practice/quiz_me
turns that share query text — a practice-shaped MCQ response was served to a
learn turn. v2 folds EVERYTHING that changes generation for the same text into
a hashed gen_ctx tuple (prompt template + PROMPT_REV/MODEL_ROUTE_REV, model
preference, max_tokens, temperature, template_variables, conversation_turns,
per-scope content_version), moves the cache to a DEDICATED Upstash instance
(env-pair split), adds a fail-closed caller-declared `cache_scope`, per-caller
serving flags, and a durable L3 solution store for ncert-solver.

New flags (both seeded OFF: `20260716090200` / `20260716090300`, REG-125-conformant
— verified by the seed-shape canary, which scans every root migration):
`ff_response_cache_serve_ncert_v1`, `ff_ncert_solver_solution_store_v1`.
New tables (architect): `rag_content_versions` (`20260716090000`),
`ncert_solver_solutions` (`20260716090100`).

Files: `supabase/functions/grounded-answer/{gen-ctx.ts,cache-redis.ts,cache.ts,
cache-durable.ts,cache-telemetry.ts,_content-version.ts,_l2-cache-flags.ts,
pipeline.ts,types.ts,validators.ts}`, `supabase/functions/_shared/rag-content-version.ts`,
`supabase/functions/ncert-solver/index.ts`, `apps/host/src/app/api/foxy/route.ts`,
`packages/lib/src/ai/grounded-client.ts`, `supabase/functions/_shared/grounded-client.ts`,
the four ingestion writers (`embed-ncert-qa`, `embed-questions`,
`generate-embeddings`, `extract-ncert-questions`).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-264 | `response_cache_key_v2_full_context_tuple` | (a) The L2 key is the 9-segment `rag:cache:v2:<grade>:<subject>:<mode>:<caller>:<sha256(normalized query)>:<12-hex gen_ctx fragment>` — distinct from every live Redis prefix INCLUDING the retired `rag:cache:v1`; deterministic, case/whitespace-insensitive, punctuation-preserving. (b) The v1 mode-collision fix at BOTH halves: identical text/scope/mode/caller with different gen_ctx (learn vs practice template_variables, max_tokens, temperature, model_preference, conversation_turns, content_version — each component individually) produce DIFFERENT keys, and even at a colliding key the stored tuple's FULL 64-char `gen_ctx_hash` is re-validated on read — any mismatch is a miss, never served (L2 read-time enforcement). (c) `canonicalJson` is key-order independent so semantically identical contexts can never fork the cache. (d) L1 folds the same full gen_ctx hash into `buildCacheKey` (optional param — legacy callers keep byte-identical keys). (e) The pre-existing REG-240 guarantees survive the v2 edit: shadow-flag write-gating (write happens with shadow ON / serving OFF), fail-open on absent secrets AND on a reachable-but-erroring Redis, abstains never cached, and the REG-50 L2-hit contract (zero `retrieveChunks` rpc calls, zero new trace rows, seeded `trace_id` returned verbatim, L1 backfilled). Per-caller TTLs pinned: foxy 20 min, ncert-solver 24 h, unknown callers fall back to the shorter foxy TTL. | `supabase/functions/grounded-answer/__tests__/gen-ctx.test.ts` (5 Deno tests); `__tests__/cache-redis.test.ts` (v2-updated: key shape, gen_ctx-mismatch read rejection, per-caller TTL, tuple carries full hash); `__tests__/pipeline.test.ts` (v2-updated shadow-write + L2-hit REG-50 tests) | E | P12 (response-contract integrity), P13 |
| REG-265 | `cache_hit_still_decrements_quota` | Static-source pin (P12: a cache hit can never bypass daily limits because the quota unit is consumed BEFORE the possibly-cached answer is fetched): in `apps/host/src/app/api/foxy/route.ts` the `await checkAndIncrementQuota(` call site precedes `await callGroundedAnswer(groundedRequest`, with the `if (!allowed)` → 429 deny early-return between them; in `supabase/functions/ncert-solver/index.ts` the `rpc('check_and_record_usage'` call site precedes `await callGroundedAnswer(`, with the `if (!usageRow?.allowed)` → `daily_limit_reached` deny between them. | `apps/host/src/__tests__/regressions/response-cache-v2-callers.test.ts` (quota-before-grounded describe, 2 tests) | E | P12 |
| REG-266 | `personalized_foxy_turns_never_written_to_shared_cache` | (a) Service-side fail-closed gate (behavioral): a request WITHOUT `cache_scope: 'shared'` engages NO cache tier even with serving+shadow flags ON — zero Upstash writes AND an empty L1 after a full grounded run. (b) Safe-merge pin (behavioral): with all four cache flags OFF and `cache_scope` absent, the pipeline performs zero Upstash I/O, never reads `rag_content_versions`/`ncert_solver_solutions`, never even READS the four cache flags (only `ff_grounded_ai_enabled`), preserves the pre-v2 external call order (coverage → kill-switch → retrieval rpc → traces), and returns a normal grounded response; the ONE intentional deviation — L1 no longer populates for undeclared-scope requests (fail-closed beats caching) — is pinned explicitly on both the legacy and v2 L1 keys. (c) Caller-side (static): ncert-solver declares `cache_scope: 'shared'` (personalization-free by construction); the Foxy route computes `foxyCacheScope` as the fail-closed conjunction — 'shared' ONLY when `history.length === 0` AND no tenant AI override AND the cognitive section is empty/cold-start with no twin/teaching-director addition AND all of academic-goal/misconception/pending-expectation/previous-session/learner-memory sections are `''` — defaulting to `'none'`; every conjunct is individually pinned, and the six sections feeding the conjunction are the SAME hoisted values wired into template_variables (cannot drift). Both GroundedRequest client mirrors + the service type carry `cache_scope?: 'shared' | 'none'`. | `supabase/functions/grounded-answer/__tests__/pipeline.test.ts` (`cache_scope absent → fail-closed` + `safe-merge pin` tests); `apps/host/src/__tests__/regressions/response-cache-v2-callers.test.ts` (cache_scope describe, 4 tests) | E | P13, P12 |
| REG-267 | `cache_redis_isolated_from_rate_limiter_db` | The cache client reads ONLY `UPSTASH_CACHE_REDIS_REST_URL`/`_TOKEN` with deliberately NO fallback to `UPSTASH_REDIS_REST_URL`/`_TOKEN` (the security-critical noeviction instance backing rl:*/sess:valid:* — a cache filling it would fail rate-limiter WRITES): behaviorally, with ONLY the legacy pair set the client stays unconfigured — get→null miss, put→no-op, and ZERO fetch calls reach the legacy host; statically, the legacy env names appear in cache-redis.ts comments only, never in executable source. Fail-open preserved: absent cache pair degrades to a miss, never a throw. | `supabase/functions/grounded-answer/__tests__/cache-redis.test.ts` (`env-pair split pin` test); `apps/host/src/__tests__/regressions/response-cache-v2-callers.test.ts` (env-pair-split describe) | E | Operational integrity (rate-limiter/session availability), P12-adjacent |
| REG-268 | `content_version_bump_rotates_cache_keys` | (a) All four ingestion writers (embed-ncert-qa, embed-questions, generate-embeddings, extract-ncert-questions) import and `await bumpRagContentVersion(` after successful content writes (static pin). (b) `content_version` is a gen_ctx component: bumping it alone changes the hash (unit). (c) End-to-end stale-grounding kill (behavioral, pipeline-level): an L3 solution stored under version N is a MISS at version N+1 — the pipeline consults L3 under the NEW gen_ctx hash, runs full retrieval + generation, and re-stores the fresh solution under the new hash + `content_version: N+1`; the stale answer (built on pre-ingestion chunks) is never served. Missing `rag_content_versions` row / read error → version 0 (safe: affects freshness windows only, never cross-scope serving — that stays guarded by full-tuple re-validation). | `apps/host/src/__tests__/regressions/response-cache-v2-callers.test.ts` (content-version describe, 4 tests); `supabase/functions/grounded-answer/__tests__/gen-ctx.test.ts` (component test); `__tests__/cache-durable-l3.test.ts` (version-mismatch pipeline test); `__tests__/rag-content-version-bump.test.ts` (6 Deno unit tests — increment/seed semantics, P5 grade + subject-code normalization, unresolvable-scope skip, never-throws) | E | P12 (stale-grounding) |
| REG-269 | `durable_l3_reg50_position_flag_gate_pii_free` + `cache_telemetry_pii_free` | **L3 (ncert-solver only; write gated by `ff_ncert_solver_solution_store_v1`, read gated by the serve×store conjunct — see c2):** (a) REG-50 position — L3 is consulted only AFTER an L2 miss (the L2 get precedes the L3 select in the observed call order) and strictly BEFORE retrieval: an L3 hit performs ZERO `retrieveChunks` rpc calls, ZERO new grounded_ai_traces/retrieval_traces rows, ZERO model calls, and returns the STORED trace_id verbatim. (b) An L3 hit backfills BOTH L1 and L2. (c) Flag OFF → the table is fully inert (never read, never written) even for cache_scope:'shared' solver requests. (c2) Serve-flag conjunct (post-review fix) — the L3 READ/SERVE path requires BOTH `ff_response_cache_serve_ncert_v1` AND `ff_ncert_solver_solution_store_v1`: serve OFF + store ON → L3 is NEVER read/served (zero `l3:select`, full retrieval + fresh generation runs, a pre-seeded matching row's answer/`trace_id` never leak into the response) BUT exactly one write-back lands under the correct question_hash/gen_ctx_hash/content_version — write-back is store-flag-only, so the warm-the-store-before-serving ramp works. (d) P13 — the upserted row's columns are EXACTLY {grade, subject_code, question_hash, gen_ctx_hash, content_version, model, tokens_used, created_at, response} (migration `20260716090100`'s DO-UPDATE column set; the three provenance columns carry only a model name, a token count, and an explicit ISO timestamp — still student-identifier-free); the serialized payload contains no `student_id`/`user_id`/`email`/`phone`-shaped keys and never carries the request's student_id value even when a (misbehaving) caller passes one. (e) Defense-in-depth mirrors L2: stored-tuple mismatch → miss; abstains never written. **Telemetry (design item 8):** `logCacheMetric` emits ONLY the whitelisted dims (caller/grade/subject/optional tokens_avoided) — properties smuggled onto the dims object are DROPPED; the serialized emission never matches `/name|email|phone|message|answer/i`; all four metric names are `cache_l2_*`/`cache_l3_*` enums. | `supabase/functions/grounded-answer/__tests__/cache-durable-l3.test.ts` (7 Deno tests); `__tests__/cache-telemetry.test.ts` (3 Deno tests) | E | P13, P12, REG-50 continuity |

### REG-50 canary hardening (same PR)

`apps/host/src/__tests__/foxy-single-retrieval-contract.test.ts` counted
`retrieveChunks(` on RAW pipeline.ts source; the v2 PR's L3 comment
("…strictly BEFORE retrieveChunks (REG-50 position)…") false-positived it.
The call-count assertion now runs on comment-stripped executable source and
additionally re-asserts the single call is the awaited `retrieveChunks(sb…)`
invocation — enforcement is unchanged (any second REAL call still fails);
comments may reference the function freely.

### Invariants covered by this section

- P12 (AI safety / response-contract + retrieval-cost integrity) — REG-264
  kills the learn/practice cross-serving bug at both the key and the
  read-validation layer; REG-265 pins quota-before-cache in both callers;
  REG-268 guarantees re-ingested NCERT content invalidates cached answers;
  REG-269 extends the REG-50 zero-retrieval/zero-trace contract to the L3 tier.
- P13 (data privacy) — REG-266: a personalized Foxy turn (history, twin,
  misconception, goal, memory, tenant-override, prior-session sections) can
  never be written to or served from the shared cache; REG-269: the durable
  L3 payload and the cache telemetry channel are pinned identifier-free.
- Operational integrity — REG-267: cache traffic can never land on (or fall
  back to) the security-critical rate-limiter/session Redis instance.
- Safe merge / rollback readiness — REG-266(b): with all four flags OFF and
  no caller declarations, the pipeline's external behavior is the pre-v2
  sequence, so the merge itself is a zero-behavior change (both new flags
  seeded OFF, REG-125-conformant).

### Catalog total

Pre-REG-264: 227 entries (through REG-260, landing V3 + pricing pins).
Adds REG-264 (v2 full-context cache keys + read-time gen_ctx re-validation +
REG-240 continuity), REG-265 (quota-before-cache in both callers), REG-266
(fail-closed cache_scope — personalized turns never shared + safe-merge pin),
REG-267 (cache/rate-limiter Redis env-pair split), REG-268 (content-version
bump rotates keys — stale-grounding kill), REG-269 (durable L3 REG-50
position + flag gates: store-only write / serve×store read conjunct + P13
payload/telemetry).
**Total catalog: 233 entries (target: 35 — TARGET EXCEEDED).**

---

