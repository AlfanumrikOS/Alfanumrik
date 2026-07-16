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
import { sanitizeChunkForPrompt } from '../_shared/rag/sanitize.ts';
import { callClaude, callClaudeStream, type ClaudeResponse } from './claude.ts';
// C3 (MOL grounded-answer integration, 2026-05-18). Telemetry-only shadow
// log of streaming Claude calls. Default-OFF flag, fire-and-forget.
// TODO(c4-handoff): replace shadow log with a through-MOL routed streaming
// call when C4 ships — do NOT stack a shadow log on top of routed calls.
import {
  shadowLogClaudeCallIfEnabled,
  mapCallerToSurface,
  mapPipelineToTaskType,
} from './mol-telemetry-adapter.ts';
// C4.2a wire-up (2026-05-19): fire-and-forget OpenAI shadow on every
// streaming Claude invocation. See pipeline.ts for the full design rationale.
// Default-OFF feature flag means no production behavior change ships with
// C4.2a — the wire-up here is "armed" only.
// C4.2b-ii (2026-05-20): also import recordShadowTextFromStash so the
// streaming code can write the text-capture row AFTER the stream completes
// and the full baseline text is known. See mol-shadow.ts:STASH_TTL_MS.
import { fireShadowAndForget, recordShadowTextFromStash } from './mol-shadow.ts';
import { extractCitations } from './citations.ts';
import { computeConfidence } from './confidence.ts';
// Digital Twin + Knowledge Graph (Slice 1). Flag-gated cross-subject retrieval
// widening — mirrors pipeline.ts. Strict no-op when ff_digital_twin_v1 is OFF
// (default) or no transfer edge exists. See transfer-retrieval.ts.
import { isDigitalTwinEnabled } from './_twin-flag.ts';
import { retrieveTransferChunks, mergeTransferChunks } from './transfer-retrieval.ts';
import {
  loadTemplate,
  buildSystemPromptSegments,
  hashPrompt,
  type PromptSegment,
} from './prompts/index.ts';
import { FOXY_STRUCTURED_OUTPUT_PROMPT } from './structured-prompt.ts';
import {
  rescueFromTruncatedJson,
  validateFoxyResponse,
  validateSubjectRules,
  wrapAsParagraph,
  type FoxyResponse,
} from './structured-schema.ts';
import { writeTrace, hashQuery, redactPreview, type TraceRow } from './trace.ts';
// FOX-1 (P12): deterministic output content backstop (Deno twin of
// src/lib/ai/validation/output-screen.ts). Screens the COMPLETE buffered answer
// before the `done` frame is emitted so an unsafe answer becomes an `abstain`.
import { screenStudentFacingText } from './output-screen.ts';
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

// ── Feature flag cache (60s TTL, mirrors pipeline.ts isServiceEnabled) ───────
// ff_grounded_ai_enabled is the global kill switch. The streaming pipeline was
// previously missing this check (RCA-FIX CRITICAL-4). Operators now have a
// single flag that disables BOTH blocking and streaming AI response paths.
interface StreamFlagCache {
  value: boolean;
  expiresAt: number;
}
let _streamFfCache: StreamFlagCache | null = null;
const STREAM_FF_CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
async function isGroundedAiEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (_streamFfCache && _streamFfCache.expiresAt > now) return _streamFfCache.value;
  try {
    const { data } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_grounded_ai_enabled')
      .single();
    const value = data?.is_enabled === true;
    _streamFfCache = { value, expiresAt: now + STREAM_FF_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`ff_grounded_ai_enabled lookup failed (stream) — ${String(err)}`);
    // Fail-closed: if we can't read the flag, disable streaming AI responses.
    _streamFfCache = { value: false, expiresAt: now + STREAM_FF_CACHE_TTL_MS };
    return false;
  }
}

/**
 * Synthetic MOL request_id for the C4.2a shadow wire-up. Same contract as
 * the helper in pipeline.ts. NEVER reused; minted fresh per call.
 */
function newMolRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rerankEnabled(): boolean {
  const raw = (Deno.env.get('FOXY_RERANK_ENABLED') ?? 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

// Fix 2 (groundedness): Added clear START/END delimiters and per-chunk
// [Chapter: ...] labels — mirrors the updated pipeline.ts version.
function buildReferenceMaterialSection(chunks: RetrievedChunk[], grade?: string, subject?: string): string {
  if (chunks.length === 0) return '';
  const header = grade && subject
    ? `=== REFERENCE MATERIAL (NCERT Class ${grade} ${subject}) ===`
    : '=== REFERENCE MATERIAL (NCERT) ===';
  const lines = chunks.map((c, i) => {
    const chapterBit = c.chapter_title
      ? `Chapter ${c.chapter_number}: ${c.chapter_title}`
      : `Chapter ${c.chapter_number}`;
    const pageBit = c.page_number ? `, p.${c.page_number}` : '';
    // RCA-FIX CRITICAL-3 / P12 (2026-06-26): sanitize chunk content before
    // prompt injection — mirrors pipeline.ts. Strips injection prefixes and
    // caps at 1500 chars so a malicious or buggy NCERT chunk cannot jailbreak Foxy.
    let entry = `[${i + 1}]\n[Chapter: ${chapterBit}${pageBit}]\n${sanitizeChunkForPrompt(c.content)}`;
    if (c.media_url) {
      const desc = c.media_description || `NCERT ${c.chapter_title || ''}`.trim();
      const pageSuffix = c.page_number
        ? ` - see attached figure from NCERT page ${c.page_number}`
        : '';
      entry += `\n[Diagram available: ${desc}${pageSuffix}]`;
    }
    return entry;
  });
  return `${header}\n\n${lines.join('\n\n')}\n\n=== END REFERENCE MATERIAL ===`;
}

// Fix 1 (groundedness): When chunks are present in soft mode, instruct Claude
// to answer ONLY from those chunks — mirrors the updated pipeline.ts version.
function modeInstructionFor(mode: 'strict' | 'soft', hasChunks: boolean): string {
  if (mode === 'strict') {
    return [
      'This response MUST be grounded in the Reference Material.',
      'If the material does not cover the question, reply with exactly: {{INSUFFICIENT_CONTEXT}}',
    ].join(' ');
  }
  if (hasChunks) {
    return [
      'You MUST answer ONLY from the Reference Material provided above.',
      'Do NOT use your general training knowledge even if you know the answer.',
      'If the Reference Material does not contain sufficient information to answer,',
      'say exactly: "This topic is not covered in the reference material I have.',
      'Please refer to your NCERT textbook directly."',
    ].join(' ');
  }
  return [
    'The Reference Material is empty for this chapter.',
    'If the question IS in CBSE Grade scope: answer briefly using general CBSE knowledge,',
    'prefix with "From general CBSE knowledge:" (one-line).',
    'If the question is OUTSIDE scope: warmly redirect to an in-scope topic.',
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
    // Streaming traces are written pre-stream (line ~443) so we can include
    // trace_id in the metadata frame. We can derive grounded_from_chunks
    // upfront for two of the three cases — chunkCount=0 (always false) and
    // strict-mode-with-chunks (always true). For soft-mode-with-chunks the
    // value depends on whether Claude emits the general-knowledge escape
    // prefix, which we can't know until streaming completes. Until the
    // writeTrace helper grows an UPDATE-on-done path, those rows persist
    // as null and analytics treat null as "indeterminate". Audit 2026-05-10.
    grounded_from_chunks: null,
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
  // Set the upfront-derivable cases. Soft-mode-with-chunks stays null
  // because we don't have the answer text yet — see baseTraceRow comment.
  const chunkCount = ctx.chunks ? ctx.chunks.length : 0;
  if (chunkCount === 0) {
    row.grounded_from_chunks = false;
  } else if (ctx.request.mode === 'strict') {
    row.grounded_from_chunks = true;
  }
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
  openaiApiKey = '',
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

  // Step 3 (RCA-FIX CRITICAL-4, 2026-06-26): Global kill switch.
  // Mirrors pipeline.ts Step 3. The streaming pipeline previously skipped this
  // check — operators can now disable ALL AI responses (blocking + streaming)
  // via the ff_grounded_ai_enabled flag. Fail-closed: if the flag read fails
  // (DB unreachable), the pipeline abstains rather than calling Claude.
  if (!(await isGroundedAiEnabled(sb))) {
    const traceId = await writeAbstainTrace(sb, ctx, 'upstream_error');
    yield {
      kind: 'abstain',
      abstainReason: 'upstream_error',
      suggestedAlternatives: [],
      traceId,
      latencyMs: Date.now() - startedAt,
    };
    return;
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

  // Digital Twin Slice 1 (flag-gated, no-op when OFF): widen retrieval along
  // EXPLICIT concept_edges transfer edges into a DIFFERENT subject (same grade).
  // Soft-mode only. NEVER relaxes curriculum_guard / abstain — only ADDS curated
  // cross-subject chunks. No-op when the flag is OFF or no transfer edge exists.
  if (request.mode === 'soft' && (await isDigitalTwinEnabled(sb))) {
    const transferChunks = await retrieveTransferChunks(sb, {
      query: request.query,
      embedding,
      scope: request.scope,
      minSimilarity,
    });
    if (transferChunks.length > 0) {
      chunks = mergeTransferChunks(chunks, transferChunks);
    }
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
    reference_material_section: buildReferenceMaterialSection(
      chunks,
      request.scope.grade,
      request.scope.subject_code,
    ),
    mode_instruction: modeInstructionFor(request.mode, chunks.length > 0),
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
  // RC-2 / RC-3 fix (2026-06-26): These placeholders exist in foxy_tutor_v1.txt
  // but had no defaults set in the streaming path, causing literal "{{placeholder}}"
  // text to reach Claude. Also adds misconception_section which was present in
  // pipeline.ts but absent here.
  // mode_directive (line 24 of the template) is the top-level grounding
  // instruction paragraph — defaulted to mode_instruction so both template
  // references resolve correctly (mirrors pipeline.ts fix).
  if (!vars.misconception_section) vars.misconception_section = '';
  if (!vars.pending_expectation) vars.pending_expectation = '';
  if (!vars.learner_memory_section) vars.learner_memory_section = '';
  if (!vars.mode_directive) vars.mode_directive = vars.mode_instruction ?? '';
  if (!vars.next_topic) vars.next_topic = '';
  if (!vars.prereq) vars.prereq = '';

  // Response-cache v2 (design item 9): resolve the template as ordered
  // prompt-cache segments — mirrors pipeline.ts. The joined text is
  // byte-identical to the previous resolveTemplate(template, vars) output;
  // claude.ts re-verifies that invariant and falls back to the legacy
  // single block on any drift.
  let promptSegments: PromptSegment[] = buildSystemPromptSegments(template, vars);
  let systemPrompt = promptSegments.map((s) => s.text).join('');

  // Foxy structured-output addendum (streaming). Mirrors pipeline.ts logic.
  // Mid-stream we cannot validate; the parse + validate step runs ONCE at
  // stream close and emits the result on the `done` event. Appended to the
  // LAST segment too so segments stay byte-identical to systemPrompt.
  const isFoxyStructured = request.caller === 'foxy';
  if (isFoxyStructured) {
    const addendum = `\n\n${FOXY_STRUCTURED_OUTPUT_PROMPT}`;
    systemPrompt = `${systemPrompt}${addendum}`;
    if (promptSegments.length > 0) {
      const last = promptSegments[promptSegments.length - 1];
      promptSegments = [
        ...promptSegments.slice(0, -1),
        { text: `${last.text}${addendum}`, cacheControl: last.cacheControl },
      ];
    } else {
      promptSegments = [{ text: systemPrompt, cacheControl: true }];
    }
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
  // Boost max_tokens for Foxy structured output. Mirrors pipeline.ts.
  // Bumped from 1.25 → 1.6 in May 2026: the prior boost wasn't enough for
  // multi-question turns (students routinely send 1-3 questions in one
  // message). Truncation mid-block was the leading cause of the
  // wrapAsParagraph fallback firing and leaking raw JSON into the chat.
  const FOXY_STRUCTURED_TOKEN_MULTIPLIER = 1.6;
  const effectiveMaxTokens = isFoxyStructured
    ? Math.ceil(request.generation.max_tokens * FOXY_STRUCTURED_TOKEN_MULTIPLIER)
    : request.generation.max_tokens;

  // Fix 3 (groundedness): Cap temperature at 0.1 for soft-mode factual answers
  // when chunks are present — mirrors the blocking pipeline.ts fix.
  const effectiveTemperature = (request.mode === 'soft' && chunks.length > 0)
    ? Math.min(request.generation.temperature, 0.1)
    : request.generation.temperature;

  // C3: capture timing immediately before the stream starts. The shadow
  // log records latency from request start to the FINAL event (not first
  // token). That mirrors how mol_request_logs.latency_ms is interpreted
  // for non-streaming rows so dashboards compare apples-to-apples.
  const claudeStreamStart = Date.now();

  // C4.2a wire-up — fire OpenAI shadow BEFORE the stream is awaited so
  // the shadow runs in parallel with the Anthropic stream on the event
  // loop. The helper is fire-and-forget (returns void synchronously) so
  // the streaming UX is byte-identical to before — Claude tokens still
  // arrive on the same event loop tick they would have without the
  // shadow.
  //
  // Why we fire here (not after the `final` event like the C3 shadow log):
  //   - Parity with the blocking pipeline.ts wire-up: shadow leaves the
  //     same event-loop window as baseline.
  //   - We have the EXACT composed systemPrompt → prompt-parity.
  //   - We have the exact maxTokens/temperature → grader compares
  //     like-for-like resource budgets.
  //
  // baseline_model is heuristically resolved from model_preference because
  // the real model id is only known at the FINAL event, after the shadow
  // has already started. The grader doesn't read baseline_model for
  // judging — it's analyst-only metadata. We resolve to the most likely
  // model the streaming path will use ('haiku' is the foxy-tutor default).
  const baselineProviderHint = openaiApiKey ? 'openai' : 'anthropic';
  const baselineModelHint = openaiApiKey
    ? (request.generation.model_preference === 'sonnet' ? 'gpt-4o' : 'gpt-4o-mini')
    : (request.generation.model_preference === 'sonnet' ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001');

  // ── C4.2b-ii (2026-05-20): stash key ──
  // Mint the shadow's request_id HERE (not inside the helper) so we can
  // pass the same id to recordShadowTextFromStash later. The stash inside
  // mol-shadow.ts is keyed by this id; the post-stream drain MUST use the
  // same key. baseline_response_text is intentionally undefined here →
  // stash path is selected inside shadowFireOpenAI.
  const shadowRequestId = newMolRequestId();

  fireShadowAndForget({
    request_id: shadowRequestId,
    systemPrompt,
    userMessage: request.query,
    maxTokens: effectiveMaxTokens,
    temperature: request.generation.temperature,
    task_type: mapPipelineToTaskType({
      caller: request.caller,
      mode: request.mode,
      isGroundingCheck: false,
    }),
    surface: mapCallerToSurface(request.caller),
    baseline_provider: baselineProviderHint,
    baseline_model: baselineModelHint,
    trace_id: traceId, // streaming writes the trace row BEFORE the stream
    // baseline_response_text deliberately omitted (undefined) → stash path:
    // the helper will stash the shadow's response text under shadowRequestId,
    // and the post-stream code below will drain it.
    student_context: {
      student_id: request.student_id,
      grade: request.scope.grade,
      language: null,
      exam_goal: null,
      subject: request.scope.subject_code,
    },
  });

  const claudeStream = callClaudeStream({
    systemPrompt,
    userMessage: request.query,
    maxTokens: effectiveMaxTokens,
    temperature: effectiveTemperature,
    timeoutMs: request.timeout_ms,
    apiKey: anthropicKey,
    openaiApiKey,
    modelPreference: request.generation.model_preference,
    // Phase 2 of Foxy continuity fix (2026-05-18): prefer native conversation
    // turns when supplied. Absent → byte-identical legacy single-user body.
    conversationTurns: request.generation.conversation_turns,
    // Response-cache v2 (design item 9): multi-block prompt caching —
    // static head + RAG tail carry cache_control breakpoints; per-student
    // middle stays uncached. Prompt TEXT unchanged (byte-identity verified
    // in claude.ts buildSystemBlocks).
    systemSegments: promptSegments,
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
        // C3 shadow log on the FINAL ok:true event — only this carries
        // cumulative token totals. Intermediate text_delta events have no
        // usage data. Build a synthetic ClaudeResponse so the adapter sees
        // the same shape regardless of streaming vs. blocking.
        const syntheticResponse: ClaudeResponse = {
          ok: true,
          content: accumulated,
          model: evt.model,
          provider: evt.provider,
          inputTokens: evt.inputTokens,
          outputTokens: evt.outputTokens,
          insufficientContext: evt.insufficientContext,
          fallback_count: evt.fallback_count,
          failure_chain: evt.failure_chain,
        };
        shadowLogClaudeCallIfEnabled({
          studentId: request.student_id,
          grade: request.scope.grade,
          subject: request.scope.subject_code,
          caller: request.caller,
          mode: request.mode,
          isGroundingCheck: false,
          latencyMs: Date.now() - claudeStreamStart,
          claudeResponse: syntheticResponse,
        });
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

  // RCA-FIX CRITICAL-2 (2026-06-26): Re-grounding retry for streaming soft-mode.
  // Mirrors pipeline.ts Step 12b. When chunks are present but Claude's streamed
  // answer opens with the general-knowledge escape prefix, fire ONE blocking
  // callClaude retry at temperature=0 with an explicit re-grounding nudge.
  //
  // The text_delta events already sent to the browser remain as-is (the student
  // already saw the streamed text). The `done` event carries the `structured`
  // payload that the UI renders on swap — so the re-grounded answer takes effect
  // in the structured renderer even though the raw text was already streamed.
  //
  // One retry only — to bound added latency on the `done` event. If the retry
  // also escapes to general knowledge, we fall through with the original answer.
  if (
    request.mode === 'soft' &&
    chunks.length > 0 &&
    answerStartsWithGeneralKnowledgeEscape(accumulated)
  ) {
    console.warn('pipeline-stream: soft-mode answer used general knowledge despite chunks — retrying with re-grounding nudge');
    const regroundUserMessage = [
      'Your previous answer did not use the provided Reference Material.',
      'Please rewrite your answer using ONLY the Reference Material provided in the system prompt.',
      'Do not use your general training knowledge.',
      '\n\nOriginal question: ',
      request.query,
    ].join('');
    const regroundResult = await callClaude({
      systemPrompt,
      userMessage: regroundUserMessage,
      maxTokens: effectiveMaxTokens,
      temperature: 0.0, // fully deterministic for the re-grounding pass
      timeoutMs: request.timeout_ms,
      apiKey: anthropicKey,
      openaiApiKey,
      modelPreference: request.generation.model_preference,
      // Omit conversation_turns: re-ground nudge needs a clean slate so the
      // model focuses on the reference material, not conversation history.
    });
    if (regroundResult.ok && !regroundResult.insufficientContext) {
      if (!answerStartsWithGeneralKnowledgeEscape(regroundResult.content)) {
        accumulated = regroundResult.content;
        // Update token accounting so trace reflects total spend.
        ctx.inputTokens = (ctx.inputTokens ?? 0) + regroundResult.inputTokens;
        ctx.outputTokens = (ctx.outputTokens ?? 0) + regroundResult.outputTokens;
      } else {
        console.warn('pipeline-stream: re-grounding retry still used general knowledge — serving original answer');
      }
    } else {
      console.warn('pipeline-stream: re-grounding retry failed or returned insufficient context — serving original answer');
    }
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

  // ── C4.2b-ii (2026-05-20): drain the shadow text stash ──
  // shadowFireOpenAI stashed the shadow's response text under shadowRequestId
  // when text capture is enabled. Now that we have the full accumulated
  // baseline text, drain the stash and write the mol_shadow_text_buffer row.
  // recordShadowTextFromStash is fire-and-forget — never throws, never
  // blocks the user-facing `done` event below.
  //
  // No-op when:
  //   * text-capture flag was off at fire time (no stash entry exists).
  //   * shadow timed out / errored before reaching the success path.
  //   * worker recycled between fire and drain (stash entry lost).
  //
  // In every no-op case the grader sees `skipped_no_text` and degrades
  // gracefully — same as scaffold mode.
  recordShadowTextFromStash({
    baseline_request_id: shadowRequestId,
    baseline_response_text: accumulated,
  });

  ctx.answerLength = accumulated.length;

  // ── FOX-1 (P12): screen the COMPLETE buffered answer before emitting `done` ──
  // Mid-stream blocking is infeasible (deltas were already streamed). Screening
  // the full accumulated text HERE lets us yield `abstain` INSTEAD of `done`,
  // so the unsafe structured/`done` frame never reaches the Next layer or the
  // client — the strongest place to stop it. The client's onAbstain handler
  // clears the streamed `content`, reconciling the bubble to the safe abstain
  // UI. The already-streamed text deltas are the documented residual. P13:
  // category tags only, never the answer text.
  const outScreen = screenStudentFacingText(accumulated);
  if (!outScreen.safe) {
    console.warn(
      `foxy(stream): output_safety_blocked categories=${outScreen.categories.join(',')}`,
    );
    yield {
      kind: 'abstain',
      abstainReason: 'upstream_error',
      suggestedAlternatives: [],
      traceId,
      latencyMs: Date.now() - startedAt,
    };
    return;
  }

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
    // Truncation rescue: max_tokens cuts mid-block in production. Try to
    // recover the complete blocks emitted before the cutoff before falling
    // back to wrapAsParagraph (which would otherwise produce a friendly
    // truncation message — better than raw JSON, but worse than the
    // partial answer the student actually wanted).
    const rescued = rescueFromTruncatedJson(rawAnswer);
    if (rescued) {
      console.warn(
        `foxy(stream): structured_parse_rescued reason=json_parse err=${String(err).slice(0, 120)}`,
      );
      return rescued;
    }
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
