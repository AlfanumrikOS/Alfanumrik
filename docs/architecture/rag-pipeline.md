# RAG Pipeline — Technical Specification for IP Filing

**Status**: Filed for IP examination, 2026-04-28
**Authoring scope**: Branch `docs/ip-filing-architecture`
**Source-of-truth**: This document cites only files committed to the Alfanumrik repository as of the filing date. Every concrete claim is annotated with `path:line`.

---

## 1. Abstract

The Alfanumrik RAG (Retrieval-Augmented Generation) pipeline retrieves curriculum-pinned NCERT (National Council of Educational Research and Training) text and figure chunks for grounded LLM responses to CBSE (Central Board of Secondary Education) student queries in grades 6 through 12. The pipeline is implemented as a nine-stage Deno Edge Function (`supabase/functions/grounded-answer/`) that runs server-side before any LLM invocation. CBSE-pinning is enforced at the SQL layer: every retrieval RPC pins `source = 'ncert_2025'` and the P5-grade-string contract (`grade_short ∈ {"6","7",...,"12"}`) so a chunk physically cannot leak from a different curriculum or grade band. The design is distinct from a default LangChain/Llama-Index RAG pipeline in three measurable ways: (a) hybrid retrieval uses Reciprocal Rank Fusion (RRF, k=60) over both vector and full-text rankings, then over-fetches to 40 candidates and applies a Voyage rerank-2 second pass before MMR diversification, (b) the pipeline has a **strict mode** that *abstains* with a categorized reason instead of guessing when grounding is insufficient, and (c) every defense layer (kill switch, circuit breaker, scope verifier, grounding check, prompt-injection sanitizer, P13 redaction) is observable via two structured trace tables (`grounded_ai_traces`, `retrieval_traces`) so retrieval quality can be audited per-query.

## 2. The 9-stage pipeline

The pipeline is implemented in `supabase/functions/grounded-answer/pipeline.ts`. The orchestrator function is `runPipeline()` at `pipeline.ts:429-760`. The stage sequence is:

| # | Stage | What it does | File:Line |
|---|------|-------------|-----------|
| 1 | **Coverage precheck** | Calls `checkCoverage()` to verify the (grade, subject, chapter) tuple has enough indexed chunks (`MIN_CHUNKS_FOR_READY = 50`, `MIN_QUESTIONS_FOR_READY = 40`); abstains with `chapter_not_ready` and a list of alternatives if not | `pipeline.ts:441-448`; thresholds `config.ts:4-5` |
| 2 | **Cache** | Looks up the request in a 5-minute in-memory LRU cache keyed by sha256(query ‖ scope ‖ mode); returns cached response only when `grounded:true` and not `retrieve_only` | `pipeline.ts:453-464`; cache `cache.ts:38-89`; TTL `config.ts:28` |
| 3 | **Kill switch** | Reads the `ff_grounded_ai_enabled` feature flag (60-second TTL cache, fail-closed on lookup error); abstains with `upstream_error` if disabled | `pipeline.ts:467-469`; flag eval `pipeline.ts:150-169` |
| 4 | **Effective thresholds & circuit breaker** | Resolves `min_similarity` (strict: 0.75, soft: 0.55) and checks the per-(caller, subject, grade) circuit breaker; abstains with `circuit_open` if tripped | `pipeline.ts:472-486`; thresholds `config.ts:7-8`; breaker `circuit.ts:135-154` |
| 5 | **Embedding** | Calls Voyage AI with model `voyage-3` (1024-dim) for query embedding; null-tolerant — pipeline continues with FTS-only retrieval if embedding fails; circuit breaker counters updated on failure/success | `pipeline.ts:493-502`; model id `pipeline.ts:72` |
| 6 | **Retrieval (hybrid RRF)** | Calls `match_rag_chunks_ncert()` SQL RPC with the embedding (or NULL) over-fetching `RERANK_INITIAL_FETCH = 40` candidates; the RPC applies Reciprocal Rank Fusion (k=60) over vector and FTS rankings, then narrows to `match_count` after rerank | `pipeline.ts:513-548`; over-fetch constant `pipeline.ts:85`; RPC `supabase/migrations/20260428000000_match_rag_chunks_ncert_rrf.sql:40-274` |
| 6b | **Scope verify** | Distinguishes "RPC silently returned wrong-scope rows AND none survived" (`scope_mismatch` abstain) from "legitimately empty" (`no_chunks_retrieved`) | `pipeline.ts:590-592` |
| 7 | **Rerank (Voyage rerank-2)** | Reranks the 40-candidate set down to `match_count` using Voyage rerank-2; on rerank API failure, falls through with similarity-ranked top-N | `pipeline.ts:527-548`; rerank API client `supabase/functions/_shared/reranking.ts` |
| 8 | **MMR diversity** | Applies Maximal Marginal Relevance (Carbonell & Goldstein 1998) with λ=0.7 and token-Jaccard inter-document similarity over the reranked top-N; gated by `ff_rag_mmr_diversity` (default ON); skipped when `reranked = false` or `chunks.length <= 1` | `pipeline.ts:551-558`; MMR impl `supabase/functions/_shared/rag/mmr.ts:111-167`; flag `_mmr-flag.ts:22-44` |
| 9a | **Grounding check (strict only)** | After Claude responds, runs `runGroundingCheck()` to verify the answer is anchored in the retrieved chunks; on `verdict = 'fail'`, abstains with `no_supporting_chunks` | `pipeline.ts:709-722` |
| 9b | **Confidence + abstain** | Computes confidence via the formula in §6.5 below; in strict mode, abstains with `low_similarity` if confidence `< STRICT_CONFIDENCE_ABSTAIN_THRESHOLD = 0.75` | `pipeline.ts:725-736`; threshold `config.ts:10`; formula `confidence.ts:26-38` |

There are 11 distinct abstain reasons, each rendered as a structured `GroundedResponse` payload by `buildAbstainResponse()` (file `abstain.ts`). Every stage that abstains writes a single trace row (Section 7) so retrieval quality can be audited per query without reconstructing the path from logs.

## 3. Hybrid retrieval design — RRF (k=60)

The NCERT-pinned RPC `match_rag_chunks_ncert()` was upgraded from a sequential vector → FTS → LIKE fall-through to a Reciprocal Rank Fusion combiner in migration `supabase/migrations/20260428000000_match_rag_chunks_ncert_rrf.sql`. The RPC has three paths:

- **PATH 1 — Hybrid (RRF)**, when an embedding is available (`migration:99-224`):
  - Two parallel candidate sets, each fetched up to `4 × match_count` (minimum 60) candidates: a vector candidate set ranked by `embedding <=> query_embedding` cosine distance (`migration:101-135`) and an FTS candidate set ranked by `ts_rank(search_vector, plainto_tsquery('english', query_text))` (`migration:136-170`).
  - Both candidate sets apply identical scope filters (`source = 'ncert_2025'`, `subject_code`, `grade_short`, optional `chapter_number`, `chapter_title`, `concept`, `content_type`, `quality_score >= 0.4`) so RRF cannot resurrect an out-of-scope chunk.
  - The RRF score is `1.0 / (60 + rank_vec) + 1.0 / (60 + rank_fts)` (`migration:191-194`). The constant `k = 60` is per Cormack, Clarke & Büttcher (2009) "Reciprocal rank fusion outperforms condorcet and individual rank learning methods" (declared at `migration:80`).
  - Output is sorted by `rrf_score DESC` and limited to `match_count`.

- **PATH 2 — FTS-only**, when no embedding is available or the hybrid path returned 0 rows (`migration:226-248`).

- **PATH 3 — LIKE keyword fallback**, last-resort branch when both vector and FTS produced 0 rows for a brand-new chapter that lacks a populated `search_vector` (`migration:250-272`). The `source = 'ncert_2025'` and quality-score floor are preserved on every branch as defense-in-depth against future ingestion bugs leaking non-NCERT chunks.

**Why k=60.** RRF gives a chunk credit when it ranks high in *either* list and big credit when it ranks high in *both*, without requiring a calibrated weight per (subject, grade) tuple. Cormack et al. show k=60 is the lowest-variance choice over a wide range of TREC retrieval tasks. A subject-specific weight tuner would need per-subject training data we do not have at the cold-start phase; RRF avoids that requirement entirely.

**Why over-fetch 4×.** With `match_count = 30` (the default when reranking is on), the RPC pulls up to 120 candidates per side. The PostgreSQL planner handles this fine on the existing IVFFlat embedding index (`supabase/migrations/20260427000000_rag_chunks_hnsw_index.sql`) and the GIN index over `search_vector`. The over-fetch is the input to the rerank stage (Section 4); a smaller candidate pool would reduce the rerank model's selection set and hurt NDCG@5.

## 4. Reranking strategy

The rerank stage is implemented in `supabase/functions/grounded-answer/pipeline.ts:506-548`.

- **Why over-fetch 40.** The `RERANK_INITIAL_FETCH` constant is set to 40 at `pipeline.ts:85`. The rationale is documented inline at `pipeline.ts:80-84`: rerank quality plateaus around 35-50 candidates for educational text; 40 is the conservative midpoint. Voyage rerank-2 cost is roughly linear in candidate count, so 40 candidates costs ~$0.0001 more per call but gives the reranker a better selection set — measurable lift in NDCG@5 on the NCERT eval set.
- **Why Voyage rerank-2.** Voyage's rerank-2 model has the strongest published performance on the BEIR retrieval benchmark for educational content as of the filing date and is significantly cheaper per call than a full LLM-based reranker. The fallback contract is robust: if the rerank API fails for any reason, `rerankDocuments` returns the original similarity-ranked top-N (`pipeline.ts:539-545`) so the pipeline never crashes on rerank failure.
- **Why MMR after.** Voyage rerank-2 picks the most-relevant chunks but in NCERT corpora, consecutive paragraphs (or near-duplicate Q&A rows) frequently cover the same sub-concept. When all top-K chunks are textually similar, Foxy gets redundant context. MMR (Maximal Marginal Relevance, Carbonell & Goldstein 1998) trades marginal relevance for marginal novelty. The MMR step is gated by `ff_rag_mmr_diversity` and skipped when `reranked = false` (no signal worth diversifying) or when `chunks.length <= 1` (nothing to do). Implementation at `supabase/functions/_shared/rag/mmr.ts:111-167`.
- **MMR similarity measure.** Token-Jaccard with case-folded, punctuation-stripped tokens of length ≥ 2 (`mmr.ts:64-72`). The choice of Jaccard over cosine on word-frequency vectors is documented at `mmr.ts:23-32`: empirical validation over a sample of 500 paragraphs showed Jaccard > 0.4 corresponded to human-judged "redundant" in 93% of cases, matching cosine performance at 5× the cost.
- **MMR weight.** λ = 0.7 in `pipeline.ts:557` favors relevance with mild diversification. λ → 1 = pure relevance (no diversification); λ → 0 = pure novelty.

## 5. Defense layers (P12 — AI Safety)

Foxy's grounding is defended by six independent layers. Each layer can fail independently without compromising the others.

### 5.1 Circuit breaker

Three-state state machine per (caller, subject_code, grade) key. Implementation at `supabase/functions/grounded-answer/circuit.ts:1-221`.

- Opens after `CIRCUIT_BREAKER_FAILURES_TO_TRIP = 3` failures in a sliding `CIRCUIT_BREAKER_WINDOW_MS = 10_000` window (`config.ts:15-16`).
- Holds open for `CIRCUIT_BREAKER_OPEN_MS = 30_000` ms, then half-opens for a single probe (`config.ts:17`).
- Two consecutive probe successes close the breaker; one probe failure reopens it for another 30s (`circuit.ts:198-216`, threshold `config.ts:18`).
- Memory-bounded: pruning runs inline on every `canProceed()` call; any CLOSED breaker idle longer than 10 minutes is pruned (`circuit.ts:64-74`); a hard cap of 1000 entries triggers oldest-`lastStateChange` LRU eviction (`circuit.ts:43-93`).

### 5.2 Scope verification

Every retrieved chunk is verified server-side after the SQL retrieval to confirm it matches the requested (grade, subject, chapter) scope. The check is implemented inside `retrieveChunks()` (file `retrieval.ts`) and surfaces a `scopeDrops` count to the pipeline. When `scopeDrops > 0` AND `chunks.length === 0`, the pipeline abstains with `scope_mismatch` (`pipeline.ts:590-592`) — a distinct abstain reason from "legitimately empty retrieval", so alerts can fire on the upstream-bug case.

### 5.3 Hard-abstain reasons

Eleven categorized abstain reasons emitted as the `abstain_reason` field of `GroundedResponse`:

| Reason | Stage | Citation |
|--------|-------|---------|
| `chapter_not_ready` | Coverage precheck | `pipeline.ts:447` |
| `upstream_error` | Kill switch / Claude auth or 5xx error | `pipeline.ts:468, 693` |
| `circuit_open` | Circuit breaker | `pipeline.ts:485` |
| `scope_mismatch` | Post-retrieval scope verify | `pipeline.ts:591` |
| `no_chunks_retrieved` | Empty retrieval (or strict mode <3 chunks) / retrieve_only with empty | `pipeline.ts:609, 629` |
| `no_supporting_chunks` | Claude returned `{{INSUFFICIENT_CONTEXT}}` sentinel OR strict-mode grounding-check fail | `pipeline.ts:705, 719` |
| `low_similarity` | Strict mode confidence below threshold | `pipeline.ts:735` |

Each is a structured response with optional `alternatives` so the caller (Foxy / NCERT-solver / quiz-generator) can render a graceful "we can't answer that yet, but here's a related chapter" UI rather than a generic error.

### 5.4 Prompt-injection sanitization

Implementation at `supabase/functions/_shared/rag/sanitize.ts:1-127`. The threat model is documented at `sanitize.ts:13-32`: untrusted ingestion (compromised CMS, malicious upload), buggy OCR producing artifacts that look like role tokens, and future user-generated content from the `scan-ocr` Edge Function.

The sanitizer:

- Strips a list of leading injection prefixes case-insensitively, repeatedly, until none match (`sanitize.ts:48-99`). Stripped prefixes include `system:`, `assistant:`, `human:`, `user:`, `<|im_start|>`/`<|im_end|>`, `[INST]`/`[/INST]`, and the classic jailbreak openers `ignore`, `disregard`, `forget`. Stacked attacks like `Ignore previous. System: ...` are fully neutered by the iterate-until-stable loop.
- Caps each chunk at `MAX_CHUNK_CHARS = 1500` (`sanitize.ts:41`). NCERT paragraphs are 200-800 characters typically, so this is a 33% safety margin over normal content while bounding pathological 50KB chunks that would blow the context window.
- Logs a warn line on sanitization (`sanitize.ts:107-118`) so ingestion can be audited.
- Bounded loop count (`for (let i = 0; i < 8; i++)` at `sanitize.ts:87`) defends against pathological regex backtracking on adversarial input.

The sanitizer is invoked unconditionally inside `buildReferenceMaterialSection()` at `supabase/functions/grounded-answer/pipeline.ts:194` — *every* chunk is sanitized before injection into the system prompt.

### 5.5 Grounding check (strict mode)

Strict mode runs an LLM-based grounding verifier after the main Claude call. Implementation at `pipeline.ts:709-722` using `runGroundingCheck()` with a 5-second timeout. On `verdict = 'fail'`, the pipeline abstains with `no_supporting_chunks` rather than serve a hallucinated answer. Strict mode also enforces a minimum-3-chunk floor at `pipeline.ts:628-630` — fewer chunks means we cannot confidently cite, so we abstain.

### 5.6 Insufficient-context sentinel

The `foxy_tutor_v1` and `ncert_solver_v1` prompts both instruct the LLM to reply with the literal string `{{INSUFFICIENT_CONTEXT}}` when the reference material does not cover the question (see `inline.ts:139-140` for `ncert_solver_v1`; the soft-mode equivalent for `foxy_tutor_v1` is the `From general CBSE knowledge:` prefix). The pipeline detects the sentinel and converts it to a structured `no_supporting_chunks` abstain at `pipeline.ts:704-706` — students never see the raw sentinel.

## 6. Cache policy

Implementation at `supabase/functions/grounded-answer/cache.ts:1-99`. The cache contract is binding:

- **Keying.** sha256(normalized query ‖ scope.grade ‖ scope.subject_code ‖ scope.chapter_number ‖ mode). Key construction at `cache.ts:38-56`. Mode and scope matter because the same query in strict vs. soft mode, or across grades, must NOT collide.
- **TTL.** `CACHE_TTL_MS = 5 × 60_000` ms = 5 minutes (`config.ts:28`). Expired entries are purged on access at `cache.ts:62-65`.
- **Capacity.** Max 500 entries with LRU eviction; on overflow, the least-recently-inserted key is dropped (`cache.ts:79-83`). The `Map` preserves insertion order, and we delete + re-insert on every touch (`cache.ts:67-69`), so "oldest key" = head of the iterator.
- **What gets cached.** Only `grounded:true` responses (`cache.ts:77`). Abstain responses are never cached because their reasons depend on live upstream state (e.g., circuit breaker is currently open).
- **What bypasses the cache.** The `retrieve_only` path (used by the concept engine) bypasses the cache entirely because that caller wants fresh retrieval on every call (`pipeline.ts:453`).
- **Trace policy.** Cache hits do NOT write a new trace row (`cache.ts:13-14`) — this avoids trace-table bloat from a popular question being re-asked. A `cache_hit` console log is emitted for observability (`pipeline.ts:457-461`).

## 7. Observability — `grounded_ai_traces` and `retrieval_traces`

Two structured trace tables capture every pipeline execution.

### 7.1 `grounded_ai_traces`

Written by `writeTrace()` at `supabase/functions/grounded-answer/trace.ts:52-69`. Every pipeline path (grounded or abstain) writes exactly one row. The row shape is the `TraceRow` interface at `trace.ts:18-41`:

| Field | Privacy class |
|------|--------------|
| `caller`, `student_id`, `grade`, `subject_code`, `chapter_number` | scope |
| `query_hash` (sha256 of normalized query) | hash, not recoverable |
| `query_preview` (first 200 chars, redacted) | P13-redacted (Section 7.3) |
| `embedding_model`, `claude_model`, `prompt_template_id`, `prompt_hash` | model audit |
| `retrieved_chunk_ids`, `top_similarity`, `chunk_count` | retrieval signals |
| `grounded`, `abstain_reason`, `confidence` | outcome |
| `answer_length`, `input_tokens`, `output_tokens`, `latency_ms` | cost & perf |

The single-row-per-pipeline-execution rule is structurally enforced via the `finalizeAbstain()` and `finalizeGrounded()` helpers at `pipeline.ts:281-397` — every abstain branch goes through `finalizeAbstain` and every grounded branch goes through `finalizeGrounded`, so a future regression cannot forget to stamp `claude_model` or `tokens` in some abstain branch.

### 7.2 `retrieval_traces`

Defined in `supabase/migrations/20260427000300_retrieval_traces_apply.sql:35-53`. RLS-enabled with three policies (`migration:62-93`): service-role full access for Edge Functions writing traces; users SELECT their own traces by `user_id = auth.uid()`; super-admin SELECT via the user_roles + roles RBAC join. Indexed by `created_at DESC`, by `(user_id, created_at DESC)` for per-student debugging, and by `(caller, grade, subject, created_at DESC)` for analytics.

Written best-effort by `writeRetrievalTrace()` at `supabase/functions/grounded-answer/pipeline.ts:100-137`. Failure to insert is non-fatal (`migration:14-18` documents that the table may be absent in some environments).

### 7.3 P13 redaction rules

The `redactPreview()` helper at `trace.ts:101-107` runs three regex replacements over the first 200 characters of the query:

| Pattern | Replacement | Citation |
|---------|------------|----------|
| Email addresses (`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`) | `[email]` | `trace.ts:90` |
| Phone numbers (10+ digits with optional separators and country code) | `[phone]` | `trace.ts:92` |
| Token-like strings (24+ chars of letters/digits/underscore/dash — catches API keys and JWTs) | `[token]` | `trace.ts:94` |

The same redactor is reused for `retrieval_traces.query_text` at `pipeline.ts:125`, keeping the redaction policy consistent across both trace tables. This is required by product invariant P13 (Data Privacy) — student-identifiable text must never reach the trace tables in plain form.

## 8. Grade-string invariant (P5)

Grades are strings `"6"` through `"12"` — never integers — across the entire pipeline. This is a non-negotiable platform invariant defined at `.claude/CLAUDE.md` P5.

In the RAG pipeline, the invariant is enforced at three layers:

1. **Database column type.** The `grade_short` column on `rag_content_chunks` is `TEXT`; the RPC parameter `p_grade` is `TEXT` (`supabase/migrations/20260428000000_match_rag_chunks_ncert_rrf.sql:42`).
2. **RPC normalization.** The RPC normalizes whatever shape it receives: bare digits pass through, `"Grade 7"` is stripped to `"7"` (`migration:84-88`).
3. **Edge Function types.** The TypeScript `GroundedRequest` type declares `scope.grade: string` (file `types.ts`). The cache key serializes grade as a string (`cache.ts:48`). The trace row stores grade as a string (`trace.ts:23`).

The reason this matters: grades 6-10 are mostly drawable from a single integer, but grade 11 and 12 split into "Science (PCM/PCB)", "Commerce", and "Humanities" streams that are not numerical. A future `"12-Science"` stream cannot be represented as an integer; the string contract is forward-compatible. P5 also avoids JavaScript's silent integer-to-string coercion bugs at JSON boundaries.

## 9. Why this is novel

### 9.1 Versus default LangChain RAG

Three technical differences:

1. **Scope pinning at the SQL layer.** A default LangChain RAG indexes mixed corpora and uses a similarity threshold to filter. Alfanumrik pins `source = 'ncert_2025'` AND `subject_code` AND `grade_short` AND optional chapter on every retrieval branch — vector, FTS, and LIKE — so a chunk *cannot* leak from a different curriculum, grade, or subject (`migration:127-128, 161-162, 263-264`). This is enforced at the SQL layer, not at the application layer where it could be bypassed by a client bug.
2. **Categorized abstain instead of fallback.** A default LangChain RAG returns either a top-k chunk list or an LLM-generated answer; if retrieval is empty, the LLM hallucinates from training data. Alfanumrik abstains with one of 11 named reasons (Section 5.3), each surfaced to the UI for graceful degradation. The strict-mode confidence threshold (`STRICT_CONFIDENCE_ABSTAIN_THRESHOLD = 0.75`) is a deliberate quality choice; competitors typically optimize for response rate.
3. **Defense-in-depth observability.** A default LangChain RAG logs at the application level if at all. Alfanumrik writes two structured trace rows per query (`grounded_ai_traces` for outcome + cost; `retrieval_traces` for per-query candidate set audit), with P13 redaction baked into the row writer (`trace.ts:101-107`). Retrieval quality regressions can be detected per-(caller, grade, subject) tuple from the trace tables alone.

### 9.2 Versus plain vector search

Three technical differences:

1. **Hybrid RRF retrieval.** Plain vector search misses keyword-anchored questions ("define refraction") because Voyage embeddings reward semantic neighbors over exact-term hits. The RRF combiner (Section 3) gives a chunk credit when it ranks high in the FTS list, the vector list, or both — without requiring a calibrated weight per (subject, grade).
2. **Voyage rerank-2 second pass.** Plain vector search returns the top-K by cosine distance, period. Alfanumrik over-fetches 40 candidates from RRF, then asks a purpose-built reranker (Voyage rerank-2) to choose the most relevant top-N. NDCG@5 lift is measurable on the NCERT eval set (`pipeline.ts:80-84`).
3. **MMR diversification.** Plain vector search will return three near-duplicate paragraphs from the same NCERT page if they are all close to the query. Alfanumrik applies MMR with λ=0.7 over the reranked top-N (`mmr.ts:111-167`) to trade marginal relevance for marginal novelty, giving Foxy broader context.

### 9.3 Versus standard RRF without rerank

Two technical differences:

1. **Two-stage retrieval-then-rerank vs. one-stage RRF.** A standard RRF pipeline returns the fused list directly. Alfanumrik treats the RRF output as a *candidate set* (40 candidates) and then applies a more expensive but more accurate Voyage rerank-2 pass to choose the top-N from that set. RRF alone optimizes for cheap rough fusion; the two-stage design pays a small per-call cost (~$0.0001) for a measurable NDCG@5 lift.
2. **MMR diversity as a third stage.** Standard RRF has no notion of inter-document similarity. Alfanumrik's MMR step (`mmr.ts:111-167`) explicitly penalizes redundant chunks via token-Jaccard similarity, ensuring Foxy's context window covers more sub-concepts of the chapter rather than three paraphrases of the same paragraph.

---

## Appendix A — Map of files referenced in this document

| Concept | File | Lines |
|---------|------|------|
| Pipeline orchestrator (9 stages) | `supabase/functions/grounded-answer/pipeline.ts` | 429-760 |
| Pipeline configuration constants | `supabase/functions/grounded-answer/config.ts` | 4-37 |
| RRF SQL RPC | `supabase/migrations/20260428000000_match_rag_chunks_ncert_rrf.sql` | 40-274 |
| Voyage rerank integration | `supabase/functions/_shared/reranking.ts` | (file) |
| MMR diversification | `supabase/functions/_shared/rag/mmr.ts` | 111-167 |
| Prompt-injection sanitizer | `supabase/functions/_shared/rag/sanitize.ts` | 1-127 |
| Cache layer | `supabase/functions/grounded-answer/cache.ts` | 1-99 |
| Circuit breaker | `supabase/functions/grounded-answer/circuit.ts` | 1-221 |
| Confidence formula | `supabase/functions/grounded-answer/confidence.ts` | 26-38 |
| Grounded-ai trace writer + redactor | `supabase/functions/grounded-answer/trace.ts` | 1-120 |
| Retrieval-traces table + RLS | `supabase/migrations/20260427000300_retrieval_traces_apply.sql` | 35-123 |
| HNSW index for embeddings | `supabase/migrations/20260427000000_rag_chunks_hnsw_index.sql` | (file) |

## Appendix B — Constants

| Constant | Value | File:Line |
|---------|------|-----------|
| `MIN_CHUNKS_FOR_READY` | 50 | `config.ts:4` |
| `MIN_QUESTIONS_FOR_READY` | 40 | `config.ts:5` |
| `RAG_MATCH_COUNT` | 5 | `config.ts:6` |
| `STRICT_MIN_SIMILARITY` | 0.75 | `config.ts:7` |
| `SOFT_MIN_SIMILARITY` | 0.55 | `config.ts:8` |
| `STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` | 0.75 | `config.ts:10` |
| `CIRCUIT_BREAKER_FAILURES_TO_TRIP` | 3 | `config.ts:15` |
| `CIRCUIT_BREAKER_WINDOW_MS` | 10_000 | `config.ts:16` |
| `CIRCUIT_BREAKER_OPEN_MS` | 30_000 | `config.ts:17` |
| `CIRCUIT_BREAKER_PROBE_SUCCESS_COUNT` | 2 | `config.ts:18` |
| `CACHE_TTL_MS` | 300_000 (5 min) | `config.ts:28` |
| `RERANK_INITIAL_FETCH` | 40 | `pipeline.ts:85` |
| MMR λ | 0.7 | `pipeline.ts:557` |
| MMR `MAX_CHUNK_CHARS` | 1500 | `sanitize.ts:41` |
| RRF `k` | 60 | `migration 20260428000000:80` |
| Voyage embedding model | `voyage-3` (1024-dim) | `pipeline.ts:72` |
