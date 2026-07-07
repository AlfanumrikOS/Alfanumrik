/**
 * Alfanumrik — Pedagogy v2 / Wave 1
 * Wrong-Answer Remediation lookup.
 *
 * Reads from the EXISTING `wrong_answer_remediations` table (curated /
 * LLM-cached content keyed on (question_id, distractor_index)). No schema
 * changes. Returns null when no remediation row exists for the
 * (question, distractor) pair — UI falls back to legacy generic feedback.
 *
 * Schema reference: supabase/migrations/_legacy/timestamped/
 * 20260428000100_wrong_answer_remediations.sql.
 *
 * Server-side only. Pass a server-bound Supabase client (RLS-respecting).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

export interface Remediation {
  questionId: string;
  distractorIndex: number;
  remediationEn: string;
  remediationHi: string;
}

export async function lookupRemediation(
  supabase: SupabaseClient,
  questionId: string,
  distractorIndex: number,
): Promise<Remediation | null> {
  const { data, error } = await supabase
    .from('wrong_answer_remediations')
    .select('question_id, distractor_index, remediation_text, remediation_text_hi')
    .eq('question_id', questionId)
    .eq('distractor_index', distractorIndex)
    .maybeSingle();

  if (error) {
    logger.warn('lookupRemediation supabase error', {
      questionId,
      distractorIndex,
      error: (error as { message?: string }).message ?? 'unknown',
    });
    return null;
  }

  if (!data) return null;

  const row = data as {
    question_id: string;
    distractor_index: number;
    remediation_text: string;
    remediation_text_hi: string | null;
  };

  return {
    questionId: row.question_id,
    distractorIndex: row.distractor_index,
    remediationEn: row.remediation_text ?? '',
    remediationHi: row.remediation_text_hi ?? '',
  };
}
