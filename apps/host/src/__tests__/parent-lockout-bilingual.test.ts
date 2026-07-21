import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOCKOUT_KEY,
  recordFailedAttempt,
  isLockedOut,
  clearLockoutAttempts,
} from '@/app/parent/_components/parent-session';

// Regression coverage for Task 2.2 of the parent-dashboard RCA fixes
// (2026-07-20): recordFailedAttempt() and isLockedOut() previously always
// returned hardcoded English strings, the one P7 bilingual gap on the
// parent login screen. Both now accept an optional isHi parameter
// (default false, so pre-existing English-only callers/tests are
// unaffected) and return a Hindi message when isHi is true.

describe('parent lockout messages are bilingual (P7)', () => {
  beforeEach(() => {
    sessionStorage.removeItem(LOCKOUT_KEY);
  });

  it('defaults to English when isHi is omitted (backward compatible)', () => {
    recordFailedAttempt();
    recordFailedAttempt();
    const msg = recordFailedAttempt();
    expect(msg).toMatch(/Locked for 3 minute/);
    expect(msg).not.toMatch(/लॉक/);

    const lock = isLockedOut();
    expect(lock.locked).toBe(true);
    expect(lock.message).toMatch(/Account locked/);
  });

  it('returns Hindi Devanagari text when isHi=true', () => {
    recordFailedAttempt(true);
    recordFailedAttempt(true);
    const msg = recordFailedAttempt(true);
    expect(msg).toContain('लॉक');
    expect(msg).not.toMatch(/Locked for/);

    const lock = isLockedOut(true);
    expect(lock.locked).toBe(true);
    expect(lock.message).toContain('लॉक');
    expect(lock.message).not.toMatch(/Account locked/);
  });

  it('English and Hindi paths report the same lockout state (only the message text differs)', () => {
    recordFailedAttempt(true);
    recordFailedAttempt(true);
    recordFailedAttempt(true);

    const enView = isLockedOut(false);
    const hiView = isLockedOut(true);
    expect(enView.locked).toBe(true);
    expect(hiView.locked).toBe(true);
    expect(enView.message).not.toEqual(hiView.message);
  });
});
