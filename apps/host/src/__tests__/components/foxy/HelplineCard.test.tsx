/**
 * Safeguarding helpline card — Foxy North-Star Phase 1.
 *
 * Covers (envelope-driven — the card renders from the message envelope shape,
 * never from any client-side classification):
 *   1. Tutor message carrying `safeguarding: { helpline }` → HelplineCard
 *      renders with a prominent tel: link.
 *   2. badgeState === 'safeguarding' alone (no helpline object) → card still
 *      renders with the Childline 1098 default, and ChatBubble does NOT
 *      receive the 'safeguarding' badge state (it is not a verifier badge).
 *   3. A normal tutor message → no card.
 *   4. Bilingual copy via isHi (P7).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import HelplineCard from '@alfanumrik/ui/foxy/HelplineCard';
import type { ChatMessage } from '@/app/foxy/_lib/foxy-types';

// ── Mock the heavy chat-bubble stack so MessageList renders cheaply ─────────
const chatBubbleProps: Array<Record<string, unknown>> = [];
vi.mock('@alfanumrik/ui/foxy/ChatBubble', () => ({
  default: (props: any) => {
    chatBubbleProps.push(props);
    return <div data-testid="chat-bubble">{props.content}</div>;
  },
}));
vi.mock('@alfanumrik/ui/foxy/StructuredRenderBoundary', () => ({
  StructuredRenderBoundary: ({ children }: any) => <>{children}</>,
}));
vi.mock('@alfanumrik/lib/foxy/is-foxy-response', () => ({ isFoxyResponse: () => false }));
vi.mock('@alfanumrik/lib/foxy/recover-from-text', () => ({ recoverFoxyResponseFromText: () => null }));
vi.mock('@alfanumrik/lib/foxy/denormalize', () => ({ denormalizeFoxyResponse: () => '' }));
vi.mock('@alfanumrik/ui/foxy/RichContent', () => ({
  RichContent: ({ content }: any) => <div>{content}</div>,
}));
vi.mock('@alfanumrik/ui/foxy/FoxyStructuredRenderer', () => ({
  FoxyStructuredRenderer: () => null,
}));
vi.mock('@/app/foxy/_components/DynamicScaffold', () => ({ default: () => null }));
vi.mock('next/image', () => ({
  default: (props: any) => <img alt={props.alt ?? ''} src={props.src} />,
}));

import { MessageList } from '@/app/foxy/_components/MessageList';

function tutorMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    role: 'tutor',
    content: 'I hear you. That sounds really hard.',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function renderList(messages: ChatMessage[], isHi = false) {
  chatBubbleProps.length = 0;
  return render(
    <MessageList
      messages={messages}
      collapsedAbove={null}
      onSetCollapsedAbove={() => {}}
      activeSubject="science"
      cfgColor="#10B981"
      isHi={isHi}
      ttsSupported={false}
      savedMessageIds={new Set()}
      onFeedback={() => {}}
      onReport={() => {}}
      onSaveFlashcard={() => {}}
    />,
  );
}

describe('Safeguarding helpline card (envelope-driven)', () => {
  it('renders the card with a tel: link when the message carries the safeguarding envelope', () => {
    renderList([
      tutorMessage({
        badgeState: 'safeguarding',
        safeguarding: { helpline: { name: 'Childline', number: '1098' } },
      }),
    ]);

    expect(screen.getByTestId('safeguarding-helpline-card')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Childline — 1098/ });
    expect(link.getAttribute('href')).toBe('tel:1098');
    expect(screen.getByText("You're not alone")).toBeTruthy();
  });

  it('falls back to Childline 1098 when only badgeState is present, and filters the badge from ChatBubble', () => {
    renderList([tutorMessage({ badgeState: 'safeguarding' })]);

    expect(screen.getByTestId('safeguarding-helpline-card')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Childline — 1098/ })).toBeTruthy();
    // 'safeguarding' is not a SymPy-verifier state — ChatBubble must not see it.
    expect(chatBubbleProps[0]?.badgeState).toBeUndefined();
  });

  it('does not render the card on a normal tutor message', () => {
    renderList([tutorMessage()]);
    expect(screen.queryByTestId('safeguarding-helpline-card')).toBeNull();
  });

  it('keeps a real verifier badgeState flowing through to ChatBubble untouched', () => {
    renderList([tutorMessage({ badgeState: 'verified' })]);
    expect(screen.queryByTestId('safeguarding-helpline-card')).toBeNull();
    expect(chatBubbleProps[0]?.badgeState).toBe('verified');
  });

  it('renders Hindi copy when isHi is true (P7)', () => {
    renderList(
      [tutorMessage({ safeguarding: { helpline: { name: 'Childline', number: '1098' } } })],
      true,
    );
    expect(screen.getByText('तुम अकेले नहीं हो')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Childline — 1098/ }).getAttribute('href')).toBe('tel:1098');
  });
});

describe('HelplineCard (direct)', () => {
  it('renders English copy and an accessible note role', () => {
    render(<HelplineCard helpline={{ name: 'Childline', number: '1098' }} isHi={false} />);
    expect(screen.getByRole('note', { name: 'Childline helpline 1098' })).toBeTruthy();
    expect(screen.getByText('Free • Confidential • 24x7')).toBeTruthy();
  });

  it('renders Hindi copy when isHi (P7)', () => {
    render(<HelplineCard helpline={{ name: 'Childline', number: '1098' }} isHi={true} />);
    expect(screen.getByRole('note', { name: 'Childline हेल्पलाइन 1098' })).toBeTruthy();
    expect(screen.getByText('मुफ़्त • गोपनीय • 24x7')).toBeTruthy();
  });
});
