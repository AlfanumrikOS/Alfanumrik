/**
 * /support/[ticket_id] — `replies_unavailable` must be a DISTINCT retry state,
 * never an empty thread (SEV1, 2026-08-11).
 *
 * ── WHY THIS MATTERS MORE THAN THE USUAL EMPTY-STATE BUG ────────────────────
 * The generic pattern is "a failed read renders as no content". Here the
 * consequence is specific and worse: a student or parent who has been waiting
 * for a support answer opens the thread, the reply read fails, and the page says
 * "No replies yet. When our team replies, it will appear here." That is a
 * statement that support has NOT answered — a claim the client cannot possibly
 * substantiate, made to someone chasing a refund or an escalation. They close
 * the tab and the answer is never seen.
 *
 * The route reports the distinction explicitly (`replies_unavailable: true` on a
 * failed thread read, flag ABSENT on a successful empty read). This file pins
 * that the page honours it in BOTH directions — a failure-only suite would pass
 * against a build that deleted the empty state, and a genuinely-new ticket has
 * no replies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';

const TICKET_ID = 'ffffffff-1111-4111-8111-111111111111';

const { authState } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', grade: '8', name: 'Test Student' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ ticket_id: TICKET_ID }),
}));
vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import TicketDetailPage from '@/app/support/[ticket_id]/page';

const ERROR_EN = 'Could not load the conversation';
const ERROR_HI = 'बातचीत लोड नहीं हो सकी';
const EMPTY_EN = 'No replies yet';
const RETRY_EN = 'Retry';

const TICKET = {
  id: TICKET_ID,
  subject: 'Refund not received',
  message: 'We cancelled last month and were charged again.',
  category: 'billing',
  priority: 'high',
  status: 'open',
  created_at: '2026-08-01T00:00:00Z',
};

const REPLY = {
  id: 'r-1',
  author_role: 'operator',
  body: 'The refund was issued on 3 August, reference ABC123.',
  created_at: '2026-08-03T00:00:00Z',
};

/** `headers` is part of the double on purpose: the 429 branch reads
 *  `res.headers.get('Retry-After')`, so a double without it throws and the
 *  rate-limit copy is replaced by the generic network-error copy — the test
 *  would then be asserting the absence of a bug it had itself introduced. */
type FakeRes = {
  ok: boolean;
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
};
const lit = (status: number, body: unknown, headers: Record<string, string> = {}): FakeRes => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

let getBody: () => FakeRes;
let postBody: () => FakeRes;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  authState.isHi = false;
  getBody = () => lit(200, { success: true, data: { ticket: TICKET, replies: [] } });
  postBody = () =>
    lit(200, { success: true, data: { reply: { ...REPLY, author_role: 'student' }, ticket_status: 'open' } });

  fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
    init?.method === 'POST' ? postBody() : getBody(),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 } },
      React.createElement(TicketDetailPage),
    ),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Failure vs empty — both directions
// ════════════════════════════════════════════════════════════════════════════
describe('/support/[id] — replies_unavailable is never an empty thread', () => {
  it('replies_unavailable:true renders the retry state and NOT "No replies yet"', async () => {
    getBody = () =>
      lit(200, {
        success: true,
        data: { ticket: TICKET, replies: [], replies_unavailable: true },
      });
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(
      screen.queryByText(EMPTY_EN),
      'a failed thread read told the user support has not answered — a claim the ' +
        'client cannot substantiate',
    ).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('a GENUINELY empty thread renders "No replies yet" and NO retry state', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(EMPTY_EN)).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('the retry state explicitly denies that "no replies" is the meaning', async () => {
    getBody = () =>
      lit(200, { success: true, data: { ticket: TICKET, replies: [], replies_unavailable: true } });
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(
      screen.getByText(/does not mean there are no replies/i),
    ).toBeInTheDocument();
  });

  it('offers a Retry control that re-reads and recovers the thread', async () => {
    let failed = false;
    getBody = () => {
      if (!failed) {
        failed = true;
        return lit(200, {
          success: true,
          data: { ticket: TICKET, replies: [], replies_unavailable: true },
        });
      }
      return lit(200, { success: true, data: { ticket: TICKET, replies: [REPLY] } });
    };
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    fireEvent.click(screen.getAllByText(RETRY_EN)[0]);

    await waitFor(() => expect(screen.queryByText(ERROR_EN)).toBeNull());
    expect(screen.getByText(REPLY.body)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_EN)).toBeNull();
  });

  it('the retry copy is bilingual (P7)', async () => {
    authState.isHi = true;
    getBody = () =>
      lit(200, { success: true, data: { ticket: TICKET, replies: [], replies_unavailable: true } });
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_HI)).toBeInTheDocument());
    expect(screen.queryByText('अभी तक कोई जवाब नहीं')).toBeNull();
  });

  it('the conversation count is suppressed while the thread read is unavailable', async () => {
    // "Conversation (0)" next to a failed read would restate the same lie in a
    // number.
    getBody = () =>
      lit(200, { success: true, data: { ticket: TICKET, replies: [], replies_unavailable: true } });
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText(/Conversation \(\d+\)/)).toBeNull();
  });

  it('renders replies when the read succeeds (neither state is shown)', async () => {
    getBody = () => lit(200, { success: true, data: { ticket: TICKET, replies: [REPLY] } });
    renderPage();

    await waitFor(() => expect(screen.getByText(REPLY.body)).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
    expect(screen.queryByText(EMPTY_EN)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. P13 — the thread renders authorship from author_role ONLY
// ════════════════════════════════════════════════════════════════════════════
describe('/support/[id] — authorship carries no identity', () => {
  it('renders an operator reply as the brand, never a person', async () => {
    getBody = () => lit(200, { success: true, data: { ticket: TICKET, replies: [REPLY] } });
    renderPage();

    await waitFor(() => expect(screen.getByText(REPLY.body)).toBeInTheDocument());
    expect(screen.getByText(/Alfanumrik Support/)).toBeInTheDocument();
  });

  it('renders the requester own reply as "You"', async () => {
    getBody = () =>
      lit(200, {
        success: true,
        data: { ticket: TICKET, replies: [{ ...REPLY, author_role: 'student', body: 'Any update?' }] },
      });
    renderPage();

    await waitFor(() => expect(screen.getByText('Any update?')).toBeInTheDocument());
    expect(screen.getByText(/^You$/)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Reply send — a failed POST must not look like a delivered message
// ════════════════════════════════════════════════════════════════════════════
describe('/support/[id] — sending a reply is honest about failure', () => {
  async function typeAndSend(text: string) {
    renderPage();
    await waitFor(() => expect(screen.getByText(EMPTY_EN)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/reply|जवाब|message/i), { target: { value: text } });
    const send = screen
      .getAllByRole('button')
      .find((b) => /send|भेज/i.test(b.textContent ?? ''))!;
    fireEvent.click(send);
  }

  it('a 500 on send surfaces an error and never renders the draft as delivered', async () => {
    postBody = () => lit(500, { success: false, error: 'REPLY_FAILED' });
    await typeAndSend('Still waiting on the refund.');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/could not be sent|भेजा नहीं जा सका/i)).toBeInTheDocument(),
    );
    // No optimistic bubble in the CONVERSATION — the draft legitimately stays in
    // the textarea (the user must not have to retype it), so the assertion is
    // scoped to the thread list rather than the whole document.
    const thread = screen.queryByRole('list', { name: /Conversation|बातचीत/ });
    expect(thread?.textContent ?? '').not.toContain('Still waiting on the refund.');
    // …and the draft IS preserved.
    expect((screen.getByLabelText(/reply|जवाब|message/i) as HTMLTextAreaElement).value)
      .toBe('Still waiting on the refund.');
  });

  it('a 429 rate limit surfaces a wait message rather than a generic failure', async () => {
    postBody = () =>
      lit(
        429,
        {
          success: false,
          error: 'Too many replies.',
          code: 'RATE_LIMITED',
          retry_after_ms: 120000,
        },
        { 'Retry-After': '120' },
      );
    await typeAndSend('one more question');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/try again in|बाद फिर से/i)).toBeInTheDocument(),
    );
    // A rate limit is NOT a delivery failure — the copy must not say the message
    // could not be sent, only that they must wait.
    expect(screen.queryByText(/could not be sent/i)).toBeNull();
  });
});
