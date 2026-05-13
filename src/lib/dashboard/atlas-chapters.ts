/**
 * Pure helpers for the Atlas chapter graph on the student dashboard.
 *
 * The graph renders three statuses (mastered / current / upcoming) on
 * 5–6 nodes representing the student's chapter trajectory. Two paths
 * feed it:
 *   1. Mastery path — student has `concept_mastery` rows, statuses
 *      come from the aggregate `mastery_probability` per chapter.
 *      Lives inline in `AtlasDashboard.tsx::useEffect`.
 *   2. Zero-state path — student has NO mastery rows yet. Before this
 *      module existed, the dashboard synthesised "Chapter 2/3/4/5"
 *      placeholder titles (see `AtlasDashboard.tsx::resolvedChapters`).
 *      That looked broken across users at the same grade because every
 *      cold-start student saw the same generic placeholders.
 *
 * This module's `chaptersFromCurriculum` covers path 2 by mapping real
 * `curriculum_topics` rows (the actual syllabus for the student's
 * grade + subject) into the same `AtlasChapterNode` shape. Result:
 * a fresh grade-9 maths student sees "Polynomials" / "Coordinate
 * Geometry" instead of "Chapter 2" / "Chapter 3".
 *
 * Kept as a pure function so it can be unit-tested in isolation; the
 * dashboard component just provides the rows.
 */

export interface AtlasChapterNode {
  number: number;
  title: string;
  status: 'mastered' | 'current' | 'upcoming';
}

/**
 * Build a zero-state chapter graph from `curriculum_topics` rows.
 *
 * Behaviour:
 *   - Aggregate by `chapter_number` (first title wins on duplicates,
 *     so callers can pass rows pre-ordered by `display_order` and
 *     expect deterministic output).
 *   - Sort ascending by chapter_number, regardless of input order.
 *   - First chapter → status `current` (the "you start here" anchor).
 *   - Every subsequent chapter → status `upcoming` (dashed in the SVG).
 *   - Cap at the first 6 chapters to match the SVG layout footprint
 *     (`layoutChapters` slices to 6 anyway).
 *   - Empty input → empty output. Caller decides whether to fall back
 *     to a synthesised placeholder set.
 *
 * Intentionally never emits `mastered` — this is the cold-start path.
 * Once the student has any `concept_mastery` row, the mastery-driven
 * code path in `AtlasDashboard.tsx` takes over and this helper isn't
 * consulted.
 */
export function chaptersFromCurriculum(
  rows: ReadonlyArray<{ chapter_number?: number | null; title?: string | null }>,
): AtlasChapterNode[] {
  // De-dupe by chapter_number — curriculum_topics may have multiple
  // concept-level rows per chapter and we only need one node per
  // chapter on the graph.
  const seen = new Map<number, string>();
  for (const row of rows) {
    if (typeof row.chapter_number !== 'number') continue;
    if (!row.title) continue;
    if (!seen.has(row.chapter_number)) {
      seen.set(row.chapter_number, row.title);
    }
  }

  const sortedChapterNumbers = [...seen.keys()].sort((a, b) => a - b);
  const window = sortedChapterNumbers.slice(0, 6);

  return window.map((num, idx) => ({
    number: num,
    title: seen.get(num)!,
    status: idx === 0 ? 'current' : 'upcoming',
  }));
}
