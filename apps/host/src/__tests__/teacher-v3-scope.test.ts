import { describe, expect, it } from 'vitest';
import { metricOrUnavailable, resolveTeacherClassScope, targetedRemediationPayload } from '../app/teacher/_components/teacher-v3-contract';

const classes = [{ id: 'class-a' }, { id: 'class-b' }];

describe('Teacher V3 scope and data trust', () => {
  it('accepts only a class present in the server-returned roster', () => {
    expect(resolveTeacherClassScope(classes, 'class-b', 'class-a')).toBe('class-b');
    expect(resolveTeacherClassScope(classes, 'forged-class', 'class-a')).toBe('class-a');
  });

  it('falls back to the first assigned class and never accepts an unassigned persisted id', () => {
    expect(resolveTeacherClassScope(classes, null, 'forged-class')).toBe('class-a');
    expect(resolveTeacherClassScope([], 'class-a', 'class-a')).toBeNull();
  });

  it('renders missing metrics as unavailable instead of zero', () => {
    expect(metricOrUnavailable(undefined, '%')).toBe('—');
    expect(metricOrUnavailable(null)).toBe('—');
    expect(metricOrUnavailable(0, '%')).toBe('0%');
  });

  it('builds the server-owned targeted remediation payload without browser scoring', () => {
    expect(targetedRemediationPayload({
      classId: 'class-a',
      studentId: 'student-1',
      topicId: 'concept-2',
      alertId: 'alert-3',
    })).toEqual({
      class_id: 'class-a',
      student_id: 'student-1',
      chapter_id: 'concept-2',
      source_alert_id: 'alert-3',
    });
    expect(targetedRemediationPayload({ classId: 'class-a', studentId: 'student-1' })).toEqual({
      class_id: 'class-a',
      student_id: 'student-1',
      chapter_id: null,
      source_alert_id: null,
    });
  });
});
