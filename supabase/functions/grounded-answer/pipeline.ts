// supabase/functions/grounded-answer/pipeline.ts
// End-to-end orchestrator for the grounded-answer Edge Function.
//
// Extracted from index.ts (Q1 refactor) so index.ts is thin HTTP glue and
// this file owns the stage sequence. The HTTP handler in index.ts wraps
// runPipeline() in try/catch (C10 fix) and is the only caller.
//
// Observable behavior is IDENTICAL to the pre-extraction runPipeline. All
// trace-row construction is centralized in finalizeAbstain() and
// finalizeGrounded() so future regressions (forgetting to stamp claude_model
// or tokens in one abstain branch) are structurally prevented.
//
// Pipeline order (spec §6.4 steps 1-9):
//   1. Coverage precheck (chapter_not_ready → abstain)
//   2. Cache lookup (skip for retrieve_only)
//   3. Feature flag gate (ff_grounded_ai_enabled)
//   4. Effective thresholds (strict vs soft)
//   4b. Circuit breaker check
//   5. Voyage embedding (best effort; null OK)
//   6. Retrieve chunks (RPC + scope verify)
//   6b. scope_mismatch check (all chunks dropped for scope → distinguish
//       from "legitimately empty" no_chunks_retrieved) — C1 fix
//   7. retrieve_only branch → citations, no Claude
//   8. Claude call + grounding check + confidence + citations.

import { checkCoverage } from './coverage.ts';
import { buildAbstainResponse } from './abstain.ts';
import { generateEmbedding } from './embedding.ts';
import { retrieveChunks, type RetrievedChunk } from './retrieval.ts';
import { rerankDocuments } from '../_shared/reranking.ts';
import { applyMMR } from '../_shared/rag/mmr.ts';
import { sanitizeChunkForPrompt } from '../_shared/rag/sanitize.ts';
import { isMMRDiversityEnabled } from './_mmr-flag.ts';
import { callClaude } from './claude.ts';
import { runGroundingCheck } from './grounding-check.ts';
import { computeConfidence } from './confidence.ts';
import { extractCitations } from './citations.ts';
import {
  loadTemplate,
  resolveTemplate,
  hashPrompt,
} from './prompts/index.ts';
import { FOXY_STRUCTURED_OUTPUT_PROMPT } from './structured-prompt.ts';
import {
  validateFoxyResponse,
  validateSubjectRules,
  wrapAsParagraph,
  denormalizeFoxyResponse,
  type FoxyResponse,
  type FoxySubject,
} from './structured-schema.ts';
import {
  writeTrace,
  hashQuery,
  redactPreview,
  type TraceRow,
} from './trace.ts';
// redactPreview is reused for retrieval_traces.query_text below — keeps
// the privacy redaction (P13) consistent with grounded_ai_traces.
import {
  canProceed,
  circuitKey,
  recordFailure,
  recordSuccess,
} from './circuit.ts';
import { buildCacheKey, getFromCache, putInCache } from './cache.ts';
import {
  STRICT_MIN_SIMILARITY,
  SOFT_MIN_SIMILARITY,
  STRICT_CONFIDENCE_ABSTAIN_THRESHOLD,
} from './config.ts';
import { ensureSb, getSb } from './_sb.ts';
import type {
  AbstainReason,
  Caller,
  Citation,
  GroundedRequest,
  GroundedResponse,
} from './types.ts';

const VOYAGE_MODEL_ID = 'voyage-3';

// Phase 1.1: rerank stage. We over-fetch from match_rag_chunks_ncert and
// then call Voyage rerank-2 to pick the most relevant subset for the
// caller's match_count. Gated by FOXY_RERANK_ENABLED (default true). On
// rerank API failure we fall through with the original similarity-ranked
// top-N so the request never crashes — see rerankDocuments contract.
//
// Phase 2.B Win 1: bumped 30 → 40. Empirical: rerank quality plateaus
// around 35-50 candidates for educational text; 40 is the conservative
// midpoint. Voyage rerank-2 cost is roughly linear in candidate count, so
// 40 candidates costs ~$0.0001 more per call but gives the reranker a
// better selection set — measurable lift in NDCG@5 on the NCERT eval set.
const RERANK_INITIAL_FETCH = 40;

function rerankEnabled(): boolean {
  const raw = (Deno.env.get('FOXY_RERANK_ENABLED') ?? 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/**
 * Phase 1.3: write a per-query row to retrieval_traces. Best-effort,
 * non-blocking. Schema reference: migration
 * `20260403700000_ncert_voyage_retrieval_architecture.sql` lines 151-169.
 * If the table is absent in the deployed environment (migration not
 * applied) this is a no-op — we log a warn the first time and never
 * raise to the caller.
 */
async function writeRetrievalTrace(
  // deno-lint-ignore no-explicit-any
  sb: any,
  args: {
    request: GroundedRequest;
    chunks: RetrievedChunk[];
    reranked: boolean;
    abstain: boolean;
  },
): Promise<void> {
  try {
    const { request, chunks, reranked } = args;
    const chunkIds = chunks.map((c) => c.id);
    await sb.from('retrieval_traces').insert({
      user_id: null, // student_id in /api/foxy is the alfanumrik student row id, NOT auth.users.id; leave null to satisfy FK.
      session_id: null,
      caller: request.caller,
      grade: request.scope.grade,
      subject: request.scope.subject_code,
      chapter_number: request.scope.chapter_number,
      concept: null,
      content_type: null,
      syllabus_version: '2025-26',
      // P13: redact emails/phones/tokens out of the stored query — matches
      // the redactPreview policy used for grounded_ai_traces.
      query_text: redactPreview(request.query),
      embedding_model: 'voyage/voyage-3',
      reranked,
      chunk_ids: chunkIds,
      match_count: request.retrieval.match_count,
      latency_ms: null,
    });
  } catch (err) {
    // Non-fatal — never propagate. Most common failure is the table not
    // existing in this environment; that's logged once at warn level.
    console.warn(`retrieval_traces insert failed — ${String(err)}`);
  }
}

// ── Feature flag cache (60s TTL) ────────────────────────────────────────────
// ff_grounded_ai_enabled is the global kill switch. We check it on every
// request but memoize the answer for 60s so we don't hit the DB per-call.
interface FlagCache {
  value: boolean;
  expiresAt: number;
}
let ffCache: FlagCache | null = null;
const FF_CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
async function isServiceEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (ffCache && ffCache.expiresAt > now) return ffCache.value;

  try {
    const { data } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_grounded_ai_enabled')
      .single();
    const value = data?.is_enabled === true;
    ffCache = { value, expiresAt: now + FF_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`ff_grounded_ai_enabled lookup failed — ${String(err)}`);
    // Fail-closed: default to disabled if we can't read the flag.
    ffCache = { value: false, expiresAt: now + FF_CACHE_TTL_MS };
    return false;
  }
}

export function __resetFeatureFlagCacheForTests(): void {
  ffCache = null;
}

// ── Reference material formatting ────────────────────────────────────────────
// Design: keep this matching the Foxy legacy buildSystemPrompt layout so
// Claude's behavior is consistent when we cut over. 0 chunks → empty
// string (soft mode proceeds without references; template has placeholder
// anyway; trace row records chunk_count=0 for observability).
//
// Phase 2.B Win 4 (P12 hardening): every chunk's content is passed through
// sanitizeChunkForPrompt before injection so a malicious or buggy ingestion
// row containing a prompt-injection prefix ("Ignore previous instructions",
// "System:", "<|im_start|>", etc.) cannot jailbreak Foxy. Each chunk is
// also capped at 1500 chars — NCERT paragraphs are 200-800 chars typically,
// so the cap is conservative.
function buildReferenceMaterialSection(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';
  const lines = chunks.map((c, i) => {
    const chapterBit = c.chapter_title
      ? `Chapter ${c.chapter_number}: ${c.chapter_title}`
      : `Chapter ${c.chapter_number}`;
    const pageBit = c.page_number ? `, p.${c.page_number}` : '';
    const safeContent = sanitizeChunkForPrompt(c.content);
    let entry = `[${i + 1}] (${chapterBit}${pageBit})\n${safeContent}`;
    if (c.media_url) {
      const desc = c.media_description || `NCERT ${c.chapter_title || ''}`.trim();
      const pageSuffix = c.page_number
        ? ` - see attached figure from NCERT page ${c.page_number}`
        : '';
      entry += `\n[Diagram available: ${desc}${pageSuffix}]`;
    }
    return entry;
  });
  return `## NCERT Reference Material\n${lines.join('\n\n')}`;
}

function modeInstructionFor(mode: 'strict' | 'soft'): string {
  if (mode === 'strict') {
    return [
      'This response MUST be grounded in the Reference Material.',
      'If the material does not cover the question, reply with exactly: {{INSUFFICIENT_CONTEXT}}',
    ].join(' ');
  }
  return [
    'Prefer the Reference Material. If it does not cover the question,',
    'you may use general CBSE knowledge but must prefix with',
    '"General knowledge (not from NCERT):".',
  ].join(' ');
}

// ── Pipeline context ─────────────────────────────────────────────────────────
// Accumulated as the pipeline runs. Every field is optional at the start and
// gets populated as stages complete. The finalizeAbstain / finalizeGrounded
// helpers read from this single shape so we can't forget to stamp a field
// in one branch but not another.

interface PipelineCtx {
  request: GroundedRequest;
  startedAt: number;
  queryHash: string;
  embedding?: number[] | null;
  chunks?: RetrievedChunk[];
  topSimilarity?: number | null;
  claudeModel?: string | null;
  promptHash?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  answerLength?: number | null;
  confidence?: number | null;
}

function baseTraceRowFromCtx(ctx: PipelineCtx): TraceRow {
  const { request, startedAt, queryHash } = ctx;
  const embeddingModel =
    ctx.embedding !== undefined ? (ctx.embedding ? VOYAGE_MODEL_ID : null) : null;
  const chunkIds = ctx.chunks ? ctx.chunks.map((c) => c.id) : [];

  return {
    caller: request.caller as Caller,
    student_id: request.student_id,
    grade: request.scope.grade,
    subject_code: request.scope.subject_code,
    chapter_number: request.scope.chapter_number,
    query_hash: queryHash,
    query_preview: redactPreview(request.query),
    embedding_model: embeddingModel,
    retrieved_chunk_ids: chunkIds,
    top_similarity: ctx.topSimilarity ?? null,
    chunk_count: ctx.chunks ? ctx.chunks.length : 0,
    claude_model: ctx.claudeModel ?? null,
    prompt_template_id: request.generation.system_prompt_template,
    prompt_hash: ctx.promptHash ?? null,
    grounded: false,
    abstain_reason: null,
    confidence: ctx.confidence ?? null,
    answer_length: ctx.answerLength ?? null,
    input_tokens: ctx.inputTokens ?? null,
    output_tokens: ctx.outputTokens ?? null,
    latency_ms: Date.now() - startedAt,
    client_reported_issue_id: null,
  };
}

/**
 * Write an abstain trace row and return the HTTP-shaped abstain response.
 * Centralizes the 11 abstain return sites so each one only has to say
 * "which reason" and optionally "what alternatives". All other trace
 * fields flow from the accumulated PipelineCtx.
 */
async function finalizeAbstain(
  // deno-lint-ignore no-explicit-any
  sb: any,
  ctx: PipelineCtx,
  reason: AbstainReason,
  alternatives: Parameters<typeof buildAbstainResponse>[1] = [],
): Promise<GroundedResponse> {
  const traceRow = baseTraceRowFromCtx(ctx);
  traceRow.grounded = false;
  traceRow.abstain_reason = reason;
  const traceId = await writeTrace(sb, traceRow);
  return buildAbstainResponse(reason, alternatives, traceId, ctx.startedAt);
}

/**
 * Soft-mode "general knowledge" escape detection. The foxy_tutor_v1 prompt
 * (and the legacy modeInstructionFor 'soft' branch) both instruct Claude to
 * prefix any non-NCERT-grounded segment with one of these sentinel phrases:
 *
 *   - "From general CBSE knowledge:"   (foxy_tutor_v1 inline.ts L71)
 *   - "General knowledge (not from NCERT):"  (modeInstructionFor 'soft')
 *
 * If the FINAL answer starts with either prefix (case-insensitive, ignoring
 * leading whitespace and a small set of markdown emphasis chars), the answer
 * is NOT grounded in the retrieved chunks even though the pipeline returned
 * grounded:true at the API-shape level. Used by `groundedFromChunks` to give
 * analytics an honest signal about citation-backed vs. fallback answers.
 *
 * Conservative: matches only at the START of the answer. Mid-answer fallback
 * sentences (rare but possible) currently still register as grounded — Phase
 * 2.5 will tighten this when we add full grounding-check coverage to soft mode.
 */
function answerStartsWithGeneralKnowledgeEscape(answer: string): boolean {
  if (!answer) return false;
  // Strip leading whitespace and a small set of markdown emphasis chars
  // ("*", "_", ">", "-") so e.g. "**From general CBSE knowledge:** ..." or
  // "> General knowledge (not from NCERT): ..." still matches.
  const stripped = answer.replace(/^[\s*_>\-]+/, '').toLowerCase();
  return (
    stripped.startsWith('from general cbse knowledge:') ||
    stripped.startsWith('general knowledge (not from ncert):')
  );
}

/**
 * Compute whether the grounded:true response was actually produced from the
 * retrieved chunks. See the GroundedResponse.groundedFromChunks field doc
 * in types.ts for the exact contract.
 */
function computeGroundedFromChunks(args: {
  mode: 'strict' | 'soft';
  answer: string;
  chunkCount: number;
  retrieveOnly: boolean;
}): boolean {
  if (args.retrieveOnly) {
    // retrieve_only has no answer text — there is no claim to ground. We
    // mark this false so analytics doesn't double-count concept-engine
    // retrieval pings as student-facing grounded answers.
    return false;
  }
  if (args.chunkCount === 0) {
    // No chunks retrieved. Soft mode may still answer (from general CBSE
    // knowledge). Strict mode would have abstained earlier so this branch
    // is effectively soft-only — and is by definition NOT grounded in chunks.
    return false;
  }
  if (args.mode === 'strict') {
    // Strict mode reaches finalizeGrounded only after passing the grounding
    // check (see Step 12 in runPipeline). By construction, grounded in chunks.
    return true;
  }
  // Soft mode with chunks present: grounded UNLESS the answer opens with a
  // "general knowledge" escape prefix (Claude's signal that it fell back).
  return !answerStartsWithGeneralKnowledgeEscape(args.answer);
}

/**
 * Write the success trace row and return the grounded response. Only the
 * 2 success paths (retrieve_only with chunks, full grounded answer) call
 * this helper.
 */
async function finalizeGrounded(
  // deno-lint-ignore no-explicit-any
  sb: any,
  ctx: PipelineCtx,
  answer: string,
  citations: Citation[],
  confidence: number,
  claudeModelLabel: string,
  tokensUsed: number,
  structured?: FoxyResponse,
): Promise<GroundedResponse> {
  const traceRow = baseTraceRowFromCtx(ctx);
  traceRow.grounded = true;
  traceRow.confidence = confidence;
  traceRow.answer_length = answer.length;
  const traceId = await writeTrace(sb, traceRow);
  const groundedFromChunks = computeGroundedFromChunks({
    mode: ctx.request.mode,
    answer,
    chunkCount: ctx.chunks ? ctx.chunks.length : 0,
    retrieveOnly: ctx.request.retrieve_only === true,
  });
  const response: GroundedResponse = {
    grounded: true,
    answer,
    citations,
    confidence,
    groundedFromChunks,
    trace_id: traceId,
    meta: {
      claude_model: claudeModelLabel,
      tokens_used: tokensUsed,
      latency_ms: Date.now() - ctx.startedAt,
    },
  };
  if (structured) {
    response.structured = structured;
  }
  return response;
}

// ── Foxy structured output parsing ──────────────────────────────────────────
//
// For caller='foxy' Claude is instructed to emit a strict JSON object matching
// the FoxyResponseSchema (src/lib/foxy/schema.ts). We attempt JSON.parse and
// then run validateFoxyResponse + validateSubjectRules. Any failure path falls
// back to wrapAsParagraph(rawText) so the response is ALWAYS a usable
// FoxyResponse. The pipeline never throws on a bad LLM payload -- P12.
//
// Performance: JSON.parse + single-pass validator + 1x TextEncoder pass for
// byte cap. Measured at <2ms for 4 KB payloads on Deno Edge runtime.

/**
 * Strip a single layer of common JSON-formatting chrome the model sometimes
 * adds despite "JSON ONLY" instructions. Matches:
 *   - leading/trailing whitespace
 *   - ```json ... ``` markdown code fences (also bare ```)
 *
 * We do NOT attempt to extract JSON from arbitrary prose -- if the model
 * returned mixed prose+JSON, we let the parse fail and the wrapAsParagraph
 * fallback wins. That's the safer default than risking a partial parse.
 */
function stripCodeFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    // Drop opening fence (with optional language tag) and closing fence.
    s = s.replace(/^```(?:json|javascript|js)?\s*/i, '');
    s = s.replace(/```\s*$/i, '');
    s = s.trim();
  }
  return s;
}

interface ParsedStructured {
  structured: FoxyResponse;
  /** True when the model returned a valid structured payload. */
  ok: boolean;
  /** Why we fell back, when ok=false. Used for tracing. */
  reason?: string;
  /** Hint for analytics: subject rule warnings (when ok=true). */
  warnings?: string[];
}

/**
 * Parse + validate Claude's structured output for the Foxy caller. Always
 * returns a usable FoxyResponse: on failure, wraps the raw text as a
 * paragraph-only response. Logs (via console.warn) a redacted reason on
 * failure so misbehaving models surface in trace logs.
 */
function parseFoxyStructured(args: {
  rawAnswer: string;
  subjectHint?: FoxySubject;
}): ParsedStructured {
  const { rawAnswer, subjectHint } = args;
  const stripped = stripCodeFence(rawAnswer);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const preview = redactPreview(rawAnswer).slice(0, 200);
    console.warn(
      `foxy: structured_parse_failed reason=json_parse preview="${preview}" err=${String(err).slice(0, 120)}`,
    );
    return {
      structured: wrapAsParagraph(rawAnswer, { subject: subjectHint }),
      ok: false,
      reason: 'json_parse',
    };
  }

  const validation = validateFoxyResponse(parsed);
  if (!validation.ok) {
    const preview = redactPreview(rawAnswer).slice(0, 200);
    console.warn(
      `foxy: structured_parse_failed reason=schema preview="${preview}" detail="${validation.reason}"`,
    );
    return {
      structured: wrapAsParagraph(rawAnswer, { subject: subjectHint }),
      ok: false,
      reason: 'schema',
    };
  }

  const subjectCheck = validateSubjectRules(validation.value);
  if (!subjectCheck.ok) {
    const preview = redactPreview(rawAnswer).slice(0, 200);
    console.warn(
      `foxy: structured_parse_failed reason=subject_rules preview="${preview}" detail="${subjectCheck.reason}"`,
    );
    return {
      structured: wrapAsParagraph(rawAnswer, { subject: subjectHint }),
      ok: false,
      reason: 'subject_rules',
    };
  }

  return {
    structured: validation.value,
    ok: true,
    warnings: subjectCheck.warnings,
  };
}

/**
 * For caller='foxy' we boost max_tokens by ~25% to account for the JSON
 * overhead (keys, brackets, escaping). Otherwise the structured response
 * tends to truncate mid-block and fail JSON.parse. The boost is applied at
 * the Claude call site only -- the request contract still carries the
 * caller-supplied max_tokens for telemetry.
 */
const FOXY_STRUCTURED_TOKEN_MULTIPLIER = 1.25;

/**
 * retrieve_only citations: every chunk becomes a Citation (indexed 1..N)
 * since there is no answer text to scan for [N] references. The caller
 * (concept-engine) consumes these directly.
 */
function buildCitationsFromAllChunks(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    index: i + 1,
    chunk_id: c.id,
    chapter_number: c.chapter_number,
    chapter_title: c.chapter_title,
    page_number: c.page_number,
    similarity: c.similarity,
    excerpt: (c.content ?? '').trim().slice(0, 200),
    media_url: c.media_url,
  }));
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Run the full grounded-answer pipeline. Called by handleRequest. Never
 * throws on normal pipeline outcomes — every branch writes a trace row
 * and returns a GroundedResponse. The HTTP layer wraps this in try/catch
 * as a safety net for unexpected throws (e.g., missing prompt template).
 *
 * The Supabase client is read from the shared _sb.ts module; tests can
 * inject a stub via setSbForTests (re-exported from index.ts as
 * __setSupabaseClientForTests).
 */
export async function runPipeline(
  request: GroundedRequest,
  startedAt: number,
  anthropicKey: string,
  voyageKey: string,
): Promise<GroundedResponse> {
  ensureSb();
  const sb = getSb();
  const queryHash = await hashQuery(request.query);
  const ctx: PipelineCtx = { request, startedAt, queryHash };

  // Step 1. Coverage precheck (chapter_not_ready short-circuit).
  //
  // Soft mode (Foxy chat) skips the precheck and falls through to retrieval.
  // If no chunks come back, the Phase 2.C Edit 2 prompt handles the
  // "general CBSE knowledge" fallback gracefully — soft-mode users still
  // get a useful answer even when NCERT ingestion is incomplete for the
  // chapter (rag_status != 'ready').
  //
  // Strict mode (ncert-solver, quiz-generator-v2) keeps the precheck —
  // those callers MUST cite chunks and cannot answer without ready content.
  if (request.mode === 'strict') {
    const coverage = await checkCoverage(sb, {
      grade: request.scope.grade,
      subject_code: request.scope.subject_code,
      chapter_number: request.scope.chapter_number,
    });
    if (!coverage.ready) {
      return finalizeAbstain(sb, ctx, 'chapter_not_ready', coverage.alternatives);
    }
  }

  // Step 2. Cache lookup (spec §6.9). Only grounded:true responses live
  // in the cache; miss on retrieve_only (concept-engine wants fresh data).
  // Cache hits do not write a new trace row — see cache.ts comment.
  if (!request.retrieve_only) {
    const cacheKey = await buildCacheKey(request.query, request.scope, request.mode);
    const hit = getFromCache(cacheKey);
    if (hit && hit.grounded) {
      console.log('cache_hit', {
        caller: request.caller,
        grade: request.scope.grade,
        subject: request.scope.subject_code,
      });
      return hit;
    }
  }

  // Step 3. Global kill switch (ff_grounded_ai_enabled).
  if (!(await isServiceEnabled(sb))) {
    return finalizeAbstain(sb, ctx, 'upstream_error');
  }

  // Step 4. Effective thresholds.
  const minSimilarity =
    request.retrieval.min_similarity_override ??
    (request.mode === 'strict' ? STRICT_MIN_SIMILARITY : SOFT_MIN_SIMILARITY);

  // Step 4b. Circuit breaker check (spec §6.7). If the breaker is open for
  // this (caller, subject, grade) key, skip all upstream calls and abstain
  // immediately. Opens after 3 failures in 10s; half-opens after 30s.
  const cKey = circuitKey(
    request.caller,
    request.scope.subject_code,
    request.scope.grade,
  );
  if (!canProceed(cKey)) {
    return finalizeAbstain(sb, ctx, 'circuit_open');
  }

  // Step 5. Embedding (best effort). generateEmbedding returns null on
  // any failure — we still call recordFailure so repeated Voyage outages
  // eventually trip the breaker. A null embedding with a non-empty key
  // indicates upstream failure (distinguish from missing-key skip).
  const voyageWasReachable = voyageKey.length > 0;
  const embedding = await generateEmbedding(
    request.query,
    request.timeout_ms,
    voyageKey,
  );
  ctx.embedding = embedding;
  if (voyageWasReachable) {
    if (embedding == null) recordFailure(cKey);
    else recordSuccess(cKey);
  }

  // Step 6. Retrieve chunks.
  //
  // Phase 1.1: over-fetch (top-30 by default) and let the Voyage rerank-2
  // model pick the most relevant subset for the caller's requested
  // match_count (default top-5). Reranking is gated by FOXY_RERANK_ENABLED
  // (default true). If rerank is disabled or the API call fails,
  // rerankDocuments returns the original similarity order so we always
  // have a sensible result. The reranked flag is recorded on the per-query
  // retrieval trace below.
  const overFetchCount = rerankEnabled()
    ? Math.max(RERANK_INITIAL_FETCH, request.retrieval.match_count)
    : request.retrieval.match_count;

  const { chunks: rawChunks, scopeDrops } = await retrieveChunks(sb, {
    query: request.query,
    embedding,
    scope: request.scope,
    matchCount: overFetchCount,
    minSimilarity,
  });

  let chunks: RetrievedChunk[];
  let reranked = false;
  if (
    rerankEnabled() &&
    voyageKey.length > 0 &&
    rawChunks.length > request.retrieval.match_count
  ) {
    const rr = await rerankDocuments(
      {
        query: request.query,
        documents: rawChunks.map((c) => c.content),
      },
      request.retrieval.match_count,
    );
    if (rr.reranked) {
      chunks = rr.rankedIndices.map((i) => rawChunks[i]).filter(Boolean);
      reranked = true;
    } else {
      // Rerank API failed or skipped — fall back to similarity-ranked top-N.
      chunks = rawChunks.slice(0, request.retrieval.match_count);
    }
  } else {
    chunks = rawChunks.slice(0, request.retrieval.match_count);
  }

  // Phase 2.B Win 2: apply MMR diversity over the reranked top-N. Voyage
  // rerank picks the most-relevant chunks but in NCERT corpora consecutive
  // paragraphs frequently cover the same sub-concept — MMR (lambda=0.7)
  // mildly penalises redundancy so Foxy gets broader context. Gated by
  // ff_rag_mmr_diversity (default ON). Skipped when reranked=false (no
  // signal worth diversifying) or when chunks.length <= 1 (nothing to do).
  if (reranked && chunks.length > 1 && (await isMMRDiversityEnabled(sb))) {
    chunks = applyMMR(chunks, 0.7);
  }

  ctx.chunks = chunks;

  // Phase 1.3: per-query retrieval trace. Fire-and-forget — never block the
  // user response on this insert. Captures: caller, scope, top-K chunk_ids
  // and similarity scores, reranked flag, model, and (later) the abstain
  // outcome via grounded_ai_traces.abstain_reason. Privacy: query_text
  // here is the raw query (table is service-role gated; redacted preview
  // already lives in grounded_ai_traces). If the table doesn't exist (it
  // is created in a separate migration), the insert silently fails and
  // does not affect the user.
  void writeRetrievalTrace(sb, {
    request,
    chunks,
    reranked,
    abstain: false,
  });

  const topSim = chunks.length > 0 ? chunks[0].similarity : 0;
  const top3Avg =
    chunks.length > 0
      ? chunks.slice(0, 3).reduce((s, c) => s + c.similarity, 0) /
        Math.min(3, chunks.length)
      : 0;
  ctx.topSimilarity = chunks.length > 0 ? topSim : null;

  // Step 6b. scope_mismatch distinguishes "RPC silently returned wrong-scope
  // rows AND none survived the scope check" from "RPC legitimately had
  // nothing to return." If any chunk was dropped by the scope verifier AND
  // we have zero survivors, the retrieval layer caught an upstream bug —
  // surface it with a distinct abstain reason so alerts can fire. C1 fix.
  if (scopeDrops > 0 && chunks.length === 0) {
    return finalizeAbstain(sb, ctx, 'scope_mismatch');
  }

  // Step 7. retrieve_only branch: skip Claude + grounding check, just
  // return citations so the caller (concept-engine) can use them to
  // drive downstream retrieval logic. Spec §6.1 retrieve_only flag.
  //
  // Hardening invariants (Task 2.11):
  //   - No Claude call, no grounding check (no answer text to verify).
  //   - Scope verification still applies because retrieval.ts runs it
  //     unconditionally (chapter/grade/subject drops pre-filter chunks).
  //   - Citations carry full metadata (chunk_id, chapter, page, similarity,
  //     excerpt, media_url) — identical shape to the grounded-answer path.
  //   - Trace row: grounded=true, claude_model=null, prompt_template_id
  //     copied from request (even though no prompt was rendered), and
  //     groundingCheckPassRatio=1 in confidence.
  if (request.retrieve_only) {
    if (chunks.length === 0) {
      return finalizeAbstain(sb, ctx, 'no_chunks_retrieved');
    }
    // Retrieve-only: confidence uses grounding_pass_ratio=1 because no
    // check was run (we didn't generate an answer to check).
    const confidence = computeConfidence({
      topSimilarity: topSim,
      top3AverageSimilarity: top3Avg,
      chunksReturned: chunks.length,
      matchCountTarget: request.retrieval.match_count,
      groundingCheckPassRatio: 1,
    });
    const citations = buildCitationsFromAllChunks(chunks);
    ctx.confidence = confidence;
    ctx.answerLength = 0;
    return finalizeGrounded(sb, ctx, '', citations, confidence, '', 0);
  }

  // Step 8. Strict mode requires at least 3 chunks — fewer means we can't
  // confidently cite. Soft mode continues with what we have.
  if (request.mode === 'strict' && chunks.length < 3) {
    return finalizeAbstain(sb, ctx, 'no_chunks_retrieved');
  }

  // Step 9. Build prompt. Merge template_variables with service-computed
  // vars; service vars win on key collision so callers cannot override
  // reference_material_section with arbitrary text.
  const template = await loadTemplate(request.generation.system_prompt_template);
  const vars: Record<string, string> = {
    ...request.generation.template_variables,
    reference_material_section: buildReferenceMaterialSection(chunks),
    mode_instruction: modeInstructionFor(request.mode),
    mode_upper: request.mode.toUpperCase(),
    grade: request.scope.grade,
    subject: request.scope.subject_code,
    board: request.scope.board,
    chapter_suffix: request.scope.chapter_title
      ? `, Chapter: ${request.scope.chapter_title}`
      : '',
    chapter: request.scope.chapter_title ?? '',
  };
  // Only override caller-supplied academic_goal / cognitive_context sections
  // if they weren't already provided — callers that built those pass them in.
  if (!vars.academic_goal_section) vars.academic_goal_section = '';
  if (!vars.cognitive_context_section) vars.cognitive_context_section = '';
  // Task 1.3 cross-session memory: empty string when caller didn't pass it.
  if (!vars.previous_session_context) vars.previous_session_context = '';
  // Phase 2 misconception ontology: empty string when caller didn't pass it
  // (older clients, non-Foxy callers using foxy_tutor_v1, no observed
  // misconceptions). Same template-safe pattern as previous_session_context.
  if (!vars.misconception_section) vars.misconception_section = '';
  // Phase 2.2 coaching-mode placeholders. Safe defaults if the caller did
  // not pass them (e.g. older client or non-Foxy caller using foxy_tutor_v1).
  if (!vars.coach_mode) vars.coach_mode = 'SOCRATIC';
  if (!vars.coach_mode_instruction) {
    vars.coach_mode_instruction =
      'Use Socratic scaffolding: ask, do not tell. Guide the student to the answer.';
  }

  let systemPrompt = resolveTemplate(template, vars);

  // Foxy structured-output addendum. ONLY appended for caller='foxy' so
  // ncert-solver, quiz-generator, concept-engine, and diagnostic keep their
  // current text-only contract. The addendum mirrors
  // src/lib/foxy/schema.ts:FOXY_STRUCTURED_OUTPUT_PROMPT (Deno copy in
  // structured-prompt.ts; parity-tested from the Node side).
  const isFoxyStructured = request.caller === 'foxy';
  if (isFoxyStructured) {
    systemPrompt = `${systemPrompt}\n\n${FOXY_STRUCTURED_OUTPUT_PROMPT}`;
  }

  const promptHashStr = await hashPrompt(systemPrompt);
  ctx.promptHash = promptHashStr;

  // Step 10. Call Claude.
  //
  // For Foxy we boost max_tokens by ~25% to budget for JSON overhead (keys,
  // brackets, escaping). Without the boost, structured responses tend to
  // truncate mid-block and fail JSON.parse, which forces a wrapAsParagraph
  // fallback even when the model would have produced valid JSON given a few
  // more tokens. Other callers see no change.
  const effectiveMaxTokens = isFoxyStructured
    ? Math.ceil(request.generation.max_tokens * FOXY_STRUCTURED_TOKEN_MULTIPLIER)
    : request.generation.max_tokens;

  const claude = await callClaude({
    systemPrompt,
    userMessage: request.query,
    maxTokens: effectiveMaxTokens,
    temperature: request.generation.temperature,
    timeoutMs: request.timeout_ms,
    apiKey: anthropicKey,
    modelPreference: request.generation.model_preference,
  });
  // auth_error is a config problem, not an upstream outage — don't trip
  // the breaker on it (rotating keys would need admin intervention anyway).
  if (!claude.ok && claude.reason !== 'auth_error') {
    recordFailure(cKey);
  } else if (claude.ok) {
    recordSuccess(cKey);
  }

  if (!claude.ok) {
    if (claude.reason === 'auth_error') {
      console.error('claude: auth_error — check ANTHROPIC_API_KEY');
    }
    return finalizeAbstain(sb, ctx, 'upstream_error');
  }

  // Claude succeeded — stamp claude metadata into ctx for any downstream
  // abstain branch.
  ctx.claudeModel = claude.model;
  ctx.inputTokens = claude.inputTokens;
  ctx.outputTokens = claude.outputTokens;

  // Step 11. Claude explicitly said insufficient context. Do not serve the
  // sentinel to students — abstain cleanly with the proper reason.
  if (claude.insufficientContext) {
    return finalizeAbstain(sb, ctx, 'no_supporting_chunks');
  }

  // Step 12. Strict-mode grounding check.
  let groundingPassRatio = 1;
  if (request.mode === 'strict') {
    const verdict = await runGroundingCheck(
      claude.content,
      request.query,
      chunks.map((c) => ({ id: c.id, content: c.content })),
      anthropicKey,
      5_000,
    );
    if (verdict.verdict === 'fail') {
      return finalizeAbstain(sb, ctx, 'no_supporting_chunks');
    }
    groundingPassRatio = 1;
  }

  // Step 13. Confidence.
  const confidence = computeConfidence({
    topSimilarity: topSim,
    top3AverageSimilarity: top3Avg,
    chunksReturned: chunks.length,
    matchCountTarget: request.retrieval.match_count,
    groundingCheckPassRatio: groundingPassRatio,
  });
  ctx.confidence = confidence;

  if (request.mode === 'strict' && confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD) {
    return finalizeAbstain(sb, ctx, 'low_similarity');
  }

  // Step 14. Citations + structured parse + success.
  //
  // For Foxy: parse the model's JSON output, validate against the structured
  // schema, and produce a denormalized text equivalent for legacy storage in
  // foxy_chat_messages.content. On any parse/validate failure we fall back to
  // wrapAsParagraph(rawText) so `structured` is ALWAYS defined for Foxy. The
  // legacy `answer` field carries the denormalized text so non-structured
  // consumers (e.g. existing markdown renderers, server logs, exports) keep
  // working unchanged.
  //
  // For other callers: behavior is unchanged. `structured` is left undefined
  // and `answer` contains the raw markdown/text response.
  let answerForResponse = claude.content;
  let structuredForResponse: FoxyResponse | undefined;

  if (isFoxyStructured) {
    const subjectHint = mapSubjectCodeToFoxySubject(request.scope.subject_code);
    const parsed = parseFoxyStructured({
      rawAnswer: claude.content,
      subjectHint,
    });
    structuredForResponse = parsed.structured;
    // Denormalize the structured payload into a single string for legacy
    // storage. This is what foxy_chat_messages.content (TEXT) keeps. When
    // parse failed, `parsed.structured` is the wrapAsParagraph fallback so
    // the denormalized text is still safe to surface.
    answerForResponse = denormalizeFoxyResponse(parsed.structured);
  }

  const citations = extractCitations(claude.content, chunks);
  ctx.answerLength = answerForResponse.length;

  const response = await finalizeGrounded(
    sb,
    ctx,
    answerForResponse,
    citations,
    confidence,
    claude.model,
    claude.inputTokens + claude.outputTokens,
    structuredForResponse,
  );

  // Cache the grounded response. retrieve_only responses skip the cache
  // because concept-engine expects fresh retrieval on every call.
  if (response.grounded) {
    const cacheKey = await buildCacheKey(request.query, request.scope, request.mode);
    putInCache(cacheKey, response);
  }

  return response;
}

/**
 * Best-effort mapping from request.scope.subject_code (a free-form CBSE code
 * like "math", "science", "social_studies", "english") to the schema's
 * narrower FoxySubject enum. Used as a hint for wrapAsParagraph fallback so
 * the fallback response has a sensible subject. The model's emitted
 * `subject` field always wins on the happy path; this only matters when we
 * fall back to a paragraph wrap (which always produces subject='general' by
 * default; passing a hint just lets the renderer pick subject-aware styling
 * even on parse failure).
 */
function mapSubjectCodeToFoxySubject(code: string): FoxySubject | undefined {
  const normalized = (code ?? '').toLowerCase().trim();
  if (normalized.includes('math')) return 'math';
  if (normalized.includes('science') || normalized.includes('physics') || normalized.includes('chemistry') || normalized.includes('biology')) {
    return 'science';
  }
  if (normalized.includes('social') || normalized === 'sst' || normalized.includes('history') || normalized.includes('geography') || normalized.includes('civics') || normalized.includes('economics')) {
    return 'sst';
  }
  if (normalized.includes('english')) return 'english';
  return undefined;
}

/**
 * Best-effort trace write for catastrophic pipeline errors (C10 fix).
 * Called from handleRequest's try/catch when runPipeline throws — e.g.,
 * a registered prompt template file was deleted and loadTemplate blew up.
 *
 * Never throws. Returns a placeholder trace_id if the write itself fails
 * (or if the Supabase client was never initialized).
 */
export async function writeUpstreamErrorTrace(
  request: GroundedRequest,
  startedAt: number,
): Promise<string> {
  try {
    const sb = getSb();
    if (!sb) return 'pending';
    const queryHash = await hashQuery(request.query);
    const ctx: PipelineCtx = { request, startedAt, queryHash };
    const traceRow = baseTraceRowFromCtx(ctx);
    traceRow.grounded = false;
    traceRow.abstain_reason = 'upstream_error';
    return await writeTrace(sb, traceRow);
  } catch (err) {
    console.warn(`pipeline: panic-trace write failed — ${String(err)}`);
    return 'pending';
  }
}