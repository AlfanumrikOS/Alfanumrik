/**
 * /teacher/messages + /teacher/worksheets + the shared TeacherDataError
 * primitive — failure is DISTINCT from empty, and the recovery control is a
 * real 44px touch target.
 *
 * Frontend audit, Phase 3 Wave B (teacher portal).
 *
 * /teacher/messages
 *   Both SWR hooks discarded `error` AND `isLoading`, with
 *   `shouldRetryOnError: false`. A 401/500 therefore left `data` undefined
 *   permanently, and the render keyed off `threads.length === 0` →
 *   "No conversations yet. Visit a student page to start one." Every waiting
 *   parent message was hidden behind an invitation to start a conversation
 *   that already existed. There was also NO loading state at all: the empty
 *   copy flashed on first paint before the first response landed.
 *
 * /teacher/worksheets
 *   `fetchQuestionsFromBank` destructured only `{ data }` from the PostgREST
 *   builder and returned `null` on both failure and genuine-empty. The builder
 *   RESOLVES with `{ data, error }` — it never rejects — so the surrounding
 *   try/catch was dead code for the read itself. The caller answers `null` by
 *   generating a worksheet made entirely of DEFAULT_BANK placeholders
 *   ("Sample MCQ question for this topic. (a) Option A (b) Option B …") which
 *   the teacher then PRINTS and hands to a class. The only signal was an 11px
 *   "Sample questions" chip that is not rendered in print view. This is the
 *   highest-consequence instance of the defect class in the portal: a failed
 *   read became physical paper in a student's hands.
 *
 * Both directions are asserted throughout. The genuine-empty behaviour of
 * /teacher/worksheets (bank legitimately has no questions for this
 * subject/grade → sample worksheet + existing chip) is UNCHANGED and pinned
 * here, because silently removing it would be its own regression.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';

/* ── Auth ───────────────────────────────────────────────────────────────── */
const { authState } = vi.hoisted(() => ({
  authState: {
    teacher: { id: 'teacher-1', name: 'Teacher', school_name: 'Test School' },
    authUserId: 'user-1',
    activeRole: 'teacher',
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/teacher',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@alfanumrik/lib/useTeacherAllowedSubjects', () => ({
  useTeacherAllowedSubjects: () => ({
    subjects: [{ code: 'math', name: 'Mathematics' }],
    allSubjects: [{ code: 'math', name: 'Mathematics' }],
    isLoading: false,
    refresh: vi.fn(),
  }),
}));

const { captureSpy } = vi.hoisted(() => ({ captureSpy: vi.fn() }));
vi.mock('@alfanumrik/lib/posthog-client', () => ({ posthogCapture: captureSpy }));

/* ── Configurable supabase stub (worksheets reads question_bank directly) ──
 * Thenable builder that RESOLVES with `{ data, error }`, exactly like
 * postgrest-js. A `.catch()` on this never fires — which is the whole point. */
const { tableResults } = vi.hoisted(() => ({ tableResults: new Map<string, unknown>() }));

vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'single', 'maybeSingle'];
  return {
    supabase: {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(tableResults.get(table) ?? { data: [], error: null }).then(resolve, reject);
        return builder;
      }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

import TeacherMessagesPage from '@/app/teacher/messages/page';
import TeacherWorksheetsPage from '@/app/teacher/worksheets/page';
import { TeacherDataError } from '@/app/teacher/_components/TeacherDataError';

const realFetch = global.fetch;

beforeEach(() => {
  authState.isHi = false;
  tableResults.clear();
  captureSpy.mockClear();
});

afterEach(() => {
  cleanup();
  global.fetch = realFetch;
  vi.clearAllMocks();
});

/**
 * Mount /teacher/messages with an ISOLATED SWR cache.
 *
 * SWR's cache and its 2s dedupingInterval are module-global. Without a fresh
 * provider per test, the second test in this file reuses the first test's
 * cached `{ threads: [] }`, never refetches, and therefore renders the empty
 * state no matter what the fetch stub does — a false green. `dedupingInterval:
 * 0` forces every mount to issue its own request.
 */
function renderMessages() {
  return render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0 } },
      React.createElement(TeacherMessagesPage),
    ),
  );
}

/** Install a fetch stub for the teacher-messages SWR hooks. */
function stubFetch(handler: (url: string) => { ok: boolean; body?: unknown }) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    const { ok, body } = handler(url);
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

/* ══════════════════════════════════════════════════════════════════════════
   /teacher/messages
   ══════════════════════════════════════════════════════════════════════════ */
describe('/teacher/messages — a failed thread read never reads as "no parents have written"', () => {
  it('FAILURE: renders the error surface and NOT "No conversations yet"', async () => {
    stubFetch(() => ({ ok: false }));

    renderMessages();

    expect(await screen.findByTestId('messages-threads-error')).toBeTruthy();
    expect(screen.queryByText(/No conversations yet/)).toBeNull();
  });

  it('EMPTY: renders "No conversations yet" and NOT the error surface', async () => {
    stubFetch(() => ({ ok: true, body: { success: true, threads: [], unreadTotal: 0 } }));

    renderMessages();

    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
    expect(screen.queryByTestId('messages-threads-error')).toBeNull();
  });

  it('LOADING: announces a pending read instead of flashing the empty claim', async () => {
    // A fetch that never settles keeps the hook in flight, which is the only
    // way to observe the (previously absent) loading state.
    global.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    renderMessages();

    expect(await screen.findByText('Loading conversations…')).toBeTruthy();
    expect(screen.queryByText(/No conversations yet/)).toBeNull();
    expect(screen.queryByTestId('messages-threads-error')).toBeNull();
  });

  it('P7: the failure surface is bilingual', async () => {
    authState.isHi = true;
    stubFetch(() => ({ ok: false }));

    renderMessages();

    expect(await screen.findByText('आपकी बातचीत लोड नहीं हो सकी')).toBeTruthy();
    expect(screen.queryByText("Couldn't load your conversations")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /teacher/worksheets
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * R2 step C (2026-08-11) — these cases used to drive the page by stubbing the
 * BROWSER Supabase client, because the page read `question_bank` (including
 * `correct_answer_index`) directly from the browser. That read now lives behind
 * `GET /api/teacher/worksheets/answer-key`, gated by
 * `authorizeRequest('worksheet.create')` plus a server-side (subject, grade)
 * scope check, so the stub moves to `fetch`.
 *
 * This is not a cosmetic re-point. Left on the Supabase stub, the three FAILURE
 * cases kept passing for the WRONG reason — the page's `fetch` hit jsdom's
 * real (absent) network, threw, and landed on the error banner by accident,
 * which would have gone on "passing" even if the error branch were deleted. The
 * EMPTY case is what exposed it: it cannot be faked by a network error, and it
 * failed. Every case below now asserts against a real HTTP shape.
 */
function stubAnswerKey(res: { status: number; body: unknown }) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    if (!url.includes('/api/teacher/worksheets/answer-key')) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
    } as Response;
  }) as unknown as typeof fetch;
}

const KEY_500 = { status: 500, body: { success: false, error: 'Failed to read the question bank' } };

describe('/teacher/worksheets — a failed question_bank read never becomes printed placeholders', () => {
  it('FAILURE: surfaces the read error and generates NO worksheet at all', async () => {
    stubAnswerKey(KEY_500);

    render(React.createElement(TeacherWorksheetsPage));
    fireEvent.click(screen.getByText('Generate Worksheet'));

    expect(await screen.findByTestId('worksheets-bank-error')).toBeTruthy();
    // The placeholder worksheet must not have been produced.
    expect(screen.queryByText(/Sample MCQ question for this topic/)).toBeNull();
    expect(screen.queryByText('Print Worksheet')).toBeNull();
  });

  it('FAILURE: reports the read failure with a distinguishable reason (no PII)', async () => {
    stubAnswerKey(KEY_500);

    render(React.createElement(TeacherWorksheetsPage));
    fireEvent.click(screen.getByText('Generate Worksheet'));

    await screen.findByTestId('worksheets-bank-error');
    await waitFor(() => expect(captureSpy).toHaveBeenCalled());
    const [, payload] = captureSpy.mock.calls[0];
    expect(payload.reason).toBe('question_bank_read_error');
    // Only a presence boolean, never the teacher's identity (P13).
    expect(payload.teacher_id_present).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('teacher-1');
  });

  it('EMPTY: a genuinely empty bank still produces the sample worksheet (unchanged)', async () => {
    stubAnswerKey({ status: 200, body: { success: true, data: { questions: [] } } });

    render(React.createElement(TeacherWorksheetsPage));
    fireEvent.click(screen.getByText('Generate Worksheet'));

    expect(await screen.findByText('Sample questions')).toBeTruthy();
    expect(screen.queryByTestId('worksheets-bank-error')).toBeNull();
    // …and the empty condition is stated outright, not left to an 11px chip.
    expect(screen.getByTestId('worksheets-bank-empty')).toBeTruthy();
  });

  it('DENIED: a 403 is neither a retry banner nor a placeholder sheet', async () => {
    stubAnswerKey({
      status: 403,
      body: { success: false, error: 'out of scope', code: 'out_of_scope' },
    });

    render(React.createElement(TeacherWorksheetsPage));
    fireEvent.click(screen.getByText('Generate Worksheet'));

    expect(await screen.findByTestId('worksheets-bank-denied')).toBeTruthy();
    // Retrying a scope denial can never succeed, so the retry surface is absent…
    expect(screen.queryByTestId('worksheets-bank-error')).toBeNull();
    // …and no sheet is produced at all.
    expect(screen.queryByText(/Sample MCQ question for this topic/)).toBeNull();
    expect(screen.queryByText('Print Worksheet')).toBeNull();
  });

  it('LOADING: announces a pending read instead of silently relabelling the button', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => { release = r; });
    global.fetch = vi.fn(async () => {
      await gate;
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { questions: [] } }),
      } as Response;
    }) as unknown as typeof fetch;

    render(React.createElement(TeacherWorksheetsPage));
    fireEvent.click(screen.getByText('Generate Worksheet'));

    expect(await screen.findByTestId('worksheets-loading')).toBeTruthy();
    release!();
    await waitFor(() => expect(screen.queryByTestId('worksheets-loading')).toBeNull());
  });

  it('P7: the read-failure surface is bilingual', async () => {
    authState.isHi = true;
    stubAnswerKey(KEY_500);

    render(React.createElement(TeacherWorksheetsPage));
    fireEvent.click(screen.getByText('वर्कशीट बनाएं'));

    expect(await screen.findByText('CBSE प्रश्न बैंक तक नहीं पहुंच सके')).toBeTruthy();
  });

  it('P7: the scope-denial surface is bilingual', async () => {
    authState.isHi = true;
    stubAnswerKey({
      status: 403,
      body: { success: false, error: 'out of scope', code: 'out_of_scope' },
    });

    render(React.createElement(TeacherWorksheetsPage));
    fireEvent.click(screen.getByText('वर्कशीट बनाएं'));

    expect(await screen.findByText('आप जो कक्षाएं पढ़ाते हैं, उनसे बाहर')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   TeacherDataError — the shared primitive
   ══════════════════════════════════════════════════════════════════════════ */
describe('TeacherDataError — one implementation, one honest contract', () => {
  it('pins the retry control at the 44px touch floor via computed inline style', () => {
    // Wave A found a retry button that laid out at 42px despite correct-looking
    // source, because an arbitrary `text-[13px]` leaves line-height to
    // inheritance. Asserting the resolved inline min-height (not a class
    // string) is the only check that cannot drift that way.
    render(
      React.createElement(TeacherDataError, {
        isHi: false,
        titleEn: 'Failed',
        titleHi: 'विफल',
        onRetry: vi.fn(),
        testId: 'touch-target-probe',
      }),
    );
    const button = screen.getByRole('button');
    expect(button.style.minHeight).toBe('44px');
    expect(button.style.minWidth).toBe('44px');
  });

  it('announces itself to assistive tech and asserts no number', () => {
    render(
      React.createElement(TeacherDataError, {
        isHi: false,
        titleEn: 'Failed',
        titleHi: 'विफल',
        onRetry: vi.fn(),
        testId: 'a11y-probe',
      }),
    );
    const card = screen.getByTestId('a11y-probe');
    expect(card.getAttribute('role')).toBe('alert');
    // A surface that could not read its data must not render a count, a
    // percentage or a score.
    expect(card.textContent).not.toMatch(/\d+%|\b\d+\b/);
  });

  it('invokes the caller-supplied retry (recovery is never a dead end)', () => {
    const onRetry = vi.fn();
    render(
      React.createElement(TeacherDataError, {
        isHi: false,
        titleEn: 'Failed',
        titleHi: 'विफल',
        onRetry,
        testId: 'retry-probe',
      }),
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('P7: both variants render Hindi when isHi is set', () => {
    const { rerender } = render(
      React.createElement(TeacherDataError, {
        isHi: true,
        titleEn: 'Could not load',
        titleHi: 'लोड नहीं हो सका',
        onRetry: vi.fn(),
      }),
    );
    expect(screen.getByText('लोड नहीं हो सका')).toBeTruthy();
    expect(screen.getByRole('button').textContent).toBe('पुनः प्रयास करें');

    rerender(
      React.createElement(TeacherDataError, {
        isHi: true,
        titleEn: 'Could not load',
        titleHi: 'लोड नहीं हो सका',
        onRetry: vi.fn(),
        variant: 'banner',
      }),
    );
    expect(screen.getByText('लोड नहीं हो सका')).toBeTruthy();
    expect(screen.getByRole('button').style.minHeight).toBe('44px');
  });
});
