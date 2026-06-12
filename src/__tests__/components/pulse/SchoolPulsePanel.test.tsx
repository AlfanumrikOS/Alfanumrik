/**
 * SchoolPulsePanel — multi-school 400 "select a school" state (Round 2 pin,
 * 2026-06-12; annotated under REG-121 in `.claude/regression-catalog.md`).
 *
 * The invariant from the ops de-dup review: when /api/pulse/school returns
 * HTTP 400 (multi-school caller without ?school_id) the panel renders a calm
 * "select a school" state with NO retry affordance — a Retry button would
 * re-issue the identical 400 forever (the "dead retry loop"). School
 * disambiguation belongs to the HOST (the Command Center picker), not this
 * panel. The non-400 error branch (transient failures) MUST keep its Retry
 * button — that control proves the 400 branch is genuinely special, not that
 * retry was dropped everywhere.
 *
 * Component-test precedent: `src/__tests__/components/**` (e.g.
 * PaperCard.test.tsx, MockTestResults.test.tsx) — render + assert with
 * @testing-library/react. SchoolPulsePanel is pure presentation (no hooks, no
 * fetch), so no mocking is needed.
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SchoolPulsePanel from '@/components/pulse/SchoolPulsePanel';
import type { SchoolPulse } from '@/lib/pulse/types';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Same error shape the SWR pulseFetcher throws (an Error carrying .status). */
const pulseError = (status: number) =>
  Object.assign(new Error('Pulse fetch failed: /api/pulse/school'), { status });

/** A minimal live school snapshot (one flagged class, one clear class). */
const liveSchool: SchoolPulse = {
  schoolId: 'school-1',
  overview: { classCount: 2, teacherCount: 3, studentCount: 58, avgMastery: 0.58 },
  classesAtRisk: [
    { classId: 'c1', className: '7A', grade: '7', studentCount: 30, atRiskCount: 4, avgMastery: 0.45 },
    { classId: 'c2', className: '8B', grade: '8', studentCount: 28, atRiskCount: 0, avgMastery: 0.71 },
  ],
  dataState: 'live',
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
};

describe('SchoolPulsePanel — multi-school 400 → no-retry "select a school" state', () => {
  it('renders the select-a-school state on a 400 with NO retry button (even when onRetry is provided)', () => {
    const onRetry = vi.fn();
    render(
      <SchoolPulsePanel school={undefined} isHi={false} error={pulseError(400)} onRetry={onRetry} />,
    );

    // Calm informational state (role=status), not an alert.
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Select a school to view its Pulse')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    // THE pin: no retry affordance anywhere — retrying a school-less request
    // re-issues the identical 400 (dead retry loop).
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('renders the Hindi copy for the 400 state (P7)', () => {
    render(<SchoolPulsePanel school={undefined} isHi={true} error={pulseError(400)} />);
    expect(screen.getByText('पल्स देखने के लिए एक स्कूल चुनें')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('control: a non-400 error keeps the Retry button and wires it to onRetry', () => {
    const onRetry = vi.fn();
    render(
      <SchoolPulsePanel school={undefined} isHi={false} error={pulseError(500)} onRetry={onRetry} />,
    );

    // Transient-failure branch: alert + retry (proves the 400 branch above is
    // a deliberate carve-out, not a global retry removal).
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Select a school to view its Pulse')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a 400 arriving WITH stale data falls through to the live summary (keepPreviousData guard)', () => {
    render(
      <SchoolPulsePanel school={liveSchool} isHi={false} error={pulseError(400)} onRetry={vi.fn()} />,
    );

    // The `!school` guard means stale-but-real data wins over the 400 state.
    expect(screen.queryByText('Select a school to view its Pulse')).toBeNull();
    expect(screen.getByText('1 class flagged at risk')).toBeTruthy();
    expect(screen.getByText('4 students at risk across flagged classes')).toBeTruthy();
  });
});
