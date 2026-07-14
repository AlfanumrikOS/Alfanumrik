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

import { render, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Dynamic imports inside the page ─────────────────────────────────────────
// All four pulled in via next/dynamic at the top of foxy/page.tsx. Mocked so
// the Suspense/dynamic boundary resolves synchronously to a tiny stub.
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

// ── Heavy synchronous foxy imports — keep them cheap ────────────────────────
vi.mock('@alfanumrik/ui/foxy/ChatBubble', () => {
  // MessageList imports ChatBubble as a DEFAULT import; the "active conversation"
  // test below renders real bubbles (messages.length > 0), so the mock must
  // expose both the named and default export or MessageList throws mid-render.
  const ChatBubbleMock = ({ content }: { content: React.ReactNode }) => (
    <div data-mock="chat-bubble">{content}</div>
  );
  return { ChatBubble: ChatBubbleMock, default: ChatBubbleMock };
});
vi.mock('@alfanumrik/ui/foxy/ChatInput', () => ({
  ChatInput: ({ onSubmit }: { onSubmit?: (s: string) => void }) => (
    <div data-mock="chat-input">
      <input type="text" aria-label="message" onChange={() => onSubmit?.('')} />
    </div>
  ),
}));
vi.mock('@alfanumrik/ui/foxy/ConversationStarters', () => ({
  ConversationStarters: () => <div data-mock="starters" />,
}));
vi.mock('@alfanumrik/ui/foxy/ConversationManager', () => ({
  ConversationManager: () => <div data-mock="conv-manager" />,
  ConversationHeader: () => <div data-mock="conv-header" />,
  generateTitle: (s: string) => s.slice(0, 30),
  SIMPLIFIED_MODES: [
    { id: 'learn', emoji: '📖', label: 'Learn', labelHi: 'सीखो' },
    { id: 'practice', emoji: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
  ],
  MODE_MAP: { learn: 'learn', practice: 'practice' },
}));
// NOTE: `@alfanumrik/ui/foxy/ConversationHeader` is intentionally NOT mocked.
// As of the 2026-07 desktop header compaction (branch ui/foxy-header-compact),
// the page no longer imports or renders <ConversationHeader> — its title +
// "New Chat" affordances were folded into the premium header band (Row 1). The
// former `conv-header2` mock was dead (the module isn't imported anywhere in the
// page), so it was pruned. See the "desktop header compaction" describe block
// below, which locks in the folded-into-Row-1 layout.
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
// The page renders ContextPanel + FoxyStudySheet + FoxyToolsSheet (and, inside
// ContextPanel, MasteryAwareness) — all NON-mocked so their real render is
// exercised for coverage. Each pulls named exports from '@alfanumrik/ui/ui', so
// this mock must expose every one of them or vitest throws an unhandled
// "No <X> export is defined on the mock" error mid-render. Transitive set:
//   - SheetModal  → ContextPanel, FoxyStudySheet, FoxyToolsSheet
//   - MasteryRing → MasteryAwareness (rendered inside ContextPanel)
//   - Skeleton    → MasteryAwareness
vi.mock('@alfanumrik/ui/ui', () => ({
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
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => auth.state,
}));

// This suite characterises the legacy Foxy page. Keep the server-authoritative
// V3 dispatcher explicitly in its flag-off state so these assertions do not
// depend on an API response (or accidentally exercise the permission state).
vi.mock('@alfanumrik/lib/use-experience-v3', () => ({
  useExperienceV3: () => ({
    enabled: false,
    loading: false,
    capabilities: {},
    manifest: null,
    routeAllowed: false,
    scope: null,
    legacyAllowed: true,
    denied: false,
  }),
}));

// Data-driven supabase mock. `db.data` defaults to EMPTY arrays — byte-identical
// behaviour to the original fixed `{ data: [] }` mock, so every existing test is
// unaffected. The "active conversation" test below seeds `foxy_sessions` +
// `foxy_chat_messages` so fetchRecentSession populates `messages.length > 0`
// and the empty-state → popover branch is exercised. Reset in beforeEach.
const db = vi.hoisted(() => ({
  data: {
    foxy_sessions: [] as Record<string, unknown>[],
    foxy_chat_messages: [] as Record<string, unknown>[],
  } as Record<string, Record<string, unknown>[]>,
}));
vi.mock('@alfanumrik/lib/supabase', () => {
  const orCalls: string[] = [];
  // A fresh builder per `from(table)` call, closed over its own table name, so
  // concurrent async chains (init effect + conversation-list effect) never race
  // on a shared "current table" variable.
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is',
      'order', 'limit', 'range',
    ]) {
      b[m] = () => b;
    }
    b.or = (clause: string) => {
      orCalls.push(clause);
      return b;
    };
    b.single = async () => ({ data: null, error: null });
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.data[table] ?? [], error: null });
    return b;
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
      from: (table: string) => makeBuilder(table),
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

vi.mock('@alfanumrik/lib/constants', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@alfanumrik/lib/constants');
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
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => stable.result,
}));

vi.mock('@alfanumrik/lib/usage', () => ({
  checkDailyUsage: async () => ({ allowed: true, remaining: 100, limit: 100, used: 0, plan: 'free' }),
  clearUsageCache: () => {},
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

vi.mock('@alfanumrik/lib/foxy/is-foxy-response', () => ({
  isFoxyResponse: () => false,
}));
vi.mock('@alfanumrik/lib/foxy/recover-from-text', () => ({
  recoverFoxyResponseFromText: () => null,
}));
vi.mock('@alfanumrik/lib/foxy/denormalize', () => ({
  denormalizeFoxyResponse: (x: unknown) => x,
}));
vi.mock('@alfanumrik/lib/foxy/starter-intents', () => ({
  // starter-intents only exposes a type per the import line; nothing to mock,
  // but the module path must be resolvable for the type-only import.
}));

vi.mock('@alfanumrik/lib/analytics', () => ({
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
  // Reset the seedable supabase tables so each test is independent (default
  // empty → messages.length === 0 → empty-state path).
  db.data.foxy_sessions = [];
  db.data.foxy_chat_messages = [];
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
    // `__orCalls`, but the real `@alfanumrik/lib/supabase` module has no such export, so
    // cast through `unknown` to the mock-only shape rather than to bare `any`.
    const supabaseMod = (await import('@alfanumrik/lib/supabase')) as unknown as {
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

/**
 * Desktop Foxy redesign (2026-07): the permanent Row-B ConversationStarters
 * FOOTER was removed. Starters now surface (a) inline in the empty state and
 * (b) behind a compact "💡 Suggestions" popover on an ACTIVE conversation — not
 * as an always-on second command row that steals reading space from the thread.
 *
 * ConversationStarters is mocked (data-mock="starters"), so counting the mock in
 * the DOM tells us exactly where the component renders.
 */
describe('Foxy page — conversation starters (footer removed, popover added)', () => {
  it('empty state: renders exactly ONE inline ConversationStarters and NO 💡 Suggestions toggle', async () => {
    // db stays empty (beforeEach) → messages.length === 0 → empty-state path.
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);
    // Exactly one starters block — the empty-state inline chips. A second
    // instance would mean an always-on footer had crept back in.
    await waitFor(() => {
      expect(container.querySelectorAll('[data-mock="starters"]').length).toBe(1);
    });
    // The Suggestions popover toggle is conditional on an active conversation,
    // so it must be ABSENT in the empty state.
    const hasSuggestionsToggle = Array.from(container.querySelectorAll('button')).some(
      (b) => /Suggestions|सुझाव/.test(b.textContent ?? ''),
    );
    expect(hasSuggestionsToggle).toBe(false);
  });

  it('active conversation: NO permanent starter footer — starters reachable only via the 💡 Suggestions popover', async () => {
    // Seed a resumed session so fetchRecentSession populates the thread and the
    // page switches out of the empty state.
    const now = new Date().toISOString();
    db.data.foxy_sessions = [
      { id: 'sess-1', subject: 'science', chapter: null, last_active_at: now },
    ];
    db.data.foxy_chat_messages = [
      { id: 'm-a', session_id: 'sess-1', role: 'assistant', content: 'Photosynthesis is how plants make food.', structured: null, created_at: now },
      { id: 'm-b', session_id: 'sess-1', role: 'user', content: 'Tell me more', structured: null, created_at: now },
    ];

    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);

    const findToggle = () =>
      Array.from(container.querySelectorAll('button')).find((b) =>
        /Suggestions|सुझाव/.test(b.textContent ?? ''),
      );

    // Wait for the resumed session to render the active-conversation UI (the
    // Suggestions toggle only exists when messages.length > 0).
    await waitFor(() => {
      expect(findToggle()).toBeTruthy();
    });

    // The permanent footer is gone: with an active thread, NO ConversationStarters
    // is rendered up-front.
    expect(container.querySelectorAll('[data-mock="starters"]').length).toBe(0);

    // Opening the popover surfaces the starters on demand — and only then.
    fireEvent.click(findToggle()!);
    expect(container.querySelectorAll('[data-mock="starters"]').length).toBe(1);
  });
});

/**
 * Desktop Foxy header compaction (2026-07, branch ui/foxy-header-compact):
 * 4 stacked chrome rows → 2. The standalone <ConversationHeader> row (the old
 * 4th row) was REMOVED; its two unique affordances — the active-conversation
 * TITLE and the "+ New Chat" button — were folded into the premium header band
 * (Row 1, `.foxy-header-premium`), gated on an active thread (messages.length
 * > 0). The subject-tabs row + chapter/mode toolbar were merged into ONE
 * `.foxy-toolbar` row (Row 2).
 *
 * These assertions lock the redesign in so a regression is caught if someone
 * (a) re-introduces a separate ConversationHeader row, or (b) drops the title
 * or "New Chat" from Row 1. Note: NO ConversationHeader mock exists anymore —
 * the page doesn't import that module — so a re-added header row would surface
 * a SECOND "New Chat" control and trip the exactly-one assertion below.
 */
describe('Foxy page — desktop header compaction (title + New Chat folded into Row 1)', () => {
  const seedActiveConversation = () => {
    const now = new Date().toISOString();
    db.data.foxy_sessions = [
      { id: 'sess-1', subject: 'science', chapter: null, last_active_at: now },
    ];
    db.data.foxy_chat_messages = [
      { id: 'm-a', session_id: 'sess-1', role: 'assistant', content: 'Photosynthesis is how plants make food.', structured: null, created_at: now },
      { id: 'm-b', session_id: 'sess-1', role: 'user', content: 'Tell me more', structured: null, created_at: now },
    ];
  };

  it('active conversation: the premium band (Row 1) owns the title + "New Chat"; there is no separate ConversationHeader row', async () => {
    seedActiveConversation();
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);

    const premiumBand = () => container.querySelector('.foxy-header-premium');

    // Wait for the resumed session to hydrate the active-conversation UI: the
    // "New Chat" affordance only exists once messages.length > 0.
    await waitFor(() => {
      const band = premiumBand();
      expect(band).toBeTruthy();
      expect(band!.textContent ?? '').toMatch(/New Chat|नई चैट/);
    });

    const band = premiumBand()!;
    // The conversation TITLE folded into Row 1. generateTitle() runs on the
    // seeded first user turn ('Tell me more') → title === 'Tell me more'
    // (deterministic: fetchRecentSession maps role 'user' → 'student', which
    // generateTitle picks as firstUserMsg; no prefix is stripped).
    expect(band.textContent ?? '').toContain('Tell me more');
    // …and the message-count chip rides along in Row 1.
    expect(band.textContent ?? '').toMatch(/\d+\s*(msgs|संदेश)/);

    // The "New Chat" button lives INSIDE the premium band — not in a 4th row.
    // Exactly one such control must exist in the whole tree: a re-introduced
    // ConversationHeader row would render a second one and fail here.
    const newChatButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      /New Chat|नई चैट/.test(b.textContent ?? ''),
    );
    expect(newChatButtons).toHaveLength(1);
    expect(band.contains(newChatButtons[0])).toBe(true);

    // Header is now exactly two rows: Row 1 (.foxy-header-premium) + Row 2
    // (.foxy-toolbar — subjects · chapter · modes merged). No stray old
    // ConversationHeader mock leaks into the DOM either.
    expect(container.querySelectorAll('.foxy-header-premium')).toHaveLength(1);
    expect(container.querySelectorAll('.foxy-toolbar')).toHaveLength(1);
    expect(container.querySelector('[data-mock="conv-header2"]')).toBeNull();
  });

  it('empty state: Row 1 renders but withholds the title + "New Chat" until a thread exists', async () => {
    // db stays empty (beforeEach) → messages.length === 0 → empty-state path.
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);

    await waitFor(() => {
      expect(container.querySelector('.foxy-header-premium')).toBeTruthy();
    });
    const band = container.querySelector('.foxy-header-premium')!;
    // No active thread → the folded-in title + New Chat control stay hidden.
    expect(band.textContent ?? '').not.toMatch(/New Chat|नई चैट/);
    const newChatButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      /New Chat|नई चैट/.test(b.textContent ?? ''),
    );
    expect(newChatButtons).toHaveLength(0);
  });
});
