/**
 * Capability-parity suite for /super-admin/support/tickets (Phase 2 console
 * merge). This is the CEO-named release blocker: "Capability-parity tests
 * (testing-owned) required green before any legacy /internal/admin route/page
 * deletion." — parent spec
 * docs/superpowers/specs/2026-08-16-super-admin-mission-control-design.md §4;
 * slice spec docs/superpowers/specs/2026-08-16-phase2-support-console-parity.md.
 *
 * Scope: proves the NEW page (`apps/host/src/app/super-admin/support/tickets/page.tsx`
 * + `_lib/ticket-api.ts`) produces the same functional outcomes as the legacy
 * operator console (`apps/host/src/app/internal/admin/_components/SupportTab.tsx`)
 * against the SAME unmodified API (`/api/internal/admin/support`), per the
 * spec §5 capability table. This file does not re-test SupportTab.tsx itself
 * (covered by `app/internal-admin-support-composer-safety.test.tsx` and
 * `app/support-thread-honesty.test.tsx`) — it drives the real new page + the
 * real `ticketFetch` classifier (NOT mocked) against a scripted global `fetch`,
 * matching this repo's established pattern (see
 * `admin-shell-api-error-contract.test.tsx` for the AdminShell mocking
 * convention this file reuses).
 *
 * Deliberately real (not mocked): `ticket-api.ts`'s `ticketFetch` — the
 * access_denied vs http vs network classification is exactly what makes the
 * access-boundary capability (spec §2.2) meaningful, so mocking it away would
 * make that assertion vacuous. `AdminErrorState`, `DataTable`, `DetailDrawer`,
 * `StatusBadge` are also real — no admin-ui primitive is mocked.
 *
 * Mocked (matching admin-shell-api-error-contract.test.tsx's convention):
 * AdminShell's heavy deps (`supabase-client`, `getFeatureFlags`,
 * `EDUCATION_INTELLIGENCE_FLAGS`, `cosmic-theme`, `Starfield`,
 * `DashboardSidebar`, `AdminDashboardSkeleton`) and `@alfanumrik/lib/AuthContext`
 * (shared by both AdminShell and the page — a single hoisted `authState.isHi`
 * toggle drives every bilingual assertion) and `@alfanumrik/ui/ui/toast`
 * (spied, not rendered — the page never mounts a `<Toaster/>` itself).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── hoisted mocks ────────────────────────────────────────────────────────

const { getSessionMock, refreshSessionMock, getUserMock, onAuthStateChangeMock, authState } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  refreshSessionMock: vi.fn(),
  getUserMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  authState: { isHi: false },
}));

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      refreshSession: refreshSessionMock,
      getUser: getUserMock,
      onAuthStateChange: onAuthStateChangeMock,
      signOut: vi.fn(),
    },
  },
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  EDUCATION_INTELLIGENCE_FLAGS: { V1: 'ff_education_intelligence' },
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@alfanumrik/lib/cosmic-theme', () => ({
  useCosmicTheme: () => ({ cosmicEnabled: false }),
}));

vi.mock('@alfanumrik/ui/cosmic', () => ({
  Starfield: () => null,
}));

vi.mock('@alfanumrik/ui/admin-ui/DashboardSidebar', () => ({
  __esModule: true,
  default: () => <nav data-testid="sidebar" />,
}));

vi.mock('@alfanumrik/ui/Skeleton', () => ({
  AdminDashboardSkeleton: () => <div data-testid="skeleton" />,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@alfanumrik/ui/ui/toast', () => ({
  toast: { success: toastSuccess, error: toastError, info: vi.fn() },
}));

import SupportTicketsPage from '@/app/super-admin/support/tickets/page';

// ── fixtures ─────────────────────────────────────────────────────────────

const TICKET_A = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  student_id: 'stu-a',
  subject: 'Refund not received',
  message: 'We were double charged for the July plan.',
  status: 'open',
  admin_notes: null as string | null,
  created_at: '2026-08-01T00:00:00Z',
};
const TICKET_B = {
  id: 'bbbbbbbb-1111-4111-8111-111111111111',
  student_id: 'stu-b',
  subject: 'Quiz crashed mid-attempt',
  message: 'The app closed during a chapter test.',
  status: 'pending',
  admin_notes: 'Escalated to eng' as string | null,
  created_at: '2026-08-02T00:00:00Z',
};

function makeTicketPage(n: number, statusVal = 'open') {
  return Array.from({ length: n }, (_, i) => ({
    id: `cccccccc-1111-4111-8${String(i).padStart(3, '0')}-111111111111`,
    student_id: `stu-${i}`,
    subject: `Bulk ticket ${i}`,
    message: `Body ${i}`,
    status: statusVal,
    admin_notes: null as string | null,
    created_at: '2026-08-03T00:00:00Z',
  }));
}

const REPLY_INTERNAL = {
  id: 'r-internal',
  author_role: 'operator',
  body: 'Working note: refund already processed in Razorpay.',
  is_internal: true,
  created_at: '2026-08-04T00:00:00Z',
};
const REPLY_VISIBLE = {
  id: 'r-visible',
  author_role: 'operator',
  body: 'Your refund was issued on 3 August.',
  is_internal: false,
  created_at: '2026-08-05T00:00:00Z',
};

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ── scripted fetch ───────────────────────────────────────────────────────

let listResponse: () => Response | Promise<Response> = () => jsonRes({ data: [TICKET_A, TICKET_B], total: 2 });
let threadResponse: () => Response | Promise<Response> = () => jsonRes({ ticket: TICKET_A, replies: [] });
let patchResponse: () => Response | Promise<Response> = () => jsonRes({ success: true });
let postResponse: () => Response | Promise<Response> = () =>
  jsonRes({
    success: true,
    reply: { id: `r-${Date.now()}`, author_role: 'operator', body: 'ack', is_internal: true, created_at: '2026-08-06T00:00:00Z' },
    ticket_status: 'open',
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  authState.isHi = false;

  listResponse = () => jsonRes({ data: [TICKET_A, TICKET_B], total: 2 });
  threadResponse = () => jsonRes({ ticket: TICKET_A, replies: [] });
  patchResponse = () => jsonRes({ success: true });
  postResponse = () =>
    jsonRes({
      success: true,
      reply: { id: 'r-new', author_role: 'operator', body: 'ack', is_internal: true, created_at: '2026-08-06T00:00:00Z' },
      ticket_status: 'open',
    });

  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  getUserMock.mockResolvedValue({ data: { user: null } });
  onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'PATCH') return patchResponse();
    if (method === 'POST') return postResponse();
    if (String(url).includes('ticket_id=')) return threadResponse();
    return listResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── helpers ──────────────────────────────────────────────────────────────

async function renderPage() {
  render(<SupportTicketsPage />);
  await screen.findByRole('heading', { name: /Support Tickets|सहायता टिकट/ });
}

function getCalls() {
  return fetchMock.mock.calls as [string, RequestInit | undefined][];
}
function lastUrl(): string {
  const calls = getCalls();
  return calls[calls.length - 1][0];
}
function lastGetUrls(): string[] {
  return getCalls()
    .filter(([, init]) => !init?.method || init.method === 'GET')
    .map(([url]) => url);
}
function patchBodies(): Record<string, unknown>[] {
  return getCalls()
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init!.body)));
}
function postBodies(): Record<string, unknown>[] {
  return getCalls()
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init!.body)));
}

/**
 * The subject text renders TWICE once a thread is open — once in the table
 * row, once as the DetailDrawer's title (`<h3>`) — so a plain
 * `screen.getByText(subject)` breaks the instant a drawer is open. Scope to
 * the row specifically: of every element carrying the subject text, only the
 * table row's copy has a `<tr>` ancestor.
 */
function getRow(subject: string): HTMLElement {
  const row = screen.getAllByText(subject).map((el) => el.closest('tr')).find(Boolean);
  if (!row) throw new Error(`no <tr> found for subject "${subject}"`);
  return row as HTMLElement;
}

function clickThreadToggle(subject: string) {
  fireEvent.click(within(getRow(subject)).getByRole('button', { name: /Thread & reply|थ्रेड और उत्तर/i }));
}

async function openTicket(subject: string) {
  clickThreadToggle(subject);
  await screen.findByRole('dialog');
}

function modeControls() {
  return {
    internal: screen.getByRole('radio', { name: /internal note|आंतरिक नोट/i }),
    toStudent: screen.getByRole('radio', { name: /reply to student|छात्र को उत्तर/i }),
  };
}

async function typeReply(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}

function sendButton(): HTMLElement {
  return screen
    .getAllByRole('button')
    .find((b) => /Save internal note|Send to student|Sending|आंतरिक नोट सहेजें|छात्र को भेजें|भेजा जा रहा/i.test(b.textContent ?? ''))!;
}

// ════════════════════════════════════════════════════════════════════════
// LIST
// ════════════════════════════════════════════════════════════════════════
describe('/super-admin/support/tickets — list', () => {
  it('fetches status=open&page=1&limit=25 by default (matches SupportTab.tsx)', async () => {
    await renderPage();
    await waitFor(() => expect(getCalls().length).toBeGreaterThan(0));
    expect(lastUrl()).toContain('status=open');
    expect(lastUrl()).toContain('page=1');
    expect(lastUrl()).toContain('limit=25');
  });

  it.each(['pending', 'resolved', 'all'])('clicking the "%s" tab sends matching status and resets to page=1', async (s) => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${s}$`, 'i') }));
    await waitFor(() => expect(lastUrl()).toContain(`status=${s}`));
    expect(lastUrl()).toContain('page=1');
  });

  it('renders the ticket count from the API total', async () => {
    listResponse = () => jsonRes({ data: [TICKET_A, TICKET_B], total: 2 });
    await renderPage();
    await waitFor(() => expect(screen.getByText('2 tickets')).toBeInTheDocument());
  });

  it('Next advances page= (limit stays 25); Prev goes back', async () => {
    listResponse = () => jsonRes({ data: makeTicketPage(25), total: 50 });
    await renderPage();
    await waitFor(() => expect(screen.getByText('Bulk ticket 0')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => expect(lastUrl()).toContain('page=2'));
    expect(lastUrl()).toContain('limit=25');

    fireEvent.click(screen.getByRole('button', { name: /Prev/i }));
    await waitFor(() => expect(lastUrl()).toContain('page=1'));
  });

  it('manual refresh re-issues the same query', async () => {
    await renderPage();
    await waitFor(() => expect(getCalls().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(getCalls().length).toBe(2));
    expect(lastGetUrls()[0]).toBe(lastGetUrls()[1]);
  });

  it('loading, error, and empty are three distinct list states', async () => {
    // 1. loading — a never-resolving fetch must show the DataTable loading row.
    listResponse = () => new Promise<Response>(() => {});
    await renderPage();
    await waitFor(() => expect(screen.getByText('Loading...')).toBeInTheDocument());
    cleanup();

    // 2. error — a 500 must NOT render as an empty queue; DataTable is not shown at all.
    listResponse = () => jsonRes({ error: 'boom' }, 500);
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Could not load tickets\. This is a load failure, not an empty queue\./)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Loading...')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();

    // 3. genuinely empty — DataTable's own empty message, no error banner.
    listResponse = () => jsonRes({ data: [], total: 0 });
    await renderPage();
    await waitFor(() => expect(screen.getByText('No tickets in this queue')).toBeInTheDocument());
    expect(screen.queryByText(/load failure/)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// THREAD
// ════════════════════════════════════════════════════════════════════════
describe('/super-admin/support/tickets — thread', () => {
  it('opening a ticket fetches by ticket_id', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    await openTicket(TICKET_A.subject);
    await waitFor(() => expect(lastGetUrls().some((u) => u.includes(`ticket_id=${TICKET_A.id}`))).toBe(true));
  });

  it('internal notes ARE visible to the operator with distinguishable markup from student-visible replies', async () => {
    threadResponse = () => jsonRes({ ticket: TICKET_A, replies: [REPLY_INTERNAL, REPLY_VISIBLE] });
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    await openTicket(TICKET_A.subject);

    await waitFor(() => expect(screen.getByText(REPLY_INTERNAL.body)).toBeInTheDocument());
    expect(screen.getByText(/INTERNAL — student cannot see this/)).toBeInTheDocument();
    expect(screen.getByText(/Visible to student/)).toBeInTheDocument();

    const internalCard = screen.getByText(REPLY_INTERNAL.body).closest('div')!.parentElement!;
    const visibleCard = screen.getByText(REPLY_VISIBLE.body).closest('div')!.parentElement!;
    expect(internalCard.className).toContain('border-dashed');
    expect(visibleCard.className).not.toContain('border-dashed');
  });

  it('loading, error (with retry), and empty are three distinct thread states', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());

    // 1. loading
    threadResponse = () => new Promise<Response>(() => {});
    await openTicket(TICKET_A.subject);
    await waitFor(() => expect(screen.getByText('Loading conversation…')).toBeInTheDocument());

    // collapse and reopen with an error response
    clickThreadToggle(TICKET_A.subject);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    let failedOnce = false;
    threadResponse = () => {
      if (!failedOnce) {
        failedOnce = true;
        return jsonRes({ error: 'boom' }, 500);
      }
      return jsonRes({ ticket: TICKET_A, replies: [REPLY_VISIBLE] });
    };
    await openTicket(TICKET_A.subject);
    await waitFor(() =>
      expect(screen.getByText(/Could not load this conversation\. Retry before assuming it is empty\./)).toBeInTheDocument(),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Retry/i }));
    await waitFor(() => expect(screen.getByText(REPLY_VISIBLE.body)).toBeInTheDocument());
    expect(screen.queryByText(/Could not load this conversation/)).toBeNull();

    // collapse and reopen with a genuinely empty thread
    clickThreadToggle(TICKET_A.subject);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    threadResponse = () => jsonRes({ ticket: TICKET_A, replies: [] });
    await openTicket(TICKET_A.subject);
    await waitFor(() => expect(screen.getByText(/No replies yet\. Nothing has been sent to this student\./)).toBeInTheDocument());
  });

  it('re-clicking an already-open ticket collapses it (single-open enforced)', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    await openTicket(TICKET_A.subject);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    clickThreadToggle(TICKET_A.subject);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opening a different ticket switches directly (no manual close needed) and stays single-open', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_B.subject)).toBeInTheDocument());
    await openTicket(TICKET_A.subject);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', TICKET_A.subject);

    clickThreadToggle(TICKET_B.subject);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', TICKET_B.subject));
    // Only one dialog exists at a time.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// COMPOSER
// ════════════════════════════════════════════════════════════════════════
describe('/super-admin/support/tickets — composer', () => {
  async function openAndReady() {
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    await openTicket(TICKET_A.subject);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
  }

  it('defaults to internal note', async () => {
    await openAndReady();
    const { internal, toStudent } = modeControls();
    expect(internal.getAttribute('aria-checked')).toBe('true');
    expect(toStudent.getAttribute('aria-checked')).toBe('false');
  });

  it('resets to internal after a successful reply, even after choosing "reply to student"', async () => {
    await openAndReady();
    fireEvent.click(modeControls().toStudent);
    await typeReply('Your refund was issued on 3 August.');
    fireEvent.click(sendButton());

    await waitFor(() => expect(postBodies()).toHaveLength(1));
    expect(postBodies()[0].is_internal).toBe(false);
    await waitFor(() => expect(modeControls().internal.getAttribute('aria-checked')).toBe('true'));
  });

  it('an untouched composer posts is_internal:true', async () => {
    await openAndReady();
    await typeReply('Checked billing — refund already issued.');
    fireEvent.click(sendButton());
    await waitFor(() => expect(postBodies()).toHaveLength(1));
    expect(postBodies()[0].is_internal).toBe(true);
    expect(postBodies()[0].ticket_id).toBe(TICKET_A.id);
  });

  it('5000-char guard disables submission over-limit with a live counter', async () => {
    await openAndReady();
    const over = 'a'.repeat(5001);
    await typeReply(over);

    expect(screen.getByText('5001/5000')).toBeInTheDocument();
    expect(screen.getByText(/Message cannot exceed 5000 characters\./)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('exactly 5000 chars is NOT over-limit', async () => {
    await openAndReady();
    await typeReply('a'.repeat(5000));
    expect(screen.getByText('5000/5000')).toBeInTheDocument();
    expect(screen.queryByText(/Message cannot exceed 5000 characters\./)).toBeNull();
    expect(sendButton()).not.toBeDisabled();
  });

  it('internal-note failure and reply-send failure show DISTINCT copy', async () => {
    // Internal note failure.
    postResponse = () => jsonRes({ error: 'boom' }, 500);
    await openAndReady();
    await typeReply('Internal: escalate to finance.');
    fireEvent.click(sendButton());
    // The alert renders "⚠️ {postError}" as sibling text nodes in one <div>,
    // so the element's own text is emoji-prefixed — match the message content
    // rather than the whole node's exact text.
    await waitFor(() =>
      expect(screen.getByText(/Could not save the internal note\. Nothing was sent to the student\./)).toBeInTheDocument(),
    );
    cleanup();

    // Reply-to-student failure.
    postResponse = () => jsonRes({ error: 'boom' }, 500);
    await openAndReady();
    fireEvent.click(modeControls().toStudent);
    await typeReply('Your refund was issued on 3 August.');
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(
        screen.getByText(/Could not send the reply\. The student did NOT receive it — try again\./),
      ).toBeInTheDocument(),
    );
  });

  it('fires a distinct success toast for internal notes vs replies to students', async () => {
    await openAndReady();
    await typeReply('Internal: escalate to finance.');
    fireEvent.click(sendButton());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Internal note saved (not sent to student)'));

    cleanup();
    await openAndReady();
    fireEvent.click(modeControls().toStudent);
    await typeReply('Your refund was issued on 3 August.');
    fireEvent.click(sendButton());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Reply sent to student'));
  });

  it('resolve PATCHes {id, status: "resolved"} and hides the Resolve action once resolved', async () => {
    await openAndReady();
    expect(within(getRow(TICKET_A.subject)).getByRole('button', { name: /Resolve/i })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Resolve/i }));

    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0]).toEqual({ id: TICKET_A.id, status: 'resolved' });
    expect(toastSuccess).toHaveBeenCalledWith('Ticket resolved');

    await waitFor(() => expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /Resolve/i })).toBeNull());
    expect(within(getRow(TICKET_A.subject)).queryByRole('button', { name: /Resolve/i })).toBeNull();
  });

  it('a failed resolve shows a distinct error toast and does NOT hide the action', async () => {
    patchResponse = () => jsonRes({ error: 'boom' }, 500);
    await openAndReady();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Resolve/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not resolve ticket — try again'));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Resolve/i })).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════
// ACCESS BOUNDARY
// ════════════════════════════════════════════════════════════════════════
describe('/super-admin/support/tickets — access boundary (spec §2.2)', () => {
  it('a 401 from the list fetch renders the DISTINCT "requires Super Admin access" state, not the generic session-expired banner', async () => {
    listResponse = () => new Response(null, { status: 401 });
    await renderPage();

    await waitFor(() =>
      expect(screen.getByText('This feature requires Super Admin access')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/session expired/i)).toBeNull();
    expect(
      screen.getByText(/This is not a session expiry — contact an administrator if you believe you should have access\./),
    ).toBeInTheDocument();
  });

  it('a 403 from the list fetch is treated identically to a 401', async () => {
    listResponse = () => new Response(null, { status: 403 });
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText('This feature requires Super Admin access')).toBeInTheDocument(),
    );
  });

  it('a 401 surfaced while loading a thread also renders the access-denied state', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    threadResponse = () => new Response(null, { status: 401 });
    await openTicket(TICKET_A.subject);
    await waitFor(() =>
      expect(screen.getByText('This feature requires Super Admin access')).toBeInTheDocument(),
    );
  });

  it('the access-denied state offers a retry that re-issues the list fetch', async () => {
    let calls = 0;
    listResponse = () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 401 }) : jsonRes({ data: [TICKET_A], total: 1 });
    };
    await renderPage();
    await waitFor(() => expect(screen.getByText('This feature requires Super Admin access')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
  });
});

// ════════════════════════════════════════════════════════════════════════
// BILINGUAL (P7) — spot-check, not exhaustive
// ════════════════════════════════════════════════════════════════════════
describe('/super-admin/support/tickets — bilingual (isHi) spot-check', () => {
  it('renders the Hindi empty-list state, with the count kept in Arabic numerals', async () => {
    authState.isHi = true;
    listResponse = () => jsonRes({ data: [], total: 0 });
    await renderPage();

    await waitFor(() => expect(screen.getByText('इस कतार में कोई टिकट नहीं')).toBeInTheDocument());
    expect(screen.getByText('0 टिकट')).toBeInTheDocument();
  });

  it('renders the Hindi access-denied state', async () => {
    authState.isHi = true;
    listResponse = () => new Response(null, { status: 401 });
    await renderPage();

    await waitFor(() =>
      expect(screen.getByText('इस सुविधा के लिए सुपर एडमिन एक्सेस आवश्यक है')).toBeInTheDocument(),
    );
  });

  it('renders the Hindi composer default (internal note)', async () => {
    authState.isHi = true;
    await renderPage();
    await waitFor(() => expect(screen.getByText(TICKET_A.subject)).toBeInTheDocument());
    await openTicket(TICKET_A.subject);

    const internalRadio = await screen.findByRole('radio', { name: /आंतरिक नोट/ });
    expect(internalRadio.getAttribute('aria-checked')).toBe('true');
  });
});
