/**
 * Tests for the Atlas zero-state chapter builder.
 *
 * The component-level integration (fetching from Supabase, threading
 * through `setChapters`) is exercised indirectly via the dashboard;
 * here we pin the pure transform so it stays deterministic.
 */

import { describe, it, expect } from 'vitest';
import { chaptersFromCurriculum } from './atlas-chapters';

describe('chaptersFromCurriculum', () => {
  it('returns [] for empty input', () => {
    expect(chaptersFromCurriculum([])).toEqual([]);
  });

  it('marks the first chapter as current and the rest as upcoming', () => {
    const out = chaptersFromCurriculum([
      { chapter_number: 1, title: 'Number Systems' },
      { chapter_number: 2, title: 'Polynomials' },
      { chapter_number: 3, title: 'Coordinate Geometry' },
    ]);
    expect(out).toEqual([
      { number: 1, title: 'Number Systems',      status: 'current'  },
      { number: 2, title: 'Polynomials',         status: 'upcoming' },
      { number: 3, title: 'Coordinate Geometry', status: 'upcoming' },
    ]);
  });

  it('sorts ascending by chapter_number regardless of input order', () => {
    const out = chaptersFromCurriculum([
      { chapter_number: 3, title: 'Three' },
      { chapter_number: 1, title: 'One' },
      { chapter_number: 2, title: 'Two' },
    ]);
    expect(out.map(c => c.number)).toEqual([1, 2, 3]);
    expect(out[0].status).toBe('current');
  });

  it('dedupes by chapter_number, keeping the first title encountered', () => {
    const out = chaptersFromCurriculum([
      { chapter_number: 1, title: 'Number Systems' },
      { chapter_number: 1, title: 'Number Systems — variant title' },
      { chapter_number: 2, title: 'Polynomials' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ number: 1, title: 'Number Systems', status: 'current' });
  });

  it('caps the window at 6 chapters', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      chapter_number: i + 1,
      title: `Chapter ${i + 1}`,
    }));
    const out = chaptersFromCurriculum(rows);
    expect(out).toHaveLength(6);
    expect(out.map(c => c.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('skips rows with missing chapter_number or title', () => {
    const out = chaptersFromCurriculum([
      { chapter_number: 1, title: 'One' },
      { chapter_number: null, title: 'Has no number' },
      { chapter_number: 2, title: null },
      { chapter_number: 3, title: 'Three' },
    ]);
    expect(out.map(c => c.number)).toEqual([1, 3]);
  });

  it('never emits status=mastered (zero-state path is cold-start only)', () => {
    const out = chaptersFromCurriculum([
      { chapter_number: 1, title: 'One' },
      { chapter_number: 2, title: 'Two' },
    ]);
    expect(out.find(c => c.status === 'mastered')).toBeUndefined();
  });
});
