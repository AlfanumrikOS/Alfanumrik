import { describe, expect, it } from 'vitest';
import {
  readParentChildId,
  replaceParentChildId,
  resolveLinkedChild,
  withParentChildId,
} from '@/app/parent/_components/parent-child-scope';

describe('parent child scope', () => {
  const linkedChildren = [
    { id: 'student-1', name: 'A' },
    { id: 'student-2', name: 'B' },
  ];

  it('carries childId without discarding existing query parameters or hashes', () => {
    expect(withParentChildId('/parent/messages?thread=t-1#latest', 'student-2')).toBe(
      '/parent/messages?thread=t-1&childId=student-2#latest',
    );
    expect(replaceParentChildId(
      '/parent/reports',
      new URLSearchParams('range=month&childId=student-1'),
      'student-2',
    )).toBe('/parent/reports?range=month&childId=student-2');
    expect(readParentChildId(new URLSearchParams('childId=%20student-2%20'))).toBe('student-2');
  });

  it('never resolves an unknown URL child outside the authorized link list', () => {
    expect(resolveLinkedChild(linkedChildren, 'foreign-student', 'student-2')).toEqual(linkedChildren[1]);
    expect(resolveLinkedChild([linkedChildren[0]], 'foreign-student', linkedChildren[0].id)).toEqual(linkedChildren[0]);
    expect(resolveLinkedChild([], 'foreign-student', 'student-1')).toBeNull();
  });
});
