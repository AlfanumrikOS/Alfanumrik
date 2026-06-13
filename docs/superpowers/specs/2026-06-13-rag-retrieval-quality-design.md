# RAG Retrieval-Quality Evaluation Harness & Golden Query Set — Design Spec

> **Status:** Approved (design) — 2026-06-13. **Spec reviewed + revised 2026-06-13** to incorporate assessment review (A1-A7) + architect review (B1-B6) and to resolve open questions Q1/Q2/Q3/Q5. Ready for plan-writing.
> **Owner:** ai-engineer (implements harness + metrics) · assessment (golden-set curation, relevance-label validation, retrieval correctness) · architect (live-DB CI / service-role offline script) · testing (CI wiring).
> **Approver:** CEO (ceo@alfanumrik.com) — "fine-tune the Voyage RAG"; B1 (measurement backbone) approved as the first phase 2026-06-13.
> **Sub-project:** B1 of the RAG / Retrieval-Quality Engine (sub-project B). B depends on A (MOL unification). B1 is the only IN-SCOPE phase here; B2–B5 are appendix-only.
>
> **Review-incorporation log (2026-06-13):** assessment MUST-FIX A1 (PII column-allowlist projection), A2 (judge `0`-label `off_grade_scope` disambiguation), A3 (candidate-pool-independent seed labeling); assessment SHOULD-FIX A4 (per-band×subject golden-set breakdown), A5 (multi_hop full-coverage metric), A6 (`social_studies` canonical subject code), A7 (per-metric regress bands); architect MUST-FIX B1 (CI lane placement — dedicated `src/__tests__/eval/**` pattern), B2 (`VOYAGE_API_KEY` CI wiring), B3 (P13 scrub cites `redactPIIInText`); architect SHOULD-FIX B4 (reuse `hasSupabaseIntegrationEnv`/`makeServiceSupabase`), B5 (seat-enforcement red-gate dependency), B6 (least-privilege client + import-boundary guard). Open questions Q1/Q2/Q3/Q5 resolved inline; Q4 (groundedness-rate spend) remains an ops cost note, not a blocker.

---

## Program context (why this is sub-project B1)

The CEO request — "fine-tune the Voyage RAG" — cannot start with tuning. The governing principle: **you cannot fine-tune what you cannot measure.** Sub-project A's MOL unification shipped a pre-cutover quality eval harness that *gated* the Python cutover (spec §A5). B applies the same discipline to retrieval: build the measurement backbone first, then every tuning phase must beat the baseline it establishes.

B decomposes into five phases, each its own spec → plan → implementation cycle:

| # | Phase | Depends on | Status |
|---|---|---|---|
| **B1** | **Retrieval-quality eval harness + golden query set (this spec)** | A | **IN SCOPE** |
| B2 | Tune RRF k / MMR λ / fetch-N / similarity floor against the golden set | B1 | appendix only |
| B3 | Activate the dormant goal-aware rerank + Foxy quality-judge, measured by B1 | B1, B2 | appendix only |
| B4 | Query-side rewriting (paraphrase / HyDE) | B1, B2 | appendix only |
| B5 | Closed feedback loop (mine real misses → expand golden set → re-tune) | B1–B4 | appendix only |

Build sequence: **B1 → B2 → (B3 ∥ B4) → B5.** This spec covers **B1 only.**

---

## Goal

Build an **offline, read-only** harness that measures the quality of Alfanumrik's **live production NCERT retrieval path** — the TypeScript `retrieve()` contract plus the `match_rag_chunks_ncert` RPC — against a versioned golden query set with human/LLM-validated relevance labels. The harness emits (a) a scored metrics report and (b) a **pass / regress verdict vs a stored baseline**, so it can GATE B2 tuning the way A's eval harness gated cutover.

**Objective priority:** (1) faithfully measure the REAL path with ZERO production behavior change → (2) a trustworthy golden set → (3) sound metrics → (4) a deterministic gate → (5) a real-world telemetry baseline alongside the offline golden-set metrics.

## Non-goals (out of scope for B1)

- **No retrieval tuning.** B1 does not change RRF k (60), MMR λ (0.7), fetch-N (40), or the similarity floor. Those are B2 levers — B1 only measures the current settings so B2 has a baseline to beat.
- **No production-path change of any kind.** The harness READS retrieval; it never alters `retrieve.ts`, the RPC, `pipeline.ts`, or any Edge Function. ZERO student-facing behavior change.
- **No goal-aware rerank or quality-judge activation** (B3). `ff_goal_aware_rag` stays OFF.
- **No corpus / ingestion changes.** `rag_content_chunks` is read-only to this harness; we do not add, re-embed, or re-chunk.
- **No model/provider change.** Voyage `voyage-3` embeddings + `voyage-rerank-2` are measured as-is (no model swap — that would need CEO approval).
- **No score/XP/anti-cheat (P1–P6) impact.** Retrieval feeds prompts, not scores.

---

## Current state (verified against code, 2026-06-13)

The live production retrieval path is **100% TypeScript + Postgres** — there is **no Python in the RAG path today.** Sub-project A's Python MOL is the *generation* orchestration brain; it forwards to providers but does **not** include RAG retrieval. Confirmed: `python/services/ai/` has no `match_rag_chunks_ncert` caller and no Voyage retrieval module. **B1 therefore measures the TS path, and is correct to do so.**

### The live retrieval contract — exact signatures found

**TS entry point:** `supabase/functions/_shared/rag/retrieve.ts` → `export async function retrieve(opts: RetrieveOptions): Promise<RetrievalResult>`.

`RetrieveOptions` (the exact fields, from `retrieve.ts:69-121`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | `string` | — | required; never PII (sanitized upstream) |
| `grade` | `Grade` (`'6'`..`'12'`) | — | required; P5 validated at the boundary |
| `subject` | `string` | — | snake_case subject code (`"math"`, `"science"`) |
| `chapterNumber` | `number \| null` | `null` | integer or null |
| `chapterTitle` | `string \| null` | `null` | ILIKE filter; also used for embedding-only query expansion |
| `limit` | `number` | `8` (`DEFAULT_LIMIT`) | top-N after rerank |
| `minSimilarity` | `number` | `0.5` (`DEFAULT_MIN_SIMILARITY`) | passed to the RPC's `p_min_quality` |
| `rerank` | `boolean` | `true` | Voyage rerank-2 over the over-fetched set |
| `candidateCount` | `number` | `max(40, limit)` (`RERANK_DEFAULT_FETCH = 40`) | pre-rerank fetch-N |
| `caller` | `string` | — | required; tracing + breaker keying |
| `embeddingProvider` | `'voyage-3'` | `'voyage-3'` | only voyage-3 in Phase 1 |
| `embedding` | `number[] \| null` | `null` | pre-computed embedding (skips embed stage) |
| `timeoutMs` | `number` | `12000` | bounds embed + rerank network calls only |
| `supabase` | injected client | — | required; module is stateless |
| `voyageApiKey` | `string` | `Deno.env VOYAGE_API_KEY` | override |

`retrieve()` returns `RetrievalResult` (`retrieve.ts:150-163`): `{ chunks: RetrievalChunk[], embedding_ms, retrieval_ms, rerank_ms, total_ms, rpc_used, scope_drops, reranked, error }`. Each `RetrievalChunk` carries `chunk_id` (the `rag_content_chunks.id` UUID), `similarity`, `excerpt`/`content`, chapter metadata, and Q&A fields. **`chunk_id` is the join key the harness scores against golden labels.**

**The RPC:** `match_rag_chunks_ncert`, defined in migration `supabase/migrations/_legacy/timestamped/20260428000000_match_rag_chunks_ncert_rrf.sql` (the live definition is folded into `supabase/migrations/00000000000000_baseline_from_prod.sql`). Exact signature (`:40-51`):

```
match_rag_chunks_ncert(
  query_text       TEXT,
  p_subject_code   TEXT,
  p_grade          TEXT,
  match_count      INTEGER DEFAULT 10,
  p_chapter_number INTEGER DEFAULT NULL,
  p_chapter_title  TEXT    DEFAULT NULL,
  p_concept        TEXT    DEFAULT NULL,
  p_content_type   TEXT    DEFAULT NULL,
  p_min_quality    FLOAT   DEFAULT 0.4,
  query_embedding  vector(1024) DEFAULT NULL
)
```

Mechanics confirmed from the SQL body:
- **RRF k = 60** (`v_k CONSTANT INTEGER := 60`, `:80`), Cormack et al. 2009. Fusion combines a vector candidate set (`embedding <=> query_embedding`) and an FTS set (`ts_rank(search_vector, plainto_tsquery)`), each over-fetched to `GREATEST(match_count * 4, 60)` (`:96`), via `FULL OUTER JOIN` on chunk id with `rrf_score = 1/(60+rank_vec) + 1/(60+rank_fts)`.
- **Three-path fall-through:** Path 1 hybrid RRF (embedding present) → Path 2 FTS-only (no embedding / hybrid returned 0 rows) → Path 3 LIKE keyword fallback (assigns a flat `0.3` similarity).
- **Scope is pinned on every path:** `is_active = TRUE`, `source = 'ncert_2025'`, `subject_code = p_subject_code`, `grade_short = v_grade`, `quality_score >= p_min_quality` (NULL passes).
- **`SECURITY DEFINER`, `GRANT EXECUTE ... TO authenticated, service_role`.**

### CORRECTIONS to the brief's assumptions

These are differences between the brief and the real code; the spec is written against the real code.

1. **MMR λ is NOT a hardcoded constant inside `mmr.ts` — it is a parameter that defaults to 0.7.** `applyMMR<T>(rankedChunks, lambda = 0.7)` (`mmr.ts:111-114`). The *call sites* pass the literal `0.7`: `retrieve.ts:594` (`applyMMR(chunks, 0.7)`) and `grounded-answer/pipeline.ts`. So 0.7 is hardcoded **at the call site**, not in the algorithm. **Implication for B2:** tuning λ means changing the call-site literal (or threading a config), not editing `mmr.ts`. B1 records λ=0.7 as the baseline.

2. **The similarity floor IS already configurable — but it has TWO different defaults.** The RPC's `p_min_quality` defaults to **0.4** (`:49`). The TS `retrieve.ts` `DEFAULT_MIN_SIMILARITY` is **0.5** (`:239`), and `retrieve()` passes that as `p_min_quality` (`:510`), overriding the RPC default for callers that use `retrieve()`. Meanwhile the legacy `ncert-retriever.ts` kill-switch path uses `config.ragMinQuality` default **0.005** (calibrated for the RRF scale). The brief assumed the floor was not configurable — it is. **B1 records all three as observed baselines and flags the 0.4-vs-0.5-vs-0.005 inconsistency for B2.**

3. **The RPC's `similarity` output column is an RRF FUSED SCORE, not a cosine similarity.** RRF scores live in `[0, ~0.0328]` (theoretical max `2/61`, `config.ts:RRF_THEORETICAL_MAX = 2/61`). `pipeline.ts:802` normalizes by dividing by `RRF_THEORETICAL_MAX` before feeding `computeConfidence`. **This is the single most important metric-design constraint** (see §3, Metrics): any threshold or "top-similarity distribution" the harness reports must state which scale it is on. The Path-3 LIKE fallback further muddies this by stamping a flat `0.3`. **The harness reports rank-based metrics (recall/nDCG/MRR/hit-rate) that do not depend on the score scale, plus a separately-labeled raw-RRF-score distribution.**

4. **The default `match_count` differs by entry point.** RPC default = 10; `retrieve()` `DEFAULT_LIMIT` = 8 with `candidateCount = max(40, limit)`. `retrieval_traces.match_count` column defaults to 5. The harness drives `retrieve()` with explicit `limit`/`candidateCount` per scenario, never relying on a default, and records them in the report header.

### Quality-eval machinery already present (to REUSE)

- **`src/lib/foxy/quality-eval.ts`** — `scoreFoxyAnswer()` is an LLM-as-judge over a 4-dimension rubric (accuracy / scaffoldFidelity / ageAppropriateness / cbseScope), Sonnet (`claude-sonnet-4-20250514`), temperature 0, with exported pure helpers `buildJudgeSystemPrompt()`, `buildJudgeUserMessage()`, `parseJudgeJson()`, `computeOverallScore()`, `clampScore()`, `stripFences()`. **Decision (see §2.3): this judges ANSWER quality, not RETRIEVAL relevance — the rubric does not fit relevance labeling. B1 REUSES its *machinery pattern* (Sonnet + temp 0 + strict JSON + fenced-recovery parse + clamp + spot-checkable raw response) in a NEW retrieval-specific relevance judge, rather than bending the answer rubric.**
- **`supabase/functions/grounded-answer/grounding-check.ts`** — `runGroundingCheck()` returns `{verdict: 'pass'|'fail', unsupportedSentences}`, Haiku, temp 0, conservative-fail. **REUSED AS-IS for the groundedness-rate metric** (§3.5); its `GROUNDING_CHECK_SYSTEM_PROMPT` is exported and parity-stable.
- **`supabase/functions/grounded-answer/confidence.ts`** — `computeConfidence()` pure function. The harness records confidence as an observed signal but does NOT gate on it.

### Trace-mining sources (verified schemas)

- **`grounded_ai_traces`** (baseline `:11379`): `caller` (CHECK in `{foxy, ncert-solver, quiz-generator, concept-engine, diagnostic}`), `grade`, `subject_code`, `chapter_number`, `query_hash` (sha256), `query_preview` (≤200 char, PII-stripped), `retrieved_chunk_ids uuid[]`, `top_similarity numeric(5,4)`, `chunk_count`, `grounded`, `confidence`, latency. **Table comment: "Stores query_hash + 200-char preview only (P13 privacy)."** This is the primary distribution-realism + real-query mining source.
- **`retrieval_traces`** (baseline `:13216`): `caller`, `grade`, `subject`, `chapter_number`, `concept`, `query_text` (CHECK ≤100 chars — REDACTED PREVIEW), `query_sha256`, `embedding_model` (default `voyage/voyage-3`), `reranked`, `chunk_ids uuid[]`, `match_count`, `latency_ms`. **This is the production-telemetry-baseline source (§5).**
- **`rag_content_chunks`** (baseline `:10126`) — the corpus. Relevant columns: `id uuid`, `chunk_text`, `grade` + `grade_short` (CHECK `grade_short ∈ {'6'..'12'}`), `subject` + `subject_code`, `chapter_number`, `chapter_title`, `topic`, `concept`, `content_type` (CHECK `∈ {content, diagram, qa}`), `embedding vector(1024)`, `quality_score`, `is_active`, `source` (CHECK `source = 'ncert_2025'` — `rag_chunks_source_ncert_only`), `exam_relevance text[]`. **The golden set references chunks by `id`.**

Both trace tables are already P13-scrubbed at write time (preview ≤100/200 chars, query_sha256, no full text). B1 adds a second scrub pass anyway (defense in depth, §7). **A1 — the harness never SELECTs `grounded_ai_traces.student_id`, `retrieval_traces.user_id`, or `retrieval_traces.session_id`**; the trace-mining SELECT is built from an explicit non-PII column allowlist (enumerated in §B1.3 → A1), enforced by `trace-mining.test.ts`.

---

## Approach decision

**Chosen: Approach 2 — a standalone Vitest-driven harness that calls the REAL `retrieve()` against a live-DB Supabase project, gated under the existing `RUN_INTEGRATION_TESTS` lane.**

Rationale, grounded in the existing test machinery:
- `retrieve.ts` is deliberately written with **zero `https://` imports** and reads only Deno globals defensively (`globalThis.Deno?.env...`), specifically so it runs under **both** `deno test` and **Vitest** from one source — confirmed by `src/__tests__/supabase/_shared/rag/rag-retrieve.test.ts`, which already imports and exercises it under Vitest with a stubbed client. The harness reuses this exact import path, but injects a **real** Supabase client instead of a stub.
- The repo already has a live-DB integration lane: `vitest.config.ts` keys on `RUN_INTEGRATION_TESTS=1` and a separate `test:integration` script gated on real `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (`vitest.config.ts:5-16, 111-116`). The harness rides this lane — no new CI primitive.
- Metrics (recall@k, nDCG@k, MRR, hit-rate) are **pure functions** unit-tested with Vitest in the normal (non-integration) lane against fixtures, so the math is verified without a DB.

**Rejected:**
- *Pure standalone Node/Deno script outside Vitest* — loses the existing assertion/reporter/CI integration, duplicates the integration-gating logic the repo already has, and re-implements the Deno-global stubbing that `rag-retrieve.test.ts` already solved.
- *Mock the DB and score against a synthetic corpus* — defeats the entire purpose. The harness MUST hit the real RRF RPC over a populated `rag_content_chunks`, or it measures a fiction.
- *Run against production directly* — read-only is necessary but not sufficient; we run against a **dedicated eval Supabase project / the CI live-DB** that has `rag_content_chunks` populated from the same NCERT ingest, never against the prod project on the hot path. (See §1 connection model.)

---

## Architecture (approved)

### B1.1 — What the harness measures (the real path, read-only)

```
golden item { query, grade, subject, chapter?, relevant_chunk_ids[] }
        │
        ▼
  retrieve({ query, grade, subject, chapterNumber, limit=K_MAX, candidateCount=40,
             rerank=true, caller='rag-eval-harness', supabase: <real read-only client> })
        │   (REAL embedding via voyage-3, REAL match_rag_chunks_ncert RRF k=60,
        │    REAL voyage-rerank-2, REAL applyMMR λ=0.7 — nothing stubbed)
        ▼
  RetrievalResult.chunks[] → ranked list of chunk_id
        │
        ▼
  score(ranked chunk_ids, golden relevant_chunk_ids) → recall@k, nDCG@k, MRR, hit-rate
  (optionally) groundedness-rate via runGroundingCheck on a generated answer
```

The harness is a **consumer** of `retrieve()`. It changes nothing in the production path. The only "writes" it performs are to its **own** report artifacts on disk (§4) — never to any DB table, never to `grounded_ai_traces` / `retrieval_traces` (those are written by the live pipeline; the harness only READS them in §5).

**Caller attribution:** the harness always passes `caller: 'rag-eval-harness'`. This keeps eval traffic distinguishable in any breaker keying and means eval runs are self-identifying. (Note: `grounded_ai_traces.caller` has a CHECK that does NOT include `rag-eval-harness` — which is fine, because the harness never inserts trace rows. If a future phase wants eval traces, that CHECK must be widened in a migration; out of scope for B1.)

### B1.2 — DB connection model (read-only, P8/P9-honored)

> **Q1 resolution — eval DB provenance.** B1 uses the **existing CI live-DB integration project** (the one keyed by the `STAGING_SUPABASE_*` GitHub secrets that `.github/workflows/ci.yml`'s `integration-tests` job already maps to `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). **No dedicated eval clone is provisioned for B1.** **CONDITION (assessment + architect/ops):** the golden set MUST be authored against the **same DB that CI reads**, OR staging must be verified as a same-source `ncert_2025` clone of prod, so that every `relevant_chunk_id` UUID resolves to a live `rag_content_chunks.id` row. Chunk UUIDs are stable only within one corpus snapshot; authoring labels against a different corpus than CI reads would make the seed tier silently un-resolvable. The `corpus_ref` field + the schema test's chunk-id-resolve check (§7) catch a mismatch loudly.

Two supported modes; the harness reuses the **existing skip-guard `hasSupabaseIntegrationEnv()`** (`src/__tests__/helpers/integration.ts`) and the **existing client constructor `makeServiceSupabase()`** (`src/__tests__/migrations/_helpers/supabase-runtime.ts`) — **no bespoke env auto-detect** (B4):

1. **CI live-DB mode (default in CI):** rides the existing `RUN_INTEGRATION_TESTS=1` lane. The integration entry is placed under `src/__tests__/eval/**` (B1; a new `INTEGRATION_TEST_PATTERNS` entry). `makeServiceSupabase()` constructs the **service-role** client from the lane's already-provided env. **Justification for service-role (vs RLS):** this is an offline, server-side, batch measurement script with no end-user in the loop — exactly the `supabase-admin.ts` use case (server-only, never client). It READS `rag_content_chunks` (NCERT corpus, not student data) and READS the already-P13-scrubbed trace tables. It performs **zero writes** to any DB table. This is the same service-role posture the repo's other integration tests use (`src/__tests__/migrations/**`). RLS is not bypassed for student data — the only student-adjacent reads are the pre-scrubbed trace tables, projected through the A1 column-allowlist, and the harness re-scrubs (§7).

> **B6 — least-privilege client for the corpus read.** `rag_content_chunks` is the NCERT corpus (not student data). Where the corpus read works under an **anon/authenticated** client (the `match_rag_chunks_ncert` RPC is `GRANT EXECUTE ... TO authenticated`, and the corpus rows are readable to authenticated under the corpus RLS), the harness SHOULD use the **least-privilege** client and reserve the **service-role** client only for reads that genuinely require an RLS bypass (the trace-table aggregates in §B1.6, which are student-adjacent). The runner picks the narrowest client that resolves the read; the service-role posture justification above stands only for the trace-table path. **Import-boundary guard:** `eval/**` harness modules must NEVER be imported by client code (`src/app/**` / anything that lands in the browser bundle) — they import a service-role client and the redactor. The plan adds an import-boundary assertion (a test that greps `src/app/**` for `from '@/...eval/'` / `eval/rag/harness` imports and fails on any hit) so the harness can never be tree-shaken into a shipped bundle.

2. **Local dev mode:** developer points `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_URL`) at a local/staging project with `rag_content_chunks` populated. Same read-only posture; `makeServiceSupabase()` handles both env-var spellings.

If neither is configured (placeholder env), `hasSupabaseIntegrationEnv()` returns false and the harness's live-DB describe block evaluates to `describe.skip` (logs a clear "no live DB — pure-function metric tests only" message) so PR CI without integration secrets stays green — the same mechanism every other integration test uses.

**Voyage API key (B2):** the harness needs a real `VOYAGE_API_KEY` to exercise the true embedding + rerank path. **The harness runs full-path when `VOYAGE_API_KEY` is present and emits `INCONCLUSIVE` when absent** (degrades gracefully — `retrieve()` falls back to FTS-only via the RPC's Path 2). The report header records whether embeddings/rerank were live or degraded, so a degraded run is never silently compared against a full-path baseline (§4 verdict guards on this). **CI wiring:** the plan adds `VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}` to the `integration-tests` job env block (`.github/workflows/ci.yml:372-375`) — an **architect-reviewed CI change**. **Operational prerequisite:** provisioning the `VOYAGE_API_KEY` GitHub secret is an **ops/architect** task and is a *prerequisite for CI to gate on the full path*, NOT a code blocker — when the secret is absent the harness degrades to `INCONCLUSIVE` and CI stays green, so B1 ships and measures regardless; the secret only unlocks full-path CI gating for B2.

### B1.3 — The golden query set (hybrid sourcing, versioned on disk)

**Three-tier sourcing (CEO-approved hybrid):**

**Tier 1 — assessment-curated seed (~28-32 items, stratified — see Q2 resolution below).** The authoritative core. Spans grades 6-12 × core CBSE subjects (canonical snake_case `subject_code`s: `math`, `science`, `social_studies`, `english`) × four query types:
- `factual` — single-fact lookup ("What is the SI unit of force?")
- `conceptual` — explanation ("Why does refraction bend light?")
- `definition` — term definition ("Define photosynthesis.")
- `multi_hop` — needs ≥2 chunks ("Compare the structure of arteries and veins.")

> **A6 — canonical subject code.** The social-science subject is pinned to the snake_case `subject_code` **`social_studies`** (NOT "social science", NOT "social_science"). This is the value the schema validator's subject allowlist enforces (§ component map) and the value the golden fixture stores. All four canonical core codes: `math`, `science`, `social_studies`, `english`.

> **A3 — candidate-pool-independent seed labeling.** Tier-1 seed `relevant_chunk_ids` are authored by assessment **from curriculum/corpus inspection** — a chapter+concept lookup against `rag_content_chunks` (filter `source='ncert_2025'`, `grade_short`, `subject_code`, `chapter_number`/`concept`/`topic`, then read `chunk_text` to confirm the chunk genuinely answers the query). They are **NOT** authored from the current retriever's candidate list. This is deliberate: a seed label derived from "what `retrieve()` returned" can never expose a true recall miss (the system would be scored against itself). Authoring the relevant set independently of the candidate pool is what lets the seed tier detect a chunk the live retriever *should* have surfaced but did not.

Each seed item carries **assessment-authored** `relevant_chunk_ids` (real `rag_content_chunks.id` UUIDs) with a per-chunk graded relevance (`2 = highly relevant`, `1 = partially relevant`, `0 = not relevant`) to support nDCG. Assessment owns curriculum-scope correctness here (P12).

> **Q2 resolution — golden seed stratification (assessment-owned).** The seed is **stratified by grade band** (6-8 / 9-10 / 11-12), with **≥2 items per (band × core-subject × query_type)** where the cell exists, and **every (band × subject) cell carries ≥1 `multi_hop` item**. This yields ≈28-32 seed items. Core subjects per band track the CBSE structure: grades 6-10 use `math`, `science`, `social_studies`, `english`; **grades 11-12 substitute `physics` for combined `science` and a humanities subject (e.g. `history`) for `social_studies`, since the combined `science`/`social_studies` codes do not exist at the senior-secondary level.** Assessment authors the exact per-cell item list at the seeding task (plan Task 9), verified against the live corpus for chunk-id resolvability (Q1 corpus-parity condition).

**Tier 2 — trace-mined real queries.** Sample distinct queries from `grounded_ai_traces` (preferred — has `query_preview`, `grade`, `subject_code`, `chapter_number`, `retrieved_chunk_ids`, `top_similarity`) for **distribution realism** (real grade/subject/query-type mix, real query phrasing). These queries arrive **without trustworthy relevance labels** (the stored `retrieved_chunk_ids` are what the CURRENT system returned — using them as ground truth would make the harness score the system against itself). Tier-2 items therefore go through the relevance judge (Tier 3) to get labels.

**Tier 3 — LLM-judge relevance labeling + assessment spot-check.** For each (query, candidate chunk) pair that needs a label (all Tier-2 candidates; any Tier-1 chunk assessment wants double-checked), a **retrieval-specific relevance judge** assigns a graded label. Assessment spot-checks a sample (target: ≥20% of judge labels, 100% of any label the judge marks `2`/`0` with low rubric confidence) and can override. Overrides are recorded with provenance.

The relevance judge (NEW, modeled on `quality-eval.ts` machinery — Sonnet, temp 0, strict JSON, fenced-recovery parse, clamp, spot-checkable raw response — but a retrieval rubric, not the answer rubric):

```
System (P12-compliant, CBSE-scoped, age-context aware):
  "You are a relevance judge for an Indian CBSE (grades 6-12) NCERT retrieval system.
   Given STUDENT_QUERY (grade G, subject S) and a CANDIDATE_CHUNK from NCERT,
   rate how relevant the chunk is for answering the query, on this scale:
     2 = directly answers / is the primary source for the query
     1 = partially relevant / useful context but not the primary source
     0 = not relevant to the query
   Separately, set off_grade_scope = true if the chunk is topically about the
   query's subject but is OUT of scope for grade G (e.g. a Class-11 derivation
   served to a Class-8 query), and false otherwise. off_grade_scope is
   INDEPENDENT of relevance: a chunk can be relevance=2 but off_grade_scope=true
   (right topic, wrong grade band) — flag it rather than silently scoring it 0.
   Judge relevance to the query; use off_grade_scope to record grade-band
   misalignment separately from topical irrelevance.
   Output ONLY JSON:
     { \"relevance\": 0|1|2, \"off_grade_scope\": true|false, \"reason\": \"<one sentence>\" }"
```

> **A2 — `0`-label disambiguation.** The judge emits, alongside `relevance ∈ {2,1,0}`, an **optional `off_grade_scope: boolean`** so that "wrong grade band" is counted **separately** from "topically irrelevant". Without this, a `0` conflates two distinct failures: a chunk that is genuinely off-topic vs a chunk that is on-topic but off-syllabus for the grade. The metrics still consume `relevance` (off-grade chunks are NOT counted as relevant unless assessment overrides), but the `off_grade_scope` flag is recorded per label so B2 can see how much of the apparent irrelevance is grade-band leakage — a distinct tuning lever (scope filtering) from topical relevance (rerank quality). The flag is stored on each `relevant_chunks[]` entry that the judge labeled.

The judge prompt is itself a P12 artifact: age/grade-scoped, CBSE-locked, no PII (it sees only the query preview + chunk text, both already corpus/trace content). **Changing this judge prompt requires assessment review** (curriculum-scope + age-appropriateness), per the ai-engineer review triggers. **Q5 resolution:** the judge runs **OFFLINE** (only at golden-set build/refresh time, never on the student path), so the Sonnet model choice is NOT a production model-provider change and does NOT trip the CEO model-approval gate — confirmed; flagged for transparency only. The judge *prompt* remains a P12 artifact requiring assessment review on any change.

**On-disk format (versioned JSON fixture).** A single committed file `eval/rag/golden/ncert-golden-v1.json` (version in the filename AND a top-level `version` field). One JSON document, schema-validated in CI:

```jsonc
{
  "version": "v1",
  "created_at": "2026-06-13",
  "corpus_ref": { "source": "ncert_2025", "snapshot_note": "matches baseline_from_prod corpus as of <date>" },
  "judge": { "model": "claude-sonnet-4-20250514", "rubric_version": "rag-relevance-v1", "temperature": 0 },
  "items": [
    {
      "id": "g8-sci-light-refraction-001",
      "tier": "seed",                       // "seed" | "trace_mined"
      "query": "Why does light bend when it enters water?",
      "query_type": "conceptual",           // factual|conceptual|definition|multi_hop
      "grade": "8",                          // P5 string
      "subject": "science",                  // snake_case subject_code
      "chapter_number": 10,                  // nullable
      "relevant_chunks": [
        { "chunk_id": "<uuid>", "relevance": 2, "off_grade_scope": false, "label_source": "assessment" },
        { "chunk_id": "<uuid>", "relevance": 1, "off_grade_scope": false, "label_source": "judge", "judge_reason": "...", "spot_checked": true }
      ],
      "provenance": {                        // trace-mined items only; null for seed
        "trace_table": "grounded_ai_traces",
        "query_sha256": "<hex>",             // DEFAULT identity for mined query text (B3)
        "mined_at": "2026-06-13"
        // NOTE (A1): NO student_id / user_id / session_id is EVER projected into
        // the harness from the trace tables, let alone persisted here. See the
        // PII column-allowlist projection rule below.
      }
    }
  ]
}
```

Relevance labels are stored **inline per item** (the `relevant_chunks[]` array with graded `relevance`, the `off_grade_scope` flag, and `label_source` provenance). The fixture is the single source of truth; it is committed, reviewed by assessment, and versioned. **No student identifiers anywhere in the file** (P13): trace-mined items carry only `query_sha256` and — only where provably PII-free — an optional scrubbed query string (re-scrubbed per §7), never `student_id`, `user_id`, `session_id`, email, or phone.

> **B3 — `query_sha256`-only storage is the DEFAULT for trace-mined query text.** The shared text redactor `redactPIIInText()` (`supabase/functions/_shared/redact-pii.ts`) strips email + Indian-phone + Razorpay-ID patterns but **does NOT strip names** (documented intentional limitation — NCERT proper nouns like "Newton"/"Gandhi"/"Akbar" are curriculum and a name-regex would shred them). Because a free-form query *can* contain a student's name that the redactor will not catch, B1 **defaults to storing only `query_sha256` for any trace-mined query**, and stores a short query preview **only where the text is provably PII-free** (e.g. a manually assessment-reviewed seed query, or a trace preview that contains no proper-noun risk). `golden-schema.test.ts` enforces that no PII-shaped key (`student_id`/`user_id`/`session_id`/`email`/`phone`) appears anywhere in the fixture.

> **A1 — PII column-allowlist projection.** When the harness reads `grounded_ai_traces` or `retrieval_traces`, the SELECT must explicitly enumerate **only** the non-PII columns below — it must **never** pull `grounded_ai_traces.student_id`, `retrieval_traces.user_id`, or `retrieval_traces.session_id` into harness memory (no `SELECT *`).
>
> **Allowed columns from `grounded_ai_traces`:** `caller`, `grade`, `subject_code`, `chapter_number`, `query_hash`, `query_preview`, `retrieved_chunk_ids`, `top_similarity`, `chunk_count`, `grounded`, `confidence`, `created_at` (+ latency columns).
>
> **Allowed columns from `retrieval_traces`:** `caller`, `grade`, `subject`, `chapter_number`, `concept`, `query_text` (the ≤100-char REDACTED preview), `query_sha256`, `embedding_model`, `reranked`, `chunk_ids`, `match_count`, `latency_ms`, `created_at`.
>
> **Explicitly forbidden (never SELECTed):** `grounded_ai_traces.student_id`, `retrieval_traces.user_id`, `retrieval_traces.session_id`, and any future identifier column. The trace-mining tool builds its SELECT from this allowlist constant, and a unit test asserts the projection list contains none of the forbidden columns. This is the first line of defense; `redactPIIInText` + `query_sha256`-default (B3) + `scrub.ts` are the second.

### B1.4 — Metrics (pure functions, scale-aware)

All metrics are **pure functions** over `(ranked_chunk_ids: string[], golden: {chunk_id, relevance}[])` and a set of `k` values. **Default k ∈ {5, 10, 20}.** The harness drives `retrieve()` with `limit = max(k)` (= 20) and `candidateCount = 40`, then truncates the ranked list per-k for scoring. (See §3 for exact formulas.) Rank-based metrics are **scale-independent**, so the RRF-vs-cosine score-scale issue (Correction #3) does not corrupt them — that issue only affects the separately-reported raw-score distribution.

> **A4 — per-(grade-band × subject) breakdown on the GOLDEN-SET metrics.** The harness reports every golden-set metric (recall@k, nDCG@k, MRR, hit-rate@k, multi_hop full-coverage, groundedness-rate) **both** as an overall aggregate **and** sliced per **(grade-band × subject)** cell — grade bands `6-8 / 9-10 / 11-12` × `subject_code`. This is distinct from the §B1.6 production-telemetry rollups (which are real-traffic, label-free, and sliced by raw grade × subject): the §B1.4 breakdown is the *labeled* golden-set measurement per cell, so assessment + B2 can see exactly which (band, subject) cell is weak on a metric that depends on relevance labels (recall/nDCG/coverage), not just on a non-empty-retrieval proxy. A cell with too few items to be meaningful is reported with its item count so a noisy cell is not over-read.

> **A5 — `multi_hop` full-coverage metric.** For the subset of golden items with `query_type == "multi_hop"`, the harness reports an additional metric: **the fraction of multi_hop items where ALL required `relevance=2` chunks appear in `R[0:k]`** (default `k=10`). This is stricter than recall@k (which credits partial coverage) and than hit-rate (which credits a single hit): a multi_hop query like "compare arteries and veins" is only *fully answerable* if BOTH primary chunks are retrieved together, so partial recall is a silent failure for the multi_hop class. The metric is defined in §3.6 and is part of the verdict/gate and the A4 per-cell breakdown.

### B1.5 — Verdict / gate vs stored baseline

The harness emits BOTH a human-readable scored report (§4) AND a machine verdict `PASS | REGRESS`. Baseline is a committed file `eval/rag/baseline/ncert-baseline-v1.json` holding the metric values of the current production settings (RRF k=60, MMR λ=0.7, fetch-N=40, floor as observed) **plus the per-metric regress bands below**. Comparison rule (B2 must beat this):

> **A7 — per-metric regress bands (replaces the single 3%-relative band).** Each primary metric has its OWN band, chosen for that metric's noise profile and unit. A run **REGRESSES** if ANY primary metric crosses its band vs baseline:
>
> | Metric | Band | Type |
> |---|---|---|
> | `nDCG@10` | 2% | relative |
> | `recall@10` | 2% | relative |
> | `MRR` | 3% | relative |
> | `hit-rate@10` | 2pp | **absolute** (percentage points) |
> | `groundedness-rate` | 3pp | **absolute** (percentage points) |
>
> Rationale: nDCG/recall are the rank-quality metrics B2 most directly tunes, so they get the tighter 2%-relative band; MRR is noisier at the margin (single-rank flips move it a lot on a small set), so 3% relative. hit-rate and groundedness-rate are already-bounded *rates* in `[0,1]`, so a *percentage-point* band is the honest unit (a 2% *relative* move on a 0.5 hit-rate would be only 0.01 — too loose; 2pp absolute is the right floor). **All five bands are stored in `eval/rag/baseline/ncert-baseline-v1.json`, are assessment-reviewed, and are NEVER auto-refreshed.** The `multi_hop` full-coverage metric (§3.6) is reported and tracked per-cell but is NOT a primary gate metric in B1 (small per-band item counts make it too noisy to gate on yet) — it informs B2 rather than blocking it.

- **PASS otherwise.** A run that *improves* metrics PASSES and prints the deltas (B2 uses this to prove a tuning win).
- **Guard:** a verdict is only emitted when the run used the **full path** (live embeddings + rerank, i.e. `VOYAGE_API_KEY` present). A degraded (FTS-only) run prints metrics but emits `INCONCLUSIVE`, never `PASS`/`REGRESS` — you cannot gate a tuning decision on a degraded measurement.
- **Baseline refresh** is an explicit, reviewed action (re-run on current settings, commit the new baseline incl. its bands) — never automatic, so the gate cannot silently rebaseline a regression away. The bands themselves are assessment-reviewed on every change to the baseline file.

This mirrors A's pattern: "a cutover flag flip is blocked if quality is worse than baseline beyond tolerance" (MOL spec §A5). Here, **a B2 tuning change is blocked from merge if retrieval quality regresses beyond any per-metric band.**

> **Q3 resolution** is the A7 per-metric band table above (replaces the proposed single 3%-relative default). Assessment-reviewed; stored in the baseline JSON.

### B1.6 — Production telemetry baseline (read-only rollups)

Alongside the offline golden-set metrics, the harness computes **read-only rollups from `retrieval_traces`** (and `grounded_ai_traces` where richer) to establish a real-world baseline:
- **Hit-rate proxy:** fraction of traces with `chunk_count > 0` / non-empty `chunk_ids[]` (a non-empty retrieval is the production analog of hit-rate; we cannot compute true recall without labels).
- **Top-similarity distribution:** percentiles (p10/p50/p90) of `grounded_ai_traces.top_similarity` — **explicitly labeled as RRF-scale `[0, ~0.033]`**, not cosine (Correction #3), to avoid the exact misread that caused the 2026-05-10 confidence-threshold audit bug.
- **Rerank rate:** fraction of `retrieval_traces.reranked = true`.
- **Grounded rate:** fraction of `grounded_ai_traces.grounded = true` and `confidence` distribution.
- **Slicing:** all rollups sliced by grade × subject_code so weak (grade, subject) cells are visible — this is the real-world signal that tells B2 *where* to focus tuning.

These rollups are READ-ONLY aggregates over already-P13-scrubbed tables. They are written only to the on-disk report, never back to any DB.

### B1.7 — Determinism & noise control

Retrieval has two non-deterministic surfaces: the Voyage rerank API and the LLM relevance judge. B1 controls both:
- The relevance **labels are frozen in the committed fixture** (judged once, spot-checked, version-pinned). The judge does NOT run on every harness invocation — only when expanding/refreshing the golden set (a reviewed action). So metric runs are label-stable.
- The rerank API is genuinely stochastic at the margins. B1 absorbs this with the per-metric regress bands (§B1.5 / A7 — 2%-relative on nDCG/recall, 3%-relative on MRR, 2pp-absolute on hit-rate, 3pp-absolute on groundedness-rate) and reports metrics to 4 significant figures. (B2 may add an N-run averaging mode; out of scope for B1.)
- MMR (`applyMMR`) is documented-deterministic (tie-break by input order, no randomness — `mmr.ts:39-41`), so it adds no noise.

---

## Component / file map (what B1 creates — all NEW, all read-only of prod)

**Harness + metrics (ai-engineer):**
- `eval/rag/harness/run-eval.ts` *(new)* — orchestrator: loads golden fixture, constructs the real read-only Supabase client, calls `retrieve()` per item, scores, compares to baseline, writes report + verdict.
- `eval/rag/harness/metrics.ts` *(new)* — pure functions: `recallAtK`, `ndcgAtK`, `mrr`, `hitRateAtK`. Zero IO.
- `eval/rag/harness/telemetry-baseline.ts` *(new)* — read-only `retrieval_traces` / `grounded_ai_traces` rollups (§B1.6).
- `eval/rag/harness/relevance-judge.ts` *(new)* — retrieval-specific Sonnet relevance judge (machinery patterned on `quality-eval.ts`: Sonnet `claude-sonnet-4-20250514`, temp 0, strict JSON, fenced-recovery parse, clamp, spot-checkable raw response). Emits `{ relevance: 0|1|2, off_grade_scope: boolean, reason }` (A2). Used only during golden-set expansion, not on metric runs. **Reuses** `runGroundingCheck` (imported from grounded-answer) for the groundedness-rate metric.
- `eval/rag/harness/golden-schema.ts` *(new)* — TS types + a runtime validator for the fixture shape. Enforces: P5 grade-string (`"6"`..`"12"`); `query_type ∈ {factual, conceptual, definition, multi_hop}`; `relevance ∈ {0,1,2}`; optional `off_grade_scope: boolean`; **subject allowlist `{ math, science, social_studies, english, physics, chemistry, biology, history, geography, civics, economics }`** (the canonical snake_case `subject_code` set, A6 — `social_studies` NOT "social science"); every `relevant_chunk_id` a valid UUID; **no PII-shaped key** anywhere in the document (`student_id`/`user_id`/`session_id`/`email`/`phone`).
- `eval/rag/harness/trace-mining.ts` *(new)* — trace-mining tool: builds its `grounded_ai_traces`/`retrieval_traces` SELECT from the A1 **column-allowlist constant** (never `SELECT *`, never the forbidden identifier columns), applies `redactPIIInText` + `query_sha256`-default (B3), produces trace-mined golden candidates for the judge.
- `eval/rag/harness/scrub.ts` *(new)* — second-pass PII scrub for any trace-mined text (§7), reusing **`redactPIIInText()`** from `supabase/functions/_shared/redact-pii.ts` (the free-form text redactor: email + Indian phone + Razorpay ID — NOT the object-key `redactPII()`, and NOT the test file). Note its documented limitation: it does not strip names, which is why `query_sha256`-only is the storage default (B3).

**Fixtures (assessment-owned content, ai-engineer-owned schema):**
- `eval/rag/golden/ncert-golden-v1.json` *(new, versioned)* — the golden set.
- `eval/rag/baseline/ncert-baseline-v1.json` *(new, versioned)* — the metric baseline.

**Tests (testing):**
- `src/__tests__/eval/rag/metrics.test.ts` *(new, normal lane)* — pure-function unit tests for every metric (recall@k, nDCG@k with `2^rel−1` gain, MRR, hit-rate@k, multi_hop full-coverage@k) against hand-computed fixtures (no DB).
- `src/__tests__/eval/rag/golden-schema.test.ts` *(new, normal lane)* — fixture conforms to schema; every `relevant_chunk_id` is a valid UUID; every `grade` is a P5 string; every `subject` is in the canonical allowlist incl. `social_studies` (A6); no PII keys anywhere.
- `src/__tests__/eval/rag/trace-mining.test.ts` *(new, normal lane)* — asserts the SELECT projection list contains NONE of the forbidden identifier columns (A1) and that `redactPIIInText` + `query_sha256`-default are applied (B3), with a mocked client.
- `src/__tests__/eval/rag/relevance-judge.test.ts` *(new, normal lane)* — judge parse/clamp/`off_grade_scope` handling with a mocked LLM (no live model call).
- `src/__tests__/eval/rag/import-boundary.test.ts` *(new, normal lane)* — fails if any `src/app/**` file imports an `eval/rag/harness/**` module (B6 bundle-safety guard).
- **`src/__tests__/eval/rag/run-eval.integration.test.ts`** *(new, integration lane)* — the live-DB harness entry. Runs the golden set through real `retrieve()` and emits the verdict + per-cell report. **CI lane placement (B1):** a **new pattern `src/__tests__/eval/**`** is added to `INTEGRATION_TEST_PATTERNS` in `vitest.config.ts:11-14` (and the corresponding exclude at `:23-24`) so the existing `RUN_INTEGRATION_TESTS=1` glob catches it. This is a `vitest.config.ts` change requiring **architect review** in the review chain. (Rejected alternative: placing the file under `src/__tests__/migrations/**` to avoid the config change — chosen against for cleaner separation; the dedicated `eval` pattern keeps eval-harness integration tests legible and independently quarantinable.)

**Scripts / CI (architect + testing):**
- `package.json` already has an `eval:rag` script slot convention (and an `eval/` directory convention for other eval harnesses); B1 wires `eval:rag` (local) → runs `run-eval.ts`. CI invokes the integration test inside the `integration-tests` job that already has live-DB + `STAGING_SUPABASE_*` secrets, **plus the newly-added `VOYAGE_API_KEY` env** (B2, architect-reviewed `.github/workflows/ci.yml:372-375` change).
- No migration. B1 touches **zero** schema. (The only schema note: if a future phase wants the harness to WRITE eval traces, `grounded_ai_traces.caller`'s CHECK would need `rag-eval-harness` added — explicitly deferred to B5.)

**Nothing in the production path changes:** `retrieve.ts`, `mmr.ts`, `match_rag_chunks_ncert`, `grounded-answer/*`, `ncert-retriever.ts`, `rag-source-weights.ts` are all READ/IMPORTED, never edited.

---

## Metrics — exact definitions (§3)

For a single query, let `R = [c1, c2, ...]` be the ranked chunk_ids returned by `retrieve()`, and let `rel(c)` be the golden graded relevance (`0|1|2`, default 0 for unlabeled). Let `G = { c : rel(c) >= 1 }` be the relevant set.

- **§3.1 Recall@k** = `|{ c ∈ R[0:k] : rel(c) >= 1 }| / |G|`. (If `|G| = 0`, the item is excluded from the recall aggregate and flagged — a query with no labeled relevant chunk cannot measure recall.) Aggregate = mean over items.
- **§3.2 nDCG@k** = `DCG@k / IDCG@k`, where `DCG@k = Σ_{i=1..k} (2^{rel(R[i])} − 1) / log2(i + 1)` and `IDCG@k` is `DCG@k` over the ideal ordering (golden chunks sorted by `rel` desc). Graded relevance is why we collect `2/1/0`, not binary. Aggregate = mean.
- **§3.3 MRR** = mean over items of `1 / rank_of_first_relevant`, where the first relevant is the first `c ∈ R` with `rel(c) >= 1`; contributes 0 if none in `R[0:max k]`.
- **§3.4 Hit-rate@k** = fraction of items with `≥1` relevant chunk in `R[0:k]` (binary per-item; `recall@k > 0`). The production-telemetry analog (§B1.6) is the non-empty-retrieval rate.
- **§3.5 Groundedness-rate** (reuses `runGroundingCheck`) = for the subset of items where the harness also generates a candidate answer from the retrieved chunks, the fraction where `runGroundingCheck` returns `verdict: 'pass'`. This measures "do the retrieved chunks actually support a grounded answer," closing the loop between retrieval quality and the downstream P12 grounding guarantee. Optional per-run (cost: one Haiku call per scored item); on by default for the seed tier, off for large trace-mined batches. (**Q4 note — ops:** groundedness-rate-on-seed is ≈one Haiku call per seed item per gated run, ≈28-32 Haiku calls; negligible spend, but the flag exists to disable it for large trace-mined batches. This is the only residual cost knob and is an ops monitoring note, not a design blocker.)
- **§3.6 multi_hop full-coverage@k** (A5) = over the subset `M = { items where query_type == "multi_hop" }`, the fraction of items where **every** golden chunk with `rel == 2` (the *required-primary* set `P = { c : rel(c) == 2 }`) appears in `R[0:k]`: `coverage(item) = 1 if P ⊆ R[0:k] else 0`; metric = `mean over M of coverage(item)` (default `k = 10`). If an item has no `rel==2` chunk it is excluded from `M` and flagged (a multi_hop item with no required-primary set is mis-authored). This is strictly harder than recall@k (partial coverage credited) and hit-rate@k (single hit credited). Reported overall and per A4 cell; tracked but NOT a primary gate metric in B1 (§B1.5).

All formulas are scale-independent of the RRF score (they consume RANK, not score), so Correction #3 does not affect them. The raw RRF-score distribution is reported separately and labeled.

---

## Safety & invariants

- **P12 (AI safety):** the relevance-judge system prompt is CBSE-scoped, grade-aware, and age-context-aware (it judges relevance *within grade-G subject-S scope* and penalizes off-syllabus chunks). It is age-appropriate by construction (it only reads NCERT corpus text + scrubbed query previews). The groundedness-rate reuses the production `runGroundingCheck`, so the harness's view of "grounded" is identical to production's. **No unfiltered LLM output reaches a student — the harness has no student in the loop at all.**
- **P13 (no PII):** the golden fixture carries **no** student identifiers (no student_id/user_id/session_id/email/phone). Defense layers, in order: (1) **A1 column-allowlist projection** — the trace-mining SELECT never reads `grounded_ai_traces.student_id` / `retrieval_traces.user_id` / `retrieval_traces.session_id` into harness memory at all; (2) trace-mined queries are sourced from tables that are *already* P13-scrubbed at write (≤100/200-char preview, query_sha256); (3) the harness applies a **second** scrub pass via **`redactPIIInText()`** (`supabase/functions/_shared/redact-pii.ts` — free-form email + Indian-phone + Razorpay-ID redactor; documented NOT to strip names) before anything lands in the committed fixture; (4) **B3 default** — for trace-mined query text the fixture stores only `query_sha256` by default, with a short preview only where provably PII-free, precisely because `redactPIIInText` cannot strip a name embedded in a query; (5) `golden-schema.test.ts` asserts no PII-shaped keys exist in the fixture and `trace-mining.test.ts` asserts the projection omits every forbidden column. No PII is sent to Voyage (only the query) or to the judge (query preview + chunk text).
- **P8 / P9 (RLS / RBAC):** the harness reads `rag_content_chunks` (NCERT corpus, not student data) and the pre-scrubbed trace tables. It uses a **service-role** client — justified because it is a server-side, offline, batch, **read-only, zero-write** measurement script (the canonical `supabase-admin.ts` use case), never client code, never on a request hot path. It bypasses no student-data RLS in a way that exposes a student: the only student-adjacent reads are the already-scrubbed trace tables, re-scrubbed before persistence.
- **P5 (grade format):** every `grade` in the fixture is a string `"6"`..`"12"`; `golden-schema.test.ts` enforces it; `retrieve()` validates it at its own boundary anyway.
- **Zero production behavior change:** the harness imports and CALLS `retrieve()` and the RPC read-only; it edits none of them and writes no DB table. A harness run is indistinguishable from a normal authenticated read of the corpus, attributed as `caller: 'rag-eval-harness'`.

---

## Review chain (P14)

RAG/retrieval change → **ai-engineer** (implements harness + metrics + judge) must be reviewed by **assessment** (golden-set curriculum-scope correctness incl. the Q2 stratification, candidate-pool-independent seed labeling A3, relevance-label validation/spot-check, judge-prompt CBSE-scope + age-appropriateness + `off_grade_scope` semantics A2, the per-metric regress bands A7, the A4 per-cell breakdown, the A5 multi_hop coverage metric) and **testing** (metric pure-function tests, schema test, trace-mining projection test, import-boundary test, integration-lane wiring). **architect** reviews: the live-DB CI / service-role offline-script posture (P8/P9 justification, B6 least-privilege client + import-boundary guard); the **`vitest.config.ts` `INTEGRATION_TEST_PATTERNS` change** (B1 lane placement); the **`.github/workflows/ci.yml` `VOYAGE_API_KEY` env addition** (B2); and the seat-enforcement red-gate dependency (B5). **ops/architect** own the `VOYAGE_API_KEY` GitHub-secret provisioning (operational prerequisite, B2) and the seat-enforcement integration-lane quarantine (B5). No model/provider change (Voyage + Sonnet judge are existing, judge runs offline — Q5) → no CEO model-approval gate. No new CBSE subject → no CEO subject gate.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Trace-mined queries leak PII into the committed golden set | Source tables already scrubbed at write; second-pass `scrub.ts`; `golden-schema.test.ts` fails CI on any PII-shaped key; store `query_sha256` not raw text where any doubt exists |
| Golden labels are biased toward what the current system returns (scoring the system against itself) | Tier-2 trace queries get labels from the independent relevance judge, NOT from the stored `retrieved_chunk_ids`; assessment spot-checks ≥20% |
| Rerank-API non-determinism flaps the verdict | 3%-relative regress band; labels frozen in fixture; metrics to 4 sig-figs; N-run averaging deferred to B2 |
| RRF score misread as cosine (the 2026-05-10 audit bug class) | Rank-based metrics are scale-independent; the raw-score distribution is explicitly labeled RRF-scale `[0, ~0.033]` everywhere it appears |
| Live-DB / Voyage key absent in PR CI → harness can't run | Auto-detect: no live DB ⇒ run only pure-function metric tests and skip live scenarios (mirrors existing integration-exclusion); degraded (FTS-only) runs emit `INCONCLUSIVE`, never `PASS`/`REGRESS` |
| Corpus drift (re-ingest changes chunk ids) silently breaks golden labels | Fixture records `corpus_ref` + snapshot note; schema test verifies every `relevant_chunk_id` still resolves to an active `rag_content_chunks.id` in the live-DB run; missing ids fail loudly, not silently |
| Floor inconsistency (0.4 RPC / 0.5 retrieve() / 0.005 legacy) skews "what we measure" | B1 records all three as observed baselines and surfaces the inconsistency in the report for B2 to resolve; B1 measures the `retrieve()` path (0.5) since that is the consolidated contract |
| Trace-mining accidentally pulls a `student_id`/`user_id`/`session_id` into harness memory | A1 column-allowlist: the SELECT is built from an explicit non-PII column constant (no `SELECT *`); `trace-mining.test.ts` fails on any forbidden column in the projection list |
| `redactPIIInText` does not strip a student name embedded in a free-form query | B3: store `query_sha256` only by default for trace-mined queries; previews only where provably PII-free; `golden-schema.test.ts` fails on any PII-shaped key |
| `VOYAGE_API_KEY` GitHub secret not yet provisioned → CI cannot gate the full path | NOT a code blocker: harness degrades to `INCONCLUSIVE`, CI stays green, B1 ships and measures pure-function + telemetry layers. Full-path CI gating unlocks once ops/architect provision the secret (B2 prerequisite, tracked in the plan's Prerequisites section) |
| The integration lane is RED on `main` (unrelated `seat-enforcement.test.ts`) | B5: B1's verdict goes to its OWN report artifact, so B1 measurement is unaffected. B2's tuning gate must read THAT artifact, not the umbrella `integration-tests` job exit code, until seat-enforcement is fixed/quarantined (ops/architect). Flagged as a B2 prerequisite, NOT a B1 blocker |
| `eval/**` harness imported into a shipped client bundle (leaks service-role client) | B6 import-boundary guard: `import-boundary.test.ts` fails if any `src/app/**` file imports an `eval/rag/harness/**` module |

## Resolved questions (closed in this revision — no longer open)

1. **Q1 — Eval DB provenance. RESOLVED:** the existing CI live-DB project (the `STAGING_SUPABASE_*` secrets that `ci.yml`'s `integration-tests` job maps to `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`); service-role client; reuse `hasSupabaseIntegrationEnv()` skip-guard + `makeServiceSupabase()`; **no dedicated clone in B1**. CONDITION: the golden set is authored against the same DB CI reads (or staging is verified as a same-source `ncert_2025` clone of prod) so every chunk UUID resolves. See §B1.2.
2. **Q2 — Golden seed size & coverage. RESOLVED:** grade-band stratification (6-8 / 9-10 / 11-12); ≥2 items per (band × core-subject × query_type) where the cell exists ≈ 28-32 seed items; every (band × subject) cell ≥1 `multi_hop`. Core subjects per band track CBSE structure; grades 11-12 substitute `physics` for combined `science` and a humanities subject (e.g. `history`) for `social_studies` (those combined codes don't exist at senior-secondary). See §B1.3 (Tier 1 / Q2 resolution).
3. **Q3 — Regress tolerance band. RESOLVED:** per-metric bands (A7) replace the single 3%-relative default — nDCG@10 = 2% rel, recall@10 = 2% rel, MRR = 3% rel, hit-rate@10 = 2pp absolute, groundedness-rate = 3pp absolute; all stored in the baseline JSON, assessment-reviewed, never auto-refreshed. See §B1.5.
4. **Q4 — Groundedness-rate default scope. OPS NOTE (not a blocker):** ON for the seed tier (≈28-32 Haiku calls/gated run — negligible spend), OFF for large trace-mined batches; the flag exists to disable it. Ops cost-monitoring note, not a design decision blocking plan-writing. See §3.5.
5. **Q5 — Judge model. RESOLVED:** offline Sonnet (`claude-sonnet-4-20250514`) confirmed; the judge runs only at golden-set build/refresh time and never on the student path, so it is **NOT** a production model-provider change and does **NOT** trip the CEO model-approval gate. The judge *prompt* is a P12 artifact — any change requires assessment review. See §B1.3.

**Residual decision needing CEO input:** none. (Q4 is an ops monitoring note, not a CEO gate; all MUST-FIX/SHOULD-FIX items are folded in.)

## Definition of done (B1)

- `eval/rag/golden/ncert-golden-v1.json` committed: ~28-32 assessment-curated seed items (Q2-stratified: 6-8 / 9-10 / 11-12 bands × core subjects × 4 query types, ≥2/cell, ≥1 multi_hop per band×subject, candidate-pool-independent labels A3) + trace-mined items, graded relevance labels with `off_grade_scope` flag (A2) and provenance, schema-valid (subject allowlist incl. `social_studies` A6, P5 grade strings, corpus-ref resolve check), PII-clean (A1 projection + B3 sha256-default + test-enforced).
- `eval/rag/baseline/ncert-baseline-v1.json` committed: recall@{5,10,20}, nDCG@{5,10,20}, MRR, hit-rate@{5,10,20}, multi_hop full-coverage@10, groundedness-rate on the current production settings (RRF k=60, λ=0.7, fetch-N=40, floor=0.5 via `retrieve()`) **plus the per-metric regress bands (A7)** stored inline.
- Metrics are pure functions with full Vitest unit coverage against hand-computed fixtures (incl. the A5 multi_hop full-coverage metric).
- The harness calls the REAL `retrieve()` + `match_rag_chunks_ncert` over a populated live DB, read-only, zero writes, reusing `hasSupabaseIntegrationEnv()` + `makeServiceSupabase()` (B4), and emits a scored report + per-metric `PASS | REGRESS | INCONCLUSIVE` verdict vs baseline, **with an A4 per-(grade-band × subject) breakdown**. The verdict lands in B1's OWN report artifact (independent of the umbrella integration-job exit code, B5).
- Production-telemetry rollups (`retrieval_traces` / `grounded_ai_traces`) produce a real-world baseline sliced by grade × subject, with RRF-scale labels, via the A1 column-allowlist projection.
- CI wiring: `src/__tests__/eval/**` added to `INTEGRATION_TEST_PATTERNS` (B1, architect-reviewed); `VOYAGE_API_KEY` added to the `integration-tests` job env (B2, architect-reviewed). Import-boundary test passes (B6).
- All P-invariants intact (P12 judge CBSE/age-scoped + offline Q5; P13 no PII — A1 projection + B3 sha256-default + `redactPIIInText` scrub; P8/P9 read-only least-privilege/service-role justified B6; P5 grade strings; zero production behavior change).
- B2 is unblocked: any RRF-k / MMR-λ / fetch-N / floor change can be run through the harness and gated against the committed baseline (reading B1's report artifact, not the seat-enforcement-blocked umbrella job, until that red gate is resolved — B5).
```
