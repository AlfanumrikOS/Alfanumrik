/**
 * Wave D "D-encourage" — <EncourageButton> component contract tests.
 *
 * The Encourage button is the parent-facing surface of the preset-cheer feature.
 * It is mounted ONLY when ff_parent_encourage_v1 is ON AND the parent is in
 * guardian-JWT mode (the gate lives in ParentGlanceHome — see
 * parent-glance-home.test.tsx). These tests pin the button's own contract:
 *
 *   1. PRESET-ONLY (P12). The picker labels come STRAIGHT from CHEER_PRESETS —
 *      the component imports the catalog and never duplicates the strings. There
 *      is NO free-text input/textarea: a parent can only pick a curated preset.
 *      A regression that added a text field would breach the P12 boundary
 *      (no parent-authored free text ever reaches a child).
 *   2. POST SHAPE. Selecting a preset POSTs exactly { student_id, message_key }
 *      (the preset's catalog key) to /api/v2/parent/encourage, with the parent's
 *      Supabase JWT in the Authorization header (the guardian-only route gate).
 *   3. RESPONSE MAPPING. 200 → success confirmation; 429 → "already cheered
 *      recently"; 403 / other non-OK / network error → friendly generic error.
 *      No server error text is ever surfaced (P13 — no raw detail to the user).
 *   4. BILINGUAL (P7). All copy switches on `isHi`; numbers/keys stay stable.
 *
 * Only two seams are mocked: the Supabase session helper (for the Bearer token)
 * and global fetch (the network). Behaviour over implementation throughout.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

import { CHEER_PRESETS } from '@alfanumrik/lib/parent/cheer-catalog';

// ─── supabase session helper — returns a parent Bearer token by default. ───
const sessionState: { token: string | null } = { token: 'parent.jwt.token' };
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: sessionState.token ? { access_token: sessionState.token } : null },
        }),
    },
  },
}));

import EncourageButton from '@alfanumrik/ui/parent/EncourageButton';

const ENDPOINT = '/api/v2/parent/encourage';
const STUDENT_ID = 'stu-7';
const CHILD = 'Asha';

/** A fetch mock that resolves to a given status + json body. */
function fetchMock(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  sessionState.token = 'parent.jwt.token';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 — Preset-only render (P12): labels come from CHEER_PRESETS, no free text.
// ═══════════════════════════════════════════════════════════════════════════
describe('EncourageButton — preset-only picker (P12)', () => {
  it('reveals every CHEER_PRESETS title (English) when opened — no duplicated strings', () => {
    const { container } = render(
      <EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />,
    );

    // Closed by default — open the picker via the trigger.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));

    const group = screen.getByRole('group', { name: /pick an encouragement/i });
    // Every catalog title (En) is rendered — sourced from the SAME module the
    // backend reads, so this fails if the component ever forks the strings.
    for (const preset of Object.values(CHEER_PRESETS)) {
      expect(within(group).getByText(preset.titleEn)).toBeInTheDocument();
    }
    // The picker exposes exactly one button per preset.
    const presetButtons = within(group).getAllByRole('button');
    expect(presetButtons).toHaveLength(Object.keys(CHEER_PRESETS).length);

    // HARD P12 BOUNDARY: there is NO free-text affordance anywhere.
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  it('renders Hindi preset titles when isHi is true (P7)', () => {
    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={true} />);
    // Trigger copy is Hindi.
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`${CHILD} को प्रोत्साहित करें`) }),
    );
    const group = screen.getByRole('group', { name: /एक प्रोत्साहन चुनें/ });
    for (const preset of Object.values(CHEER_PRESETS)) {
      expect(within(group).getByText(preset.titleHi)).toBeInTheDocument();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — POST shape: { student_id, message_key } + Bearer auth.
// ═══════════════════════════════════════════════════════════════════════════
describe('EncourageButton — POST contract', () => {
  it('POSTs { student_id, message_key } with the parent Bearer token on preset select', async () => {
    const fetchSpy = fetchMock(200, { success: true });
    globalThis.fetch = fetchSpy;

    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));

    // Pick the "keep_going" preset by its rendered title.
    fireEvent.click(screen.getByText(CHEER_PRESETS.keep_going.titleEn));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    // Bearer token from the Supabase session.
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer parent.jwt.token',
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    // Body is EXACTLY the student id + the preset's catalog key — no free text.
    const parsed = JSON.parse(init.body as string);
    expect(parsed).toEqual({ student_id: STUDENT_ID, message_key: 'keep_going' });
  });

  it('omits the Authorization header when there is no session (route will 401/403)', async () => {
    sessionState.token = null;
    const fetchSpy = fetchMock(403, { success: false, error: 'Forbidden' });
    globalThis.fetch = fetchSpy;

    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));
    fireEvent.click(screen.getByText(CHEER_PRESETS.great_work.titleEn));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — Response mapping: 200 → success, 429 → recently cheered, other → error.
// ═══════════════════════════════════════════════════════════════════════════
describe('EncourageButton — response mapping', () => {
  it('maps 200 → a success confirmation naming the child (P7 bilingual)', async () => {
    globalThis.fetch = fetchMock(200, { success: true });
    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));
    fireEvent.click(screen.getByText(CHEER_PRESETS.so_proud.titleEn));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(new RegExp(`Sent to ${CHILD}`, 'i'));
  });

  it('maps 429 → an "already cheered recently" message (no server text leaked)', async () => {
    globalThis.fetch = fetchMock(429, {
      success: false,
      error: 'You have already cheered recently. / आपने हाल ही में प्रोत्साहन भेजा है।',
    });
    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));
    fireEvent.click(screen.getByText(CHEER_PRESETS.streak_star.titleEn));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/already cheered .* recently/i);
    // The component shows its own copy, not the raw server string.
    expect(status.textContent).not.toMatch(/आपने हाल ही में/);
  });

  it('maps 403 → a friendly generic error (no raw server detail surfaced, P13)', async () => {
    globalThis.fetch = fetchMock(403, { success: false, error: 'You are not linked to this student' });
    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));
    fireEvent.click(screen.getByText(CHEER_PRESETS.effort_counts.titleEn));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't send right now/i);
    expect(alert.textContent).not.toMatch(/not linked/i);
  });

  it('maps a 500 / other non-OK status → the same friendly error', async () => {
    globalThis.fetch = fetchMock(500, { success: false, error: 'Internal server error' });
    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));
    fireEvent.click(screen.getByText(CHEER_PRESETS.quiz_champion.titleEn));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't send right now/i);
  });

  it('maps a network/throw → the friendly error (no crash, no PII to log)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={false} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Encourage ${CHILD}`, 'i') }));
    fireEvent.click(screen.getByText(CHEER_PRESETS.believe_in_you.titleEn));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't send right now/i);
  });

  it('shows the Hindi rate-limit copy when isHi is true (P7)', async () => {
    globalThis.fetch = fetchMock(429, { success: false, error: 'rate limited' });
    render(<EncourageButton studentId={STUDENT_ID} childName={CHILD} isHi={true} />);
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`${CHILD} को प्रोत्साहित करें`) }),
    );
    fireEvent.click(screen.getByText(CHEER_PRESETS.great_work.titleHi));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/को प्रोत्साहित किया|बाद में/);
  });
});
