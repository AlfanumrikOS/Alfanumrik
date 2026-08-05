/**
 * D9/E (Foxy North-Star Phase 2 wave 2b) — implicit format-preference
 * aggregation rule. Pins the full contract:
 *   28-day window, >=10-turn evidence floor, strict-majority FORMAT (ties →
 *   null), closed-enum filtering, and the documented format → learning_style
 *   mapping (paragraph/steps → verbal, example → example-first,
 *   diagram → visual, practice → balanced).
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateFormatPreference,
  FORMAT_TO_LEARNING_STYLE,
  PREFERENCE_MIN_TURNS,
  PREFERENCE_WINDOW_DAYS,
  type FormatTurn,
} from '@alfanumrik/lib/learner-model';

const NOW = Date.parse('2026-08-05T00:00:00.000Z');
const DAY = 86_400_000;

function turns(format: string, n: number, ageDays = 1): FormatTurn[] {
  return Array.from({ length: n }, () => ({
    format,
    at: new Date(NOW - ageDays * DAY).toISOString(),
  }));
}

describe('aggregateFormatPreference — D9 implicit preference rule', () => {
  it('exports the pinned contract constants', () => {
    expect(PREFERENCE_WINDOW_DAYS).toBe(28);
    expect(PREFERENCE_MIN_TURNS).toBe(10);
  });

  it('pins the documented format → learning_style mapping', () => {
    expect(FORMAT_TO_LEARNING_STYLE).toEqual({
      paragraph: 'verbal',
      steps: 'verbal',
      example: 'example-first',
      diagram: 'visual',
      practice: 'balanced',
    });
  });

  it('returns the mapped style for a clear majority with enough turns', () => {
    const input = [...turns('diagram', 8), ...turns('paragraph', 4)];
    expect(aggregateFormatPreference(input, { nowMs: NOW })).toBe('visual');
  });

  it('maps every format through the documented mapping', () => {
    for (const [format, style] of Object.entries(FORMAT_TO_LEARNING_STYLE)) {
      expect(aggregateFormatPreference(turns(format, 12), { nowMs: NOW })).toBe(style);
    }
  });

  it('output values stay within the 4-value settings-pill enum (steps collapse is intentional)', () => {
    // Assessment-reviewed rationale (Phase 2, 2026-08-05): steps vs paragraph
    // is deliberately collapsed to 'verbal' to preserve enum coherence with
    // the student-facing settings pills. This pins that the mapping's value
    // set is EXACTLY the 4-value contract enum — a 5th style token (e.g. a
    // procedural/steps style) must arrive via a UI+writer+consumer change in
    // one PR, and this test is the tripwire for a map-only drift.
    const values = new Set(Object.values(FORMAT_TO_LEARNING_STYLE));
    expect([...values].sort()).toEqual(['balanced', 'example-first', 'verbal', 'visual']);
  });

  it('returns null below the 10-turn evidence floor', () => {
    expect(aggregateFormatPreference(turns('diagram', 9), { nowMs: NOW })).toBeNull();
  });

  it('counts exactly-at-floor evidence (10 turns)', () => {
    expect(aggregateFormatPreference(turns('practice', 10), { nowMs: NOW })).toBe('balanced');
  });

  it('ignores turns older than the 28-day window (and future-dated turns)', () => {
    const input = [
      ...turns('diagram', 20, 29), // outside window — must not count
      ...turns('example', 9, 2), // inside, but alone below the floor
      { format: 'example', at: new Date(NOW + DAY).toISOString() }, // future — dropped
    ];
    expect(aggregateFormatPreference(input, { nowMs: NOW })).toBeNull();
  });

  it('majority is over FORMATS, not mapped styles (paragraph+steps counted separately)', () => {
    // verbal-mapped total is 11 (6 paragraph + 5 steps) but the single
    // majority FORMAT is example (8) — contract says majority format wins.
    const input = [...turns('paragraph', 6), ...turns('steps', 5), ...turns('example', 8)];
    expect(aggregateFormatPreference(input, { nowMs: NOW })).toBe('example-first');
  });

  it('a tie for the top format returns null (ambiguous signal never writes)', () => {
    const input = [...turns('diagram', 7), ...turns('example', 7)];
    expect(aggregateFormatPreference(input, { nowMs: NOW })).toBeNull();
  });

  it('drops unknown format labels before counting (closed enum only)', () => {
    const input = [...turns('astrology', 50), ...turns('diagram', 9)];
    expect(aggregateFormatPreference(input, { nowMs: NOW })).toBeNull();
    const enough = [...turns('astrology', 50), ...turns('diagram', 10)];
    expect(aggregateFormatPreference(enough, { nowMs: NOW })).toBe('visual');
  });

  it('tolerates malformed rows (null format / unparseable dates)', () => {
    const input: FormatTurn[] = [
      { format: 'diagram', at: 'not-a-date' },
      { format: null as unknown as string, at: new Date(NOW - DAY) },
      ...turns('steps', 10),
    ];
    expect(aggregateFormatPreference(input, { nowMs: NOW })).toBe('verbal');
  });

  it('returns null on empty input', () => {
    expect(aggregateFormatPreference([], { nowMs: NOW })).toBeNull();
  });

  it('honors option overrides (windowDays / minTurns)', () => {
    const old = turns('diagram', 5, 40);
    expect(aggregateFormatPreference(old, { nowMs: NOW, windowDays: 60, minTurns: 5 })).toBe('visual');
  });
});
