/**
 * Recent Lab Context — Next.js (server-side) helper
 *
 * Mirror of `supabase/functions/_shared/recent-lab-context.ts` (the Deno
 * helper used by the legacy foxy-tutor Edge Function). Both helpers MUST
 * keep the same output shape and the same trimming/freshness contract so
 * the student gets identical Foxy behavior whichever entry point is hit
 * during the Phase-3/4 migration window.
 *
 * Fetches the student's recent STEM lab observations from the
 * `experiment_observations` table (RLS bypassed via the supabase admin
 * client, since this runs server-side).
 *
 * Why this exists (Tier 2 R6 of the STEM Lab engagement plan):
 *   Foxy currently has zero awareness of the student's hands-on lab work.
 *   When a student finishes an "Ohm's Law" simulation and then asks Foxy
 *   "why did the current rise like that?", Foxy has no idea they just ran
 *   the experiment. This helper closes that gap.
 *
 * Safety contract (P12 / P13):
 *   - All free-text fields are TRIMMED before they leave this module
 *     (observationSummary ≤ 200 chars, conclusion ≤ 300 chars).
 *   - 30-day freshness filter prevents stale labs from polluting the prompt.
 *   - This module NEVER logs raw observation_text — the caller emits only
 *     the COUNT of fetched entries.
 *   - The `buildLabContextSection()` builder in foxy-lab-prompt.ts adds the
 *     "NEVER invent" guardrail. Use that builder, not your own prompt text.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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

function trim(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + '…';
}

function buildObservationSummary(row: RawObservationRow): string {
  if (row.observation_type === 'guided' && row.structured_observations) {
    const parts: string[] = [];
    for (const [, value] of Object.entries(row.structured_observations)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        parts.push(value.trim());
      }
    }
    return trim(parts.join(' | '), SUMMARY_MAX_CHARS);
  }
  return trim(row.observation_text ?? '', SUMMARY_MAX_CHARS);
}

function mapRowToEntry(row: RawObservationRow): LabContextEntry | null {
  if (!row.simulation_id) return null;
  const observationSummary = buildObservationSummary(row);
  const conclusion = row.conclusion ? trim(row.conclusion, CONCLUSION_MAX_CHARS) : null;
  if (!observationSummary && !conclusion) return null;

  const type: 'simple' | 'guided' = row.observation_type === 'guided' ? 'guided' : 'simple';
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
 * @param supabaseAdmin Supabase admin client (service-role; bypasses RLS).
 * @param studentId    The student's UUID (from the resolved auth context).
 * @param limit        Max number of entries to return. Default 5.
 */
export async function fetchRecentLabContext(
  supabaseAdmin: SupabaseClient,
  studentId: string,
  limit: number = 5,
): Promise<LabContextEntry[]> {
  if (!studentId) return [];
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
    return [];
  }
}
