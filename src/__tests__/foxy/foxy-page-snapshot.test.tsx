/**
 * Foxy page — regression-net snapshot test (BEFORE decomposition).
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 1: "Add a foxy snapshot regression test (BEFORE refactor)"
 *
 * This is NOT a pixel-perfect snapshot — that would be far too fragile for a
 * 2371-LOC page that emits 100s of nested elements. Instead it asserts the
 * *contract* that downstream decomposition tasks must keep green:
 *   1. The page renders without throwing.
 *   2. Some Foxy-branded label is present (English OR Hindi — the page is
 *      bilingual by AuthContext.isHi).
 *   3. There is at least one text input/textarea (the message input).
 *   4. There are several buttons (subject/mode/lang pickers).
 *
 * The 2371-LOC monolith pulls in ~25 components and 3 dynamic imports. Every
 * one of them is mocked here so this test is fast, deterministic, and survives
 * the upcoming carve-up into _components/* and _hooks/*.
 */

import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Dynamic imports inside the page ─────────────────────────────────────────
// All four pulled in via next/dynamic at the top of foxy/page.tsx. Mocked so
// the Suspense/dynamic boundary resolves synchronously to a tiny stub.
vi.mock('@/components/foxy/RichContent', () => ({
  RichContent: () => <div data-mock="rich" />,
  default: () => <div data-mock="rich-default" />,
}));
vi.mock('@/components/foxy/FoxyStructuredRenderer', () => ({
  FoxyStructuredRenderer: () => <div data-mock="structured" />,
  default: () => <div data-mock="structured-default" />,
}));
vi.mock('@/components/UpgradeModal', () => ({
  UpgradeModal: () => null,
  default: () => null,
}));
vi.mock('@/components/SELCheckIn', () => ({
  __esModule: true,
  default: () => null,
  useSELCheckIn: () => ({ shouldShow: false, markShown: () => {} }),
}));

// ── Heavy synchronous foxy imports — keep them cheap ────────────────────────
vi.mock('@/components/foxy/ChatBubble', () => ({
  ChatBubble: ({ content }: { content: React.ReactNode }) => (
    <div data-mock="chat-bubble">{content}</div>
  ),
}));
vi.mock('@/components/foxy/ChatInput', () => ({
  ChatInput: ({ onSubmit }: { onSubmit?: (s: string) => void }) => (
    <div data-mock="chat-input">
      <input type="text" aria-label="message" onChange={() => onSubmit?.('')} />
    </div>
  ),
}));
vi.mock('@/components/foxy/ConversationStarters', () => ({
  ConversationStarters: () => <div data-mock="starters" />,
}));
vi.mock('@/components/foxy/ConversationManager', () => ({
  ConversationManager: () => <div data-mock="conv-manager" />,
  ConversationHeader: () => <div data-mock="conv-header" />,
  generateTitle: (s: string) => s.slice(0, 30),
  SIMPLIFIED_MODES: [
    { id: 'learn', emoji: '📖', label: 'Learn', labelHi: 'सीखो' },
    { id: 'practice', emoji: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
  ],
  MODE_MAP: { learn: 'learn', practice: 'practice' },
}));
vi.mock('@/components/foxy/ConversationHeader', () => ({
  ConversationHeader: () => <div data-mock="conv-header2" />,
}));
vi.mock('@/components/foxy/LoadingState', () => ({
  LoadingState: () => <div data-mock="loading" />,
}));
vi.mock('@/components/foxy/StructuredRenderBoundary', () => ({
  StructuredRenderBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/InlineSimulation', () => ({
  InlineSimulation: () => <div data-mock="inline-sim" />,
  findSimulation: () => null,
}));
vi.mock('@/components/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// The page renders ContextPanel + FoxyStudySheet + FoxyToolsSheet (and, inside
// ContextPanel, MasteryAwareness) — all NON-mocked so their real render is
// exercised for coverage. Each pulls named exports from '@/components/ui', so
// this mock must expose every one of them or vitest throws an unhandled
// "No <X> export is defined on the mock" error mid-render. Transitive set:
//   - SheetModal  → ContextPanel, FoxyStudySheet, FoxyToolsSheet
//   - MasteryRing → MasteryAwareness (rendered inside ContextPanel)
//   - Skeleton    → MasteryAwareness
vi.mock('@/components/ui', () => ({
  BottomNav: () => <nav data-mock="bottom-nav" />,
  // Real signature (src/components/ui/index.tsx:1035):
  // SheetModal({ open, onClose, title, children }) — renders children only while
  // `open` is truthy, else null. Lightweight stub mirrors that contract.
  SheetModal: ({
    open,
    children,
  }: {
    open?: boolean;
    onClose?: () => void;
    title?: string;
    children?: React.ReactNode;
  }) => (open ? <div data-mock="sheet-modal">{children}</div> : null),
  MasteryRing: ({ children }: { children?: React.ReactNode }) => (
    <div data-mock="mastery-ring">{children}</div>
  ),
  Skeleton: () => <div data-mock="skeleton" />,
}));

// ── Lib imports ─────────────────────────────────────────────────────────────
// Stable auth-state object — reference equality is required because foxy/page
// uses `[authStudent]` in useEffect deps. A fresh object on every render would
// trigger an effect → setState → re-render loop and OOM the test runner.
const auth = vi.hoisted(() => ({
  state: null as Record<string, unknown> | null,
}));
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
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => auth.state,
}));

vi.mock('@/lib/supabase', () => {
  const orCalls: string[] = [];
  const queryBuilder: Record<string, unknown> = {
    select: () => queryBuilder,
    insert: () => queryBuilder,
    update: () => queryBuilder,
    upsert: () => queryBuilder,
    delete: () => queryBuilder,
    eq: () => queryBuilder,
    neq: () => queryBuilder,
    gt: () => queryBuilder,
    gte: () => queryBuilder,
    lt: () => queryBuilder,
    lte: () => queryBuilder,
    in: () => queryBuilder,
    is: () => queryBuilder,
    or: (clause: string) => {
      orCalls.push(clause);
      return queryBuilder;
    },
    order: () => queryBuilder,
    limit: () => queryBuilder,
    range: () => queryBuilder,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'test-token', user: { id: 'test-user' } } },
          error: null,
        }),
        getUser: async () => ({
          data: { user: { id: 'test-user', email: 't@example.com' } },
          error: null,
        }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => queryBuilder,
      rpc: async () => ({ data: null, error: null }),
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
      removeChannel: () => {},
    },
    __orCalls: orCalls,
  };
});

vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/constants');
  return {
    ...actual,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  };
});

// IMPORTANT: useAllowedSubjects is consumed in dependency arrays of useEffect
// (foxy/page.tsx lines 824 and 973). Returning a fresh array on every render
// would cause an infinite re-render loop. Use vi.hoisted so the stable
// references are created before the (hoisted) vi.mock factory runs.
const stable = vi.hoisted(() => ({
  // `subjects` is the FULL list (unlocked + locked). With locked empty here it
  // equals the unlocked entries. The page destructures `subjects` and calls
  // `.map` on it, so the mock must provide it.
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
vi.mock('@/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => stable.result,
}));

vi.mock('@/lib/usage', () => ({
  checkDailyUsage: async () => ({ allowed: true, remaining: 100, limit: 100, used: 0, plan: 'free' }),
  clearUsageCache: () => {},
}));

vi.mock('@/lib/voice', () => ({
  speak: () => ({ cancel: () => {} }),
  isVoiceSupported: () => false,
}));

vi.mock('@/lib/cognitive-engine', () => ({
  LESSON_STEPS: ['hook', 'explain', 'check', 'practice', 'reflect'],
  getLessonStepPrompt: () => '',
  getNextLessonStep: () => null,
}));

vi.mock('@/lib/foxy/is-foxy-response', () => ({
  isFoxyResponse: () => false,
}));
vi.mock('@/lib/foxy/recover-from-text', () => ({
  recoverFoxyResponseFromText: () => null,
}));
vi.mock('@/lib/foxy/denormalize', () => ({
  denormalizeFoxyResponse: (x: unknown) => x,
}));
vi.mock('@/lib/foxy/starter-intents', () => ({
  // starter-intents only exposes a type per the import line; nothing to mock,
  // but the module path must be resolvable for the type-only import.
}));

vi.mock('@/lib/analytics', () => ({
  track: () => {},
  setLearningContext: () => {},
  identifyUser: async () => {},
  resetAnalyticsIdentity: () => {},
}));

// next/navigation — useRouter is called at top of the component
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/foxy',
}));

// JSDOM doesn't implement Element.scrollTo. The page's auto-scroll-to-bottom
// effect (foxy/page.tsx ~line 987) fires inside a requestAnimationFrame and
// would throw an unhandled error AFTER assertions pass — noisy but harmless.
// Polyfill once at module load so it's a no-op in tests.
if (typeof Element !== 'undefined' && !(Element.prototype as { scrollTo?: unknown }).scrollTo) {
  (Element.prototype as { scrollTo: () => void }).scrollTo = () => {};
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
    body: null,
  }) as unknown as typeof fetch;
  // crypto.randomUUID is used by some session/code paths
  if (!('randomUUID' in (globalThis.crypto ?? {}))) {
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...(globalThis.crypto ?? {}), randomUUID: () => 'test-uuid' },
      configurable: true,
    });
  }
});

describe('Foxy page — regression snapshot (decomposition contract)', () => {
  it('renders without crashing', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    expect(() => render(<FoxyPage />)).not.toThrow();
  });

  it('shows a Foxy-branded label (English or Hindi)', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);
    // Wait for the auth-loading branch to settle into the main UI.
    await waitFor(() => {
      expect(container.textContent ?? '').toMatch(/Foxy|फॉक्सी/i);
    });
  });

  it('exposes at least one text input or textarea (message-input region)', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);
    await waitFor(() => {
      const inputs = container.querySelectorAll(
        'input[type="text"], input:not([type]), textarea',
      );
      expect(inputs.length).toBeGreaterThan(0);
    });
  });

  it('exposes multiple controls (subject / mode / language buttons)', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);
    await waitFor(() => {
      // Page renders LANGS (3) + MODES (7) + subject pickers + send + nav etc.
      // We only assert >= 3 to give the decomposed page room to reorganise
      // without breaking the contract.
      expect(container.querySelectorAll('button').length).toBeGreaterThan(2);
    });
  });

  it('normalizes a legacy "Grade 9" student row before loading grade-scoped topics', async () => {
    auth.state = {
      ...auth.state,
      student: {
        ...(auth.state?.student as Record<string, unknown>),
        grade: 'Grade 9',
      },
    };
    // The vi.mock factory above exposes the recorded `.or(clause)` arguments as
    // `__orCalls`, but the real `@/lib/supabase` module has no such export, so
    // cast through `unknown` to the mock-only shape rather than to bare `any`.
    const supabaseMod = (await import('@/lib/supabase')) as unknown as {
      __orCalls: string[];
    };
    const orCalls = supabaseMod.__orCalls;
    orCalls.length = 0;

    const { default: FoxyPage } = await import('@/app/foxy/page');
    render(<FoxyPage />);

    await waitFor(() => {
      expect(orCalls.some((clause) => clause === 'grade.eq.Grade 9,grade.eq.9')).toBe(true);
    });
  });
});
