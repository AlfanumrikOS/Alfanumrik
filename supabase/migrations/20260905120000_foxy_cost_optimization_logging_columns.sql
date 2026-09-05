-- Foxy LLM cost optimization (Phase 1 measurement -> Phase 2 build).
--
-- Duplication-guard note: the brief for this work originally asked for two
-- new tables (`foxy_llm_usage`, `foxy_answer_cache`). Live inspection found
-- both concerns already implemented as `mol_request_logs` (per-call LLM
-- usage/cost log, populated since 2026-05-19) and `foxy_response_cache`
-- (a pre-built, unwired shared-answer cache table, 0 rows). This migration
-- extends those existing tables instead of forking a second implementation
-- of either concern.
--
-- mol_request_logs additions: the brief wanted rag_chunks/history_turns/host
-- alongside the columns that already exist (model, provider, prompt_tokens,
-- completion_tokens, cache_read_tokens, cache_write_tokens, usd_cost,
-- latency_ms). escalation_reason records why a call was routed to the
-- sonnet tier when that routing is added (Phase 2A), for observability.
--
-- foxy_response_cache: adding a pgvector embedding column so the existing
-- shared-answer cache (originally pattern/key-matched only) can also be
-- looked up by cosine similarity. This table has no student_id column by
-- original design -- it was already scoped to non-personalized, shareable
-- answers, which is why it's the correct extension point for a semantic
-- cache that must never leak one student's personalized context to
-- another (see cache_scope='shared' handling in apps/host's Foxy route and
-- the ncert-solver-only L3 durable cache in
-- supabase/functions/grounded-answer/cache-durable.ts).

alter table public.mol_request_logs
  add column if not exists rag_chunk_count smallint,
  add column if not exists history_turn_count smallint,
  add column if not exists host text,
  add column if not exists escalation_reason text;

comment on column public.mol_request_logs.rag_chunk_count is
  'Number of RAG chunks injected into the prompt for this call (null for non-RAG task types).';
comment on column public.mol_request_logs.history_turn_count is
  'Number of prior conversation turns included in this call''s context.';
comment on column public.mol_request_logs.host is
  'Compute host that made this call, e.g. vercel, supabase-edge. Informational only.';
comment on column public.mol_request_logs.escalation_reason is
  'Why this call was routed to a higher-tier model (e.g. sonnet) instead of the default tier. Null when no escalation occurred.';

alter table public.foxy_response_cache
  add column if not exists question_embedding vector(1024);

comment on column public.foxy_response_cache.question_embedding is
  'Voyage embedding (1024-dim, matching rag_content_chunks) of the normalized question, for cosine-similarity lookup. Null for rows written before this column existed or by callers that only use the pattern/key match.';

-- ivfflat index for cosine-distance lookups. Table starts empty; ivfflat
-- needs data to train well, but building it now is harmless (near-instant
-- on 0 rows) and avoids a second migration once rows exist. Re-run
-- `REINDEX` or rebuild with a chosen `lists` value once real row counts are
-- known, per this repo's pgvector index-health guidance.
create index if not exists foxy_response_cache_question_embedding_idx
  on public.foxy_response_cache
  using ivfflat (question_embedding vector_cosine_ops)
  with (lists = 100);
