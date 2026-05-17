import { describe, it, expect } from 'vitest';
import { ADMIN_LEVELS, hasMinimumLevel } from './admin-auth';

describe('ADMIN_LEVELS', () => {
  it('declares 6 levels in precedence order (lowest → highest)', () => {
    expect(ADMIN_LEVELS).toEqual([
      'support',
      'analyst',
      'content_manager',
      'finance',
      'admin',
      'super_admin',
    ]);
  });
});

describe('hasMinimumLevel', () => {
  it('returns false for null/undefined/empty', () => {
    expect(hasMinimumLevel(null, 'support')).toBe(false);
    expect(hasMinimumLevel(undefined, 'support')).toBe(false);
    expect(hasMinimumLevel('', 'support')).toBe(false);
  });

  it('returns false for unknown level strings', () => {
    expect(hasMinimumLevel('owner', 'support')).toBe(false);
    expect(hasMinimumLevel('root', 'support')).toBe(false);
    expect(hasMinimumLevel('Super_Admin', 'support')).toBe(false); // case-sensitive
  });

  it('super_admin passes every requirement', () => {
    for (const need of ADMIN_LEVELS) {
      expect(hasMinimumLevel('super_admin', need)).toBe(true);
    }
  });

  it('support passes only the support requirement', () => {
    expect(hasMinimumLevel('support', 'support')).toBe(true);
    expect(hasMinimumLevel('support', 'analyst')).toBe(false);
    expect(hasMinimumLevel('support', 'admin')).toBe(false);
    expect(hasMinimumLevel('support', 'super_admin')).toBe(false);
  });

  it('admin passes admin and below but not super_admin', () => {
    expect(hasMinimumLevel('admin', 'support')).toBe(true);
    expect(hasMinimumLevel('admin', 'finance')).toBe(true);
    expect(hasMinimumLevel('admin', 'admin')).toBe(true);
    expect(hasMinimumLevel('admin', 'super_admin')).toBe(false);
  });

  it('finance passes finance + below but not admin', () => {
    expect(hasMinimumLevel('finance', 'support')).toBe(true);
    expect(hasMinimumLevel('finance', 'content_manager')).toBe(true);
    expect(hasMinimumLevel('finance', 'finance')).toBe(true);
    expect(hasMinimumLevel('finance', 'admin')).toBe(false);
    expect(hasMinimumLevel('finance', 'super_admin')).toBe(false);
  });

  it('precedence is strictly monotonic', () => {
    // For every (i,j) pair, hasMinimumLevel(ADMIN_LEVELS[i], ADMIN_LEVELS[j])
    // should equal (i >= j).
    for (let i = 0; i < ADMIN_LEVELS.length; i++) {
      for (let j = 0; j < ADMIN_LEVELS.length; j++) {
        const expected = i >= j;
        expect(hasMinimumLevel(ADMIN_LEVELS[i], ADMIN_LEVELS[j])).toBe(expected);
      }
    }
  });
});
