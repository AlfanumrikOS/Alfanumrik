import { describe, it, expect } from 'vitest';

/**
 * Quiz Generator Logic Tests
 *
 * These test the pure functions extracted from supabase/functions/quiz-generator/index.ts.
 * We replicate the exact logic here since the Edge Function uses Deno imports
 * that cannot be imported into a Vitest (Node) environment.
 */

// ─── Replicated pure functions from quiz-generator/index.ts ─────────────

const BLOOM_LEVELS_ORDERED = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

function masteryToDifficulty(mastery: number): number {
  if (mastery < 0.3) return 1;
  if (mastery < 0.65) return 2;
  return 3;
}

function masteryToMinBloomLevel(mastery: number): string {
  if (mastery < 0.3) return 'remember';
  if (mastery < 0.5) return 'understand';
  if (mastery < 0.7) return 'apply';
  if (mastery < 0.85) return 'analyze';
  return 'evaluate';
}

function getBloomLevelsAtOrAbove(minLevel: string): string[] {
  const idx = BLOOM_LEVELS_ORDERED.indexOf(minLevel);
  if (idx < 0) return BLOOM_LEVELS_ORDERED;
  return BLOOM_LEVELS_ORDERED.slice(idx);
}

interface QuestionRow {
  id: string;
  topic_id: string | null;
  [key: string]: unknown;
}

function deduplicateAdjacentTopics(questions: QuestionRow[]): QuestionRow[] {
  const result = [...questions];
  for (let i = 1; i < result.length; i++) {
    if (result[i].topic_id && result[i].topic_id === result[i - 1].topic_id) {
      for (let j = i + 1; j < result.length; j++) {
        if (result[j].topic_id !== result[i - 1].topic_id) {
          [result[i], result[j]] = [result[j], result[i]];
          break;
        }
      }
    }
  }
  return result;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Quiz Generator Logic', () => {

  describe('masteryToDifficulty', () => {
    it('maps mastery < 0.3 to easy (1)', () => {
      expect(masteryToDifficulty(0)).toBe(1);
      expect(masteryToDifficulty(0.1)).toBe(1);
      expect(masteryToDifficulty(0.29)).toBe(1);
    });

    it('maps mastery < 0.65 to medium (2)', () => {
      expect(masteryToDifficulty(0.3)).toBe(2);
      expect(masteryToDifficulty(0.5)).toBe(2);
      expect(masteryToDifficulty(0.64)).toBe(2);
    });

    it('maps mastery >= 0.65 to hard (3)', () => {
      expect(masteryToDifficulty(0.65)).toBe(3);
      expect(masteryToDifficulty(0.8)).toBe(3);
      expect(masteryToDifficulty(1.0)).toBe(3);
    });

    it('handles exact boundary at 0.3', () => {
      expect(masteryToDifficulty(0.3)).toBe(2);
      expect(masteryToDifficulty(0.2999)).toBe(1);
    });

    it('handles exact boundary at 0.65', () => {
      expect(masteryToDifficulty(0.65)).toBe(3);
      expect(masteryToDifficulty(0.6499)).toBe(2);
    });
  });

  describe('masteryToMinBloomLevel', () => {
    it('returns remember for low mastery (<0.3)', () => {
      expect(masteryToMinBloomLevel(0)).toBe('remember');
      expect(masteryToMinBloomLevel(0.29)).toBe('remember');
    });

    it('returns understand for building mastery (0.3-0.5)', () => {
      expect(masteryToMinBloomLevel(0.3)).toBe('understand');
      expect(masteryToMinBloomLevel(0.49)).toBe('understand');
    });

    it('returns apply for solid mastery (0.5-0.7)', () => {
      expect(masteryToMinBloomLevel(0.5)).toBe('apply');
      expect(masteryToMinBloomLevel(0.69)).toBe('apply');
    });

    it('returns analyze for strong mastery (0.7-0.85)', () => {
      expect(masteryToMinBloomLevel(0.7)).toBe('analyze');
      expect(masteryToMinBloomLevel(0.84)).toBe('analyze');
    });

    it('returns evaluate for near mastery (>=0.85)', () => {
      expect(masteryToMinBloomLevel(0.85)).toBe('evaluate');
      expect(masteryToMinBloomLevel(1.0)).toBe('evaluate');
    });

    it('scaffolds progressively — each level is higher or equal', () => {
      const levels = [0, 0.3, 0.5, 0.7, 0.85].map(masteryToMinBloomLevel);
      for (let i = 1; i < levels.length; i++) {
        const prevIdx = BLOOM_LEVELS_ORDERED.indexOf(levels[i - 1]);
        const currIdx = BLOOM_LEVELS_ORDERED.indexOf(levels[i]);
        expect(currIdx).toBeGreaterThanOrEqual(prevIdx);
      }
    });
  });

  describe('getBloomLevelsAtOrAbove', () => {
    it('returns all levels from remember', () => {
      expect(getBloomLevelsAtOrAbove('remember')).toEqual(BLOOM_LEVELS_ORDERED);
    });

    it('returns top two levels from evaluate', () => {
      expect(getBloomLevelsAtOrAbove('evaluate')).toEqual(['evaluate', 'create']);
    });

    it('returns all levels for unknown input', () => {
      expect(getBloomLevelsAtOrAbove('invalid')).toEqual(BLOOM_LEVELS_ORDERED);
    });

    it('returns only create for create', () => {
      expect(getBloomLevelsAtOrAbove('create')).toEqual(['create']);
    });
  });

  describe('deduplicateAdjacentTopics', () => {
    it('swaps adjacent questions with same topic', () => {
      const qs: QuestionRow[] = [
        { id: '1', topic_id: 'A' },
        { id: '2', topic_id: 'A' },
        { id: '3', topic_id: 'B' },
      ];
      const result = deduplicateAdjacentTopics(qs);
      // After dedup, question at index 1 should not have same topic as index 0
      expect(result[0].topic_id).not.toBe(result[1].topic_id);
    });

    it('does not modify already-deduplicated array', () => {
      const qs: QuestionRow[] = [
        { id: '1', topic_id: 'A' },
        { id: '2', topic_id: 'B' },
        { id: '3', topic_id: 'C' },
      ];
      const result = deduplicateAdjacentTopics(qs);
      expect(result.map(q => q.id)).toEqual(['1', '2', '3']);
    });

    it('handles all same topic (best effort — no swap available)', () => {
      const qs: QuestionRow[] = [
        { id: '1', topic_id: 'A' },
        { id: '2', topic_id: 'A' },
        { id: '3', topic_id: 'A' },
      ];
      const result = deduplicateAdjacentTopics(qs);
      // All same topic — cannot avoid adjacency, but should not crash
      expect(result).toHaveLength(3);
    });

    it('preserves all questions (no loss)', () => {
      const qs: QuestionRow[] = [
        { id: '1', topic_id: 'A' },
        { id: '2', topic_id: 'A' },
        { id: '3', topic_id: 'B' },
        { id: '4', topic_id: 'B' },
        { id: '5', topic_id: 'C' },
      ];
      const result = deduplicateAdjacentTopics(qs);
      const ids = result.map(q => q.id).sort();
      expect(ids).toEqual(['1', '2', '3', '4', '5']);
    });

    it('ignores null topic_id (no swap needed)', () => {
      const qs: QuestionRow[] = [
        { id: '1', topic_id: null },
        { id: '2', topic_id: null },
        { id: '3', topic_id: 'A' },
      ];
      const result = deduplicateAdjacentTopics(qs);
      // null topics should not trigger swap
      expect(result).toHaveLength(3);
    });

    it('handles empty array', () => {
      expect(deduplicateAdjacentTopics([])).toEqual([]);
    });

    it('handles single element', () => {
      const qs: QuestionRow[] = [{ id: '1', topic_id: 'A' }];
      expect(deduplicateAdjacentTopics(qs)).toHaveLength(1);
    });
  });

  describe('Adaptive difficulty distribution', () => {
    it('low mastery student gets mostly easy questions', () => {
      const masteries = [0.1, 0.15, 0.2, 0.25, 0.28];
      const difficulties = masteries.map(masteryToDifficulty);
      expect(difficulties.every(d => d === 1)).toBe(true);
    });

    it('medium mastery student gets medium questions', () => {
      const masteries = [0.4, 0.5, 0.6];
      const difficulties = masteries.map(masteryToDifficulty);
      expect(difficulties.every(d => d === 2)).toBe(true);
    });

    it('high mastery student gets hard questions', () => {
      const masteries = [0.7, 0.8, 0.95];
      const difficulties = masteries.map(masteryToDifficulty);
      expect(difficulties.every(d => d === 3)).toBe(true);
    });
  });
});
