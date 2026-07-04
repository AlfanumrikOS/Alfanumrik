/**
 * ALFANUMRIK — NCERT filename-prefix resolver (pure, no I/O)
 *
 * NCERT PDF filenames deterministically encode class + medium + subject/book +
 * volume + chapter, e.g.:
 *
 *   keec101.pdf   ->  k(class 11) e(English medium) ec(Economics) 1(book/vol 1) 01(chapter 1)
 *   jeff103.pdf   ->  j(class 10) e(English) ff(First Flight) 1 03  -> chapter 3
 *   legy209.pdf   ->  l(class 12) e(English) gy(Geography) 2(book 2) 09 -> book2 chapter 9
 *   fhml107.pdf   ->  f(class 6)  h(Hindi)   ml(Malhar)     1 07
 *   ihsh116.pdf   ->  i(class 9)  h          sh(Shemushi Sanskrit) 1 16
 *
 * The FOLDER names in Supabase Storage are messy and unreliable ("Accounts XI",
 * "new Sy English", "Arts XII", loose root PDFs). The FILENAME prefix is not.
 * This resolver keys off the filename so discovery is robust to folder chaos.
 *
 * Design:
 *  - char[0]  -> grade   (f=6 … l=12), deterministic.
 *  - the leading 4-letter alpha prefix -> subject_code, via an explicit table
 *    built from the observed `ncert-books` bucket. Keying on the FULL 4-letter
 *    prefix (not just the 2-letter subject/book code) makes it collision-free:
 *    "sp" is Snapshots (English) in `kesp` but Sparsh (Hindi) in `ihsp`; the
 *    full prefix disambiguates.
 *  - trailing digits -> <volume><2-digit chapter>.
 *
 * subject_code values are the EXACT codes used by `public.cbse_syllabus`
 * (verified against the live table: economics, geography, history_sr,
 * political_science, accountancy, business_studies, sociology, psychology,
 * fine_arts, home_science, health_fitness, math, science, english, hindi,
 * sanskrit, social_studies, physics, chemistry, biology, computer_science,
 * informatics_practices).
 *
 * Pure module — no env, no side effects. Safe to import from unit tests.
 */

// ─── Grade from class char ───────────────────────────────────────────────────

export const GRADE_BY_CLASS_CHAR: Readonly<Record<string, string>> = {
  f: '6',
  g: '7',
  h: '8',
  i: '9',
  j: '10',
  k: '11',
  l: '12',
};

// ─── Full-prefix → subject_code (cbse_syllabus codes) ────────────────────────
// Keyed on the lowercased 4-letter leading prefix. Collision-free by design.

export const PREFIX_SUBJECT_MAP: Readonly<Record<string, string>> = {
  // ── New-syllabus (NEP) middle grades 6-8: Curiosity/Exploring Society/
  //    Ganita Prakash/Poorvi/Malhar/Deepakam ────────────────────────────────
  fecu: 'science',        fees: 'social_studies', fegp: 'math',
  fepr: 'english',        fhml: 'hindi',          fsde: 'sanskrit',
  gecu: 'science',        gees: 'social_studies', gegp: 'math',
  gepr: 'english',        ghml: 'hindi',          gsde: 'sanskrit',
  hecu: 'science',        hees: 'social_studies', hegp: 'math',
  hepr: 'english',        hhml: 'hindi',          hsde: 'sanskrit',

  // ── Class 9 (i) ───────────────────────────────────────────────────────────
  iemh: 'math',           iesc: 'science',        iess: 'social_studies',
  iebe: 'english',        // Beehive
  iemo: 'english',        // Moments (supplementary)
  iewe: 'english',        // Words and Expressions (workbook)
  ihkr: 'hindi',          // Kritika
  ihks: 'hindi',          // Kshitij
  ihsa: 'hindi',          // Sanchayan
  ihsp: 'hindi',          // Sparsh
  ihsh: 'sanskrit',       // Shemushi
  isab: 'sanskrit',       // Abhyaswaan Bhav

  // ── Class 10 (j) ──────────────────────────────────────────────────────────
  jemh: 'math',           jesc: 'science',        jess: 'social_studies',
  jeff: 'english',        // First Flight
  jefp: 'english',        // Footprints without Feet (supplementary)
  jewe: 'english',        // Words and Expressions (workbook)
  jhkr: 'hindi',          // Kritika
  jhks: 'hindi',          // Kshitij
  jhsp: 'hindi',          // Sparsh
  jhsy: 'hindi',          // Sanchayan
  jhva: 'hindi',          // Vyakaran / Vyakaranvithi
  jhsk: 'sanskrit',       // Shemushi (cl 10)
  jsab: 'sanskrit',       // Abhyaswaan Bhav

  // ── Class 11 (k) ──────────────────────────────────────────────────────────
  kemh: 'math',           keph: 'physics',        kech: 'chemistry',
  kebo: 'biology',        kecs: 'computer_science', keip: 'informatics_practices',
  keac: 'accountancy',    kebs: 'business_studies', keec: 'economics',
  kest: 'economics',      // Statistics for Economics
  kegy: 'geography',      kehs: 'history_sr',     keps: 'political_science',
  kesy: 'sociology',      kepy: 'psychology',     kefa: 'fine_arts',
  kehe: 'home_science',   // Human Ecology and Family Sciences
  kehp: 'health_fitness',
  kehb: 'english',        // Hornbill
  kesp: 'english',        // Snapshots
  keww: 'english',        // Woven Words (elective)
  kham: 'hindi',          // Aroh
  khan: 'hindi',          // Antra / Antral
  khar: 'hindi',          // Aroh
  khat: 'hindi',          // Antral
  khvt: 'hindi',          // Vitan

  // ── Class 12 (l) ──────────────────────────────────────────────────────────
  lemh: 'math',           leph: 'physics',        lech: 'chemistry',
  lebo: 'biology',        lecs: 'computer_science', leip: 'informatics_practices',
  leac: 'accountancy',    lebs: 'business_studies', leec: 'economics',
  legy: 'geography',      lehs: 'history_sr',     leps: 'political_science',
  lefl: 'english',        // Flamingo
  levt: 'english',        // Vistas
  lekl: 'english',        // Kaleidoscope (elective)
};

// ─── subject_code → display name (matches cbse_syllabus.subject_display) ──────

export const SUBJECT_DISPLAY: Readonly<Record<string, string>> = {
  math: 'Mathematics',
  science: 'Science',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  english: 'English',
  hindi: 'Hindi',
  sanskrit: 'Sanskrit',
  social_studies: 'Social Studies',
  economics: 'Economics',
  geography: 'Geography',
  history_sr: 'History',
  political_science: 'Political Science',
  accountancy: 'Accountancy',
  business_studies: 'Business Studies',
  sociology: 'Sociology',
  psychology: 'Psychology',
  fine_arts: 'Fine Arts',
  home_science: 'Home Science',
  health_fitness: 'Health and Fitness',
  computer_science: 'Computer Science',
  informatics_practices: 'Informatics Practices',
};

// subject_code → mojibake/language tag. Indic codes match INDIC_SUBJECT_LANGUAGES
// in mojibake.ts (which keys on 'hindi' / 'sanskrit').
export function languageForSubject(subjectCode: string): 'en' | 'hi' | 'sa' {
  if (subjectCode === 'hindi') return 'hi';
  if (subjectCode === 'sanskrit') return 'sa';
  return 'en';
}

// ─── Skippable non-chapter assets ────────────────────────────────────────────
// A real chapter file is ALWAYS <alpha-prefix><trailing-digits>, e.g. "keec103".
// Everything else in the corpus is a prelim / answers / glossary / supplementary
// / appendix / cover asset whose stem carries letters AFTER the digits:
//   keac1ps, keec1gl, kepy1gl, kemh1an, kemh1sm  (…<digit><2 letters>)
//   kemh1a1, kemh1a2, legy1a1, iebe1a1           (appendices: …<digit><letter><digit>)
// and non-PDF covers (cc.jpg). Rather than enumerate every asset suffix, we
// keep only pure alpha-then-digits stems.
const NON_CHAPTER_EXT_RE = /\.(?:jpg|jpeg|png|gif|zip)$/i;

/** True for files that are not a chapter PDF (assets, prelims, non-PDF). */
export function isSkippableAsset(fileName: string): boolean {
  const lower = fileName.toLowerCase().trim();
  if (NON_CHAPTER_EXT_RE.test(lower)) return true;
  if (!lower.endsWith('.pdf')) return true;
  // Strip .pdf and any trailing dots (some files are e.g. "leac101..pdf").
  const stem = lower.replace(/\.pdf$/, '').replace(/\.+$/, '');
  // Chapter files: alpha prefix followed by pure digits, nothing after.
  return !/^[a-z]+\d+$/.test(stem);
}

// ─── Chapter-part extraction ─────────────────────────────────────────────────

export interface ChapterParts {
  bookNumber: number;   // volume digit (1, 2, 3 …)
  chapterInBook: number; // 1..N within that volume
}

/**
 * Extract <volume><2-digit chapter> from the trailing digits.
 *   keec103  -> { bookNumber: 1, chapterInBook: 3 }
 *   legy209  -> { bookNumber: 2, chapterInBook: 9 }
 *   iemh114  -> { bookNumber: 1, chapterInBook: 14 }
 * Returns null when there is no parseable trailing number.
 */
export function extractChapterParts(fileName: string): ChapterParts | null {
  const stem = fileName.toLowerCase().replace(/\.pdf$/, '').replace(/\.+$/, '');
  // leading alpha prefix, then a run of digits at the end
  const m = stem.match(/^[a-z]+(\d+)$/);
  if (!m) return null;
  const digits = m[1];
  if (digits.length >= 3) {
    // last 2 = chapter, everything before = volume
    const chapterInBook = parseInt(digits.slice(-2), 10);
    const bookNumber = parseInt(digits.slice(0, -2), 10);
    if (chapterInBook === 0) return null; // chapter 0 is not a real chapter
    return { bookNumber: bookNumber || 1, chapterInBook };
  }
  // 1-2 digit tail: treat as single-volume chapter number
  const chapterInBook = parseInt(digits, 10);
  if (chapterInBook === 0) return null;
  return { bookNumber: 1, chapterInBook };
}

// ─── Full resolution ─────────────────────────────────────────────────────────

export interface ResolvedFile {
  grade: string;          // "6".."12"
  gradeDb: string;        // "Grade 6" … "Grade 12"
  subjectCode: string;    // cbse_syllabus.subject_code
  subjectDisplay: string; // cbse_syllabus.subject_display
  language: 'en' | 'hi' | 'sa';
  prefix: string;         // 4-letter book code, e.g. "jeff"
  bookNumber: number;
  chapterInBook: number;
}

export interface ResolveFailure {
  reason: 'not_pdf_or_asset' | 'unknown_prefix' | 'no_chapter_number';
  prefix: string | null;
}

/**
 * Resolve an NCERT filename to (grade, subject, book, chapter).
 * Returns null on any failure; pass an out-param to capture the reason.
 */
export function resolveNcertFilename(
  fileName: string,
  failure?: { value: ResolveFailure | null }
): ResolvedFile | null {
  const setFail = (f: ResolveFailure) => { if (failure) failure.value = f; };

  if (isSkippableAsset(fileName)) {
    setFail({ reason: 'not_pdf_or_asset', prefix: null });
    return null;
  }

  const stem = fileName.toLowerCase().replace(/\.pdf$/, '').replace(/\.+$/, '');
  const prefixMatch = stem.match(/^([a-z]+)/);
  const prefix = prefixMatch ? prefixMatch[1].slice(0, 4) : null;

  if (!prefix || !(prefix in PREFIX_SUBJECT_MAP)) {
    setFail({ reason: 'unknown_prefix', prefix });
    return null;
  }

  const classChar = prefix[0];
  const grade = GRADE_BY_CLASS_CHAR[classChar];
  if (!grade) {
    setFail({ reason: 'unknown_prefix', prefix });
    return null;
  }

  const parts = extractChapterParts(fileName);
  if (!parts) {
    setFail({ reason: 'no_chapter_number', prefix });
    return null;
  }

  const subjectCode = PREFIX_SUBJECT_MAP[prefix];
  if (failure) failure.value = null;
  return {
    grade,
    gradeDb: `Grade ${grade}`,
    subjectCode,
    subjectDisplay: SUBJECT_DISPLAY[subjectCode] ?? subjectCode,
    language: languageForSubject(subjectCode),
    prefix,
    bookNumber: parts.bookNumber,
    chapterInBook: parts.chapterInBook,
  };
}

// ─── Multi-book chapter namespacing (MANIFEST-ALIGNED) ───────────────────────
// Within a (grade, subject_code) group, multiple physical NCERT books (e.g.
// Statistics + Indian Economic Development for grade-11 Economics, or Physics
// Part 1 + Part 2) compose ONE subject. The coverage SSoT `public.cbse_syllabus`
// numbers every subject CONTINUOUSLY 1..N across its books (Statistics 1-9,
// Indian Economic Development 10-20, …), and `recompute_syllabus_status()`
// joins chunks→syllabus on EXACT (grade_short, subject_code, chapter_number).
//
// So the chapter_number we emit MUST land in that same continuous 1..N space or
// it orphans (joins zero syllabus rows → no coverage). The previous scheme
// emitted (volumeIndex+1)*100 + chapter (101, 201, …), which matched 0 manifest
// rows for every multi-book subject — assessment REJECT.
//
// The fix: a per-(grade, subject) BOOK-ORDER table. Each book carries a `base`
// = the count of manifest chapters in all PRECEDING books of that subject, so
// book K's chapter c maps to `base_K + c`. Bases are DERIVED from and VALIDATED
// against the authoritative manifest (seed 20260624000100 + live cbse_syllabus):
// the sum of a subject's book chapter-counts equals the manifest's 1..N for that
// (grade, subject); manifest chapter order follows physical book order.
//
// Books present in the corpus but NOT part of a subject's manifest decomposition
// (supplementary readers, workbooks, practical-work volumes — e.g. Footprints,
// Words & Expressions, Practical Work in Geography), and multi-book groups whose
// bucket book-structure could not be reconciled with the manifest with high
// confidence (GATED subjects), are routed to a high orphan namespace (>= 900):
// they are never mislabeled onto a real chapter and never collide, they simply
// carry no coverage — which is correct, the manifest has no row for them.
//
// NOTE: the manifest is CONTINUOUS by design. We do NOT seed offset rows into
// cbse_syllabus. The pre-existing "Chapter 101/201/…/304" pollution rows in prod
// (an artifact of the old *100 scheme) are a SEPARATE architect/ops cleanup.

export interface BookSlot {
  prefix: string;   // 4-letter book code, e.g. 'kest'
  book: number;     // volume digit from the filename
  base: number;     // manifest chapters in all preceding books of this subject
}

/**
 * BOOK-ORDER table, keyed by `${grade}|${subject_code}`. Ordered by manifest
 * position. A subject is listed ONLY when its bucket book-structure was
 * reconciled with the manifest with high confidence. Subjects NOT listed fall
 * through to the default rule (single volume → natural number; un-vetted
 * multi-volume → orphan/GATE). `base` values are manifest-derived (see the
 * per-subject validation in the ingestion runbook / the acceptance-gate script).
 */
export const BOOK_ORDER: Readonly<Record<string, ReadonlyArray<BookSlot>>> = {
  // ── Tier 1: bucket book-count sums EXACTLY to the manifest 1..N ────────────
  '7|math':             [{ prefix: 'gegp', book: 1, base: 0 }, { prefix: 'gegp', book: 2, base: 8 }],
  '7|social_studies':   [{ prefix: 'gees', book: 1, base: 0 }, { prefix: 'gees', book: 2, base: 12 }],
  '8|math':             [{ prefix: 'hegp', book: 1, base: 0 }, { prefix: 'hegp', book: 2, base: 7 }],
  '12|accountancy':     [{ prefix: 'leac', book: 1, base: 0 }, { prefix: 'leac', book: 2, base: 4 }],
  '12|math':            [{ prefix: 'lemh', book: 1, base: 0 }, { prefix: 'lemh', book: 2, base: 6 }],

  // ── Tier 2: manifest book boundary reliable, manifest order == book order ──
  //    (base = manifest chapter count of the preceding book)
  '11|economics':       [{ prefix: 'kest', book: 1, base: 0 }, { prefix: 'keec', book: 1, base: 9 }],   // Statistics 1-9, Indian Econ Dev 10-20
  '11|physics':         [{ prefix: 'keph', book: 1, base: 0 }, { prefix: 'keph', book: 2, base: 8 }],   // Part 1 (1-8), Part 2 (9-15)
  '11|political_science':[{ prefix: 'keps', book: 1, base: 0 }, { prefix: 'keps', book: 2, base: 10 }], // Political Theory 1-10, Indian Constitution 11-20
  '12|business_studies':[{ prefix: 'lebs', book: 1, base: 0 }, { prefix: 'lebs', book: 2, base: 8 }],   // Part 1 (1-8), Part 2 (9-12)
  '12|chemistry':       [{ prefix: 'lech', book: 1, base: 0 }, { prefix: 'lech', book: 2, base: 9 }],   // Part 1 (1-9), Part 2 (10-16)
  '12|economics':       [{ prefix: 'leec', book: 1, base: 0 }, { prefix: 'leec', book: 2, base: 7 }],   // Micro 1-7, Macro 8-14
  '12|geography':       [{ prefix: 'legy', book: 1, base: 0 }, { prefix: 'legy', book: 2, base: 12 }],  // Human Geography 1-12, India 13-23; legy vol 3 (practical) → orphan
  '12|history_sr':      [{ prefix: 'lehs', book: 1, base: 0 }, { prefix: 'lehs', book: 2, base: 4 }, { prefix: 'lehs', book: 3, base: 9 }], // Themes I (1-4), II (5-9), III (10-15)
  '12|physics':         [{ prefix: 'leph', book: 1, base: 0 }, { prefix: 'leph', book: 2, base: 8 }],   // Part 1 (1-8), Part 2 (9-15)
  '12|political_science':[{ prefix: 'leps', book: 1, base: 0 }, { prefix: 'leps', book: 2, base: 9 }],  // Contemporary World Politics 1-9, Politics in India 10-18

  // ── Partial: only the manifest's first book is mapped; other bucket books ──
  //    (supplementary readers / uncertain later-book counts) → orphan.
  '9|english':          [{ prefix: 'iebe', book: 1, base: 0 }],  // Beehive 1-9; Moments (iemo), Words & Expressions (iewe) → orphan
  '10|english':         [{ prefix: 'jeff', book: 1, base: 0 }],  // First Flight 1-9; Footprints (jefp), Words & Expressions (jewe) → orphan
  '11|accountancy':     [{ prefix: 'keac', book: 1, base: 0 }],  // Financial Accounting I 1-7; Part II (keac vol 2) count uncertain → orphan
};

// Chapter numbers >= this are the orphan namespace: never a real cbse_syllabus
// row (real manifest maxima are < 50), never colliding with 1..N content.
export const SUPPLEMENTARY_BASE = 900;

export interface NamespaceInput {
  prefix: string;
  bookNumber: number;
  chapterInBook: number;
}

/**
 * A deterministic, collision-free chapter_number in the ORPHAN namespace for a
 * file that is not part of its subject's manifest decomposition (supplementary
 * book or GATED group). Distinct volumes get disjoint 50-wide bands so two
 * out-of-manifest volumes never overwrite each other; nothing here ever lands
 * on a real (<50) or pollution (<=304) chapter number.
 */
function supplementaryNumber(
  file: NamespaceInput,
  distinct: ReadonlyArray<{ prefix: string; bookNumber: number }>
): number {
  const idx = distinct.findIndex(
    v => v.prefix === file.prefix && v.bookNumber === file.bookNumber
  );
  const volumeIndex = idx < 0 ? 0 : idx;
  return SUPPLEMENTARY_BASE + volumeIndex * 50 + file.chapterInBook;
}

/**
 * Deterministically assign a manifest-aligned chapter_number for a resolved
 * file, given the set of all (prefix, bookNumber) volumes present in its
 * (grade, subject) group. `volumes` must be the full (pre-dedupe) list.
 *
 *  - subject in BOOK_ORDER, book listed  → base + chapterInBook (real 1..N)
 *  - subject in BOOK_ORDER, book absent   → orphan (supplementary reader)
 *  - subject not in BOOK_ORDER, 1 volume  → natural chapterInBook
 *  - subject not in BOOK_ORDER, >1 volume → orphan (un-vetted multi-book = GATE)
 *
 * grade + subject_code are derived from the filename prefix itself (char 0 →
 * grade, full prefix → subject), so the signature is unchanged.
 */
export function namespacedChapterNumber(
  file: NamespaceInput,
  volumes: ReadonlyArray<{ prefix: string; bookNumber: number }>
): number {
  const grade = GRADE_BY_CLASS_CHAR[file.prefix[0]];
  const subject = PREFIX_SUBJECT_MAP[file.prefix];
  const distinct = dedupeVolumes(volumes);
  const table = grade && subject ? BOOK_ORDER[`${grade}|${subject}`] : undefined;

  if (table) {
    const slot = table.find(s => s.prefix === file.prefix && s.book === file.bookNumber);
    if (slot) return slot.base + file.chapterInBook;
    // Book is present in the corpus but not part of the manifest decomposition
    // (supplementary reader / workbook / practical volume) → orphan.
    return supplementaryNumber(file, distinct);
  }

  // No manifest decomposition for this group.
  if (distinct.length <= 1) return file.chapterInBook; // single volume: natural
  // Un-vetted multi-book group → GATE: orphan rather than risk a colliding or
  // mislabeled number against the manifest's continuous space.
  return supplementaryNumber(file, distinct);
}

/** Stable, sorted, de-duplicated (prefix, bookNumber) list. */
export function dedupeVolumes(
  volumes: ReadonlyArray<{ prefix: string; bookNumber: number }>
): Array<{ prefix: string; bookNumber: number }> {
  const seen = new Map<string, { prefix: string; bookNumber: number }>();
  for (const v of volumes) {
    seen.set(`${v.prefix}|${v.bookNumber}`, { prefix: v.prefix, bookNumber: v.bookNumber });
  }
  return [...seen.values()].sort((a, b) =>
    a.prefix === b.prefix ? a.bookNumber - b.bookNumber : a.prefix < b.prefix ? -1 : 1
  );
}
