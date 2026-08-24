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
  subjectCodeForName,
  subjectCodeMapFromAllowed,
  filterRowsToAllowedSubjects,
  type MasteryOverviewRow,
} from '@alfanumrik/lib/dashboard/mastery-buckets';

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

describe('subjectCodeForName — display name → canonical code for deep links', () => {
  it('resolves canonical CBSE names via the static map', () => {
    expect(subjectCodeForName('Social Studies')).toBe('social_studies');
    expect(subjectCodeForName('Social Science')).toBe('social_studies');
    expect(subjectCodeForName('Computer Science')).toBe('computer_science');
    expect(subjectCodeForName('Business Studies')).toBe('business_studies');
    expect(subjectCodeForName('Political Science')).toBe('political_science');
    expect(subjectCodeForName('Math')).toBe('math');
    expect(subjectCodeForName('Mathematics')).toBe('math');
    expect(subjectCodeForName('History')).toBe('history_sr');
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(subjectCodeForName('  SOCIAL STUDIES ')).toBe('social_studies');
    expect(subjectCodeForName('science')).toBe('science');
    expect(subjectCodeForName('SCIENCE')).toBe('science');
  });

  it('lets the live per-student map WIN over the static map', () => {
    // A tenant that renamed a subject must be honored over the static map.
    const live = { 'Math (Advanced)': 'math', 'Social Studies': 'social_studies' };
    expect(subjectCodeForName('Math (Advanced)', live)).toBe('math');
    expect(subjectCodeForName('Social Studies', live)).toBe('social_studies');
  });

  it('falls back to the static map when the live map misses (case-insensitively)', () => {
    const live = { 'Math (Advanced)': 'math' };
    expect(subjectCodeForName('Computer Science', live)).toBe('computer_science');
    expect(subjectCodeForName('SCIENCE', live)).toBe('science');
  });

  it('returns null when unknown — callers must OMIT the param, never send the raw name', () => {
    expect(subjectCodeForName('Gym')).toBeNull();
    expect(subjectCodeForName('')).toBeNull();
    expect(subjectCodeForName(null)).toBeNull();
    expect(subjectCodeForName(undefined)).toBeNull();
  });
});

/* ── Defect #11: subject scope must equal grade_subject_map, keyed on CODE ──
 *
 * SubjectRoadmaps used to filter with a hardcoded `new Set(['Mathematics',
 * 'Science'])` on the DISPLAY NAME. Production `grade_subject_map` maps
 * grades 6-10 → {math, science} and grades 11-12 → {biology, chemistry, math,
 * physics}, so that set dropped Physics/Chemistry/Biology outright: every
 * grade-11/12 student saw a Mathematics-only mastery surface.
 *
 * These cases pin the replacement against the real map for one junior and one
 * senior grade. They are what would have caught the original defect: a
 * grade-11 fixture yields four subjects, not one.
 */

/** Exactly what /api/student/subjects returns for a grade-9 CBSE student. */
const GRADE_9_ALLOWED = [
  { code: 'math', name: 'Mathematics' },
  { code: 'science', name: 'Science' },
];

/** Exactly what /api/student/subjects returns for a grade-11 science student. */
const GRADE_11_ALLOWED = [
  { code: 'biology', name: 'Biology' },
  { code: 'chemistry', name: 'Chemistry' },
  { code: 'math', name: 'Mathematics' },
  { code: 'physics', name: 'Physics' },
];

/** get_mastery_overview returns the display NAME in `subject`. */
const OVERVIEW_ROWS = [
  row({ topic_id: 'a', subject: 'Mathematics' }),
  row({ topic_id: 'b', subject: 'Science' }),
  row({ topic_id: 'c', subject: 'Physics' }),
  row({ topic_id: 'd', subject: 'Chemistry' }),
  row({ topic_id: 'e', subject: 'Biology' }),
  row({ topic_id: 'f', subject: 'English' }),
  row({ topic_id: 'g', subject: 'Social Studies' }),
];

describe('filterRowsToAllowedSubjects — reachable-subject scope (defect #11)', () => {
  it('grade 9 → exactly {Mathematics, Science}, dropping English/SST', () => {
    const kept = filterRowsToAllowedSubjects(OVERVIEW_ROWS, GRADE_9_ALLOWED);
    expect(kept.map((r) => r.subject).sort()).toEqual(['Mathematics', 'Science']);
  });

  it('grade 11 → all FOUR senior subjects, not Mathematics alone (the old hardcode bug)', () => {
    const kept = filterRowsToAllowedSubjects(OVERVIEW_ROWS, GRADE_11_ALLOWED);
    expect(kept.map((r) => r.subject).sort()).toEqual([
      'Biology',
      'Chemistry',
      'Mathematics',
      'Physics',
    ]);
    // The specific regression: Physics/Chemistry/Biology used to be dropped.
    expect(kept.map((r) => r.subject)).toContain('Physics');
  });

  it('accepts rows keyed by CODE too (student_learning_profiles / topic_mastery_rollup)', () => {
    const codeRows = [
      { id: 'p1', subject: 'physics' },
      { id: 'p2', subject: 'math' },
      { id: 'p3', subject: 'english' },
    ];
    const kept = filterRowsToAllowedSubjects(codeRows, GRADE_11_ALLOWED);
    expect(kept.map((r) => r.subject)).toEqual(['physics', 'math']);
  });

  it('FAILS OPEN while the allowed list is unresolved — never an all-empty panel', () => {
    expect(filterRowsToAllowedSubjects(OVERVIEW_ROWS, []).length).toBe(OVERVIEW_ROWS.length);
    expect(filterRowsToAllowedSubjects(OVERVIEW_ROWS, undefined).length).toBe(OVERVIEW_ROWS.length);
  });

  it('drops rows with no subject at all, but KEEPS ones whose name we cannot map', () => {
    const rows = [row({ topic_id: 'x', subject: null }), row({ topic_id: 'y', subject: 'Robotics' })];
    const kept = filterRowsToAllowedSubjects(rows, GRADE_9_ALLOWED);
    // An unmappable name is OUR gap, not evidence the subject is unreachable.
    expect(kept.map((r) => r.topic_id)).toEqual(['y']);
  });

  it('subjectCodeMapFromAllowed builds the display-name → code map subjectCodeForName consumes', () => {
    const map = subjectCodeMapFromAllowed(GRADE_11_ALLOWED);
    expect(map).toEqual({
      Biology: 'biology',
      Chemistry: 'chemistry',
      Mathematics: 'math',
      Physics: 'physics',
    });
    expect(subjectCodeForName('Physics', map)).toBe('physics');
  });
});
