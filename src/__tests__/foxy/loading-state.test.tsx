/**
 * LoadingState — renders an honest elapsed-time counter.
 *
 * Per spec §6.7/§9.6, the loading state MUST NOT fabricate stage messages
 * like "Checking NCERT references...". It shows only the truth: time
 * elapsed, plus a "taking longer than usual" nudge after 15s.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockIsHi = { value: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

import { LoadingState } from '@/components/foxy/LoadingState';

describe('LoadingState', () => {
  beforeEach(() => {
    mockIsHi.value = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the spinner + initial "thinking... 0s" (EN)', () => {
    render(<LoadingState />);
    const primary = screen.getByTestId('foxy-loading-primary');
    expect(primary.textContent).toBe('Foxy is thinking... 0s');
    expect(screen.queryByTestId('foxy-loading-long-wait')).not.toBeInTheDocument();
  });

  it('renders the Hindi primary copy when isHi = true', () => {
    mockIsHi.value = true;
    render(<LoadingState />);
    expect(screen.getByTestId('foxy-loading-primary').textContent).toContain('Foxy soch raha hai');
  });

  it('updates the elapsed counter every second', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('foxy-loading-primary').textContent).toContain('0s');

    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByTestId('foxy-loading-primary').textContent).toContain('5s');
  });

  it('adds the long-wait nudge only after 15s elapsed (EN)', () => {
    render(<LoadingState />);
    expect(screen.queryByTestId('foxy-loading-long-wait')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(14000); });
    expect(screen.queryByTestId('foxy-loading-long-wait')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    const longWait = screen.getByTestId('foxy-loading-long-wait');
    expect(longWait.textContent?.toLowerCase()).toMatch(/taking longer than usual/);
  });

  it('adds the long-wait nudge in Hindi when isHi = true', () => {
    mockIsHi.value = true;
    render(<LoadingState />);
    act(() => { vi.advanceTimersByTime(15000); });
    expect(screen.getByTestId('foxy-loading-long-wait').textContent).toMatch(/Thoda aur ruko/);
  });

  it('sets role="status" and aria-live="polite" for a11y', () => {
    render(<LoadingState />);
    const el = screen.getByTestId('foxy-loading-state');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('never fabricates NCERT stage messages (honesty-only invariant)', () => {
    render(<LoadingState />);
    act(() => { vi.advanceTimersByTime(30000); });
    const html = screen.getByTestId('foxy-loading-state').innerHTML;
    // Must NOT include any fake retrieval-stage copy
    expect(html).not.toMatch(/checking (your )?ncert/i);
    expect(html).not.toMatch(/searching (the )?chapter/i);
    expect(html).not.toMatch(/retrieving/i);
  });

  it('supports a primaryLabel override (e.g. image OCR state)', () => {
    render(<LoadingState primaryLabel="📷 Reading your handwriting" />);
    expect(screen.getByTestId('foxy-loading-primary').textContent).toContain('Reading your handwriting');
  });

  it('omits the elapsed counter when showElapsed=false', () => {
    render(<LoadingState showElapsed={false} />);
    const primary = screen.getByTestId('foxy-loading-primary');
    expect(primary.textContent).toBe('Foxy is thinking');
  });
});