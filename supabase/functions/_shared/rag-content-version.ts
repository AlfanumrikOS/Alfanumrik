// supabase/functions/_shared/rag-content-version.ts
//
// Version-bump writer for `rag_content_versions` (grade text, subject_code
// text, version int, PK(grade, subject_code)) — response-cache v2 (design
// item 4). Every ingestion writer that changes retrievable content
// (embed-ncert-qa, embed-questions, generate-embeddings,
// extract-ncert-questions) calls bumpRagContentVersion after a successful
// write so the grounded-answer response cache's gen_ctx (which folds in the
// version — see grounded-answer/gen-ctx.ts) invalidates cached answers for
// the affected (grade, subject) scope on the next request.
//
// Key normalization: the cache pipeline reads the table with the SAME
// (grade, subject_code) values a GroundedRequest scope carries — P5 short
// grades ("6".."12") and snake_case subject codes ("math", "science").
// Ingestion functions variously carry display forms ("Grade 10",
// "Science"), so this helper normalizes:
//   - grade: strips a leading "Grade " prefix (same regex the DB trigger
//     sync_rag_chunk_normalized_fields uses for grade_short).
//   - subject: resolved via the `subjects` table (name → code, the same
//     mapping the DB trigger uses); already-a-code values pass through via
//     the code match; unresolvable values fall back to a lowercase/
//     underscore heuristic.
//
// Failure posture: NEVER throws and never fails the ingestion request — a
// missed bump only delays cache invalidation until the entry's TTL (worst
// case 24 h for ncert-solver); it can never serve wrong-scope content
// (that's guarded by the cache tuple re-validation). Failures are logged.
//
// Concurrency note: supabase-js cannot express `SET version = version + 1`,
// so this is a read-then-upsert. Ingestion runs are operator-triggered
// batch jobs; a lost increment under a concurrent double-run still leaves
// the version CHANGED relative to pre-ingestion (both writers read the same
// base and write base+1), which is sufficient for invalidation.

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

function normalizeGrade(grade: string): string {
  return String(grade ?? '').replace(/^grade\s+/i, '').trim();
}

function heuristicSubjectCode(subject: string): string {
  return String(subject ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

async function resolveSubjectCode(sb: SupabaseLike, subject: string): Promise<string> {
  const raw = String(subject ?? '').trim();
  if (!raw) return '';
  try {
    // Two separate parameterized .eq() lookups (code first, then name)
    // instead of the previous raw-interpolated
    // `.or(\`code.eq.${raw},name.eq.${raw}\`)` PostgREST filter — a comma or
    // parenthesis in a subject name broke the .or() filter string and
    // silently diverted resolution to the heuristic.
    const byCode = await sb
      .from('subjects')
      .select('code')
      .eq('code', raw)
      .limit(1)
      .maybeSingle();
    if (byCode.error) throw byCode.error;
    if (byCode.data?.code) return String(byCode.data.code);

    const byName = await sb
      .from('subjects')
      .select('code')
      .eq('name', raw)
      .limit(1)
      .maybeSingle();
    if (byName.error) throw byName.error;
    if (byName.data?.code) return String(byName.data.code);

    // Both lookups succeeded but returned NO row: the heuristic fallback is
    // about to fire on a subject the subjects table does not know. Distinct
    // structured warn (previously only the lookup-ERROR path warned): a
    // mis-normalized subject_code means the grounded-answer cache reader
    // never sees this bump — a missed bump plus the no-TTL L3 store is
    // indefinite staleness — so ops must be able to see these ingestion runs.
    console.warn('rag_content_version_subject_heuristic_fallback', {
      subject_raw: raw,
      heuristic_code: heuristicSubjectCode(raw),
    });
  } catch (err) {
    console.warn(`[rag-content-version] subject code lookup failed — ${String(err)}`);
  }
  return heuristicSubjectCode(raw);
}

/**
 * Idempotent upsert-increment of the (grade, subject) content version.
 * Safe to call with either display forms ("Grade 10" / "Science") or
 * normalized forms ("10" / "science"). Never throws.
 */
export async function bumpRagContentVersion(
  sb: SupabaseLike,
  grade: string,
  subject: string,
): Promise<void> {
  try {
    const gradeShort = normalizeGrade(grade);
    const subjectCode = await resolveSubjectCode(sb, subject);
    if (!gradeShort || !subjectCode) {
      console.warn('[rag-content-version] skipped bump — unresolvable scope', {
        grade_present: Boolean(gradeShort),
        subject_present: Boolean(subjectCode),
      });
      return;
    }

    const { data: existing } = await sb
      .from('rag_content_versions')
      .select('version')
      .eq('grade', gradeShort)
      .eq('subject_code', subjectCode)
      .maybeSingle();
    const nextVersion = (typeof existing?.version === 'number' ? existing.version : 0) + 1;

    const { error } = await sb
      .from('rag_content_versions')
      .upsert(
        { grade: gradeShort, subject_code: subjectCode, version: nextVersion },
        { onConflict: 'grade,subject_code' },
      );
    if (error) {
      console.warn(`[rag-content-version] bump failed — ${String(error.message ?? error)}`);
      return;
    }
    // console.warn (not info) — house structured-metric pattern: Supabase
    // Edge log explorer queries and the runbook's monitoring section key
    // on warn-level structured lines.
    console.warn('rag_content_version_bumped', {
      grade: gradeShort,
      subject: subjectCode,
      version: nextVersion,
    });
  } catch (err) {
    console.warn(`[rag-content-version] bump threw — ${String(err)}`);
  }
}
