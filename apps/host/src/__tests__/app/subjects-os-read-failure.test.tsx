/**
 * Shared-helper consumers — a failed read reaches the component's ERROR state,
 * never its reassuring zero-state (render units).
 *
 * THE DEFECT THIS PINS
 *   WeakSpotPathway, MomentumRail and MasteryBloomPanel each already HAD a
 *   distinct bilingual error branch — reachable only from a `catch`. But the
 *   helpers they call (getKnowledgeGaps / getLearningVelocity /
 *   getStudentProfiles / getBloomProgression) resolved to `[]` on failure and
 *   never rejected, so those catches were unreachable dead code and every
 *   failure fell through to the zero-state instead:
 *
 *     - WeakSpotPathway   → KnowledgeGapActions' "no weak spots" all-clear
 *     - MomentumRail      → "Take a few quizzes and your momentum shows here"
 *     - MasteryBloomPanel → "No data for this subject yet — take a quiz"
 *
 *   Each of those is a claim about the STUDENT. The helpers now return a
 *   `ServiceResult` and each component checks it, which brings the existing
 *   error branch to life.
 *
 *   QuizSetup is the fourth consumer: its chapter picker collapsed a 401/5xx
 *   into "No chapters available for this subject yet".
 *
 *   Both directions are asserted for every component: the zero-state must still
 *   render on a successful-but-empty read.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const { reads } = vi.hoisted(() => ({
  reads: {
    knowledgeGaps: vi.fn(),
    learningVelocity: vi.fn(),
    studentProfiles: vi.fn(),
    bloomProgression: vi.fn(),
    chapters: vi.fn(),
  },
}));

// KnowledgeGapActions (rendered by WeakSpotPathway) navigates on its deep
// links, so the app-router seam has to exist even though nothing navigates here.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/learn',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  getKnowledgeGaps: reads.knowledgeGaps,
  getLearningVelocity: reads.learningVelocity,
  getStudentProfiles: reads.studentProfiles,
  getBloomProgression: reads.bloomProgression,
  getChaptersForSubject: reads.chapters,
}));

// QuizSetup's subject list comes from its own hook, not from a helper under test.
const MATH = { code: 'math', name: 'Mathematics', name_hi: 'गणित', icon: '∑', color: '#7C3AED', isLocked: false };
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ subjects: [MATH], unlocked: [MATH], locked: [], isLoading: false }),
}));

import WeakSpotPathway from '@alfanumrik/ui/learn/os/WeakSpotPathway';
import MomentumRail from '@alfanumrik/ui/learn/os/MomentumRail';
import MasteryBloomPanel from '@alfanumrik/ui/learn/os/MasteryBloomPanel';
import QuizSetup from '@alfanumrik/ui/quiz/QuizSetup';

const OK_EMPTY = { ok: true as const, data: [] };
const FAILED = { ok: false as const, error: 'rpc exploded', code: 'DB_ERROR' as const };

/** A profile row for the subject under test, so MasteryBloomPanel's
 *  "no profile" zero-state is not what we are accidentally observing. */
const MATH_PROFILE = {
  id: 'prof-1', student_id: 'stu-1', subject: 'math',
  xp: 120, level: 2, streak_days: 1, total_sessions: 4,
  total_questions_asked: 20, total_questions_answered_correctly: 15,
};

beforeEach(() => {
  Object.values(reads).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WeakSpotPathway — a failed gaps read is never an all-clear', () => {
  it('renders the error state when getKnowledgeGaps fails', async () => {
    reads.knowledgeGaps.mockResolvedValue(FAILED);
    render(React.createElement(WeakSpotPathway, { studentId: 'stu-1', subjectCode: 'math', isHi: false }));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load weak spots right now.")).toBeDefined(),
    );
  });

  it('renders the zero-state (not the error) when the read succeeds with no gaps', async () => {
    reads.knowledgeGaps.mockResolvedValue(OK_EMPTY);
    render(React.createElement(WeakSpotPathway, { studentId: 'stu-1', subjectCode: 'math', isHi: false }));

    await waitFor(() =>
      expect(screen.queryByText("Couldn't load weak spots right now.")).toBeNull(),
    );
    // The section settled into its ready branch — the guidance line only ever
    // renders alongside gaps, so its absence here is the genuine zero-state.
    expect(screen.queryByText(/fix the prerequisite first/)).toBeNull();
  });

  it('renders the Hindi failure copy when isHi is true (P7)', async () => {
    reads.knowledgeGaps.mockResolvedValue(FAILED);
    render(React.createElement(WeakSpotPathway, { studentId: 'stu-1', subjectCode: 'math', isHi: true }));

    await waitFor(() =>
      expect(screen.getByText('कमज़ोर जगहें अभी लोड नहीं हो पाईं।')).toBeDefined(),
    );
    expect(screen.queryByText("Couldn't load weak spots right now.")).toBeNull();
  });
});

describe('MomentumRail — a failed read is never "take a few quizzes"', () => {
  const props = {
    studentId: 'stu-1', subjectCode: 'math',
    subjectName: 'Mathematics', subjectNameHi: 'गणित', isHi: false,
  };

  it('renders the error state when the velocity read fails', async () => {
    reads.learningVelocity.mockResolvedValue(FAILED);
    reads.studentProfiles.mockResolvedValue({ ok: true, data: [MATH_PROFILE] });
    render(React.createElement(MomentumRail, props));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load momentum data right now.")).toBeDefined(),
    );
    expect(screen.queryByText('Take a few quizzes and your momentum shows here.')).toBeNull();
  });

  it('renders the error state when the PROFILES read fails (either source)', async () => {
    reads.learningVelocity.mockResolvedValue(OK_EMPTY);
    reads.studentProfiles.mockResolvedValue(FAILED);
    render(React.createElement(MomentumRail, props));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load momentum data right now.")).toBeDefined(),
    );
    expect(screen.queryByText('Take a few quizzes and your momentum shows here.')).toBeNull();
  });

  it('renders the zero-state (not the error) when both reads succeed with nothing', async () => {
    reads.learningVelocity.mockResolvedValue(OK_EMPTY);
    reads.studentProfiles.mockResolvedValue(OK_EMPTY);
    render(React.createElement(MomentumRail, props));

    await waitFor(() =>
      expect(screen.getByText('Take a few quizzes and your momentum shows here.')).toBeDefined(),
    );
    expect(screen.queryByText("Couldn't load momentum data right now.")).toBeNull();
  });
});

describe('MasteryBloomPanel — a failed read is never "no data for this subject"', () => {
  const props = {
    studentId: 'stu-1', subjectCode: 'math',
    subjectMeta: undefined, isHi: false,
  };

  it.each([
    ['profiles', 'studentProfiles'],
    ['bloom', 'bloomProgression'],
    ['velocity', 'learningVelocity'],
  ] as const)('renders the error state when the %s read fails', async (_label, key) => {
    reads.studentProfiles.mockResolvedValue({ ok: true, data: [MATH_PROFILE] });
    reads.bloomProgression.mockResolvedValue(OK_EMPTY);
    reads.learningVelocity.mockResolvedValue(OK_EMPTY);
    reads[key].mockResolvedValue(FAILED);

    render(React.createElement(MasteryBloomPanel, props));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load mastery data right now.")).toBeDefined(),
    );
    expect(screen.queryByText('No data for this subject yet — take a quiz to begin.')).toBeNull();
  });

  it('renders the zero-state (not the error) when every read succeeds with nothing', async () => {
    reads.studentProfiles.mockResolvedValue(OK_EMPTY);
    reads.bloomProgression.mockResolvedValue(OK_EMPTY);
    reads.learningVelocity.mockResolvedValue(OK_EMPTY);

    render(React.createElement(MasteryBloomPanel, props));

    await waitFor(() =>
      expect(screen.getByText('No data for this subject yet — take a quiz to begin.')).toBeDefined(),
    );
    expect(screen.queryByText("Couldn't load mastery data right now.")).toBeNull();
  });
});

describe('QuizSetup — a failed chapter read is never an empty syllabus', () => {
  const props = {
    isHi: false,
    initialSubject: 'math',
    initialMode: 'practice' as const,
    initialChapter: null,
    loading: false,
    studentGrade: '8',
    onStart: vi.fn(),
    onGoBack: vi.fn(),
  };

  it('renders the failure notice and NOT "No chapters available" when the read fails', async () => {
    reads.chapters.mockResolvedValue({ ok: false, error: 'HTTP 401', code: 'UNAUTHORIZED' });
    render(React.createElement(QuizSetup, props));

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't load chapters right now — you can still quiz across all chapters."),
      ).toBeDefined(),
    );
    expect(screen.queryByText('No chapters available for this subject yet')).toBeNull();
  });

  it('renders "No chapters available" when the read succeeds with zero chapters', async () => {
    reads.chapters.mockResolvedValue(OK_EMPTY);
    render(React.createElement(QuizSetup, props));

    await waitFor(() =>
      expect(screen.getByText('No chapters available for this subject yet')).toBeDefined(),
    );
    expect(
      screen.queryByText("Couldn't load chapters right now — you can still quiz across all chapters."),
    ).toBeNull();
  });

  it('renders the chapter buttons when the read succeeds with chapters (control)', async () => {
    reads.chapters.mockResolvedValue({
      ok: true,
      data: [{ chapter_number: 1, title: 'Number Systems', title_hi: null, verified_question_count: 4 }],
    });
    render(React.createElement(QuizSetup, props));

    await waitFor(() => expect(screen.getByText('Number Systems')).toBeDefined());
    expect(screen.queryByText('No chapters available for this subject yet')).toBeNull();
  });

  it('renders the Hindi failure copy when isHi is true (P7)', async () => {
    reads.chapters.mockResolvedValue({ ok: false, error: 'HTTP 503', code: 'EXTERNAL_FAILURE' });
    render(React.createElement(QuizSetup, { ...props, isHi: true }));

    await waitFor(() =>
      expect(
        screen.getByText('अध्याय अभी लोड नहीं हो पाए — तुम अभी भी सभी अध्यायों का क्विज़ ले सकते हो।'),
      ).toBeDefined(),
    );
    expect(screen.queryByText('इस विषय के लिए अध्याय उपलब्ध नहीं')).toBeNull();
  });
});

/* Guard against a silent regression of the deliberate exception: SubjectsOSHub
 * reads chapters ONLY for display labels and degrades to "Chapter N" on
 * failure. That choice is explicit in code; this pins that it stays a
 * no-escalation path rather than drifting into a swallowed `.catch()` again. */
describe('the deliberate empty-on-failure exception is explicit, not accidental', () => {
  it('SubjectsOSHub checks res.ok before using the chapter labels', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../../../../../packages/ui/src/learn/os/SubjectsOSHub.tsx'),
      'utf8',
    );
    expect(src).toMatch(/if \(!res\.ok\) return;/);
    expect(src).toMatch(/DELIBERATE empty-on-failure/);
  });

  it('the /profile subject-breakdown read logs its failure instead of swallowing it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../../app/(student)/profile/page.tsx'),
      'utf8',
    );
    expect(src).toMatch(/logger\.warn\('profile: subject profiles failed to load'/);
    expect(src).toMatch(/logger\.warn\('profile: subject metadata failed to load'/);
    // P13: message only — no student id, no row payload in the log call.
    expect(src).not.toMatch(/logger\.warn\('profile: subject[^)]*student\.id/);
  });
});
