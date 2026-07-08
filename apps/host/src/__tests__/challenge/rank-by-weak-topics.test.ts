/**
 * Tests for the pure Concept Chain weak-topic ranker.
 *
 * The ranker is the load-bearing piece of the personalised challenge
 * pick. Test every score lane (3 / 2 / 1 / 0), the stable tie-break
 * (legacy "first available" behaviour preserved), and the empty
 * inputs paths.
 */

import { describe, it, expect } from 'vitest';
import {
  rankChallengesByWeakTopics,
  parseChapterFromText,
  type RankableChallenge,
} from '../../lib/challenge/rank-by-weak-topics';
import type { WeakTopic } from '../../lib/state/learner-loop/weak-topics';

function mkChallenge(overrides: Partial<RankableChallenge>): RankableChallenge {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    subject: overrides.subject ?? 'science',
    chapter: overrides.chapter ?? null,
    topic: overrides.topic ?? '',
  };
}

function mkWeak(
  subjectCode: string,
  chapterNumber: number,
  mastery = 0.3,
): WeakTopic {
  return {
    subjectCode,
    chapterNumber,
    mastery,
    attempts: 5,
    lastUpdatedAt: '2026-05-10T00:00:00.000Z',
  };
}

// ─── parseChapterFromText ────────────────────────────────────────────

describe('parseChapterFromText', () => {
  it('extracts a bare number', () => {
    expect(parseChapterFromText('7')).toBe(7);
  });

  it('extracts "Chapter N"', () => {
    expect(parseChapterFromText('Chapter 7')).toBe(7);
    expect(parseChapterFromText('chapter 12: Light')).toBe(12);
  });

  it('extracts "ch. N"', () => {
    expect(parseChapterFromText('ch. 5')).toBe(5);
    expect(parseChapterFromText('ch 5')).toBe(5);
  });

  it('returns null for no-match', () => {
    expect(parseChapterFromText(null)).toBeNull();
    expect(parseChapterFromText('')).toBeNull();
    expect(parseChapterFromText('Light and Sound')).toBeNull();
  });

  it('rejects zero', () => {
    expect(parseChapterFromText('Chapter 0')).toBeNull();
  });
});

// ─── rankChallengesByWeakTopics — score lanes ────────────────────────

describe('rankChallengesByWeakTopics — score lanes', () => {
  it('score 3: exact (subject, chapter) match', () => {
    const challenges = [mkChallenge({ subject: 'science', chapter: '7' })];
    const weak = [mkWeak('science', 7)];
    const out = rankChallengesByWeakTopics(challenges, weak);
    expect(out.score).toBe(3);
    expect(out.picked?.id).toBe(challenges[0].id);
  });

  it('score 2: subject match, different chapter', () => {
    const challenges = [mkChallenge({ subject: 'science', chapter: '99' })];
    const weak = [mkWeak('science', 7)];
    const out = rankChallengesByWeakTopics(challenges, weak);
    expect(out.score).toBe(2);
  });

  it('score 1: topic text mentions a weak chapter number', () => {
    const challenges = [
      mkChallenge({
        subject: 'math', // unrelated subject
        chapter: null,
        topic: 'Cross-references Chapter 7 in passing',
      }),
    ];
    const weak = [mkWeak('science', 7)];
    const out = rankChallengesByWeakTopics(challenges, weak);
    expect(out.score).toBe(1);
  });

  it('score 0: no match at all', () => {
    const challenges = [
      mkChallenge({ subject: 'math', chapter: '99', topic: 'Some math thing' }),
    ];
    const weak = [mkWeak('science', 7)];
    const out = rankChallengesByWeakTopics(challenges, weak);
    expect(out.score).toBe(0);
  });

  it('score 0 when weak-topic set is empty (legacy fallback path)', () => {
    const challenges = [mkChallenge({ subject: 'science', chapter: '7' })];
    const out = rankChallengesByWeakTopics(challenges, []);
    expect(out.score).toBe(0);
  });

  it('case-insensitive on subject match', () => {
    const challenges = [mkChallenge({ subject: 'Science', chapter: '7' })];
    const weak = [mkWeak('science', 7)];
    expect(rankChallengesByWeakTopics(challenges, weak).score).toBe(3);
  });
});

// ─── rankChallengesByWeakTopics — picking + tie-breaking ─────────────

describe('rankChallengesByWeakTopics — picking + ties', () => {
  it('picks the highest-scoring challenge', () => {
    const challenges = [
      mkChallenge({ id: 'a', subject: 'math', chapter: '99' }),     // 0
      mkChallenge({ id: 'b', subject: 'science', chapter: '99' }),  // 2 (subj only)
      mkChallenge({ id: 'c', subject: 'science', chapter: '7' }),   // 3 (exact)
    ];
    const weak = [mkWeak('science', 7)];
    const out = rankChallengesByWeakTopics(challenges, weak);
    expect(out.picked?.id).toBe('c');
    expect(out.score).toBe(3);
  });

  it('ties: returns the FIRST input among top-scoring (legacy "first available" behaviour)', () => {
    const challenges = [
      mkChallenge({ id: 'a', subject: 'science', chapter: '7' }), // 3
      mkChallenge({ id: 'b', subject: 'science', chapter: '7' }), // 3
    ];
    const weak = [mkWeak('science', 7)];
    expect(rankChallengesByWeakTopics(challenges, weak).picked?.id).toBe('a');
  });

  it('all-zero: returns the first input (legacy fallback)', () => {
    const challenges = [
      mkChallenge({ id: 'a', subject: 'math', chapter: '99' }),
      mkChallenge({ id: 'b', subject: 'english', chapter: '99' }),
    ];
    const weak = [mkWeak('science', 7)];
    const out = rankChallengesByWeakTopics(challenges, weak);
    expect(out.picked?.id).toBe('a');
    expect(out.score).toBe(0);
  });

  it('empty challenge list: returns null picked, empty ranked', () => {
    const out = rankChallengesByWeakTopics([], [mkWeak('science', 7)]);
    expect(out.picked).toBeNull();
    expect(out.ranked).toEqual([]);
    expect(out.score).toBe(0);
  });

  it('annotates every challenge with its score in input order', () => {
    const challenges = [
      mkChallenge({ id: 'a', subject: 'math', chapter: '99' }),
      mkChallenge({ id: 'b', subject: 'science', chapter: '7' }),
      mkChallenge({ id: 'c', subject: 'science', chapter: '99' }),
    ];
    const weak = [mkWeak('science', 7)];
    const out = rankChallengesByWeakTopics(challenges, weak);
    expect(out.ranked.map(r => ({ id: r.challenge.id, score: r.score }))).toEqual([
      { id: 'a', score: 0 },
      { id: 'b', score: 3 },
      { id: 'c', score: 2 },
    ]);
  });
});

// ─── Chapter parsing through the ranker ──────────────────────────────

describe('rankChallengesByWeakTopics — chapter parsing', () => {
  it('handles "Chapter N: Title" form', () => {
    const challenges = [mkChallenge({ subject: 'science', chapter: 'Chapter 7: Light' })];
    const weak = [mkWeak('science', 7)];
    expect(rankChallengesByWeakTopics(challenges, weak).score).toBe(3);
  });

  it('falls back to score 2 when chapter string has no parseable number', () => {
    const challenges = [mkChallenge({ subject: 'science', chapter: 'TBD' })];
    const weak = [mkWeak('science', 7)];
    // subject matches → 2 (chapter parse fails → no shot at 3)
    expect(rankChallengesByWeakTopics(challenges, weak).score).toBe(2);
  });

  it('null chapter still gets subject-match score 2', () => {
    const challenges = [mkChallenge({ subject: 'science', chapter: null })];
    const weak = [mkWeak('science', 7)];
    expect(rankChallengesByWeakTopics(challenges, weak).score).toBe(2);
  });
});
