// supabase/functions/grounded-answer/index.ts
// HTTP entry point for the grounded-answer Edge Function.
//
// Responsibility: top-level Deno.serve handler + control flow only.
// The actual pipeline stages (Voyage, retrieval, Claude, grounding check,
// trace, circuit breaker) live in sibling files and are orchestrated here.
//
// Contract: spec §6.1 request/response shape.
// Pipeline order (spec §6.4 steps 1-9):
//   1. Validate request
//   2. Coverage precheck (chapter_not_ready → abstain)
//   3. Feature flag gate (ff_grounded_ai_enabled)
//   4. Compute effective thresholds (strict vs soft)
//   5. Generate embedding (best effort; null OK)
//   6. Retrieve chunks (RPC + scope verify)
//   7. retrieve_only branch → cite + confidence + trace, return
//   8. Build prompt + call Claude (haiku with sonnet fallback)
//   9. Strict mode grounding check
//  10. Compute confidence, abstain below strict threshold
//  11. Extract citations
//  12. Write trace, return grounded response.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateRequest } from './validators.ts';
import { checkCoverage } from './coverage.ts';
import { buildAbstainResponse } from './abstain.ts';
import { generateEmbedding } from './embedding.ts';
import { retrieveChunks, type RetrievedChunk } from './retrieval.ts';
import { callClaude } from './claude.ts';
import { runGroundingCheck } from './grounding-check.ts';
import { computeConfidence } from './confidence.ts';
import { extractCitations } from './citations.ts';
import { loadTemplate, resolveTemplate, hashPrompt } from './prompts/index.ts';
import {
  writeTrace,
  hashQuery,
  redactPreview,
  type TraceRow,
} from './trace.ts';
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
import type {
  Caller,
  Citation,
  GroundedRequest,
  GroundedResponse,
} from './types.ts';

const VOYAGE_MODEL_ID = 'voyage-3';

// Service-role client: this function runs server-side only and needs to
// read cbse_syllabus, call RPCs, and write traces regardless of the
// calling user's RLS context. `let` (not `const`) so tests can inject a
// stub via __setSupabaseClientForTests without spinning up a real client.
// deno-lint-ignore no-explicit-any
let sb: any = null;

function ensureSb(): void {
  if (sb) return;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error(
      'grounded-answer: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set',
    );
  }
  sb = createClient(url, key);
}

// deno-lint-ignore no-explicit-any
export function __setSupabaseClientForTests(client: any): void {
  sb = client;
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

async function isServiceEnabled(): Promise<boolean> {
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

// Exposed for tests only — they can reset the memoized flag.
export function __resetFeatureFlagCacheForTests(): void {
  ffCache = null;
}

// ── Reference material formatting ────────────────────────────────────────────
// Design: keep this matching the Foxy legacy buildSystemPrompt layout so
// Claude's behavior is consistent when we cut over. 0 chunks → empty
// string (soft mode proceeds without references; template has placeholder
// anyway; trace row records chunk_count=0 for observability).
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

// ── Response + trace helpers ────────────────────────────────────────────────

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseTraceRow(
  request: GroundedRequest,
  latencyMs: number,
): TraceRow {
  return {
    caller: request.caller as Caller,
    student_id: request.student_id,
    grade: request.scope.grade,
    subject_code: request.scope.subject_code,
    chapter_number: request.scope.chapter_number,
    query_hash: '', // filled by caller
    query_preview: redactPreview(request.query),
    embedding_model: null,
    retrieved_chunk_ids: [],
    top_similarity: null,
    chunk_count: 0,
    claude_model: null,
    prompt_template_id: request.generation.system_prompt_template,
    prompt_hash: null,
    grounded: false,
    abstain_reason: null,
    confidence: null,
    answer_length: null,
    input_tokens: null,
    output_tokens: null,
    latency_ms: latencyMs,
    client_reported_issue_id: null,
  };
}

// Runs the pipeline end-to-end. Extracted from the HTTP handler so tests
// can call it directly with stubbed clients.
export async function runPipeline(
  request: GroundedRequest,
  startedAt: number,
  anthropicKey: string,
  voyageKey: string,
): Promise<GroundedResponse> {
  ensureSb();
  const queryHashPromise = hashQuery(request.query);

  // Step 2. Coverage precheck (chapter_not_ready short-circuit).
  const coverage = await checkCoverage(sb, {
    grade: request.scope.grade,
    subject_code: request.scope.subject_code,
    chapter_number: request.scope.chapter_number,
  });
  if (!coverage.ready) {
    const queryHash = await queryHashPromise;
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.grounded = false;
    traceRow.abstain_reason = 'chapter_not_ready';
    const traceId = await writeTrace(sb, traceRow);
    return buildAbstainResponse(
      'chapter_not_ready',
      coverage.alternatives,
      traceId,
      startedAt,
    );
  }

  // Step 2b. Cache lookup (spec §6.9). Only grounded:true responses live
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
  if (!(await isServiceEnabled())) {
    const queryHash = await queryHashPromise;
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.grounded = false;
    traceRow.abstain_reason = 'upstream_error';
    const traceId = await writeTrace(sb, traceRow);
    return buildAbstainResponse('upstream_error', [], traceId, startedAt);
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
    const queryHash = await queryHashPromise;
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.grounded = false;
    traceRow.abstain_reason = 'circuit_open';
    const traceId = await writeTrace(sb, traceRow);
    return buildAbstainResponse('circuit_open', [], traceId, startedAt);
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
  if (voyageWasReachable) {
    if (embedding == null) recordFailure(cKey);
    else recordSuccess(cKey);
  }

  // Step 6. Retrieve chunks.
  const { chunks } = await retrieveChunks(sb, {
    query: request.query,
    embedding,
    scope: request.scope,
    matchCount: request.retrieval.match_count,
    minSimilarity,
  });

  const topSim = chunks.length > 0 ? chunks[0].similarity : 0;
  const top3Avg =
    chunks.length > 0
      ? chunks.slice(0, 3).reduce((s, c) => s + c.similarity, 0) /
        Math.min(3, chunks.length)
      : 0;

  // Step 7. retrieve_only branch: skip Claude + grounding check, just
  // return citations so the caller (concept-engine) can use them to
  // drive downstream retrieval logic. Spec §6.1 retrieve_only flag.
  if (request.retrieve_only) {
    if (chunks.length === 0) {
      const queryHash = await queryHashPromise;
      const traceRow = baseTraceRow(request, Date.now() - startedAt);
      traceRow.query_hash = queryHash;
      traceRow.embedding_model = embedding ? VOYAGE_MODEL_ID : null;
      traceRow.grounded = false;
      traceRow.abstain_reason = 'no_chunks_retrieved';
      const traceId = await writeTrace(sb, traceRow);
      return buildAbstainResponse(
        'no_chunks_retrieved',
        [],
        traceId,
        startedAt,
      );
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
    const queryHash = await queryHashPromise;
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.embedding_model = embedding ? VOYAGE_MODEL_ID : null;
    traceRow.retrieved_chunk_ids = chunks.map((c) => c.id);
    traceRow.top_similarity = topSim;
    traceRow.chunk_count = chunks.length;
    traceRow.claude_model = null;
    traceRow.grounded = true;
    traceRow.confidence = confidence;
    traceRow.answer_length = 0;
    const traceId = await writeTrace(sb, traceRow);
    return {
      grounded: true,
      answer: '',
      citations,
      confidence,
      trace_id: traceId,
      meta: {
        claude_model: '',
        tokens_used: 0,
        latency_ms: Date.now() - startedAt,
      },
    };
  }

  // Step 8. Strict mode requires at least 3 chunks — fewer means we can't
  // confidently cite. Soft mode continues with what we have.
  if (request.mode === 'strict' && chunks.length < 3) {
    const queryHash = await queryHashPromise;
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.embedding_model = embedding ? VOYAGE_MODEL_ID : null;
    traceRow.retrieved_chunk_ids = chunks.map((c) => c.id);
    traceRow.top_similarity = chunks.length > 0 ? topSim : null;
    traceRow.chunk_count = chunks.length;
    traceRow.grounded = false;
    traceRow.abstain_reason = 'no_chunks_retrieved';
    const traceId = await writeTrace(sb, traceRow);
    return buildAbstainResponse(
      'no_chunks_retrieved',
      [],
      traceId,
      startedAt,
    );
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

  const systemPrompt = resolveTemplate(template, vars);
  const promptHashStr = await hashPrompt(systemPrompt);

  // Step 10. Call Claude.
  const claude = await callClaude({
    systemPrompt,
    userMessage: request.query,
    maxTokens: request.generation.max_tokens,
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

  const queryHash = await queryHashPromise;
  const embeddingModel = embedding ? VOYAGE_MODEL_ID : null;

  if (!claude.ok) {
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.embedding_model = embeddingModel;
    traceRow.retrieved_chunk_ids = chunks.map((c) => c.id);
    traceRow.top_similarity = chunks.length > 0 ? topSim : null;
    traceRow.chunk_count = chunks.length;
    traceRow.prompt_hash = promptHashStr;
    traceRow.grounded = false;
    traceRow.abstain_reason = 'upstream_error';
    if (claude.reason === 'auth_error') {
      console.error('claude: auth_error — check ANTHROPIC_API_KEY');
    }
    const traceId = await writeTrace(sb, traceRow);
    return buildAbstainResponse('upstream_error', [], traceId, startedAt);
  }

  // Step 11. Claude explicitly said insufficient context. Do not serve the
  // sentinel to students — abstain cleanly with the proper reason.
  if (claude.insufficientContext) {
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.embedding_model = embeddingModel;
    traceRow.retrieved_chunk_ids = chunks.map((c) => c.id);
    traceRow.top_similarity = chunks.length > 0 ? topSim : null;
    traceRow.chunk_count = chunks.length;
    traceRow.claude_model = claude.model;
    traceRow.prompt_hash = promptHashStr;
    traceRow.grounded = false;
    traceRow.abstain_reason = 'no_supporting_chunks';
    traceRow.input_tokens = claude.inputTokens;
    traceRow.output_tokens = claude.outputTokens;
    const traceId = await writeTrace(sb, traceRow);
    return buildAbstainResponse('no_supporting_chunks', [], traceId, startedAt);
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
      const traceRow = baseTraceRow(request, Date.now() - startedAt);
      traceRow.query_hash = queryHash;
      traceRow.embedding_model = embeddingModel;
      traceRow.retrieved_chunk_ids = chunks.map((c) => c.id);
      traceRow.top_similarity = chunks.length > 0 ? topSim : null;
      traceRow.chunk_count = chunks.length;
      traceRow.claude_model = claude.model;
      traceRow.prompt_hash = promptHashStr;
      traceRow.grounded = false;
      traceRow.abstain_reason = 'no_supporting_chunks';
      traceRow.input_tokens = claude.inputTokens;
      traceRow.output_tokens = claude.outputTokens;
      const traceId = await writeTrace(sb, traceRow);
      return buildAbstainResponse(
        'no_supporting_chunks',
        [],
        traceId,
        startedAt,
      );
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

  if (request.mode === 'strict' && confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD) {
    const traceRow = baseTraceRow(request, Date.now() - startedAt);
    traceRow.query_hash = queryHash;
    traceRow.embedding_model = embeddingModel;
    traceRow.retrieved_chunk_ids = chunks.map((c) => c.id);
    traceRow.top_similarity = chunks.length > 0 ? topSim : null;
    traceRow.chunk_count = chunks.length;
    traceRow.claude_model = claude.model;
    traceRow.prompt_hash = promptHashStr;
    traceRow.grounded = false;
    traceRow.abstain_reason = 'low_similarity';
    traceRow.confidence = confidence;
    traceRow.input_tokens = claude.inputTokens;
    traceRow.output_tokens = claude.outputTokens;
    const traceId = await writeTrace(sb, traceRow);
    return buildAbstainResponse('low_similarity', [], traceId, startedAt);
  }

  // Step 14. Citations.
  const citations = extractCitations(claude.content, chunks);

  // Step 15. Success path trace + response.
  const traceRow = baseTraceRow(request, Date.now() - startedAt);
  traceRow.query_hash = queryHash;
  traceRow.embedding_model = embeddingModel;
  traceRow.retrieved_chunk_ids = chunks.map((c) => c.id);
  traceRow.top_similarity = chunks.length > 0 ? topSim : null;
  traceRow.chunk_count = chunks.length;
  traceRow.claude_model = claude.model;
  traceRow.prompt_hash = promptHashStr;
  traceRow.grounded = true;
  traceRow.confidence = confidence;
  traceRow.answer_length = claude.content.length;
  traceRow.input_tokens = claude.inputTokens;
  traceRow.output_tokens = claude.outputTokens;
  const traceId = await writeTrace(sb, traceRow);

  const response: GroundedResponse = {
    grounded: true,
    answer: claude.content,
    citations,
    confidence,
    trace_id: traceId,
    meta: {
      claude_model: claude.model,
      tokens_used: claude.inputTokens + claude.outputTokens,
      latency_ms: Date.now() - startedAt,
    },
  };

  // Cache the grounded response. retrieve_only responses skip the cache
  // because concept-engine expects fresh retrieval on every call.
  const cacheKey = await buildCacheKey(request.query, request.scope, request.mode);
  putInCache(cacheKey, response);

  return response;
}

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

// Exposed so e2e tests can invoke the HTTP handler without network.
export async function handleRequest(req: Request): Promise<Response> {
  const started = Date.now();

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const { error, request } = validateRequest(body);
  if (error || !request) {
    return jsonResponse(400, { error: `invalid_request:${error!.field}` });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const voyageKey = Deno.env.get('VOYAGE_API_KEY') ?? '';

  const response = await runPipeline(request, started, anthropicKey, voyageKey);
  return jsonResponse(200, response);
}

Deno.serve(handleRequest);

// Exposed for tests.
export { sb as __sbForTests };