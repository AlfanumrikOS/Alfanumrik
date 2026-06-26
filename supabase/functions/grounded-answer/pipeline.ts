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
// Digital Twin + Knowledge Graph (Slice 1). Flag-gated cross-subject retrieval
// widening along EXPLICIT concept_edges transfer edges. Strict no-op when
// ff_digital_twin_v1 is OFF (default) or no transfer edge exists. NEVER relaxes
// curriculum_guard / abstain — see transfer-retrieval.ts safety contract.
import { isDigitalTwinEnabled } from './_twin-flag.ts';
import { retrieveTransferChunks, mergeTransferChunks } from './transfer-retrieval.ts';
import { callClaude, type ClaudeResponse } from './claude.ts';
import {
  runGroundingCheck,
  GROUNDING_CHECK_SYSTEM_PROMPT,
  buildGroundingCheckUserMessage,
} from './grounding-check.ts';
// C3 (MOL grounded-answer integration, 2026-05-18). Telemetry-only shadow
// log of every primary callClaude invocation into mol_request_logs.
// Default-OFF feature flag (ff_grounded_answer_mol_telemetry_v1) is checked
// at the call site, not at module load. Zero user-visible behavior change.
// TODO(c4-handoff): when shadow-routing through MOL lands in Phase C4, the
// adapter sites in this file MUST be REPLACED with a through-MOL routed
// call — DO NOT stack a shadow log on top of an already-routed request or
// every row will double-count.
import { shadowLogClaudeCallIfEnabled, mapCallerToSurface, mapPipelineToTaskType } from './mol-telemetry-adapter.ts';
// C4.2a wire-up (2026-05-19): every successful callClaude invocation in
// grounded-answer ALSO fires a parallel OpenAI shadow call. The shadow's
// response is discarded; only the row in mol_request_logs is kept for the
// offline grader (C4.2b). Default-OFF feature flag means zero production
// behavior change ships with C4.2a — the wire-up here is "armed" only.
// See mol-shadow.ts for the full design contract (short-circuit gates,
// prompt-parity fix, single-row telemetry contract).
import { fireShadowAndForget } from './mol-shadow.ts';
import { computeConfidence } from './confidence.ts';
import { extractCitations } from './citations.ts';
import {
  loadTemplate,
  resolveTemplate,
  hashPrompt,
} from './prompts/index.ts';
import { FOXY_STRUCTURED_OUTPUT_PROMPT } from './structured-prompt.ts';
import {
  rescueFromTruncatedJson,
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
  RRF_THEORETICAL_MAX,
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

/**
 * Synthetic MOL request_id minted for the C4.2a shadow wire-up. Used as
 * both the shadow row's request_id AND its shadow_of_request_id so the
 * mol_shadow_pairs_v1 view can self-join the shadow leg even before
 * C4.2b unifies the baseline row's request_id (the C3 adapter's row
 * currently uses its own internal UUID — see mol-telemetry-adapter.ts).
 *
 * NEVER reused across calls. Fresh per call to keep dashboards aligned
 * with one-row-per-LLM-call.
 */
function newMolRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (vitest under
  // older Node). Not cryptographically strong; only used in tests.
  return `mol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

function rerankEnabled(mode?: 'strict' | 'soft'): boolean {
  if (mode === 'soft') return false; // bypass heavy reranking for fast chat responses
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
//
// Fix 2 (groundedness): Added clear START/END delimiters around the reference
// block so Claude unambiguously identifies where reference material begins and
// ends. Each chunk is labelled with [Chapter: ...] and [Topic: ...] metadata
// so the model can ground more precisely to section-level context.
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
    const safeContent = sanitizeChunkForPrompt(c.content);
    let entry = `[${i + 1}]\n[Chapter: ${chapterBit}${pageBit}]\n${safeContent}`;
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

function modeInstructionFor(mode: 'strict' | 'soft', hasChunks: boolean): string {
  if (mode === 'strict') {
    return [
      'This response MUST be grounded in the Reference Material.',
      'If the material does not cover the question, reply with exactly: {{INSUFFICIENT_CONTEXT}}',
    ].join(' ');
  }
  // Fix 1 (groundedness): When chunks ARE present in soft mode, instruct Claude
  // to answer ONLY from those chunks, not from general knowledge. The general-
  // knowledge fallback is only permitted when NO chunks were retrieved. This
  // eliminates the 63.3% soft-mode ungrounded rate observed in production.
  if (hasChunks) {
    return [
      'You MUST answer ONLY from the Reference Material provided above.',
      'Do NOT use your general training knowledge even if you know the answer.',
      'If the Reference Material does not contain sufficient information to answer,',
      'say exactly: "This topic is not covered in the reference material I have.',
      'Please refer to your NCERT textbook directly."',
    ].join(' ');
  }
  // No chunks retrieved — allow general CBSE knowledge fallback with prefix.
  return [
    'The Reference Material is empty for this chapter.',
    'If the question IS in CBSE Grade scope: answer briefly using general CBSE knowledge,',
    'prefix with "From general CBSE knowledge:" (one-line).',
    'If the question is OUTSIDE scope: warmly redirect to an in-scope topic.',
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
    // Set in finalizeGrounded for success paths; left null on abstain rows
    // (no answer to evaluate). Backed by grounded_ai_traces.grounded_from_chunks
    // (migration 20260516070000). Audit 2026-05-10.
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
 * Soft-mode "general knowledge" escape detection. After Fix 1/Fix 3, the
 * mode_instruction and foxy_tutor_v1 prompt both instruct Claude to answer
 * ONLY from Reference Material when chunks are present. The general-knowledge
 * escape prefix is now only permitted when NO chunks were retrieved. However
 * we retain this detection as a safety net for the re-grounding retry (Step
 * 12b) and for analytics truthfulness — if Claude disobeys and opens with
 * one of these sentinel phrases despite chunks being present, the answer is
 * marked not grounded in chunks:
 *
 *   - "From general CBSE knowledge:"   (emitted when reference material empty)
 *   - "General knowledge (not from NCERT):"  (legacy modeInstructionFor 'soft')
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
  // Compute groundedFromChunks FIRST so we can persist it on the trace row.
  // Audit 2026-05-10: pre-fix this was computed only for the wire response
  // and the trace.grounded flag was set true regardless of true grounding,
  // making analytics blind to soft-mode general-knowledge fallbacks.
  const groundedFromChunks = computeGroundedFromChunks({
    mode: ctx.request.mode,
    answer,
    chunkCount: ctx.chunks ? ctx.chunks.length : 0,
    retrieveOnly: ctx.request.retrieve_only === true,
  });
  const traceRow = baseTraceRowFromCtx(ctx);
  traceRow.grounded = true;
  traceRow.grounded_from_chunks = groundedFromChunks;
  traceRow.confidence = confidence;
  traceRow.answer_length = answer.length;
  const traceId = await writeTrace(sb, traceRow);
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
    // Truncation rescue: salvage all complete blocks before max_tokens cut.
    // When successful we report ok=true so adoption telemetry counts these
    // as structured renders rather than fallbacks.
    const rescued = rescueFromTruncatedJson(rawAnswer);
    if (rescued) {
      const preview = redactPreview(rawAnswer).slice(0, 200);
      console.warn(
        `foxy: structured_parse_rescued reason=json_parse preview="${preview}" err=${String(err).slice(0, 120)}`,
      );
      return {
        structured: subjectHint && rescued.subject !== subjectHint
          ? { ...rescued, subject: subjectHint }
          : rescued,
        ok: true,
        warnings: ['rescued_from_truncated_json'],
      };
    }
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
 * For caller='foxy' we boost max_tokens to account for the JSON overhead
 * (keys, brackets, escaping) AND the typical multi-question student turn
 * (1-3 questions per message in production). The original 1.25x boost was
 * insufficient — production traces in May 2026 showed Haiku truncating
 * mid-block on 3-question turns, which crashed JSON.parse and tripped the
 * wrapAsParagraph fallback (the visible "raw JSON in chat bubble" bug).
 *
 * 1.6x covers the realistic upper bound: ~30% JSON overhead + ~30% headroom
 * for multi-question turns. The boost is applied at the Claude call site
 * only — the request contract still carries the caller-supplied max_tokens
 * for telemetry, so dashboards still report the requested budget.
 */
const FOXY_STRUCTURED_TOKEN_MULTIPLIER = 1.6;

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
  openaiApiKey = '',
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
      console.warn('cache_hit', {
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
  const overFetchCount = rerankEnabled(request.mode)
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
    rerankEnabled(request.mode) &&
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

  // Digital Twin Slice 1 (flag-gated, no-op when OFF): widen retrieval along
  // EXPLICIT concept_edges transfer edges into a DIFFERENT subject (same grade).
  // Soft-mode only — strict callers keep their single-subject grounding
  // contract. This NEVER relaxes curriculum_guard / abstain; it only ADDS
  // curated cross-subject chunks. No-op when the flag is OFF or no transfer
  // edge exists (the production default).
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
  // RRF-scale similarities (returned by match_rag_chunks_ncert) live in
  // [0, ~0.0328]. Normalize to [0,1] before feeding into computeConfidence,
  // which weights topSim+top3 at 0.7 of the final score and assumes [0,1]
  // inputs. Rank-1-in-both-lists hits the theoretical max; vector-only
  // matches cap at 1/61 ≈ 0.498 normalized. See config.ts:RRF_THEORETICAL_MAX.
  // The raw RRF value is still stored in ctx.topSimilarity for trace fidelity.
  const topSimNormalized = Math.min(topSim / RRF_THEORETICAL_MAX, 1);
  const top3AvgNormalized = Math.min(top3Avg / RRF_THEORETICAL_MAX, 1);
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
      topSimilarity: topSimNormalized,
      top3AverageSimilarity: top3AvgNormalized,
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
  // RC-2 / RC-3 fix (2026-06-26): These placeholders exist in foxy_tutor_v1.txt
  // but had no defaults set, so they rendered as literal "{{placeholder}}" text
  // in the system prompt sent to Claude whenever the caller omitted them.
  // mode_directive (line 24 of the template) is the top-level grounding
  // instruction paragraph. It was renamed from mode_instruction in a refactor
  // but the pipeline still only sets mode_instruction — default mode_directive
  // to mode_instruction so both template references resolve correctly.
  if (!vars.pending_expectation) vars.pending_expectation = '';
  if (!vars.learner_memory_section) vars.learner_memory_section = '';
  if (!vars.mode_directive) vars.mode_directive = vars.mode_instruction ?? '';
  if (!vars.next_topic) vars.next_topic = '';
  if (!vars.prereq) vars.prereq = '';

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

  // Fix 3 (groundedness): Cap temperature at 0.1 for factual answers when
  // chunks are present. High temperature (>0.1) introduces variance that
  // causes Claude to deviate from retrieved content toward training knowledge.
  // The caller-supplied temperature is preserved only when no chunks were
  // retrieved (soft-mode general-CBSE-knowledge fallback) or when the caller
  // explicitly requests creative/motivational output (temperature > 0.1
  // with no grounding material is acceptable). Strict mode always stays at
  // the caller-supplied temperature because it has a separate grounding-check
  // guard (Step 12) that catches hallucinations post-hoc.
  const effectiveTemperature = (request.mode === 'soft' && chunks.length > 0)
    ? Math.min(request.generation.temperature, 0.1)
    : request.generation.temperature;

  // C3: capture timing immediately around the Claude call so the shadow
  // log records true network latency (matches what the request handler
  // would see). Done before the call so an exception path (which we don't
  // expect — callClaude never throws — but defense in depth) still has a
  // valid `claudeStart`.
  const claudeStart = Date.now();
  const claude = await callClaude({
    systemPrompt,
    userMessage: request.query,
    maxTokens: effectiveMaxTokens,
    temperature: effectiveTemperature,
    timeoutMs: request.timeout_ms,
    apiKey: anthropicKey,
    openaiApiKey,
    modelPreference: request.generation.model_preference,
    // Phase 2 of Foxy continuity fix (2026-05-18): prefer native
    // conversation turns when supplied. Absent → byte-identical legacy
    // single-user-message body to Claude.
    conversationTurns: request.generation.conversation_turns,
  });
  const claudeLatencyMs = Date.now() - claudeStart;
  // C3 shadow log (telemetry-only). Fire-and-forget — telemetry MUST NOT
  // extend request latency. The flag is cached in-process for ~5 minutes
  // (see _shared/mol/feature-flag.ts) so the steady-state cost is a single
  // Array.find() against a flag-rows array (sub-millisecond).
  //
  // We generate a fresh UUID for the MOL request_id rather than reusing
  // the grounded_ai_traces row id because the trace row hasn't been
  // written yet at this point and its id is server-generated. Future C4
  // work can stitch the two together by reading ctx.molRequestId after
  // finalizeGrounded if dashboards need cross-table joins.
  //
  // TODO(c4.2b): retire shadowLogClaudeCallIfEnabled. The C4.2a wire-up
  // below ALSO writes a row (the shadow leg's orchestrator auto-log).
  // During the C3→C4 transition both rows coexist so dashboards keep
  // working; C4.2b removes the C3 adapter site and routes baseline
  // through MOL.
  shadowLogClaudeCallIfEnabled({
    studentId: request.student_id,
    grade: request.scope.grade,
    subject: request.scope.subject_code,
    caller: request.caller,
    mode: request.mode,
    isGroundingCheck: false,
    latencyMs: claudeLatencyMs,
    claudeResponse: claude,
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

  // C4.2a wire-up (2026-05-19): fire parallel OpenAI shadow call.
  //
  // Why HERE (after the ok:true branch, before the rest of the pipeline):
  //   - We have the EXACT composed systemPrompt the baseline used →
  //     prompt-parity holds for the offline grader.
  //   - The baseline succeeded; firing a shadow when baseline failed
  //     would write isolated shadow rows with no baseline to compare
  //     against (waste of OpenAI tokens).
  //   - The call is fire-and-forget so it runs on the event loop
  //     alongside the remaining pipeline steps (grounding-check,
  //     confidence, citations) — zero added user-facing latency.
  //
  // The flag is default-OFF; the helper short-circuits before
  // generateResponse() runs when the envelope says so. See mol-shadow.ts
  // for the full gating contract.
  //
  // The request_id we mint here is synthetic — it shows up as both the
  // shadow row's request_id AND its shadow_of_request_id (so the
  // mol_shadow_pairs_v1 view's self-join works on the shadow row even
  // before C4.2b unifies the baseline row's request_id).
  fireShadowAndForget({
    request_id: newMolRequestId(),
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
    baseline_provider: claude.provider || 'anthropic',
    baseline_model: claude.model,
    // trace_id is null at this point — the grounded_ai_traces row is written
    // by finalizeGrounded/finalizeAbstain later. The shadow row carries
    // null trace_id today; C4.2b plumbs trace_id after writeTrace returns.
    trace_id: null,
    // ── C4.2b-ii text capture (2026-05-20) ──
    // Non-streaming pipeline has the full baseline text ready BEFORE the
    // shadow fires. Pass it inline so the helper writes
    // mol_shadow_text_buffer in one shot when both feature flags are on.
    // Gated by ff_mol_shadow_text_capture_v1; helper short-circuits when
    // text capture is off.
    baseline_response_text: claude.content,
    // shadow_system_prompt_override stays at the default (null) — prompt-
    // parity (C4.2a) means the shadow used the baseline's exact prompt.
    student_context: {
      student_id: request.student_id,
      grade: request.scope.grade,
      // GroundedRequest doesn't carry language / exam_goal; leave undefined
      // so the helper substitutes its safe defaults. Future C5 task may
      // plumb these through GroundedRequest for richer telemetry.
      language: null,
      exam_goal: null,
      subject: request.scope.subject_code,
    },
  });

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
    // C3 shadow log for the grounding-check pass. Fires only when meta is
    // populated (every reachable path in runGroundingCheck since the C3
    // edit) and the underlying HTTP call succeeded. Failed grounding-check
    // HTTP calls are skipped because the adapter's ok:false branch
    // intentionally does not log (see mol-telemetry-adapter.ts).
    // TODO(c4.2b): retire this C3 row. The C4.2a wire-up below ALSO writes
    // a row (the shadow leg's orchestrator auto-log). During the C3→C4
    // transition both rows coexist so dashboards keep working; C4.2b
    // removes the C3 adapter site and routes baseline through MOL.
    if (verdict.meta) {
      const gcSynthetic: ClaudeResponse = verdict.meta.ok
        ? {
            ok: true,
            content: verdict.verdict, // textual marker only; not surfaced to students
            model: verdict.meta.model,
            inputTokens: verdict.meta.inputTokens,
            outputTokens: verdict.meta.outputTokens,
            insufficientContext: false,
            fallback_count: 0,
            failure_chain: undefined,
          }
        : { ok: false, reason: 'unknown' };
      shadowLogClaudeCallIfEnabled({
        studentId: request.student_id,
        grade: request.scope.grade,
        subject: request.scope.subject_code,
        caller: request.caller,
        mode: request.mode,
        isGroundingCheck: true,
        latencyMs: verdict.meta.latencyMs,
        claudeResponse: gcSynthetic,
      });

      // C4.2a wire-up — fire the OpenAI shadow for the grounding-check
      // pass. Fires only when the baseline grounding-check produced a
      // verdict (meta.ok=true OR meta.ok=false; both reach here). When
      // baseline failed we still fire because dashboards want to know
      // whether OpenAI would also have failed on the SAME prompt — that
      // tells us if the issue was Anthropic-specific or universal.
      //
      // Allow-list gating still applies: the flag's task_types[] must
      // include 'grounding_check' for this leg to actually fire. The
      // seeded envelope (migration 20260519000002) deliberately omits
      // 'grounding_check' so primary-answer telemetry is the focus.
      fireShadowAndForget({
        request_id: newMolRequestId(),
        systemPrompt: GROUNDING_CHECK_SYSTEM_PROMPT,
        userMessage: buildGroundingCheckUserMessage(
          claude.content,
          request.query,
          chunks.map((c) => ({ id: c.id, content: c.content })),
        ),
        // Mirror runGroundingCheck's token budget (MAX_OUTPUT_TOKENS=512)
        // so the grader compares like-for-like resource budgets.
        maxTokens: 512,
        // Mirror runGroundingCheck's deterministic temperature.
        temperature: 0.0,
        task_type: 'grounding_check',
        surface: mapCallerToSurface(request.caller),
        baseline_provider: 'anthropic',
        baseline_model: verdict.meta.model,
        trace_id: null,
        // ── C4.2b-ii: skip text capture for the grounding-check leg ──
        // The grounding-check baseline "answer" is a JSON verdict, not a
        // student-facing answer. The grader's allow-list excludes
        // 'grounding_check' anyway (see migration 20260519000002). Empty
        // string here signals SKIP — no inline write, no stash entry,
        // even if the text-capture flag is on for primary-answer rows.
        baseline_response_text: '',
        student_context: {
          student_id: request.student_id,
          grade: request.scope.grade,
          language: null,
          exam_goal: null,
          subject: request.scope.subject_code,
        },
      });
    }
    if (verdict.verdict === 'fail') {
      return finalizeAbstain(sb, ctx, 'no_supporting_chunks');
    }
    groundingPassRatio = 1;
  }

  // Step 12b. Fix 4 (groundedness): Re-grounding retry for soft-mode.
  //
  // When soft-mode retrieves chunks but Claude's first answer falls back to
  // general knowledge (detected via answerStartsWithGeneralKnowledgeEscape),
  // fire one retry with an explicit re-grounding instruction. This catches
  // the 63.3% of soft-mode calls where the model ignores the reference
  // material despite Fix 1 and Fix 3. One retry only — to cap latency.
  // The retry uses the same systemPrompt (already has the strengthened
  // grounding instruction from Fix 1) with an explicit user-level nudge.
  //
  // Retry only when:
  //   - mode is soft (strict is handled by Step 12 grounding-check above)
  //   - chunks were retrieved (nothing to re-ground to if chunks.length=0)
  //   - the answer starts with the general-knowledge escape sentinel
  let primaryAnswer = claude.content;
  if (
    request.mode === 'soft' &&
    chunks.length > 0 &&
    answerStartsWithGeneralKnowledgeEscape(claude.content)
  ) {
    console.warn('pipeline: soft-mode answer used general knowledge despite chunks — retrying with re-grounding nudge');
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
      // Omit conversation_turns: the re-ground nudge must see a clean slate
      // so the model focuses on the reference material, not conversation history.
    });
    if (regroundResult.ok && !regroundResult.insufficientContext) {
      // Accept the retry answer only if it does NOT open with the escape prefix.
      // If the model still falls back to general knowledge on retry, serve the
      // original (same quality, no point in a second retry).
      if (!answerStartsWithGeneralKnowledgeEscape(regroundResult.content)) {
        primaryAnswer = regroundResult.content;
        // Update token accounting so the trace row reflects total spend.
        ctx.inputTokens = (ctx.inputTokens ?? 0) + regroundResult.inputTokens;
        ctx.outputTokens = (ctx.outputTokens ?? 0) + regroundResult.outputTokens;
      } else {
        console.warn('pipeline: re-grounding retry still used general knowledge — serving original answer');
      }
    } else {
      console.warn('pipeline: re-grounding retry failed or returned insufficient context — serving original answer');
    }
  }

  // Step 13. Confidence. topSim/top3Avg normalized to [0,1] from RRF scale
  // before being fed in — see comment above the topSimNormalized declaration.
  const confidence = computeConfidence({
    topSimilarity: topSimNormalized,
    top3AverageSimilarity: top3AvgNormalized,
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
  let answerForResponse = primaryAnswer;
  let structuredForResponse: FoxyResponse | undefined;

  if (isFoxyStructured) {
    const subjectHint = mapSubjectCodeToFoxySubject(request.scope.subject_code);
    const parsed = parseFoxyStructured({
      rawAnswer: primaryAnswer,
      subjectHint,
    });
    structuredForResponse = parsed.structured;
    // Denormalize the structured payload into a single string for legacy
    // storage. This is what foxy_chat_messages.content (TEXT) keeps. When
    // parse failed, `parsed.structured` is the wrapAsParagraph fallback so
    // the denormalized text is still safe to surface.
    answerForResponse = denormalizeFoxyResponse(parsed.structured);
  }

  const citations = extractCitations(primaryAnswer, chunks);
  ctx.answerLength = answerForResponse.length;

  // Total token spend includes the primary call and any re-grounding retry.
  // ctx.inputTokens / ctx.outputTokens were updated in the retry block above
  // when the retry fired, so summing from ctx gives the accurate total.
  const totalTokensUsed = (ctx.inputTokens ?? 0) + (ctx.outputTokens ?? 0);
  const response = await finalizeGrounded(
    sb,
    ctx,
    answerForResponse,
    citations,
    confidence,
    claude.model,
    totalTokensUsed,
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