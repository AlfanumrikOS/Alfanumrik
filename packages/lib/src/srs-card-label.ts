/**
 * SRS card-label hardening (fix/srs-dedupe-per-question follow-up).
 *
 * Quiz-review flashcards write `topic = subject:chapter:question_id` — a
 * MACHINE dedupe key targeting the DB partial unique index idx_src_u
 * (student_id, topic, card_type) WHERE topic IS NOT NULL. It was never
 * meant for eyes, but two display paths fall back to `topic` when
 * `chapter_title` is missing (QuickRecallSection and the getReviewCards
 * fallback mapping in src/lib/supabase.ts), which would show students
 * `math · math:5:3f2a…uuid`.
 *
 * This module is the display-side half of the defense-in-depth fix:
 *   - writer side: QuizResults now populates `chapter_title` on every card
 *   - display side: any label candidate matching the composite-key shape is
 *     rendered as a humane `subject · Chapter N` label instead
 *
 * Anything that does NOT match the composite shape (Foxy cards use
 * human-readable topics like "Photosynthesis"; legacy cards used Bloom
 * levels) passes through completely untouched.
 */

/**
 * The composite per-question dedupe key shape written by QuizResults:
 *   `${subject}:${chapter_number ?? 'na'}:${question_bank.id}`
 * The tail is a uuid (hex + dashes, 8+ chars) — this is what must never
 * reach a student's screen.
 */
const COMPOSITE_CARD_KEY_RE = /^([^:]+):([^:]+):([0-9a-f-]{8,})$/i;

/** True when a card label candidate is the machine composite dedupe key. */
export function isCompositeCardKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && COMPOSITE_CARD_KEY_RE.test(value);
}

/**
 * Render-safe card label. Composite dedupe keys become a humane
 * `subject · Chapter N` (bilingual: `subject · अध्याय N`); every other
 * value — including human-readable Foxy topics — is returned unchanged.
 *
 * @param opts.isHi           Hindi UI (from AuthContext) — technical term
 *                            "Chapter" is translated, subject codes are not (P7).
 * @param opts.includeSubject Set false when the caller already renders the
 *                            subject next to the label (avoids `math · math ·`).
 */
export function humaneCardLabel(
  raw: string | null | undefined,
  opts: { isHi?: boolean; includeSubject?: boolean } = {},
): string | null {
  const { isHi = false, includeSubject = true } = opts;
  if (raw == null || raw === '') return raw ?? null;
  const match = COMPOSITE_CARD_KEY_RE.exec(raw);
  if (!match) return raw; // human-readable topic — must stay untouched
  const [, subject, chapter] = match;
  if (/^\d+$/.test(chapter) && Number(chapter) > 0) {
    const chapterLabel = isHi ? `अध्याय ${chapter}` : `Chapter ${chapter}`;
    return includeSubject ? `${subject} · ${chapterLabel}` : chapterLabel;
  }
  // 'na' / chapter-0 sentinel (no chapter_number in scope at write time):
  // the subject name is the most humane label left. Never the uuid.
  return subject;
}
