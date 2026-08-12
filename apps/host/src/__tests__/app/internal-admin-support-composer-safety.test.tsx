/**
 * Internal-admin SupportTab — the operator composer must FAIL SAFE.
 *
 * ── THE RISK ────────────────────────────────────────────────────────────────
 * The composer writes `support_ticket_replies` with an `is_internal` flag:
 *   is_internal: true  → private operator note; the student route filters it out.
 *   is_internal: false → SENT TO THE STUDENT. Irreversible. There is no unsend.
 *
 * A mis-set toggle ships operator-internal prose ("parent already escalated,
 * offer goodwill credit, do not admit fault") into a twelve-year-old's support
 * thread. That is a P13 disclosure with no recovery path, caused by one sticky
 * boolean.
 *
 * Two invariants make the mistake hard to make:
 *   1. The composer OPENS in internal mode.
 *   2. It RESETS to internal after every SUCCESSFUL send — so student-visible
 *      is a deliberate, per-message act rather than a mode the operator can
 *      leave switched on and forget.
 * Plus: opening a DIFFERENT ticket must not carry the previous ticket's mode.
 *
 * Both are one-line state assignments that a refactor would delete without
 * noticing. This file is what notices.
 *
 * A deliberate NON-assertion: the mode is NOT reset after a FAILED send. The
 * operator is going to retry the same message, and silently flipping it back to
 * internal would send a reply they believe is going to the student into a
 * private note instead. That is pinned below too, so a well-meaning "always
 * reset" change has to argue with a test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import SupportTab from '@/app/internal/admin/_components/SupportTab';

const TICKET_A = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  subject: 'Refund not received',
  status: 'open',
  category: 'billing',
  priority: 'high',
  created_at: '2026-08-01T00:00:00Z',
};
const TICKET_B = {
  id: 'bbbbbbbb-1111-4111-8111-111111111111',
  subject: 'Quiz crashed',
  status: 'open',
  category: 'bug',
  priority: 'normal',
  created_at: '2026-08-02T00:00:00Z',
};

type Json = Record<string, unknown>;
let postStatus = 200;
let posted: Json[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  postStatus = 200;
  posted = [];

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Json;
      posted.push(body);
      if (postStatus !== 200) return res(postStatus, { error: 'nope' });
      return res(200, {
        success: true,
        reply: {
          id: `r-${posted.length}`,
          author_role: 'operator',
          body: body.body,
          is_internal: body.is_internal,
          created_at: '2026-08-11T00:00:00Z',
        },
        ticket_status: 'pending',
      });
    }
    if (String(url).includes('ticket_id=')) {
      return res(200, { replies: [] });
    }
    return res(200, { data: [TICKET_A, TICKET_B], total: 2 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The two radio-style mode controls. `aria-checked` is the source of truth. */
function modeControls() {
  const internal = screen.getByRole('radio', { name: /internal note/i });
  const toStudent = screen.getByRole('radio', { name: /send to student|reply to student/i });
  return { internal, toStudent };
}

async function openThread(subject: string) {
  render(<SupportTab />);
  await waitFor(() => expect(screen.getByText(subject)).toBeInTheDocument());
  const card = screen.getByText(subject).closest('div')!.parentElement!.parentElement!;
  const toggle = within(card).find(/Thread & reply/);
  fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByRole('radio', { name: /internal note/i })).toBeInTheDocument());
}

/** Minimal scoped query — the tab renders one card per ticket and both cards
 *  carry a "Thread & reply" button, so the click must be scoped. */
const within = (root: HTMLElement) => ({
  find(re: RegExp): HTMLElement {
    const el = Array.from(root.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
    if (!el) throw new Error(`no button matching ${re} inside card`);
    return el as HTMLElement;
  },
});

async function type(text: string) {
  const box = screen.getByRole('textbox');
  fireEvent.change(box, { target: { value: text } });
}

async function send() {
  const btn = screen
    .getAllByRole('button')
    .find((b) => /Save internal note|Send to student/i.test(b.textContent ?? ''))!;
  fireEvent.click(btn);
}

// ════════════════════════════════════════════════════════════════════════════
describe('SupportTab composer — safe default', () => {
  it('opens in INTERNAL mode', async () => {
    await openThread(TICKET_A.subject);
    const { internal, toStudent } = modeControls();
    expect(internal.getAttribute('aria-checked')).toBe('true');
    expect(toStudent.getAttribute('aria-checked')).toBe('false');
  });

  it('an untouched composer posts is_internal:true', async () => {
    await openThread(TICKET_A.subject);
    await type('Checked billing — refund already issued, ref ABC123.');
    await send();

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].is_internal).toBe(true);
  });

  it('student-visible mode is a deliberate act and is honoured when chosen', async () => {
    await openThread(TICKET_A.subject);
    fireEvent.click(modeControls().toStudent);
    await type('Your refund was issued on 3 August.');
    await send();

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].is_internal).toBe(false);
  });
});

describe('SupportTab composer — resets to internal after a successful send', () => {
  it('the SECOND message defaults back to internal', async () => {
    await openThread(TICKET_A.subject);

    fireEvent.click(modeControls().toStudent);
    await type('Your refund was issued on 3 August.');
    await send();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].is_internal).toBe(false);

    // The mode must NOT be sticky.
    await waitFor(() =>
      expect(modeControls().internal.getAttribute('aria-checked')).toBe('true'),
    );

    await type('Internal: goodwill credit approved by finance, do not admit fault.');
    await send();
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(
      posted[1].is_internal,
      'the composer stayed in student-visible mode — the operator internal note ' +
        'was shipped to a child account',
    ).toBe(true);
  });

  it('does NOT reset after a FAILED send (the operator will retry the same message)', async () => {
    await openThread(TICKET_A.subject);
    fireEvent.click(modeControls().toStudent);
    postStatus = 500;
    await type('Your refund was issued on 3 August.');
    await send();

    await waitFor(() => expect(posted).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByText(/did NOT receive it/i)).toBeInTheDocument(),
    );
    expect(
      modeControls().toStudent.getAttribute('aria-checked'),
      'silently flipping back to internal after a failure would turn the retry of a ' +
        'student reply into a private note the student never sees',
    ).toBe('true');
  });

  it('the failure copy states plainly that the student did not receive it', async () => {
    await openThread(TICKET_A.subject);
    fireEvent.click(modeControls().toStudent);
    postStatus = 500;
    await type('Your refund was issued on 3 August.');
    await send();

    await waitFor(() =>
      expect(screen.getByText(/The student did NOT receive it/i)).toBeInTheDocument(),
    );
  });

  it('a failed INTERNAL note says nothing was sent to the student', async () => {
    await openThread(TICKET_A.subject);
    postStatus = 500;
    await type('Internal: escalate to finance.');
    await send();

    await waitFor(() =>
      expect(screen.getByText(/Nothing was sent to the student/i)).toBeInTheDocument(),
    );
  });
});

describe('SupportTab composer — mode never crosses tickets', () => {
  it('switching to another ticket reopens in internal mode', async () => {
    render(<SupportTab />);
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());

    const cardA = screen.getByText(TICKET_A.subject).closest('div')!.parentElement!.parentElement!;
    fireEvent.click(within(cardA).find(/Thread & reply/));
    await waitFor(() => expect(screen.getByRole('radio', { name: /internal note/i })).toBeInTheDocument());
    fireEvent.click(modeControls().toStudent);
    expect(modeControls().toStudent.getAttribute('aria-checked')).toBe('true');

    const cardB = screen.getByText(TICKET_B.subject).closest('div')!.parentElement!.parentElement!;
    fireEvent.click(within(cardB).find(/Thread & reply/));

    await waitFor(() =>
      expect(modeControls().internal.getAttribute('aria-checked')).toBe('true'),
    );
  });

  it('switching tickets also clears the draft (no cross-ticket message bleed)', async () => {
    render(<SupportTab />);
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());

    const cardA = screen.getByText(TICKET_A.subject).closest('div')!.parentElement!.parentElement!;
    fireEvent.click(within(cardA).find(/Thread & reply/));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Refund details for the FIRST family' },
    });

    const cardB = screen.getByText(TICKET_B.subject).closest('div')!.parentElement!.parentElement!;
    fireEvent.click(within(cardB).find(/Thread & reply/));

    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''),
    );
  });
});

describe('SupportTab — a failed thread read is not an empty thread', () => {
  it('says so explicitly rather than rendering silence', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return res(200, { success: true });
      if (String(url).includes('ticket_id=')) return res(500, { error: 'boom' });
      return res(200, { data: [TICKET_A], total: 1 });
    });

    render(<SupportTab />);
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    const card = screen.getByText(TICKET_A.subject).closest('div')!.parentElement!.parentElement!;
    fireEvent.click(within(card).find(/Thread & reply/));

    await waitFor(() =>
      expect(screen.getByText(/Retry before assuming it is empty/i)).toBeInTheDocument(),
    );
  });

  it('a failed ticket LIST read is not an empty queue', async () => {
    fetchMock.mockImplementation(async () => res(500, { error: 'boom' }));
    render(<SupportTab />);

    await waitFor(() =>
      expect(screen.getByText(/load failure, not an empty queue/i)).toBeInTheDocument(),
    );
  });
});
