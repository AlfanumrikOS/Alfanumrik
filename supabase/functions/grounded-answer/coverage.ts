// supabase/functions/grounded-answer/coverage.ts
// Coverage precheck against cbse_syllabus.
//
// Single responsibility: given a scope (grade, subject, chapter), decide
// whether we have enough ready content to attempt a grounded answer. If
// not, return up to 3 alternative ready chapters so the frontend can
// offer "Try one of these instead."
//
// This MUST run before Voyage/Claude — it short-circuits the whole pipeline
// for chapters we know we cannot serve. Spec §6.4 step 1.

import type { SuggestedAlternative } from './types.ts';

export interface CoverageResult {
  ready: boolean;
  abstain_reason?: 'chapter_not_ready';
  alternatives: SuggestedAlternative[];
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export async function checkCoverage(
  sb: SupabaseLike,
  scope: { grade: string; subject_code: string; chapter_number: number | null },
): Promise<CoverageResult> {
  // No chapter filter → check the subject has at least one ready chapter.
  // This path is used by callers who know the subject but not a specific
  // chapter (e.g. general "ask Foxy" with subject context only).
  if (scope.chapter_number == null) {
    const { data } = await sb
      .from('cbse_syllabus')
      .select('chapter_number, chapter_title')
      .eq('grade', scope.grade)
      .eq('subject_code', scope.subject_code)
      .eq('rag_status', 'ready')
      .eq('is_in_scope', true)
      .order('chapter_number')
      .limit(1);

    if (!data || data.length === 0) {
      return { ready: false, abstain_reason: 'chapter_not_ready', alternatives: [] };
    }
    return { ready: true, alternatives: [] };
  }

  // Specific chapter check.
  const { data } = await sb
    .from('cbse_syllabus')
    .select('rag_status')
    .eq('grade', scope.grade)
    .eq('subject_code', scope.subject_code)
    .eq('chapter_number', scope.chapter_number)
    .maybeSingle();

  if (data?.rag_status === 'ready') {
    return { ready: true, alternatives: [] };
  }

  return {
    ready: false,
    abstain_reason: 'chapter_not_ready',
    alternatives: await suggestAlternatives(sb, scope.grade, scope.subject_code),
  };
}

export async function suggestAlternatives(
  sb: SupabaseLike,
  grade: string,
  subject_code: string,
): Promise<SuggestedAlternative[]> {
  const { data } = await sb
    .from('cbse_syllabus')
    .select('grade, subject_code, chapter_number, chapter_title')
    .eq('grade', grade)
    .eq('subject_code', subject_code)
    .eq('rag_status', 'ready')
    .eq('is_in_scope', true)
    .order('chapter_number')
    .limit(3);

  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((d: any) => ({
    grade: d.grade,
    subject_code: d.subject_code,
    chapter_number: d.chapter_number,
    chapter_title: d.chapter_title,
    rag_status: 'ready' as const,
  }));
}