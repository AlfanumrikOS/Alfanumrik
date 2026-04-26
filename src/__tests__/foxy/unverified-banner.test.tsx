/**
 * UnverifiedBanner — render + interaction tests.
 *
 * Covers:
 *  - EN copy when isHi=false, HI copy when isHi=true (P7)
 *  - Action button invokes onShowChapters
 *  - traceId appears in the title attribute for support/debug
 *  - data-testid preserved for Batch 3A compatibility
 *
 * Phase 0 frontend update (2026-04-26): the banner copy was rewritten away
 * from NCERT-branded wording to the bilingual "verified curriculum /
 * सत्यापित पाठ्यक्रम" framing in src/components/foxy/UnverifiedBanner.tsx.
 * Assertions below match the live strings exactly.
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
    // Live EN copy: "...your verified curriculum... ask a specific question..."
    expect(banner.textContent).toMatch(/verified curriculum/);
    expect(banner.textContent).toMatch(/verify with your book/);
    expect(banner.textContent).toMatch(/ask a specific question/);
  });

  it('renders Hindi (Devanagari) copy when isHi = true', () => {
    mockIsHi.value = true;
    render(<UnverifiedBanner />);
    const banner = screen.getByTestId('unverified-banner');
    // Live HI copy: "⚠ यह उत्तर आपके सत्यापित पाठ्यक्रम से नहीं है ..."
    expect(banner.textContent).toMatch(/सत्यापित पाठ्यक्रम/);
    expect(banner.textContent).toMatch(/अपनी किताब से जाँच करें/);
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
    // Live EN action label: "Show me verified curriculum topics I can ask about"
    const btn = screen.getByRole('button', { name: /show me verified curriculum topics/i });
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('calls onShowChapters when the action button is clicked (HI)', () => {
    mockIsHi.value = true;
    const onShow = vi.fn();
    render(<UnverifiedBanner onShowChapters={onShow} />);
    // Live HI action label: "मुझे दिखाइए कौन से सत्यापित पाठ्यक्रम विषय उपलब्ध हैं"
    const btn = screen.getByRole('button', { name: /सत्यापित पाठ्यक्रम विषय/ });
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('preserves data-testid for Batch 3A test compatibility', () => {
    const { container } = render(<UnverifiedBanner />);
    expect(container.querySelector('[data-testid="unverified-banner"]')).not.toBeNull();
  });
});
