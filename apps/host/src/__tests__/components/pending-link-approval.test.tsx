/**
 * REG-199 (companion) — PendingLinkApproval render behaviour (P7/P15).
 *
 * The anti-orphan source pin in `parent-login-consent.test.ts` proves the card
 * is WIRED into the live `StudentOSDashboard`. This light jsdom render test
 * proves the card the dashboard mounts actually WORKS:
 *   - it self-hides when there are no pending links (zero-cost when nothing is
 *     pending — the dashboard mounts it unconditionally), and
 *   - it surfaces an actionable Approve/Reject affordance + the parent's name
 *     when a request IS pending, so a real consent request is the first thing
 *     the child can act on.
 *
 * Mounting the FULL StudentOSDashboard is not feasible cheaply (it pulls auth,
 * SWR, many data hooks + dynamic imports), so we render the component the
 * dashboard wires in directly — the source pin covers the wiring, this covers
 * the behaviour. `fetch` is stubbed so the approve action never hits the network.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PendingLinkApproval, { type PendingLink } from '@alfanumrik/ui/dashboard/PendingLinkApproval';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PENDING: PendingLink[] = [
  { id: 'link-1', parentName: 'Asha', requestedAt: new Date().toISOString() },
];

describe('REG-199 companion — PendingLinkApproval renders the consent card', () => {
  it('self-hides (renders nothing) when there are no pending links', () => {
    const { container } = render(
      <PendingLinkApproval links={[]} onApproved={() => {}} isHi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the parent name + an Approve and a Reject control for a pending request (EN)', () => {
    render(<PendingLinkApproval links={PENDING} onApproved={() => {}} isHi={false} />);
    expect(screen.getByText('Parent Link Request')).toBeTruthy();
    // The canonical Avatar primitive also emits a visually-hidden sr-only <span>
    // copy of the name, so a bare getByText('Asha') now matches twice. Scope to
    // the visible <p> so the assertion still enforces "parent name is shown"
    // without weakening it.
    expect(screen.getByText('Asha', { selector: 'p' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  it('renders the Hindi heading when isHi (P7 — bilingual consent surface)', () => {
    render(<PendingLinkApproval links={PENDING} onApproved={() => {}} isHi={true} />);
    expect(screen.getByText('अभिभावक लिंक अनुरोध')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'स्वीकार करें' })).toBeTruthy();
  });
});
