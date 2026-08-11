/**
 * ALFANUMRIK — Previous-Year-Question (PYQ) board-paper years.
 *
 * ONE definition of "which board years may a student pick" and ONE validator.
 * The `/pyq` launcher renders `pyqYears()`; `/quiz` validates `?year=` with
 * `isPyqYear()` before handing it to the assembler's tag filter. Both must
 * agree, or a year the picker offers would be silently dropped on arrival.
 *
 * WHY THIS IS NOT A LITERAL ARRAY
 * -------------------------------
 * The retired `/pyq` runtime hardcoded `2025 - i` for 11 entries. That list
 * decays: it silently stops offering the newest board paper the moment the
 * calendar rolls past its author's assumption, and there is nothing to fail —
 * students simply never see the most recent year. Deriving the window from the
 * clock removes the decay; `now` is injectable so tests stay deterministic.
 *
 * P5 note: these are CALENDAR years and are numbers. They are not grades —
 * the grade contract (strings "6".."12") is unaffected by anything here.
 */

/** How many board years the picker offers, newest first. */
export const PYQ_YEAR_COUNT = 11;

/**
 * Oldest selectable paper year. A floor rather than a curated start date: its
 * only job is to reject junk (`?year=3`, `?year=1970`) before it reaches a
 * database filter. A year in range with no tagged rows is not an error — the
 * assembler fills from the normal pool.
 */
export const PYQ_MIN_YEAR = 2010;

/**
 * Newest selectable paper year.
 *
 * CBSE board papers for year Y are sat in Feb-Mar of Y, so Y is offerable
 * within Y itself. `+ 1` is deliberately NOT added: offering a paper that has
 * not been written yet is a promise the content pipeline cannot keep.
 */
export function pyqMaxYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/** Selectable board years, newest first. */
export function pyqYears(now: Date = new Date()): number[] {
  const max = pyqMaxYear(now);
  const years: number[] = [];
  for (let y = max; y > max - PYQ_YEAR_COUNT && y >= PYQ_MIN_YEAR; y--) {
    years.push(y);
  }
  return years;
}

/**
 * Whether an untrusted value is a board year we will act on.
 *
 * Accepts the full [PYQ_MIN_YEAR, pyqMaxYear()] range, not just the
 * `pyqYears()` window, so an older bookmarked link keeps working instead of
 * quietly degrading to a generic quiz.
 */
export function isPyqYear(value: unknown, now: Date = new Date()): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PYQ_MIN_YEAR &&
    value <= pyqMaxYear(now)
  );
}
