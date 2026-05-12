/**
 * Tests for the pure helpers powering /api/v1/leaderboard/mastery.
 * The route's two Supabase reads are not tested here (heavy mocking);
 * the aggregation + merge + ranking are the load-bearing logic.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateMastery,
  buildLeaderboardItems,
} from '../../app/api/v1/leaderboard/mastery/route';

const STUDENT_A = {
  id: 'sa', auth_user_id: 'ua', name: 'Aanya', grade: '8',
  school_name: 'St. Mary', avatar_url: null,
};
const STUDENT_B = {
  id: 'sb', auth_user_id: 'ub', name: 'Vihaan', grade: '8',
  school_name: 'St. Mary', avatar_url: 'b.png',
};
const STUDENT_C = {
  id: 'sc', auth_user_id: 'uc', name: 'Diya', grade: '8',
  school_name: null, avatar_url: null,
};

describe('aggregateMastery', () => {
  it('computes mean across multiple rows per learner', () => {
    const rows = [
      { auth_user_id: 'ua', mastery: 0.6 },
      { auth_user_id: 'ua', mastery: 0.8 },
      { auth_user_id: 'ua', mastery: 0.4 },
    ];
    const agg = aggregateMastery(rows, 3);
    expect(agg.get('ua')).toEqual({ mean: 0.6, count: 3 });
  });

  it('filters out learners below minChapters', () => {
    const rows = [
      { auth_user_id: 'ua', mastery: 0.9 },
      { auth_user_id: 'ua', mastery: 0.9 }, // ua: 2 chapters
      { auth_user_id: 'ub', mastery: 0.5 },
      { auth_user_id: 'ub', mastery: 0.5 },
      { auth_user_id: 'ub', mastery: 0.5 }, // ub: 3 chapters
    ];
    const agg = aggregateMastery(rows, 3);
    expect(agg.has('ua')).toBe(false);
    expect(agg.has('ub')).toBe(true);
  });

  it('ignores null/NaN mastery rows', () => {
    const rows = [
      { auth_user_id: 'ua', mastery: 0.5 },
      { auth_user_id: 'ua', mastery: NaN },
      { auth_user_id: 'ua', mastery: null as unknown as number },
      { auth_user_id: 'ua', mastery: 0.7 },
      { auth_user_id: 'ua', mastery: 0.6 },
    ];
    const agg = aggregateMastery(rows, 3);
    // Three valid rows: 0.5, 0.7, 0.6 → mean 0.6, count 3
    expect(agg.get('ua')).toEqual({ mean: 0.6, count: 3 });
  });

  it('handles empty input', () => {
    expect(aggregateMastery([], 3).size).toBe(0);
  });
});

describe('buildLeaderboardItems', () => {
  it('orders by mean DESC, ranks from 1', () => {
    const agg = new Map([
      ['ua', { mean: 0.6, count: 5 }],
      ['ub', { mean: 0.9, count: 5 }],
      ['uc', { mean: 0.4, count: 5 }],
    ]);
    const items = buildLeaderboardItems(agg, [STUDENT_A, STUDENT_B, STUDENT_C], 10);
    expect(items.map(i => i.student_id)).toEqual(['sb', 'sa', 'sc']);
    expect(items.map(i => i.rank)).toEqual([1, 2, 3]);
  });

  it('tie-breaks by chapters_counted DESC (more data wins)', () => {
    const agg = new Map([
      ['ua', { mean: 0.7, count: 3 }],
      ['ub', { mean: 0.7, count: 10 }],
    ]);
    const items = buildLeaderboardItems(agg, [STUDENT_A, STUDENT_B], 10);
    expect(items[0].student_id).toBe('sb'); // 10 chapters ahead of 3
  });

  it('skips aggregated learners with no matching student row (filtered upstream)', () => {
    const agg = new Map([
      ['ua', { mean: 0.6, count: 5 }],
      ['unknown_uid', { mean: 0.9, count: 5 }],
    ]);
    const items = buildLeaderboardItems(agg, [STUDENT_A], 10);
    expect(items).toHaveLength(1);
    expect(items[0].student_id).toBe('sa');
  });

  it('caps at limit', () => {
    const agg = new Map([
      ['ua', { mean: 0.6, count: 5 }],
      ['ub', { mean: 0.7, count: 5 }],
      ['uc', { mean: 0.8, count: 5 }],
    ]);
    const items = buildLeaderboardItems(agg, [STUDENT_A, STUDENT_B, STUDENT_C], 2);
    expect(items).toHaveLength(2);
    expect(items[0].student_id).toBe('sc'); // mean 0.8
    expect(items[1].student_id).toBe('sb'); // mean 0.7
  });

  it('returns the right shape per row', () => {
    const agg = new Map([['ua', { mean: 0.6, count: 5 }]]);
    const items = buildLeaderboardItems(agg, [STUDENT_A], 10);
    expect(items[0]).toEqual({
      rank: 1,
      student_id: 'sa',
      name: 'Aanya',
      grade: '8',
      school: 'St. Mary',
      avatar_url: null,
      mean_mastery: 0.6,
      chapters_counted: 5,
    });
  });

  it('empty inputs produce empty output', () => {
    expect(buildLeaderboardItems(new Map(), [], 10)).toEqual([]);
    expect(buildLeaderboardItems(new Map(), [STUDENT_A], 10)).toEqual([]);
  });
});
