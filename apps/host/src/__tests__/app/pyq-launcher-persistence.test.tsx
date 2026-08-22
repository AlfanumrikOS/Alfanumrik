/**
 * /pyq — data-loss hole CLOSED (Phase 5 track A, 2026-08-11).
 *
 * THE DEFECT
 * ----------
 * `/pyq` was a second, independent quiz runtime. It fetched year-tagged rows
 * from `question_bank` INCLUDING `correct_answer_index`, rendered its own
 * options, graded the tap in the browser (`idx === q.correct_answer_index`),
 * showed its own explanation and its own "Session Complete" screen — and wrote
 * NOTHING. No quiz_session, no responses, no XP, no mastery, no streak. A
 * student answered 25-30 board questions and the product kept none of it.
 * Shipping the answer key to the browser also defeated the whole point of the
 * server-owned shuffle snapshot.
 *
 * WHAT THIS TEST PROVES
 * ---------------------
 *   1. BEHAVIOURAL — picking a subject + year and pressing start navigates into
 *      the canonical engine with the year attached. That is the persistence
 *      claim: `/quiz` is the ONLY surface wired to `start_quiz_session` +
 *      `submit_quiz_results` + `atomic_quiz_profile_update`.
 *   2. STATIC — the launcher contains no answer key and no grading. A unit test
 *      cannot exercise the real RPC (it needs Postgres), so the wiring is pinned
 *      instead: the launcher must NOT be able to grade, and the year must reach
 *      `assembleQuiz` on the quiz page.
 *
 * Deliberate limit: this does not assert a row lands in `quiz_sessions` — that
 * is DB-backed and belongs to the integration lane. It asserts the launcher
 * cannot bypass the path that writes one, which is the property that regressed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/useRequireAuth', () => ({
  useRequireAuth: () => ({
    isReady: true,
    isHi: false,
    isLoggedIn: true,
    isLoading: false,
    activeRole: 'student',
    student: { id: 'stu-1', grade: '10' },
  }),
}));

const subjectsState = {
  unlocked: [{ code: 'math', name: 'Math', nameHi: 'गणित', icon: '∑', color: '#7C3AED', isLocked: false }],
  locked: [] as unknown[],
  isLoading: false,
  degraded: false,
  refresh: vi.fn(),
};
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => subjectsState,
}));

function findRepoRoot(): string {
  const candidates = [resolve(process.cwd(), '..', '..'), resolve(process.cwd(), '..'), process.cwd()];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/ui/src'))) return c;
  }
  throw new Error('pyq-launcher: could not locate the monorepo root');
}
const REPO_ROOT = findRepoRoot();
const PYQ_SRC = readFileSync(
  resolve(REPO_ROOT, 'apps/host/src/app/(student)/pyq/page.tsx'),
  'utf8',
);

beforeEach(() => {
  push.mockReset();
  subjectsState.unlocked = [
    { code: 'math', name: 'Math', nameHi: 'गणित', icon: '∑', color: '#7C3AED', isLocked: false },
  ];
  subjectsState.locked = [];
  subjectsState.isLoading = false;
  subjectsState.degraded = false;
});

async function loadPage() {
  const mod = await import('@/app/(student)/pyq/page');
  return mod.default;
}

describe('/pyq launches the canonical quiz engine (results persist)', () => {
  it('navigates to /quiz with the subject and board year attached', async () => {
    const Page = await loadPage();
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /Math/i }));
    // The year list is derived from the clock; take whatever the picker offers.
    const year = new Date().getUTCFullYear();
    fireEvent.click(screen.getByRole('button', { name: String(year) }));
    fireEvent.click(screen.getByTestId('pyq-start'));

    expect(push).toHaveBeenCalledTimes(1);
    const href: string = push.mock.calls[0][0];
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe('/quiz');
    expect(url.searchParams.get('subject')).toBe('math');
    expect(url.searchParams.get('year')).toBe(String(year));
    // A valid /quiz count — anything else is silently ignored by the quiz page.
    expect(['5', '10', '15', '20']).toContain(url.searchParams.get('count'));
  });

  it('renders no start control until BOTH subject and year are chosen (no dead button)', async () => {
    const Page = await loadPage();
    render(<Page />);

    expect(screen.queryByTestId('pyq-start')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Math/i }));
    expect(screen.queryByTestId('pyq-start')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: String(new Date().getUTCFullYear()) }));
    expect(screen.getByTestId('pyq-start')).toBeInTheDocument();
  });

  it('states up front that the attempt is saved, and that the year may fall back', async () => {
    const Page = await loadPage();
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /Math/i }));
    fireEvent.click(screen.getByRole('button', { name: String(new Date().getUTCFullYear()) }));

    // The retired runtime claimed the year and explained the fallback in a
    // small mid-quiz badge. Honest disclosure now precedes the launch.
    expect(screen.getByText(/score, XP and progress are saved/i)).toBeInTheDocument();
    expect(screen.getByText(/board-pattern questions from the same subject/i)).toBeInTheDocument();
  });
});

describe('/pyq required UI states', () => {
  it('shows an honest-failure state with retry when the subjects source is degraded', async () => {
    subjectsState.degraded = true;
    subjectsState.unlocked = [];
    const Page = await loadPage();
    render(<Page />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load your subjects/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('shows an empty state (not an upgrade prompt) when no subjects are mapped', async () => {
    subjectsState.unlocked = [];
    subjectsState.locked = [];
    const Page = await loadPage();
    render(<Page />);
    expect(screen.getByText(/No subjects set up yet/i)).toBeInTheDocument();
  });

  it('shows a loading skeleton while the subject list is still resolving', async () => {
    subjectsState.unlocked = [];
    subjectsState.isLoading = true;
    const Page = await loadPage();
    render(<Page />);
    expect(screen.getByLabelText(/Loading subjects/i)).toBeInTheDocument();
  });
});

describe('/pyq no longer grades in the browser', () => {
  /**
   * Assertions run against CODE only. The page's header comment deliberately
   * names `correct_answer_index` and `question_bank` while explaining what was
   * removed and why — that record is the point, and a naive whole-file grep
   * would force the next author to delete the explanation to keep the suite
   * green. Strip comments, then assert.
   */
  const PYQ_CODE = PYQ_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('the stripper is honest — the file still documents the removal', () => {
    // Non-vacuity in both directions: comments were really removed, and the
    // history really is still there to be removed.
    expect(PYQ_SRC).toMatch(/correct_answer_index/);
    expect(PYQ_CODE.length).toBeLessThan(PYQ_SRC.length);
    expect(PYQ_CODE).toMatch(/export default function/);
  });

  it('never reads correct_answer_index', () => {
    expect(PYQ_CODE).not.toMatch(/correct_answer_index/);
  });

  it('never queries question_bank directly', () => {
    expect(PYQ_CODE).not.toMatch(/question_bank/);
  });

  it('imports no Supabase client at all', () => {
    expect(PYQ_CODE).not.toMatch(/@alfanumrik\/lib\/supabase/);
  });

  it('keeps no correctness / score state', () => {
    // The retired runtime tracked `correctCount` and derived a percentage.
    expect(PYQ_CODE).not.toMatch(/correctCount/);
    expect(PYQ_CODE).not.toMatch(/isCorrect/);
    expect(PYQ_CODE).not.toMatch(/Math\.round\(/);
  });

  it('is a launcher, not a runtime (LOC budget)', () => {
    const codeLines = PYQ_CODE.split(/\r?\n/).filter(l => l.trim() !== '').length;
    expect(codeLines).toBeLessThan(140);
  });
});

describe('the year-tag selector survived the move into quiz assembly', () => {
  const QUIZ_SRC = readFileSync(
    resolve(REPO_ROOT, 'apps/host/src/app/(student)/quiz/page.tsx'),
    'utf8',
  );
  const ASSEMBLER_SRC = readFileSync(
    resolve(REPO_ROOT, 'packages/lib/src/quiz-assembler.ts'),
    'utf8',
  );

  it('the quiz page reads ?year= and passes it to assembleQuiz', () => {
    expect(QUIZ_SRC).toMatch(/params\.get\('year'\)/);
    expect(QUIZ_SRC).toMatch(/isPyqYear\(/);
    // Passed through as a shorthand property on the assembleQuiz call object.
    expect(QUIZ_SRC).toMatch(/pyqYear,/);
  });

  it('the assembler prefers question_bank rows tagged with that year', () => {
    expect(ASSEMBLER_SRC).toMatch(/contains\('tags',\s*\[String\(pyqYear\)\]\)/);
    // The retired page's "no year tag → generic rows" fallback is now the
    // normal ladder, so a thin year still yields a full quiz.
    expect(ASSEMBLER_SRC).toMatch(/RUNG 0P/);
  });

  it('the year filter never relaxes the grade or subject scope', () => {
    const rung = ASSEMBLER_SRC.slice(
      ASSEMBLER_SRC.indexOf('RUNG 0P'),
      ASSEMBLER_SRC.indexOf('=== RUNG 0:'),
    );
    expect(rung).toMatch(/\.eq\('subject', subject\)/);
    expect(rung).toMatch(/\.eq\('grade', grade\)/);
    expect(rung).toMatch(/\.eq\('is_active', true\)/);
  });
});
