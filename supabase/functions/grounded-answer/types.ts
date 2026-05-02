// supabase/functions/grounded-answer/types.ts
// Type contracts for the grounded-answer Edge Function.
// These shapes are the load-bearing contract between the service and every
// caller (foxy, ncert-solver, quiz-generator, concept-engine, diagnostic).
// Keep them in sync with spec §6.1 and src/lib/ai/grounded-client.ts (when added).

import { VALID_CALLERS } from './config.ts';

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

export interface GroundedRequest {
  caller: Caller;
  student_id: string | null;
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