/**
 * Foxy North-Star Phase 2 — foxy page mastery read re-point.
 *
 * Pins that the Foxy page's mastery read targets `topic_mastery_rollup`
 * (the fixed view contract) with an EXPLICIT column list — never the old
 * writerless `topic_mastery` table (always empty → every chapter chip
 * rendered 'not_started') and never `select('*')`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromCalls: string[] = [];
const selectCalls: string[] = [];
const eqCalls: Array<[string, string]> = [];
const orderCalls: Array<[string, unknown]> = [];
let rows: unknown[] | null = [];

vi.mock('@alfanumrik/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((cols: string) => { selectCalls.push(cols); return chain; });
  chain.eq = vi.fn((col: string, val: string) => { eqCalls.push([col, val]); return chain; });
  chain.order = vi.fn((col: string, opts: unknown) => { orderCalls.push([col, opts]); return chain; });
  chain.limit = vi.fn(async () => ({ data: rows, error: null }));
  return {
    supabase: {
      from: vi.fn((table: string) => { fromCalls.push(table); return chain; }),
    },
  };
});

import {
  fetchMastery,
  TOPIC_MASTERY_ROLLUP_COLUMNS,
} from '@/app/foxy/_lib/fetch-mastery';

beforeEach(() => {
  fromCalls.length = 0;
  selectCalls.length = 0;
  eqCalls.length = 0;
  orderCalls.length = 0;
  rows = [];
});

describe('foxy fetchMastery — topic_mastery_rollup re-point', () => {
  it('reads from topic_mastery_rollup, never the writerless topic_mastery table', async () => {
    await fetchMastery('student-1', 'science');
    expect(fromCalls).toEqual(['topic_mastery_rollup']);
  });

  it('selects the explicit view-contract columns (no select *)', async () => {
    await fetchMastery('student-1', 'science');
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]).toBe(TOPIC_MASTERY_ROLLUP_COLUMNS);
    expect(selectCalls[0]).not.toContain('*');
    // Every contract column is present.
    for (const col of [
      'student_id', 'subject', 'grade', 'topic_tag', 'chapter_number',
      'mastery_percent', 'mastery_level', 'mastery_probability', 'next_review_at',
    ]) {
      expect(selectCalls[0]).toContain(col);
    }
  });

  it('filters by student_id + subject and orders by chapter_number (view has no updated_at)', async () => {
    await fetchMastery('student-1', 'math');
    expect(eqCalls).toEqual([
      ['student_id', 'student-1'],
      ['subject', 'math'],
    ]);
    expect(orderCalls).toEqual([['chapter_number', { ascending: true }]]);
  });

  it('returns rows with the fields downstream chips read (topic_tag / mastery_level / mastery_percent)', async () => {
    rows = [{
      student_id: 'student-1', subject: 'science', grade: '9',
      topic_tag: 'Light', chapter_number: 10,
      mastery_percent: 72, mastery_level: 'proficient',
      mastery_probability: 0.72, next_review_at: null,
    }];
    const result = await fetchMastery('student-1', 'science');
    expect(result).toHaveLength(1);
    expect(result[0].topic_tag).toBe('Light');
    expect(result[0].mastery_level).toBe('proficient');
    expect(result[0].mastery_percent).toBe(72);
  });

  it('degrades to [] when the view returns null', async () => {
    rows = null;
    await expect(fetchMastery('student-1', 'science')).resolves.toEqual([]);
  });
});
