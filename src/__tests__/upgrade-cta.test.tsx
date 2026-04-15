import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpgradeCTA } from '@/components/ui';

/**
 * Phase 5B Surface 3 — Upgrade-entry consolidation.
 * <UpgradeCTA> is the proactive counterpart to <UpgradeModal> (which fires
 * on "daily limit reached"). This suite guards its public contract.
 */

describe('UpgradeCTA', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  it('renders pill variant by default with a default label', () => {
    render(<UpgradeCTA />);
    const cta = screen.getByTestId('upgrade-cta-pill');
    expect(cta).toBeTruthy();
    expect(cta.textContent).toMatch(/upgrade/i);
  });

  it('renders card variant when requested with subtitle', () => {
    render(<UpgradeCTA variant="card" label="Upgrade to Pro" subtitle="Unlimited quizzes" />);
    expect(screen.getByTestId('upgrade-cta-card')).toBeTruthy();
    expect(screen.getByText(/upgrade to pro/i)).toBeTruthy();
    expect(screen.getByText(/unlimited quizzes/i)).toBeTruthy();
  });

  it('defaults href to /pricing', () => {
    render(<UpgradeCTA />);
    const link = screen.getByTestId('upgrade-cta-pill') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/pricing');
  });

  it('honours a custom href', () => {
    render(<UpgradeCTA href="/billing" />);
    const link = screen.getByTestId('upgrade-cta-pill') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/billing');
  });

  it('dispatches alfanumrik:upgrade-cta-click with the source tag when clicked', () => {
    render(<UpgradeCTA source="profile_row" />);
    fireEvent.click(screen.getByTestId('upgrade-cta-pill'));
    const events = dispatchSpy.mock.calls
      .map(call => call[0])
      .filter((e): e is CustomEvent =>
        e instanceof CustomEvent && e.type === 'alfanumrik:upgrade-cta-click',
      );
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.detail).toMatchObject({ source: 'profile_row', variant: 'pill' });
  });

  it('calls onClick handler and prevents default navigation when provided', () => {
    const onClick = vi.fn();
    render(<UpgradeCTA onClick={onClick} source="test" />);
    const link = screen.getByTestId('upgrade-cta-pill');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not dispatch the analytics event when source is not provided', () => {
    render(<UpgradeCTA />);
    fireEvent.click(screen.getByTestId('upgrade-cta-pill'));
    const upgradeEvents = dispatchSpy.mock.calls
      .map(call => call[0])
      .filter((e): e is CustomEvent =>
        e instanceof CustomEvent && e.type === 'alfanumrik:upgrade-cta-click',
      );
    expect(upgradeEvents.length).toBe(0);
  });
});