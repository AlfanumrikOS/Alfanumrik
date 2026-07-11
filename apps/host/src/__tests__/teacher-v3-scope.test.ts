import { describe, expect, it } from 'vitest';
import { metricOrUnavailable, resolveTeacherClassScope } from '../app/teacher/_components/teacher-v3-contract';

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
});
