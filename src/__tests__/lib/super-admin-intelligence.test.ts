/**
 * super-admin/intelligence — pure helpers for the Education Intelligence Cloud
 * read-API. These are the DISTINCT-ON substitute (dedupLatest) + the defensive
 * numeric / array / uuid coercers used to normalize PostgREST rollup rows.
 *
 * The network-touching helpers (safeSelect / fetchSchoolMeta) and the
 * graceful-empty + RLS-service-role-only intent are covered by the EIC route
 * tests / E2E (they require a fetch + admin-auth env mock); this file pins the
 * pure logic only.
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  dedupLatest,
  num,
  numOrNull,
  int,
  strArray,
  isUuid,
} from '@/lib/super-admin/intelligence';

describe('dedupLatest — keeps the FIRST (newest) row per key', () => {
  it('keeps the newest row when rows are ordered newest-first', () => {
    const rows = [
      { school_id: 'a', score_date: '2026-06-11', v: 1 },
      { school_id: 'b', score_date: '2026-06-11', v: 2 },
      { school_id: 'a', score_date: '2026-06-10', v: 3 }, // older dup of a
    ];
    const out = dedupLatest(rows, 'school_id');
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.school_id === 'a')?.v).toBe(1); // newest a kept
    expect(out.map((r) => r.school_id)).toEqual(['a', 'b']);
  });
  it('empty input → empty output', () => {
    expect(dedupLatest([] as { id: string }[], 'id')).toEqual([]);
  });
  it('no duplicates → input order preserved', () => {
    const rows = [{ k: 'x' }, { k: 'y' }, { k: 'z' }];
    expect(dedupLatest(rows, 'k')).toEqual(rows);
  });
});

describe('num — coerce to finite number (0 fallback)', () => {
  it('passes through finite numbers', () => {
    expect(num(42)).toBe(42);
    expect(num(0)).toBe(0);
  });
  it('parses numeric strings (Postgres numeric columns arrive as strings)', () => {
    expect(num('3.14')).toBeCloseTo(3.14);
  });
  it('null / undefined / garbage → 0', () => {
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num('abc')).toBe(0);
    expect(num(NaN)).toBe(0);
  });
});

describe('numOrNull — coerce but preserve null', () => {
  it('null / undefined → null (absent average/score)', () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
  });
  it('parses numeric strings', () => {
    expect(numOrNull('2.5')).toBe(2.5);
  });
  it('non-numeric garbage → null', () => {
    expect(numOrNull('xyz')).toBeNull();
  });
});

describe('int — coerce to truncated integer (0 fallback)', () => {
  it('truncates a float', () => {
    expect(int(4.9)).toBe(4);
  });
  it('parses an integer string', () => {
    expect(int('17')).toBe(17);
  });
  it('null / garbage → 0', () => {
    expect(int(null)).toBe(0);
    expect(int('nope')).toBe(0);
  });
});

describe('strArray — normalize a text[] column', () => {
  it('maps array entries to strings', () => {
    expect(strArray(['a', 1, true])).toEqual(['a', '1', 'true']);
  });
  it('non-array → empty array', () => {
    expect(strArray(null)).toEqual([]);
    expect(strArray('x')).toEqual([]);
  });
});

describe('isUuid — loose UUID shape gate', () => {
  it('accepts a well-formed UUID', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });
  it('rejects obvious garbage before the DB hit', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('123e4567e89b12d3a456426614174000')).toBe(false);
  });
});
