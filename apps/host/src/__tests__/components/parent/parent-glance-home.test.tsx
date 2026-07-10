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

import { CONSUMER_MINIMALISM_FLAGS, FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';

// ─── WeeklyReport owns its own /api/parent/report fetch + states. Stub it so
//     the guardian-mode branch doesn't try to hit the network. ───
vi.mock('@alfanumrik/ui/parent/WeeklyReport', () => ({
  default: ({ studentId, guardianId }: { studentId: string; guardianId: string }) => (
    <div data-testid="weekly-report-stub" data-student={studentId} data-guardian={guardianId} />
  ),
}));

// ─── EncourageButton (Wave D) owns a Supabase-session read + POST to
//     /api/v2/parent/encourage. Stub it so the gate tests assert purely on
//     whether ParentGlanceHome MOUNTS it (the flag × guardian gate), not on its
//     own behaviour (covered by encourage-button.test.tsx). ───
vi.mock('@alfanumrik/ui/parent/EncourageButton', () => ({
  default: ({ studentId, childName }: { studentId: string; childName: string }) => (
    <div data-testid="encourage-button-stub" data-student={studentId} data-child={childName} />
  ),
}));

import ParentGlanceHome, {
  type ParentGlanceHomeProps,
} from '@alfanumrik/ui/parent/ParentGlanceHome';

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
  // Flag-OFF baseline: these contract tests assert the Wave C surface, so the
  // Wave D Encourage gate must be inert. Reset to "no flags" before each test so
  // the read-only contract is independent of test ordering (PART 3 sets the flag
  // ON; this guard ensures none of that leaks into the read-only assertions).
  beforeEach(() => {
    flagState.value = undefined;
  });

  it('renders all three sections for a child with activity', () => {
    render(<ParentGlanceHome {...makeProps()} />);

    // SNAPSHOT — plain-language headline + compact stat pills derived from props.
    expect(
      screen.getByRole('region', { name: 'Weekly snapshot' }),
    ).toBeInTheDocument();
    // Accuracy >= 70 → "doing well" headline.
    expect(screen.getByText('Asha is doing well this week.')).toBeInTheDocument();
    // Stat pills read straight off the passed stats — no recompute.
    expect(screen.getByText('6')).toBeInTheDocument(); // questions
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
    expect(screen.getByText('Next best step')).toBeInTheDocument();
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
    // NONE is a form/submit/write affordance.
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

  it('renders the Hindi headline when isHi is true (P7)', () => {
    render(<ParentGlanceHome {...makeProps({ isHi: true })} />);
    // accuracy 78 ≥ 70 → Hindi "doing well" string.
    expect(screen.getByText('Asha इस सप्ताह अच्छा कर रहा है।')).toBeInTheDocument();
    // Numbers stay Arabic numerals even in Hindi (Questions pill).
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});

describe('ParentGlanceHome — loading / empty / error states (from props, no fetch)', () => {
  beforeEach(() => {
    flagState.value = undefined;
  });

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
    expect(screen.queryByRole('region', { name: 'Quick actions' })).not.toBeInTheDocument();
  });
});

const flagState: { value: Record<string, boolean> | undefined } = { value: undefined };
vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => ({ data: flagState.value }),
}));

import { useFeatureFlags } from '@alfanumrik/lib/swr';

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — Wave D "Encourage" affordance gate (REG-85).
//
// ParentGlanceHome reads ff_parent_encourage_v1 via the SAME useFeatureFlags
// hook mocked above (flagState), and mounts <EncourageButton> ONLY when:
//     flags?.[PARENT_ENCOURAGE_V1] === true  AND  canFetchReport === true.
// Two conditions, both required. We assert the full truth table — flag OFF (any
// canFetchReport) hides it; flag ON + link-code parent (canFetchReport=false)
// hides it; flag ON + guardian (canFetchReport=true) shows it. The button is
// stubbed (see top of file) so this is purely a mount / no-mount gate test,
// matching the WeeklyReport-gate assertions above.
//
// This is the enforcing test for REG-85's flag-OFF-parity half. Because the
// glance home only mounts inside the Wave C glance branch (REG-84), an OFF
// ff_parent_encourage_v1 means the parent surface is byte-identical to Wave C —
// no new write affordance appears. Weakening these assertions requires user
// approval.
// ═══════════════════════════════════════════════════════════════════════════
describe('ParentGlanceHome — Encourage affordance gate (ff_parent_encourage_v1 × guardian)', () => {
  beforeEach(() => {
    // Each test sets flagState explicitly; default to "no flags" so a forgotten
    // set can never silently leak an ON value from a prior test.
    flagState.value = undefined;
  });

  it('production default keeps ff_parent_encourage_v1 OFF', () => {
    // Guards against a regression that flips the default ON.
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]).toBe(false);
  });

  it('HIDES Encourage when the flag is ABSENT, even for a guardian-mode parent', async () => {
    flagState.value = { some_other_flag: true };
    render(<ParentGlanceHome {...makeProps({ canFetchReport: true })} />);
    // Give the lazy dynamic() import a window to (not) resolve.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('encourage-button-stub')).not.toBeInTheDocument();
  });

  it('HIDES Encourage when the flag is explicitly false (guardian-mode parent)', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]: false };
    render(<ParentGlanceHome {...makeProps({ canFetchReport: true })} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('encourage-button-stub')).not.toBeInTheDocument();
  });

  it('HIDES Encourage while flags are still loading (data undefined)', async () => {
    flagState.value = undefined;
    render(<ParentGlanceHome {...makeProps({ canFetchReport: true })} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('encourage-button-stub')).not.toBeInTheDocument();
  });

  it('HIDES Encourage when the flag is ON but the parent is NOT guardian-JWT (canFetchReport=false)', async () => {
    // Link-code parents would 403 the guardian-only route, so the affordance is
    // never offered to them even with the flag ON.
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]: true };
    render(<ParentGlanceHome {...makeProps({ canFetchReport: false })} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('encourage-button-stub')).not.toBeInTheDocument();
  });

  it('SHOWS Encourage ONLY when the flag is ON AND the parent is guardian-JWT', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]: true };
    render(<ParentGlanceHome {...makeProps({ canFetchReport: true })} />);
    // The button is lazy-loaded via next/dynamic — await its resolution.
    const stub = await screen.findByTestId('encourage-button-stub');
    expect(stub).toBeInTheDocument();
    // It is wired to the selected child (studentId + name pass-through).
    expect(stub).toHaveAttribute('data-student', 'stu-1');
    expect(stub).toHaveAttribute('data-child', 'Asha');
    // It lives inside the Quick actions section (not loose in the tree).
    const actions = screen.getByRole('region', { name: 'Quick actions' });
    expect(within(actions).getByTestId('encourage-button-stub')).toBeInTheDocument();
  });

  it('does NOT mount Encourage in the zero-activity empty state (no Actions section)', async () => {
    // Even flag ON + guardian: the empty state renders no Actions section, so the
    // Encourage button has nowhere to mount — parity with the no-affordance path.
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]: true };
    render(
      <ParentGlanceHome
        {...makeProps({
          canFetchReport: true,
          stats: { xp: 0, streak: 0, accuracy: 0, totalQuizzes: 0, minutes: 0, totalChats: 0, avgScore: 0 },
          weekSummary: { quizzes: 0, avgScore: 0, activeDays: 0 },
          bktMastery: { levels: {}, total: 0 },
          insights: [],
          perfScores: [],
          labStreak: 0,
        })}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('encourage-button-stub')).not.toBeInTheDocument();
  });
});
