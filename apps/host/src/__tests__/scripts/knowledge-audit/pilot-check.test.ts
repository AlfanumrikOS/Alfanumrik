/**
 * Wave 1 Task 1.2 — pilot-check agreement matrix (pure, no network).
 * The real fixture (scripts/knowledge-audit/fixtures/pilot-ground-truth-v1.json)
 * may not exist yet — these tests exercise the comparison logic against a
 * SYNTHETIC fixture so the gate is testable before the pilot ground truth lands.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AGREEMENT_PASS_THRESHOLD,
  compareAgainstGroundTruth,
  countsAgree,
  findGroundTruthChapter,
  formatAgreementMatrix,
  normalizeGroundTruthFixture,
  toleranceFor,
  type GroundTruthFixture,
} from '../../../../scripts/knowledge-audit/pilot-check';

const SYNTHETIC_FIXTURE: GroundTruthFixture = {
  version: 'synthetic-test-v1',
  chapters: [
    {
      grade: '6',
      subject: 'science',
      chapter_number: 4,
      counts: {
        activities: 6,
        diagrams: 10,
        examples: 4,
        exercises: 12,
        definitions: 5,
        tables: 2,
        summary: 8,
        formulae: 0,
        headings: 9,
        keywords: 7,
      },
    },
  ],
};

describe('toleranceFor / countsAgree (±1 or ±15%, whichever is LOOSER)', () => {
  it('small truths: ±1 dominates (15% of 4 = 0.6 < 1)', () => {
    expect(toleranceFor(4)).toBe(1);
    expect(countsAgree(5, 4)).toBe(true);
    expect(countsAgree(3, 4)).toBe(true);
    expect(countsAgree(6, 4)).toBe(false);
  });

  it('large truths: ±15% dominates (15% of 20 = 3 > 1)', () => {
    expect(toleranceFor(20)).toBe(3);
    expect(countsAgree(23, 20)).toBe(true);
    expect(countsAgree(17, 20)).toBe(true);
    expect(countsAgree(24, 20)).toBe(false);
  });

  it('truth 0: engine must be within ±1', () => {
    expect(countsAgree(0, 0)).toBe(true);
    expect(countsAgree(1, 0)).toBe(true);
    expect(countsAgree(2, 0)).toBe(false);
  });
});

describe('compareAgainstGroundTruth', () => {
  const truth = SYNTHETIC_FIXTURE.chapters[0];

  it('passes when >= 85% of dimension counts agree', () => {
    // 9 of 10 exact, 1 way off -> 90% >= 85% PASS
    const result = compareAgainstGroundTruth(
      { activities: 6, diagrams: 10, examples: 4, exercises: 12, definitions: 5, tables: 2, summary: 8, formulae: 0, headings: 9, keywords: 2 },
      truth,
    );
    expect(result.compared).toBe(10);
    expect(result.agreed).toBe(9);
    expect(result.agreementPct).toBe(90);
    expect(result.pass).toBe(true);
  });

  it('fails below the 85% threshold', () => {
    // 8 of 10 agree -> 80% < 85% FAIL
    const result = compareAgainstGroundTruth(
      { activities: 6, diagrams: 10, examples: 4, exercises: 12, definitions: 5, tables: 2, summary: 8, formulae: 0, headings: 0, keywords: 0 },
      truth,
    );
    expect(result.agreed).toBe(8);
    expect(result.pass).toBe(false);
  });

  it('missing engine dimensions count as 0 (and typically disagree)', () => {
    const result = compareAgainstGroundTruth({ activities: 6 }, truth);
    expect(result.compared).toBe(10);
    const diagrams = result.comparisons.find((c) => c.dimension === 'diagrams')!;
    expect(diagrams.engine).toBe(0);
    expect(diagrams.agrees).toBe(false);
    // formulae truth is 0, engine default 0 -> agrees
    expect(result.comparisons.find((c) => c.dimension === 'formulae')!.agrees).toBe(true);
  });

  it('only compares dimensions present in the ground truth (subset fixtures allowed)', () => {
    const result = compareAgainstGroundTruth(
      { activities: 6, hots_questions: 99 },
      { ...truth, counts: { activities: 6 } },
    );
    expect(result.compared).toBe(1);
    expect(result.pass).toBe(true);
  });

  it('an empty ground truth cannot pass (0 comparisons)', () => {
    const result = compareAgainstGroundTruth({}, { ...truth, counts: {} });
    expect(result.compared).toBe(0);
    expect(result.pass).toBe(false);
  });
});

describe('findGroundTruthChapter', () => {
  it('matches on grade (string, P5) + subject + chapter_number', () => {
    expect(
      findGroundTruthChapter(SYNTHETIC_FIXTURE, { grade: '6', subject: 'science', chapterNumber: 4 }),
    ).toBe(SYNTHETIC_FIXTURE.chapters[0]);
    expect(
      findGroundTruthChapter(SYNTHETIC_FIXTURE, { grade: '7', subject: 'science', chapterNumber: 4 }),
    ).toBeNull();
    expect(
      findGroundTruthChapter(SYNTHETIC_FIXTURE, { grade: '6', subject: 'math', chapterNumber: 4 }),
    ).toBeNull();
  });
});

describe('normalizeGroundTruthFixture', () => {
  it('passes through the canonical shape unchanged', () => {
    const norm = normalizeGroundTruthFixture(SYNTHETIC_FIXTURE);
    expect(norm).not.toBeNull();
    expect(norm!.chapters[0].counts.activities).toBe(6);
    expect(norm!.chapters[0].subject).toBe('science');
  });

  it('normalizes the background-task v1 shape (subject_code + dimensions.count)', () => {
    const raw = {
      version: 1,
      created: '2026-07-03',
      chapters: [
        {
          syllabus_id: 'x',
          board: 'CBSE',
          grade: '6',
          subject_code: 'science',
          chapter_number: 2,
          dimensions: {
            activities: { count: 10, evidence: ['Activity 2.1'], notes: 'contiguous' },
            diagrams: { count: 13, evidence: [], notes: '' },
            formulae: { count: 0, evidence: [], notes: '' },
          },
          suspected_missing: ['Section 2.4 heading not captured'],
        },
      ],
    };
    const norm = normalizeGroundTruthFixture(raw);
    expect(norm).not.toBeNull();
    expect(norm!.version).toBe('1');
    const ch = norm!.chapters[0];
    expect(ch.grade).toBe('6'); // P5: string grade
    expect(ch.subject).toBe('science');
    expect(ch.chapter_number).toBe(2);
    expect(ch.counts).toEqual({ activities: 10, diagrams: 13, formulae: 0 });
  });

  it('rejects structurally-unusable input', () => {
    expect(normalizeGroundTruthFixture(null)).toBeNull();
    expect(normalizeGroundTruthFixture('nope')).toBeNull();
    expect(normalizeGroundTruthFixture({ chapters: 'not-an-array' })).toBeNull();
    expect(normalizeGroundTruthFixture({ chapters: [{ grade: '6' }] })).toBeNull(); // no subject/chapter
  });

  it('normalizes the REAL checked-in pilot fixture when present (local read, no network)', () => {
    const p = join(process.cwd(), 'scripts', 'knowledge-audit', 'fixtures', 'pilot-ground-truth-v1.json');
    if (!existsSync(p)) return; // fixture is written by a background task — skip if absent
    const norm = normalizeGroundTruthFixture(JSON.parse(readFileSync(p, 'utf8')));
    expect(norm).not.toBeNull();
    expect(norm!.chapters.length).toBeGreaterThanOrEqual(1);
    for (const ch of norm!.chapters) {
      expect(typeof ch.grade).toBe('string'); // P5
      expect(typeof ch.subject).toBe('string');
      expect(typeof ch.chapter_number).toBe('number');
      expect(Object.keys(ch.counts).length).toBeGreaterThan(0);
      for (const v of Object.values(ch.counts)) expect(Number.isFinite(v)).toBe(true);
    }
    // the pilot fixture is keyed for findGroundTruthChapter lookups
    const first = norm!.chapters[0];
    expect(
      findGroundTruthChapter(norm!, { grade: first.grade, subject: first.subject, chapterNumber: first.chapter_number }),
    ).toBe(first);
  });
});

describe('formatAgreementMatrix', () => {
  it('renders one line per dimension plus a PASS/FAIL summary with the 85% threshold', () => {
    const result = compareAgainstGroundTruth(
      { activities: 6, diagrams: 8 },
      { grade: '6', subject: 'science', chapter_number: 4, counts: { activities: 6, diagrams: 10 } },
    );
    const text = formatAgreementMatrix(result);
    expect(text).toContain('activities');
    expect(text).toContain('diagrams');
    expect(text).toMatch(/OK/);
    expect(text).toMatch(/MISS/);
    expect(text).toContain(`threshold ${AGREEMENT_PASS_THRESHOLD * 100}%`);
    expect(text).toMatch(/agreement: 1\/2 \(50%\) — FAIL/);
  });
});
