/**
 * cn() — tailwind-merge + clsx wrapper used across UI primitives.
 *
 * Tiny, but had 0% coverage before this file. Tests anchor the conflict-
 * resolution + nullish-skip behaviour we rely on in component classes.
 */

import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('joins class names with a space', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });

  it('skips falsy entries (undefined, null, false)', () => {
    expect(cn('a', undefined, null, false, 'b')).toBe('a b');
  });

  it('handles object-style class entries (clsx contract)', () => {
    expect(cn({ a: true, b: false, c: true })).toBe('a c');
  });

  it('merges conflicting Tailwind utilities (last wins)', () => {
    // tailwind-merge resolves px-2 vs px-4 to px-4 (last wins).
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('keeps non-conflicting utilities side by side', () => {
    expect(cn('text-sm', 'font-bold')).toBe('text-sm font-bold');
  });

  it('flattens nested arrays', () => {
    expect(cn(['a', ['b', 'c']])).toBe('a b c');
  });
});
