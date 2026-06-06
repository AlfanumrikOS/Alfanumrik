/**
 * Wave C — Parent "glance" home (ff_parent_glance_v1) flag-OFF safety +
 * read-only contract.
 *
 * Two load-bearing properties hold this wave together (same family as the
 * REG-78 / REG-79 cosmic flag-OFF safety tests and REG-83's Wave-A flag-OFF
 * parity):
 *
 *   1. FLAG-OFF PARITY. With ff_parent_glance_v1 OFF (the production default,
 *      `DEFAULT_FLAGS[PARENT_GLANCE_V1] === false`), the parent page renders the
 *      EXISTING 8-tab dashboard and NEVER mounts <ParentGlanceHome>. A
 *      regression that defaulted the flag ON, or inverted the branch, would
 *      silently reshape the parent home for every guardian. The "classic
 *      reveal" escape hatch (showClassic) must also fall back to the classic
 *      tree even with the flag ON, so nothing is ever lost.
 *
 *   2. READ-ONLY CONTRACT. <ParentGlanceHome> is a presentation reorg of
 *      already-fetched props. It must render Snapshot + Moments + Actions, the
 *      Actions must be NAVIGATION links to EXISTING routes (/parent/reports,
 *      /parent/billing, /parent/messages | /parent/support) — never a POST /
 *      write / new endpoint — and its loading / empty / error states must be
 *      handled from props alone (no fetch of its own).
 *
 * We mock only the flag-read path (useFeatureFlags) and the lazily-imported
 * WeeklyReport (which owns its own Bearer-authed fetch) — behaviour over
 * implementation. The page-branch test uses a faithful replica of the page's
 * dispatch ternary so the assertion is purely about which branch the live flag
 * selects, mirroring cosmic-dispatch-flag-off.test.tsx (REG-79).
 *
 * NOTE: this is the enforcing test for REG-84. Removing or weakening the
 * flag-OFF assertions requires user approval.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { CONSUMER_MINIMALISM_FLAGS, FLAG_DEFAULTS } from '@/lib/feature-flags';

// ─── WeeklyReport owns its own /api/parent/report fetch + states. Stub it so
//     the guardian-mode branch doesn't try to hit the network. ───
vi.mock('@/components/parent/WeeklyReport', () => ({
  default: ({ studentId, guardianId }: { studentId: string; guardianId: string }) => (
    <div data-testid="weekly-report-stub" data-student={studentId} data-guardian={guardianId} />
  ),
}));

import ParentGlanceHome, {
  type ParentGlanceHomeProps,
} from '@/components/parent/ParentGlanceHome';

// The page's bilingual helper, copied verbatim (src/app/parent/page.tsx:47).
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ─── Representative already-fetched props (a child WITH activity) ───
function makeProps(overrides: Partial<ParentGlanceHomeProps> = {}): ParentGlanceHomeProps {
  return {
    stats: {
      xp: 120,
      streak: 4,
      accuracy: 78,
      totalQuizzes: 9,
      minutes: 45,
      totalChats: 6,
      avgScore: 81,
    },
    childName: 'Asha',
    grade: '8',
    subject: 'Science',
    dailyActivity: [
      { quizzes: 2, active: true, label: 'M' },
      { quizzes: 0, active: false, label: 'T' },
      { quizzes: 3, active: true, label: 'W' },
      { quizzes: 1, active: true, label: 'T' },
      { quizzes: 0, active: false, label: 'F' },
      { quizzes: 2, active: true, label: 'S' },
      { quizzes: 1, active: true, label: 'S' },
    ],
    weekSummary: { quizzes: 9, avgScore: 81, activeDays: 5 },
    bktMastery: { levels: { mastered: 3, proficient: 2 }, total: 12 },
    insights: ['Asha is strongest in Biology this week.'],
    perfScores: [
      { subject: 'Biology', overall_score: 88, level_name: 'Strong' },
      { subject: 'Physics', overall_score: 54, level_name: 'Developing' },
    ],
    labStreak: 2,
    student: { id: 'stu-1', name: 'Asha', grade: '8' },
    guardianId: 'guard-1',
    canFetchReport: false,
    loading: false,
    error: null,
    onShowClassic: vi.fn(),
    onRefresh: vi.fn(),
    onLogout: vi.fn(),
    isHi: false,
    t,
    ...overrides,
  };
}

afterEach(() => cleanup());

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — <ParentGlanceHome> read-only render contract.
// ═══════════════════════════════════════════════════════════════════════════
describe('ParentGlanceHome — Snapshot + Moments + Actions (read-only)', () => {
  it('renders all three sections for a child with activity', () => {
    render(<ParentGlanceHome {...makeProps()} />);

    // SNAPSHOT — plain-language headline + compact stat pills derived from props.
    expect(
      screen.getByRole('region', { name: 'Weekly snapshot' }),
    ).toBeInTheDocument();
    // Accuracy >= 70 → "doing well" headline.
    expect(screen.getByText('Asha is doing well this week.')).toBeInTheDocument();
    // Stat pills read straight off the passed stats — no recompute.
    expect(screen.getByText('120')).toBeInTheDocument(); // xp
    expect(screen.getByText('78%')).toBeInTheDocument(); // accuracy
    expect(screen.getByText('45m')).toBeInTheDocument(); // study time

    // MOMENTS — feed derived from already-fetched payload.
    expect(
      screen.getByRole('region', { name: 'Recent moments' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Moments')).toBeInTheDocument();

    // ACTIONS — quick-actions section present.
    expect(
      screen.getByRole('region', { name: 'Quick actions' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('renders Actions as navigation links to EXISTING routes — no POST / write', () => {
    const { container } = render(<ParentGlanceHome {...makeProps({ canFetchReport: false })} />);

    const actions = screen.getByRole('region', { name: 'Quick actions' });

    // "View full report" → /parent/reports
    const reportLink = within(actions).getByRole('link', { name: /view full report/i });
    expect(reportLink).toHaveAttribute('href', '/parent/reports');

    // "Manage plan" → /parent/billing
    const billingLink = within(actions).getByRole('link', { name: /manage plan/i });
    expect(billingLink).toHaveAttribute('href', '/parent/billing');

    // Link-code parent (canFetchReport=false) → /parent/support
    const supportLink = within(actions).getByRole('link', { name: /get support/i });
    expect(supportLink).toHaveAttribute('href', '/parent/support');

    // Every action is either a same-app <Link>/<a> navigation or a button that
    // toggles local UI (onShowClassic) — NONE is a form/submit/write affordance.
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    // All hrefs are internal app routes (no external POST target / mailto / api).
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const href of hrefs) {
      expect(href).toMatch(/^\/parent\//);
    }
  });

  it('routes the message action to /parent/messages for guardian-mode parents', async () => {
    render(<ParentGlanceHome {...makeProps({ canFetchReport: true })} />);
    const actions = screen.getByRole('region', { name: 'Quick actions' });
    const msgLink = within(actions).getByRole('link', { name: /message teacher/i });
    expect(msgLink).toHaveAttribute('href', '/parent/messages');
    // And the richer AI report is mounted only for guardian-mode parents. It is
    // lazy-loaded via next/dynamic, so it resolves on a microtask — await it.
    expect(await screen.findByTestId('weekly-report-stub')).toBeInTheDocument();
  });

  it('does NOT mount the WeeklyReport (Bearer fetch) for link-code parents', async () => {
    render(<ParentGlanceHome {...makeProps({ canFetchReport: false })} />);
    // Give the dynamic import a microtask window to (not) resolve, then assert
    // it never appears — the guard is `canFetchReport`, not load timing.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('weekly-report-stub')).not.toBeInTheDocument();
  });

  it('"Detailed dashboard" and "View classic dashboard" call onShowClassic — no data loss', () => {
    const onShowClassic = vi.fn();
    render(<ParentGlanceHome {...makeProps({ onShowClassic })} />);

    screen.getByRole('button', { name: /detailed dashboard/i }).click();
    screen.getByRole('button', { name: /view classic dashboard/i }).click();
    expect(onShowClassic).toHaveBeenCalledTimes(2);
  });

  it('renders the Hindi headline when isHi is true (P7)', () => {
    render(<ParentGlanceHome {...makeProps({ isHi: true })} />);
    // accuracy 78 ≥ 70 → Hindi "doing well" string.
    expect(screen.getByText('Asha इस सप्ताह अच्छा कर रहा है।')).toBeInTheDocument();
    // Numbers stay Arabic numerals even in Hindi (XP pill).
    expect(screen.getByText('120')).toBeInTheDocument();
  });
});

describe('ParentGlanceHome — loading / empty / error states (from props, no fetch)', () => {
  it('renders the loading skeleton and NONE of the three sections', () => {
    render(<ParentGlanceHome {...makeProps({ loading: true })} />);
    expect(screen.queryByRole('region', { name: 'Weekly snapshot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Quick actions' })).not.toBeInTheDocument();
    // No moments either while loading.
    expect(screen.queryByText('Moments')).not.toBeInTheDocument();
  });

  it('renders the error state with a Try Again button wired to onRefresh', () => {
    const onRefresh = vi.fn();
    render(
      <ParentGlanceHome {...makeProps({ error: 'Failed to load dashboard', onRefresh })} />,
    );
    expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /try again/i });
    retry.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // Error path replaces the sections entirely.
    expect(screen.queryByRole('region', { name: 'Quick actions' })).not.toBeInTheDocument();
  });

  it('renders the contextual empty state when the child has zero activity', () => {
    render(
      <ParentGlanceHome
        {...makeProps({
          stats: { xp: 0, streak: 0, accuracy: 0, totalQuizzes: 0, minutes: 0, totalChats: 0, avgScore: 0 },
          weekSummary: { quizzes: 0, avgScore: 0, activeDays: 0 },
          bktMastery: { levels: {}, total: 0 },
          insights: [],
          perfScores: [],
          labStreak: 0,
        })}
      />,
    );
    expect(
      screen.getByText("Asha hasn't started learning yet"),
    ).toBeInTheDocument();
    // The Moments/Actions sections are not rendered in the empty state, but the
    // classic-reveal footer link still is (nothing is ever lost).
    expect(screen.queryByRole('region', { name: 'Quick actions' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view classic dashboard/i }),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — page-level flag-branch dispatch (faithful replica of the ternary in
// src/app/parent/page.tsx:569 — `glanceEnabled && !showClassic`).
//
// We render the EXACT decision the page makes, wired to a mocked useFeatureFlags
// (the same SWR hook the page reads), and assert which branch is selected.
// Sentinels stand in for the two heavy branches so the assertion is purely about
// the SELECTION, mirroring cosmic-dispatch-flag-off.test.tsx (REG-79).
// ═══════════════════════════════════════════════════════════════════════════

// Mock the flag-read hook the page uses.
const flagState: { value: Record<string, boolean> | undefined } = { value: undefined };
vi.mock('@/lib/swr', () => ({
  useFeatureFlags: () => ({ data: flagState.value }),
}));

import { useFeatureFlags } from '@/lib/swr';

/**
 * Faithful replica of the parent page's flag branch. `showClassic` is the
 * page's local "reveal classic" toggle; the branch must select the glance home
 * ONLY when the flag is ON and classic has not been revealed.
 */
function ParentGlanceDispatcher({ showClassic = false }: { showClassic?: boolean }) {
  const { data: flags } = useFeatureFlags();
  const glanceEnabled = flags?.[CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1] === true;
  return glanceEnabled && !showClassic ? (
    <div data-testid="branch-glance">glance</div>
  ) : (
    <div data-testid="branch-classic">classic 8-tab</div>
  );
}

describe('Parent page — ff_parent_glance_v1 flag-branch dispatch', () => {
  beforeEach(() => {
    flagState.value = undefined;
  });

  it('production default (FLAG_DEFAULTS) keeps the glance flag OFF', () => {
    // Guards against a regression that flips the default ON.
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1]).toBe(false);
  });

  it('renders the CLASSIC 8-tab dashboard when the flag is ABSENT (prod truth)', () => {
    flagState.value = { some_other_flag: true };
    render(<ParentGlanceDispatcher />);
    expect(screen.getByTestId('branch-classic')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-glance')).not.toBeInTheDocument();
  });

  it('renders the CLASSIC dashboard when the flag is explicitly false', () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1]: false };
    render(<ParentGlanceDispatcher />);
    expect(screen.getByTestId('branch-classic')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-glance')).not.toBeInTheDocument();
  });

  it('renders the CLASSIC dashboard while flags are still loading (data undefined)', () => {
    flagState.value = undefined;
    render(<ParentGlanceDispatcher />);
    expect(screen.getByTestId('branch-classic')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-glance')).not.toBeInTheDocument();
  });

  it('renders the GLANCE home when the flag is ON (switch is live, not dead)', () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1]: true };
    render(<ParentGlanceDispatcher />);
    expect(screen.getByTestId('branch-glance')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-classic')).not.toBeInTheDocument();
  });

  it('falls back to the CLASSIC dashboard with the flag ON once classic is revealed', () => {
    // showClassic=true is the "View classic dashboard" escape hatch: nothing is
    // lost — the legacy tree renders even while the flag is ON.
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1]: true };
    render(<ParentGlanceDispatcher showClassic />);
    expect(screen.getByTestId('branch-classic')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-glance')).not.toBeInTheDocument();
  });
});
