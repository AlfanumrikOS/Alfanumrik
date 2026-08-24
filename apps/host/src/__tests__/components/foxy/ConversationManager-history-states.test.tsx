/**
 * ConversationManager — loading / ERROR / empty are THREE distinct states.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 * The Foxy history rail had two states: "loading" and "everything else". The
 * page fetched sessions client-side over PostgREST and threw the error away
 * (there is a live-bug annotation about it in the old source), so a failed
 * fetch rendered the exact same "No conversations yet 🦊" panel as a brand-new
 * account. Confirmed live on 2026-08-08 against a student with 1,359 real
 * `foxy_sessions` rows: the sidebar was empty, and nothing on screen or in the
 * console said why.
 *
 * "We couldn't load this" and "you have nothing here" are opposite facts. A
 * student shown the wrong one concludes their work was deleted. These tests
 * assert the two panels are DISTINGUISHABLE — not merely that an error branch
 * exists somewhere in the tree — and that the error one offers a Retry.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

vi.mock('@alfanumrik/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => null,
}));

import { ConversationManager } from '@alfanumrik/ui/foxy/ConversationManager';
import type { ConversationSummary } from '@alfanumrik/ui/foxy/ConversationManager.utils';

const CONVERSATION: ConversationSummary = {
  id: 's1',
  title: 'how does a convex lens work?',
  subject: 'science',
  messageCount: 2,
  updatedAt: '2026-08-20T10:00:00.000Z',
  isActive: false,
};

function renderRail(overrides: Partial<React.ComponentProps<typeof ConversationManager>> = {}) {
  return render(
    <ConversationManager
      conversations={[]}
      activeConversationId={null}
      isHi={false}
      isOpen={false}
      onSelect={vi.fn()}
      onNewChat={vi.fn()}
      onClose={vi.fn()}
      isLoading={false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  // The desktop rail is `hidden lg:flex`, which jsdom renders regardless —
  // that is fine, the states under test are markup, not layout.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
});
afterEach(() => cleanup());

describe('ConversationManager — the error state is NOT the empty state', () => {
  it('renders the error panel and no empty panel when hasError is set', () => {
    renderRail({ hasError: true, conversations: [] });

    expect(screen.getAllByTestId('conversation-list-error').length).toBeGreaterThan(0);
    expect(
      screen.queryByTestId('conversation-list-empty'),
      'an empty panel alongside the error panel is the original defect: the ' +
        'student is told they have no chats when in fact the fetch failed',
    ).toBeNull();
  });

  it('renders the empty panel and no error panel for a genuinely empty account', () => {
    // The control direction. Without it the assertion above would also pass
    // against a component that always renders the error panel.
    renderRail({ hasError: false, conversations: [] });

    expect(screen.getAllByTestId('conversation-list-empty').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('conversation-list-error')).toBeNull();
  });

  it('shows the loading skeleton and NEITHER terminal panel while loading', () => {
    renderRail({ isLoading: true, hasError: false, conversations: [] });

    expect(screen.queryByTestId('conversation-list-empty')).toBeNull();
    expect(screen.queryByTestId('conversation-list-error')).toBeNull();
  });

  it('prefers the error panel over the empty panel when both could apply', () => {
    // hasError with an empty list is the EXACT live case: the fetch failed, so
    // there is nothing in `conversations`. Order matters — an
    // `filtered.length === 0` check placed first would swallow the error.
    renderRail({ isLoading: false, hasError: true, conversations: [] });

    expect(screen.getAllByTestId('conversation-list-error').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('conversation-list-empty')).toBeNull();
  });

  it('uses copy that names the failure, not the absence', () => {
    renderRail({ hasError: true });

    const panel = screen.getAllByTestId('conversation-list-error')[0];
    expect(panel.textContent).toMatch(/couldn't load/i);
    expect(
      panel.textContent,
      'the error panel must not reuse the empty-state copy',
    ).not.toMatch(/No conversations yet/i);
  });

  it('announces the failure assertively rather than silently swapping copy', () => {
    renderRail({ hasError: true });
    const panel = screen.getAllByTestId('conversation-list-error')[0];
    expect(panel.getAttribute('role')).toBe('alert');
  });
});

describe('ConversationManager — the error state offers a way out', () => {
  it('renders a Retry control and calls onRetry when tapped', () => {
    const onRetry = vi.fn();
    renderRail({ hasError: true, onRetry });

    const retry = screen.getAllByTestId('conversation-list-retry')[0];
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('holds the 44px touch floor on the Retry control', () => {
    renderRail({ hasError: true, onRetry: vi.fn() });
    const retry = screen.getAllByTestId('conversation-list-retry')[0] as HTMLElement;
    // The inline fallback is what jsdom can see; the token is what ships.
    expect(retry.style.minHeight).toMatch(/44px|--tap-min/);
    expect(retry.style.minWidth).toMatch(/44px|--tap-min/);
  });

  it('omits the Retry control when no handler is supplied', () => {
    renderRail({ hasError: true });
    expect(screen.queryByTestId('conversation-list-retry')).toBeNull();
  });

  it('renders the error copy in Hindi under isHi (P7)', () => {
    renderRail({ hasError: true, onRetry: vi.fn(), isHi: true });

    const panel = screen.getAllByTestId('conversation-list-error')[0];
    expect(
      panel.textContent,
      `the error panel reads "${panel.textContent}" — it carries no Devanagari, ` +
        'so it is not translated',
    ).toMatch(/[ऀ-ॿ]/);
    // And it must not be the English string sitting under a Hindi flag.
    expect(panel.textContent).not.toMatch(/couldn't load/i);

    const retry = screen.getAllByTestId('conversation-list-retry')[0];
    expect(retry.textContent).toMatch(/[ऀ-ॿ]/);
  });
});

describe('ConversationManager — a failed REFRESH keeps the list readable', () => {
  it('shows a stale banner instead of the full error panel when a list is present', () => {
    // The full panel would replace history the student can still read and
    // still open — its own kind of lie. The full panel is scoped to the
    // EMPTY case (initial-load failure), which is the one that used to render
    // as "No conversations yet".
    renderRail({ hasError: true, conversations: [CONVERSATION], onRetry: vi.fn() });

    expect(screen.getAllByTestId('conversation-list-stale-banner').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('conversation-list-error')).toBeNull();
    expect(screen.queryByTestId('conversation-list-empty')).toBeNull();
    // The list itself survives.
    expect(screen.getAllByText('how does a convex lens work?').length).toBeGreaterThan(0);
  });

  it('does not show the stale banner on a healthy list', () => {
    renderRail({ hasError: false, conversations: [CONVERSATION] });
    expect(screen.queryByTestId('conversation-list-stale-banner')).toBeNull();
  });

  it('translates the stale banner (P7)', () => {
    renderRail({ hasError: true, conversations: [CONVERSATION], onRetry: vi.fn(), isHi: true });
    const banner = screen.getAllByTestId('conversation-list-stale-banner')[0];
    expect(banner.textContent).toMatch(/[ऀ-ॿ]/);
    expect(banner.textContent).not.toMatch(/out of date/i);
  });

  it('wires the stale banner Refresh to the same onRetry handler', () => {
    const onRetry = vi.fn();
    renderRail({ hasError: true, conversations: [CONVERSATION], onRetry });
    fireEvent.click(screen.getAllByTestId('conversation-list-stale-retry')[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ConversationManager — a loaded list still renders', () => {
  it('shows conversations and neither terminal panel on the happy path', () => {
    renderRail({ conversations: [CONVERSATION] });

    expect(screen.getAllByText('how does a convex lens work?').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('conversation-list-empty')).toBeNull();
    expect(screen.queryByTestId('conversation-list-error')).toBeNull();
  });

  it('renders a row with no message preview without inventing filler copy', () => {
    // `lastMessage` is optional now: the list endpoint returns titles/subjects/
    // counts only (P13). The row used to substitute "New chat" for an absent
    // preview, which mislabels a thread that demonstrably HAS messages.
    renderRail({ conversations: [CONVERSATION] });

    const rows = screen.getAllByText('how does a convex lens work?');
    expect(rows.length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/New chat/);
    // The real signal (message count) is still shown.
    expect(document.body.textContent).toMatch(/2 msgs/);
  });
});
