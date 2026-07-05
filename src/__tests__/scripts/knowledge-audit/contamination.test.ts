/**
 * Knowledge-audit v2 — code-computed contamination signals.
 *
 * v1 asked the LLM for content_contaminated; it defaulted false and NEVER
 * flipped (0/4 detections in the Wave 1 pilot). v2 computes contamination
 * deterministically from structural-scan series metadata + chunk text, so the
 * detection quality is pinned HERE, offline.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import type { AuditChunk } from '../../../../scripts/knowledge-audit/dimensions';
import {
  detectContamination,
  FOREIGN_SERIES_MIN_MEMBERS,
  isRepeatedPhraseTitle,
  TITLE_OVERLAP_MIN_RATIO,
  titleTokenOverlap,
} from '../../../../scripts/knowledge-audit/contamination';
import { runStructuralScan, type SeriesMeta } from '../../../../scripts/knowledge-audit/structural-scan';

const FIXTURE_DIR = join(process.cwd(), 'scripts', 'knowledge-audit', 'fixtures', 'synthetic-chunks');

interface SyntheticFixture {
  chapter_number: number;
  chapter_title: string;
  chunks: AuditChunk[];
  truth: Record<string, number | boolean>;
}

function loadFixture(name: string): SyntheticFixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as SyntheticFixture;
}

function chunk(id: string, text: string): AuditChunk {
  return { chunk_id: id, chunk_text: text, content_type: null };
}

function detectOnFixture(f: SyntheticFixture) {
  const scan = runStructuralScan(f.chunks, f.chapter_number);
  return detectContamination({
    chapterNumber: f.chapter_number,
    chapterTitle: f.chapter_title,
    series: scan.series,
    summaryBlockCount: scan.summaryBlockCount,
    chunks: f.chunks,
  });
}

const series = (dimension: SeriesMeta['dimension'], majors: Array<[number, number]>): SeriesMeta => ({
  dimension,
  majorsSeen: new Map(majors),
});

const NO_SIGNAL_BASE = {
  chapterNumber: 6,
  chapterTitle: 'Lines and Angles',
  summaryBlockCount: 1,
  chunks: [chunk('c1', 'Intersecting lines and pairs of angles are studied in this chapter.')],
};

describe('end-to-end on the synthetic fixtures (structural scan → contamination)', () => {
  it('clean mini-chapter → NOT contaminated, no evidence', () => {
    const res = detectOnFixture(loadFixture('clean-mini-chapter.json'));
    expect(res.contaminated).toBe(false);
    expect(res.evidence).toEqual([]);
  });

  it('contaminated mini-chapter → flagged on BOTH the foreign 13.x series and the second summary block', () => {
    const res = detectOnFixture(loadFixture('contaminated-mini-chapter.json'));
    expect(res.contaminated).toBe(true);
    expect(res.evidence.some((e) => e.includes('foreign major-number series 13.x') && e.includes('diagrams'))).toBe(true);
    expect(res.evidence).toContain('multiple summary blocks (2)');
  });
});

describe('signal (a): foreign-major series threshold', () => {
  it(`fires at ${FOREIGN_SERIES_MIN_MEMBERS} distinct foreign members, not below (1-2 = cross-chapter reference noise)`, () => {
    const below = detectContamination({ ...NO_SIGNAL_BASE, series: [series('diagrams', [[6, 10], [13, 2]])] });
    expect(below.contaminated).toBe(false);
    const at = detectContamination({ ...NO_SIGNAL_BASE, series: [series('diagrams', [[6, 10], [13, 3]])] });
    expect(at.contaminated).toBe(true);
    expect(at.evidence).toEqual(['foreign major-number series 13.x in diagrams (3 members)']);
  });

  it('any series dimension can carry the signal (chem 6.x-in-ch1 via examples)', () => {
    const res = detectContamination({
      ...NO_SIGNAL_BASE,
      chapterNumber: 1,
      chapterTitle: 'Some Basic Concepts',
      chunks: [chunk('c1', 'Basic concepts of chemistry and their examples.')],
      series: [series('examples', [[1, 4], [6, 5]])],
    });
    expect(res.contaminated).toBe(true);
    expect(res.evidence).toEqual(['foreign major-number series 6.x in examples (5 members)']);
  });
});

describe('signal (b): multiple summary blocks', () => {
  it('fires at 2 distinct summary blocks', () => {
    const one = detectContamination({ ...NO_SIGNAL_BASE, series: [], summaryBlockCount: 1 });
    expect(one.contaminated).toBe(false);
    const two = detectContamination({ ...NO_SIGNAL_BASE, series: [], summaryBlockCount: 2 });
    expect(two.contaminated).toBe(true);
    expect(two.evidence).toContain('multiple summary blocks (2)');
  });

  // Assessment pre-pilot condition 2 (2026-07-04): title-case "Summary"
  // detection restores signal (b) recall for title-case books (math NCERT),
  // where a merged second chapter also carries an unnumbered "Summary".
  it('two title-case "Summary" blocks (different following text) fire signal (b) end-to-end', () => {
    const chunks = [
      chunk('c1', 'measured carefully. Summary In this chapter, you have studied points, lines and supplementary angles.'),
      chunk('c2', 'field lines were drawn. Summary Magnetic field is a quantity that has both direction and magnitude.'),
    ];
    const scan = runStructuralScan(chunks, 6);
    expect(scan.summaryBlockCount).toBe(2);
    const res = detectContamination({
      chapterNumber: 6,
      chapterTitle: 'Lines and Angles',
      series: scan.series,
      summaryBlockCount: scan.summaryBlockCount,
      chunks,
    });
    expect(res.contaminated).toBe(true);
    expect(res.evidence).toContain('multiple summary blocks (2)');
  });
});

describe('signal (c): title garble', () => {
  it('isRepeatedPhraseTitle: "Notes For The Teacher" ×5 (the real g10 case) → true; normal titles → false', () => {
    expect(
      isRepeatedPhraseTitle(
        'Notes For The Teacher Notes For The Teacher Notes For The Teacher Notes For The Teacher Notes For The Teacher',
      ),
    ).toBe(true);
    expect(isRepeatedPhraseTitle('Notes For The Teacher Notes For The Teacher Notes For The Teacher')).toBe(true);
    expect(isRepeatedPhraseTitle('Diversity in the Living World')).toBe(false);
    expect(isRepeatedPhraseTitle('Lines and Angles')).toBe(false);
  });

  it('a repeated-phrase title flags the chapter even when series and summaries are clean', () => {
    const res = detectContamination({
      ...NO_SIGNAL_BASE,
      chapterTitle: 'Notes For The Teacher Notes For The Teacher Notes For The Teacher',
      series: [],
    });
    expect(res.contaminated).toBe(true);
    expect(res.evidence).toContain('repeated-phrase chapter title (garbled OCR header)');
  });

  it('titleTokenOverlap: title words absent from the corpus → mismatch signal; present → clean', () => {
    const chunks = [chunk('c1', 'Magnetic field lines around a solenoid carry current and exert force.')];
    expect(titleTokenOverlap('Diversity Living World', chunks)).toBe(0);
    const mismatch = detectContamination({
      chapterNumber: 2,
      chapterTitle: 'Diversity Living World',
      series: [],
      summaryBlockCount: 1,
      chunks,
    });
    expect(mismatch.contaminated).toBe(true);
    expect(mismatch.evidence).toContain('chapter title tokens absent from chunk text');

    const match = detectContamination({
      chapterNumber: 13,
      chapterTitle: 'Magnetic Effects of Current',
      series: [],
      summaryBlockCount: 1,
      chunks,
    });
    expect(match.contaminated).toBe(false);
  });

  // Boundary pin added 2026-07-03 (testing review): the flag fires strictly
  // BELOW the ratio, so overlap exactly at TITLE_OVERLAP_MIN_RATIO is clean.
  it(`threshold boundary: overlap exactly at ${TITLE_OVERLAP_MIN_RATIO} is clean; just below flags`, () => {
    const chunks = [chunk('c1', 'The motion of objects is studied in this chapter.')];
    // 4 content tokens (motion/force/energy/work), 1 present → exactly 0.25 → clean
    expect(titleTokenOverlap('Motion Force Energy Work', chunks)).toBe(TITLE_OVERLAP_MIN_RATIO);
    const atBoundary = detectContamination({
      chapterNumber: 8,
      chapterTitle: 'Motion Force Energy Work',
      series: [],
      summaryBlockCount: 1,
      chunks,
    });
    expect(atBoundary.contaminated).toBe(false);
    // 5 content tokens, 1 present → 0.2 < 0.25 → flags
    expect(titleTokenOverlap('Motion Force Energy Work Power', chunks)).toBe(0.2);
    const belowBoundary = detectContamination({
      chapterNumber: 8,
      chapterTitle: 'Motion Force Energy Work Power',
      series: [],
      summaryBlockCount: 1,
      chunks,
    });
    expect(belowBoundary.contaminated).toBe(true);
    expect(belowBoundary.evidence).toContain('chapter title tokens absent from chunk text');
  });

  it('titles with fewer than 2 content tokens yield null overlap (not enough signal — never flags)', () => {
    const chunks = [chunk('c1', 'Completely unrelated prose about angles.')];
    expect(titleTokenOverlap('Light', chunks)).toBeNull();
    const res = detectContamination({ chapterNumber: 10, chapterTitle: 'Light', series: [], summaryBlockCount: 1, chunks });
    expect(res.contaminated).toBe(false);
  });
});

describe('KNOWN LIMITATION (documented): same-major cross-book merge', () => {
  it('g9 "Lines and Angles" case — a foreign chapter that ALSO numbers 6.x is NOT detectable via series majors', () => {
    // Two merged books both using major 6 (geometry Fig 6.1-6.16 + mensuration
    // Fig 6.17-6.55 share the namespace) with only ONE summary captured and an
    // honest title: no v2 signal can fire. Heading-set bimodality is explicitly
    // out of scope for v2.
    const res = detectContamination({
      chapterNumber: 6,
      chapterTitle: 'Lines and Angles',
      series: [series('diagrams', [[6, 55]]), series('examples', [[6, 8]])],
      summaryBlockCount: 1,
      chunks: [chunk('c1', 'Lines and angles, and also perimeter and area of a circle.')],
    });
    expect(res.contaminated).toBe(false);
  });
});

describe('P13: evidence labels only', () => {
  it('every emitted label is short and single-line (never passage text)', () => {
    const res = detectContamination({
      chapterNumber: 6,
      chapterTitle: 'Notes For The Teacher Notes For The Teacher Notes For The Teacher',
      series: [series('diagrams', [[13, 5]]), series('tables', [[9, 3]])],
      summaryBlockCount: 3,
      chunks: [chunk('c1', 'Some very long passage text that must never appear in evidence. '.repeat(20))],
    });
    expect(res.contaminated).toBe(true);
    for (const label of res.evidence) {
      expect(label.length).toBeLessThan(100);
      expect(label).not.toContain('\n');
      expect(label).not.toContain('passage text');
    }
  });
});
