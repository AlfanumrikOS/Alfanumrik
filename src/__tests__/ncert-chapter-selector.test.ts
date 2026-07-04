/**
 * Tests for the NCERT ingestion chapter selector
 * (`scripts/ncert-ingestion/chapter-selector.ts`).
 *
 * The selector is the staged-scoping filter that lets the ~967-chapter
 * Storage→DB re-ingestion run per-subject, safely and resumably, instead of
 * all-or-nothing. These tests pin:
 *   1. no filters  -> every chapter selected (unchanged all-or-nothing behavior)
 *   2. --grade     -> intersect on grade (repeatable / multi-value)
 *   3. --subject   -> intersect on subject_code
 *   4. grade + subject compose (AND)
 *   5. --only-missing excludes chapters already covered (chunk_count > 0)
 *   6. --only-missing without a covered set keeps everything
 *   7. coverageKey() shape (grade|subject_code|chapter_number)
 *   8. idempotent-resume semantics: re-running after a partial run drops the
 *      chapters that already landed coverage.
 *   9. the selector carries the full payload through (generic passthrough).
 */

import { describe, it, expect } from 'vitest';
import {
  selectChaptersToIngest,
  coverageKey,
  type ChapterCoordinate,
} from '../../scripts/ncert-ingestion/chapter-selector';

// A representative resolved-chapter fixture spanning grades + subjects, shaped
// like the projection storage-ingest.ts feeds the selector.
type Chapter = ChapterCoordinate & { file: string };

const CHAPTERS: Chapter[] = [
  { grade: '11', subjectCode: 'economics', chapterNumber: 1, file: 'kest101.pdf' }, // Statistics ch1
  { grade: '11', subjectCode: 'economics', chapterNumber: 10, file: 'keec101.pdf' }, // Indian Econ Dev ch1 (base 9 + 1)
  { grade: '11', subjectCode: 'physics', chapterNumber: 1, file: 'keph101.pdf' },
  { grade: '11', subjectCode: 'physics', chapterNumber: 9, file: 'keph201.pdf' },
  { grade: '12', subjectCode: 'economics', chapterNumber: 1, file: 'leec101.pdf' },
  { grade: '12', subjectCode: 'chemistry', chapterNumber: 1, file: 'lech101.pdf' },
  { grade: '6', subjectCode: 'math', chapterNumber: 1, file: 'fegp101.pdf' },
];

describe('coverageKey — chapter identity', () => {
  it('is grade|subject_code|chapter_number', () => {
    expect(coverageKey({ grade: '11', subjectCode: 'economics', chapterNumber: 10 }))
      .toBe('11|economics|10');
  });

  it('distinguishes chapters that differ only by chapter number', () => {
    const a = coverageKey({ grade: '11', subjectCode: 'economics', chapterNumber: 1 });
    const b = coverageKey({ grade: '11', subjectCode: 'economics', chapterNumber: 10 });
    expect(a).not.toBe(b);
  });
});

describe('selectChaptersToIngest — no filters', () => {
  it('returns every chapter unchanged (all-or-nothing behavior preserved)', () => {
    expect(selectChaptersToIngest(CHAPTERS)).toEqual(CHAPTERS);
    expect(selectChaptersToIngest(CHAPTERS, {})).toEqual(CHAPTERS);
  });

  it('treats empty filter arrays as "no filter"', () => {
    const out = selectChaptersToIngest(CHAPTERS, { grades: [], subjects: [] });
    expect(out).toHaveLength(CHAPTERS.length);
  });

  it('only-missing with no covered set keeps everything', () => {
    const out = selectChaptersToIngest(CHAPTERS, { onlyMissing: true });
    expect(out).toHaveLength(CHAPTERS.length);
  });
});

describe('selectChaptersToIngest — grade filter', () => {
  it('keeps only the requested grade', () => {
    const out = selectChaptersToIngest(CHAPTERS, { grades: ['11'] });
    expect(out.every(c => c.grade === '11')).toBe(true);
    expect(out).toHaveLength(4);
  });

  it('supports multiple grades (repeatable / comma-separated)', () => {
    const out = selectChaptersToIngest(CHAPTERS, { grades: ['11', '12'] });
    expect(new Set(out.map(c => c.grade))).toEqual(new Set(['11', '12']));
    expect(out.some(c => c.grade === '6')).toBe(false);
  });

  it('returns empty when no chapter matches the grade', () => {
    expect(selectChaptersToIngest(CHAPTERS, { grades: ['9'] })).toHaveLength(0);
  });
});

describe('selectChaptersToIngest — subject filter', () => {
  it('keeps only the requested subject_code', () => {
    const out = selectChaptersToIngest(CHAPTERS, { subjects: ['economics'] });
    expect(out.every(c => c.subjectCode === 'economics')).toBe(true);
    expect(out).toHaveLength(3); // g11 x2 + g12 x1
  });

  it('supports multiple subjects', () => {
    const out = selectChaptersToIngest(CHAPTERS, { subjects: ['physics', 'chemistry'] });
    expect(new Set(out.map(c => c.subjectCode))).toEqual(new Set(['physics', 'chemistry']));
  });
});

describe('selectChaptersToIngest — grade + subject compose (AND)', () => {
  it('intersects both filters', () => {
    const out = selectChaptersToIngest(CHAPTERS, { grades: ['11'], subjects: ['economics'] });
    expect(out).toHaveLength(2);
    expect(out.every(c => c.grade === '11' && c.subjectCode === 'economics')).toBe(true);
    expect(out.map(c => c.chapterNumber).sort((a, b) => a - b)).toEqual([1, 10]);
  });
});

describe('selectChaptersToIngest — only-missing', () => {
  it('drops chapters already covered (chunk_count > 0)', () => {
    const covered = new Set<string>([
      '11|economics|1',   // Statistics ch1 already ingested
      '11|physics|1',
    ]);
    const out = selectChaptersToIngest(CHAPTERS, { onlyMissing: true, existingCoverage: covered });
    expect(out.some(c => coverageKey(c) === '11|economics|1')).toBe(false);
    expect(out.some(c => coverageKey(c) === '11|physics|1')).toBe(false);
    // uncovered gap chapters remain
    expect(out.some(c => coverageKey(c) === '11|economics|10')).toBe(true);
    expect(out).toHaveLength(CHAPTERS.length - 2);
  });

  it('with syllabusChapters gate, drops orphan / non-manifest chapters', () => {
    const orphan: Chapter = { grade: '11', subjectCode: 'english', chapterNumber: 901, file: 'kesp101.pdf' };
    const withOrphan = [...CHAPTERS, orphan];
    // syllabus registry lists every real manifest row EXCEPT the orphan (901).
    const syllabus = new Set<string>(CHAPTERS.map(coverageKey));
    const covered = new Set<string>(); // nothing covered yet
    const out = selectChaptersToIngest(withOrphan, {
      onlyMissing: true, existingCoverage: covered, syllabusChapters: syllabus,
    });
    // orphan has no syllabus row -> excluded even though it is un-covered.
    expect(out.some(c => coverageKey(c) === '11|english|901')).toBe(false);
    // every real manifest row is kept.
    expect(out).toHaveLength(CHAPTERS.length);
  });

  it('gap set = syllabus \\ covered when both provided', () => {
    const syllabus = new Set<string>(CHAPTERS.map(coverageKey));
    const covered = new Set<string>(['11|economics|1', '12|chemistry|1']);
    const out = selectChaptersToIngest(CHAPTERS, {
      onlyMissing: true, existingCoverage: covered, syllabusChapters: syllabus,
    });
    expect(out).toHaveLength(CHAPTERS.length - covered.size);
    expect(out.some(c => coverageKey(c) === '11|economics|1')).toBe(false);
    expect(out.some(c => coverageKey(c) === '12|chemistry|1')).toBe(false);
  });

  it('is a no-op when onlyMissing is false even if a covered set is passed', () => {
    const covered = new Set<string>(['11|economics|1']);
    const out = selectChaptersToIngest(CHAPTERS, { existingCoverage: covered });
    expect(out).toHaveLength(CHAPTERS.length);
  });

  it('composes with grade/subject: scoped gap chapters only', () => {
    const covered = new Set<string>(['11|economics|1']); // Statistics ch1 done
    const out = selectChaptersToIngest(CHAPTERS, {
      grades: ['11'], subjects: ['economics'],
      onlyMissing: true, existingCoverage: covered,
    });
    // Of the two g11-economics chapters, ch1 is covered -> only ch10 remains.
    expect(out).toHaveLength(1);
    expect(coverageKey(out[0])).toBe('11|economics|10');
  });
});

describe('selectChaptersToIngest — idempotent resume', () => {
  it('a re-run after a partial ingest drops the newly-covered chapters', () => {
    // First scoped pass: nothing covered yet -> all g11-economics targeted.
    const firstPass = selectChaptersToIngest(CHAPTERS, {
      grades: ['11'], subjects: ['economics'],
      onlyMissing: true, existingCoverage: new Set(),
    });
    expect(firstPass).toHaveLength(2);

    // Simulate the run getting killed after ch1 landed chunks -> coverage grows.
    const coveredAfterKill = new Set<string>(['11|economics|1']);
    const secondPass = selectChaptersToIngest(CHAPTERS, {
      grades: ['11'], subjects: ['economics'],
      onlyMissing: true, existingCoverage: coveredAfterKill,
    });
    // Resumed run only re-targets the chapter that did NOT complete.
    expect(secondPass).toHaveLength(1);
    expect(coverageKey(secondPass[0])).toBe('11|economics|10');
  });
});

describe('selectChaptersToIngest — payload passthrough', () => {
  it('carries the full item through the filter (generic)', () => {
    const out = selectChaptersToIngest(CHAPTERS, { grades: ['6'] });
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe('fegp101.pdf');
  });

  it('does not mutate the input array', () => {
    const copy = [...CHAPTERS];
    selectChaptersToIngest(CHAPTERS, { grades: ['11'], onlyMissing: true, existingCoverage: new Set(['11|physics|1']) });
    expect(CHAPTERS).toEqual(copy);
  });
});
