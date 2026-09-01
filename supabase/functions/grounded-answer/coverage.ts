// supabase/functions/grounded-answer/coverage.ts
// Coverage precheck against cbse_syllabus.
//
// Single responsibility: given a scope (grade, subject, chapter), decide
// whether we have enough ready CONTENT to attempt a grounded answer. If
// not, return up to 3 alternative chapters that meet the same bar so the
// frontend can offer "Try one of these instead."
//
// This MUST run before Voyage/Claude — it short-circuits the whole pipeline
// for chapters we know we cannot serve. Spec §6.4 step 1.
//
// ── Why this checks chunk_count, not cbse_syllabus.rag_status (2026-08-01) ──
// `rag_status` is a three-way aggregate ('missing' / 'partial' / 'ready')
// computed by `recompute_syllabus_status()` from TWO independent signals:
//   chunk_count             — how much NCERT text is ingested for the chapter
//   verified_question_count — how many AI-generated quiz questions for the
//                              chapter have passed the quiz-answer verifier
//
// This precheck's actual job — per this file's own header above — is "is
// there enough retrievable NCERT TEXT to attempt a grounded answer." That is
// a chunk_count question. verified_question_count answers a DIFFERENT
// question: "is this chapter's quiz feature mature enough to enforce
// verified-only serving to students." That second question was DESIGNED to be
// decided by a separate mechanism — `ff_grounded_ai_enforced` plus a
// row-level `verified_against_ncert` filter inside `select_quiz_questions_rag`
// (design spec §5.3) — which this file has never been part of.
//
// CORRECTION (ai-engineer review, 2026-08-01): that separate mechanism is
// spec'd but NOT currently implemented. Read directly: the live
// `select_quiz_questions_rag` body (latest definition,
// `supabase/migrations/20260801100700_select_quiz_questions_rag_service_role_skip.sql`,
// byte-copied from `20260625000200`) filters only on subject/grade/chapter/
// is_active/question_type_v2(or is_ncert)/difficulty — no reference to
// `verified_against_ncert` or `ff_grounded_ai_enforced_pairs` anywhere in its
// body, and none of the three live call sites (`apps/host/src/app/api/quiz/
// route.ts`, `.../v2/quiz/questions/route.ts`,
// `.../whatsapp/_lib/daily6.ts`) add an equivalent filter on top. So today,
// quiz-serving does not actually gate on verification status at all (it
// appears to have been dropped across a chain of full-body `CREATE OR REPLACE
// FUNCTION` rewrites since the design spec was written) — a real, separate,
// pre-existing gap, orthogonal to this precheck and NOT fixed by this change.
// The reasoning above (that THIS file should not conflate content-sufficiency
// with quiz-verification-maturity) still holds regardless of whether that
// other mechanism currently works; flagging so the next reader doesn't cite
// this comment as evidence the enforcement exists.
//
// Gating EVERY strict-mode caller (ncert-solver, lesson, content, and the
// verifier's own internal calls, all of which are pure text/structure
// generation or verification against `rag_content_chunks` and never read
// `question_bank`) on verified_question_count was a conflation of those two
// signals, not a deliberate content-safety decision — no rationale for it
// exists in the design spec (docs/superpowers/specs/2026-04-17-rag-grounding-
// integrity-design.md) or any runbook.
//
// It also created a real bootstrapping deadlock: `verify-question-bank` (the
// ONLY process that grows verified_question_count) itself calls this service
// with mode:'strict', scoped to the very chapter it is trying to verify a
// question for. Under the old rag_status==='ready' predicate, any chapter
// starting below the question threshold (i.e. every chapter, since production
// had zero rag_status='ready' rows) would fail its OWN verification attempts
// with abstain_reason='chapter_not_ready' — which the verifier's caller
// treats as a PERMANENT, non-retried failure (`verification_state='failed'`,
// never reclaimed by `claim_verification_batch`). No chapter could ever
// organically cross the question threshold: the gate required the very count
// it was blocking the only mechanism that produces.
//
// `rag_status` and `verified_question_count` are UNCHANGED by this file —
// `recompute_syllabus_status()` still computes both exactly as before, and
// every dashboard/audit/ingestion-gap view that reads them is unaffected AT
// THE DATA LEVEL. Only THIS precheck's predicate changed, from
// "rag_status==='ready'" to "chunk_count >= MIN_CHUNKS_FOR_READY". Whether the
// SEPARATE verified-question-count-gated enforcement mechanism should also
// treat already-`failed` rows (marked failed purely by the above deadlock) as
// re-triable is a data question, not a code question, and is explicitly
// NOT addressed by this change — see the rollout note this change shipped
// with for the follow-up this requires.
//
// OPERATIONAL NOTE (ai-engineer review, 2026-08-01): "unaffected at the data
// level" is not the same as "unaffected in meaning." `ingestion_gaps` (view,
// `WHERE rag_status <> 'ready'`) and the super-admin Grounding Coverage
// dashboard (`apps/host/src/app/api/super-admin/grounding/coverage/route.ts`)
// will keep reporting the SAME "0 ready / mostly partial" picture that
// triggered the 2026-07-27 incident, because they still key entirely off
// `rag_status`. After this change ships, most of those "partial" chapters
// (chunk_count>=50, verified_question_count<40) ARE being served by
// strict-mode callers even though the dashboard still calls them gaps. Ops
// should not read an unchanged dashboard number as "the fix didn't work."

import type { SuggestedAlternative } from './types.ts';
import { MIN_CHUNKS_FOR_READY } from './config.ts';

export interface CoverageResult {
  ready: boolean;
  abstain_reason?: 'chapter_not_ready';
  alternatives: SuggestedAlternative[];
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/** True only for a genuine, non-negative number at or above the content bar. */
function hasEnoughChunks(chunk_count: unknown): boolean {
  return typeof chunk_count === 'number' && chunk_count >= MIN_CHUNKS_FOR_READY;
}

export async function checkCoverage(
  sb: SupabaseLike,
  scope: { grade: string; subject_code: string; chapter_number: number | null },
): Promise<CoverageResult> {
  // No chapter filter → check the subject has at least one chapter with
  // enough ingested NCERT content. This path is used by callers who know the
  // subject but not a specific chapter (e.g. general "ask Foxy" with subject
  // context only).
  if (scope.chapter_number == null) {
    const { data, error } = await sb
      .from('cbse_syllabus')
      .select('chapter_number, chapter_title')
      .eq('grade', scope.grade)
      .eq('subject_code', scope.subject_code)
      .gte('chunk_count', MIN_CHUNKS_FOR_READY)
      .eq('is_in_scope', true)
      .order('chapter_number')
      .limit(1);

    // Fail CLOSED (abstain) is already the right outcome for a P12 coverage
    // gate and is preserved. But "this chapter has no ingested content" and
    // "we could not read cbse_syllabus" are different facts: the second would
    // make Foxy abstain on EVERY question, platform-wide, with no signal.
    if (error) {
      console.error('[coverage] cbse_syllabus subject probe failed:', error.code, error.message);
    }

    if (error || !data || data.length === 0) {
      return { ready: false, abstain_reason: 'chapter_not_ready', alternatives: [] };
    }
    return { ready: true, alternatives: [] };
  }

  // Specific chapter check.
  const { data, error } = await sb
    .from('cbse_syllabus')
    .select('chunk_count')
    .eq('grade', scope.grade)
    .eq('subject_code', scope.subject_code)
    .eq('chapter_number', scope.chapter_number)
    .maybeSingle();

  // Same reasoning as the subject-level probe above: abstain on failure
  // (correct, unchanged), but record why.
  if (error) {
    console.error('[coverage] cbse_syllabus chapter probe failed:', error.code, error.message);
  }

  if (!error && hasEnoughChunks(data?.chunk_count)) {
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
  const { data, error } = await sb
    .from('cbse_syllabus')
    .select('grade, subject_code, chapter_number, chapter_title')
    .eq('grade', grade)
    .eq('subject_code', subject_code)
    .gte('chunk_count', MIN_CHUNKS_FOR_READY)
    .eq('is_in_scope', true)
    .order('chapter_number')
    .limit(3);

  // Degrades to "no alternatives to suggest" — safe, but otherwise
  // indistinguishable from a subject that genuinely has none ready.
  if (error) {
    console.error('[coverage] alternative-chapter probe failed:', error.code, error.message);
  }

  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((d: any) => ({
    grade: d.grade,
    subject_code: d.subject_code,
    chapter_number: d.chapter_number,
    chapter_title: d.chapter_title,
    // NOTE (2026-08-01, ai-engineer): this is a FIXED label required by the
    // SuggestedAlternative type contract (./types.ts) — it is NOT a live
    // read of this row's actual cbse_syllabus.rag_status column, which may
    // genuinely be 'partial' (a chapter can clear the chunk_count bar above
    // while verified_question_count is still < 40; see this file's header
    // comment). The only thing actually verified about a returned
    // alternative is that it passed the .gte('chunk_count',
    // MIN_CHUNKS_FOR_READY) filter a few lines up — the same bar
    // checkCoverage() now uses. Verified unused by any renderer today:
    // packages/ui/src/grounding/AlternativesGrid.tsx displays only
    // chapter_number/chapter_title from this shape, never rag_status.
    // Changing this field's value or dropping it would require updating the
    // required-literal type in types.ts (and its client-side twin,
    // SuggestedAlternative in packages/ui/src/foxy/ChatBubble.tsx) plus the
    // pinned assertion in __tests__/coverage.test.ts:143 — out of scope for
    // this fix (which touches only this file); flagged as a follow-up.
    rag_status: 'ready' as const,
  }));
}
