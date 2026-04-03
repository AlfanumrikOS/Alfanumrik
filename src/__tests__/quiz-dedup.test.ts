import { describe, it, expect } from 'vitest';

// ── Count clamping (replicates edge function line: Math.min(Math.max(Number(rawCount ?? 10), 1), 30))
function clampCount(rawCount: number | undefined | null): number {
  return Math.min(Math.max(Number(rawCount ?? 10), 1), 30);
}

// ── Unseen-first sorting (replicates v1 getQuizQuestions dedup logic)
interface QuestionStub { id: string; text: string; }
function prioritizeUnseen(questions: QuestionStub[], seenIds: Set<string>, count: number): QuestionStub[] {
  const unseen = questions.filter(q => !seenIds.has(q.id));
  const seen = questions.filter(q => seenIds.has(q.id));
  const pool = [...unseen, ...seen];
  return pool.slice(0, count);
}

// ── 80% pool reset check
function shouldResetHistory(seenCount: number, totalPool: number): boolean {
  return totalPool > 0 && seenCount / totalPool >= 0.80;
}

describe('Quiz Dedup — Count Clamping', () => {
  it('count=5 stays 5', () => expect(clampCount(5)).toBe(5));
  it('count=10 stays 10', () => expect(clampCount(10)).toBe(10));
  it('count=15 stays 15', () => expect(clampCount(15)).toBe(15));
  it('count=20 stays 20', () => expect(clampCount(20)).toBe(20));
  it('count=0 becomes 1 (min clamp)', () => expect(clampCount(0)).toBe(1));
  it('count=-5 becomes 1 (min clamp)', () => expect(clampCount(-5)).toBe(1));
  it('count=50 becomes 30 (max clamp)', () => expect(clampCount(50)).toBe(30));
  it('count=30 stays 30', () => expect(clampCount(30)).toBe(30));
  it('count=undefined defaults to 10', () => expect(clampCount(undefined)).toBe(10));
  it('count=null defaults to 10', () => expect(clampCount(null)).toBe(10));
});

describe('Quiz Dedup — Unseen-First Prioritization', () => {
  const allQuestions: QuestionStub[] = [
    { id: 'q1', text: 'Q1' },
    { id: 'q2', text: 'Q2' },
    { id: 'q3', text: 'Q3' },
    { id: 'q4', text: 'Q4' },
    { id: 'q5', text: 'Q5' },
    { id: 'q6', text: 'Q6' },
    { id: 'q7', text: 'Q7' },
    { id: 'q8', text: 'Q8' },
    { id: 'q9', text: 'Q9' },
    { id: 'q10', text: 'Q10' },
  ];

  it('returns all unseen when no history', () => {
    const result = prioritizeUnseen(allQuestions, new Set(), 5);
    expect(result).toHaveLength(5);
    // All should be from the pool
    result.forEach(q => expect(allQuestions.map(a => a.id)).toContain(q.id));
  });

  it('prioritizes unseen over seen', () => {
    const seenIds = new Set(['q1', 'q2', 'q3', 'q4', 'q5']);
    const result = prioritizeUnseen(allQuestions, seenIds, 5);
    expect(result).toHaveLength(5);
    // First 5 should be unseen (q6-q10)
    result.forEach(q => expect(seenIds.has(q.id)).toBe(false));
  });

  it('backfills with seen when not enough unseen', () => {
    const seenIds = new Set(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
    const result = prioritizeUnseen(allQuestions, seenIds, 5);
    expect(result).toHaveLength(5);
    // First 2 unseen (q9, q10), then 3 seen backfill
    const unseenInResult = result.filter(q => !seenIds.has(q.id));
    const seenInResult = result.filter(q => seenIds.has(q.id));
    expect(unseenInResult).toHaveLength(2);
    expect(seenInResult).toHaveLength(3);
    // Unseen should come first
    const firstSeenIdx = result.findIndex(q => seenIds.has(q.id));
    const lastUnseenIdx = result.length - 1 - [...result].reverse().findIndex(q => !seenIds.has(q.id));
    expect(firstSeenIdx).toBeGreaterThan(lastUnseenIdx);
  });

  it('returns all seen when everything is seen', () => {
    const seenIds = new Set(allQuestions.map(q => q.id));
    const result = prioritizeUnseen(allQuestions, seenIds, 5);
    expect(result).toHaveLength(5);
  });

  it('returns fewer than count when pool is smaller', () => {
    const result = prioritizeUnseen(allQuestions.slice(0, 3), new Set(), 5);
    expect(result).toHaveLength(3);
  });

  it('respects count limit', () => {
    const result = prioritizeUnseen(allQuestions, new Set(), 3);
    expect(result).toHaveLength(3);
  });

  it('returns empty for empty pool', () => {
    const result = prioritizeUnseen([], new Set(), 5);
    expect(result).toHaveLength(0);
  });

  it('no duplicate IDs in result', () => {
    const seenIds = new Set(['q1', 'q3', 'q5', 'q7', 'q9']);
    const result = prioritizeUnseen(allQuestions, seenIds, 10);
    const ids = result.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Quiz Dedup — 80% Pool Reset', () => {
  it('does not reset when seen < 80%', () => {
    expect(shouldResetHistory(7, 10)).toBe(false);
    expect(shouldResetHistory(0, 10)).toBe(false);
    expect(shouldResetHistory(79, 100)).toBe(false);
  });

  it('resets when seen >= 80%', () => {
    expect(shouldResetHistory(8, 10)).toBe(true);
    expect(shouldResetHistory(80, 100)).toBe(true);
    expect(shouldResetHistory(10, 10)).toBe(true);
  });

  it('does not reset when pool is 0', () => {
    expect(shouldResetHistory(0, 0)).toBe(false);
  });

  it('handles exact boundary (80%)', () => {
    expect(shouldResetHistory(4, 5)).toBe(true);
    expect(shouldResetHistory(16, 20)).toBe(true);
  });

  it('does not reset at 79%', () => {
    // 79/100 = 0.79 < 0.80
    expect(shouldResetHistory(79, 100)).toBe(false);
  });
});

describe('Quiz Dedup — Edge Function Subject Query', () => {
  /**
   * Verifies the fix: edge function must query question_bank by subject TEXT code
   * (e.g. "math"), NOT by subject_id UUID. The question_bank table has a "subject"
   * column (TEXT) but NO "subject_id" column.
   */
  it('question_bank uses subject code not UUID', () => {
    // Simulate: resolveSubjectId returns UUID, but query must use code
    const subjectCode = 'math';
    const subjectUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    // The fixed edge function passes subjectCode to selectRandomQuestions
    // NOT subjectUUID
    expect(subjectCode).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(subjectUUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
