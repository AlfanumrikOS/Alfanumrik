/**
 * TodayHomeV2 — Wave B presentation for the /today home
 * (packages/ui/src/today/v2/TodayHomeV2.tsx).
 *
 * PRESENTATION ONLY: this component takes an already-fetched TodayResponse +
 * exam-schedule entry as props, so it's tested with plain RTL render (no SWR
 * / fetch mocking needed) — only `next/navigation`'s router needs mocking,
 * since ResumeHero/FocusHero/ExamScheduleCard all call useRouter() directly.
 *
 * Pins:
 *   - always renders the `today-v2` root + `today-v2-greeting` header.
 *   - resume vs focus hero selection follows `primary.type === 'resume_in_progress'`.
 *   - the exam-schedule card renders when nextExam is present, renders
 *     nothing (ExamScheduleCard returns null) when absent.
 *   - streak chip only when streak > 0; XP chip always shown, Indian-numeral
 *     locale formatted.
 *   - the streak-at-risk banner only when practicedToday===false AND streak>0.
 *   - clicking the resume/focus continue buttons navigates to the resolved
 *     deep link; "Later" dismisses the resume hero (no navigation), promoting
 *     the next queue item into the focus hero and falling through to the empty
 *     state (free practice) when the queue had nothing else.
 *   - "Up next" section renders the REST of the queue (rank 2+), omitted
 *     when the queue has only the primary item.
 *   - the from-teacher tag renders only for a teacher-assigned primary item.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TodayResponse, TodayQueueItem as TodayQueueItemDTO } from '@alfanumrik/lib/today/types';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import type { ExamScheduleEntry } from '@alfanumrik/lib/exams/types';
import TodayHomeV2 from '@alfanumrik/ui/today/v2/TodayHomeV2';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

const SUBJECTS: Subject[] = [
  { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
];

function focusItem(overrides: Partial<TodayQueueItemDTO> = {}): TodayQueueItemDTO {
  return {
    type: 'weak_topic_zpd',
    rank: 1,
    labelKey: 'today.item.weak_topic_zpd.label',
    subtitleKey: 'today.item.weak_topic_zpd.subtitle',
    estMinutes: 7,
    deepLink: { route: '/quiz', params: { subject: 'science', chapter: 3 } },
    iconHint: 'target',
    reason: 'todays_zpd',
    meta: { subjectCode: 'science', chapterNumber: 3, zpdBin: 'medium' },
    ...overrides,
  };
}

function resumeItem(overrides: Partial<TodayQueueItemDTO> = {}): TodayQueueItemDTO {
  return {
    type: 'resume_in_progress',
    rank: 1,
    labelKey: 'today.item.resume_in_progress.label',
    subtitleKey: 'today.item.resume_in_progress.subtitle',
    estMinutes: 5,
    deepLink: { route: '/learn/science/7' },
    iconHint: 'flame',
    reason: 'resume',
    meta: { liveKind: 'in_lesson', subjectCode: 'science', chapterNumber: 7 },
    ...overrides,
  };
}

function response(primary: TodayQueueItemDTO, rest: TodayQueueItemDTO[] = [], practicedToday = true): TodayResponse {
  return {
    schemaVersion: 1,
    resolvedAt: '2026-08-02T09:00:00.000Z',
    primary,
    queue: [primary, ...rest],
    meta: { branch: 'start_quiz', masterySubjectCount: 1, dueReviewCount: 0, practicedToday },
  };
}

const EXAM: ExamScheduleEntry = {
  id: 'exam-1',
  source: 'student',
  title: 'Half-yearly',
  startsOn: '2026-08-05',
  endsOn: '2026-08-05',
  dayLabel: 'Wed',
  editable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TodayHomeV2 — structure', () => {
  it('renders the root and greeting testids', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.getByTestId('today-v2')).toBeInTheDocument();
    expect(screen.getByTestId('today-v2-greeting')).toBeInTheDocument();
  });

  it('renders the real todayCopy heading text (What should I learn now?)', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.getByRole('heading', { name: 'What should I learn now?' })).toBeInTheDocument();
  });

  it('renders the Hindi heading when isHi is true', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={true} streak={0} totalXp={0} />);
    expect(screen.getByRole('heading', { name: 'मुझे अभी क्या सीखना चाहिए?' })).toBeInTheDocument();
  });
});

describe('TodayHomeV2 — streak + XP chips', () => {
  it('shows the streak chip only when streak > 0', () => {
    const { rerender } = render(
      <TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />,
    );
    expect(screen.queryByText('🔥')).not.toBeInTheDocument();
    rerender(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={5} totalXp={0} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('formats totalXp with the en-IN locale', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={12345} />);
    expect(screen.getByText(`${(12345).toLocaleString('en-IN')} XP`)).toBeInTheDocument();
  });
});

describe('TodayHomeV2 — streak-at-risk banner', () => {
  it('shows the banner when practicedToday is false and streak > 0', () => {
    render(
      <TodayHomeV2 data={response(focusItem(), [], false)} subjects={SUBJECTS} isHi={false} streak={3} totalXp={0} />,
    );
    expect(screen.getByTestId('today-streak-risk-banner')).toBeInTheDocument();
  });

  it('hides the banner when practicedToday is true', () => {
    render(
      <TodayHomeV2 data={response(focusItem(), [], true)} subjects={SUBJECTS} isHi={false} streak={3} totalXp={0} />,
    );
    expect(screen.queryByTestId('today-streak-risk-banner')).not.toBeInTheDocument();
  });

  it('hides the banner when streak is 0, even if practicedToday is false', () => {
    render(
      <TodayHomeV2 data={response(focusItem(), [], false)} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />,
    );
    expect(screen.queryByTestId('today-streak-risk-banner')).not.toBeInTheDocument();
  });
});

describe('TodayHomeV2 — exam-schedule card', () => {
  it('renders the exam-schedule-card when nextExam is present', () => {
    render(
      <TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} nextExam={EXAM} />,
    );
    expect(screen.getByTestId('exam-schedule-card')).toBeInTheDocument();
    expect(screen.getByText('Half-yearly')).toBeInTheDocument();
  });

  it('renders nothing for the exam card when nextExam is null', () => {
    render(
      <TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} nextExam={null} />,
    );
    expect(screen.queryByTestId('exam-schedule-card')).not.toBeInTheDocument();
  });

  it('renders nothing for the exam card when nextExam is omitted entirely', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.queryByTestId('exam-schedule-card')).not.toBeInTheDocument();
  });
});

describe('TodayHomeV2 — resume vs focus hero selection', () => {
  it('renders the resume hero when primary.type is resume_in_progress', () => {
    render(<TodayHomeV2 data={response(resumeItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.getByTestId('today-v2-resume-hero')).toBeInTheDocument();
    expect(screen.queryByTestId('today-v2-focus-hero')).not.toBeInTheDocument();
  });

  it('renders the focus hero for any non-resume primary item', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.getByTestId('today-v2-focus-hero')).toBeInTheDocument();
    expect(screen.queryByTestId('today-v2-resume-hero')).not.toBeInTheDocument();
  });

  it('clicking the resume "Pick up here" button navigates to the deep link', () => {
    render(<TodayHomeV2 data={response(resumeItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    screen.getByTestId('today-v2-resume-continue').click();
    expect(mockPush).toHaveBeenCalledWith('/learn/science/7');
  });

  it('clicking the resume "Later" button dismisses the resume hero without navigating', () => {
    const next = focusItem({ rank: 2 });
    render(<TodayHomeV2 data={response(resumeItem(), [next])} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    fireEvent.click(screen.getByTestId('today-v2-resume-later'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByTestId('today-v2-resume-hero')).not.toBeInTheDocument();
  });

  it('"Later" promotes the next queue item into the focus hero and moves focus to its CTA', () => {
    const next = focusItem({ rank: 2 });
    render(<TodayHomeV2 data={response(resumeItem(), [next])} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    fireEvent.click(screen.getByTestId('today-v2-resume-later'));
    expect(screen.getByTestId('today-v2-focus-hero')).toBeInTheDocument();
    expect(screen.getByTestId('today-v2-focus-continue')).toHaveFocus();
  });

  it('"Later" on a single-item queue falls through to the empty state with free practice', () => {
    render(<TodayHomeV2 data={response(resumeItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    fireEvent.click(screen.getByTestId('today-v2-resume-later'));
    expect(screen.queryByTestId('today-v2-resume-hero')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-v2-focus-hero')).not.toBeInTheDocument();
    expect(screen.getByTestId('today-empty-practice')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('today-empty-practice'));
    expect(mockPush).toHaveBeenCalledWith('/quiz');
  });

  it('clicking the focus "Start" button navigates to the resolved deep link with params', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    screen.getByTestId('today-v2-focus-continue').click();
    expect(mockPush).toHaveBeenCalledWith('/quiz?subject=science&chapter=3');
  });

  it('shows the from-teacher tag on the focus hero for a teacher-assigned item', () => {
    render(
      <TodayHomeV2
        data={response(focusItem({ type: 'teacher_remediation' as TodayQueueItemDTO['type'] }))}
        subjects={SUBJECTS}
        isHi={false}
        streak={0}
        totalXp={0}
      />,
    );
    expect(screen.getByTestId('today-from-teacher-tag')).toBeInTheDocument();
  });

  it('does not show the from-teacher tag for a non-teacher item', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.queryByTestId('today-from-teacher-tag')).not.toBeInTheDocument();
  });
});

describe('TodayHomeV2 — up next queue', () => {
  it('renders the remaining queue items under "Up next"', () => {
    const rest = [
      focusItem({
        rank: 2,
        type: 'srs_due',
        labelKey: 'today.item.srs_due.label',
        subtitleKey: 'today.item.srs_due.subtitle',
        deepLink: { route: '/review' },
        meta: { dueCount: 4 },
      }),
    ];
    render(<TodayHomeV2 data={response(focusItem(), rest)} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.getByText('Up next')).toBeInTheDocument();
  });

  it('omits "Up next" entirely when the queue has only the primary item', () => {
    render(<TodayHomeV2 data={response(focusItem())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.queryByText('Up next')).not.toBeInTheDocument();
  });
});
