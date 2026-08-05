/**
 * D6 (Foxy North-Star Phase 2) — ConfidencePrompt component.
 *
 * Pins:
 *   - renders the bilingual 1-tap 1-5 scale (5 options, 44px touch targets);
 *   - a tap reports the value exactly once (double-tap guarded) and hides;
 *   - auto-dismisses after the timeout, reporting onDismiss (not onSelect);
 *   - sampling helper shouldPromptConfidence is DETERMINISTIC (no
 *     Math.random) — every 3rd question index, stable across calls.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import ConfidencePrompt, { shouldPromptConfidence } from '@alfanumrik/ui/quiz/ConfidencePrompt';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('shouldPromptConfidence — deterministic ~30% sampling', () => {
  it('samples every 3rd question index (0, 3, 6, …)', () => {
    expect(shouldPromptConfidence(0)).toBe(true);
    expect(shouldPromptConfidence(1)).toBe(false);
    expect(shouldPromptConfidence(2)).toBe(false);
    expect(shouldPromptConfidence(3)).toBe(true);
    expect(shouldPromptConfidence(4)).toBe(false);
    expect(shouldPromptConfidence(5)).toBe(false);
    expect(shouldPromptConfidence(6)).toBe(true);
  });

  it('is stable across repeated calls (no randomness)', () => {
    for (let i = 0; i < 20; i++) {
      const first = shouldPromptConfidence(i);
      for (let rep = 0; rep < 5; rep++) {
        expect(shouldPromptConfidence(i)).toBe(first);
      }
    }
  });
});

describe('ConfidencePrompt', () => {
  it('renders the English label and all 5 tap targets (min 44px)', () => {
    render(<ConfidencePrompt isHi={false} onSelect={vi.fn()} />);
    expect(screen.getByText('How sure are you?')).toBeTruthy();
    for (let v = 1; v <= 5; v++) {
      const btn = screen.getByTestId(`confidence-option-${v}`);
      expect(btn.style.minWidth).toBe('44px');
      expect(btn.style.minHeight).toBe('44px');
    }
  });

  it('renders the Hindi label when isHi', () => {
    render(<ConfidencePrompt isHi onSelect={vi.fn()} />);
    expect(screen.getByText('कितना यकीन है?')).toBeTruthy();
  });

  it('reports the tapped value exactly once and hides (double-tap guarded)', () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    render(<ConfidencePrompt isHi={false} onSelect={onSelect} onDismiss={onDismiss} />);
    const btn = screen.getByTestId('confidence-option-4');
    fireEvent.click(btn);
    fireEvent.click(btn); // second tap — must not double-report
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(4);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confidence-prompt')).toBeNull();
  });

  it('auto-dismisses after the timeout without reporting a value', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ConfidencePrompt isHi={false} onSelect={onSelect} onDismiss={onDismiss} autoDismissMs={3000} />,
    );
    expect(screen.getByTestId('confidence-prompt')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2999); });
    expect(screen.getByTestId('confidence-prompt')).toBeTruthy(); // not yet
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('confidence-prompt')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('autoDismissMs=0 disables auto-dismiss', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ConfidencePrompt isHi={false} onSelect={vi.fn()} onDismiss={onDismiss} autoDismissMs={0} />,
    );
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId('confidence-prompt')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
