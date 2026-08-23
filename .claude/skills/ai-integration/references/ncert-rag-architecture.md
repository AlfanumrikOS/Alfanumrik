# Reference: NCERT RAG Ingestion & Retrieval Architecture

Read this when the task touches NCERT ingestion, provenance, chunking, figures, hybrid retrieval, reranking, corpus versioning, or RAG architecture generally. Loaded from `ai-integration/SKILL.md`. For the 18-cell math/science **coverage audit and retrieval-tuning gate procedure**, this reference defers entirely to `rag-math-science-tuning` — do not duplicate its Q1-Q8 queries, phased tuning gates, or absolute rules here.

## Ingestion pipeline

`scripts/ncert-ingestion/CLAUDE.md` documents the pipeline stages (parse → chunk → embed → verify), the npm-script working-directory mismatch, and the paid-API cost warning. Read it before touching the ingestion pipeline rather than re-deriving its stages here.

## Preserve provenance at every layer

The ingestion pipeline must preserve, and any new ingestion path must not drop: source document identity, page/block/figure position within the source, the chunk's boundaries, and the surrounding context a chunk was drawn from. A chunk that can't be traced back to a specific source location is not usable for a cited answer (see the Foxy reference's citation requirement) and is not verifiable content QA.

## Hybrid retrieval: dense + sparse, fused

Retrieval is not dense-only. The live implementation (`supabase/functions/_shared/rag/retrieve.ts`) combines dense vector similarity with sparse/full-text matching via `match_rag_chunks_ncert`, fused with Reciprocal Rank Fusion (RRF, `k=60` — a SQL constant inside the RPC, not a tunable application parameter without a parameterized measurement RPC first). A new retrieval path must fuse both signals, not substitute a single-signal shortcut in the name of simplicity.

## Reranking

Retrieved candidates are reranked before being handed to generation (`rerank-2` per the live config — verify the exact model string against `supabase/functions/_shared/rag/retrieve.ts` before citing it elsewhere, since this is exactly the kind of detail that silently drifts). Do not skip reranking for a "faster" path without an explicit, measured tradeoff — the coverage/tuning skill has already documented a case where a soft/no-rerank mode was silently in use and produced a misleading measurement.

## Small-to-big context expansion

When a small, high-precision chunk is retrieved, the surrounding context (the chunk's parent block/section) should be available to expand into before generation, so an answer isn't forced to work from an artificially narrow slice. Preserve this expansion path in any retrieval change; do not flatten retrieval to "top-k small chunks only."

## Contextual chunk generation is an evaluated experiment, not a default

If a change proposes generating additional synthetic context around a chunk (e.g. an LLM-authored chunk summary to aid retrieval), treat it as an experiment requiring a measured evaluation-harness comparison against the current baseline — not something to ship by default because it sounds like it should help.

## Retrieval traces

Every retrieval call in a served answer should leave a trace of what was retrieved and why (which chunks, what fusion/rerank scores) so a later audit or an eval run can reconstruct the decision. See `supabase/functions/grounded-answer/` (directory-level reference only — see the hub skill's note on why) for where this trace is assembled today.

## Corpus-level blue/green versioning — required, currently missing

There is **no mechanism today** to version, promote, or roll back an entire corpus (a full re-ingestion or re-embedding pass) as a unit. What exists is chunk-level supersession (`rag_content_chunks.version` + `previous_chunk_id`, used when a single chunk is replaced) and a separate, unrelated model-routing shadow mechanism for LLM calls — neither is corpus-level blue/green. Do not describe corpus versioning as implemented. A re-ingestion or re-embedding effort should propose this mechanism explicitly rather than assume it exists.

## Measurable gates, not vibes

Retrieval quality claims must be backed by the eval harness (`eval/rag/harness/`, golden set in `eval/rag/golden/`, baseline in `eval/rag/baseline/`), reporting recall, correctness/faithfulness, and abstention-rate deltas against a documented baseline — never asserted from reading the prompt or a handful of manual examples. The exact current gate thresholds and per-cell coverage procedure belong to `rag-math-science-tuning`, not here; this reference only requires that *some* measured gate exists before a retrieval change is claimed to be an improvement.

## Do not import a generic RAG cookbook architecture

This is not a LangChain, LlamaIndex, Pinecone, or MongoDB-tutorial RAG stack, and none of those frameworks' conventions apply here. The retrieval RPC, the fusion constant, the rerank call, and the grounded-answer pipeline are Alfanumrik-specific, already implemented, and tracked in the files above — extend them, don't replace them with a generic pattern from an unrelated tutorial.

## What this reference does not own

The 18-cell coverage audit and tuning-gate workflow (`rag-math-science-tuning`), Foxy pedagogy/learner-state (`references/foxy-pedagogy-and-learner-state.md`), and provider gateway mechanics (the hub `SKILL.md`).
