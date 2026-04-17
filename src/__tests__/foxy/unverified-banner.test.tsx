/**
 * UnverifiedBanner — render + interaction tests.
 *
 * Covers:
 *  - EN copy when isHi=false, HI copy when isHi=true (P7)
 *  - Action button invokes onShowChapters
 *  - traceId appears in the title attribute for support/debug
 *  - data-testid preserved for Batch 3A compatibility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockIsHi = { value: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

import { UnverifiedBanner } from '@/components/foxy/UnverifiedBanner';

describe('UnverifiedBanner', () => {
  beforeEach(() => {
    mockIsHi.value = false;
  });

  it('renders English copy by default (isHi = false)', () => {
    render(<UnverifiedBanner />);
    const banner = screen.getByTestId('unverified-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent?.toLowerCase()).toMatch(/ncert textbook/);
    expect(banner.textContent?.toLowerCase()).toMatch(/verify with your book/);
  });

  it('renders Hindi (romanized) copy when isHi = true', () => {
    mockIsHi.value = true;
    render(<UnverifiedBanner />);
    const banner = screen.getByTestId('unverified-banner');
    expect(banner.textContent).toMatch(/NCERT kitaab/);
    expect(banner.textContent).toMatch(/apni kitaab se check karein/);
  });

  it('sets role="status" for accessibility', () => {
    render(<UnverifiedBanner />);
    expect(screen.getByTestId('unverified-banner')).toHaveAttribute('role', 'status');
  });

  it('includes traceId in the title attribute when provided', () => {
    render(<UnverifiedBanner traceId="trace-xyz-123" />);
    expect(screen.getByTestId('unverified-banner')).toHaveAttribute('title', 'trace: trace-xyz-123');
  });

  it('does not render the action button when onShowChapters is omitted', () => {
    render(<UnverifiedBanner />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onShowChapters when the action button is clicked (EN)', () => {
    const onShow = vi.fn();
    render(<UnverifiedBanner onShowChapters={onShow} />);
    const btn = screen.getByRole('button', { name: /show me ncert chapters/i });
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('calls onShowChapters when the action button is clicked (HI)', () => {
    mockIsHi.value = true;
    const onShow = vi.fn();
    render(<UnverifiedBanner onShowChapters={onShow} />);
    const btn = screen.getByRole('button', { name: /NCERT chapters available/i });
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('preserves data-testid for Batch 3A test compatibility', () => {
    const { container } = render(<UnverifiedBanner />);
    expect(container.querySelector('[data-testid="unverified-banner"]')).not.toBeNull();
  });
});