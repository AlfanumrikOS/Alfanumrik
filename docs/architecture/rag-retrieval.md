# RAG Retrieval Architecture

## Why this exists (audit F10, 2026-04-27)

Three RAG retrieval RPCs coexist in production with different parameter
shapes, different filter columns, and three TS client implementations.
Drift is high — a change to chunk schema or grade normalization had to be
replicated across 8+ files. One caller (foxy-tutor) had already diverged
to FTS-only and is being deprecated under finding F7.

This document defines the canonical retrieval contract. New callers MUST
use it. Existing callers will be migrated in two phases.

## The unified `retrieve()` interface

Single source of truth: `supabase/functions/_shared/rag/retrieve.ts`.

```ts
import { retrieve } from '../_shared/rag/retrieve.ts';

const result = await retrieve({
  query: 'what is refraction',
  grade: '10',          // P5: string "6"-"12"
  subject: 'science',   // snake_case subject_code
  chapterNumber: 7,     // optional INTEGER
  limit: 8,
  minSimilarity: 0.55,
  rerank: true,
  caller: 'grounded-answer',
  supabase,             // injected service-role client
});

result.chunks         // RetrievalChunk[] with chunk_id, similarity, content...
result.embedding_ms   // timing breakdown
result.retrieval_ms
result.rerank_ms
result.rpc_used       // 'match_rag_chunks_ncert' (default backend)
result.scope_drops    // defense-in-depth counter
result.error          // null on success; { phase, message } when degraded
```

**Default backend**: `match_rag_chunks_ncert` (the RRF k=60 hybrid RPC,
migration `20260428000000`).

**Validation**: P5 grade format enforced at the boundary. Throws
`RetrievalError` on programming bugs (invalid grade, missing client).
Retrieval-stage failures NEVER throw — they surface via `result.error`
with chunks=[].

## Migration status

| Caller | Status | RPC used | Owner |
|---|---|---|---|
| `grounded-answer/retrieval.ts` | Migrated | `match_rag_chunks_ncert` | done |
| `quiz-generator/index.ts` | Deferred (Phase 2) | `match_rag_chunks_v2` (falls through to legacy in prod) | ai-engineer |
| `ncert-solver/index.ts` | Deferred (Phase 2) | v2-via-shim (`_shared/rag-retrieval.ts`) | ai-engineer |
| `generate-answers/index.ts` | Deferred (Phase 2) | v2-via-shim | ai-engineer |
| `foxy-tutor/index.ts` | Frozen | `match_rag_chunks` (legacy, FTS-only) | mobile + ai-engineer (deletion under F7) |

### Why quiz-generator is deferred

The `_shared/retrieval.ts` adapter quiz-generator uses returns several
fields the unified module does not surface today (`concept_id`,
`diagram_id`, `syllabus_version`). Those fields are not consumed by
quiz-generator's quiz-question pipeline, but the quiz-generator unit tests
do not exercise the RAG path, so the migration would be untested. Phase 2
addresses this alongside the SQL consolidation.

### Why ncert-solver and generate-answers are deferred

Both call the legacy `fetchRAGContext()` shim in
`_shared/rag-retrieval.ts`, which returns a flat string (LLM-ready
context) — not the structured chunk array. Migrating them requires
either (a) reshaping their prompt builders to consume structured chunks
or (b) adding a `formatContextText()` adapter on top of `retrieve()`.
That work is out of scope for the F10 TS-layer consolidation pass.

## What Phase 1 ships

1. `supabase/functions/_shared/rag/retrieve.ts` — unified `retrieve()`
   interface with timing breakdown, scope verification, optional Voyage
   rerank-2.
2. `grounded-answer/retrieval.ts` — now an adapter that delegates to the
   unified module while preserving its public types and contract.
   Existing tests pass unchanged.
3. Deprecation comments on `_shared/retrieval.ts` and
   `_shared/rag-retrieval.ts` pointing new callers at the unified module.
4. Vitest contract tests: `src/__tests__/supabase/_shared/rag/rag-retrieve.test.ts`
   (validation, RPC contract, result shape, failure modes).

## Phase 2 plan (separate session)

1. Migrate quiz-generator to `retrieve()` with a local adapter mapping
   `RetrievalChunk` to its `QuestionRow` shape. Add Vitest coverage for
   the RAG question path before swapping the call site.
2. Migrate ncert-solver and generate-answers — either by adapting them
   to consume `RetrievalChunk[]` directly, or by adding a
   `retrieveAsContext()` helper in `_shared/rag/` that wraps `retrieve()`
   and returns the LLM-ready string.
3. Drop `match_rag_chunks_v2` (never applied to production — see
   migration `20260415000016` audit note) and the legacy
   `match_rag_chunks` once foxy-tutor (F7) is deleted.
4. Drop `_shared/retrieval.ts` and `_shared/rag-retrieval.ts` once their
   last caller is migrated.

## Rollback

Phase 1 changes are non-destructive:
- `_shared/rag/retrieve.ts` is a new module; deleting it has no effect on
  existing callers.
- `grounded-answer/retrieval.ts` keeps the same exported types and
  function signatures — restoring the pre-F10 implementation is a
  one-file revert.
- The deprecation comments do not change behavior.

If `match_rag_chunks_ncert` itself misbehaves, the rollback is to revert
the RRF migration (`20260428000000`) — that's an SQL-layer concern,
unrelated to this TS consolidation.
