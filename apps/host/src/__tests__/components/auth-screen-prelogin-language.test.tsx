/**
 * AuthScreen — pre-login EN/हिंदी language toggle (light render unit).
 *
 * Change (2026-06-16)
 *   The signup/login screen is now bilingual BEFORE there is a session. There is
 *   no AuthContext at this point, so AuthScreen reads/writes the language choice
 *   directly from localStorage under the key 'alfanumrik_language' (values
 *   'en' | 'hi') — the SAME key AuthContext bootstraps `isHi` from, so the choice
 *   carries into the app after sign-in. A toggle pill (EN | हिंदी) lets the user
 *   switch before logging in.
 *
 *   These tests pin the contract lightly:
 *     - localStorage 'alfanumrik_language'='hi' ⇒ Hindi copy renders + the pill
 *       shows हिंदी pressed.
 *     - default ('en' / unset) ⇒ English copy renders + EN pressed.
 *
 *   The toggle pill itself is always present in both languages. We mock only the
 *   Supabase client seam (no network at render) — everything else is the real
 *   component, so the bilingual copy is assertable on screen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import React from 'react';

// AuthScreen imports the Supabase client at module scope; stub it so no network
// is touched on render. None of these are called during a plain render.
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      resend: vi.fn(),
    },
  },
}));

import { AuthScreen } from '@alfanumrik/ui/auth/AuthScreen';

const renderAuth = () => render(React.createElement(AuthScreen, { onSuccess: vi.fn() }));

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthScreen — language toggle pill is always present', () => {
  it('renders the EN | हिंदी toggle group', () => {
    renderAuth();
    // The pill is a role="group" with both language buttons inside.
    const group = screen.getByRole('group', { name: /Language|भाषा/ });
    expect(within(group).getByRole('button', { name: 'EN' })).toBeDefined();
    expect(within(group).getByRole('button', { name: 'हिंदी' })).toBeDefined();
  });
});

describe('AuthScreen — default English (no stored language)', () => {
  it('renders English copy and marks EN as pressed', () => {
    // localStorage unset → defaults to English.
    renderAuth();

    // Known English strings from the login view.
    expect(screen.getByText('Welcome Back!')).toBeDefined();
    expect(screen.getByText('AI Tutor for CBSE Students')).toBeDefined();

    // EN pill is pressed, हिंदी is not.
    const group = screen.getByRole('group', { name: /Language|भाषा/ });
    expect(within(group).getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'हिंदी' }).getAttribute('aria-pressed')).toBe('false');

    // No Hindi welcome heading should appear in the English default.
    expect(screen.queryByText('फिर से स्वागत है!')).toBeNull();
  });
});

describe('AuthScreen — Hindi when localStorage alfanumrik_language=hi', () => {
  it('renders Hindi copy and marks हिंदी as pressed', () => {
    window.localStorage.setItem('alfanumrik_language', 'hi');
    renderAuth();

    // Known Hindi strings: login heading + the student subtitle.
    expect(screen.getByText('फिर से स्वागत है!')).toBeDefined();
    expect(screen.getByText('CBSE विद्यार्थियों के लिए AI ट्यूटर')).toBeDefined();

    // हिंदी pill is pressed, EN is not.
    const group = screen.getByRole('group', { name: /Language|भाषा/ });
    expect(within(group).getByRole('button', { name: 'हिंदी' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('false');

    // The English welcome heading must NOT appear when Hindi is active.
    expect(screen.queryByText('Welcome Back!')).toBeNull();
  });
});
