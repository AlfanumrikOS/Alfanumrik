/**
 * Learner-model facade — implicit format-preference aggregation (D9/E,
 * Foxy North-Star Phase 2 wave 2b).
 *
 * Pure function: turns the per-turn `formatUsed` telemetry stamps (the D8
 * closed-enum label on every `foxy.chat` audit sink row — see
 * apps/host/src/app/api/foxy/_lib/explanation-format.ts) into an implicit
 * `learning_style` candidate for student_learning_profiles.
 *
 * CONTRACT (spec §1.3 item D9):
 *   • Window: last 28 days of turns (older stamps are ignored).
 *   • Evidence floor: >= 10 in-window turns, else null (not enough signal).
 *   • Majority FORMAT wins (not majority mapped-style — 'paragraph' and
 *     'steps' are counted separately even though both map to 'verbal').
 *   • Strict majority only: a tie for the top format returns null — an
 *     ambiguous signal must never overwrite the default.
 *   • Unknown/absent format labels are dropped before counting.
 *
 * FORMAT → LEARNING_STYLE MAPPING (documented rationale):
 *   paragraph → 'verbal'        prose-first explanations = verbal modality
 *   steps     → 'verbal'        numbered/worked sequential reasoning is
 *                               still language-carried, not visual — the
 *                               settings enum has no 'steps' style, and
 *                               'verbal' is the closest student-facing bucket.
 *                               ASSESSMENT-REVIEWED RATIONALE (Phase 2, 2026-08-05):
 *                               the steps-vs-paragraph distinction is
 *                               INTENTIONALLY collapsed here to preserve enum
 *                               coherence with the student-facing settings
 *                               pills (visual | verbal | example-first |
 *                               balanced). A dedicated procedural/steps style
 *                               token is a FUTURE enum change that must land
 *                               UI + writer + all consumers in one PR — do
 *                               not add it to this map alone.
 *   example   → 'example-first' direct 1:1 with the settings enum
 *   diagram   → 'visual'        direct 1:1 with the settings enum
 *   practice  → 'balanced'      preferring practice items expresses no
 *                               explanation-modality preference; 'balanced'
 *                               keeps Foxy's default mixing behavior
 *
 * The output values are EXACTLY the PATCH /api/learner/preferences contract
 * enum: 'visual' | 'verbal' | 'example-first' | 'balanced'.
 *
 * ⚠ DENO MIRROR: the daily-cron `preference_writer` step
 * (supabase/functions/daily-cron/index.ts) cannot import packages/lib and
 * carries a documented line-for-line mirror of this logic. Change BOTH
 * together.
 *
 * Explicit-wins guard (enforced by the CALLER, not here): rows with
 * student_learning_profiles.preferences_set_by_user = true must never be
 * written by the implicit path (migration 20260808000200).
 */

export const PREFERENCE_WINDOW_DAYS = 28;
export const PREFERENCE_MIN_TURNS = 10;

/** The D8 closed formatUsed enum (explanation-format.ts). */
export type ExplanationFormat = 'paragraph' | 'steps' | 'example' | 'diagram' | 'practice';

/** The PATCH /api/learner/preferences learning-style contract enum. */
export type LearningStyle = 'visual' | 'verbal' | 'example-first' | 'balanced';

export const FORMAT_TO_LEARNING_STYLE: Readonly<Record<ExplanationFormat, LearningStyle>> =
  Object.freeze({
    paragraph: 'verbal',
    steps: 'verbal',
    example: 'example-first',
    diagram: 'visual',
    practice: 'balanced',
  });

export interface FormatTurn {
  /** The formatUsed stamp for one Foxy turn (unknown labels are dropped). */
  format: string;
  /** When the turn happened (ISO string or Date). */
  at: string | Date;
}

export interface AggregateFormatPreferenceOptions {
  /** "Now" anchor for the window, ms since epoch. Default Date.now(). */
  nowMs?: number;
  /** Window size in days. Default PREFERENCE_WINDOW_DAYS (28). */
  windowDays?: number;
  /** Minimum in-window turns required. Default PREFERENCE_MIN_TURNS (10). */
  minTurns?: number;
}

/**
 * Aggregate per-turn formatUsed stamps into an implicit learning_style.
 * Returns null when there is not enough (or not unambiguous) signal.
 */
export function aggregateFormatPreference(
  turnFormats: readonly FormatTurn[],
  opts: AggregateFormatPreferenceOptions = {},
): LearningStyle | null {
  const nowMs = opts.nowMs ?? Date.now();
  const windowDays = opts.windowDays ?? PREFERENCE_WINDOW_DAYS;
  const minTurns = opts.minTurns ?? PREFERENCE_MIN_TURNS;
  const cutoffMs = nowMs - windowDays * 86_400_000;

  const counts = new Map<ExplanationFormat, number>();
  let inWindow = 0;
  for (const turn of turnFormats) {
    if (!turn || typeof turn.format !== 'string') continue;
    if (!(turn.format in FORMAT_TO_LEARNING_STYLE)) continue; // closed enum only
    const atMs = turn.at instanceof Date ? turn.at.getTime() : Date.parse(turn.at);
    if (!Number.isFinite(atMs) || atMs < cutoffMs || atMs > nowMs) continue;
    const format = turn.format as ExplanationFormat;
    counts.set(format, (counts.get(format) ?? 0) + 1);
    inWindow += 1;
  }

  if (inWindow < minTurns) return null;

  // Strict majority format: top count must be unique.
  let top: ExplanationFormat | null = null;
  let topCount = 0;
  let tied = false;
  for (const [format, count] of counts) {
    if (count > topCount) {
      top = format;
      topCount = count;
      tied = false;
    } else if (count === topCount) {
      tied = true;
    }
  }
  if (top === null || tied) return null;

  return FORMAT_TO_LEARNING_STYLE[top];
}
