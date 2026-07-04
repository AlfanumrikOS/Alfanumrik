/**
 * Mojibake guardrail (Sanskrit/Hindi/Bengali/Tamil/etc.).
 *
 * Mirrors `public.is_devanagari_mojibake()` defined in
 * `supabase/migrations/20260505000100_quarantine_mojibake_content.sql`.
 *
 * Krutidev/SHUSHA/Walkman fonts produce ASCII garbage like `R\`Rh;%`,
 * `Prqfkz%`, `"K"B%`, `Lire%` when read by pdf-parse (which extracts raw
 * codepoints, not rendered glyphs). Detector is conservative: returns true
 * only if the input has zero Devanagari codepoints AND contains the
 * Krutidev punctuation fingerprints (% mid-word, backtick, or a Latin
 * letter immediately followed by a semicolon). Won't false-positive on
 * plain English chapter titles like "Light, Shadows and Reflections".
 *
 * Pure module — no side effects, no env-var requirements. Safe to import
 * from unit tests, the ingest script, and anywhere else.
 */

export const INDIC_SUBJECT_LANGUAGES: ReadonlySet<string> = new Set([
  'sanskrit',
  'hindi',
  'bengali',
  'tamil',
  'telugu',
  'marathi',
  'gujarati',
  'kannada',
  'malayalam',
  'punjabi',
  'urdu',
]);

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const KRUTIDEV_PUNCT_RE = /[%`]|[A-Za-z];/;

export function isDevanagariMojibake(input: string | null | undefined): boolean {
  if (!input || input.length === 0) return false;
  if (DEVANAGARI_RE.test(input)) return false;
  return KRUTIDEV_PUNCT_RE.test(input);
}

export interface IngestRowSample {
  title?: string | null;
  chunk_text?: string | null;
  chapter_title?: string | null;
}

export interface MojibakeOffender {
  index: number;
  field: string;
  sample: string;
}

/**
 * Non-throwing counterpart to {@link assertNoMojibake}. Returns the list of
 * offending fields (empty when clean, or when the subject is non-Indic).
 *
 * Used by the STORAGE ingestion path, which must not abort the whole batch run
 * when one legacy-font Hindi/Sanskrit PDF extracts as Krutidev garbage. Instead
 * the caller SKIPS that file, logs it, and moves on — never writing mojibake
 * into rag_content_chunks (which would poison Foxy citations + chapter
 * dropdowns). Re-extraction via pdftotext + Devanagari font mapping (or OCR) is
 * a separate follow-up.
 */
export function findMojibakeOffenders(
  rows: IngestRowSample[],
  subjectLanguage: string
): MojibakeOffender[] {
  if (!INDIC_SUBJECT_LANGUAGES.has(subjectLanguage.toLowerCase())) return [];

  const offenders: MojibakeOffender[] = [];
  rows.forEach((row, i) => {
    for (const field of ['title', 'chapter_title', 'chunk_text'] as const) {
      const value = row[field];
      if (typeof value === 'string' && isDevanagariMojibake(value)) {
        offenders.push({ index: i, field, sample: value.slice(0, 60) });
      }
    }
  });
  return offenders;
}

/**
 * Throws if any row's title/chunk_text/chapter_title looks like Krutidev
 * mojibake AND the subject is in our Indic language allow-list. Used by the
 * NCERT ingestion pipeline to REJECT bad imports instead of silently
 * writing garbage that later poisons Foxy citations and chapter dropdowns.
 */
export function assertNoMojibake(
  rows: IngestRowSample[],
  subjectLanguage: string
): void {
  if (!INDIC_SUBJECT_LANGUAGES.has(subjectLanguage.toLowerCase())) return;

  const offenders: Array<{ index: number; field: string; sample: string }> = [];
  rows.forEach((row, i) => {
    for (const field of ['title', 'chapter_title', 'chunk_text'] as const) {
      const value = row[field];
      if (typeof value === 'string' && isDevanagariMojibake(value)) {
        offenders.push({
          index: i,
          field,
          sample: value.slice(0, 60),
        });
      }
    }
  });

  if (offenders.length > 0) {
    const preview = offenders
      .slice(0, 5)
      .map(
        o =>
          `  row[${o.index}].${o.field}: "${o.sample}${o.sample.length === 60 ? '…' : ''}"`
      )
      .join('\n');
    throw new Error(
      `[ingest] Refusing to insert ${offenders.length} mojibake row(s) for subject "${subjectLanguage}". ` +
        `pdf-parse likely read non-Unicode Krutidev/SHUSHA glyphs as ASCII. ` +
        `Re-extract with pdftotext + Devanagari font mapping before retrying.\n` +
        `First offenders:\n${preview}`
    );
  }
}
