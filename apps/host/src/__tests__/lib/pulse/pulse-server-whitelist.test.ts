/**
 * Pulse timeline whitelist — P13 pins for `timelineFromRows` /
 * `whitelistTimelineSummary` (src/lib/pulse/pulse-server.ts).
 *
 * Round 2, Loop A frontend-deferred item: `escalatedTo` is now whitelisted
 * FOR THE `system.remediation_escalated` KIND ONLY, so the pulse-copy
 * timelineLine can branch the student/parent/teacher escalation copy. The
 * value domain is 'teacher' | 'parent' | null (a routing label, never PII).
 *
 * What stays pinned:
 *   - identifiers on the escalation payload (interventionId,
 *     teacherAssignmentId) are NEVER surfaced;
 *   - the per-kind addition does NOT leak onto other kinds;
 *   - PII-shaped keys never pass the whitelist for any kind;
 *   - null escalatedTo is omitted (matches the copy layer's neutral
 *     degradation when the key is absent).
 */
import { describe, it, expect } from 'vitest';
import { timelineFromRows } from '@alfanumrik/lib/pulse/pulse-server';

function summaryOf(kind: string, payload: Record<string, unknown>) {
  const [entry] = timelineFromRows([
    { kind, occurred_at: '2026-06-12T10:00:00Z', payload },
  ]);
  return entry.summary;
}

describe('timelineFromRows — system.remediation_escalated whitelist', () => {
  const BASE_PAYLOAD = {
    interventionId: '00000000-0000-0000-0000-00000000bb01',
    subjectCode: 'science',
    chapterNumber: 4,
    teacherAssignmentId: '00000000-0000-0000-0000-00000000cc01',
  };

  it("surfaces escalatedTo 'teacher' alongside the generic academic keys", () => {
    const summary = summaryOf('system.remediation_escalated', {
      ...BASE_PAYLOAD,
      escalatedTo: 'teacher',
    });
    expect(summary).toMatchObject({
      subjectCode: 'science',
      chapterNumber: 4,
      escalatedTo: 'teacher',
    });
  });

  it("surfaces escalatedTo 'parent'", () => {
    const summary = summaryOf('system.remediation_escalated', {
      ...BASE_PAYLOAD,
      escalatedTo: 'parent',
    });
    expect(summary.escalatedTo).toBe('parent');
  });

  it('omits a null escalatedTo (no-recipient escalation → copy degrades to neutral)', () => {
    const summary = summaryOf('system.remediation_escalated', {
      ...BASE_PAYLOAD,
      escalatedTo: null,
    });
    expect('escalatedTo' in summary).toBe(false);
  });

  it('NEVER surfaces the row identifiers carried on the event payload (P13)', () => {
    const summary = summaryOf('system.remediation_escalated', {
      ...BASE_PAYLOAD,
      escalatedTo: 'teacher',
    });
    expect('interventionId' in summary).toBe(false);
    expect('teacherAssignmentId' in summary).toBe(false);
    expect(JSON.stringify(summary)).not.toContain('bb01');
    expect(JSON.stringify(summary)).not.toContain('cc01');
  });
});

describe('timelineFromRows — Loop B/C escalated kinds whitelist', () => {
  // Phase A Loops B/C: the same routing-LABEL contract as Loop A's
  // system.remediation_escalated extends to these three kinds so the Pulse
  // timeline can render the correct 'teacher'/'parent' attribution. The value
  // domain is 'teacher' | 'parent' | null (never PII). Identifiers
  // (interventionId, teacherAssignmentId) and scheduling internals
  // (daysSince*, verifyBy) must NEVER surface for these kinds (P13).
  const LOOP_BC_KINDS = [
    'system.engagement_escalated',
    'system.concentration_escalated',
    'system.concentration_reescalated',
  ] as const;

  // A maximally-hostile payload: legit routing label + generic academic keys,
  // plus every identifier / scheduling / PII-shaped field that must be dropped.
  const HOSTILE_BASE = {
    interventionId: '00000000-0000-0000-0000-00000000bb02',
    teacherAssignmentId: '00000000-0000-0000-0000-00000000cc02',
    daysSinceActive: 9,
    daysSinceEscalation: 3,
    verifyBy: '2026-06-30T00:00:00Z',
    studentName: 'Asha K',
    email: 'asha@example.com',
    phone: '+91-9999999999',
    subjectCode: 'science',
    chapterNumber: 7,
  };

  for (const kind of LOOP_BC_KINDS) {
    describe(kind, () => {
      it("surfaces escalatedTo 'teacher' alongside the generic academic keys", () => {
        const summary = summaryOf(kind, { ...HOSTILE_BASE, escalatedTo: 'teacher' });
        expect(summary).toMatchObject({
          subjectCode: 'science',
          chapterNumber: 7,
          escalatedTo: 'teacher',
        });
      });

      it("surfaces escalatedTo 'parent'", () => {
        const summary = summaryOf(kind, { ...HOSTILE_BASE, escalatedTo: 'parent' });
        expect(summary.escalatedTo).toBe('parent');
      });

      it('omits a null escalatedTo (no-recipient escalation → copy degrades to neutral)', () => {
        const summary = summaryOf(kind, { ...HOSTILE_BASE, escalatedTo: null });
        expect('escalatedTo' in summary).toBe(false);
      });

      it('NEVER surfaces identifiers, scheduling internals, or PII (P13)', () => {
        const summary = summaryOf(kind, { ...HOSTILE_BASE, escalatedTo: 'teacher' });
        // Identifiers off the whitelist.
        expect('interventionId' in summary).toBe(false);
        expect('teacherAssignmentId' in summary).toBe(false);
        // Scheduling internals off the whitelist.
        expect('daysSinceActive' in summary).toBe(false);
        expect('daysSinceEscalation' in summary).toBe(false);
        expect('verifyBy' in summary).toBe(false);
        // PII-shaped keys never pass for any kind.
        expect('studentName' in summary).toBe(false);
        expect('email' in summary).toBe(false);
        expect('phone' in summary).toBe(false);
        // Belt-and-suspenders: no sensitive substring leaks via stringify.
        const json = JSON.stringify(summary);
        expect(json).not.toMatch(/Asha|example\.com|9999999999/);
        expect(json).not.toContain('bb02');
        expect(json).not.toContain('cc02');
      });
    });
  }
});

describe('timelineFromRows — per-kind scoping of the escalatedTo addition', () => {
  it('escalatedTo does NOT pass the whitelist on other kinds', () => {
    for (const kind of [
      'system.remediation_injected',
      'system.remediation_recovered',
      'learner.mastery_changed',
      'learner.quiz_completed',
    ]) {
      const summary = summaryOf(kind, {
        subjectCode: 'math',
        chapterNumber: 2,
        escalatedTo: 'teacher', // hostile/buggy producer — must be dropped
      });
      expect('escalatedTo' in summary, `kind=${kind}`).toBe(false);
      expect(summary.subjectCode).toBe('math'); // generic keys still pass
    }
  });

  it('PII-shaped keys never pass the whitelist for any kind (P13)', () => {
    const summary = summaryOf('system.remediation_escalated', {
      subjectCode: 'math',
      escalatedTo: 'teacher',
      studentName: 'Asha K',
      email: 'asha@example.com',
      phone: '+91-9999999999',
    });
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/Asha|example\.com|9999999999/);
    expect('studentName' in summary).toBe(false);
    expect('email' in summary).toBe(false);
    expect('phone' in summary).toBe(false);
  });
});
