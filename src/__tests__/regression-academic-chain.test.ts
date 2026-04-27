/**
 * Regression catalog — academic chain (recovery-mode v2 contract).
 *
 * Pins the post-recovery contract for the seven chain-stage rules:
 *   1. dead subjects (no chapters / no questions) are filtered by
 *      get_available_subjects (via subjects.is_content_ready)
 *   2. subject leak — anon-client chapters fetch must not work; only the
 *      governed /api/student/chapters → available_chapters_for_student_subject
 *      RPC must surface chapters
 *   3. chapter scope — quiz assembler never returns cross-chapter questions
 *      when a chapter is specified
 *   4. quiz scope validation — invalid (grade, subject, chapter) triple is
 *      rejected by the API with reason 'invalid_academic_scope'
 *   5. quiz insufficient — when in-scope questions < requested, API returns
 *      structured 422 { available, requested } and the assembler returns
 *      success: false (never silent partial)
 *   6. RAG NCERT-pinning — Next.js callers use match_rag_chunks_ncert (not
 *      the V1 RPC); chunks always carry source='ncert_2025'
 *   7. compat shim — getChaptersForSubject now hits the API, not the DB
 *
 * All checks are static-analysis (file string assertions) where possible
 * because the alternative is full e2e + db, which lives in Playwright.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = (p: string) => resolve(process.cwd(), p);
const read = (p: string) => readFileSync(root(p), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// #1 — Quiz assembler: no Rung 3 silent chapter-drop, no relax-chapter ladder
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #1: quiz-assembler does not relax the chapter filter', () => {
  const src = read('src/lib/quiz-assembler.ts');

  it('the comment block calls out RUNG 3 REMOVED', () => {
    expect(src).toMatch(/RUNG 3 REMOVED/);
  });

  it('there is no `getQuizQuestionsV2(.*null,` call (chapter ever forced to null)', () => {
    // The legacy Rung 3 invocation was `getQuizQuestionsV2(subject, grade, deficit*2+10, 'mixed', null, ...)`.
    // We assert no call passes a literal `null` for the chapter argument.
    expect(src).not.toMatch(/getQuizQuestionsV2\(\s*subject\s*,\s*grade[\s\S]*?,\s*null\s*,/);
  });

  it('contains a hard scope guard that filters by chapter_number after fetch', () => {
    expect(src).toMatch(/q\.chapter_number === chapter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2 — /api/quiz wires validate_academic_scope + structured insufficient
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #2: /api/quiz wires academic-scope validation + structured 422', () => {
  const src = read('src/app/api/quiz/route.ts');

  it('imports / calls validate_academic_scope via rejectIfInvalidScope', () => {
    expect(src).toMatch(/validate_academic_scope/);
    expect(src).toMatch(/rejectIfInvalidScope/);
  });

  it('GET /questions invokes scope rejection before dispatch', () => {
    // The rejection is called inside the GET handler before switch(action)
    expect(src).toMatch(/rejectIfInvalidScope\(studentId, grade, subject, chapterForScope\)/);
  });

  it('POST /generate-exam validates each chapter in the request', () => {
    expect(src).toMatch(/for \(const ch of chapters\)/);
    expect(src).toMatch(/rejectIfInvalidScope\(studentId, grade, subject, ch\)/);
  });

  it('handleGetQuestions returns insufficient_questions_in_scope on short response', () => {
    expect(src).toMatch(/insufficient_questions_in_scope/);
    expect(src).toMatch(/available:\s*questions\.length/);
    expect(src).toMatch(/requested:\s*count/);
  });

  it('handleGetQuestions filters cross-chapter questions when chapter is specified', () => {
    expect(src).toMatch(/Number\(q\.chapter_number\) === chapter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #3 — RAG callers use NCERT-pinned RPC, not match_rag_chunks
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #3: Next.js RAG callers are pinned to NCERT', () => {
  it('ncert-retriever calls match_rag_chunks_ncert (not the V1 RPC)', () => {
    const src = read('src/lib/ai/retrieval/ncert-retriever.ts');
    expect(src).toMatch(/rpc\(\s*['"]match_rag_chunks_ncert['"]/);
    expect(src).not.toMatch(/rpc\(\s*['"]match_rag_chunks['"]\s*,/);
    expect(src).toMatch(/p_subject_code/);
  });

  it('grounded-answer service is the sole production caller of match_rag_chunks_ncert', () => {
    // Post-Phase-2 (PR #399+) the RAG retrieval moved out of the Next.js
    // /api/foxy route and into the grounded-answer Edge Function. The
    // moat-leak / structural enforcement now lives in
    // src/__tests__/eslint-rules/no-direct-rag-rpc.test.ts (no direct
    // RAG RPC calls outside _shared/). This regression entry pins the
    // remaining product contract: at least one production caller of
    // match_rag_chunks_ncert exists for NCERT-pinned grounding, and it
    // is the grounded-answer retrieval module.
    const src = read('supabase/functions/grounded-answer/retrieval.ts');
    expect(src).toMatch(/rpc\(\s*['"]match_rag_chunks_ncert['"]/);
    expect(src).not.toMatch(/rpc\(\s*['"]match_rag_chunks['"]\s*,/);
    expect(src).toMatch(/p_subject_code/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4 — Governed chapters: anon-client direct fetch is gone
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #4: chapter listing is governed via /api/student/chapters', () => {
  it('getChaptersForSubject is now a fetch shim (not a direct supabase.from(chapters) read)', () => {
    const src = read('src/lib/supabase.ts');
    // Locate the function block
    const fnIdx = src.indexOf('export async function getChaptersForSubject');
    expect(fnIdx).toBeGreaterThan(-1);
    // Look at the next ~1500 chars (the function body)
    const body = src.slice(fnIdx, fnIdx + 1500);
    expect(body).toMatch(/\/api\/student\/chapters\?subject=/);
    expect(body).not.toMatch(/\.from\(\s*['"]chapters['"]/);
  });

  it('useAllowedChapters hook exists and uses SWR', () => {
    const src = read('src/lib/useAllowedChapters.ts');
    expect(src).toMatch(/import useSWR from 'swr'/);
    expect(src).toMatch(/\/api\/student\/chapters\?subject=/);
  });

  it('/api/student/chapters route delegates to available_chapters_for_student_subject_v2', () => {
    const src = read('src/app/api/student/chapters/route.ts');
    // Phase 3: route now uses the v2 RPC backed by cbse_syllabus SSoT.
    // See 20260418101000_subjects_chapters_rpcs_v2.sql.
    expect(src).toMatch(/rpc\(\s*\n?\s*['"]available_chapters_for_student_subject_v2['"]/);
  });

  it('/api/student/chapters has NO soft-fail fallback to legacy chapters table', () => {
    const src = read('src/app/api/student/chapters/route.ts');
    // Soft-fail removed in Phase 3 — RPC failure must be explicit 500,
    // not silent fallback to chapters/GRADE_SUBJECTS-derived data.
    expect(src).not.toMatch(/\.from\(\s*['"]chapters['"]\s*\)/);
    expect(src).toMatch(/service_unavailable/);
  });

  it('/api/student/subjects uses get_available_subjects_v2 (no GRADE_SUBJECTS fallback)', () => {
    const src = read('src/app/api/student/subjects/route.ts');
    expect(src).toMatch(/rpc\(\s*['"]get_available_subjects_v2['"]/);
    // Soft-fall to the constants-derived list was removed — any legacy
    // import of GRADE_SUBJECTS/SUBJECT_META is no longer used from this route.
    expect(src).not.toMatch(/buildLegacySubjects/);
    expect(src).toMatch(/service_unavailable/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #5 — Behavioral: assembler returns success:false instead of mixing chapters
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #5: assembleQuiz returns success:false on chapter deficit', () => {
  it('does not return success:true when chapter is set but cross-chapter questions get filtered out', async () => {
    // Mock getQuizQuestionsV2 to return a mix of in-scope (chapter 5) and
    // out-of-scope (chapter 9) questions. The hard scope guard must drop
    // the chapter-9 ones; if total is then < requested, success must be false.
    const inScope = (i: number) => ({
      id: `c5-${i}`,
      question_text: 'A valid in-scope question that is long enough to pass validation.',
      options: ['Newton', 'Joule', 'Watt', 'Pascal'],
      correct_answer_index: 0,
      explanation: 'Newton is the SI unit of force, which is what the question asks about.',
      difficulty: 2,
      bloom_level: 'remember',
      chapter_number: 5,
    });
    const outScope = (i: number) => ({
      ...inScope(i),
      id: `c9-${i}`,
      chapter_number: 9,
    });

    vi.doMock('@/lib/supabase', () => ({
      supabase: {},
      getQuizQuestionsV2: vi.fn().mockResolvedValue([
        inScope(1), outScope(1), outScope(2), outScope(3),
      ]),
    }));

    const { assembleQuiz } = await import('@/lib/quiz-assembler');
    const result = await assembleQuiz({
      subject: 'physics',
      grade: '11',
      requestedCount: 5,
      difficulty: 'mixed',
      chapter: 5,
      questionTypes: ['mcq'],
      mode: 'practice',
    });

    expect(result.success).toBe(false);
    // Only the in-scope question survives; out-of-scope are dropped.
    expect(result.questions.every((q: { chapter_number: number }) => q.chapter_number === 5)).toBe(true);
    expect(result.returnedCount).toBeLessThan(5);

    vi.doUnmock('@/lib/supabase');
  });
});
