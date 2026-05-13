/**
 * Pure helper for the Atlas chapter graph on the student dashboard.
 *
 * Builds the 5-6 chapter nodes the SVG renders from two inputs:
 *   1. `curriculumRows` — the syllabus for the student's
 *      `(grade, preferred_subject)`. Source of titles and the full
 *      chapter list, irrespective of progress. One row per concept
 *      (multiple per chapter is fine — deduped by `chapter_number`).
 *   2. `masteryRows` — per-concept mastery rows for the student.
 *      Optional. Empty array = cold-start student.
 *
 * The same code path covers every state of the student's journey:
 *
 *   - Cold start (0 mastery rows). First chapter → `current`, all
 *     others → `upcoming`. Window = first N chapters of the syllabus.
 *   - Partial progress (some chapters mastered). Mastered chapters →
 *     `mastered`, first non-mastered → `current`, the rest → `upcoming`.
 *     Window = ±half centred on the current chapter so the student
 *     can see what they've done and what's next.
 *   - Fully mastered. All chapters → `mastered` except the last one,
 *     which falls back to `current` so the graph still has an anchor.
 *
 * Mastery is averaged across all concepts in a chapter (matches the
 * legacy aggregate the dashboard used) and compared against
 * `masteryThreshold` (default 0.7 — same as the legacy code).
 *
 * Window size defaults to 6, matching `layoutChapters` in
 * `AtlasDashboard.tsx` which slices to 6 anyway. Pass a different
 * value via `options.window` for tests or future graph variants.
 *
 * Replaces the prior split logic — an inline mastery-driven
 * aggregation in `AtlasDashboard.tsx::useEffect` and a separate
 * `chaptersFromCurriculum` zero-state helper that only kicked in when
 * mastery was empty. The unified function progresses naturally as the
 * student moves through chapters without changing code paths.
 */

export interface AtlasChapterNode {
  number: number;
  title: string;
  status: 'mastered' | 'current' | 'upcoming';
}

export interface BuildAtlasChaptersOptions {
  /** Chapter is "mastered" when the per-chapter average mastery
   *  probability is at or above this value. Default 0.7. */
  masteryThreshold?: number;
  /** Maximum nodes the graph renders. Default 6 (matches the SVG
   *  layout). */
  window?: number;
}

export function buildAtlasChapters(
  curriculumRows: ReadonlyArray<{ chapter_number?: number | null; title?: string | null }>,
  masteryRows: ReadonlyArray<{ chapter_number?: number | null; mastery_probability?: number | null }>,
  options: BuildAtlasChaptersOptions = {},
): AtlasChapterNode[] {
  const threshold = options.masteryThreshold ?? 0.7;
  const windowSize = options.window ?? 6;

  // ── 1. Build per-chapter title map (deduped, first-wins). ─────────
  const titleByNumber = new Map<number, string>();
  for (const row of curriculumRows) {
    if (typeof row.chapter_number !== 'number') continue;
    if (!row.title) continue;
    if (!titleByNumber.has(row.chapter_number)) {
      titleByNumber.set(row.chapter_number, row.title);
    }
  }

  const sortedNumbers = [...titleByNumber.keys()].sort((a, b) => a - b);
  if (sortedNumbers.length === 0) return [];

  // ── 2. Average mastery per chapter from concept-level rows. ───────
  const masterySumByNumber = new Map<number, { sum: number; count: number }>();
  for (const row of masteryRows) {
    if (typeof row.chapter_number !== 'number') continue;
    if (typeof row.mastery_probability !== 'number') continue;
    const slot = masterySumByNumber.get(row.chapter_number) ?? { sum: 0, count: 0 };
    slot.sum += row.mastery_probability;
    slot.count += 1;
    masterySumByNumber.set(row.chapter_number, slot);
  }
  const avgMastery = (num: number): number => {
    const slot = masterySumByNumber.get(num);
    return slot && slot.count > 0 ? slot.sum / slot.count : 0;
  };

  // ── 3. Locate the "current" chapter: first below threshold; or
  //       last chapter if everything is mastered (the graph always
  //       needs an anchor). ─────────────────────────────────────────
  const currentNumber =
    sortedNumbers.find((n) => avgMastery(n) < threshold) ??
    sortedNumbers[sortedNumbers.length - 1];

  // ── 4. Choose the window. ────────────────────────────────────────
  //       - Has any mastery → centre ±half on the current chapter so
  //         the student sees progress + next steps.
  //       - Zero mastery (cold start) → first `windowSize` chapters
  //         from the syllabus.
  const hasAnyMastery = masterySumByNumber.size > 0;
  let windowNumbers: number[];
  if (hasAnyMastery) {
    const half = Math.floor(windowSize / 2);
    windowNumbers = sortedNumbers
      .filter((n) => Math.abs(n - currentNumber) <= half)
      .slice(0, windowSize);
  } else {
    windowNumbers = sortedNumbers.slice(0, windowSize);
  }

  // ── 5. Assign per-chapter status. ────────────────────────────────
  return windowNumbers.map((num) => ({
    number: num,
    title: titleByNumber.get(num)!,
    status:
      avgMastery(num) >= threshold
        ? 'mastered'
        : num === currentNumber
          ? 'current'
          : 'upcoming',
  }));
}
