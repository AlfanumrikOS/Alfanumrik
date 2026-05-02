// supabase/functions/grounded-answer/pipeline-stream.ts
// Streaming variant of the grounded-answer pipeline (Phase 1.1).
//
// Mirror of pipeline.ts:runPipeline up to the Claude call. From step 10 onward
// we stream Claude tokens to the caller via an AsyncGenerator instead of
// blocking for the full message. Trace-row writing happens AFTER the stream
// closes so tokens_used + answer_length reflect the final state.
//
// IMPORTANT — soft-mode-only:
//   The streaming path is currently used ONLY by foxy-tutor (caller='foxy',
//   mode='soft'). Strict-mode + grounding-check is NOT supported in streaming
//   today: the grounding-check requires the FULL accumulated answer before it
//   can rule on each citation, which would force us to buffer the whole
//   response before emitting (defeating the latency win). Strict-mode callers
//   (concept-engine, ncert-solver) continue to use the blocking runPipeline().
//
// Three event categories are yielded:
//   - { kind: 'metadata', ... }  — emitted exactly once, before any text. Lets
//                                  the route open the SSE stream with a payload
//                                  the UI can render immediately (citations,
//                                  groundingStatus, traceId).
//   - { kind: 'text', delta }    — emitted N times as Claude streams.
//   - { kind: 'done', ... }      — emitted exactly once at the end. Carries
//                                  totals (tokens_used, latency_ms,
//                                  groundedFromChunks, answerLength).
//   - { kind: 'abstain', ... }   — alternative terminal: emitted instead of
//                                  metadata+text+done when the pipeline
//                                  short-circuits before the Claude call
//                                  (chapter_not_ready, circuit_open, etc).
//   - { kind: 'error', ... }     — alternative terminal for upstream/Claude
//                                  failures DURING the stream.

import { checkCoverage } from './coverage.ts';
import { generateEmbedding } from './embedding.ts';
import { retrieveChunks, type RetrievedChunk } from './retrieval.ts';
import { rerankDocuments } from '../_shared/reranking.ts';
import { callClaudeStream } from './claude.ts';
import { extractCitations } from './citations.ts';
import { computeConfidence } from './confidence.ts';
import { loadTemplate, resolveTemplate, hashPrompt } from './prompts/index.ts';
import { FOXY_STRUCTURED_OUTPUT_PROMPT } from './structured-prompt.ts';
import {
  validateFoxyResponse,
  validateSubjectRules,
  wrapAsParagraph,
  type FoxyResponse,
} from './structured-schema.ts';
import { writeTrace, hashQuery, redactPreview, type TraceRow } from './trace.ts';
import {
  canProceed,
  circuitKey,
  recordFailure,
  recordSuccess,
} from './circuit.ts';
import {
  STRICT_MIN_SIMILARITY,
  SOFT_MIN_SIMILARITY,
} from './config.ts';
import { ensureSb, getSb } from './_sb.ts';
import type {
  AbstainReason,
  Caller,
  Citation,
  GroundedRequest,
  SuggestedAlternative,
} from './types.ts';

const VOYAGE_MODEL_ID = 'voyage-3';
const RERANK_INITIAL_FETCH = 30;

function rerankEnabled(): boolean {
  const raw = (Deno.env.get('FOXY_RERANK_ENABLED') ?? 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

function buildReferenceMaterialSection(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';
  const lines = chunks.map((c, i) => {
    const chapterBit = c.chapter_title
      ? `Chapter ${c.chapter_number}: ${c.chapter_title}`
      : `Chapter ${c.chapter_number}`;
    const pageBit = c.page_number ? `, p.${c.page_number}` : '';
    let entry = `[${i + 1}] (${chapterBit}${pageBit})\n${c.content}`;
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

// ─── Stream events ───────────────────────────────────────────────────────────

export type PipelineStreamEvent =
  | {
      kind: 'metadata';
      groundingStatus: 'grounded';
      citations: Citation[];
      traceId: string;
      // For analytics — confidence is computed before streaming starts since
      // it's grounded in retrieval + planned grounding ratio (1.0 in soft).
      confidence: number;
    }
  | { kind: 'text'; delta: string }
  | {
      kind: 'done';
      tokensUsed: number;
      latencyMs: number;
      groundedFromChunks: boolean;
      claudeModel: string;
      answerLength: number;
      /**
       * Foxy structured-response payload, parsed + validated AFTER the stream
       * closes. Mid-stream we cannot validate (the JSON is incomplete), so the
       * UI renders the raw `text` deltas in real time and SWAPS to the
       * structured renderer on `done`. On parse/validate failure this is the
       * `wrapAsParagraph(fullText)` fallback -- always defined when the caller
       * is 'foxy' and the stream completed successfully.
       */
      structured?: FoxyResponse;
    }
  | {
      kind: 'abstain';
      abstainReason: AbstainReason;
      suggestedAlternatives: SuggestedAlternative[];
      traceId: string;
      latencyMs: number;
    }
  | {
      kind: 'error';
      reason: string;
      traceId: string;
      latencyMs: number;
    };

// ─── Soft-mode escape detection (mirrors pipeline.ts) ────────────────────────

function answerStartsWithGeneralKnowledgeEscape(answer: string): boolean {
  if (!answer) return false;
  const stripped = answer.replace(/^[\s*_>\-]+/, '').toLowerCase();
  return (
    stripped.startsWith('from general cbse knowledge:') ||
    stripped.startsWith('general knowledge (not from ncert):')
  );
}

// ─── Trace helpers ───────────────────────────────────────────────────────────

interface StreamCtx {
  request: GroundedRequest;
  startedAt: number;
  queryHash: string;
  embedding?: number[] | null;
  chunks?: RetrievedChunk[];
  topSimilarity?: number | null;
  claudeModel?: string | null;
  promptHash?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  answerLength?: number;
  confidence?: number;
}

function baseTraceRow(ctx: StreamCtx): TraceRow {
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

// deno-lint-ignore no-explicit-any
async function writeAbstainTrace(sb: any, ctx: StreamCtx, reason: AbstainReason): Promise<string> {
  const row = baseTraceRow(ctx);
  row.grounded = false;
  row.abstain_reason = reason;
  return await writeTrace(sb, row);
}

// deno-lint-ignore no-explicit-any
async function writeGroundedTrace(sb: any, ctx: StreamCtx): Promise<string> {
  const row = baseTraceRow(ctx);
  row.grounded = true;
  return await writeTrace(sb, row);
}

// ─── Main streaming entry ────────────────────────────────────────────────────

/**
 * Run the streaming grounded-answer pipeline. Yields PipelineStreamEvent
 * values. NEVER throws — every error path yields an `abstain` or `error` event
 * and returns. The HTTP layer wraps this generator in a TransformStream
 * that serializes each event as an SSE frame.
 *
 * Streaming is currently soft-mode only. Strict-mode requests should not
 * reach this entry point — the route layer guards on `request.mode === 'soft'`.
 */
export async function* runStreamingPipeline(
  request: GroundedRequest,
  startedAt: number,
  anthropicKey: string,
  voyageKey: string,
): AsyncGenerator<PipelineStreamEvent, void, unknown> {
  ensureSb();
  const sb = getSb();
  const queryHash = await hashQuery(request.query);
  const ctx: StreamCtx = { request, startedAt, queryHash };

  // Step 1. Coverage precheck.
  //
  // Soft mode (Foxy chat) skips the precheck and falls through to retrieval —
  // mirrors pipeline.ts. The Phase 2.C Edit 2 prompt handles empty reference
  // material gracefully via the "general CBSE knowledge" fallback. Strict
  // mode (not used by streaming today, but kept symmetric) still gates on
  // coverage so the contract matches pipeline.ts exactly. Keep both
  // pipelines in sync.
  if (request.mode === 'strict') {
    const coverage = await checkCoverage(sb, {
      grade: request.scope.grade,
      subject_code: request.scope.subject_code,
      chapter_number: request.scope.chapter_number,
    });
    if (!coverage.ready) {
      const traceId = await writeAbstainTrace(sb, ctx, 'chapter_not_ready');
      yield {
        kind: 'abstain',
        abstainReason: 'chapter_not_ready',
        suggestedAlternatives: coverage.alternatives,
        traceId,
        latencyMs: Date.now() - startedAt,
      };
      return;
    }
  }

  // Step 4. Effective threshold (soft mode only — mirror pipeline.ts).
  const minSimilarity =
    request.retrieval.min_similarity_override ??
    (request.mode === 'strict' ? STRICT_MIN_SIMILARITY : SOFT_MIN_SIMILARITY);

  // Step 4b. Circuit breaker.
  const cKey = circuitKey(
    request.caller,
    request.scope.subject_code,
    request.scope.grade,
  );
  if (!canProceed(cKey)) {
    const traceId = await writeAbstainTrace(sb, ctx, 'circuit_open');
    yield {
      kind: 'abstain',
      abstainReason: 'circuit_open',
      suggestedAlternatives: [],
      traceId,
      latencyMs: Date.now() - startedAt,
    };
    return;
  }

  // Step 5. Embedding.
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

  // Step 6. Retrieve chunks (with rerank).
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
    } else {
      chunks = rawChunks.slice(0, request.retrieval.match_count);
    }
  } else {
    chunks = rawChunks.slice(0, request.retrieval.match_count);
  }
  ctx.chunks = chunks;

  const topSim = chunks.length > 0 ? chunks[0].similarity : 0;
  const top3Avg =
    chunks.length > 0
      ? chunks.slice(0, 3).reduce((s, c) => s + c.similarity, 0) /
        Math.min(3, chunks.length)
      : 0;
  ctx.topSimilarity = chunks.length > 0 ? topSim : null;

  // Step 6b. scope_mismatch.
  if (scopeDrops > 0 && chunks.length === 0) {
    const traceId = await writeAbstainTrace(sb, ctx, 'scope_mismatch');
    yield {
      kind: 'abstain',
      abstainReason: 'scope_mismatch',
      suggestedAlternatives: [],
      traceId,
      latencyMs: Date.now() - startedAt,
    };
    return;
  }

  // Step 9. Build prompt (same merge logic as pipeline.ts).
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
  if (!vars.academic_goal_section) vars.academic_goal_section = '';
  if (!vars.cognitive_context_section) vars.cognitive_context_section = '';
  if (!vars.previous_session_context) vars.previous_session_context = '';
  if (!vars.coach_mode) vars.coach_mode = 'SOCRATIC';
  if (!vars.coach_mode_instruction) {
    vars.coach_mode_instruction =
      'Use Socratic scaffolding: ask, do not tell. Guide the student to the answer.';
  }

  let systemPrompt = resolveTemplate(template, vars);

  // Foxy structured-output addendum (streaming). Mirrors pipeline.ts logic.
  // Mid-stream we cannot validate; the parse + validate step runs ONCE at
  // stream close and emits the result on the `done` event.
  const isFoxyStructured = request.caller === 'foxy';
  if (isFoxyStructured) {
    systemPrompt = `${systemPrompt}\n\n${FOXY_STRUCTURED_OUTPUT_PROMPT}`;
  }

  const promptHashStr = await hashPrompt(systemPrompt);
  ctx.promptHash = promptHashStr;

  // Compute confidence + citations BEFORE streaming starts so we can emit
  // them in the metadata event for the UI. Soft-mode confidence assumes
  // groundingPassRatio=1 (no grounding-check; soft path doesn't run it).
  const plannedConfidence = computeConfidence({
    topSimilarity: topSim,
    top3AverageSimilarity: top3Avg,
    chunksReturned: chunks.length,
    matchCountTarget: request.retrieval.match_count,
    groundingCheckPassRatio: 1,
  });
  ctx.confidence = plannedConfidence;

  // Pre-stream citations: indexed from chunk order. The actual extractCitations
  // pass on the final answer below will refine the list to only those
  // referenced by the LLM, but the metadata event needs SOMETHING the UI can
  // render immediately. We emit pre-stream citations and the client may
  // optionally update once `done` arrives (today the client just keeps
  // pre-stream citations — see route.ts comments).
  const preStreamCitations: Citation[] = chunks.map((c, i) => ({
    index: i + 1,
    chunk_id: c.id,
    chapter_number: c.chapter_number,
    chapter_title: c.chapter_title,
    page_number: c.page_number,
    similarity: c.similarity,
    excerpt: (c.content ?? '').trim().slice(0, 200),
    media_url: c.media_url,
  }));

  // Pre-stream trace write — we write the grounded row up front (with placeholder
  // tokens=0) so the UI's metadata event has a real trace_id. The `done` event
  // does NOT update the row (writeTrace is insert-only). This means
  // tokens_used/answer_length reflect the pre-stream state. If full accuracy is
  // needed for cost dashboards, refactor writeTrace to accept an UPDATE path —
  // tracked as Phase 2 enhancement.
  const traceId = await writeGroundedTrace(sb, ctx);

  // Emit metadata event NOW. The browser can render the grounded shell + the
  // first-citation badges before any tokens land.
  yield {
    kind: 'metadata',
    groundingStatus: 'grounded',
    citations: preStreamCitations,
    traceId,
    confidence: plannedConfidence,
  };

  // Step 10. Stream Claude.
  //
  // Boost max_tokens for Foxy structured output by ~25% (mirror pipeline.ts).
  // Without the boost, structured responses tend to truncate mid-block which
  // forces the close-event parser to fall back to wrapAsParagraph(fullText).
  const FOXY_STRUCTURED_TOKEN_MULTIPLIER = 1.25;
  const effectiveMaxTokens = isFoxyStructured
    ? Math.ceil(request.generation.max_tokens * FOXY_STRUCTURED_TOKEN_MULTIPLIER)
    : request.generation.max_tokens;

  const claudeStream = callClaudeStream({
    systemPrompt,
    userMessage: request.query,
    maxTokens: effectiveMaxTokens,
    temperature: request.generation.temperature,
    timeoutMs: request.timeout_ms,
    apiKey: anthropicKey,
    modelPreference: request.generation.model_preference,
  });

  let accumulated = '';
  let tokensUsed = 0;
  let claudeModel = '';
  let streamedOk = false;

  for await (const evt of claudeStream) {
    if (evt.type === 'text_delta') {
      accumulated += evt.delta;
      yield { kind: 'text', delta: evt.delta };
    } else if (evt.type === 'final') {
      if (evt.ok) {
        streamedOk = true;
        tokensUsed = evt.inputTokens + evt.outputTokens;
        claudeModel = evt.model;
        ctx.claudeModel = evt.model;
        ctx.inputTokens = evt.inputTokens;
        ctx.outputTokens = evt.outputTokens;
        recordSuccess(cKey);
      } else {
        if (evt.reason !== 'auth_error') recordFailure(cKey);
        // If we already streamed text we can't abstain — emit an error event
        // and let the client decide how to render the partial text.
        accumulated = evt.partialText || accumulated;
        yield {
          kind: 'error',
          reason: evt.reason,
          traceId,
          latencyMs: Date.now() - startedAt,
        };
        return;
      }
    }
  }

  if (!streamedOk) {
    yield {
      kind: 'error',
      reason: 'unknown',
      traceId,
      latencyMs: Date.now() - startedAt,
    };
    return;
  }

  // Compute groundedFromChunks on the FULL accumulated answer (Phase 0 contract).
  let groundedFromChunks: boolean;
  if (chunks.length === 0) {
    groundedFromChunks = false;
  } else if (request.mode === 'strict') {
    groundedFromChunks = true;
  } else {
    groundedFromChunks = !answerStartsWithGeneralKnowledgeEscape(accumulated);
  }

  // Citation extraction on final text (replaces pre-stream citations server-side
  // for analytics; the wire-shape kept the pre-stream list for the metadata
  // event already).
  void extractCitations(accumulated, chunks);

  ctx.answerLength = accumulated.length;

  // Parse + validate structured Foxy output ONCE at stream close. Mid-stream
  // we couldn't validate because the JSON was incomplete. On any failure we
  // emit a wrapAsParagraph(fullText) fallback so the client always receives
  // a usable FoxyResponse on the `done` event. The UI can choose to swap
  // from the raw text deltas it streamed to the structured renderer.
  let structured: FoxyResponse | undefined;
  if (isFoxyStructured) {
    structured = parseStreamingFoxy(accumulated);
  }

  yield {
    kind: 'done',
    tokensUsed,
    latencyMs: Date.now() - startedAt,
    groundedFromChunks,
    claudeModel,
    answerLength: accumulated.length,
    structured,
  };
}

/**
 * Streaming-path helper: parse + validate the accumulated text. Mirrors
 * `parseFoxyStructured` in pipeline.ts but without the subjectHint plumbing
 * (the streaming entry doesn't carry the same subject-mapping). On any
 * failure returns a wrapAsParagraph(rawText) fallback. Never throws.
 */
function parseStreamingFoxy(rawAnswer: string): FoxyResponse {
  let stripped = rawAnswer.trim();
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json|javascript|js)?\s*/i, '');
    stripped = stripped.replace(/```\s*$/i, '');
    stripped = stripped.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    console.warn(
      `foxy(stream): structured_parse_failed reason=json_parse err=${String(err).slice(0, 120)}`,
    );
    return wrapAsParagraph(rawAnswer);
  }

  const validation = validateFoxyResponse(parsed);
  if (!validation.ok) {
    console.warn(
      `foxy(stream): structured_parse_failed reason=schema detail="${validation.reason}"`,
    );
    return wrapAsParagraph(rawAnswer);
  }

  const subjectCheck = validateSubjectRules(validation.value);
  if (!subjectCheck.ok) {
    console.warn(
      `foxy(stream): structured_parse_failed reason=subject_rules detail="${subjectCheck.reason}"`,
    );
    return wrapAsParagraph(rawAnswer);
  }

  return validation.value;
}
