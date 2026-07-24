/**
 * Unified Student Memory — student preferences slice (GenAI architecture Phase 2).
 *
 * Advisory hints only — they shape HOW Foxy explains (tone/depth), NEVER what it
 * asserts about mastery (spec §1.5). Read from `student_learning_profiles`:
 *   - learning_style              (confirmed present; DEFAULT 'balanced')
 *   - preferred_explanation_depth (confirmed present; DEFAULT 'medium')
 * BOTH columns verified against the production baseline schema
 * (00000000000000_baseline_from_prod.sql → public.student_learning_profiles).
 * No migration is added under this spec — a preferences column is out of scope
 * for Phase 2 (spec §1.5 note).
 *
 * Preferences are the ONLY optional slice; their absence must never degrade the
 * other four memory slices. Any read failure → EMPTY_PREFERENCES (both null).
 * Never invent a value.
 *
 * Service-role read by default (`supabaseAdmin`); injectable for tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase-admin';
import { logger } from '../logger';

export interface StudentPreferences {
  /** student_learning_profiles.learning_style */
  learningStyle: string | null;
  /** student_learning_profiles.preferred_explanation_depth */
  preferredExplanationDepth: string | null;
}

export const EMPTY_PREFERENCES: StudentPreferences = {
  learningStyle: null,
  preferredExplanationDepth: null,
};

/**
 * Load the student's advisory learning preferences. Best-effort: any error or
 * missing row yields EMPTY_PREFERENCES. `student_learning_profiles` is keyed
 * per (student, subject), so a subject-agnostic read must pick a DETERMINISTIC
 * row — otherwise `.limit(1)` returns an arbitrary subject's hint. Two guards:
 *   1. optional `subject` — when provided, scope to that (student, subject) row;
 *   2. always `.order('updated_at' desc, 'id' desc)` so `.limit(1)` is stable
 *      regardless of subject scoping (both columns exist on the baseline schema;
 *      `id` is the unique tiebreak). Signature stays backward-compatible: legacy
 *      callers pass no `subject` and get the newest profile row deterministically.
 */
export async function loadStudentPreferences(
  studentId: string,
  sb: SupabaseClient = supabaseAdmin,
  subject?: string,
): Promise<StudentPreferences> {
  try {
    let query = sb
      .from('student_learning_profiles')
      .select('learning_style, preferred_explanation_depth')
      .eq('student_id', studentId);
    if (subject) {
      query = query.eq('subject', subject);
    }
    const { data, error } = await query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return EMPTY_PREFERENCES;
    const row = data as {
      learning_style: string | null;
      preferred_explanation_depth: string | null;
    };
    return {
      learningStyle: row.learning_style ?? null,
      preferredExplanationDepth: row.preferred_explanation_depth ?? null,
    };
  } catch (err) {
    logger.warn('unified_memory_preferences_failed', {
      // P13: no studentId — flags/counts only.
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_PREFERENCES;
  }
}
