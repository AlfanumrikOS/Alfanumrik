import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * GUARD #9 — ChatBubble SymPy-verifier BADGE rendering (Part 1D + Reasoning v2
 * Phase 1, display-only).
 *
 * The server computes `badgeState` ('verified' | 'check_manually' | 'none' |
 * 'out_of_scope') and the bubble renders it VERBATIM (never recomputed
 * client-side):
 *   - 'verified'        -> green "Verified" pill, bilingual (EN + Hindi via isHi).
 *   - 'check_manually'  -> amber "Check this yourself" pill, bilingual.
 *   - 'out_of_scope'    -> neutral/info "Outside Current Chapter" pill, bilingual,
 *     with an explanatory tooltip (Reasoning v2 Phase 1 curriculum-scope guard).
 *   - 'none' / undefined -> NO badge element in the DOM (zero spacing, zero
 *     wrapper) so non-math + legacy tutor bubbles stay byte-identical.
 *
 * Student bubbles never show the badge (it's a tutor-answer affordance).
 */

let _isHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi }),
}));
// ReportIssueModal pulls supabase; stub so the module graph resolves.
vi.mock('@alfanumrik/ui/foxy/ReportIssueModal', () => ({ ReportIssueModal: () => null }));

import ChatBubble from '@alfanumrik/ui/foxy/ChatBubble';

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    role: 'tutor' as const,
    content: <div>5/4 is the sum.</div>,
    rawContent: '5/4 is the sum.',
    timestamp: '2026-06-14T12:00:00.000Z',
    color: '#10B981',
    activeSubject: 'math',
    onFeedback: vi.fn(),
    onReport: vi.fn(),
    messageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  _isHi = false;
});

describe("GUARD #9 — badgeState 'verified' → green Verified pill", () => {
  it('renders a status badge with the EN "Verified" label + ✓ glyph (isHi=false)', () => {
    render(<ChatBubble {...baseProps({ badgeState: 'verified' })} />);
    const badge = screen.getByRole('status', { name: 'Verified' });
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('✓');
    expect(badge.textContent).toMatch(/Verified/);
  });

  it('renders the Hindi label "जांचा गया" when isHi=true (bilingual P7)', () => {
    _isHi = true;
    render(<ChatBubble {...baseProps({ badgeState: 'verified' })} />);
    const badge = screen.getByRole('status', { name: 'जांचा गया' });
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('जांचा गया');
  });
});

describe("GUARD #9 — badgeState 'check_manually' → amber Check-this-yourself pill", () => {
  it('renders the EN "Check this yourself" label + ⚠ glyph (isHi=false)', () => {
    render(<ChatBubble {...baseProps({ badgeState: 'check_manually' })} />);
    const badge = screen.getByRole('status', { name: 'Check this yourself' });
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('⚠');
    expect(badge.textContent).toMatch(/Check this yourself/);
  });

  it('renders the Hindi label "खुद जांचें" when isHi=true', () => {
    _isHi = true;
    render(<ChatBubble {...baseProps({ badgeState: 'check_manually' })} />);
    const badge = screen.getByRole('status', { name: 'खुद जांचें' });
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('खुद जांचें');
  });

  it('the verified and check_manually labels are DISTINCT (no copy collision)', () => {
    render(<ChatBubble {...baseProps({ badgeState: 'verified' })} />);
    expect(screen.queryByRole('status', { name: 'Check this yourself' })).toBeNull();
    cleanup();
    render(<ChatBubble {...baseProps({ badgeState: 'check_manually' })} />);
    expect(screen.queryByRole('status', { name: 'Verified' })).toBeNull();
  });
});

describe("GUARD #9 — badgeState 'out_of_scope' → neutral Outside-Current-Chapter pill (Reasoning v2 Phase 1)", () => {
  it('renders the EN "Outside Current Chapter" label + 📚 glyph + aria-label + tooltip (isHi=false)', () => {
    render(<ChatBubble {...baseProps({ badgeState: 'out_of_scope' })} />);
    const badge = screen.getByRole('status', { name: 'Outside current chapter' });
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('📚');
    expect(badge.textContent).toMatch(/Outside Current Chapter/);
    // aria-label is present (accessibility).
    expect(badge).toHaveAttribute('aria-label', 'Outside current chapter');
    // Explanatory tooltip present (title attribute) on the EN pill.
    expect(badge).toHaveAttribute('title', expect.stringMatching(/does not belong to the selected class\/chapter/i));
  });

  it('renders the Hindi label "अध्याय से बाहर" + Hindi tooltip when isHi=true (bilingual P7)', () => {
    _isHi = true;
    render(<ChatBubble {...baseProps({ badgeState: 'out_of_scope' })} />);
    const badge = screen.getByRole('status', { name: 'अध्याय से बाहर' });
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('अध्याय से बाहर');
    expect(badge).toHaveAttribute('title', expect.stringMatching(/कक्षा\/अध्याय/));
  });

  it('the out_of_scope pill is NEUTRAL — it is NOT the verified or check_manually pill', () => {
    render(<ChatBubble {...baseProps({ badgeState: 'out_of_scope' })} />);
    // No green Verified pill and no amber Check pill — distinct copy.
    expect(screen.queryByRole('status', { name: 'Verified' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Check this yourself' })).toBeNull();
    // The message body still renders alongside the pill.
    expect(screen.getByText('5/4 is the sum.')).toBeInTheDocument();
  });

  it('a STUDENT bubble never renders the out_of_scope pill (tutor-only affordance)', () => {
    render(
      <ChatBubble
        {...baseProps({ role: 'student', studentName: 'Aarav', badgeState: 'out_of_scope' })}
      />,
    );
    expect(screen.queryByRole('status', { name: 'Outside current chapter' })).toBeNull();
  });
});

describe("GUARD #9 — badgeState 'none' / undefined → NO badge element", () => {
  it("'none' renders no Verified/Check/Outside badge at all", () => {
    render(<ChatBubble {...baseProps({ badgeState: 'none' })} />);
    expect(screen.queryByRole('status', { name: 'Verified' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Check this yourself' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Outside current chapter' })).toBeNull();
    // The message body still renders.
    expect(screen.getByText('5/4 is the sum.')).toBeInTheDocument();
  });

  it('undefined badgeState renders no badge (legacy/non-math bubbles unchanged)', () => {
    render(<ChatBubble {...baseProps({})} />);
    expect(screen.queryByRole('status', { name: 'Verified' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Check this yourself' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Outside current chapter' })).toBeNull();
  });
});

describe('GUARD #9 — badge is a tutor-only affordance', () => {
  it('a STUDENT bubble never renders a verified badge even when badgeState is set', () => {
    render(
      <ChatBubble
        {...baseProps({
          role: 'student',
          studentName: 'Aarav',
          badgeState: 'verified',
        })}
      />,
    );
    expect(screen.queryByRole('status', { name: 'Verified' })).toBeNull();
  });

  it('a hard-abstain tutor bubble suppresses the badge (content empty, no over-claim)', () => {
    render(
      <ChatBubble
        {...baseProps({
          badgeState: 'verified',
          groundingStatus: 'hard-abstain',
          abstainReason: 'chapter_not_ready',
        })}
      />,
    );
    expect(screen.queryByRole('status', { name: 'Verified' })).toBeNull();
  });
});
