import { describe, it, expect } from 'vitest';
import {
  composeSynthesisBundle,
  monthBoundariesOf,
  type SynthesisBundle,
} from '../learn/monthly-synthesis-orchestrator';

describe('monthBoundariesOf', () => {
  it('returns first-of-month UTC start, first-of-next-month UTC end', () => {
    const b = monthBoundariesOf(new Date('2026-04-15T08:30:00Z'));
    expect(b.startIso).toBe('2026-04-01T00:00:00.000Z');
    expect(b.endIso).toBe('2026-05-01T00:00:00.000Z');
    expect(b.monthLabel).toBe('2026-04');
  });

  it('handles end-of-year rollover (December → January)', () => {
    const b = monthBoundariesOf(new Date('2026-12-15T12:00:00Z'));
    expect(b.startIso).toBe('2026-12-01T00:00:00.000Z');
    expect(b.endIso).toBe('2027-01-01T00:00:00.000Z');
    expect(b.monthLabel).toBe('2026-12');
  });

  it('handles February in a non-leap year', () => {
    const b = monthBoundariesOf(new Date('2027-02-15T12:00:00Z'));
    expect(b.startIso).toBe('2027-02-01T00:00:00.000Z');
    expect(b.endIso).toBe('2027-03-01T00:00:00.000Z');
    expect(b.monthLabel).toBe('2027-02');
  });

  it('zero-pads single-digit months', () => {
    const b = monthBoundariesOf(new Date('2026-01-15T12:00:00Z'));
    expect(b.monthLabel).toBe('2026-01');
  });

  it('treats UTC date even when local timezone is far from UTC', () => {
    // Late-night Pacific time on Mar 31 is already Apr 1 UTC.
    const b = monthBoundariesOf(new Date('2026-04-01T03:30:00Z'));
    expect(b.monthLabel).toBe('2026-04');
  });
});

describe('composeSynthesisBundle', () => {
  const baseBoundaries = monthBoundariesOf(new Date('2026-04-15T08:00:00Z'));

  it('emits monthLabel from the boundary', () => {
    const bundle = composeSynthesisBundle({
      monthBoundaries: baseBoundaries,
      weeklyArtifactIds: [],
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      chapterMockSummary: null,
    });
    expect(bundle.monthLabel).toBe('2026-04');
  });

  it('preserves the weekly artifact ids in input order', () => {
    const ids = ['a-id', 'b-id', 'c-id', 'd-id'];
    const bundle = composeSynthesisBundle({
      monthBoundaries: baseBoundaries,
      weeklyArtifactIds: ids,
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      chapterMockSummary: null,
    });
    expect(bundle.weeklyArtifactIds).toEqual(ids);
  });

  it('passes mastery delta through verbatim (P11: no fabrication, exact numbers)', () => {
    const md: SynthesisBundle['masteryDelta'] = {
      chaptersTouched: ['Photosynthesis', 'Light - Reflection and Refraction'],
      topicsMastered: 5,
      topicsImproved: 12,
      topicsRegressed: 1,
    };
    const bundle = composeSynthesisBundle({
      monthBoundaries: baseBoundaries,
      weeklyArtifactIds: [],
      masteryDelta: md,
      chapterMockSummary: null,
    });
    expect(bundle.masteryDelta).toEqual(md);
  });

  it('passes chapter mock summary through verbatim when present', () => {
    const cms: SynthesisBundle['chapterMockSummary'] = {
      chapters: ['Light', 'Magnetic Effects of Current'],
      totalQuestions: 20,
      targetDifficulty: 0.55,
    };
    const bundle = composeSynthesisBundle({
      monthBoundaries: baseBoundaries,
      weeklyArtifactIds: [],
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      chapterMockSummary: cms,
    });
    expect(bundle.chapterMockSummary).toEqual(cms);
  });

  it('allows null chapter mock summary (e.g., student did not touch any chapters)', () => {
    const bundle = composeSynthesisBundle({
      monthBoundaries: baseBoundaries,
      weeklyArtifactIds: [],
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      chapterMockSummary: null,
    });
    expect(bundle.chapterMockSummary).toBeNull();
  });

  it('handles a fully-empty month (no artifacts, no mastery moves)', () => {
    const bundle = composeSynthesisBundle({
      monthBoundaries: baseBoundaries,
      weeklyArtifactIds: [],
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      chapterMockSummary: null,
    });
    expect(bundle.weeklyArtifactIds).toEqual([]);
    expect(bundle.masteryDelta.topicsImproved).toBe(0);
    expect(bundle.chapterMockSummary).toBeNull();
  });

  it('does not mutate the input arrays', () => {
    const ids = ['x'];
    const md = { chaptersTouched: ['Light'], topicsMastered: 1, topicsImproved: 2, topicsRegressed: 0 };
    composeSynthesisBundle({
      monthBoundaries: baseBoundaries,
      weeklyArtifactIds: ids,
      masteryDelta: md,
      chapterMockSummary: null,
    });
    expect(ids).toEqual(['x']);
    expect(md.chaptersTouched).toEqual(['Light']);
  });
});
