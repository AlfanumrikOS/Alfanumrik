import { describe, it, expect } from 'vitest';
import { ok, fail, type ServiceResult } from '@/lib/domains/types';

/**
 * Domain Types — ServiceResult monad contract tests
 *
 * These are the fundamental contracts every domain function must honour.
 * If ok() or fail() behave incorrectly, every caller that pattern-matches
 * on result.ok will silently do the wrong thing.
 *
 * Coverage:
 *   - ok() shape
 *   - fail() shape and defaults
 *   - Type narrowing: result.ok === true → data accessible
 *   - Type narrowing: result.ok === false → error/code accessible
 *   - Exhaustive switch (compile-time via discriminated union)
 */

describe('ServiceResult monad', () => {
  describe('ok()', () => {
    it('sets ok = true', () => {
      const r = ok({ id: 'abc' });
      expect(r.ok).toBe(true);
    });

    it('carries data payload', () => {
      const data = { count: 5, items: ['a', 'b'] };
      const r = ok(data);
      if (!r.ok) throw new Error('expected ok');
      expect(r.data).toEqual(data);
    });

    it('handles null data', () => {
      const r = ok(null);
      if (!r.ok) throw new Error('expected ok');
      expect(r.data).toBeNull();
    });

    it('handles empty string data', () => {
      const r = ok('');
      if (!r.ok) throw new Error('expected ok');
      expect(r.data).toBe('');
    });

    it('handles array data', () => {
      const r = ok([1, 2, 3]);
      if (!r.ok) throw new Error('expected ok');
      expect(r.data).toHaveLength(3);
    });

    it('does not set error property', () => {
      const r = ok('data');
      // @ts-expect-error — type narrowing should make this inaccessible
      expect((r as Record<string, unknown>).error).toBeUndefined();
    });
  });

  describe('fail()', () => {
    it('sets ok = false', () => {
      const r = fail('something failed');
      expect(r.ok).toBe(false);
    });

    it('carries error message', () => {
      const r = fail('DB timeout');
      if (r.ok) throw new Error('expected fail');
      expect(r.error).toBe('DB timeout');
    });

    it('defaults code to INTERNAL', () => {
      const r = fail('oops');
      if (r.ok) throw new Error('expected fail');
      expect(r.code).toBe('INTERNAL');
    });

    it('accepts explicit error code', () => {
      const r = fail('not found', 'NOT_FOUND');
      if (r.ok) throw new Error('expected fail');
      expect(r.code).toBe('NOT_FOUND');
    });

    it('accepts all valid error codes', () => {
      const codes = [
        'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'INVALID_INPUT',
        'CONFLICT', 'EXTERNAL_FAILURE', 'DB_ERROR', 'RATE_LIMITED', 'INTERNAL',
      ] as const;
      for (const code of codes) {
        const r = fail('msg', code);
        if (r.ok) throw new Error('expected fail');
        expect(r.code).toBe(code);
      }
    });

    it('does not set data property', () => {
      const r = fail('msg');
      // @ts-expect-error — type narrowing should make this inaccessible
      expect((r as Record<string, unknown>).data).toBeUndefined();
    });
  });

  describe('type narrowing', () => {
    function processResult(r: ServiceResult<number>): string {
      if (r.ok) {
        return `value: ${r.data}`;
      } else {
        return `error: ${r.error} [${r.code}]`;
      }
    }

    it('narrows to data on ok', () => {
      expect(processResult(ok(42))).toBe('value: 42');
    });

    it('narrows to error on fail', () => {
      expect(processResult(fail('bad input', 'INVALID_INPUT'))).toBe('error: bad input [INVALID_INPUT]');
    });
  });

  describe('edge cases', () => {
    it('ok(false) is truthy result wrapping false', () => {
      const r = ok(false);
      expect(r.ok).toBe(true);        // the result succeeded
      if (!r.ok) throw new Error('expected ok');
      expect(r.data).toBe(false);     // the data happens to be false
    });

    it('ok(0) wraps zero correctly', () => {
      const r = ok(0);
      if (!r.ok) throw new Error('expected ok');
      expect(r.data).toBe(0);
    });

    it('fail with empty string message', () => {
      const r = fail('');
      if (r.ok) throw new Error('expected fail');
      expect(r.error).toBe('');
    });
  });
});
