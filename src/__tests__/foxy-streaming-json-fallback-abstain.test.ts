/**
 * Foxy streaming JSON-fallback abstain — P0 regression test.
 *
 * Production bug (2026-04-28): When `ff_foxy_streaming` is OFF and the
 * /api/foxy server returns JSON instead of SSE, the JSON-fallback branch in
 * callFoxyTutorStream was unconditionally calling onDone — even when the
 * payload contained `groundingStatus: 'hard-abstain'`. Result: the tutor
 * bubble stayed empty, no HardAbstainCard rendered, no error surfaced.
 *
 * The fix routes hard-abstain JSON payloads through onAbstain (with the
 * abstainReason / suggestedAlternatives / traceId echoed through), and adds a
 * defensive empty-content fallback so a silent empty bubble can never ship
 * to a student again.
 *
 * Following the pattern of foxy-streaming.test.ts, this test mirrors the
 * JSON-fallback branch logic of src/app/foxy/page.tsx::callFoxyTutorStream.
 * If the implementation drifts from this mirror, both must be updated.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Mirror of the JSON-fallback branch in callFoxyTutorStream ─────────────
// Lines 399-431 of src/app/foxy/page.tsx (after fix).

type AbstainReason = string;
type GroundingStatus = 'grounded' | 'soft-abstain' | 'hard-abstain';
interface SuggestedAlternative { grade: string; subject_code: string; chapter_number: number; chapter_title: string; rag_status: string }

interface StreamingCallbacks {
  onSession?: (sessionId: string) => void;
  onText: (delta: string) => void;
  onDone: (info: { tokensUsed: number; latencyMs: number; groundedFromChunks: boolean; citationsCount: number; claudeModel: string }) => void;
  onAbstain?: (info: { abstainReason: AbstainReason; suggestedAlternatives: SuggestedAlternative[]; traceId?: string }) => void;
  onError?: (info: { reason: string; traceId?: string }) => void;
}

/** Faithful mirror of the post-fix JSON-fallback branch. */
function jsonFallbackBranch(data: any, callbacks: StreamingCallbacks): void {
  if (data?.sessionId) callbacks.onSession?.(data.sessionId);
  if (data?.groundingStatus === 'hard-abstain') {
    callbacks.onAbstain?.({
      abstainReason: (data?.abstainReason || 'upstream_error') as AbstainReason,
      suggestedAlternatives: Array.isArray(data?.suggestedAlternatives) ? data.suggestedAlternatives : [],
      traceId: data?.traceId,
    });
    return;
  }
  if (typeof data?.response === 'string' && data.response.length > 0) {
    callbacks.onText(data.response);
  }
  callbacks.onDone({
    tokensUsed: data?.tokensUsed ?? 0,
    latencyMs: 0,
    groundedFromChunks: data?.groundedFromChunks === true,
    citationsCount: typeof data?.citationsCount === 'number' ? data.citationsCount : 0,
    claudeModel: data?.meta?.claude_model || data?.claudeModel || '',
  });
}

// ─── Test 1: hard-abstain → onAbstain (NOT onDone) ─────────────────────────

describe('callFoxyTutorStream JSON-fallback — hard-abstain routing', () => {
  it('hard-abstain JSON payload calls onAbstain and NOT onDone', () => {
    const onAbstain = vi.fn();
    const onDone = vi.fn();
    const onText = vi.fn();
    jsonFallbackBranch(
      {
        success: false,
        groundingStatus: 'hard-abstain',
        abstainReason: 'no_chunks_retrieved',
        suggestedAlternatives: [],
        traceId: 'trace-abstain-1',
        response: '',
      },
      { onAbstain, onDone, onText },
    );
    expect(onAbstain).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  // ─── Test 2: grounded → onDone (normal path, no abstain) ─────────────────

  it('grounded JSON payload calls onDone and NOT onAbstain', () => {
    const onAbstain = vi.fn();
    const onDone = vi.fn();
    const onText = vi.fn();
    jsonFallbackBranch(
      {
        success: true,
        groundingStatus: 'grounded',
        response: 'Photosynthesis is the process by which plants convert light into food.',
        tokensUsed: 240,
        groundedFromChunks: true,
        citationsCount: 2,
      },
      { onAbstain, onDone, onText },
    );
    expect(onAbstain).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith('Photosynthesis is the process by which plants convert light into food.');
  });

  // ─── Test 3: legacy payload (no groundingStatus) → onDone ────────────────

  it('payload with no groundingStatus field calls onDone (legacy compatibility)', () => {
    const onAbstain = vi.fn();
    const onDone = vi.fn();
    const onText = vi.fn();
    jsonFallbackBranch(
      {
        success: true,
        // No groundingStatus — pre-Phase-3 server response shape.
        response: 'Legacy response from the old foxy-tutor Edge Function.',
        tokensUsed: 100,
      },
      { onAbstain, onDone, onText },
    );
    expect(onAbstain).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledTimes(1);
  });

  // ─── Test 4: abstainReason and suggestedAlternatives propagate ───────────

  it('abstainReason and suggestedAlternatives propagate from JSON to onAbstain payload', () => {
    const onAbstain = vi.fn();
    const onDone = vi.fn();
    const suggestedAlternatives: SuggestedAlternative[] = [
      { grade: '9', subject_code: 'maths', chapter_number: 3, chapter_title: 'Coordinate Geometry', rag_status: 'ready' },
      { grade: '9', subject_code: 'maths', chapter_number: 4, chapter_title: 'Linear Equations', rag_status: 'ready' },
    ];
    jsonFallbackBranch(
      {
        success: false,
        groundingStatus: 'hard-abstain',
        abstainReason: 'chapter_not_ready',
        suggestedAlternatives,
        traceId: 'trace-abstain-2',
      },
      { onAbstain, onDone, onText: vi.fn() },
    );
    expect(onAbstain).toHaveBeenCalledTimes(1);
    const call = onAbstain.mock.calls[0][0];
    expect(call.abstainReason).toBe('chapter_not_ready');
    expect(call.suggestedAlternatives).toEqual(suggestedAlternatives);
    expect(call.suggestedAlternatives).toHaveLength(2);
  });

  // ─── Test 5: traceId propagates ──────────────────────────────────────────

  it('traceId propagates from JSON payload to onAbstain', () => {
    const onAbstain = vi.fn();
    jsonFallbackBranch(
      {
        groundingStatus: 'hard-abstain',
        abstainReason: 'no_chunks_retrieved',
        suggestedAlternatives: [],
        traceId: 'trace-9-maths-polynomials-001',
      },
      { onAbstain, onDone: vi.fn(), onText: vi.fn() },
    );
    expect(onAbstain).toHaveBeenCalledTimes(1);
    expect(onAbstain.mock.calls[0][0].traceId).toBe('trace-9-maths-polynomials-001');
  });
});

// ─── Test 6: defensive empty-content fallback in streaming branch ──────────
// Mirror of the post-fix onDone callback empty-content guard at lines ~1027-1040
// of src/app/foxy/page.tsx. Triggers when stream completes with no delta and
// the bubble is still empty (no abstain, no groundedFromChunks).

describe('Foxy streaming defensive empty-content fallback', () => {
  interface BubbleState {
    id: number;
    content: string;
    groundingStatus?: GroundingStatus;
  }

  /** Mirror of the empty-content guard inside the streaming-branch onDone. */
  function applyEmptyContentGuard(
    bubble: BubbleState,
    info: { groundedFromChunks: boolean },
    language: 'en' | 'hi',
  ): BubbleState {
    if (bubble.content && bubble.content.length > 0) return bubble;
    if (bubble.groundingStatus === 'hard-abstain') return bubble;
    if (info.groundedFromChunks === true) return bubble;
    return {
      ...bubble,
      content: language === 'hi'
        ? 'मैं अभी जवाब नहीं दे सका। फिर से कोशिश करें या दूसरा chapter चुनें।'
        : "I couldn't generate a response right now. Try rephrasing or pick a different chapter.",
    };
  }

  it('fires when stream completes with empty content, no abstain, no groundedFromChunks', () => {
    const before: BubbleState = { id: 1, content: '' };
    const after = applyEmptyContentGuard(before, { groundedFromChunks: false }, 'en');
    expect(after.content).toBe(
      "I couldn't generate a response right now. Try rephrasing or pick a different chapter.",
    );
  });

  it('does NOT overwrite a hard-abstain bubble (abstain UI owns the empty content)', () => {
    const before: BubbleState = { id: 1, content: '', groundingStatus: 'hard-abstain' };
    const after = applyEmptyContentGuard(before, { groundedFromChunks: false }, 'en');
    expect(after.content).toBe('');
    expect(after.groundingStatus).toBe('hard-abstain');
  });

  it('does NOT fire when content is already populated', () => {
    const before: BubbleState = { id: 1, content: 'Photosynthesis is...' };
    const after = applyEmptyContentGuard(before, { groundedFromChunks: true }, 'en');
    expect(after.content).toBe('Photosynthesis is...');
  });

  it('does NOT fire when server signals groundedFromChunks (real grounded answer pending render)', () => {
    const before: BubbleState = { id: 1, content: '' };
    const after = applyEmptyContentGuard(before, { groundedFromChunks: true }, 'en');
    expect(after.content).toBe('');
  });

  it('uses Hindi copy when language is hi', () => {
    const before: BubbleState = { id: 1, content: '' };
    const after = applyEmptyContentGuard(before, { groundedFromChunks: false }, 'hi');
    expect(after.content).toBe('मैं अभी जवाब नहीं दे सका। फिर से कोशिश करें या दूसरा chapter चुनें।');
  });
});
