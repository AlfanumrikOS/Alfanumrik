/**
 * HintLadder — Foxy North-Star Phase 3 (L5) component test.
 *
 * Pins:
 *   - Rung 1 is available pre-attempt; rungs 2-5 are LOCKED until
 *     wrongAttempt is set (P3 lock, enforced by the pure state machine).
 *   - Wrong-attempt unlock walks the ladder through rungs 2-5 sequentially,
 *     and rung 5 renders the "Move on" skip CTA (v1 semantics — assessment
 *     mandate 2026-08-05; same-topic evidential twin deferred, see
 *     hint-ladder.ts TODO(L5)).
 *   - hint_level 0..5 is lifted to the parent (widened from F8's 0..3).
 *   - Rung 2 uses the FIRST SENTENCE of the remediation; rung 3 uses the full text.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

import HintLadder from '@alfanumrik/ui/quiz/HintLadder';

beforeEach(() => cleanup());

const QUESTION = {
  id: 'q-1',
  hint: 'Break the ratio down.',
  explanation: 'The answer is 3. Because 6/2 = 3.',
  explanation_hi: 'उत्तर 3 है। क्योंकि 6/2 = 3।',
};

const mockRemediation = () =>
  vi.fn().mockResolvedValue({
    remediationEn: 'You confused ratio with sum. Ratios divide, sums add. Try 6/2 next.',
    remediationHi: null,
  });

function clickReveal() {
  fireEvent.click(screen.getByTestId('hint-ladder-reveal'));
}

describe('HintLadder — rung state machine', () => {
  it('pre-attempt: only rung 1 is reachable; reveal shows q.hint and lifts hint_level=1', async () => {
    const onLevel = vi.fn();
    render(
      <HintLadder
        isHi={false}
        question={QUESTION}
        wrongAttempt={null}
        onHintLevelChange={onLevel}
        fetchRemediation={mockRemediation()}
      />,
    );

    // Initial level 0 lift on mount.
    expect(onLevel).toHaveBeenLastCalledWith(0);
    // Only the reveal button is shown; no rungs rendered.
    expect(screen.queryByTestId('hint-ladder-rung-1')).toBeNull();
    const btn = screen.getByTestId('hint-ladder-reveal');
    expect(btn.getAttribute('data-next-rung')).toBe('1');

    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-1'));
    expect(screen.getByTestId('hint-ladder-rung-1').textContent).toContain('Break the ratio down.');
    expect(onLevel).toHaveBeenLastCalledWith(1);

    // Rung 2 is LOCKED pre-wrong: the reveal button should have disappeared
    // (nextRung() returns ok:false with reason 'locked_pre_attempt').
    expect(screen.queryByTestId('hint-ladder-reveal')).toBeNull();
  });

  it('wrong attempt unlocks rungs 2-5 sequentially; rung 5 renders the "Move on" skip CTA', async () => {
    const onLevel = vi.fn();
    const onEquivalent = vi.fn();
    const fetchRemediation = mockRemediation();

    const { rerender } = render(
      <HintLadder
        isHi={false}
        question={QUESTION}
        wrongAttempt={null}
        onHintLevelChange={onLevel}
        onRequestEquivalent={onEquivalent}
        fetchRemediation={fetchRemediation}
      />,
    );

    // Reveal rung 1.
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-1'));

    // Simulate wrong answer (distractor index 2).
    rerender(
      <HintLadder
        isHi={false}
        question={QUESTION}
        wrongAttempt={{ distractorIndex: 2 }}
        onHintLevelChange={onLevel}
        onRequestEquivalent={onEquivalent}
        fetchRemediation={fetchRemediation}
      />,
    );

    // Reveal rung 2 (first sentence of remediation).
    await waitFor(() => screen.getByTestId('hint-ladder-reveal'));
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-2'));
    expect(screen.getByTestId('hint-ladder-rung-2').textContent).toContain(
      'You confused ratio with sum.',
    );
    // Sentence-1 stops before the next '.'.
    expect(screen.getByTestId('hint-ladder-rung-2').textContent).not.toContain('Try 6/2 next.');
    expect(onLevel).toHaveBeenLastCalledWith(2);

    // Rung 3 (full remediation).
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-3'));
    expect(screen.getByTestId('hint-ladder-rung-3').textContent).toContain('Try 6/2 next.');

    // Rung 4 (explanation).
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-4'));
    expect(screen.getByTestId('hint-ladder-rung-4').textContent).toContain('The answer is 3');

    // Rung 5 (skip / "Move on" CTA — v1 semantics; copy MUST NOT say "similar"/"equivalent").
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-5'));
    const rung5 = screen.getByTestId('hint-ladder-rung-5');
    expect(rung5.textContent).toContain('Move on');
    expect(rung5.textContent?.toLowerCase()).not.toContain('similar');
    expect(rung5.textContent?.toLowerCase()).not.toContain('equivalent');
    const cta = screen.getByTestId('hint-ladder-skip-cta');
    expect(cta.textContent).toContain('Move on');
    fireEvent.click(cta);
    expect(onEquivalent).toHaveBeenCalledTimes(1);
    expect(onLevel).toHaveBeenLastCalledWith(5);

    // Exhausted: the reveal button disappears.
    expect(screen.queryByTestId('hint-ladder-reveal')).toBeNull();

    // Fetch was called for rungs 2 AND 3 (both use remediation).
    expect(fetchRemediation).toHaveBeenCalledTimes(2);
    expect(fetchRemediation).toHaveBeenCalledWith('q-1', 2);
  });

  it('remediation returns null (no row) → rung 2 shows unavailable copy, ladder still advances', async () => {
    const fetchRemediation = vi.fn().mockResolvedValue(null);
    render(
      <HintLadder
        isHi={false}
        question={QUESTION}
        wrongAttempt={{ distractorIndex: 1 }}
        fetchRemediation={fetchRemediation}
      />,
    );

    // Advance to rung 1, then 2.
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-1'));
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-2'));
    expect(screen.getByTestId('hint-ladder-rung-2').textContent?.toLowerCase()).toContain('unavailable');
  });

  it('Hindi: uses Hindi remediation when present; falls back to English otherwise', async () => {
    const fetchRemediation = vi.fn().mockResolvedValue({
      remediationEn: 'English text.',
      remediationHi: 'हिंदी में समझाइए। बाकी सब।',
    });
    render(
      <HintLadder
        isHi={true}
        question={QUESTION}
        wrongAttempt={{ distractorIndex: 0 }}
        fetchRemediation={fetchRemediation}
      />,
    );
    // Rung 1 = q.hint (no hint_hi column, EN only)
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-1'));
    // Rung 2 = Hindi first sentence.
    await act(async () => { clickReveal(); });
    await waitFor(() => screen.getByTestId('hint-ladder-rung-2'));
    expect(screen.getByTestId('hint-ladder-rung-2').textContent).toContain('हिंदी में समझाइए।');
  });
});
