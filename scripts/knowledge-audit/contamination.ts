/**
 * scripts/knowledge-audit/contamination.ts
 *
 * v2 PURE contamination detection from structural-scan series metadata + chunk
 * text. Replaces the v1 LLM-side `content_contaminated` flag, which defaulted
 * to false and NEVER flipped in the Wave 1 pilot (0/4 detections) — the model
 * cannot judge cross-chunk numbering namespaces over an 80k-token context, but
 * code can, exactly.
 *
 * SIGNALS (any one → contaminated):
 * (a) foreign-major series: a series dimension (diagrams/tables/activities/
 *     examples/headings/subtopics/exercise-sets) with ≥ FOREIGN_SERIES_MIN_MEMBERS
 *     distinct members whose MAJOR ≠ chapter_number — catches physics 13.x
 *     inside ch6, chem 6.x inside ch1, etc.
 * (b) multiple summary blocks: ≥ 2 distinct fingerprint-deduped summary blocks
 *     (a chapter has at most one Summary / "What have we learnt").
 * (c) title garble: chapter_title is a repeated phrase ("Notes For The Teacher"
 *     ×5 — OCR header captured as title), OR the title's content tokens barely
 *     appear in the chunk text (title/body mismatch).
 *
 * KNOWN LIMITATION (documented, out of scope): SAME-MAJOR cross-book merges —
 * e.g. grade 9 math ch6 where NCERT "Lines and Angles" (6.x) is merged with a
 * different book's "Perimeter and Area" chapter that ALSO numbers 6.x. The
 * foreign-major signal cannot fire (both series share major 6), and
 * heading-set bimodality analysis is explicitly out of scope for v2. These
 * chapters pass undetected unless they also carry a second summary block or a
 * garbled title.
 *
 * P13: evidence output is SHORT LABELS ONLY — never passage text.
 * No I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/contamination.test.ts.
 */

import type { AuditChunk } from './dimensions';
import type { SeriesMeta } from './structural-scan';

/** A foreign-major series needs ≥3 distinct members to flag (1-2 = cross-chapter references, minority noise). */
export const FOREIGN_SERIES_MIN_MEMBERS = 3;
/** A chapter carries at most one summary block; ≥2 distinct blocks → merged sources. */
export const MULTIPLE_SUMMARY_MIN = 2;
/** Below this title-token/body overlap ratio the title doesn't describe the chunks. */
export const TITLE_OVERLAP_MIN_RATIO = 0.25;

const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'around', 'their', 'them',
  'this', 'that', 'what', 'have', 'chapter',
]);

export interface ContaminationInput {
  chapterNumber: number;
  chapterTitle: string;
  series: SeriesMeta[];
  summaryBlockCount: number;
  chunks: AuditChunk[];
}

export interface ContaminationResult {
  contaminated: boolean;
  /** Short signal labels only (P13) — e.g. "foreign major-number series 13.x in diagrams (3 members)". */
  evidence: string[];
}

/**
 * Repeated-phrase title detection: "notes for the teacher notes for the
 * teacher notes for the teacher..." — a phrase (≥4 chars) repeated ≥3 times
 * composing the whole title.
 */
export function isRepeatedPhraseTitle(title: string): boolean {
  const norm = title.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm.length < 12) return false;
  return /^(.{4,}?)(?:\s*\1){2,}$/.test(norm);
}

/**
 * Fraction of the title's content tokens (≥4 chars, non-stopword) present
 * anywhere in the chunk text. null when the title has <2 content tokens
 * (not enough signal to judge).
 */
export function titleTokenOverlap(title: string, chunks: AuditChunk[]): number | null {
  const tokens = [
    ...new Set(
      title
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((t) => t.length >= 4 && !TITLE_STOPWORDS.has(t)),
    ),
  ];
  if (tokens.length < 2) return null;
  const corpus = chunks.map((c) => c.chunk_text.toLowerCase()).join('\n');
  const hits = tokens.filter((t) => corpus.includes(t)).length;
  return hits / tokens.length;
}

export function detectContamination(input: ContaminationInput): ContaminationResult {
  const evidence: string[] = [];

  // (a) foreign-major series
  for (const s of input.series) {
    for (const [major, count] of s.majorsSeen) {
      if (major !== input.chapterNumber && count >= FOREIGN_SERIES_MIN_MEMBERS) {
        evidence.push(`foreign major-number series ${major}.x in ${s.dimension} (${count} members)`);
      }
    }
  }

  // (b) multiple summary blocks
  if (input.summaryBlockCount >= MULTIPLE_SUMMARY_MIN) {
    evidence.push(`multiple summary blocks (${input.summaryBlockCount})`);
  }

  // (c) title garble
  if (isRepeatedPhraseTitle(input.chapterTitle)) {
    evidence.push('repeated-phrase chapter title (garbled OCR header)');
  } else {
    const overlap = titleTokenOverlap(input.chapterTitle, input.chunks);
    if (overlap !== null && overlap < TITLE_OVERLAP_MIN_RATIO) {
      evidence.push('chapter title tokens absent from chunk text');
    }
  }

  return { contaminated: evidence.length > 0, evidence };
}
