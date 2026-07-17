// supabase/functions/grounded-answer/types.ts
// Type contracts for the grounded-answer Edge Function.
// These shapes are the load-bearing contract between the service and every
// caller (foxy, ncert-solver, quiz-generator, concept-engine, diagnostic).
// Keep them in sync with spec §6.1 and src/lib/ai/grounded-client.ts (when added).

import { VALID_CALLERS } from './config.ts';
import type { FoxyResponse } from './structured-schema.ts';

export type { FoxyResponse } from './structured-schema.ts';

export type Caller = typeof VALID_CALLERS[number];
export type Mode = 'strict' | 'soft';

export type AbstainReason =
  | 'chapter_not_ready'
  | 'no_chunks_retrieved'
  | 'low_similarity'
  | 'no_supporting_chunks'
  | 'scope_mismatch'
  | 'upstream_error'
  | 'circuit_open';

/**
 * Phase 2 of Foxy continuity fix (2026-05-18): a single prior turn in
 * Anthropic's native messages[] shape. The pipeline (pipeline.ts +
 * pipeline-stream.ts) prepends these to the [{role:'user', content: query}]
 * it currently sends to Claude. Callers MUST NOT include the current turn —
 * `query` is the current turn.
 *
 * When `conversation_turns` is absent (older callers, kill-switch path), the
 * pipeline preserves byte-identical legacy behavior.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GroundedRequest {
  caller: Caller;
  student_id: string | null;
  /**
   * Response-cache v2 scope declaration (design item 3). ONLY the caller
   * knows whether a request is personalization-free, so the caller must
   * declare it:
   *   - 'shared': this request carries NO per-student personalization
   *     (no conversation turns, no cognitive/misconception/expectation/
   *     session/memory/goal/tenant-override prompt sections). The pipeline
   *     may read from and write to the shared response caches (L1/L2, and
   *     L3 for ncert-solver).
   *   - 'none' (or absent — fail-closed default): no cache read, no cache
   *     write. The pipeline runs end-to-end for every request.
   */
  cache_scope?: 'shared' | 'none';
  query: string;
  scope: {
    board: 'CBSE';
    grade: string;
    subject_code: string;
    chapter_number: number | null;
    chapter_title: string | null;
  };
  mode: Mode;
  generation: {
    model_preference: 'haiku' | 'sonnet' | 'auto';
    max_tokens: number;
    temperature: number;
    system_prompt_template: string;
    template_variables: Record<string, string>;
    /**
     * Phase 2 of Foxy continuity fix: prior conversation turns in native
     * Anthropic shape. When present and non-empty, the pipeline prepends
     * these to `messages[]` before the current `query`. When absent, the
     * pipeline preserves byte-identical legacy behavior.
     */
    conversation_turns?: ConversationTurn[];
  };
  retrieval: {
    match_count: number;
    min_similarity_override?: number;
  };
  retrieve_only?: boolean;
  timeout_ms: number;
}

export interface Citation {
  index: number;
  chunk_id: string;
  chapter_number: number;
  chapter_title: string;
  page_number: number | null;
  similarity: number;
  excerpt: string;
  media_url: string | null;
}

export interface SuggestedAlternative {
  grade: string;
  subject_code: string;
  chapter_number: number;
  chapter_title: string;
  rag_status: 'ready';
}

export type GroundedResponse =
  | {
      grounded: true;
      answer: string;
      citations: Citation[];
      confidence: number;
      /**
       * True when the answer was actually produced from the retrieved NCERT
       * chunks (strict-mode passed grounding-check OR soft-mode answered with
       * chunks present and no "general knowledge" escape prefix).
       * False when soft-mode fell back to general CBSE knowledge OR when no
       * chunks were retrieved but soft-mode answered anyway OR for the
       * retrieve_only branch where there is no answer text.
       *
       * Distinct from `grounded: true` (the API-shape branch discriminator).
       * Analytics callers should prefer this field over `grounded` when
       * measuring true citation-backed answer rate. Audit Phase 0 Fix 0.5.
       */
      groundedFromChunks: boolean;
      /**
       * Foxy structured-response payload. Populated ONLY for `caller === 'foxy'`
       * when Claude's output successfully parses + validates against the
       * FoxyResponseSchema (see src/lib/foxy/schema.ts; Deno mirror in
       * structured-schema.ts). On parse/validate failure the pipeline emits a
       * `wrapAsParagraph(rawText)` fallback so this field is ALWAYS defined for
       * Foxy responses -- never undefined when caller is 'foxy' and the call
       * succeeded. Other callers (ncert-solver, quiz-generator, etc) leave it
       * undefined; they consume the legacy `answer` markdown string instead.
       *
       * The legacy `answer` field is also populated for Foxy via
       * `denormalizeFoxyResponse` so storage in foxy_chat_messages.content
       * (TEXT, denormalized) keeps working without schema changes. Renderers
       * that understand the structured contract should prefer `structured`.
       */
      structured?: FoxyResponse;
      trace_id: string;
      meta: { claude_model: string; tokens_used: number; latency_ms: number };
    }
  | {
      grounded: false;
      abstain_reason: AbstainReason;
      suggested_alternatives: SuggestedAlternative[];
      trace_id: string;
      meta: { latency_ms: number };
    };