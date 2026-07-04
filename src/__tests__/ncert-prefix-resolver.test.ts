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
  BOOK_ORDER,
  SUPPLEMENTARY_BASE,
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

describe('namespacedChapterNumber — MANIFEST-ALIGNED continuous 1..N', () => {
  // The coverage SSoT `cbse_syllabus` numbers every subject CONTINUOUSLY 1..N
  // across its books, and `recompute_syllabus_status()` joins chunks->syllabus
  // on EXACT (grade, subject, chapter_number). The previous (volumeIndex+1)*100
  // scheme (101, 201, …) matched ZERO manifest rows for every multi-book subject
  // -> orphan chunks, no coverage (assessment REJECT). The chapter_number now
  // lands in that same continuous space via the per-subject BOOK_ORDER table
  // (base = manifest chapters in all preceding books), validated against the
  // live manifest by the ingestion acceptance-gate (34 -> 137 real gap-row flips).

  it('leaves single-volume subjects at their natural chapter number', () => {
    const vols = [{ prefix: 'jesc', bookNumber: 1 }];
    expect(namespacedChapterNumber({ prefix: 'jesc', bookNumber: 1, chapterInBook: 5 }, vols)).toBe(5);
  });

  it('maps a two-book subject into ONE continuous 1..N span (grade-11 Economics)', () => {
    // Manifest: Statistics for Economics (kest) = chapters 1-9, Indian Economic
    // Development (keec) = chapters 10-20. Book ORDER is manifest order (kest
    // first), NOT alphabetical prefix order — so it must come from the table.
    const vols = [
      { prefix: 'keec', bookNumber: 1 },
      { prefix: 'kest', bookNumber: 1 },
    ];
    // Statistics book maps to the natural low span.
    expect(namespacedChapterNumber({ prefix: 'kest', bookNumber: 1, chapterInBook: 1 }, vols)).toBe(1);
    expect(namespacedChapterNumber({ prefix: 'kest', bookNumber: 1, chapterInBook: 9 }, vols)).toBe(9);
    // Indian Econ Dev continues at 10 (base 9), NEVER at 101/201.
    expect(namespacedChapterNumber({ prefix: 'keec', bookNumber: 1, chapterInBook: 1 }, vols)).toBe(10);
    expect(namespacedChapterNumber({ prefix: 'keec', bookNumber: 1, chapterInBook: 8 }, vols)).toBe(17);
  });

  it('maps same-prefix Part 1 / Part 2 volumes cumulatively (grade-11 Physics)', () => {
    // keph vol1 = Part 1 (chapters 1-8), keph vol2 = Part 2 (chapters 9-15).
    const vols = [
      { prefix: 'keph', bookNumber: 1 },
      { prefix: 'keph', bookNumber: 2 },
    ];
    expect(namespacedChapterNumber({ prefix: 'keph', bookNumber: 1, chapterInBook: 7 }, vols)).toBe(7);
    // Part 2 chapter 1 continues at manifest chapter 9 (base 8), not at 201.
    expect(namespacedChapterNumber({ prefix: 'keph', bookNumber: 2, chapterInBook: 1 }, vols)).toBe(9);
    expect(namespacedChapterNumber({ prefix: 'keph', bookNumber: 2, chapterInBook: 7 }, vols)).toBe(15);
  });

  it('maps a three-book subject cumulatively (grade-12 History — Themes I/II/III)', () => {
    // lehs vol1 = Part I (1-4), vol2 = Part II (5-9, base 4), vol3 = Part III (10-15, base 9).
    const vols = [
      { prefix: 'lehs', bookNumber: 1 },
      { prefix: 'lehs', bookNumber: 2 },
      { prefix: 'lehs', bookNumber: 3 },
    ];
    expect(namespacedChapterNumber({ prefix: 'lehs', bookNumber: 1, chapterInBook: 4 }, vols)).toBe(4);
    expect(namespacedChapterNumber({ prefix: 'lehs', bookNumber: 2, chapterInBook: 1 }, vols)).toBe(5);
    expect(namespacedChapterNumber({ prefix: 'lehs', bookNumber: 3, chapterInBook: 1 }, vols)).toBe(10);
    // All distinct, all in the real (<50) manifest span.
    const nums = [
      namespacedChapterNumber({ prefix: 'lehs', bookNumber: 1, chapterInBook: 1 }, vols),
      namespacedChapterNumber({ prefix: 'lehs', bookNumber: 2, chapterInBook: 1 }, vols),
      namespacedChapterNumber({ prefix: 'lehs', bookNumber: 3, chapterInBook: 1 }, vols),
    ];
    expect(new Set(nums).size).toBe(3);
    expect(nums.every(n => n < SUPPLEMENTARY_BASE)).toBe(true);
  });

  it('maps the manifest book but ORPHANS the supplementary reader (grade-10 English)', () => {
    // The manifest models grade-10 English as First Flight (jeff, 11 chapters)
    // ONLY. Footprints without Feet (jefp) and the workbook (jewe) are NOT in
    // the manifest, so they must NOT overwrite First Flight's 1..N and must NOT
    // collide with each other — they go to the orphan namespace (>= 900).
    const vols = [
      { prefix: 'jeff', bookNumber: 1 },
      { prefix: 'jefp', bookNumber: 1 },
      { prefix: 'jewe', bookNumber: 2 },
    ];
    // First Flight lands on real continuous chapters 1..9.
    expect(namespacedChapterNumber({ prefix: 'jeff', bookNumber: 1, chapterInBook: 1 }, vols)).toBe(1);
    expect(namespacedChapterNumber({ prefix: 'jeff', bookNumber: 1, chapterInBook: 9 }, vols)).toBe(9);
    // Footprints + workbook orphan (>= 900), never on a First Flight chapter,
    // and in disjoint bands so they never overwrite each other.
    const fp = namespacedChapterNumber({ prefix: 'jefp', bookNumber: 1, chapterInBook: 1 }, vols);
    const we = namespacedChapterNumber({ prefix: 'jewe', bookNumber: 2, chapterInBook: 1 }, vols);
    expect(fp).toBeGreaterThanOrEqual(SUPPLEMENTARY_BASE);
    expect(we).toBeGreaterThanOrEqual(SUPPLEMENTARY_BASE);
    expect(fp).not.toBe(we);
  });

  it('GATES an un-vetted multi-book subject to the orphan namespace (grade-10 Hindi)', () => {
    // grade-10 Hindi has 5 bucket books (Kshitij/Sparsh/Kritika/Sanchayan/
    // Vyakaran) whose counts + ordering could not be reconciled with the
    // manifest's continuous 1..N with confidence. Rather than emit a wrong /
    // colliding chapter_number, every book is GATED to the orphan namespace.
    expect(BOOK_ORDER['10|hindi']).toBeUndefined();
    const vols = [
      { prefix: 'jhks', bookNumber: 1 },
      { prefix: 'jhsp', bookNumber: 1 },
    ];
    const a = namespacedChapterNumber({ prefix: 'jhks', bookNumber: 1, chapterInBook: 1 }, vols);
    const b = namespacedChapterNumber({ prefix: 'jhsp', bookNumber: 1, chapterInBook: 1 }, vols);
    expect(a).toBeGreaterThanOrEqual(SUPPLEMENTARY_BASE);
    expect(b).toBeGreaterThanOrEqual(SUPPLEMENTARY_BASE);
    expect(a).not.toBe(b); // GATED books still never overwrite each other
  });

  it('never emits a *100 offset for any multi-book subject (regression pin)', () => {
    // Explicit guard against the rejected scheme: no mapping may produce 101/201.
    const econ = [{ prefix: 'kest', bookNumber: 1 }, { prefix: 'keec', bookNumber: 1 }];
    for (const ch of [1, 2, 3]) {
      expect(namespacedChapterNumber({ prefix: 'keec', bookNumber: 1, chapterInBook: ch }, econ)).toBeLessThan(100);
      expect(namespacedChapterNumber({ prefix: 'kest', bookNumber: 1, chapterInBook: ch }, econ)).toBeLessThan(100);
    }
  });

  it('BOOK_ORDER bases are cumulative and manifest-derived (no *100)', () => {
    for (const [key, slots] of Object.entries(BOOK_ORDER)) {
      // First listed book always starts at base 0 (natural low span).
      expect(slots[0].base).toBe(0);
      for (const s of slots) {
        // Bases live in the real continuous span, never the orphan namespace.
        expect(s.base).toBeGreaterThanOrEqual(0);
        expect(s.base).toBeLessThan(SUPPLEMENTARY_BASE);
        // A book's base is never a *100 offset artifact.
        expect(s.base % 100 === 1).toBe(false);
      }
      // Bases are non-decreasing in manifest order.
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i].base).toBeGreaterThanOrEqual(slots[i - 1].base);
      }
      expect(key).toMatch(/^\d+\|[a-z_]+$/);
    }
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
