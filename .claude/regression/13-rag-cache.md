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

## REG-316 — RAG shadow confidence instrumentation (absolute cosine + Voyage rerank score → `confidence_v2`), shadow-only by construction (2026-07-27)

Branch `claude/rag-confidence-shadow-instrumentation`, 2 commits: `6e6f9d96`
(migration `20260727130000` — expose `cosine_similarity` from
`match_rag_chunks_ncert`) and `9febc5be` (thread cosine + `rerank_score` through
retrieval, add `confidence-v2.ts`, compute `confidence_v2` in shadow at BOTH
trace-write sites, migration `20260727130100` adds 3 nullable columns to
`grounded_ai_traces`). Both are ZERO BEHAVIOUR CHANGE by design.

**Why this needs pinning.** Confidence v1 feeds `computeConfidence` an RRF
ORDERING statistic. In the vector-only regime RRF is fixed by construction
(ranks 1,2,3 → 1/61, 1/62, 1/63) and `groundingPassRatio` is pinned at 1, so v1
collapses to `0.347606 + 0.2 * (chunks / match_count)` — three reachable values,
with 912 of 996 sampled production traces landing on exactly `0.647606`. It is a
chunk counter wearing a relevance costume. v2 substitutes a RELEVANCE signal
(Voyage rerank score, else absolute cosine) into the SAME unmodified
`computeConfidence`. The entire value of this step is the INTEGRITY OF THE SHADOW
DATA it collects — so the pins below protect the data, not a user-visible
behaviour.

Files: `supabase/functions/grounded-answer/{confidence-v2.ts,pipeline.ts,
pipeline-stream.ts,retrieval.ts,trace.ts}`,
`supabase/functions/_shared/rag/retrieve.ts`,
`supabase/functions/_shared/reranking.ts`,
`supabase/migrations/20260727130000_rag_ncert_expose_cosine_similarity.sql`,
`supabase/migrations/20260727130100_grounded_traces_shadow_confidence_v2.sql`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-316 | `shadow_confidence_v2_is_recorded_never_compared` | **(1) Shadow-only, statically enforced.** No production file compares `confidence_v2`/`confidenceV2` to anything — a quote-aware comment-stripping scan over ~2400 files across `supabase/functions`, `packages/lib/src`, `packages/ui/src`, `apps/host/src`, `mobile/lib`, `eval`, `scripts` finds ZERO relational/equality operators adjacent to the shadow identifier, and the set of files that mention it at all is pinned to exactly four (`confidence-v2.ts`, `pipeline.ts`, `pipeline-stream.ts`, `trace.ts`). The strict-mode abstain gate still reads the v1 bare `confidence`, and `STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` is compared against exactly one identifier (`confidence`) in all four files. The SSE `metadata` frame carries `confidence: plannedConfidence` and NO v2/cosine field, so the wire shape is unchanged. `computeConfidenceV2` delegates to the UNMODIFIED v1 `computeConfidence` — no second formula (no `0.4 *`), no private threshold. A meta-pin proves the detector regex actually fires on 6 synthetic violation shapes and stays silent on the 4 legitimate record-only shapes, so the scan cannot rot into a vacuous pass. **(2) NULL is never coerced to 0 at ANY hop.** Behaviourally at three hops: RPC row → chunk (`mapNcertRow` maps absent column / SQL NULL / NaN / Infinity / non-numeric → `null`, keeps a genuine `0`, and leaves `similarity`'s deliberate `? x : 0` untouched — the two adjacent statements must stay different); `adaptChunk` (`cosine_similarity`/`rerank_score` pass through as `null`, never `0`); and inside `computeConfidenceV2` (a signal-less chunk is OMITTED from the top-3 average, NOT zeroed — the omitted mean is asserted to differ from and exceed the zeroed mean; all-null ⇒ `confidence_v2 = null` + source `'none'`; `chunksReturned` still counts signal-less chunks because coverage is a retrieval-VOLUME term). Statically: the `const cos =` statement ends `: null`, both `ctx.topCosineSimilarity` stamps end `: null`, all three `rr.rankedScores[pos] ?? null` sites, the identity-result `map(() => null)` sites, and the DB columns are nullable with no `NOT NULL`/`DEFAULT 0` and NULL still a legal `confidence_v2_source`. **(3) `rankedScores` ↔ `rankedIndices` positional alignment.** For BOTH rerank implementations (`_shared/reranking.ts` and the private `callVoyageRerank` in `_shared/rag/retrieve.ts`): scores pair with the index Voyage returned them for (not with array position, verified through an out-of-order `[4,0,2]` promotion and re-checked end-to-end after MMR reordering by asserting the chunk_id→score PAIRING); a non-numeric/absent `relevance_score` becomes `null` in its slot without shifting neighbours; slicing to `finalCount` slices both arrays together; and EVERY fall-through path — no documents, no API key, `docCount <= topK`, non-2xx, malformed body, empty `data`, network throw — returns `rankedScores` of the SAME LENGTH as `rankedIndices`, filled with `null`. **(4) Precedence + no scale mixing.** The TOP chunk decides the source (`rerank` > `cosine` > `none`) and it is applied UNIFORMLY: a cosine-only neighbour never enters a `'rerank'` row's top-3 average even when its cosine (0.99) dwarfs the rerank scores; rerank wins even when the cosine is far larger (the rerank/RRF inversion this change exists to defeat); a signal-bearing chunk further down does NOT rescue a signal-less top chunk; the top-3 window is exactly 3; `top_cosine_similarity` is recorded INDEPENDENTLY of the chosen source (a `'rerank'` row still reports its own cosine, or `null` when it has none). Output stays inside the `numeric(5,4)` domain `[0,1]` for out-of-range inputs, and the emitted source vocabulary is exactly the DB CHECK vocabulary `('rerank','cosine','none')`. `computeConfidenceV2` is pure (does not mutate the chunk array), total (never throws on `null`/`undefined`/string/number/object `chunks`), deterministic, and divides safely when `matchCountTarget = 0`. **(5) `match_rag_chunks_ncert` overload count stays at 2 (static migration scan).** PostgREST resolves overloads by argument NAME; a third overload re-opens the production defect of PR #1394, where the caller silently bound a stale floor-less overload and the relevance floor became dead code — and NOTHING in CI failed. A parse of every `CREATE [OR REPLACE] FUNCTION … match_rag_chunks_ncert` across the whole migration chain finds exactly TWO distinct argument-name tuples (the 10-arg `p_min_quality` baseline that must survive for fresh-DB REVOKE replay, and the 11-arg live `p_quality_score_gate` + `p_min_similarity` overload); the newest live definition is `20260727130000` and still carries both discriminators and never `p_min_quality`; every `DROP FUNCTION` of that name targets an 11-arg signature (a 10-arg DROP would break the no-`IF EXISTS` REVOKEs in `20260516040000`/`20260516050000`); `cosine_similarity` is APPENDED LAST to the RETURNS TABLE with `similarity` still at index 5, so positional consumers are unaffected; the function body never names the cosine in a `WHERE`/`ORDER BY`/`HAVING` (output-only) while the vector-CTE floor `1 - (c.embedding <=> query_embedding) >= p_min_similarity` is intact; and the migration keeps its own post-flight `v_total > 2` / `v_live <> 1` / `cosine_similarity`-present aborts. **(6) Deploy-ordering fallback.** `writeTrace` retries ONCE with exactly the three shadow keys stripped on a PGRST204-style failure and ONLY when the row actually carried them (`in`-semantics, so a present-but-`undefined` key still qualifies); the retry payload is byte-identical to the pre-instrumentation row; a legacy row without shadow keys that fails issues EXACTLY ONE insert (a genuine RLS/connection failure is never silently doubled); a thrown first insert is not retried; at most one retry ever; the caller-supplied row is not mutated; and every path returns a non-empty string trace id. | `apps/host/src/__tests__/regressions/rag-confidence-v2-shadow.test.ts` (24); `rag-confidence-v2-shadow-source-pins.test.ts` (24); `rag-shadow-signal-plumbing.test.ts` (28); `grounded-trace-shadow-column-fallback.test.ts` (11) — 87 Vitest tests | E | P12 |

### Known gaps (do NOT read this entry as broader than it is)

- **No live-DB assertion of the overload count.** Pin (5) scans MIGRATION
  SOURCE, not `pg_proc`. A third overload created out-of-band (hand-run SQL,
  Supabase Studio, a `_legacy/` replay) is invisible to it. The only live check
  remains the post-flight `DO $post$` block inside `20260727130000`, which fires
  only when that migration runs. Closing this needs an integration-lane test
  under `src/__tests__/migrations/**` against a real Postgres.
- **No behavioural test of `runPipeline` / `runStreamingPipeline`.** Both boot
  Deno-only dependencies, so the `ctx.confidenceV2` → `TraceRow` wiring, the
  `topCosineSimilarity` stamp position (before the `scope_mismatch` branch, so
  post-retrieval abstain rows carry it), and the pre-retrieval-abstain
  `confidence_v2_source: null` vs `'none'` DISTINCTION are pinned STATICALLY
  only. `writeTrace` is covered behaviourally; its two callers are not.
- **No Deno tests were added.** Deno is not installed in the working
  environment, so anything under `supabase/functions/**/__tests__/` could not
  have been executed. Nothing was written there rather than shipping unverified
  tests.
- **`numeric(5,4)` rounding is not asserted.** A `confidence_v2` of `0.71234567`
  is stored as `0.7123`. That is intended (shadow precision) but is a DB-level
  behaviour with no test.
- **The pre-existing streaming/non-streaming v1 asymmetry is deliberately NOT
  pinned.** `pipeline-stream.ts` feeds `computeConfidence` the RAW un-normalized
  RRF while `pipeline.ts` divides by `RRF_THEORETICAL_MAX`. That asymmetry
  predates this work and was left exactly as is; adding a test would freeze a
  bug in place. Flagged to assessment.

### Invariants covered by this section

- P12 (AI safety / grounding honesty) — REG-316 keeps `confidence_v2` a purely
  observational column: it cannot gate an abstain, cannot reach the SSE wire,
  and cannot be pooled across measurement scales. The shadow sample it collects
  is protected against the two failure modes that would silently invalidate it —
  NULL→0 coercion (an unmeasured chunk recorded as maximally irrelevant) and
  rerank-score/index misalignment (a real score attributed to the wrong chunk).
- Operational integrity — REG-316(5) is the CI failure that PR #1394 did not
  have: the `match_rag_chunks_ncert` overload family is now guarded at review
  time, not at migration-run time.
- Safe merge / rollback readiness — REG-316(6): the Edge Function may be
  deployed ahead of migration `20260727130100` without destroying a single trace
  row, and rows that predate the instrumentation take the byte-identical old
  write path.

### Catalog total

Pre-REG-316: 315 entries (through REG-315, GenAI Phase 5d Study Tools client
surface). Adds REG-316 (RAG shadow confidence instrumentation — shadow-only
enforcement, NULL-never-zero at every hop, rerank score/index alignment,
source precedence without scale mixing, `match_rag_chunks_ncert` overload-count
guard, and the trace-writer deploy-ordering fallback).
**Total catalog: 316 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-332 — grounded-answer content-readiness precheck: gate on `chunk_count`, not `rag_status` (closes the ncert-solver / GenAI Lesson+Content 100%-abstain deadlock) (2026-08-01)

Source: same-session fix following the 2026-07-27 GenAI incident
(`docs/incidents/2026-07-27-genai-generation-agents-100pct-abstain/README.md`),
whose own "Outstanding / NOT resolved" item (a) and acceptance criterion 1
explicitly named this predicate revision as the deferred remediation path.
`supabase/functions/grounded-answer/coverage.ts`'s strict-mode content
precheck — the hard gate every `mode:'strict'` caller runs before any
Voyage/Claude call — required `cbse_syllabus.rag_status='ready'`, itself an
aggregate of TWO independent signals (`chunk_count>=50` AND
`verified_question_count>=40`). Production had zero rows satisfying the
combined bar (per the incident doc: 889 `partial` / 259 `missing` / 0
`ready`, reported 2026-07-27), so every strict-mode caller — `ncert-solver`
(broken silently "for months", per the incident doc, because
`grounded_ai_traces` only ever recorded `caller='foxy'`, which runs
soft-mode and skips the gate) and the two newly-shipped GenAI agents (Lesson
Generation, Content/Diagram Generation, REG-313/314) shipped to 100%
production rollout — abstained on effectively every real request.
`verified_question_count` was never relevant to any of the three callers:
none of them reads `question_bank` (they are pure NCERT-text retrieval /
generation / structure-verification). Worse, it created a live bootstrapping
deadlock — `verify-question-bank`, the ONLY process that grows
`verified_question_count`, itself calls this precheck in `mode:'strict'`
scoped to the very chapter it is trying to verify a question for, so under
the old predicate no chapter could ever organically satisfy the gate that
blocked the one process that grows the count, and each such failure is
recorded as a PERMANENT `verification_state='failed'` with no retry path
(never reclaimed by `claim_verification_batch`).

Fix: the 3 predicate-check call sites inside `coverage.ts` — the
specific-chapter check (`checkCoverage`, chapter_number provided), the
subject-wide check (`checkCoverage`, chapter_number null), and
`suggestAlternatives` — now test `chunk_count >= MIN_CHUNKS_FOR_READY`
(existing constant, `config.ts:4`, value `50`, unchanged) instead of
`rag_status === 'ready'`. `rag_status`, `verified_question_count`, and
`recompute_syllabus_status()` are byte-for-byte untouched — confirmed: no
migration in this change touches `cbse_syllabus`, `recompute_syllabus_status`,
or `rag_status`, and `config.ts` itself has no diff. Every dashboard/view
keyed on `rag_status` (`ingestion_gaps`, the super-admin Grounding Coverage
route) will keep reporting the same "0 ready" picture post-fix — that is now
a legibility gap, not a functional one; ops should not read an unchanged
dashboard as "the fix didn't work" (coverage.ts's own OPERATIONAL NOTE).

Files: `supabase/functions/grounded-answer/coverage.ts`,
`supabase/functions/grounded-answer/__tests__/coverage.test.ts`,
`supabase/functions/grounded-answer/__tests__/pipeline.test.ts` (test-only
fixture update to match the new query shape; no `pipeline.ts` production
code changed — confirmed no diff). `config.ts` (source of
`MIN_CHUNKS_FOR_READY`) is referenced, not modified.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-332 | `chunk_count_gate_replaces_rag_status_gate` | **(1) A chapter with ample `chunk_count` is servable regardless of `verified_question_count`** — the decisive fixture stubs `syllabus_row: { chunk_count: 200 }` with NO `verified_question_count` field present anywhere in the mock at all, proving `checkCoverage` cannot be reading it, and asserts `ready: true` (`coverage.test.ts`, "2026-08-01 fix: ready:true when chunk_count is ample even though verified_question_count would be zero"). **(2) A chapter below the chunk bar still abstains**, including the exact boundary (`MIN_CHUNKS_FOR_READY - 1` → `ready:false`; `MIN_CHUNKS_FOR_READY` exactly → `ready:true`) and zero/absent-row cases (`coverage.test.ts`, 5 tests). **(3) The subject-wide (no-chapter) and `suggestAlternatives` paths use the same `chunk_count` bar** via `.gte('chunk_count', MIN_CHUNKS_FOR_READY)`, replacing `.eq('rag_status','ready')` (`coverage.test.ts`, 4 tests: 2 subject-wide + 2 `suggestAlternatives`). **(4) The fix holds end-to-end through the real pipeline, not just the isolated unit** — the two tests explicitly named "(regression check)" in `pipeline.test.ts` confirm a `chapter_not_ready` scope still abstains at the coverage stage with `abstain_reason: 'chapter_not_ready'` when run through `runPipeline`, not just `checkCoverage` in isolation. **Real, live Deno counts (verified this session):** `coverage.test.ts` — **10/10 passed, 0 failed** (`deno test --allow-all __tests__/coverage.test.ts`). `pipeline.test.ts` — **21 total: 20 passed, 1 failed**; the 1 failure (`handleRequest: pipeline throws → 500 with structured upstream_error abstain`, asserting HTTP 401 where 500 is expected) was reproduced with an IDENTICAL failure signature (same test, same assertion, same 401-vs-500 diff) against the unmodified pre-fix HEAD version of all three changed files, copied into an isolated scratch directory and run standalone — proving it predates and is unrelated to this change. | `supabase/functions/grounded-answer/__tests__/coverage.test.ts` (10 tests: `returns chapter_not_ready when chunk_count is below the bar`, `returns chapter_not_ready when chunk_count is zero`, `returns chapter_not_ready when syllabus row is absent`, `returns ready:true when chunk_count meets the bar exactly (boundary)`, `returns chapter_not_ready when chunk_count is one below the bar (boundary)`, `2026-08-01 fix: ready:true when chunk_count is ample even though verified_question_count would be zero…`, `subject-wide query: ready:true when subject has at least one chapter meeting the bar`, `subject-wide query: chapter_not_ready when subject has no chapter meeting the bar`, `suggestAlternatives caps at 3`, `suggestAlternatives returns empty array when none exist`); `supabase/functions/grounded-answer/__tests__/pipeline.test.ts` (2 of 21: `strict mode + chapter_not_ready coverage → still abstains at coverage stage (regression check)`, `strict mode + chapter_not_ready coverage → abstain reason is chapter_not_ready (regression check)`) | P | P12 |

### Known gaps (do NOT read this entry as broader than it is)

- **No live-Postgres verification.** Every test above runs against a
  hand-written Deno stub Supabase client, never a real `cbse_syllabus` row.
  The incident doc's own acceptance criterion 1 requires the predicate
  change to be "re-verified against production data" — this entry does NOT
  satisfy that clause. Closing it needs a live-DB integration-lane check
  (this repo has no such lane for Deno Edge Functions today).
- **`pipeline.test.ts` and `e2e.test.ts` do not run in CI's blocking lane.**
  Per `.github/workflows/ci.yml`'s own comment, 4 of the 23 Deno test files
  under `grounded-answer/__tests__/` are deliberately absent from
  `DENO_TEST_TARGETS` — `e2e`, `pipeline`, `cache-durable-l3`, and
  `foxy-answer-continuation` — because all four import `../index.ts`, which
  calls `Deno.serve()` (binds a socket, needs `--allow-net`, flaky in CI).
  Only `coverage.test.ts` is in the CI-blocking `DENO_TEST_TARGETS` list
  (confirmed by direct read of the workflow file). This session's
  `pipeline.test.ts` run is real and was executed directly via
  `deno test --allow-all --no-check`, but it is a local, out-of-CI signal —
  a future change could silently re-break it without CI ever noticing.
- **`e2e.test.ts` (untouched by this fix — confirmed zero diff) fails on a
  completely fresh, unmodified checkout: 8 total, 0 passed, 8 failed**
  (re-verified this session: `deno test --allow-all --no-check
  __tests__/e2e.test.ts` from `supabase/functions/grounded-answer/` —
  corrects the prior wording here, "fails 0/8," which had the count
  backwards; all 8 fail, none pass). Root cause (verified, not just
  asserted): every fixture request is built by `mkRequest()` with no
  `Authorization` header, and `handleRequest` → `admitRequest` →
  `resolveSecurityPrincipal` (`supabase/functions/_shared/security/auth.ts`)
  rejects any request missing that header with `{ status: 401,
  code: 'deny_auth', message: 'missing authorization header' }` before the
  request ever reaches `runPipeline`/`coverage.ts` — so all 8 failures share
  this one admission-layer cause (the prior wording, "an `undefined` vs
  `true` assertion at line 427," described only the last test's symptom of
  it, not a separate issue, and understated the failure as narrower than it
  is). `index.ts`, `_shared/security/auth.ts`, and `e2e.test.ts` are all
  unmodified by this session (confirmed via `git status` / `git diff HEAD`),
  so this is genuinely pre-existing test/fixture drift against a stale
  (no-auth-header) request shape — not something this session's
  `coverage.ts` predicate change introduced or touched; the request never
  reaches `coverage.ts` at all before being rejected. Reported here only so
  nobody mistakes it for a regression introduced by this work; not
  otherwise in scope.
- **Does not remediate the existing `verification_state='failed'` backlog.**
  Chapters that already failed verification under the old deadlocked
  predicate stay `failed` — `verify-question-bank`'s caller does not
  automatically retry `failed` rows. Whether to reclaim them is a DATA
  remediation decision (assessment/ops), not addressed by this code change.
- **SEPARATE, pre-existing, NOT fixed here: `select_quiz_questions_rag` does
  not filter on `verified_against_ncert` at all.** Independently confirmed
  by reading the live function body
  (`supabase/migrations/20260801100700_select_quiz_questions_rag_service_role_skip.sql`,
  byte-copied from `20260625000200`): its `WHERE` clauses filter only on
  `subject`/`grade`/`chapter_number`/`is_active`/`question_type_v2` (or
  `is_ncert`)/`difficulty` — no reference to `verified_against_ncert` or
  `ff_grounded_ai_enforced_pairs` anywhere in the body, and none of its three
  live callers (`apps/host/src/app/api/quiz/route.ts`,
  `.../v2/quiz/questions/route.ts`, `.../whatsapp/_lib/daily6.ts`) add an
  equivalent filter on top. So quiz-serving today does not gate on
  verification status at all, regardless of this entry. This is a real,
  separately-tracked gap — do NOT conflate it with the coverage-precheck fix
  above; flagging for ai-engineer/assessment follow-up, not claiming it
  fixed.
- **Review-chain note.** Per this repo's review-chain matrix, an ai-engineer
  RAG/retrieval change requires assessment + testing review. The change's
  own header attributes its review to "ai-engineer review" only (both
  correction notes in `coverage.ts`); no evidence was found in the diff of a
  separate assessment sign-off on the predicate change itself. Flagging for
  the orchestrator to confirm before treating this chain as complete — not
  something this entry can certify on its own.

### Invariants covered by this section

- P12 (AI safety / grounding availability) — REG-332 closes the specific
  defect where a content-sufficiency gate was conflated with a quiz-
  verification-maturity gate, restoring strict-mode groundedness for any
  chapter with enough ingested NCERT text regardless of an unrelated,
  structurally-unsatisfiable quiz-verification count. Confidence threshold
  (`STRICT_CONFIDENCE_ABSTAIN_THRESHOLD = 0.75`, `config.ts:36`), scope
  verification (`pipeline.ts`'s `scope_mismatch` check, Step 6b), and output
  screening (`output-screen.ts`) are all confirmed UNCHANGED — none appears
  in this session's diff — so this fix widens WHICH chapters can be
  attempted without touching any of the three downstream safety gates that
  run once a chapter is attempted.

### Catalog total

Pre-REG-332: 331 entries (through REG-331, BoardScore™ subject-scoping fix
batch — see `15-cross-cutting.md`). Adds REG-332 (grounded-answer
content-readiness precheck — `chunk_count` gate replaces the
`rag_status`/`verified_question_count` conflation that deadlocked
`verify-question-bank` and silently broke `ncert-solver` plus two
100%-rolled-out GenAI agents; 10/10 `coverage.test.ts` + 20/21
`pipeline.test.ts` [1 pre-existing unrelated failure] Deno tests verified
live this session; explicitly PARTIAL — no live-DB verification,
`pipeline.test.ts`/`e2e.test.ts` outside CI's blocking Deno lane, and a
separate `select_quiz_questions_rag` verification-filter gap flagged but not
fixed).
**Total catalog: 332 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-400 — `match_rag_chunks` / `match_rag_chunks_ncert` dangling unclosed paren: a hard SQL-syntax parse failure, shipped TWICE (2026-08-13)

Priority: **P0.** Source: this session's fix pass. Both RAG retrieval RPCs —
`match_rag_chunks` and `match_rag_chunks_ncert` — carried a dangling unclosed
`(` in their quality-score WHERE-clause predicate, in the SAME shape,
independently, in TWO files:

```
AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality
AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
```

— the first `(` is never closed, so the very NEXT line's `AND (...)` reads as
a continuation of the same parenthesized group rather than a sibling
predicate. This is not a logic bug: Postgres cannot even PARSE the statement.
`CREATE OR REPLACE FUNCTION` itself fails with
`ERROR: mismatched parentheses at or near ";" (SQLSTATE 42601)` before the
function is created at all. Affected files (fixed in this pass, both
verified against the pre-fix committed `HEAD` copy to confirm the bug was
real, not hypothetical):

- `supabase/migrations/00000000000000_baseline_from_prod.sql` — 5
  occurrences of the pattern across `match_rag_chunks` (2) and
  `match_rag_chunks_ncert` (3 — it has three WHERE branches: vector, FTS,
  LIKE-fallback).
- `supabase/migrations/20260620000900_fix_match_rag_chunks_drop_syllabus_version.sql`
  — the standalone `match_rag_chunks` hotfix migration, which re-shipped the
  SAME dangling-paren defect in its own copy of the function body (the
  syllabus-version fix and the paren bug are in unrelated branches of the same
  file — fixing one did not fix the other).

**Distinct from the already-catalogued Project B schema-reproducibility debt**
(`docs/runbooks/schema-reproducibility-debt.md`; referenced via REG-144 in
`03-quiz-integrity.md`). Project B is about MISSING relations/columns from
out-of-band prod drift — `CREATE FUNCTION`/`INSERT` statements that parse
fine but fail at execution time (`42703`/`23503`) because the schema or seed
data they reference doesn't exist on a fresh DB. This is a different failure
class: a hard SQL **syntax** parse error that blocks the statement from ever
reaching `CREATE`, independent of what schema state exists — it breaks the
baseline itself, not just a fresh DB's ability to reproduce prod. A DB that
already has the (differently-broken) prod version of these functions would
never surface this; only an attempt to actually RUN the migration text
(`CREATE OR REPLACE FUNCTION ...`) would.

**Why it went undetected:** no existing test parses/validates SQL
function-body syntax. Coverage was either mocked RPC call-site tests (never
touch the SQL text) or live-DB integration tests (accepted-RED / rarely
exercise a truly fresh baseline apply — see Project B above). A syntax error
inside a `CREATE FUNCTION` body was invisible to both lanes.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-400 | `migration_sql_paren_balance` | Every `CREATE [OR REPLACE] FUNCTION ... AS <tag> ... <tag>` body across root `supabase/migrations/*.sql` (baseline + timestamped chain; `_legacy/` excluded, matching what `supabase db push` actually applies) has balanced `(`/`)` after stripping single-quoted string literals (`''` = escaped quote), `--`/`/* */` comments, and nested dollar-quoted sub-strings. Dollar-quote tag resolved dynamically per statement (`$$`, `$_$`, `$function$`, etc. — not hardcoded). Static/no-DB — a lint-style structural guard, not a SQL parser or correctness prover; catches exactly the "fails to CREATE due to unbalanced parens" class, nothing semantic. **Fixture-based proof (not run against real migrations) that the helper actually catches this bug shape:** a deliberately-unbalanced sample `CREATE FUNCTION ... AS $function$ ... AND (c.quality_score >= p_min_quality \n AND (...) ... $function$;` string (the exact REG-400 shape) is asserted to flag `open !== close`; the same body with the paren closed is asserted to pass; companion fixtures pin string-literal stripping (incl. `''` escape), comment stripping, dynamic dollar-tag resolution (`$_$`), and that `CREATE FUNCTION` text inside a `--` comment is not mistaken for a real statement. **Regression pin:** both files this bug shipped in twice (`00000000000000_baseline_from_prod.sql`, `20260620000900_fix_match_rag_chunks_drop_syllabus_version.sql`) are asserted to contain at least one `match_rag_chunks*` body and every such body is paren-balanced — verified to FLAG against the pre-fix committed `HEAD` copies of both files (2 unbalanced functions in the baseline, 1 in the hotfix migration) before the working-tree fix. | `apps/host/src/__tests__/schema/migration-sql-paren-balance.test.ts` (11 tests: 6 fixture-based helper proofs + non-vacuity floor + full-chain scan + 2-file regression pin) | E |

### Invariants covered by this section

- P6 Question quality / RAG retrieval integrity (adjacent) — REG-400 guards
  the RPCs `match_rag_chunks`/`match_rag_chunks_ncert` that ground
  NCERT-solver, concept-engine, and (for the `_ncert` variant) Foxy chat
  retrieval — a SQL syntax failure here is a total outage of those surfaces
  on any environment that applies the migration, not a quality degradation.
- Schema reproducibility (adjacent to but distinct from Project B, tracked in
  `docs/runbooks/schema-reproducibility-debt.md`) — REG-400 closes the
  syntax-parse-failure sub-class that Project B's audit scope does not cover
  (Project B is scoped to missing-relation/missing-column errors from
  out-of-band drift).

### Catalog total

Pre-REG-400: per `00-header.md`, REG-399 (the anon-EXECUTE P0 batch,
`10-rbac-rls.md`, REG-399a/REG-399b) is the latest filed entry, with REG-400
declared the next free id. This entry claims REG-400. **Total catalog: 400
entries (target: 35 — TARGET EXCEEDED).** Per `00-header.md`'s own standing
caveat, the declared running total and the independently-derived
body-backed-id count are known to disagree by a pre-existing, tracked
amount; this entry does not attempt that reconciliation — it only claims the
next id the header declared free at the time of filing.

**Total: 400 entries (declared) — see `00-header.md` for the authoritative
running total and its open counting caveats.**

---

