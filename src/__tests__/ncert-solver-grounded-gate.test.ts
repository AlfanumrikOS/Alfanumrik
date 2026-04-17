/**
 * ncert-solver grounded-answer feature-flag gate tests.
 *
 * The Edge Function lives in Deno (supabase/functions/ncert-solver/) which
 * can't be imported into Vitest. We lock in the pure client-contract
 * derivations here so the response shape the route produces stays
 * backward-compatible when the flag flips ON/OFF.
 *
 * Two paths:
 *   (a) grounded-answer service — when ff_grounded_ai_ncert_solver is ON
 *   (b) legacy inline Voyage+Claude pipeline — when flag is OFF
 */

import { describe, it, expect } from 'vitest';
import type { GroundedResponse, SuggestedAlternative } from '@/lib/ai/grounded-client';

// ─── Mirror of the response-mapping logic in ncert-solver/index.ts ──────────

interface LegacyResponseShape {
  answer: string;
  steps: string[];
  concept: string;
  explanation: string;
  confidence: number;
  verified: boolean;
  verification_issues: string[];
  solver_type: string;
  question_type: string;
  marks: number;
  trace_id?: string;
  abstain_reason?: string;
  suggested_alternatives?: SuggestedAlternative[];
  flow?: string;
}

function mapGroundedToLegacyShape(
  grounded: GroundedResponse,
  marks: number,
): LegacyResponseShape {
  if (!grounded.grounded) {
    return {
      answer: '',
      steps: [],
      concept: '',
      explanation: 'NCERT solution not available for this question.',
      confidence: 0,
      verified: false,
      verification_issues: [`abstain:${grounded.abstain_reason}`],
      solver_type: 'grounded_service',
      question_type: 'unknown',
      marks,
      trace_id: grounded.trace_id,
      abstain_reason: grounded.abstain_reason,
      suggested_alternatives: grounded.suggested_alternatives,
      flow: 'grounded-answer',
    };
  }
  return {
    answer: grounded.answer,
    steps: [],
    concept: '',
    explanation: grounded.answer,
    confidence: grounded.confidence,
    verified: true,
    verification_issues: [],
    solver_type: 'grounded_service',
    question_type: 'unknown',
    marks,
    trace_id: grounded.trace_id,
    flow: 'grounded-answer',
  };
}

describe('ncert-solver grounded → legacy response mapping', () => {
  it('maps grounded success with trace_id preserved', () => {
    const grounded: GroundedResponse = {
      grounded: true,
      answer: 'The SI unit of force is the newton, defined as kg·m/s².',
      citations: [],
      confidence: 0.92,
      trace_id: 'trace-success-123',
      meta: { claude_model: 'haiku', tokens_used: 180, latency_ms: 410 },
    };
    const result = mapGroundedToLegacyShape(grounded, 2);
    expect(result.answer).toContain('newton');
    expect(result.confidence).toBe(0.92);
    expect(result.verified).toBe(true);
    expect(result.trace_id).toBe('trace-success-123');
    expect(result.solver_type).toBe('grounded_service');
    expect(result.flow).toBe('grounded-answer');
  });

  it('maps abstain to legacy "solution not available" shape with alternatives', () => {
    const alternatives: SuggestedAlternative[] = [
      {
        grade: '9',
        subject_code: 'science',
        chapter_number: 9,
        chapter_title: 'Force and Laws of Motion',
        rag_status: 'ready',
      },
    ];
    const grounded: GroundedResponse = {
      grounded: false,
      abstain_reason: 'chapter_not_ready',
      suggested_alternatives: alternatives,
      trace_id: 'trace-abstain-456',
      meta: { latency_ms: 50 },
    };
    const result = mapGroundedToLegacyShape(grounded, 5);
    expect(result.answer).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.verified).toBe(false);
    expect(result.verification_issues).toContain('abstain:chapter_not_ready');
    expect(result.abstain_reason).toBe('chapter_not_ready');
    expect(result.suggested_alternatives).toEqual(alternatives);
    expect(result.trace_id).toBe('trace-abstain-456');
  });

  it('always includes flow=grounded-answer for service path', () => {
    const grounded: GroundedResponse = {
      grounded: true,
      answer: 'x',
      citations: [],
      confidence: 0.5,
      trace_id: 't',
      meta: { claude_model: 'haiku', tokens_used: 1, latency_ms: 1 },
    };
    expect(mapGroundedToLegacyShape(grounded, 1).flow).toBe('grounded-answer');
  });

  it('preserves abstain_reason through the shape so clients can branch on it', () => {
    const reasons: Array<GroundedResponse['grounded'] extends false ? never : never> = [];
    void reasons;
    const reason = 'circuit_open' as const;
    const grounded: GroundedResponse = {
      grounded: false,
      abstain_reason: reason,
      suggested_alternatives: [],
      trace_id: 't',
      meta: { latency_ms: 0 },
    };
    expect(mapGroundedToLegacyShape(grounded, 1).abstain_reason).toBe(reason);
  });
});