/**
 * ChatBubble grounding-status rendering tests.
 *
 * Verifies the Phase 3 wiring between the /api/foxy response shape and the
 * UI. The real <UnverifiedBanner /> and <HardAbstainCard /> components are
 * built in Tasks 3.11/3.12 — for now, ChatBubble renders placeholder
 * markup with stable `data-testid` hooks so these tests will keep passing
 * once the real components replace them.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatBubble } from '@/components/foxy/ChatBubble';

const baseProps = {
  role: 'tutor' as const,
  content: <span>Hello</span>,
  rawContent: 'Hello',
  timestamp: new Date('2026-04-17T12:00:00Z').toISOString(),
  studentName: 'Test Student',
  color: '#10B981',
  activeSubject: 'science',
  onFeedback: vi.fn(),
  onReport: vi.fn(),
};

describe('ChatBubble — groundingStatus="grounded"', () => {
  it('renders the message body with no banner or abstain card', () => {
    render(<ChatBubble {...baseProps} groundingStatus="grounded" />);

    expect(screen.queryByTestId('unverified-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hard-abstain-card')).not.toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders normally when groundingStatus is undefined (back-compat)', () => {
    render(<ChatBubble {...baseProps} />);

    expect(screen.queryByTestId('unverified-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hard-abstain-card')).not.toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});

describe('ChatBubble — groundingStatus="unverified"', () => {
  it('renders the placeholder unverified banner above the message', () => {
    render(<ChatBubble {...baseProps} groundingStatus="unverified" traceId="trace-abc" />);

    const banner = screen.getByTestId('unverified-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'status');
    // The placeholder copy must explain the low-confidence state somehow
    expect(banner.textContent?.toLowerCase()).toMatch(/confidence|verify|double-check/);

    // Message body is still rendered
    expect(screen.getByText('Hello')).toBeInTheDocument();

    // No abstain card
    expect(screen.queryByTestId('hard-abstain-card')).not.toBeInTheDocument();
  });
});

describe('ChatBubble — groundingStatus="hard-abstain"', () => {
  it('renders the placeholder hard-abstain card and suppresses the message body', () => {
    render(
      <ChatBubble
        {...baseProps}
        groundingStatus="hard-abstain"
        abstainReason="chapter_not_ready"
        suggestedAlternatives={[
          { grade: '9', subject_code: 'science', chapter_number: 5, chapter_title: 'Atoms', rag_status: 'ready' },
        ]}
      />,
    );

    const card = screen.getByTestId('hard-abstain-card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('role', 'status');

    // Suggested alternative is surfaced
    expect(card.textContent).toContain('Atoms');

    // No unverified banner
    expect(screen.queryByTestId('unverified-banner')).not.toBeInTheDocument();

    // Body content is suppressed (service returned empty answer)
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });

  it('renders an upstream-error message when abstain reason is circuit_open', () => {
    render(
      <ChatBubble
        {...baseProps}
        groundingStatus="hard-abstain"
        abstainReason="circuit_open"
      />,
    );

    const card = screen.getByTestId('hard-abstain-card');
    expect(card.textContent?.toLowerCase()).toMatch(/temporarily unavailable|try again/);
  });
});

describe('ChatBubble — student role', () => {
  it('never renders banners on student bubbles even if props are passed', () => {
    render(
      <ChatBubble
        {...baseProps}
        role="student"
        groundingStatus="unverified"
      />,
    );

    expect(screen.queryByTestId('unverified-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hard-abstain-card')).not.toBeInTheDocument();
  });
});