/**
 * mastery-buckets — pure presentation helpers for the Alfa OS dashboard.
 *
 * These helpers ONLY re-present the engine's already-decided mastery_level +
 * due_for_review signal into student-facing buckets / roadmap states. No mastery
 * formula lives here (assessment owns that). Tests pin the classification rules:
 *
 *   - due_for_review precedence over standing level,
 *   - mastered / learning / locked mapping,
 *   - masteryPercent clamps 0..1 → 0..100,
 *   - weakestStartedTopic selection + its due-review fallback.
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  bucketForRow,
  countBuckets,
  roadmapStatusForRow,
  masteryPercent,
  accuracyPercent,
  aggregateAccuracyPercent,
  groupBySubject,
  weakestStartedTopic,
  type MasteryOverviewRow,
} from '@/lib/dashboard/mastery-buckets';

function row(partial: Partial<MasteryOverviewRow>): MasteryOverviewRow {
  return {
    topic_id: partial.topic_id ?? 't1',
    title: partial.title ?? 'Topic',
    mastery_level: partial.mastery_level ?? 'beginner',
    mastery_probability: partial.mastery_probability ?? 0,
    ...partial,
  };
}

describe('bucketForRow — due_for_review precedence', () => {
  it('a due topic is needs-revision regardless of standing level', () => {
    expect(bucketForRow(row({ mastery_level: 'mastered', due_for_review: true }))).toBe('needs-revision');
    expect(bucketForRow(row({ mastery_level: 'beginner', due_for_review: true }))).toBe('needs-revision');
  });

  it('mastered (not due) → mastered', () => {
    expect(bucketForRow(row({ mastery_level: 'mastered', due_for_review: false }))).toBe('mastered');
  });

  it('not_started → null (excluded from the started-work tally)', () => {
    expect(bucketForRow(row({ mastery_level: 'not_started' }))).toBeNull();
  });

  it('any started-but-not-mastered level → learning', () => {
    for (const level of ['beginner', 'developing', 'proficient']) {
      expect(bucketForRow(row({ mastery_level: level }))).toBe('learning');
    }
  });
});

describe('countBuckets — tally across rows', () => {
  it('counts mastered / learning / needs-revision and ignores not_started', () => {
    const rows = [
      row({ topic_id: 'a', mastery_level: 'mastered' }),
      row({ topic_id: 'b', mastery_level: 'developing' }),
      row({ topic_id: 'c', mastery_level: 'proficient', due_for_review: true }),
      row({ topic_id: 'd', mastery_level: 'not_started' }),
    ];
    expect(countBuckets(rows)).toEqual({ mastered: 1, learning: 1, needsRevision: 1 });
  });

  it('empty input → all zeros', () => {
    expect(countBuckets([])).toEqual({ mastered: 0, learning: 0, needsRevision: 0 });
  });
});

describe('roadmapStatusForRow — includes the locked/not-started case', () => {
  it('due → needs-revision (precedence)', () => {
    expect(roadmapStatusForRow(row({ mastery_level: 'mastered', due_for_review: true }))).toBe('needs-revision');
  });
  it('mastered → mastered', () => {
    expect(roadmapStatusForRow(row({ mastery_level: 'mastered' }))).toBe('mastered');
  });
  it('not_started → locked', () => {
    expect(roadmapStatusForRow(row({ mastery_level: 'not_started' }))).toBe('locked');
  });
  it('beginner → learning', () => {
    expect(roadmapStatusForRow(row({ mastery_level: 'beginner' }))).toBe('learning');
  });
});

describe('masteryPercent — clamps 0..1 → 0..100', () => {
  it('rounds a fractional probability', () => {
    expect(masteryPercent(row({ mastery_probability: 0.736 }))).toBe(74);
    expect(masteryPercent(row({ mastery_probability: 0.5 }))).toBe(50);
  });
  it('clamps below 0 and above 1', () => {
    expect(masteryPercent(row({ mastery_probability: -0.4 }))).toBe(0);
    expect(masteryPercent(row({ mastery_probability: 1.9 }))).toBe(100);
  });
  it('null probability → 0', () => {
    expect(masteryPercent(row({ mastery_probability: null }))).toBe(0);
  });
});

describe('accuracyPercent — P1-canonical per-topic accuracy (C1)', () => {
  it('is round(correct/attempts*100), the same formula quiz results use', () => {
    expect(accuracyPercent(row({ attempts: 10, correct_attempts: 7 }))).toBe(70);
    expect(accuracyPercent(row({ attempts: 3, correct_attempts: 1 }))).toBe(33); // not 33.33
    expect(accuracyPercent(row({ attempts: 4, correct_attempts: 4 }))).toBe(100);
  });
  it('no divide-by-zero: 0 attempts → 0 (never NaN)', () => {
    expect(accuracyPercent(row({ attempts: 0, correct_attempts: 0 }))).toBe(0);
    expect(accuracyPercent(row({}))).toBe(0); // missing fields default to 0
  });
});

describe('aggregateAccuracyPercent — Σcorrect/Σattempts across rows (C1)', () => {
  it('sums correct + attempts BEFORE dividing (weighted, not a mean of ratios)', () => {
    // Σcorrect = 4+1+2 = 7, Σattempts = 4+2+4 = 10 → 70%. A naive mean of the
    // per-row ratios (100% + 50% + 50%)/3 = 67% is the bug this guards.
    const rows = [
      row({ topic_id: 'a', attempts: 4, correct_attempts: 4 }),
      row({ topic_id: 'b', attempts: 2, correct_attempts: 1 }),
      row({ topic_id: 'c', attempts: 4, correct_attempts: 2 }),
    ];
    expect(aggregateAccuracyPercent(rows)).toBe(70);
  });
  it('rows with no attempts contribute nothing (and never divide-by-zero)', () => {
    const rows = [
      row({ topic_id: 'a', attempts: 10, correct_attempts: 5 }),
      row({ topic_id: 'b', mastery_level: 'not_started', attempts: 0, correct_attempts: 0 }),
    ];
    expect(aggregateAccuracyPercent(rows)).toBe(50);
    expect(aggregateAccuracyPercent([])).toBe(0);
    expect(
      aggregateAccuracyPercent([row({ attempts: 0, correct_attempts: 0 })]),
    ).toBe(0);
  });
});

describe('groupBySubject — first-seen order preserved', () => {
  it('groups rows by subject, keeping first-seen order + icon', () => {
    const rows = [
      row({ topic_id: 'a', subject: 'Math', subject_icon: '🔢' }),
      row({ topic_id: 'b', subject: 'Science' }),
      row({ topic_id: 'c', subject: 'Math' }),
    ];
    const groups = groupBySubject(rows);
    expect(groups.map((g) => g.subject)).toEqual(['Math', 'Science']);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].icon).toBe('🔢');
    expect(groups[1].icon).toBe('📘'); // default
  });

  it('falls back to "General" when subject is absent', () => {
    const groups = groupBySubject([row({ subject: null })]);
    expect(groups[0].subject).toBe('General');
  });
});

describe('weakestStartedTopic — lowest-mastery started topic', () => {
  it('picks the lowest-mastery started (non-mastered) topic', () => {
    const rows = [
      row({ topic_id: 'a', mastery_level: 'proficient', mastery_probability: 0.7 }),
      row({ topic_id: 'b', mastery_level: 'beginner', mastery_probability: 0.2 }),
      row({ topic_id: 'c', mastery_level: 'developing', mastery_probability: 0.5 }),
    ];
    expect(weakestStartedTopic(rows)?.topic_id).toBe('b');
  });

  it('excludes not_started and mastered topics', () => {
    const rows = [
      row({ topic_id: 'a', mastery_level: 'not_started', mastery_probability: 0 }),
      row({ topic_id: 'b', mastery_level: 'mastered', mastery_probability: 1 }),
      row({ topic_id: 'c', mastery_level: 'developing', mastery_probability: 0.4 }),
    ];
    expect(weakestStartedTopic(rows)?.topic_id).toBe('c');
  });

  it('falls back to a due-for-review topic when nothing is actively learning', () => {
    const rows = [
      row({ topic_id: 'a', mastery_level: 'mastered', mastery_probability: 1, due_for_review: true }),
      row({ topic_id: 'b', mastery_level: 'not_started', mastery_probability: 0 }),
    ];
    expect(weakestStartedTopic(rows)?.topic_id).toBe('a');
  });

  it('returns null when nothing is actionable', () => {
    const rows = [
      row({ topic_id: 'a', mastery_level: 'mastered', mastery_probability: 1 }),
      row({ topic_id: 'b', mastery_level: 'not_started', mastery_probability: 0 }),
    ];
    expect(weakestStartedTopic(rows)).toBeNull();
  });
});
