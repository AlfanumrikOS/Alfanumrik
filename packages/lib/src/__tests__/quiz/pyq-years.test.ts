/**
 * PYQ board-year window + validator.
 *
 * The retired `/pyq` runtime hardcoded `2025 - i` for 11 entries. That list
 * decays silently: past its author's assumption it simply stops offering the
 * newest board paper and nothing fails. These tests pin the derived window and,
 * more importantly, pin that the PICKER and the `?year=` VALIDATOR agree — if
 * they drift, `/pyq` offers a year that `/quiz` then discards, and the student
 * gets a generic quiz labelled as a board paper.
 */

import { describe, it, expect } from 'vitest';
import {
  PYQ_MIN_YEAR,
  PYQ_YEAR_COUNT,
  isPyqYear,
  pyqMaxYear,
  pyqYears,
} from '../../quiz/pyq-years';

const AT = (iso: string) => new Date(iso);

describe('pyqYears — the offered window', () => {
  it('is newest-first and PYQ_YEAR_COUNT long', () => {
    const years = pyqYears(AT('2026-08-11T00:00:00Z'));
    expect(years).toHaveLength(PYQ_YEAR_COUNT);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(2016);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });

  it('advances with the calendar instead of decaying (the defect it replaces)', () => {
    expect(pyqYears(AT('2027-01-01T00:00:00Z'))[0]).toBe(2027);
    expect(pyqYears(AT('2030-06-01T00:00:00Z'))[0]).toBe(2030);
  });

  it('never offers a paper that has not been sat yet', () => {
    // Board papers for year Y are sat in Feb-Mar of Y, so Y itself is the
    // newest honest offer; Y+1 would be a promise content cannot keep.
    const now = AT('2026-08-11T00:00:00Z');
    expect(Math.max(...pyqYears(now))).toBe(pyqMaxYear(now));
    expect(pyqYears(now)).not.toContain(2027);
  });

  it('never falls below the floor', () => {
    const years = pyqYears(AT('2015-01-01T00:00:00Z'));
    expect(Math.min(...years)).toBeGreaterThanOrEqual(PYQ_MIN_YEAR);
  });
});

describe('isPyqYear — the ?year= gate', () => {
  const now = AT('2026-08-11T00:00:00Z');

  it('accepts every year the picker offers (picker and gate cannot drift)', () => {
    for (const y of pyqYears(now)) expect(isPyqYear(y, now)).toBe(true);
  });

  it('accepts an older bookmarked year down to the floor', () => {
    // Deliberately WIDER than the picker window: an old link keeps working
    // instead of quietly degrading to a generic quiz.
    expect(isPyqYear(PYQ_MIN_YEAR, now)).toBe(true);
    expect(pyqYears(now)).not.toContain(PYQ_MIN_YEAR);
  });

  it.each([
    ['below the floor', PYQ_MIN_YEAR - 1],
    ['in the future', 2027],
    ['junk small integer', 3],
    ['a year-like float', 2019.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, value) => {
    expect(isPyqYear(value, now)).toBe(false);
  });

  it.each([
    ['a numeric string', '2019'],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('rejects %s (non-number)', (_label, value) => {
    expect(isPyqYear(value, now)).toBe(false);
  });
});
