/**
 * Teacher Command Center — at-risk alert reconciler
 * (packages/lib/src/teacher/alert-reconciler.ts).
 *
 * RCA (2026-07-20): the legacy `get_alerts` accuracy/streak check and Student
 * Pulse's three signals can disagree on the same student. Neither is a strict
 * superset of the other (see the module header for the full analysis), so
 * they are reconciled into ONE at-risk determination per student — the UNION
 * of whatever either system flagged, with a single traceable reason string.
 *
 * This test pins the three cases the task calls for:
 *   1. A student flagged ONLY by the legacy accuracy/streak check.
 *   2. A student flagged ONLY by Pulse signals.
 *   3. A student flagged by BOTH — the merged row must carry BOTH reasons and
 *      the worse of the two severities, and must never render two
 *      contradictory verdicts.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcileAlerts,
  pulseReasonsAndSeverity,
  legacyReasonFromAlert,
  SEVERITY_RANK,
} from '@alfanumrik/lib/teacher/alert-reconciler';
import type { RiskAlert } from '@alfanumrik/lib/types';
import type { PulseSignals, PulseListItem } from '@alfanumrik/lib/pulse/types';

// ── Fixture builders ─────────────────────────────────────────────────────────

function legacyCriticalAccuracyAlert(studentId: string, name: string): RiskAlert {
  return {
    id: `alert-${studentId}-math-critical`,
    student_id: studentId,
    student_name: name,
    severity: 'critical',
    title: `${name} — critical accuracy in math`,
    description: '28% accuracy over 10 questions. Needs immediate intervention.',
    recommended_action: 'Schedule a one-on-one revision session on math fundamentals.',
    remediation_status: 'none',
  };
}

function legacyStreakAlert(studentId: string, name: string): RiskAlert {
  return {
    id: `alert-${studentId}-streak`,
    student_id: studentId,
    student_name: name,
    severity: 'medium',
    title: `${name} — streak broken`,
    description: 'Was active (150 XP) but streak dropped to 0. May be losing engagement.',
    recommended_action: 'Send an encouragement message or assign a short quiz.',
    remediation_status: 'none',
  };
}

/** A no-signal-firing Pulse bundle (thriving) — the baseline every field
 *  override starts from. */
function thrivingSignals(): PulseSignals {
  return {
    inactivity: { verdict: 'ok', daysSinceActive: 0 },
    masteryCliff: { verdict: 'none', largestDrop: null, declineStreak: 0, worstSubject: null, worstChapter: null },
    atRiskConcentration: { bySubject: [], worstBand: 'none', totalAtRiskChapters: 0 },
  };
}

function brokenStreakSignals(days: number): PulseSignals {
  return {
    ...thrivingSignals(),
    inactivity: { verdict: 'broken', daysSinceActive: days },
  };
}

function pulseListItem(
  studentId: string,
  displayName: string,
  signals: PulseSignals,
): PulseListItem {
  return {
    studentId,
    displayName,
    grade: '8',
    status: 'at_risk',
    signals,
    totalAtRiskChapters: signals.atRiskConcentration.totalAtRiskChapters,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('pulseReasonsAndSeverity', () => {
  it('returns null when nothing meaningful is firing (thriving)', () => {
    expect(pulseReasonsAndSeverity(thrivingSignals())).toBeNull();
  });

  it('flags a broken streak as critical with a days-inactive reason', () => {
    const result = pulseReasonsAndSeverity(brokenStreakSignals(6));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('critical');
    expect(result!.reasons.join(' ')).toMatch(/6\+ days inactive/);
  });
});

describe('legacyReasonFromAlert', () => {
  it('strips the name prefix and appends the accuracy percentage', () => {
    const reason = legacyReasonFromAlert(legacyCriticalAccuracyAlert('stu-1', 'Asha'));
    expect(reason).toBe('critical accuracy in math (28%)');
  });

  it('strips the name prefix for the streak-broken template (no percentage)', () => {
    const reason = legacyReasonFromAlert(legacyStreakAlert('stu-1', 'Asha'));
    expect(reason).toBe('streak broken');
  });
});

describe('reconcileAlerts — case 1: legacy-only', () => {
  it('surfaces the student with the legacy reason and severity, no Pulse contribution', () => {
    const legacy = [legacyCriticalAccuracyAlert('stu-1', 'Asha')];
    const merged = reconcileAlerts(legacy, []);

    expect(merged).toHaveLength(1);
    const row = merged[0];
    expect(row.student_id).toBe('stu-1');
    expect(row.severity).toBe('critical');
    expect(row.sources).toEqual({ legacy: true, pulse: false });
    expect(row.reasons).toEqual(['critical accuracy in math (28%)']);
    expect(row.description).toBe('critical accuracy in math (28%)');
  });
});

describe('reconcileAlerts — case 2: Pulse-only', () => {
  it('surfaces a student Pulse flags that the legacy check never produced a row for', () => {
    const pulseItems = [pulseListItem('stu-2', 'Rahul', brokenStreakSignals(4))];
    const merged = reconcileAlerts([], pulseItems);

    expect(merged).toHaveLength(1);
    const row = merged[0];
    expect(row.student_id).toBe('stu-2');
    expect(row.student_name).toBe('Rahul');
    expect(row.severity).toBe('critical');
    expect(row.sources).toEqual({ legacy: false, pulse: true });
    expect(row.reasons).toEqual(['4+ days inactive']);
    expect(row.remediation_status).toBe('none');
    // The alert id must not collide with a legacy-style id (no synthetic
    // "-critical"/"-streak" suffix from the legacy templates).
    expect(row.id).toBe('pulse-stu-2');
  });
});

describe('reconcileAlerts — case 3: both systems flag the SAME student', () => {
  it('produces ONE row with the UNION of reasons and the worse severity — never two contradictory verdicts', () => {
    const legacy = [legacyStreakAlert('stu-3', 'Meera')]; // legacy severity: medium
    const pulseItems = [pulseListItem('stu-3', 'Meera', brokenStreakSignals(5))]; // pulse severity: critical
    const merged = reconcileAlerts(legacy, pulseItems);

    expect(merged).toHaveLength(1);
    const row = merged[0];
    expect(row.student_id).toBe('stu-3');
    expect(row.sources).toEqual({ legacy: true, pulse: true });

    // Worse-of-the-two severity wins (critical beats medium).
    expect(row.severity).toBe('critical');
    expect(SEVERITY_RANK[row.severity]).toBeLessThan(SEVERITY_RANK.medium);

    // Both reasons are present — union, not overwrite.
    expect(row.reasons).toEqual(
      expect.arrayContaining(['streak broken', '5+ days inactive']),
    );
    expect(row.reasons).toHaveLength(2);

    // Single traceable "why flagged" string names both signals.
    expect(row.description).toBe('streak broken and 5+ days inactive');
  });
});

describe('reconcileAlerts — ordering and non-contradiction', () => {
  it('sorts worst-severity-first across a mixed legacy + Pulse roster', () => {
    const legacy = [
      legacyCriticalAccuracyAlert('stu-1', 'Asha'), // critical (legacy-only)
      legacyStreakAlert('stu-3', 'Meera'), // medium (also Pulse-flagged below -> critical)
    ];
    const pulseItems = [
      pulseListItem('stu-2', 'Rahul', brokenStreakSignals(4)), // critical (pulse-only)
      pulseListItem('stu-3', 'Meera', brokenStreakSignals(5)), // critical (merges with legacy medium)
    ];
    const merged = reconcileAlerts(legacy, pulseItems);

    expect(merged).toHaveLength(3);
    // No student appears twice, and no student is silently dropped.
    const ids = merged.map((a) => a.student_id).sort();
    expect(ids).toEqual(['stu-1', 'stu-2', 'stu-3']);
    // Worst-severity-first (all three are critical here after reconciliation;
    // ties broken alphabetically by name).
    expect(merged.every((a) => a.severity === 'critical')).toBe(true);
    expect(merged.map((a) => a.student_name)).toEqual(['Asha', 'Meera', 'Rahul']);
  });
});
