import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * CHAINED LEARNING ACTION — page.tsx bonus fix for the "question renders twice"
 * bug.
 *
 * Scenario the guard locks in:
 *   1. Student asks a real question ("What is photosynthesis…") → tutor answers.
 *   2. Student taps "Explain simpler" → the page re-sends the ORIGINAL question
 *      with coachDirective 'simplify'. The hook appends a compact DIRECTIVE PILL
 *      (marker `directive`, content = a short bilingual label) instead of
 *      re-echoing the whole question.
 *   3. Student taps "Show example" on the NEW tutor bubble → the page must again
 *      re-send the ORIGINAL question, NOT the pill label. The lookup in
 *      `handleLearningAction` skips directive-echo bubbles
 *      (`m.role === 'student' && !m.directive`).
 *
 * This is an INTEGRATION test of the real page (handleLearningAction) + the real
 * useFoxyChat hook (which produces the pill) + the real MessageList (which paints
 * the pill and skips it). Only the ChatBubble LEAF is stubbed — its own DOM
 * (chip labels, overflow menu, dispatch mapping) is covered exhaustively in
 * learning-action-chat-bubble.test.tsx — so this file can drive the two chip taps
 * deterministically without depending on ChatBubble's internal layout.
 */

function jsonOk(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;
}

// ── Flag ON: the learning-action bar (and thus handleLearningAction wiring) only
//    exists when ff_foxy_learning_actions_v1 is enabled. ──
vi.mock('@alfanumrik/lib/use-foxy-learning-actions-flag', () => ({
  useFoxyLearningActionsFlag: () => true,
  getFoxyLearningActionsFlagSync: () => true,
  clearFoxyLearningActionsFlagCache: () => {},
}));

// ── ChatBubble stub — a controllable leaf that surfaces the learning-action
//    callback as three buttons for TUTOR bubbles when the flag is on. ──
vi.mock('@alfanumrik/ui/foxy/ChatBubble', () => {
  const Stub = (props: {
    role?: string;
    rawContent?: unknown;
    learningActionsEnabled?: boolean;
    onLearningAction?: (action: string) => void;
  }) => {
    const { role, rawContent, learningActionsEnabled, onLearningAction } = props;
    const showBar = role === 'tutor' && learningActionsEnabled && !!onLearningAction;
    return (
      <div data-mock="chat-bubble" data-role={role}>
        <span data-testid="bubble-raw">{typeof rawContent === 'string' ? rawContent : ''}</span>
        {showBar ? (
          <div>
            <button data-testid="la-simpler" onClick={() => onLearningAction!('explain_simpler')}>
              simpler
            </button>
            <button data-testid="la-example" onClick={() => onLearningAction!('show_example')}>
              example
            </button>
            <button data-testid="la-quiz" onClick={() => onLearningAction!('quiz_me')}>
              quiz
            </button>
          </div>
        ) : null}
      </div>
    );
  };
  return { __esModule: true, ChatBubble: Stub, default: Stub };
});

// ── Dynamic imports inside the page (next/dynamic) — stubbed to tiny nodes. ──
vi.mock('@alfanumrik/ui/foxy/RichContent', () => ({
  RichContent: () => <div data-mock="rich" />,
  default: () => <div data-mock="rich-default" />,
}));
vi.mock('@alfanumrik/ui/foxy/FoxyStructuredRenderer', () => ({
  FoxyStructuredRenderer: () => <div data-mock="structured" />,
  default: () => <div data-mock="structured-default" />,
}));
vi.mock('@alfanumrik/ui/UpgradeModal', () => ({
  UpgradeModal: () => null,
  default: () => null,
}));
vi.mock('@alfanumrik/ui/SELCheckIn', () => ({
  __esModule: true,
  default: () => null,
  useSELCheckIn: () => ({ shouldShow: false, markShown: () => {} }),
}));
vi.mock('@alfanumrik/ui/foxy/ChatInput', () => ({
  ChatInput: () => <div data-mock="chat-input"><input type="text" aria-label="message" /></div>,
}));
vi.mock('@alfanumrik/ui/foxy/ConversationStarters', () => ({
  ConversationStarters: () => <div data-mock="starters" />,
}));
vi.mock('@alfanumrik/ui/foxy/ConversationManager', () => ({
  ConversationManager: () => <div data-mock="conv-manager" />,
  ConversationHeader: () => <div data-mock="conv-header" />,
  generateTitle: (s: unknown) => (typeof s === 'string' ? s.slice(0, 30) : 'Conversation'),
  SIMPLIFIED_MODES: [
    { id: 'learn', emoji: '📖', label: 'Learn', labelHi: 'सीखो' },
    { id: 'practice', emoji: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
  ],
  MODE_MAP: { learn: 'learn', practice: 'practice' },
}));
vi.mock('@alfanumrik/ui/foxy/LoadingState', () => ({
  LoadingState: () => <div data-mock="loading" />,
}));
vi.mock('@alfanumrik/ui/foxy/StructuredRenderBoundary', () => ({
  StructuredRenderBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alfanumrik/ui/InlineSimulation', () => ({
  InlineSimulation: () => <div data-mock="inline-sim" />,
  findSimulation: () => null,
}));
vi.mock('@alfanumrik/ui/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alfanumrik/ui/ui', () => ({
  BottomNav: () => <nav data-mock="bottom-nav" />,
  SheetModal: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-mock="sheet-modal">{children}</div> : null,
  MasteryRing: ({ children }: { children?: React.ReactNode }) => <div data-mock="mastery-ring">{children}</div>,
  Skeleton: () => <div data-mock="skeleton" />,
}));

// ── Lib imports ──
const auth = vi.hoisted(() => ({ state: null as Record<string, unknown> | null }));
auth.state = {
  authUserId: 'test-user',
  student: {
    id: 's-1',
    name: 'Test Student',
    grade: '9',
    xp_total: 100,
    streak_days: 3,
    preferred_language: 'en',
    preferred_subject: 'science',
    selected_subjects: ['science', 'math'],
    subscription_plan: 'free',
  },
  snapshot: null,
  teacher: null,
  guardian: null,
  roles: ['student'],
  activeRole: 'student',
  setActiveRole: () => {},
  isLoggedIn: true,
  isLoading: false,
  isHi: false,
  isDemoUser: false,
  language: 'en',
  setLanguage: () => {},
  theme: 'system',
  toggleTheme: () => {},
  refreshStudent: async () => {},
  refreshSnapshot: async () => {},
  signOut: async () => {},
};
vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => auth.state }));

const db = vi.hoisted(() => ({
  data: {
    foxy_sessions: [] as Record<string, unknown>[],
    foxy_chat_messages: [] as Record<string, unknown>[],
  } as Record<string, Record<string, unknown>[]>,
}));
vi.mock('@alfanumrik/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is',
      'order', 'limit', 'range', 'or',
    ]) {
      b[m] = () => b;
    }
    b.single = async () => ({ data: null, error: null });
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: db.data[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'test-token', user: { id: 'test-user' } } },
          error: null,
        }),
        getUser: async () => ({ data: { user: { id: 'test-user', email: 't@example.com' } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => makeBuilder(table),
      rpc: async () => ({ data: null, error: null }),
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
      removeChannel: () => {},
    },
  };
});

vi.mock('@alfanumrik/lib/constants', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@alfanumrik/lib/constants');
  return { ...actual, SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-anon-key' };
});

const stable = vi.hoisted(() => ({
  subjects: [
    { code: 'science', name: 'Science', icon: '⚛', color: '#10B981' },
    { code: 'math', name: 'Math', icon: '➗', color: '#3B82F6' },
  ],
  unlocked: [
    { code: 'science', name: 'Science', icon: '⚛', color: '#10B981' },
    { code: 'math', name: 'Math', icon: '➗', color: '#3B82F6' },
  ],
  locked: [] as unknown[],
  result: null as { subjects: unknown[]; unlocked: unknown[]; locked: unknown[]; loading: boolean; error: null } | null,
}));
stable.result = { subjects: stable.subjects, unlocked: stable.unlocked, locked: stable.locked, loading: false, error: null };
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({ useAllowedSubjects: () => stable.result }));

vi.mock('@alfanumrik/lib/usage', () => ({
  checkDailyUsage: async () => ({ allowed: true, remaining: 100, limit: 100, used: 0, count: 0, plan: 'free' }),
  clearUsageCache: () => {},
  isUnlimitedUsage: (limit: number | null | undefined) => typeof limit === 'number' && limit >= 999999,
}));

vi.mock('@alfanumrik/lib/voice', () => ({
  speak: () => ({ cancel: () => {} }),
  isVoiceSupported: () => false,
}));

vi.mock('@alfanumrik/lib/cognitive-engine', () => ({
  LESSON_STEPS: ['hook', 'explain', 'check', 'practice', 'reflect'],
  getLessonStepPrompt: () => '',
  getNextLessonStep: () => null,
}));

vi.mock('@alfanumrik/lib/foxy/is-foxy-response', () => ({ isFoxyResponse: () => false }));
vi.mock('@alfanumrik/lib/foxy/recover-from-text', () => ({ recoverFoxyResponseFromText: () => null }));
vi.mock('@alfanumrik/lib/foxy/denormalize', () => ({ denormalizeFoxyResponse: (x: unknown) => x }));
vi.mock('@alfanumrik/lib/foxy/starter-intents', () => ({}));

vi.mock('@alfanumrik/lib/analytics', () => ({
  track: () => {},
  setLearningContext: () => {},
  identifyUser: async () => {},
  resetAnalyticsIdentity: () => {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/foxy',
}));

// JSDOM has no Element.scrollTo — polyfill so the page's auto-scroll effect is a no-op.
if (typeof Element !== 'undefined' && !(Element.prototype as { scrollTo?: unknown }).scrollTo) {
  (Element.prototype as { scrollTo: () => void }).scrollTo = () => {};
}

const ORIGINAL_Q = 'What is photosynthesis and why does it matter?';
const SIMPLER_LABEL_EN = '🔁 Explain simpler';

let fetchMock: ReturnType<typeof vi.fn>;

/** Every /api/foxy POST body, parsed, in call order. */
function foxyBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter((c) => c[0] === '/api/foxy')
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

beforeEach(() => {
  const now = Date.now();
  db.data.foxy_sessions = [
    { id: 'sess-1', subject: 'science', chapter: null, last_active_at: new Date(now).toISOString() },
  ];
  // Ordered ascending by created_at: the ORIGINAL question, then the tutor answer.
  db.data.foxy_chat_messages = [
    { id: 'q1', session_id: 'sess-1', role: 'user', content: ORIGINAL_Q, structured: null, created_at: new Date(now - 2000).toISOString() },
    { id: 'a1', session_id: 'sess-1', role: 'assistant', content: 'Plants make food from sunlight.', structured: null, created_at: new Date(now - 1000).toISOString() },
  ];

  fetchMock = vi.fn((url: string) => {
    if (url === '/api/foxy') {
      return Promise.resolve(
        jsonOk({ response: 'Here is a re-teach answer.', sessionId: 'sess-1', groundingStatus: 'grounded', messageId: 'm-new' }),
      );
    }
    // /api/foxy/learning-action telemetry + any other init fetch.
    return Promise.resolve(jsonOk({ success: true, data: { recorded: true } }));
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  // Ensure streaming is OFF so the deterministic JSON branch runs.
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('alfanumrik_foxy_stream'); } catch { /* ignore */ }
  }
  if (!('randomUUID' in (globalThis.crypto ?? {}))) {
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...(globalThis.crypto ?? {}), randomUUID: () => 'test-uuid' },
      configurable: true,
    });
  }
});

describe('chained learning action — the pill is skipped so the ORIGINAL question is re-taught', () => {
  it('after a directive pill, a SECOND action re-sends the ORIGINAL question, not the pill label', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    render(<FoxyPage />);

    // The resumed session renders the ORIGINAL question + one tutor bubble; the
    // tutor bubble exposes the learning-action chips (flag ON).
    const simpler = await screen.findByTestId('la-simpler', {}, { timeout: 5000 });

    // ── First learning action: "Explain simpler" ──
    fireEvent.click(simpler);

    // The display fix: a compact directive PILL is appended (not a re-echo of the
    // full question).
    const pill = await screen.findByTestId('directive-echo-pill', {}, { timeout: 5000 });
    expect(pill.textContent).toBe(SIMPLER_LABEL_EN);

    // The first re-send still carried the ORIGINAL question to the server.
    await waitFor(
      () => expect(foxyBodies().some((b) => b.coachDirective === 'simplify')).toBe(true),
      { timeout: 5000 },
    );
    const firstBody = foxyBodies().find((b) => b.coachDirective === 'simplify')!;
    expect(firstBody.message).toBe(ORIGINAL_Q);

    // The re-teach reply is a NEW tutor bubble → now TWO example chips exist
    // (original answer + re-teach answer).
    await waitFor(
      () => expect(screen.getAllByTestId('la-example').length).toBe(2),
      { timeout: 5000 },
    );

    // ── Second (chained) learning action on the NEWEST tutor bubble ──
    const examples = screen.getAllByTestId('la-example');
    fireEvent.click(examples[examples.length - 1]);

    // THE BONUS FIX: the prior-question lookup skips the directive pill and
    // re-sends the ORIGINAL question — never the pill label.
    await waitFor(
      () => expect(foxyBodies().some((b) => b.coachDirective === 'example')).toBe(true),
      { timeout: 5000 },
    );
    const secondBody = foxyBodies().find((b) => b.coachDirective === 'example')!;
    expect(secondBody.message).toBe(ORIGINAL_Q);
    expect(secondBody.message).not.toBe(SIMPLER_LABEL_EN);
    expect(secondBody.message as string).not.toContain('Explain simpler');
  });
});
