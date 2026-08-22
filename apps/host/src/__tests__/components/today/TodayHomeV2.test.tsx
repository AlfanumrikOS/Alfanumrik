/**
 * TodayHomeV2 — the /today loaded-state CONTENT CONTRACT (Phase 4).
 *
 * `/today` is the default student route: the first screen after login, and the
 * one that has to answer "what do I do next, and why?" in five seconds. This
 * suite pins the contract that makes that possible, and every rule it pins is
 * one that a well-meaning future edit would otherwise quietly break:
 *
 *   - the content tree is EXACTLY six blocks, in one fixed order, with nothing
 *     (achievements, leaderboard, XP hero, promo) above the learning;
 *   - the plan never exceeds THREE activities however long the queue is;
 *   - there is exactly ONE primary CTA on the screen;
 *   - the primary card always states WHY, in approved learner language;
 *   - the server's priority order is rendered, never re-sorted client-side;
 *   - numbers without a reliable source are OMITTED, not invented;
 *   - the analytics the surface previously had none of actually fire.
 *
 * PRESENTATION ONLY — the component takes an already-fetched `TodayResponse`,
 * so only `next/navigation` and the analytics dispatcher need mocking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { TodayResponse, TodayQueueItem as TodayQueueItemDTO } from '@alfanumrik/lib/today/types';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import type { ExamScheduleEntry } from '@alfanumrik/lib/exams/types';
import TodayHomeV2, { MAX_PLAN_ITEMS } from '@alfanumrik/ui/today/v2/TodayHomeV2';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

const track = vi.fn();
vi.mock('@alfanumrik/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const SUBJECTS: Subject[] = [
  { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
  { code: 'math', name: 'Mathematics', nameHi: 'गणित', icon: '🔢', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
];

function item(overrides: Partial<TodayQueueItemDTO> = {}): TodayQueueItemDTO {
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
    chapterTitle: 'Nutrition in Plants',
    chapterTitleHi: 'पादपों में पोषण',
    ...overrides,
  };
}

function response(
  primary: TodayQueueItemDTO,
  rest: TodayQueueItemDTO[] = [],
  meta: Partial<TodayResponse['meta']> = {},
): TodayResponse {
  return {
    schemaVersion: 1,
    resolvedAt: '2026-08-11T09:00:00.000Z',
    primary,
    queue: [primary, ...rest],
    meta: {
      branch: 'start_quiz',
      masterySubjectCount: 2,
      dueReviewCount: 0,
      practicedToday: true,
      ...meta,
    },
  };
}

const EXAM: ExamScheduleEntry = {
  id: 'exam-1', source: 'student', title: 'Half-yearly',
  startsOn: '2026-08-13', endsOn: '2026-08-13', dayLabel: 'Thu', editable: true,
};

function renderHome(props: Partial<React.ComponentProps<typeof TodayHomeV2>> = {}) {
  return render(
    <TodayHomeV2
      data={response(item())}
      subjects={SUBJECTS}
      isHi={false}
      streak={0}
      totalXp={0}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

/* ── 1. The content tree ─────────────────────────────────────────────────── */

describe('content tree — exactly six blocks, in order', () => {
  it('renders greeting → primary → plan → reminder → progress → foxy, in that DOM order', () => {
    renderHome({
      data: response(item(), [item({ rank: 2, type: 'srs_due', reason: 'reviews_due_today', meta: { dueCount: 4 }, deepLink: { route: '/review' } })], { practicedToday: false }),
      streak: 4,
      totalXp: 1200,
    });

    const ids = ['today-greeting', 'today-primary', 'today-plan', 'today-reminder', 'today-progress', 'today-foxy'];
    const nodes = ids.map((id) => screen.getByTestId(id));
    for (let i = 0; i < nodes.length - 1; i++) {
      const rel = nodes[i].compareDocumentPosition(nodes[i + 1]);
      expect(
        Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING),
        `${ids[i]} must come before ${ids[i + 1]}`,
      ).toBe(true);
    }
  });

  it('renders nothing above the primary card except the greeting', () => {
    renderHome();
    const root = screen.getByTestId('today-v2');
    const primary = screen.getByTestId('today-primary');
    // Every direct child before the primary card must be the greeting.
    const before: string[] = [];
    for (const child of Array.from(root.children)) {
      if (child === primary) break;
      before.push(child.getAttribute('data-testid') ?? child.tagName);
    }
    expect(before).toEqual(['today-greeting']);
  });

  it('carries no achievement, leaderboard, level or streak-flame hero above the learning', () => {
    const { container } = renderHome({ streak: 9, totalXp: 5000 });
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/leaderboard|achievement|badge|rank #|level \d/i);
    // The streak survives only inside the compact progress statement (block 5).
    const progress = screen.getByTestId('today-progress');
    expect(progress.textContent).toContain('9');
  });
});

/* ── 2. The primary recommendation card ──────────────────────────────────── */

describe('primary card', () => {
  it('is the only primary CTA on the screen', () => {
    renderHome({ data: response(item(), [item({ rank: 2 }), item({ rank: 3 })]) });
    expect(screen.getAllByTestId('today-primary-cta')).toHaveLength(1);
  });

  it('shows subject, concept and activity type', () => {
    renderHome();
    const facets = screen.getByTestId('today-primary-facets').textContent ?? '';
    expect(facets).toContain('Science');            // subject
    expect(facets).toContain('Nutrition in Plants'); // concept
    expect(facets).toContain('Practice');            // activity type
  });

  it('omits the subject and concept rather than inventing them when absent', () => {
    renderHome({
      data: response(item({ meta: undefined, chapterTitle: undefined, chapterTitleHi: undefined })),
    });
    const facets = screen.getByTestId('today-primary-facets').textContent ?? '';
    expect(facets).not.toMatch(/your subject|अपने विषय/);
    expect(facets).toBe('Practice'); // activity type only
  });

  it('renders the recommendation reason in approved learner language', () => {
    renderHome();
    expect(screen.getByTestId('today-primary-reason')).toHaveTextContent('Build this prerequisite');
  });

  it('renders no reason chip at all for a reason the copy table does not know', () => {
    renderHome({ data: response(item({ reason: 'some_future_branch' })) });
    expect(screen.queryByTestId('today-primary-reason')).not.toBeInTheDocument();
  });

  it('shows resume status: in progress / partway / not started', () => {
    const { rerender } = renderHome({ data: response(item({ type: 'resume_in_progress' })) });
    expect(screen.getByTestId('today-primary-status')).toHaveTextContent('In progress');

    rerender(
      <TodayHomeV2
        data={response(item({ type: 'continue_lesson', meta: { subjectCode: 'science', progressPct: 0.4 } }))}
        subjects={SUBJECTS} isHi={false} streak={0} totalXp={0}
      />,
    );
    expect(screen.getByTestId('today-primary-status')).toHaveTextContent('40% done');

    rerender(
      <TodayHomeV2 data={response(item())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />,
    );
    expect(screen.getByTestId('today-primary-status')).toHaveTextContent('Not started');
  });

  it('uses "Continue" for a resumable item and "Start" otherwise', () => {
    const { rerender } = renderHome({ data: response(item({ type: 'resume_in_progress' })) });
    expect(screen.getByTestId('today-primary-cta')).toHaveTextContent('Continue');
    rerender(<TodayHomeV2 data={response(item())} subjects={SUBJECTS} isHi={false} streak={0} totalXp={0} />);
    expect(screen.getByTestId('today-primary-cta')).toHaveTextContent('Start');
  });

  it('navigates to the resolver deep link on the one CTA', () => {
    renderHome();
    fireEvent.click(screen.getByTestId('today-primary-cta'));
    expect(mockPush).toHaveBeenCalledWith('/quiz?subject=science&chapter=3');
  });

  it('tags a teacher-assigned recommendation', () => {
    renderHome({ data: response(item({ type: 'teacher_remediation', reason: 'teacher_assigned' })) });
    expect(screen.getByTestId('today-from-teacher-tag')).toBeInTheDocument();
    expect(screen.getByTestId('today-primary-reason')).toHaveTextContent('Teacher assigned');
  });
});

/* ── Estimated effort: only when the number is real ──────────────────────── */

describe('estimated effort — shown only when reliable', () => {
  it('omits the minutes badge for the static per-type placeholder', () => {
    renderHome(); // weak_topic_zpd carries estMinutes 7 from a constant table
    expect(screen.queryByTestId('today-primary-effort')).not.toBeInTheDocument();
  });

  it('shows the minutes badge for srs_due, whose estimate is derived from the due count', () => {
    renderHome({
      data: response(item({
        type: 'srs_due', reason: 'reviews_stacking', estMinutes: 4,
        meta: { dueCount: 4 }, deepLink: { route: '/review' },
        chapterTitle: undefined, chapterTitleHi: undefined,
      })),
    });
    expect(screen.getByTestId('today-primary-effort')).toHaveTextContent('~4 min');
  });

  it('omits it again when srs_due arrives with no due count', () => {
    renderHome({
      data: response(item({
        type: 'srs_due', reason: 'reviews_stacking', estMinutes: 4,
        meta: undefined, deepLink: { route: '/review' },
      })),
    });
    expect(screen.queryByTestId('today-primary-effort')).not.toBeInTheDocument();
  });
});

/* ── 3. Today's plan — max three ─────────────────────────────────────────── */

describe("today's plan", () => {
  it('caps the plan at three activities however long the queue is', () => {
    const rest = [2, 3, 4, 5, 6].map((rank) => item({ rank }));
    renderHome({ data: response(item(), rest) });
    expect(MAX_PLAN_ITEMS).toBe(3);
    expect(screen.getAllByTestId('today-plan-item')).toHaveLength(3);
  });

  it('renders the plan in the server order and never re-ranks it', () => {
    // labelKey/subtitleKey travel with the type on the wire — override both so
    // the fixture matches what map-action actually emits for these types.
    const rest = [
      item({
        rank: 2, type: 'srs_due', reason: 'reviews_due_today',
        labelKey: 'today.item.srs_due.label', subtitleKey: 'today.item.srs_due.subtitle',
        meta: { dueCount: 3 }, deepLink: { route: '/review' },
      }),
      item({
        rank: 3, type: 'new_topic', reason: 'unstarted_chapter_available',
        labelKey: 'today.item.new_topic.label', subtitleKey: 'today.item.new_topic.subtitle',
        meta: { subjectCode: 'math', chapterNumber: 2 },
        chapterTitle: undefined, chapterTitleHi: undefined,
        deepLink: { route: '/learn/math/2' },
      }),
    ];
    renderHome({ data: response(item(), rest) });
    const labels = screen.getAllByTestId('today-plan-item').map((n) => n.textContent ?? '');
    expect(labels[0]).toContain('Reviews due');
    expect(labels[1]).toContain('Start new topic');
  });

  it('omits the plan block entirely when the queue holds only the primary', () => {
    renderHome();
    expect(screen.queryByTestId('today-plan')).not.toBeInTheDocument();
  });

  it('navigates from a plan row to its own deep link', () => {
    renderHome({ data: response(item(), [item({ rank: 2, deepLink: { route: '/review' } })]) });
    fireEvent.click(screen.getAllByTestId('today-plan-item')[0]);
    expect(mockPush).toHaveBeenCalledWith('/review');
  });
});

/* ── 4. The single most urgent reminder ──────────────────────────────────── */

describe('reminder — exactly one, most urgent first', () => {
  it('prefers an upcoming test over a streak at risk and unread updates', () => {
    renderHome({ data: response(item(), [], { practicedToday: false }), streak: 5, nextExam: EXAM, unreadCount: 7 });
    const reminders = screen.getAllByTestId('today-reminder');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toHaveAttribute('data-reminder-kind', 'exam');
    expect(reminders[0]).toHaveTextContent('Half-yearly');
    expect(reminders[0]).toHaveTextContent('Prepare for your test');
  });

  it('falls through to the streak-at-risk reminder, which carries no competing CTA', () => {
    renderHome({ data: response(item(), [], { practicedToday: false }), streak: 5, unreadCount: 7 });
    const reminder = screen.getByTestId('today-reminder');
    expect(reminder).toHaveAttribute('data-reminder-kind', 'streak');
    expect(screen.queryByTestId('today-reminder-cta')).not.toBeInTheDocument();
  });

  it('falls through to unread updates last', () => {
    renderHome({ data: response(item(), [], { practicedToday: true }), streak: 5, unreadCount: 3 });
    const reminder = screen.getByTestId('today-reminder');
    expect(reminder).toHaveAttribute('data-reminder-kind', 'unread');
    expect(reminder).toHaveTextContent('3 new updates for you');
    fireEvent.click(screen.getByTestId('today-reminder-cta'));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });

  it('renders NO reminder when the unread count never arrived (null), rather than "0 updates"', () => {
    renderHome({ data: response(item(), [], { practicedToday: true }), streak: 5, unreadCount: null });
    expect(screen.queryByTestId('today-reminder')).not.toBeInTheDocument();
  });

  it('renders no reminder when nothing is urgent', () => {
    renderHome({ data: response(item(), [], { practicedToday: true }), streak: 5, unreadCount: 0 });
    expect(screen.queryByTestId('today-reminder')).not.toBeInTheDocument();
  });
});

/* ── 5. The progress statement — reliable numbers only ───────────────────── */

describe('progress statement', () => {
  it('states the streak and labels XP explicitly as a total', () => {
    renderHome({ streak: 4, totalXp: 12345 });
    const p = screen.getByTestId('today-progress');
    expect(p).toHaveTextContent("You've practised 4 days in a row.");
    expect(p).toHaveTextContent(`${(12345).toLocaleString('en-IN')} XP total`);
  });

  it('says so honestly when there is no streak', () => {
    renderHome({ streak: 0, totalXp: 0 });
    expect(screen.getByTestId('today-progress')).toHaveTextContent('No streak yet');
  });

  it('omits the XP clause entirely when XP is zero', () => {
    renderHome({ streak: 2, totalXp: 0 });
    expect(screen.getByTestId('today-progress').textContent).not.toMatch(/XP/);
  });

  it('claims no weekly aggregate it does not have', () => {
    renderHome({ streak: 4, totalXp: 900 });
    const text = screen.getByTestId('today-progress').textContent ?? '';
    expect(text).not.toMatch(/this week|quizzes this week|% this week/i);
  });
});

/* ── 6. Foxy entry ───────────────────────────────────────────────────────── */

describe('contextual Foxy entry', () => {
  it('carries the primary recommendation subject into the link', () => {
    renderHome();
    const foxy = screen.getByTestId('today-foxy');
    expect(foxy).toHaveAttribute('href', '/foxy?subject=science&source=today');
    expect(foxy).toHaveTextContent('Stuck on Science? Ask Foxy.');
  });

  it('degrades to the generic entry when the primary carries no subject', () => {
    renderHome({ data: response(item({ meta: undefined })) });
    expect(screen.getByTestId('today-foxy')).toHaveAttribute('href', '/foxy?source=today');
    expect(screen.getByTestId('today-foxy')).toHaveTextContent('Stuck on something? Ask Foxy.');
  });
});

/* ── Partial / stale ─────────────────────────────────────────────────────── */

describe('partial / stale', () => {
  it('says the plan on screen may be out of date while revalidating', () => {
    renderHome({ isStale: true });
    expect(screen.getByTestId('today-stale')).toHaveTextContent('Showing your earlier plan');
    // The plan is still fully usable — stale is not an error.
    expect(screen.getByTestId('today-primary-cta')).toBeInTheDocument();
  });

  it('shows no stale notice on fresh data', () => {
    renderHome();
    expect(screen.queryByTestId('today-stale')).not.toBeInTheDocument();
  });
});

/* ── P7 bilingual ────────────────────────────────────────────────────────── */

describe('bilingual (P7)', () => {
  it('renders every block in Hindi with no English fallback leaking through', () => {
    renderHome({
      isHi: true,
      data: response(item(), [item({ rank: 2 })], { practicedToday: false }),
      streak: 3,
      totalXp: 500,
      unreadCount: 2,
    });
    expect(screen.getByRole('heading', { name: 'मुझे अभी क्या सीखना चाहिए?' })).toBeInTheDocument();
    expect(screen.getByTestId('today-primary-reason')).toHaveTextContent('यह बुनियाद मज़बूत करो');
    expect(screen.getByTestId('today-primary-facets')).toHaveTextContent('पादपों में पोषण');
    expect(screen.getByTestId('today-plan')).toHaveTextContent('आज की योजना');
    expect(screen.getByTestId('today-progress')).toHaveTextContent('लगातार 3 दिन');
    expect(screen.getByTestId('today-foxy')).toHaveTextContent('विज्ञान');
  });
});

/* ── No jargon reaches the screen ────────────────────────────────────────── */

describe('no internal vocabulary on screen', () => {
  const JARGON = /\b(IRT|BKT|DKT|CME|SRS|ZPD|theta|decay|probability|confidence|fatigue|cognitive load)\b/i;

  const TYPES: Array<[TodayQueueItemDTO['type'], string]> = [
    ['resume_in_progress', 'live_session'],
    ['cold_start_diagnostic', 'no_signals_yet'],
    ['teacher_remediation', 'teacher_assigned'],
    ['srs_due', 'reviews_stacking'],
    ['revise_decayed_topic', 'decay_above_threshold'],
    ['weak_topic_zpd', 'todays_zpd'],
    ['continue_lesson', 'in_progress_lesson'],
    ['new_topic', 'unstarted_chapter_available'],
    ['weekly_dive_due', 'sunday_default'],
    ['monthly_synthesis_due', 'month_end_default'],
    ['practice_weakest', 'weakest_topic_practice'],
  ];

  it.each(TYPES)('%s (%s) renders no internal term, in either language', (type, reason) => {
    for (const isHi of [false, true]) {
      cleanup();
      const { container } = render(
        <TodayHomeV2
          data={response(
            item({ type, reason, labelKey: `today.item.${type}.label`, subtitleKey: `today.item.${type}.subtitle` }),
          )}
          subjects={SUBJECTS} isHi={isHi} streak={3} totalXp={100}
        />,
      );
      expect(container.textContent ?? '').not.toMatch(JARGON);
    }
  });

  it('never prints the raw machine reason', () => {
    const { container } = renderHome();
    expect(container.textContent ?? '').not.toContain('todays_zpd');
  });
});

/* ── Layout / a11y floor ─────────────────────────────────────────────────── */

describe('layout and accessibility floor', () => {
  it('gives every interactive control a 44px minimum tap target', () => {
    renderHome({
      data: response(item(), [item({ rank: 2 })], { practicedToday: true }),
      streak: 2, unreadCount: 4,
    });
    const controls = [
      screen.getByTestId('today-primary-cta'),
      ...screen.getAllByTestId('today-plan-item'),
      screen.getByTestId('today-reminder-cta'),
      screen.getByTestId('today-foxy'),
    ];
    for (const el of controls) {
      expect(el.className, el.getAttribute('data-testid') ?? '').toContain('min-h-tap-min');
    }
  });

  it('labels the primary and plan sections for assistive tech', () => {
    renderHome({ data: response(item(), [item({ rank: 2 })]) });
    expect(screen.getByTestId('today-primary')).toHaveAttribute('aria-labelledby', 'today-primary-title');
    expect(screen.getByTestId('today-plan')).toHaveAttribute('aria-labelledby', 'today-plan-heading');
  });

  it('renders the plan as a real list', () => {
    renderHome({ data: response(item(), [item({ rank: 2 }), item({ rank: 3 })]) });
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('marks every decorative glyph aria-hidden', () => {
    const { container } = renderHome({
      data: response(item(), [item({ rank: 2 })], { practicedToday: false }),
      streak: 3, nextExam: EXAM,
    });
    // No emoji may be exposed as content to a screen reader.
    const exposed = Array.from(container.querySelectorAll('span'))
      .filter((s) => s.getAttribute('aria-hidden') !== 'true')
      .map((s) => s.textContent ?? '')
      .filter((t) => /[\u{1F300}-\u{1FAFF}]/u.test(t) && t.length <= 4);
    expect(exposed).toEqual([]);
  });
});

/* ── Analytics — the surface previously emitted nothing at all ───────────── */

describe('analytics', () => {
  it('emits today_viewed once per resolved queue, with PII-free properties', () => {
    const data = response(item(), [item({ rank: 2 })], { practicedToday: false, branch: 'start_quiz' });
    const { rerender } = renderHome({ data, streak: 3 });

    const viewed = track.mock.calls.filter((c) => c[0] === 'today_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0][1]).toEqual({
      branch: 'start_quiz',
      primary_type: 'weak_topic_zpd',
      primary_reason: 'todays_zpd',
      plan_count: 1,
      reminder: 'streak',
    });
    // No identifiers, no titles, no deep links.
    expect(JSON.stringify(viewed[0][1])).not.toMatch(/Nutrition|\/quiz|stu-|@/);

    // Re-render with the SAME resolvedAt must not double-count.
    rerender(<TodayHomeV2 data={data} subjects={SUBJECTS} isHi={false} streak={3} totalXp={0} />);
    expect(track.mock.calls.filter((c) => c[0] === 'today_viewed')).toHaveLength(1);
  });

  it('emits the primary CTA click with type and reason', () => {
    renderHome();
    fireEvent.click(screen.getByTestId('today-primary-cta'));
    expect(track).toHaveBeenCalledWith('today_primary_cta_clicked', {
      type: 'weak_topic_zpd',
      reason: 'todays_zpd',
    });
  });

  it('emits a plan item click with its server rank', () => {
    renderHome({ data: response(item(), [item({ rank: 2, type: 'srs_due', reason: 'reviews_due_today', deepLink: { route: '/review' } })]) });
    fireEvent.click(screen.getAllByTestId('today-plan-item')[0]);
    expect(track).toHaveBeenCalledWith('today_plan_item_clicked', {
      type: 'srs_due', reason: 'reviews_due_today', rank: 2,
    });
  });

  it('emits the stale state once', () => {
    renderHome({ isStale: true });
    expect(track.mock.calls.filter((c) => c[0] === 'today_state_shown' && (c[1] as { state: string }).state === 'stale')).toHaveLength(1);
  });

  it('emits the Foxy entry click with subject presence only (no subject code)', () => {
    renderHome();
    fireEvent.click(screen.getByTestId('today-foxy'));
    expect(track).toHaveBeenCalledWith('today_foxy_clicked', { has_subject: true });
  });
});
