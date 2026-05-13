/**
 * Tests for `buildAtlasChapters` — the single helper that drives the
 * Atlas chapter graph across the student's whole journey.
 *
 * Pins the four progress states + windowing rules + sundry edge cases.
 */

import { describe, it, expect } from 'vitest';
import { buildAtlasChapters } from './atlas-chapters';

const g9Math = [
  { chapter_number: 1, title: 'Number Systems' },
  { chapter_number: 2, title: 'Polynomials' },
  { chapter_number: 3, title: 'Coordinate Geometry' },
  { chapter_number: 4, title: 'Linear Equations' },
  { chapter_number: 5, title: "Euclid's Geometry" },
  { chapter_number: 6, title: 'Lines and Angles' },
];

describe('buildAtlasChapters', () => {
  describe('cold start (no mastery rows)', () => {
    it('returns first 6 chapters with first=current, rest=upcoming', () => {
      const out = buildAtlasChapters(g9Math, []);
      expect(out).toEqual([
        { number: 1, title: 'Number Systems',      status: 'current'  },
        { number: 2, title: 'Polynomials',         status: 'upcoming' },
        { number: 3, title: 'Coordinate Geometry', status: 'upcoming' },
        { number: 4, title: 'Linear Equations',    status: 'upcoming' },
        { number: 5, title: "Euclid's Geometry",   status: 'upcoming' },
        { number: 6, title: 'Lines and Angles',    status: 'upcoming' },
      ]);
    });

    it('returns [] when curriculum is empty', () => {
      expect(buildAtlasChapters([], [])).toEqual([]);
    });
  });

  describe('partial progress', () => {
    it('mastered chapters reflected, first non-mastered is current', () => {
      const out = buildAtlasChapters(g9Math, [
        { chapter_number: 1, mastery_probability: 0.85 },
        { chapter_number: 2, mastery_probability: 0.80 },
      ]);
      // window: half=3 (window=6), current=3, so chapters 1..6 all included.
      expect(out).toEqual([
        { number: 1, title: 'Number Systems',      status: 'mastered' },
        { number: 2, title: 'Polynomials',         status: 'mastered' },
        { number: 3, title: 'Coordinate Geometry', status: 'current'  },
        { number: 4, title: 'Linear Equations',    status: 'upcoming' },
        { number: 5, title: "Euclid's Geometry",   status: 'upcoming' },
        { number: 6, title: 'Lines and Angles',    status: 'upcoming' },
      ]);
    });

    it('progresses as more chapters are mastered', () => {
      // Student progresses: after mastering 1,2,3 → current shifts to 4.
      const mastery = [1, 2, 3].map((n) => ({ chapter_number: n, mastery_probability: 0.9 }));
      const out = buildAtlasChapters(g9Math, mastery);
      const current = out.find((c) => c.status === 'current');
      expect(current?.number).toBe(4);
      expect(out.filter((c) => c.status === 'mastered').map((c) => c.number)).toEqual([1, 2, 3]);
    });
  });

  describe('all mastered', () => {
    it('all visible chapters render as mastered (celebration state, no current anchor)', () => {
      // When every chapter is at or above threshold, the `>= threshold` arm of
      // the status assignment wins for every node — there is no `current`.
      // The SVG renders all-green; legend "Mastered · 6" matches the visible
      // count. Matches the legacy (pre-unification) behaviour for completeness.
      const mastery = g9Math.map((c) => ({
        chapter_number: c.chapter_number,
        mastery_probability: 0.95,
      }));
      const out = buildAtlasChapters(g9Math, mastery);
      expect(out.every((c) => c.status === 'mastered')).toBe(true);
      expect(out.find((c) => c.status === 'current')).toBeUndefined();
      expect(out.find((c) => c.status === 'upcoming')).toBeUndefined();
    });
  });

  describe('windowing', () => {
    it('cold start window is the first `windowSize` chapters', () => {
      const curriculum = Array.from({ length: 12 }, (_, i) => ({
        chapter_number: i + 1,
        title: `Ch${i + 1}`,
      }));
      const out = buildAtlasChapters(curriculum, [], { window: 6 });
      expect(out.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('progress window centers around the current chapter', () => {
      const curriculum = Array.from({ length: 12 }, (_, i) => ({
        chapter_number: i + 1,
        title: `Ch${i + 1}`,
      }));
      // Mastered 1-5; current = 6. Window of 6 around 6 → ±3 = {3,4,5,6,7,8}.
      const mastery = [1, 2, 3, 4, 5].map((n) => ({
        chapter_number: n,
        mastery_probability: 0.9,
      }));
      const out = buildAtlasChapters(curriculum, mastery, { window: 6 });
      expect(out.map((c) => c.number)).toEqual([3, 4, 5, 6, 7, 8]);
      expect(out.find((c) => c.number === 6)?.status).toBe('current');
    });

    it('respects custom window size', () => {
      const out = buildAtlasChapters(g9Math, [], { window: 3 });
      expect(out.map((c) => c.number)).toEqual([1, 2, 3]);
    });
  });

  describe('aggregation', () => {
    it('averages multiple concept-level rows into a chapter-level mastery', () => {
      // Chapter 1: three concepts averaging 0.5 → upcoming (below 0.7).
      // Chapter 2: two concepts averaging 0.9 → mastered.
      const out = buildAtlasChapters(g9Math.slice(0, 2), [
        { chapter_number: 1, mastery_probability: 0.5 },
        { chapter_number: 1, mastery_probability: 0.5 },
        { chapter_number: 1, mastery_probability: 0.5 },
        { chapter_number: 2, mastery_probability: 0.9 },
        { chapter_number: 2, mastery_probability: 0.9 },
      ]);
      expect(out[0].status).toBe('current');  // chapter 1 below threshold
      expect(out[1].status).toBe('mastered'); // chapter 2 above
    });

    it('honors a custom masteryThreshold', () => {
      // 0.6 average should NOT be mastered at threshold 0.7,
      // but IS mastered at threshold 0.5.
      const mastery = [{ chapter_number: 1, mastery_probability: 0.6 }];
      const strict = buildAtlasChapters(g9Math.slice(0, 2), mastery, { masteryThreshold: 0.7 });
      const lenient = buildAtlasChapters(g9Math.slice(0, 2), mastery, { masteryThreshold: 0.5 });
      expect(strict[0].status).toBe('current');
      expect(lenient[0].status).toBe('mastered');
    });
  });

  describe('input hygiene', () => {
    it('skips curriculum rows with missing chapter_number or title', () => {
      const out = buildAtlasChapters(
        [
          { chapter_number: 1, title: 'One' },
          { chapter_number: null, title: 'No number' },
          { chapter_number: 2, title: null },
          { chapter_number: 3, title: 'Three' },
        ],
        [],
      );
      expect(out.map((c) => c.number)).toEqual([1, 3]);
    });

    it('skips mastery rows with missing fields and dedupes curriculum by chapter_number', () => {
      const out = buildAtlasChapters(
        [
          { chapter_number: 1, title: 'One' },
          { chapter_number: 1, title: 'One — duplicate (ignored)' },
          { chapter_number: 2, title: 'Two' },
        ],
        [
          { chapter_number: 1, mastery_probability: 0.9 },
          { chapter_number: null, mastery_probability: 0.5 },
          { chapter_number: 2, mastery_probability: null },
        ],
      );
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ number: 1, title: 'One', status: 'mastered' });
      // Chapter 2 has no usable mastery → current (first non-mastered).
      expect(out[1]).toEqual({ number: 2, title: 'Two', status: 'current' });
    });

    it('sorts curriculum ascending by chapter_number regardless of input order', () => {
      const out = buildAtlasChapters(
        [
          { chapter_number: 3, title: 'Three' },
          { chapter_number: 1, title: 'One' },
          { chapter_number: 2, title: 'Two' },
        ],
        [],
      );
      expect(out.map((c) => c.number)).toEqual([1, 2, 3]);
    });
  });
});
