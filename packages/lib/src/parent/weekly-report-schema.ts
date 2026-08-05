/**
 * packages/lib/src/parent/weekly-report-schema.ts
 *
 * Phase 5 (Foxy North-Star), lane K8.
 *
 * Zod schema for the parent weekly-report contract emitted by the
 * `parent-report-generator` Edge Function (both the LLM path and the
 * deterministic fallback path). The renderer on the parent page validates
 * with this schema before rendering, so any drift between the EF and the
 * UI shape is caught at the boundary rather than as a runtime crash.
 *
 * Additive change (K8): `conversation_prompts` — 0..3 short strings the
 * parent can literally ask their child, phrased for a parent (not a teacher),
 * referring to actual topics from the week. Optional + clamped so an EF that
 * omits it (or emits a malformed value) fails soft and the report still
 * renders.
 *
 * Bilingual: strings inside `conversation_prompts` are already in the
 * parent's `language` (the EF prompts `Respond ONLY in ${lang}`). This
 * schema doesn't second-guess the language; it just pins the shape.
 */

import { z } from 'zod';

export const WeeklyReportStatsSchema = z.object({
  quizzes_completed: z.number().int().nonnegative(),
  avg_score: z.number().min(0).max(100),
  xp_earned: z.number().int().nonnegative(),
  time_spent_minutes: z.number().int().nonnegative(),
  topics_mastered: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
});

export const WeeklyReportSchema = z.object({
  period: z.string().min(1).max(64),
  highlights: z.array(z.string().min(1).max(280)).max(4),
  concerns: z.array(z.string().min(1).max(280)).max(2),
  suggestion: z.string().min(1).max(280),
  /**
   * K8: 0..3 short questions the parent can ask their child.
   * Optional — the EF may omit this field (older versions do); the renderer
   * treats missing / non-array as an empty list.
   */
  conversation_prompts: z.array(z.string().min(1).max(280)).max(3).optional(),
  stats: WeeklyReportStatsSchema,
});

export type WeeklyReport = z.infer<typeof WeeklyReportSchema>;
export type WeeklyReportStats = z.infer<typeof WeeklyReportStatsSchema>;

/**
 * Accept-and-clamp: parse a raw JSON body from the EF. Returns null when the
 * shape is unrecoverable (so the caller renders a fallback). Callers that
 * want the underlying zod error should use `WeeklyReportSchema.safeParse`.
 */
export function parseWeeklyReport(raw: unknown): WeeklyReport | null {
  const result = WeeklyReportSchema.safeParse(raw);
  return result.success ? result.data : null;
}
