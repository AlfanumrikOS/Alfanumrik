/**
 * Tests for the NCERT filename-prefix resolver used by the Storage ingestion
 * pipeline (`scripts/ncert-ingestion/storage-ingest.ts`).
 *
 * The resolver is the fix for ~341 un-ingested CBSE chapters: NCERT filenames
 * deterministically encode class + subject + volume + chapter, so discovery no
 * longer depends on the messy Supabase Storage folder names. These tests pin:
 *   1. prefix -> (grade, subject_code) for every covered subject, incl. the 8
 *      senior subjects the old SUBJECT_MAP omitted;
 *   2. unknown / ambiguous prefixes -> null (skip);
 *   3. chapter-part extraction + collision-free multi-book namespacing;
 *   4. asset/prelim skipping;
 *   5. the mojibake SKIP-not-write guard for Indic subjects.
 *
 * subject_code values MUST equal the codes in public.cbse_syllabus.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveNcertFilename,
  extractChapterParts,
  isSkippableAsset,
  namespacedChapterNumber,
  dedupeVolumes,
  languageForSubject,
  GRADE_BY_CLASS_CHAR,
  PREFIX_SUBJECT_MAP,
  SUBJECT_DISPLAY,
  type ResolveFailure,
} from '../../scripts/ncert-ingestion/prefix-resolver';
import { findMojibakeOffenders } from '../../scripts/ncert-ingestion/mojibake';

describe('GRADE_BY_CLASS_CHAR — class letter to grade', () => {
  it('maps f..l to grades 6..12', () => {
    expect(GRADE_BY_CLASS_CHAR).toMatchObject({
      f: '6', g: '7', h: '8', i: '9', j: '10', k: '11', l: '12',
    });
  });
});

describe('resolveNcertFilename — grade + subject from filename', () => {
  const cases: Array<[string, string, string]> = [
    // [filename, expectedGrade, expectedSubjectCode]
    // Core (previously reachable)
    ['jemh103.pdf', '10', 'math'],
    ['jesc105.pdf', '10', 'science'],
    ['jess102.pdf', '10', 'social_studies'],
    ['jeff101.pdf', '10', 'english'],
    ['jhks104.pdf', '10', 'hindi'],
    ['jhsk108.pdf', '10', 'sanskrit'],
    ['kemh101.pdf', '11', 'math'],
    ['keph112.pdf', '11', 'physics'],
    ['kech106.pdf', '11', 'chemistry'],
    ['kebo117.pdf', '11', 'biology'],
    ['kecs103.pdf', '11', 'computer_science'],
    ['keip102.pdf', '11', 'informatics_practices'],
    // New-syllabus middle grades (Cluster C prefixes)
    ['fecu101.pdf', '6', 'science'],
    ['fees103.pdf', '6', 'social_studies'],
    ['fegp107.pdf', '6', 'math'],
    ['fepr105.pdf', '6', 'english'],
    ['fhml112.pdf', '6', 'hindi'],
    ['fsde102.pdf', '6', 'sanskrit'],
    ['iemh114.pdf', '9', 'math'],
    ['ihsh116.pdf', '9', 'sanskrit'],
    // The 8 senior subjects the OLD SUBJECT_MAP omitted (Cluster B)
    ['keec103.pdf', '11', 'economics'],
    ['leec114.pdf', '12', 'economics'],
    ['kest101.pdf', '11', 'economics'],        // Statistics for Economics
    ['kegy116.pdf', '11', 'geography'],
    ['legy209.pdf', '12', 'geography'],
    ['kehs108.pdf', '11', 'history_sr'],
    ['lehs301.pdf', '12', 'history_sr'],
    ['keps105.pdf', '11', 'political_science'],
    ['leps201.pdf', '12', 'political_science'],
    ['keac107.pdf', '11', 'accountancy'],
    ['leac112.pdf', '12', 'accountancy'],
    ['kebs110.pdf', '11', 'business_studies'],
    ['lebs113.pdf', '12', 'business_studies'],
    ['kesy106.pdf', '11', 'sociology'],
    ['kepy108.pdf', '11', 'psychology'],
    // Other senior electives present in the bucket
    ['kefa109.pdf', '11', 'fine_arts'],
    ['kehe204.pdf', '11', 'home_science'],
    ['kehp111.pdf', '11', 'health_fitness'],
  ];

  it.each(cases)('%s -> grade %s, subject %s', (file, grade, subject) => {
    const r = resolveNcertFilename(file);
    expect(r).not.toBeNull();
    expect(r!.grade).toBe(grade);
    expect(r!.subjectCode).toBe(subject);
    expect(r!.gradeDb).toBe(`Grade ${grade}`);
  });

  it('covers all 8 newly-added senior subjects with cbse_syllabus codes', () => {
    const added = [
      'economics', 'geography', 'history_sr', 'political_science',
      'accountancy', 'business_studies', 'sociology', 'psychology',
    ];
    const mapped = new Set(Object.values(PREFIX_SUBJECT_MAP));
    for (const code of added) expect(mapped.has(code)).toBe(true);
  });

  it('every mapped subject_code has a display name', () => {
    for (const code of new Set(Object.values(PREFIX_SUBJECT_MAP))) {
      expect(SUBJECT_DISPLAY[code]).toBeTruthy();
    }
  });

  it('disambiguates the "sp" collision by full prefix (Snapshots-en vs Sparsh-hi)', () => {
    expect(resolveNcertFilename('kesp103.pdf')!.subjectCode).toBe('english'); // Snapshots
    expect(resolveNcertFilename('ihsp104.pdf')!.subjectCode).toBe('hindi');   // Sparsh
  });

  it('disambiguates the "sy" collision (Sanchayan-hi cl10 vs Sociology cl11)', () => {
    expect(resolveNcertFilename('jhsy102.pdf')!.subjectCode).toBe('hindi');
    expect(resolveNcertFilename('kesy102.pdf')!.subjectCode).toBe('sociology');
  });
});

describe('resolveNcertFilename — unknown / ambiguous / asset -> null', () => {
  it('returns null and reports unknown_prefix for an unmapped prefix', () => {
    const fail = { value: null as ResolveFailure | null };
    expect(resolveNcertFilename('zzxx101.pdf', fail)).toBeNull();
    expect(fail.value?.reason).toBe('unknown_prefix');
    expect(fail.value?.prefix).toBe('zzxx');
  });

  it('returns null for an unmapped but valid-looking class char', () => {
    // 'ke??' style prefix not in the table
    const fail = { value: null as ResolveFailure | null };
    expect(resolveNcertFilename('kexx105.pdf', fail)).toBeNull();
    expect(fail.value?.reason).toBe('unknown_prefix');
  });

  it('returns null (asset) for prelim/answer/glossary files', () => {
    const fail = { value: null as ResolveFailure | null };
    for (const f of ['keac1ps.pdf', 'keec1gl.pdf', 'kepy1gl.pdf', 'kemh1an.pdf', 'kemh1sm.pdf', 'kemh1a1.pdf', 'legy2a1.pdf']) {
      expect(resolveNcertFilename(f, fail)).toBeNull();
      expect(fail.value?.reason).toBe('not_pdf_or_asset');
    }
  });

  it('returns null for non-PDF and cover images', () => {
    expect(resolveNcertFilename('jemh1cc.jpg')).toBeNull();
    expect(resolveNcertFilename('readme.txt')).toBeNull();
  });

  it('returns null with reason no_chapter_number for a mapped prefix at chapter 0', () => {
    // keec100.pdf: prefix `keec` (Economics cl11) IS mapped and the stem is
    // chapter-shaped (alpha+digits), so it survives the asset guard — the ONLY
    // way it fails is the third branch: extractChapterParts -> null (chapter 00).
    // This pins the `no_chapter_number` ResolveFailure reason end-to-end, which
    // the asset/unknown-prefix cases above never reach.
    const fail = { value: null as ResolveFailure | null };
    expect(resolveNcertFilename('keec100.pdf', fail)).toBeNull();
    expect(fail.value?.reason).toBe('no_chapter_number');
    expect(fail.value?.prefix).toBe('keec');
    // A single-volume digit-tail at chapter 0 fails the same way.
    expect(resolveNcertFilename('jesc00.pdf', fail)).toBeNull();
    expect(fail.value?.reason).toBe('no_chapter_number');
  });
});

describe('isSkippableAsset', () => {
  it('keeps real chapter PDFs', () => {
    for (const f of ['keec103.pdf', 'legy209.pdf', 'leac101..pdf' /* trailing dot */]) {
      expect(isSkippableAsset(f)).toBe(false);
    }
  });
  it('skips assets, appendices, non-PDFs', () => {
    for (const f of ['keac1ps.pdf', 'kemh1a1.pdf', 'kemh1a2.pdf', 'keec1gl.pdf', 'kepy1gl.pdf', 'jemh1cc.jpg', 'cover.png']) {
      expect(isSkippableAsset(f)).toBe(true);
    }
  });
});

describe('extractChapterParts — volume + chapter', () => {
  it('splits <volume><2-digit chapter>', () => {
    expect(extractChapterParts('keec103.pdf')).toEqual({ bookNumber: 1, chapterInBook: 3 });
    expect(extractChapterParts('legy209.pdf')).toEqual({ bookNumber: 2, chapterInBook: 9 });
    expect(extractChapterParts('iemh114.pdf')).toEqual({ bookNumber: 1, chapterInBook: 14 });
    expect(extractChapterParts('lehs301.pdf')).toEqual({ bookNumber: 3, chapterInBook: 1 });
  });
  it('tolerates trailing dots (leac101..pdf)', () => {
    expect(extractChapterParts('leac101..pdf')).toEqual({ bookNumber: 1, chapterInBook: 1 });
  });
  it('returns null for chapter 0 or no digits', () => {
    expect(extractChapterParts('keec100.pdf')).toBeNull(); // ch 00
    expect(extractChapterParts('keec.pdf')).toBeNull();
  });
});

describe('namespacedChapterNumber — collision-free multi-book', () => {
  it('leaves single-volume subjects at their natural chapter number', () => {
    const vols = [{ prefix: 'jesc', bookNumber: 1 }];
    expect(namespacedChapterNumber({ prefix: 'jesc', bookNumber: 1, chapterInBook: 5 }, vols)).toBe(5);
  });

  it('namespaces English reader vs supplementary so ch1 does not overwrite ch1', () => {
    // First Flight (jeff) + Footprints (jefp), both volume 1, both chapter 1.
    const vols = [
      { prefix: 'jeff', bookNumber: 1 },
      { prefix: 'jefp', bookNumber: 1 },
    ];
    const ff = namespacedChapterNumber({ prefix: 'jeff', bookNumber: 1, chapterInBook: 1 }, vols);
    const fp = namespacedChapterNumber({ prefix: 'jefp', bookNumber: 1, chapterInBook: 1 }, vols);
    expect(ff).not.toBe(fp);
    // Lock the exact scheme, not just "differ": once a group is multi-volume the
    // FIRST book is ALSO offset (100 + ch), never left at its natural number.
    // dedupeVolumes sorts jeff < jefp, so jeff=index0 -> 101, jefp=index1 -> 201.
    expect(ff).toBe(101);
    expect(fp).toBe(201);
  });

  it('namespaces multi-volume Geography (vol1/2/3) collision-free', () => {
    const vols = [
      { prefix: 'legy', bookNumber: 1 },
      { prefix: 'legy', bookNumber: 2 },
      { prefix: 'legy', bookNumber: 3 },
    ];
    const nums = [
      namespacedChapterNumber({ prefix: 'legy', bookNumber: 1, chapterInBook: 1 }, vols),
      namespacedChapterNumber({ prefix: 'legy', bookNumber: 2, chapterInBook: 1 }, vols),
      namespacedChapterNumber({ prefix: 'legy', bookNumber: 3, chapterInBook: 1 }, vols),
    ];
    expect(new Set(nums).size).toBe(3); // all distinct
    // Exact scheme: (volumeIndex + 1) * 100 + chapterInBook.
    expect(nums).toEqual([101, 201, 301]);
    // Chapter offset rides through: legy vol2 ch9 -> 209.
    expect(namespacedChapterNumber({ prefix: 'legy', bookNumber: 2, chapterInBook: 9 }, vols)).toBe(209);
  });

  it('dedupeVolumes is stable + sorted', () => {
    const out = dedupeVolumes([
      { prefix: 'jefp', bookNumber: 1 },
      { prefix: 'jeff', bookNumber: 1 },
      { prefix: 'jeff', bookNumber: 1 }, // dup
    ]);
    expect(out).toEqual([
      { prefix: 'jeff', bookNumber: 1 },
      { prefix: 'jefp', bookNumber: 1 },
    ]);
  });
});

describe('languageForSubject', () => {
  it('tags hindi=hi, sanskrit=sa, else en', () => {
    expect(languageForSubject('hindi')).toBe('hi');
    expect(languageForSubject('sanskrit')).toBe('sa');
    expect(languageForSubject('economics')).toBe('en');
    expect(languageForSubject('math')).toBe('en');
  });
});

describe('mojibake SKIP-not-write guard (findMojibakeOffenders)', () => {
  it('flags Krutidev garbage for Indic subject_code so the file is SKIPPED', () => {
    const offenders = findMojibakeOffenders(
      [{ chapter_title: 'R`Rh;%', chunk_text: 'Prqfkz%' }],
      'hindi'
    );
    expect(offenders.length).toBeGreaterThan(0);
  });

  it('is silent for clean Devanagari (real Hindi/Sanskrit content is written)', () => {
    expect(findMojibakeOffenders([{ chunk_text: 'यह एक उदाहरण वाक्य है।' }], 'sanskrit')).toEqual([]);
  });

  it('never fires on English subjects even with % / ; punctuation', () => {
    expect(findMojibakeOffenders([{ chunk_text: 'Newton said: F=ma; hence 50% done' }], 'english')).toEqual([]);
    // English resolves to language en, subject_code english is non-Indic.
    expect(resolveNcertFilename('jeff101.pdf')!.language).toBe('en');
  });
});
