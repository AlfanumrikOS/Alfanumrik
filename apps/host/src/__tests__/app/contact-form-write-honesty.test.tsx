/**
 * /contact — a public form MUST NOT claim success without a confirmed server
 * write (SEV1, 2026-08-11).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The form's submit handler was:
 *     setSending(true);
 *     setTimeout(() => { setSending(false); setSubmitted(true); }, 800);
 * No fetch. No route. No row. Every enquiry from the twelve marketing surfaces
 * that link here was rendered "Message Sent! We'll get back to you within 24-48
 * hours" and dropped on the floor. The failure state was not merely untested —
 * it was structurally UNREACHABLE, because nothing could fail.
 *
 * It now POSTs to the unauthenticated intake route `/api/support/ticket`, which
 * persists a guest row, and renders honest pending / success / failure states.
 *
 * ── WHAT IS PINNED ──────────────────────────────────────────────────────────
 *  1. Submitting issues a real POST to the intake route with the user's message.
 *  2. Success copy renders ONLY after a 2xx + `success: true` body.
 *  3. Every failure mode — network throw, 5xx, 4xx, `success: false`, non-JSON —
 *     renders a retry affordance and NEVER the success copy.
 *  4. On failure the user's typed input is preserved (they must not retype it).
 *  5. P13: nothing from the form is logged client-side (the payload is PII).
 *  6. P7: the failure copy is bilingual.
 *
 * (2) and (3) are the pair that makes the timer version impossible: a build with
 * no fetch fails (1); a build that ignores the response fails (3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const { authState, consoleSpies } = vi.hoisted(() => ({
  authState: { isHi: false },
  consoleSpies: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: consoleSpies }));

import ContactPage from '@/app/contact/page';

const SUCCESS_EN = 'Message Sent!';
const SUCCESS_HI = 'संदेश भेज दिया गया!';
const FAILURE_EN = 'We couldn’t send your message';
const FAILURE_HI = 'संदेश नहीं भेजा जा सका';

const MESSAGE = 'My daughter cannot log in to her class account after the update.';

type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const lit = (status: number, body: unknown): FakeRes => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock: ReturnType<typeof vi.fn>;

function fillAndSubmit(message = MESSAGE) {
  fireEvent.change(screen.getByLabelText(/Name|नाम/), { target: { value: 'A Parent' } });
  fireEvent.change(screen.getByLabelText(/Email|ईमेल/), {
    target: { value: 'parent@example.test' },
  });
  fireEvent.change(screen.getByLabelText(/I am a|मैं हूँ/), { target: { value: 'Parent' } });
  fireEvent.change(screen.getByLabelText(/Message|संदेश/), { target: { value: message } });
  fireEvent.submit(screen.getByRole('button', { name: /Send Message|Try again|संदेश भेजें|फिर से भेजें/ }).closest('form')!);
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.isHi = false;
  fetchMock = vi.fn(async () => lit(200, { success: true, ticket_id: 't-1' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. A real write happens
// ════════════════════════════════════════════════════════════════════════════
describe('/contact — the form actually writes', () => {
  it('POSTs the message to the support intake route', async () => {
    render(<ContactPage />);
    fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/support/ticket');
    expect(init.method).toBe('POST');

    const body = JSON.parse(String(init.body));
    expect(body.message).toContain(MESSAGE);
    expect(body.category).toBeTruthy();
    expect(body.subject).toBeTruthy();
  });

  it('renders success ONLY after the server confirms the write', async () => {
    render(<ContactPage />);
    expect(screen.queryByText(SUCCESS_EN)).toBeNull();

    fillAndSubmit();
    await waitFor(() => expect(screen.getByText(SUCCESS_EN)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not submit at all when the message is below the server minimum', async () => {
    render(<ContactPage />);
    fillAndSubmit('too short');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(SUCCESS_EN)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. No failure mode may render success
// ════════════════════════════════════════════════════════════════════════════
describe('/contact — no failure mode fakes success', () => {
  const FAILURES: Array<[string, () => unknown]> = [
    ['a network rejection', () => { throw new TypeError('Failed to fetch'); }],
    ['a 500', () => lit(500, { success: false, error: 'internal' })],
    ['a 400 validation error', () => lit(400, { success: false, error: 'Validation failed' })],
    ['a 429 rate limit', () => lit(429, { success: false, error: 'Too many requests' })],
    ['a 200 with success:false', () => lit(200, { success: false, error: 'rejected' })],
    ['a 200 with no success field', () => lit(200, { ticket_id: 't-1' })],
    ['a 200 with a non-JSON body', () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    })],
  ];

  it.each(FAILURES)('%s renders the failure state, never "Message Sent!"', async (_l, behaviour) => {
    fetchMock.mockImplementation(async () => behaviour());
    render(<ContactPage />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(FAILURE_EN)).toBeInTheDocument());
    expect(
      screen.queryByText(SUCCESS_EN),
      'the form claimed the message was sent when the write did not land',
    ).toBeNull();
  });

  it('offers a retry affordance and a support mailto on failure', async () => {
    fetchMock.mockImplementation(async () => lit(500, { success: false }));
    render(<ContactPage />);
    fillAndSubmit();

    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    // Scoped to the alert: the page also lists support@ in its contact cards,
    // and an escape hatch that only exists elsewhere on the page is not an
    // escape hatch from the failure.
    const mailto = alert.querySelector('a[href="mailto:support@alfanumrik.com"]');
    expect(mailto, 'the failure state offers no way to reach a human').not.toBeNull();
  });

  it('preserves the typed message on failure (the user must not retype it)', async () => {
    fetchMock.mockImplementation(async () => lit(500, { success: false }));
    render(<ContactPage />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(FAILURE_EN)).toBeInTheDocument());
    expect((screen.getByLabelText(/Message/) as HTMLTextAreaElement).value).toBe(MESSAGE);
  });

  it('a retry after a failure can succeed (the error state is not terminal)', async () => {
    let attempt = 0;
    fetchMock.mockImplementation(async () => {
      attempt += 1;
      return attempt === 1 ? lit(500, { success: false }) : lit(200, { success: true });
    });
    render(<ContactPage />);
    fillAndSubmit();
    await waitFor(() => expect(screen.getByText(FAILURE_EN)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByText(SUCCESS_EN)).toBeInTheDocument());
    expect(attempt).toBe(2);
  });

  it('the failure copy is bilingual (P7)', async () => {
    authState.isHi = true;
    fetchMock.mockImplementation(async () => lit(500, { success: false }));
    render(<ContactPage />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(FAILURE_HI)).toBeInTheDocument());
    expect(screen.queryByText(SUCCESS_HI)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. P13 — the payload is PII; it must never be logged client-side
// ════════════════════════════════════════════════════════════════════════════
describe('/contact — P13', () => {
  it('logs nothing on the failure path', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    render(<ContactPage />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(FAILURE_EN)).toBeInTheDocument());
    for (const spy of Object.values(consoleSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('the email is sent to the server but never rendered back into the DOM', async () => {
    render(<ContactPage />);
    fillAndSubmit();
    await waitFor(() => expect(screen.getByText(SUCCESS_EN)).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('parent@example.test');
  });
});
