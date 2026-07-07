/**
 * Phase 3A Wave A / A4 — student "from your teacher" card render helpers.
 *
 * Pure-function coverage for the additive Today marker:
 *   - isTeacherAssigned() detects the teacher-source marker (type or meta).
 *   - teacherAssignmentId() extracts the tracking id (for the resolve call).
 *   - fromTeacherLabel() is bilingual (P7).
 *   - resolveItemCopy() resolves the teacher_remediation copy keys (the keys
 *     the A3 contract promised — pinned here so a missing translation fails
 *     loudly rather than rendering the raw key).
 *   - A non-teacher item is NOT marked (flag-OFF parity at the card level: the
 *     marker only appears for source:'teacher' items).
 */

import { describe, it, expect } from 'vitest';
import {
  isTeacherAssigned,
  teacherAssignmentId,
  fromTeacherLabel,
  resolveItemCopy,
} from '@alfanumrik/lib/today/render';
import type { TodayQueueItem } from '@alfanumrik/lib/today/types';
import type { Subject } from '@alfanumrik/lib/subjects.types';

const SUBJECTS: Subject[] = [
  {
    code: 'science',
    name: 'Science',
    nameHi: 'विज्ञान',
    icon: '🔬',
    color: '#0ea5e9',
    subjectKind: 'cbse_core',
    isCore: true,
    isLocked: false,
  },
];

const ASSIGNMENT_ID = '99999999-9999-9999-9999-999999999999';

function teacherItem(overrides: Partial<TodayQueueItem> = {}): TodayQueueItem {
  return {
    type: 'teacher_remediation',
    rank: 1,
    labelKey: 'today.item.teacher_remediation.label',
    subtitleKey: 'today.item.teacher_remediation.subtitle',
    estMinutes: 8,
    deepLink: {
      route: '/quiz',
      params: { subject: 'science', chapter: 2, remediationId: ASSIGNMENT_ID, from: 'teacher' },
    },
    iconHint: 'teacher-badge',
    reason: 'teacher_assigned',
    meta: { source: 'teacher', assignmentId: ASSIGNMENT_ID, chapterId: null, subjectCode: 'science' },
    ...overrides,
  };
}

function srsItem(): TodayQueueItem {
  return {
    type: 'srs_due',
    rank: 2,
    labelKey: 'today.item.srs_due.label',
    subtitleKey: 'today.item.srs_due.subtitle',
    estMinutes: 5,
    deepLink: { route: '/quiz', params: { mode: 'srs' } },
    iconHint: 'cards-stack',
    reason: 'review_stacking',
    meta: { dueCount: 7 },
  };
}

describe('Today "from your teacher" marker (Phase 3A A4)', () => {
  it('isTeacherAssigned is true for a teacher_remediation item', () => {
    expect(isTeacherAssigned(teacherItem())).toBe(true);
  });

  it('isTeacherAssigned is true when meta.source==="teacher" even if type drifts', () => {
    const item = teacherItem({ type: 'practice_weakest' });
    expect(isTeacherAssigned(item)).toBe(true);
  });

  it('isTeacherAssigned is false for a non-teacher item (flag-OFF parity)', () => {
    expect(isTeacherAssigned(srsItem())).toBe(false);
  });

  it('teacherAssignmentId returns the assignment id for the resolve call', () => {
    expect(teacherAssignmentId(teacherItem())).toBe(ASSIGNMENT_ID);
  });

  it('teacherAssignmentId returns null when meta lacks the id', () => {
    const item = teacherItem({ meta: { source: 'teacher' } });
    expect(teacherAssignmentId(item)).toBeNull();
  });

  it('fromTeacherLabel is bilingual (P7)', () => {
    expect(fromTeacherLabel(false)).toBe('From your teacher');
    expect(fromTeacherLabel(true)).toBe('तुम्हारे शिक्षक से');
  });

  it('resolveItemCopy resolves teacher_remediation keys (no raw key leak)', () => {
    const en = resolveItemCopy(teacherItem(), SUBJECTS, false);
    expect(en.label).toBe('Your teacher assigned this');
    // {subject} interpolated from meta.subjectCode → "Science".
    expect(en.subtitle).toContain('Science');
    expect(en.subtitle).not.toContain('today.item.');
    expect(en.minutesBadge).toBe('~8 min');

    const hi = resolveItemCopy(teacherItem(), SUBJECTS, true);
    expect(hi.label).toBe('तुम्हारे शिक्षक ने यह दिया है');
    expect(hi.subtitle).toContain('विज्ञान');
  });

  it('general remediation (no subjectCode) falls back to the generic subject word', () => {
    const item = teacherItem({ meta: { source: 'teacher', assignmentId: ASSIGNMENT_ID, chapterId: null } });
    const en = resolveItemCopy(item, SUBJECTS, false);
    expect(en.subtitle).toContain('your subject');
  });
});
