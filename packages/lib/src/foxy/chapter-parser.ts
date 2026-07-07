/**
 * Foxy chapter parser.
 *
 * Normalizes the chapter formats the Foxy surfaces already emit and consume:
 * bare numbers, "Chapter N", "Ch. N", and prefixed forms like
 * "Chapter 3: Light". Returns null when no positive chapter number can be
 * extracted, so callers can still fall back to exact title matching.
 */
export function parseFoxyChapterNumber(chapter: string | null): number | null {
  if (!chapter) return null;

  const normalized = chapter.trim();
  const match = normalized.match(/^(?:chapter\s+|ch\.?\s+)?(\d{1,3})\b/i);
  if (!match) return null;

  const chapterNumber = parseInt(match[1], 10);
  return Number.isFinite(chapterNumber) && chapterNumber > 0 ? chapterNumber : null;
}
