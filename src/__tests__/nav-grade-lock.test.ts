import { describe, it, expect } from 'vitest';
import { getItemLockForGrade } from '@/components/ui/BottomNavComponent';

/**
 * Phase 5B Surface 1 — grade-gated nav items are now SHOWN as visibly locked
 * (with a "Grade N+" chip), not silently filtered out.
 * These tests guard the policy so future refactors don't regress to the old
 * hide-by-filter behavior.
 */

describe('getItemLockForGrade — nav grade-gating policy', () => {
  it('items without gradeMin are never locked', () => {
    expect(getItemLockForGrade({ href: '/foxy' }, 6).locked).toBe(false);
    expect(getItemLockForGrade({ href: '/foxy' }, 12).locked).toBe(false);
    expect(getItemLockForGrade({}, 6).locked).toBe(false);
  });

  it('null / undefined items are safely treated as unlocked', () => {
    expect(getItemLockForGrade(null, 6).locked).toBe(false);
    expect(getItemLockForGrade(undefined, 6).locked).toBe(false);
  });

  it('PYQ (gradeMin: 9) is locked for grade 6 and exposes gradeMin', () => {
    const result = getItemLockForGrade({ href: '/pyq', gradeMin: 9 }, 6);
    expect(result.locked).toBe(true);
    expect(result.gradeMin).toBe(9);
  });

  it('PYQ (gradeMin: 9) is locked for grade 8 but unlocked at grade 9', () => {
    expect(getItemLockForGrade({ gradeMin: 9 }, 8).locked).toBe(true);
    expect(getItemLockForGrade({ gradeMin: 9 }, 9).locked).toBe(false);
    expect(getItemLockForGrade({ gradeMin: 9 }, 12).locked).toBe(false);
  });

  it('boundary: student grade exactly equal to gradeMin is unlocked', () => {
    expect(getItemLockForGrade({ gradeMin: 9 }, 9).locked).toBe(false);
    expect(getItemLockForGrade({ gradeMin: 11 }, 11).locked).toBe(false);
  });

  it('handles non-numeric gradeMin defensively', () => {
    expect(getItemLockForGrade({ gradeMin: undefined as any }, 6).locked).toBe(false);
    expect(getItemLockForGrade({ gradeMin: null as any }, 6).locked).toBe(false);
    // Non-number types are treated as "no lock" rather than throwing.
    expect(getItemLockForGrade({ gradeMin: '9' as any }, 6).locked).toBe(false);
  });
});