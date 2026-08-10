/**
 * Canonical MCQ option primitives — `packages/lib/src/quiz/options.ts`.
 *
 * This module replaced 7 copies of `parseOptions` and 7 of `OPTION_LETTERS`.
 * These tests pin the BEHAVIOURAL UNION of all seven originals so the
 * consolidation stays provably behaviour-neutral, and pin the P6 / marking
 * guarantees the parser must never break:
 *
 *   - option COUNT is never changed (no filtering, no truncation to 4)
 *   - option ORDER is never changed (order is bound to the server shuffle
 *     snapshot and `selected_displayed_index`; reordering corrupts marking)
 */

import { describe, it, expect } from 'vitest';
import { OPTION_LETTERS, parseOptions } from '@alfanumrik/lib/quiz/options';

describe('OPTION_LETTERS', () => {
  it('is exactly A-D in order (all 7 originals were identical)', () => {
    expect(OPTION_LETTERS).toEqual(['A', 'B', 'C', 'D']);
  });

  it('indexes by position and is undefined past D, so callers can fall back', () => {
    expect(OPTION_LETTERS[0]).toBe('A');
    expect(OPTION_LETTERS[3]).toBe('D');
    // Every original call site does `OPTION_LETTERS[idx] || String(idx + 1)`.
    expect(OPTION_LETTERS[4]).toBeUndefined();
    expect(OPTION_LETTERS[4] || String(4 + 1)).toBe('5');
  });

  it('is frozen — a shared constant must not be mutable by one consumer', () => {
    expect(Object.isFrozen(OPTION_LETTERS)).toBe(true);
  });
});

describe('parseOptions — JSON-string input', () => {
  it('parses a 4-option JSON string, preserving count and order', () => {
    const raw = JSON.stringify(['Delhi', 'Mumbai', 'Kolkata', 'Chennai']);
    expect(parseOptions(raw)).toEqual(['Delhi', 'Mumbai', 'Kolkata', 'Chennai']);
  });

  it('returns [] for malformed JSON instead of throwing (all 7 originals)', () => {
    expect(parseOptions('not json at all')).toEqual([]);
    expect(parseOptions('["unterminated"')).toEqual([]);
    expect(parseOptions('')).toEqual([]);
  });

  it('parses a JSON string with Hindi (Devanagari) options intact', () => {
    const raw = JSON.stringify(['दिल्ली', 'मुंबई', 'कोलकाता', 'चेन्नई']);
    expect(parseOptions(raw)).toEqual(['दिल्ली', 'मुंबई', 'कोलकाता', 'चेन्नई']);
  });

  it('returns a valid-JSON non-array VERBATIM, exactly as all 7 originals did', () => {
    // Deliberate: shape validation belongs to the P6 gate in
    // question-validation.ts, NOT to this parser. Coercing these to [] here
    // would silently change how many options render.
    expect(parseOptions('"abc"') as unknown).toBe('abc');
    expect(parseOptions('5') as unknown).toBe(5);
    expect(parseOptions('null') as unknown).toBeNull();
    expect(parseOptions('{"a":1}') as unknown).toEqual({ a: 1 });
  });
});

describe('parseOptions — real array input', () => {
  it('returns a 4-option array with count and order untouched', () => {
    const arr = ['A one', 'B two', 'C three', 'D four'];
    expect(parseOptions(arr)).toEqual(['A one', 'B two', 'C three', 'D four']);
  });

  it('does not reorder, dedupe, trim or drop empty members', () => {
    // P6 says a served question has 4 distinct non-empty options. Enforcing
    // that is the validator's job — the parser must pass everything through
    // untouched so a violation is VISIBLE rather than silently patched.
    const arr = ['  padded  ', '', 'dup', 'dup'];
    expect(parseOptions(arr)).toEqual(['  padded  ', '', 'dup', 'dup']);
    expect(parseOptions(arr)).toHaveLength(4);
  });
});

describe('parseOptions — null / undefined', () => {
  it('returns [] for null', () => {
    // BEHAVIOURAL DIVERGENCE resolved here. Six of the seven originals fed
    // a non-string straight into JSON.parse; JSON.parse(null) does NOT throw
    // — it coerces to the literal string "null" and RETURNS null. Those six
    // therefore returned `null` from a function annotated `: string[]`, and
    // the caller's `.map()` threw a TypeError at render. Only /tutor's copy
    // guarded with `typeof opts === 'string'` and returned []. Unified on []:
    // null is out-of-contract for the six (their param type forbade it) and
    // in-contract for /tutor (practice_options is a nullable column).
    expect(parseOptions(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseOptions(undefined)).toEqual([]);
  });

  it('returns [] for other non-string, non-array values', () => {
    expect(parseOptions(42)).toEqual([]);
    expect(parseOptions({ a: 1 })).toEqual([]);
    expect(parseOptions(true)).toEqual([]);
  });
});

describe('parseOptions — empty array', () => {
  it('returns an empty array for an empty array', () => {
    expect(parseOptions([])).toEqual([]);
  });

  it('returns an empty array for an empty JSON array string', () => {
    expect(parseOptions('[]')).toEqual([]);
  });
});

describe('parseOptions — fewer or more than 4 options', () => {
  it('does not pad a short array up to 4', () => {
    expect(parseOptions(['only', 'two'])).toEqual(['only', 'two']);
    expect(parseOptions(['only', 'two'])).toHaveLength(2);
    expect(parseOptions('["a","b","c"]')).toHaveLength(3);
  });

  it('does not truncate a long array down to 4', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(parseOptions(six)).toEqual(six);
    expect(parseOptions(six)).toHaveLength(6);
    expect(parseOptions(JSON.stringify(six))).toHaveLength(6);
  });
});

describe('parseOptions — non-string members', () => {
  it('coerces non-string array members with String() (from the /tutor copy)', () => {
    // /tutor's parseOptions took `unknown` and did `.map(String)`. Dropping
    // the coercion would be a regression for two reasons: (1) the quiz, learn
    // and PracticeRunner render paths run `opt.replace(...)` on every member
    // ((student)/quiz/page.tsx:1972, (student)/learn/[subject]/[chapter]/
    // page.tsx:2083 and :2241, packages/ui/src/quiz/v2/PracticeRunner.tsx:254),
    // so a non-string member throws a TypeError at render; and (2) /tutor's
    // source column chapter_concepts.practice_options is nullable `unknown`
    // jsonb, so non-string members are genuinely possible there. (/tutor
    // itself renders {opt} directly as a React child and never calls
    // .replace() — tutor/page.tsx:342.)
    expect(parseOptions([1, 2, 3, 4])).toEqual(['1', '2', '3', '4']);
    expect(parseOptions(['a', 2, null, undefined])).toEqual(['a', '2', 'null', 'undefined']);
  });

  it('coercion is 1:1 and index-preserving — count and order are invariant', () => {
    const mixed = [10, 'b', true, 40];
    const out = parseOptions(mixed);
    expect(out).toHaveLength(mixed.length);
    expect(out).toEqual(['10', 'b', 'true', '40']);
  });

  it('leaves genuine string members byte-identical', () => {
    const arr = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'];
    expect(parseOptions(arr)).toEqual(arr);
  });

  it('does not coerce members that arrive via the JSON-string branch', () => {
    // The string branch returns JSON.parse's result verbatim (no .map), which
    // is what all seven originals did.
    expect(parseOptions('[1,2,3,4]') as unknown).toEqual([1, 2, 3, 4]);
  });
});

describe('parseOptions — marking-safety invariants', () => {
  it('never reorders options for either input shape', () => {
    const ordered = ['first', 'second', 'third', 'fourth'];
    expect(parseOptions(ordered)).toEqual(ordered);
    expect(parseOptions(JSON.stringify(ordered))).toEqual(ordered);
    // `selected_displayed_index` must still address the same option.
    expect(parseOptions(ordered)[2]).toBe('third');
    expect(parseOptions(JSON.stringify(ordered))[2]).toBe('third');
  });

  it('does not mutate the input array', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const copy = [...arr];
    parseOptions(arr);
    expect(arr).toEqual(copy);
  });
});
