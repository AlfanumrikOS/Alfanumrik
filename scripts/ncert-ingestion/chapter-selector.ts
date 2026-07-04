/**
 * ALFANUMRIK — NCERT ingestion chapter selector (pure, no I/O)
 *
 * Staged-scoping filter for the Storage→DB re-ingestion. The full corpus
 * resolves to ~967 chapters; running them all at once is unsafe to monitor and
 * gets killed mid-write by the environment. This module lets a run be scoped to
 * a subset of (grade, subject_code) and/or to only the chapters that still have
 * ZERO coverage, so the 137-chapter unlock can be run per-subject, safely and
 * resumably.
 *
 * Pure module — no env, no side effects, no Supabase client. All coverage data
 * is passed in as a plain Set so the selection logic is fully unit-testable.
 */

/** The three fields that identify a chapter for filtering + coverage lookup. */
export interface ChapterCoordinate {
  /** "6".."12" — resolved.grade (matches cbse_syllabus.grade / rag_content_chunks.grade_short). */
  grade: string;
  /** cbse_syllabus.subject_code, e.g. "economics". */
  subjectCode: string;
  /** namespaced chapter_number (aligned to cbse_syllabus.chapter_number). */
  chapterNumber: number;
}

export interface SelectFilters {
  /** Keep only these grades. Empty/undefined = all grades. */
  grades?: readonly string[];
  /** Keep only these subject_codes. Empty/undefined = all subjects. */
  subjects?: readonly string[];
  /** When true, restrict to the 0-coverage cbse_syllabus gap rows. */
  onlyMissing?: boolean;
  /**
   * Set of coverageKey() strings for chapters that ALREADY have chunk_count > 0
   * in cbse_syllabus. Under `onlyMissing`, these are skipped (resumability:
   * a killed run re-run skips every chapter that already landed chunks).
   */
  existingCoverage?: ReadonlySet<string>;
  /**
   * Set of coverageKey() strings for EVERY in-scope cbse_syllabus row. When
   * provided under `onlyMissing`, a chapter is only eligible if it is a known
   * manifest row — this drops orphan / supplementary-reader chapters (namespaced
   * >= 900, no syllabus row) so --only-missing targets exactly the manifest gap
   * rows (the de-risked "dark chapters"), not every un-covered resolved PDF.
   * Omit to fall back to the simpler "exclude covered" semantic.
   */
  syllabusChapters?: ReadonlySet<string>;
}

/** Stable key for a chapter: "grade|subject_code|chapter_number". */
export function coverageKey(c: ChapterCoordinate): string {
  return `${c.grade}|${c.subjectCode}|${c.chapterNumber}`;
}

/**
 * Filter a resolved-chapter list down to the set that should actually be
 * ingested for this run.
 *
 *  - `grades`   : intersect on ChapterCoordinate.grade (empty = no grade filter)
 *  - `subjects` : intersect on ChapterCoordinate.subjectCode (empty = no filter)
 *  - `onlyMissing` : restrict to the cbse_syllabus 0-coverage gap rows. A chapter
 *    is kept iff (a) it is a known in-scope syllabus row — when `syllabusChapters`
 *    is supplied, orphan/supplementary chapters with no manifest row are dropped —
 *    AND (b) it is NOT already covered (`existingCoverage`, chunk_count > 0). This
 *    is what makes a re-ingestion idempotently resumable: a killed run re-run with
 *    --only-missing skips every chapter that already landed chunks, and targets
 *    exactly the de-risked "dark chapters".
 *
 * With no filters (all empty / onlyMissing false), returns every item unchanged
 * (behavior identical to the original all-or-nothing run).
 *
 * Generic over T so the caller can carry its full StorageFile payload through
 * the filter while the selector only reads the coordinate fields.
 */
export function selectChaptersToIngest<T extends ChapterCoordinate>(
  resolved: readonly T[],
  filters: SelectFilters = {},
): T[] {
  const gradeSet =
    filters.grades && filters.grades.length > 0 ? new Set(filters.grades) : null;
  const subjectSet =
    filters.subjects && filters.subjects.length > 0 ? new Set(filters.subjects) : null;
  const onlyMissing = filters.onlyMissing === true;
  const covered = filters.existingCoverage ?? EMPTY_SET;
  const syllabus = filters.syllabusChapters ?? null;

  return resolved.filter((item) => {
    if (gradeSet && !gradeSet.has(item.grade)) return false;
    if (subjectSet && !subjectSet.has(item.subjectCode)) return false;
    if (onlyMissing) {
      const key = coverageKey(item);
      // Eligibility gate: only real in-scope manifest rows (drops orphans).
      if (syllabus && !syllabus.has(key)) return false;
      // Skip already-covered rows (idempotent resume).
      if (covered.has(key)) return false;
    }
    return true;
  });
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
