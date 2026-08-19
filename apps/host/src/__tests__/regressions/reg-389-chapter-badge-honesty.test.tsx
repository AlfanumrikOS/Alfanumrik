/**
 * REG-389 — the chapter-picker question badge is HONEST: it renders what the
 * practice path can actually serve, and "unknown" is never rendered as zero.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DEFECT CLASS
 * ═══════════════════════════════════════════════════════════════════════════
 * The badge used to render `verified_question_count` — a READINESS signal
 * ("an agent proved this against NCERT"), not a servability count. The
 * AI-repair agent (`fix-failed-questions/tools/commit-fix.ts`) sets
 * `verification_state='verified'` + `verified_against_ncert=true` and never
 * `is_verified`, so a repaired question raised the badge while
 * `get_quiz_questions` — which filtered `is_verified` — could not serve it.
 * The picker advertised a question count the platform could not deliver.
 *
 * Migration `20260814000014` split that one number into `practice_ready_count`
 * (what practice can serve) and `exam_ready_count` (that, plus the human-SME
 * gate mock tests still enforce). The badge now reads `practice_ready_count`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE THIRD STATE IS THE ONE THAT MATTERS
 * ═══════════════════════════════════════════════════════════════════════════
 * Against a database where migration 20260814000014 has NOT been applied, the
 * RPC returns the original four columns and `practice_ready_count` arrives
 * `undefined`. `undefined` means UNKNOWN. Coercing it (`?? 0`) would paint
 * "0 questions" onto chapters that are full of them — which is a fresh
 * instance of the exact defect class this whole effort exists to eliminate:
 * a failure rendered as a confident, reassuring, WRONG empty statement. A
 * student reading "0 questions" does not retry; they leave.
 *
 * So the contract is three-valued, and the guard must be `typeof x === 'number'`
 * rather than a truthiness or `?? 0` check:
 *   undefined -> render NO badge (make no claim)
 *   0         -> render NO badge (make no claim)
 *   n > 0     -> render "n questions"
 *
 * Both zero-ish cases collapse to "no badge", which is why a test that only
 * checked `undefined` would pass against a `?? 0` implementation too — the
 * discriminating assertion is that the string "0" never appears in a badge.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THIS PROVES — AND WHAT IT DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVES: behaviourally, against the REAL `/learn` page component rendered in
 * JSDOM, that each of the three input states produces the right visible
 * output, in BOTH languages (P7), and that the stale `verified_question_count`
 * can never drive the badge.
 *
 * DOES NOT PROVE: that the RPC actually populates `practice_ready_count`
 * correctly (no Postgres here — REG-388 pins the SQL floor that defines it),
 * nor that the chapter row stays tappable in a real browser (JSDOM computes no
 * layout).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const { authState, chaptersRead } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', grade: '8', subscription_plan: 'pro' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
  chaptersRead: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/learn',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const MATH = {
  code: 'math',
  name: 'Mathematics',
  name_hi: 'गणित',
  icon: '∑',
  color: '#7C3AED',
  isLocked: false,
};
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ subjects: [MATH], unlocked: [MATH], locked: [], isLoading: false }),
}));

vi.mock('@alfanumrik/lib/useSubjectReadiness', () => ({
  useSubjectReadiness: () => ({ readiness: null, isLoading: false, error: null }),
}));

// Alfa-OS hub replaces the chapter list entirely when ON — keep it OFF so the
// chapter list (the surface under test) renders.
vi.mock('@alfanumrik/lib/use-subjects-os-flag', () => ({
  useSubjectsOsFlag: () => false,
  getSubjectsOsFlagSync: () => false,
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));

// The page moved off `getChaptersForSubject` onto the governed
// `useAllowedChapters` SWR hook. Fake the HOOK, not SWR, and keep the same
// ServiceResult fixtures below, so these tests still assert product behaviour
// (error card vs empty state vs list, retry, logging) rather than the
// data-fetching library. `refresh()` re-runs the read, which is what the
// "Try again" control must do.
vi.mock('@alfanumrik/lib/useAllowedChapters', async () => {
  const ReactMod = await import('react');
  return {
    useAllowedChapters: (subjectCode?: string | null) => {
      const [state, setState] = ReactMod.useState<{
        chapters: Array<Record<string, unknown>>;
        isLoading: boolean;
        error: Error | null;
      }>({ chapters: [], isLoading: false, error: null });
      const [attempt, setAttempt] = ReactMod.useState(0);

      ReactMod.useEffect(() => {
        if (!subjectCode) {
          setState({ chapters: [], isLoading: false, error: null });
          return;
        }
        let live = true;
        setState((s) => ({ ...s, isLoading: true }));
        Promise.resolve(chaptersRead(subjectCode))
          .then((res: { ok: boolean; data?: unknown[]; error?: string }) => {
            if (!live) return;
            if (!res || !res.ok) {
              setState({ chapters: [], isLoading: false, error: new Error(res?.error ?? 'chapters.fetch_failed') });
              return;
            }
            setState({ chapters: (res.data ?? []) as Array<Record<string, unknown>>, isLoading: false, error: null });
          })
          .catch((e: unknown) => {
            if (!live) return;
            setState({ chapters: [], isLoading: false, error: e instanceof Error ? e : new Error('unknown error') });
          });
        return () => { live = false; };
      }, [subjectCode, attempt]);

      return { ...state, refresh: () => setAttempt((a) => a + 1) };
    },
  };
});


vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'in', 'single', 'maybeSingle'];
  return {
    getChaptersForSubject: chaptersRead,
    supabase: {
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => {
          builder[m] = vi.fn(() => builder);
        });
        builder.then = (resolvefn: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolvefn);
        return builder;
      }),
    },
  };
});

import LearnPage from '@/app/(student)/learn/page';

type ChapterFixture = {
  chapter_number: number;
  title: string;
  title_hi?: string | null;
  verified_question_count?: number;
  practice_ready_count?: number;
  exam_ready_count?: number;
};

async function renderWithChapters(chapters: ChapterFixture[], hindi = false) {
  authState.isHi = hindi;
  chaptersRead.mockResolvedValue({ ok: true, data: chapters });
  render(React.createElement(LearnPage));
  const tile = await screen.findByText('Mathematics');
  fireEvent.click(tile);
  // The page prefers the Hindi chapter title when isHi, so wait on whichever
  // string this render is actually expected to paint.
  const settled = (hindi && chapters[0].title_hi) || chapters[0].title;
  await waitFor(() => expect(screen.getByText(settled)).toBeDefined());
}

/** The badge is the only element carrying the 📝 marker. */
function badgeTexts(): string[] {
  return Array.from(document.querySelectorAll('span'))
    .map((el) => el.textContent ?? '')
    .filter((t) => t.includes('📝'));
}

beforeEach(() => {
  authState.isHi = false;
  chaptersRead.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('REG-389: chapter badge renders practice_ready_count, and unknown is never zero', () => {
  it('renders "N questions" when practice_ready_count is a positive number', async () => {
    await renderWithChapters([
      { chapter_number: 1, title: 'Number Systems', practice_ready_count: 12 },
    ]);
    expect(badgeTexts()).toHaveLength(1);
    expect(badgeTexts()[0]).toContain('12');
    expect(badgeTexts()[0]).toContain('questions');
  });

  it('renders NO badge — and never the string "0" — when practice_ready_count is undefined (pre-migration DB)', async () => {
    // THE CORE ASSERTION. `undefined` means the tiered-count migration is not
    // live on this database: the count is UNKNOWN. A `?? 0` implementation
    // would render "📝 0 questions" here and this test is what stops it.
    await renderWithChapters([
      {
        chapter_number: 1,
        title: 'Number Systems',
        // Deliberately present and NON-ZERO: the chapter demonstrably has
        // questions by the old signal, so a "0 questions" badge would not
        // merely be unhelpful, it would be a lie the page has evidence against.
        verified_question_count: 40,
        practice_ready_count: undefined,
      },
    ]);
    expect(badgeTexts()).toEqual([]);
    expect(screen.queryByText(/0 questions/)).toBeNull();
    // The row itself must still render and stay usable — "unknown count" is
    // not "broken chapter". Silence, not an error state.
    expect(screen.getByText('Number Systems')).toBeDefined();
  });

  it('renders NO badge when practice_ready_count is genuinely 0 (a claim of zero is still a claim)', async () => {
    await renderWithChapters([
      { chapter_number: 1, title: 'Number Systems', practice_ready_count: 0 },
    ]);
    expect(badgeTexts()).toEqual([]);
    expect(screen.queryByText(/0 questions/)).toBeNull();
  });

  it('NEVER falls back to verified_question_count — the stale signal that caused the defect', async () => {
    // practice_ready_count absent, verified_question_count present and large.
    // The pre-fix page rendered "📝 40 questions" from exactly this shape while
    // the quiz could serve none of them.
    await renderWithChapters([
      {
        chapter_number: 1,
        title: 'Number Systems',
        verified_question_count: 40,
        exam_ready_count: 7,
      },
    ]);
    expect(badgeTexts()).toEqual([]);
    expect(screen.queryByText(/40/)).toBeNull();
    // exam_ready_count is a mock-test signal and must not leak into the
    // practice picker badge either.
    expect(screen.queryByText(/7 questions/)).toBeNull();
  });

  it('renders the Hindi badge from the same field (P7) and still suppresses unknown', async () => {
    await renderWithChapters(
      [
        { chapter_number: 1, title: 'Number Systems', title_hi: 'संख्या पद्धति', practice_ready_count: 9 },
        { chapter_number: 2, title: 'Polynomials', title_hi: 'बहुपद', verified_question_count: 25 },
      ],
      true,
    );
    const badges = badgeTexts();
    // Exactly one chapter makes a claim; the unknown one stays silent.
    expect(badges).toHaveLength(1);
    expect(badges[0]).toContain('9');
    expect(badges[0]).toContain('प्रश्न');
    // Numerals stay Arabic in Hindi (house rule — numbers are not localised).
    expect(badges[0]).not.toMatch(/[०-९]/);
  });

  it('renders each chapter independently — one unknown row does not suppress a known sibling', async () => {
    // Guards the plausible over-correction: bailing out of the whole badge
    // column as soon as any row lacks the field.
    await renderWithChapters([
      { chapter_number: 1, title: 'Number Systems', practice_ready_count: 12 },
      { chapter_number: 2, title: 'Polynomials', verified_question_count: 30 },
      { chapter_number: 3, title: 'Coordinate Geometry', practice_ready_count: 0 },
      { chapter_number: 4, title: 'Linear Equations', practice_ready_count: 5 },
    ]);
    const badges = badgeTexts();
    expect(badges).toHaveLength(2);
    expect(badges.join(' | ')).toContain('12');
    expect(badges.join(' | ')).toContain('5');
    expect(badges.join(' | ')).not.toContain('30');
  });
});
