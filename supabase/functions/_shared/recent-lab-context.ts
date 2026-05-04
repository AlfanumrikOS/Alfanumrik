/**
 * Recent Lab Context — Deno (Edge Function) helper
 *
 * Fetches the student's recent STEM lab observations from the
 * `experiment_observations` table and shapes them for injection into Foxy's
 * system prompt. Used by `supabase/functions/foxy-tutor/index.ts` (and
 * mirrored on the Next.js side at `src/lib/foxy/recent-lab-context.ts` for
 * `src/app/api/foxy/route.ts`).
 *
 * Why this exists (Tier 2 R6 of the STEM Lab engagement plan):
 *   Foxy currently has zero awareness of the student's hands-on lab work.
 *   When a student finishes an "Ohm's Law" simulation and then asks Foxy
 *   "why did the current rise like that?", Foxy has no idea they just ran
 *   the experiment. This helper closes that gap.
 *
 * Safety contract (P12 / P13):
 *   - All free-text fields (observation_text, structured_observations values,
 *     conclusion) are TRIMMED before they leave this module:
 *       observationSummary  ≤ 200 chars
 *       conclusion          ≤ 300 chars
 *     This bounds the prompt-injection surface and prevents one runaway
 *     observation from blowing past the model's context budget.
 *   - The 30-day filter (FRESH_WINDOW_DAYS) keeps Foxy's context fresh and
 *     prevents stale lab work (from a different chapter / different term)
 *     from polluting the prompt.
 *   - This module NEVER logs raw observation_text — the caller is responsible
 *     for emitting only the COUNT of fetched entries (P13).
 *   - The `buildLabContextSection()` function in foxy-lab-prompt.ts adds the
 *     critical "NEVER invent" guardrail. Callers MUST use that builder rather
 *     than hand-rolling a prompt section.
 */

const FRESH_WINDOW_DAYS = 30;
const SUMMARY_MAX_CHARS = 200;
const CONCLUSION_MAX_CHARS = 300;

export interface LabContextEntry {
  date: string; // ISO YYYY-MM-DD
  simulationId: string;
  experimentId: string | null;
  subject: string;
  type: 'simple' | 'guided';
  observationSummary: string; // ≤ 200 chars
  conclusion: string | null; // ≤ 300 chars trimmed
  vivaScore: number | null;
  vivaMax: number | null;
}

interface RawObservationRow {
  simulation_id: string;
  experiment_id: string | null;
  observation_type: string | null;
  observation_text: string | null;
  structured_observations: Record<string, unknown> | null;
  conclusion: string | null;
  quiz_score: number | null;
  total_questions: number | null;
  subject: string;
  created_at: string;
}

/**
 * Trim a string to `max` chars, collapsing internal whitespace. Returns ''
 * when the input is null/undefined/non-string.
 */
function trim(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + '…';
}

/**
 * Build a single observationSummary string for one row. For 'simple' rows we
 * trim the free-text observation_text. For 'guided' rows we concatenate the
 * VALUES of structured_observations (a `{ index: text }` JSONB object) into
 * a single delimited string. Either way the result is bounded by
 * SUMMARY_MAX_CHARS.
 */
function buildObservationSummary(row: RawObservationRow): string {
  if (row.observation_type === 'guided' && row.structured_observations) {
    const parts: string[] = [];
    // Use Object.entries to preserve insertion order (which for index-keyed
    // objects from the guided UI matches step order).
    for (const [, value] of Object.entries(row.structured_observations)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        parts.push(value.trim());
      }
    }
    return trim(parts.join(' | '), SUMMARY_MAX_CHARS);
  }
  return trim(row.observation_text ?? '', SUMMARY_MAX_CHARS);
}

/**
 * Map a DB row → LabContextEntry. Returns null if the row is unusable
 * (missing simulation_id or both observation surfaces empty).
 */
function mapRowToEntry(row: RawObservationRow): LabContextEntry | null {
  if (!row.simulation_id) return null;
  const observationSummary = buildObservationSummary(row);
  const conclusion = row.conclusion ? trim(row.conclusion, CONCLUSION_MAX_CHARS) : null;
  // Skip rows with neither observation summary nor conclusion — they'd render
  // as "they observed: '' / their conclusion: ''" which adds noise without
  // value.
  if (!observationSummary && !conclusion) return null;

  // Normalize observation_type to the 'simple' | 'guided' union; default to
  // 'simple' for any unknown value (defense-in-depth — the DB CHECK
  // constraint already restricts this, but Foxy's prompt mustn't break on
  // unexpected DB drift).
  const type: 'simple' | 'guided' = row.observation_type === 'guided' ? 'guided' : 'simple';

  // Date: take just the YYYY-MM-DD slice from the ISO timestamp.
  const date = (row.created_at || '').slice(0, 10);

  return {
    date,
    simulationId: row.simulation_id,
    experimentId: row.experiment_id ?? null,
    subject: row.subject,
    type,
    observationSummary,
    conclusion,
    vivaScore: typeof row.quiz_score === 'number' ? row.quiz_score : null,
    vivaMax: typeof row.total_questions === 'number' ? row.total_questions : null,
  };
}

/**
 * Fetch the student's recent lab observations and shape them for prompt
 * injection. Returns an empty array if the student has no recent labs (or
 * if the query fails — failures must NEVER block Foxy).
 *
 * @param supabaseAdmin Supabase client (service-role; bypasses RLS).
 * @param studentId    The student's UUID (from the resolved auth context).
 * @param limit        Max number of entries to return. Default 5.
 */
export async function fetchRecentLabContext(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  studentId: string,
  limit: number = 5,
): Promise<LabContextEntry[]> {
  if (!studentId) return [];
  // Compute the freshness cutoff in ISO so we filter at the DB level.
  const cutoff = new Date(Date.now() - FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from('experiment_observations')
      .select(
        'simulation_id, experiment_id, observation_type, observation_text, structured_observations, conclusion, quiz_score, total_questions, subject, created_at',
      )
      .eq('student_id', studentId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    const entries: LabContextEntry[] = [];
    for (const raw of data as RawObservationRow[]) {
      const entry = mapRowToEntry(raw);
      if (entry) entries.push(entry);
    }
    return entries;
  } catch {
    // Silently swallow — caller logs a single structured event with the
    // count, and Foxy must continue working even when this lookup fails.
    return [];
  }
}
