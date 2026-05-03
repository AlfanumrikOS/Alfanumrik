/**
 * Tests for src/lib/goals/rag-source-weights.ts
 *
 * Pins the per-goal source-weight matrix and the rerank ordering contract.
 */
import { describe, it, expect } from 'vitest';
import {
  getRagSourceWeight,
  applyGoalRerank,
  type ChunkRankMetadata,
} from '@/lib/goals/rag-source-weights';
import type { GoalCode } from '@/lib/goals/goal-profile';

const ALL_GOALS: GoalCode[] = [
  'improve_basics',
  'pass_comfortably',
  'school_topper',
  'board_topper',
  'competitive_exam',
  'olympiad',
];

describe('getRagSourceWeight: null/empty handling', () => {
  it('returns 1.0 (neutral) for null goal', () => {
    expect(getRagSourceWeight(null, { source: 'pyq' })).toBe(1.0);
  });

  it('returns 1.0 (neutral) for undefined goal', () => {
    expect(getRagSourceWeight(undefined, { source: 'jee_archive' })).toBe(1.0);
  });

  it('returns 1.0 when no metadata provided', () => {
    expect(getRagSourceWeight('board_topper', {})).toBe(1.0);
  });

  it('returns 1.0 when source and examRelevance are both null', () => {
    expect(
      getRagSourceWeight('board_topper', { source: null, examRelevance: null }),
    ).toBe(1.0);
  });
});

describe('getRagSourceWeight: board_topper boosts PYQ + CBSE_BOARD', () => {
  it('PYQ source gets 1.5x boost', () => {
    expect(getRagSourceWeight('board_topper', { source: 'pyq' })).toBe(1.5);
  });

  it('board_paper source gets 1.5x boost', () => {
    expect(getRagSourceWeight('board_topper', { source: 'board_paper_2024' })).toBe(1.5);
  });

  it('CBSE_BOARD tag (without PYQ source) gets 1.35x boost', () => {
    expect(
      getRagSourceWeight('board_topper', { examRelevance: ['CBSE_BOARD'] }),
    ).toBe(1.35);
  });

  it('plain NCERT chunk stays at 1.0', () => {
    expect(getRagSourceWeight('board_topper', { source: 'ncert_2025' })).toBe(1.0);
  });
});

describe('getRagSourceWeight: competitive_exam boosts JEE/NEET, demotes NCERT', () => {
  it('jee_archive source gets 1.5x boost', () => {
    expect(getRagSourceWeight('competitive_exam', { source: 'jee_archive_2023' })).toBe(1.5);
  });

  it('neet_archive source gets 1.5x boost', () => {
    expect(getRagSourceWeight('competitive_exam', { source: 'neet_archive_2024' })).toBe(1.5);
  });

  it('JEE tag without archive source gets 1.35x boost', () => {
    expect(
      getRagSourceWeight('competitive_exam', { examRelevance: ['JEE'] }),
    ).toBe(1.35);
  });

  it('plain NCERT chunk gets DOWNweighted to 0.9', () => {
    expect(getRagSourceWeight('competitive_exam', { source: 'ncert_2025' })).toBe(0.9);
  });
});

describe('getRagSourceWeight: olympiad strongly boosts olympiad sources', () => {
  it('olympiad source gets 1.6x boost', () => {
    expect(getRagSourceWeight('olympiad', { source: 'olympiad_archive' })).toBe(1.6);
  });

  it('OLYMPIAD tag gets 1.4x boost', () => {
    expect(
      getRagSourceWeight('olympiad', { examRelevance: ['OLYMPIAD'] }),
    ).toBe(1.4);
  });

  it('plain NCERT downweighted to 0.8 (strongest demotion)', () => {
    expect(getRagSourceWeight('olympiad', { source: 'ncert_2025' })).toBe(0.8);
  });
});

describe('getRagSourceWeight: improve_basics demotes archive content', () => {
  it('JEE source gets DOWNweighted to 0.6', () => {
    expect(getRagSourceWeight('improve_basics', { source: 'jee_archive' })).toBe(0.6);
  });

  it('OLYMPIAD tag gets DOWNweighted to 0.7', () => {
    expect(
      getRagSourceWeight('improve_basics', { examRelevance: ['OLYMPIAD'] }),
    ).toBe(0.7);
  });

  it('NCERT stays at 1.0 (foundation is the substrate)', () => {
    expect(getRagSourceWeight('improve_basics', { source: 'ncert_2025' })).toBe(1.0);
  });
});

describe('getRagSourceWeight: case-insensitive matching', () => {
  it('source matches case-insensitively (PYQ vs pyq vs Pyq)', () => {
    expect(getRagSourceWeight('board_topper', { source: 'PYQ' })).toBe(1.5);
    expect(getRagSourceWeight('board_topper', { source: 'Pyq_2024' })).toBe(1.5);
  });

  it('examRelevance matches case-insensitively', () => {
    expect(getRagSourceWeight('competitive_exam', { examRelevance: ['jee'] })).toBe(1.35);
    expect(getRagSourceWeight('olympiad', { examRelevance: ['olympiad'] })).toBe(1.4);
  });
});

describe('applyGoalRerank: ordering contract', () => {
  type TestChunk = ChunkRankMetadata & { similarity: number; id: string };

  it('returns a NEW array (does not mutate input)', () => {
    const input: TestChunk[] = [
      { id: 'a', similarity: 0.8, source: 'ncert_2025' },
      { id: 'b', similarity: 0.7, source: 'pyq' },
    ];
    const out = applyGoalRerank(input, 'board_topper');
    expect(out).not.toBe(input);
    expect(input.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('null goal returns chunks in original order', () => {
    const input: TestChunk[] = [
      { id: 'a', similarity: 0.8 },
      { id: 'b', similarity: 0.7 },
      { id: 'c', similarity: 0.6 },
    ];
    const out = applyGoalRerank(input, null);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('board_topper boosts a PYQ chunk above an NCERT chunk with higher raw similarity', () => {
    const input: TestChunk[] = [
      { id: 'ncert_high',  similarity: 0.85, source: 'ncert_2025' }, // 0.85 * 1.0 = 0.850
      { id: 'pyq_lower',   similarity: 0.60, source: 'pyq' },        // 0.60 * 1.5 = 0.900 (winner)
    ];
    const out = applyGoalRerank(input, 'board_topper');
    expect(out[0].id).toBe('pyq_lower');
    expect(out[1].id).toBe('ncert_high');
  });

  it('olympiad boosts an olympiad chunk to top even with lower similarity', () => {
    const input: TestChunk[] = [
      { id: 'ncert_high', similarity: 0.90, source: 'ncert_2025' },     // 0.90 * 0.8 = 0.720
      { id: 'olympiad',   similarity: 0.50, source: 'olympiad_pack' },  // 0.50 * 1.6 = 0.800 (winner)
    ];
    const out = applyGoalRerank(input, 'olympiad');
    expect(out[0].id).toBe('olympiad');
  });

  it('competitive_exam demotes NCERT chunks (JEE archive wins even at lower similarity)', () => {
    const input: TestChunk[] = [
      { id: 'ncert_high', similarity: 0.85, source: 'ncert_2025' }, // 0.85 * 0.9 = 0.765
      { id: 'jee_lower',  similarity: 0.55, source: 'jee_archive' }, // 0.55 * 1.5 = 0.825 (winner)
    ];
    const out = applyGoalRerank(input, 'competitive_exam');
    expect(out[0].id).toBe('jee_lower');
  });

  it('preserves input length', () => {
    const input = Array.from({ length: 10 }, (_, i) => ({
      id: 'c' + i,
      similarity: Math.random(),
      source: i % 2 === 0 ? 'pyq' : 'ncert_2025',
    }));
    const out = applyGoalRerank(input, 'board_topper');
    expect(out.length).toBe(input.length);
  });

  it('all 6 goals: rerank is stable (deterministic)', () => {
    const goals: GoalCode[] = ['improve_basics', 'pass_comfortably', 'school_topper', 'board_topper', 'competitive_exam', 'olympiad'];
    for (const g of goals) {
      const input = [
        { id: 'a', similarity: 0.8, source: 'ncert_2025' },
        { id: 'b', similarity: 0.7, source: 'pyq' },
        { id: 'c', similarity: 0.6, source: 'jee_archive' },
      ];
      const out1 = applyGoalRerank(input, g);
      const out2 = applyGoalRerank(input, g);
      expect(out1.map((c) => c.id)).toEqual(out2.map((c) => c.id));
    }
  });
});
