import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * Returns the subject_codes BoardScore should compute for THIS student — the
 * intersection of (a) what the student actually chose
 * (`students.selected_subjects`), (b) subjects CBSE examines at a board
 * level (`subject_kind IN ('cbse_core','cbse_elective')`, never
 * `platform_elective`), and (c) subjects this grade has active CBSE
 * mark-allocation data for (`cbse_chapter_weights`).
 *
 * Returns [] (not "all subjects") when the student has not yet selected any
 * subjects — BoardScore stays empty/"no data yet" until they do. Never falls
 * back to a broader set.
 *
 * Shared by both the nightly cron (`apps/host/src/app/api/cron/board-score/route.ts`)
 * and the on-demand compute route (`apps/host/src/app/api/board-score/route.ts`),
 * which must apply the exact same eligibility rule before forwarding to the
 * Edge Function — see
 * docs/superpowers/specs/2026-07-30-boardscore-subject-scoping.md §4/§7.1.
 *
 * NOTE: this lives in a `_lib/` module (not exported directly from
 * `route.ts`) because Next.js route files may only export the route
 * handlers (GET/POST/etc.) and route config — any other named export fails
 * the generated route type check.
 */

interface StudentSelectedSubjectsRow {
  selected_subjects: string[] | null;
}

interface SubjectCodeRow {
  code: string;
}

interface ChapterWeightSubjectRow {
  subject_code: string;
}

export async function getStudentBoardSubjects(
  studentId: string,
  grade: string,
): Promise<string[]> {
  // 1. The student's own elected subjects — the only legitimate input.
  const { data: studentRow, error: sErr } = await supabaseAdmin
    .from('students')
    .select('selected_subjects')
    .eq('id', studentId)
    .single();
  if (sErr || !studentRow) return [];
  const elected = ((studentRow as StudentSelectedSubjectsRow).selected_subjects ?? []) as string[];
  if (elected.length === 0) return [];

  // 2. Keep only subjects CBSE actually examines at board level.
  const { data: subjectRows } = await supabaseAdmin
    .from('subjects')
    .select('code')
    .in('code', elected)
    .in('subject_kind', ['cbse_core', 'cbse_elective']); // NEVER platform_elective
  const boardEligible = new Set((subjectRows as SubjectCodeRow[] | null ?? []).map((r) => r.code));
  if (boardEligible.size === 0) return [];

  // 3. Intersect with subjects that have active CBSE weight data at this grade
  //    (this is what makes compute() succeed instead of 422ing on "no weights").
  const { data: weightRows } = await supabaseAdmin
    .from('cbse_chapter_weights')
    .select('subject_code')
    .eq('board', 'CBSE')
    .eq('grade', grade)
    .eq('is_active', true)
    .in('subject_code', [...boardEligible]);

  const seen = new Set<string>();
  for (const row of (weightRows as ChapterWeightSubjectRow[] | null) ?? []) {
    seen.add(row.subject_code);
  }
  return [...seen];
}
