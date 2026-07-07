import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Idempotent reference-data seeding for live-DB integration tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * The committed schema baseline (`supabase/migrations/00000000000000_baseline_from_prod.sql`)
 * is SCHEMA-ONLY — it was produced with `supabase db dump --schema public`, so it
 * ships ZERO data rows. The canonical reference-data seeds (the `subjects`
 * taxonomy, the grade↔subject map, curriculum content) live ONLY under
 * `supabase/migrations/_legacy/`, which `supabase db push` SKIPS (the CLI applies
 * only files at the immediate `supabase/migrations/` root). See
 * `docs/runbooks/staging-unblock-question-bank-subject-fk.sql` and
 * `docs/runbooks/staging-schema-drift-resolution.md` for the full history.
 *
 * Consequence on a fresh / reset / drifted integration DB:
 *   - `public.subjects` is EMPTY. Yet `public.students.preferred_subject` has a
 *     column DEFAULT of 'Mathematics' AND a FK `students_preferred_subject_fkey`
 *     → `subjects(code)` (migration 20260525130000). Any `students` INSERT that
 *     omits `preferred_subject` therefore takes the default 'Mathematics', which
 *     matches no `subjects.code` row → FK violation 23503
 *     ("insert or update on table \"students\" violates foreign key constraint
 *      \"students_preferred_subject_fkey\""). NOTE: the canonical code is 'math'
 *     (display name 'Mathematics'); the default is a known stale value the prod
 *     coercion migration 20260525120000 fixed in DATA but never in the DEFAULT.
 *   - `public.curriculum_topics` is EMPTY, so any test that anchors
 *     `concept_mastery.topic_id` to "an existing topic" via
 *     `.from('curriculum_topics').select('id').limit(1).single()` throws
 *     "Cannot coerce the result to a single JSON object" (PGRST116, no rows).
 *
 * This helper makes the integration suites OWN their reference-data
 * prerequisites instead of assuming a hand-seeded DB. It seeds ONLY
 * infrastructure taxonomy rows (subjects + one curriculum anchor) — never the
 * entities a test asserts on (schools, students, mastery values, RPC outputs),
 * so the behavior under test is unchanged; this removes a flaky environmental
 * precondition without weakening any assertion.
 *
 * Everything here is idempotent (upsert on the natural key / select-or-create),
 * so it is safe to run repeatedly against a shared staging DB and against a
 * fresh CI scratch project alike.
 */

/**
 * The canonical subject codes the integration suites rely on. Mirrors the
 * legacy governance seed (`_legacy/timestamped/20260415000004_subject_governance_seed.sql`)
 * and the staging-unblock runbook. Kept minimal: the codes any current
 * integration test (or the students FK default-resolution path) can touch.
 *
 * `code` is the FK target for `students.preferred_subject`,
 * `curriculum_topics.subject_id` (via `subjects.id`), `question_bank.subject`,
 * `chapters.subject_code`, etc.
 */
const CANONICAL_SUBJECTS: Array<{
  code: string;
  name: string;
  name_hi: string;
  subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  display_order: number;
}> = [
  { code: 'math', name: 'Math', name_hi: 'गणित', subject_kind: 'cbse_core', display_order: 10 },
  { code: 'science', name: 'Science', name_hi: 'विज्ञान', subject_kind: 'cbse_core', display_order: 20 },
  { code: 'english', name: 'English', name_hi: 'अंग्रेज़ी', subject_kind: 'cbse_core', display_order: 30 },
  { code: 'hindi', name: 'Hindi', name_hi: 'हिंदी', subject_kind: 'cbse_core', display_order: 40 },
  {
    code: 'social_studies',
    name: 'Social Studies',
    name_hi: 'सामाजिक विज्ञान',
    subject_kind: 'cbse_core',
    display_order: 50,
  },
];

/**
 * Ensure the canonical `subjects` rows exist. Idempotent via upsert on the
 * UNIQUE `code` column (ignoreDuplicates so concurrent suites don't deadlock
 * on conflicting non-key columns). Returns the seeded subject id for 'math',
 * which callers use as the FK parent for a curriculum-topic anchor.
 */
export async function ensureSubjects(sb: SupabaseClient): Promise<{ mathSubjectId: string }> {
  const { error: upsertErr } = await sb
    .from('subjects')
    .upsert(
      CANONICAL_SUBJECTS.map((s) => ({
        code: s.code,
        name: s.name,
        name_hi: s.name_hi,
        subject_kind: s.subject_kind,
        is_active: true,
        display_order: s.display_order,
      })),
      { onConflict: 'code', ignoreDuplicates: true },
    );
  if (upsertErr) {
    throw new Error(`ensureSubjects: failed to seed canonical subjects: ${upsertErr.message}`);
  }

  const { data, error } = await sb
    .from('subjects')
    .select('id')
    .eq('code', 'math')
    .single();
  if (error || !data) {
    throw new Error(`ensureSubjects: could not resolve seeded 'math' subject id: ${error?.message}`);
  }
  return { mathSubjectId: (data as { id: string }).id };
}

/**
 * Ensure at least one `curriculum_topics` row exists and return its id — the
 * anchor that `concept_mastery.topic_id` (FK → curriculum_topics) needs.
 *
 * Prefers an already-present topic (so on a fully-seeded staging DB this is a
 * pure read, matching the original test intent of "reuse an existing seeded
 * topic"). On an empty DB it creates ONE minimal anchor under the canonical
 * 'math' subject. Idempotent: re-running returns the same first-found row, and
 * the created anchor carries a stable code in its title so repeat runs reuse it.
 */
export async function ensureCurriculumTopicAnchor(sb: SupabaseClient): Promise<string> {
  // 1. Reuse any existing topic (staging/prod has thousands).
  const existing = await sb.from('curriculum_topics').select('id').limit(1).maybeSingle();
  if (existing.error) {
    throw new Error(`ensureCurriculumTopicAnchor: select failed: ${existing.error.message}`);
  }
  if (existing.data) return (existing.data as { id: string }).id;

  // 2. Empty DB → create a single minimal anchor under the 'math' subject.
  const { mathSubjectId } = await ensureSubjects(sb);

  const ANCHOR_TITLE = 'integration-test reference anchor (auto-seeded)';
  // Idempotency for the created path: if a prior run already inserted the
  // anchor, reuse it instead of duplicating.
  const prior = await sb
    .from('curriculum_topics')
    .select('id')
    .eq('title', ANCHOR_TITLE)
    .limit(1)
    .maybeSingle();
  if (prior.error) {
    throw new Error(`ensureCurriculumTopicAnchor: anchor lookup failed: ${prior.error.message}`);
  }
  if (prior.data) return (prior.data as { id: string }).id;

  const { data, error } = await sb
    .from('curriculum_topics')
    .insert({
      subject_id: mathSubjectId,
      title: ANCHOR_TITLE,
      grade: '8', // must satisfy chk_curriculum_topics_grade_p5 ('6'..'12')
      board: 'CBSE',
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`ensureCurriculumTopicAnchor: insert failed: ${error?.message}`);
  }
  return (data as { id: string }).id;
}

/**
 * One-shot prerequisite seed for the school-* read-model integration suites.
 * Ensures the `subjects` taxonomy (so `students.preferred_subject` resolves and
 * subject-joined RPCs have data) and returns a `curriculum_topics` anchor id for
 * `concept_mastery`. Call once in `beforeAll`.
 */
export async function ensureSchoolReadModelReferenceData(
  sb: SupabaseClient,
): Promise<{ topicId: string }> {
  await ensureSubjects(sb);
  const topicId = await ensureCurriculumTopicAnchor(sb);
  return { topicId };
}

/**
 * The canonical `subjects.code` an integration `students` INSERT should write to
 * `preferred_subject`, so the row never relies on the stale 'Mathematics' column
 * DEFAULT (which has no matching `subjects.code` and trips
 * `students_preferred_subject_fkey`). Use in every test student seed.
 */
export const SAFE_PREFERRED_SUBJECT_CODE = 'math';
