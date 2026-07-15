import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * ChatInput — the opt-in `collapsibleTools` progressive-disclosure contract
 * (desktop Foxy composer redesign, 2026-07).
 *
 * Contract:
 *   - DEFAULT (prop omitted / false): the `fx Math / 1. Points / Photo / Voice`
 *     tool row renders INLINE, exactly as before. There is NO +/× toggle. This
 *     is the byte-parity guarantee for every existing caller (the shared
 *     composer, /help-style usages) — the redesign must not change them.
 *   - collapsibleTools=true (Foxy composer only): the tool row AND the math
 *     symbol panel are hidden behind a single "+"/"×" toggle so the chat thread
 *     reclaims the vertical space. Every action stays reachable one tap away.
 *
 * We render the REAL ChatInput and mock only its leaf dependencies (subjects
 * lookup, Web Speech, python-voice flag, auth, supabase session, toast) so the
 * assertions are about the actual composer DOM, not a stub.
 */

vi.mock('@alfanumrik/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => (_code: string) => ({
    code: 'science',
    name: 'Science',
    icon: '⚛',
    color: '#10B981',
  }),
}));
// stt:true so the Voice button is part of the tool row (feature-detected once).
vi.mock('@alfanumrik/lib/voice', () => ({
  isVoiceSupported: () => ({ stt: true, tts: true }),
  startListening: () => ({ stop: () => {} }),
}));
vi.mock('@alfanumrik/lib/voice-feature-flag', () => ({
  usePythonVoiceEnabled: () => false,
}));
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ student: { id: 's-1' } }),
}));
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));
vi.mock('@alfanumrik/ui/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { ChatInput } from '@alfanumrik/ui/foxy/ChatInput';

const baseProps = {
  onSubmit: vi.fn(),
  subjectKey: 'science',
  disabled: false,
  language: 'en',
};

beforeEach(() => {
  cleanup();
});

describe('ChatInput — collapsibleTools DEFAULT-OFF (byte-parity for existing callers)', () => {
  it('renders the fx Math / Points / Photo / Voice row inline and NO +/× toggle', () => {
    render(<ChatInput {...baseProps} />);
    // The full tool row is present up-front (legacy layout).
    expect(screen.getByText('fx Math')).toBeTruthy();
    expect(screen.getByText('1. Points')).toBeTruthy();
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.getByText('Voice')).toBeTruthy();
    // There is no progressive-disclosure toggle in the legacy layout.
    expect(screen.queryByLabelText(/Show tools|Hide tools/i)).toBeNull();
    // The composer textarea is always present.
    expect(document.querySelector('textarea')).toBeTruthy();
  });

  it('explicit collapsibleTools={false} is identical to omitting the prop', () => {
    render(<ChatInput {...baseProps} collapsibleTools={false} />);
    expect(screen.getByText('fx Math')).toBeTruthy();
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.queryByLabelText(/Show tools|Hide tools/i)).toBeNull();
  });
});

describe('ChatInput — collapsibleTools=true gates the tool row + math panel behind the toggle', () => {
  it('collapses the tool row and math panel until the + toggle is opened', () => {
    render(<ChatInput {...baseProps} collapsibleTools />);
    // Tool row collapsed: none of the tool buttons are in the DOM yet.
    expect(screen.queryByText('fx Math')).toBeNull();
    expect(screen.queryByText('1. Points')).toBeNull();
    expect(screen.queryByText('Photo')).toBeNull();
    expect(screen.queryByText('Voice')).toBeNull();
    // The math symbol panel is unreachable while collapsed (√ is a panel-only glyph).
    expect(screen.queryByText('√')).toBeNull();
    // The single toggle IS present, labelled for accessibility, and the composer
    // textarea still renders (the composer itself is never gated).
    const toggle = screen.getByLabelText(/Show tools/i);
    expect(toggle).toBeTruthy();
    expect(document.querySelector('textarea')).toBeTruthy();
  });

  it('opening the toggle reveals the tool row; the math panel is one more tap away', () => {
    render(<ChatInput {...baseProps} collapsibleTools />);
    fireEvent.click(screen.getByLabelText(/Show tools/i));
    // Tool row now visible.
    expect(screen.getByText('fx Math')).toBeTruthy();
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.getByText('Voice')).toBeTruthy();
    // Toggle now advertises the collapse affordance.
    expect(screen.getByLabelText(/Hide tools/i)).toBeTruthy();
    // Math panel still gated behind fx Math — opening it reveals the symbol grid.
    expect(screen.queryByText('√')).toBeNull();
    fireEvent.click(screen.getByText('fx Math'));
    expect(screen.getByText('√')).toBeTruthy();
  });
});
