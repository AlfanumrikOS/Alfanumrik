import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * GUARD — Foxy Math Pipeline server-side CURRICULUM SCOPE validator
 * (`validateCurriculumScope`). Runs BEFORE any solver/verifier LLM call. A
 * DETERMINISTIC-FIRST, FAIL-CLOSED, LAYERED cascade:
 *
 *   T1  Grade authenticity — the ENROLLED grade (from students) is authoritative.
 *       A requestGrade that disagrees -> grade_mismatch (NO LLM). Missing enrolled
 *       grade -> grade_mismatch (fail-closed).
 *   T2  Subject allowed — reuses validateSubjectWrite; not-ok -> subject_not_allowed.
 *   T3  Chapter (STRICT) — null/empty chapter -> no_chapter. Chapter not in
 *       cbse_syllabus / is_in_scope !== true -> chapter_not_in_scope.
 *   T4a Deterministic out-of-grade math-domain lexicon — 'integrate', 'laplace
 *       transform', 'matrix determinant' below the min grade -> out_of_grade_domain
 *       with NO callReasoningModel call.
 *   T4b Constrained classify (fail-closed) — only when T1-T3 + T4a pass. The model
 *       answers {"inScope": true|false}; ANY error/parse-fail/non-true ->
 *       topic_not_in_chapter.
 *
 * P12: the ONLY LLM step (T4b) defaults to out-of-scope on uncertainty.
 * P7: every deny carries bilingual EN + Hindi (Devanagari) copy + suggested action.
 * The validator NEVER throws.
 *
 * We mock ONLY the boundary collaborators: supabaseAdmin (chainable), the
 * validateSubjectWrite governance helper, and callReasoningModel (the cascade).
 */

const _validateSubjectWrite = vi.fn();
const _callReasoningModel = vi.fn();

vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: (...args: unknown[]) => _validateSubjectWrite(...args),
}));
vi.mock('@/lib/ai/clients/reasoning-cascade', () => ({
  callReasoningModel: (...args: unknown[]) => _callReasoningModel(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateCurriculumScope } from '@/lib/foxy/curriculum-scope';

// ─── Chainable supabaseAdmin builder ──────────────────────────────────────────
//
// Each `from(table)` returns a thenable chain whose terminal resolution is driven
// by `tableData[table]`. select/eq/neq/ilike/order/limit return the same chain;
// maybeSingle()/single() and awaiting the chain both resolve to { data, error }.
// This models the real PostgREST builder closely enough for the validator's
// per-table queries.
type TableData = Record<string, { data: unknown; error?: unknown }>;

function makeSupabaseAdmin(tableData: TableData, opts?: { throwTables?: string[] }): SupabaseClient {
  const fromCalls: string[] = [];
  const from = (table: string) => {
    fromCalls.push(table);
    const resolve = () => {
      if (opts?.throwTables?.includes(table)) {
        // Model a thrown DB error (the validator wraps reads in try/catch).
        throw new Error(`DB read failed for ${table}`);
      }
      const entry = tableData[table];
      return Promise.resolve(entry ?? { data: null, error: null });
    };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () => resolve();
    chain.single = () => resolve();
    (chain as { then: unknown }).then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      try {
        return resolve().then(res, rej);
      } catch (e) {
        // throwTables: surface as a rejected await (the validator's try/catch
        // also handles a synchronous throw from the builder chain).
        return Promise.reject(e).then(res, rej);
      }
    };
    return chain;
  };
  // For throwTables we want maybeSingle()/single() to THROW synchronously inside
  // the validator's try block (it does `await supabaseAdmin.from(...).maybeSingle()`).
  return { from, __fromCalls: fromCalls } as unknown as SupabaseClient;
}

const baseInput = {
  studentId: 'student-1',
  requestGrade: '6',
  subject: 'math',
  chapter: '3' as string | null,
  problem: 'add 1/2 + 3/4',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path collaborators (individual tests override as needed).
  _validateSubjectWrite.mockResolvedValue({ ok: true });
});

// ─── T1: grade authenticity ───────────────────────────────────────────────────

describe('T1 — grade authenticity (no LLM)', () => {
  it('enrolled grade "6" but requestGrade "12" -> inScope:false grade_mismatch, callReasoningModel NEVER called', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ students: { data: { grade: '6' } } });

    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '12' },
      { supabaseAdmin },
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('grade_mismatch');
    expect(result.enrolledGrade).toBe('6');
    // Bilingual copy present (P7).
    expect(result.messageEn).toBeTruthy();
    expect(result.messageHi).toBeTruthy();
    expect(result.suggestedActionEn).toBeTruthy();
    expect(result.suggestedActionHi).toBeTruthy();
    // No LLM and no subject/chapter reads on the T1 deny.
    expect(_callReasoningModel).not.toHaveBeenCalled();
    expect(_validateSubjectWrite).not.toHaveBeenCalled();
  });

  it('no enrolled grade row -> grade_mismatch (fail-closed), enrolledGrade null', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ students: { data: null } });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('grade_mismatch');
    expect(result.enrolledGrade).toBeNull();
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('a thrown DB read on students -> grade_mismatch (fail-closed), does NOT throw', async () => {
    const supabaseAdmin = makeSupabaseAdmin({}, { throwTables: ['students'] });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('grade_mismatch');
  });
});

// ─── T2: subject allowed ───────────────────────────────────────────────────────

describe('T2 — subject allowed', () => {
  it('validateSubjectWrite not-ok -> subject_not_allowed (no chapter reads, no LLM)', async () => {
    _validateSubjectWrite.mockResolvedValue({ ok: false });
    const supabaseAdmin = makeSupabaseAdmin({ students: { data: { grade: '6' } } });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('subject_not_allowed');
    expect(result.enrolledGrade).toBe('6');
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('validateSubjectWrite THROWS -> subject_not_allowed (fail-closed)', async () => {
    _validateSubjectWrite.mockRejectedValue(new Error('governance read error'));
    const supabaseAdmin = makeSupabaseAdmin({ students: { data: { grade: '6' } } });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('subject_not_allowed');
  });
});

// ─── T3: chapter (strict) ──────────────────────────────────────────────────────

describe('T3 — chapter (strict)', () => {
  it('null chapter -> no_chapter (no syllabus reads, no LLM)', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ students: { data: { grade: '6' } } });

    const result = await validateCurriculumScope(
      { ...baseInput, chapter: null },
      { supabaseAdmin },
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('no_chapter');
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('empty/whitespace chapter -> no_chapter', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ students: { data: { grade: '6' } } });

    const result = await validateCurriculumScope(
      { ...baseInput, chapter: '   ' },
      { supabaseAdmin },
    );

    expect(result.reason).toBe('no_chapter');
  });

  it('chapter not in cbse_syllabus (no row) -> chapter_not_in_scope', async () => {
    const supabaseAdmin = makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: null }, // not found
    });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('chapter_not_in_scope');
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('chapter present in cbse_syllabus but is_in_scope=false -> chapter_not_in_scope', async () => {
    const supabaseAdmin = makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: { is_in_scope: false } },
    });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin });

    expect(result.reason).toBe('chapter_not_in_scope');
  });

  it('accepts legacy chapter labels like "Chapter 3" and resolves the matching chapter row', async () => {
    _callReasoningModel.mockResolvedValue({ content: '{"inScope": true}', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });
    const supabaseAdmin = makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [{ title: 'Fractions' }] },
    });

    const result = await validateCurriculumScope(
      { ...baseInput, chapter: 'Chapter 3' },
      { supabaseAdmin },
    );

    expect(result.inScope).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('accepts abbreviated legacy chapter labels like "Ch. 3"', async () => {
    _callReasoningModel.mockResolvedValue({ content: '{"inScope": true}', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });
    const supabaseAdmin = makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [{ title: 'Fractions' }] },
    });

    const result = await validateCurriculumScope(
      { ...baseInput, chapter: 'Ch. 3' },
      { supabaseAdmin },
    );

    expect(result.inScope).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ─── T4a: deterministic out-of-grade math-domain lexicon (NO LLM) ──────────────

describe('T4a — out-of-grade math-domain lexicon (deterministic, no LLM)', () => {
  // A grade-6 student with an in-scope chapter, but a higher-grade domain problem.
  function grade6InScopeAdmin() {
    return makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [{ title: 'Fractions' }] },
    });
  }

  const outOfGradeProblems = [
    ['integrate x^2', 'integral/calculus'],
    ['laplace transform of t', 'laplace transform'],
    ['matrix determinant of A', 'matrix / determinant'],
  ];

  for (const [problem, label] of outOfGradeProblems) {
    it(`grade 6 + "${problem}" (${label}) -> out_of_grade_domain, callReasoningModel NEVER called`, async () => {
      const result = await validateCurriculumScope(
        { ...baseInput, problem },
        { supabaseAdmin: grade6InScopeAdmin() },
      );

      expect(result.inScope).toBe(false);
      expect(result.reason).toBe('out_of_grade_domain');
      // T4a is deterministic — the classify LLM must NOT run.
      expect(_callReasoningModel).not.toHaveBeenCalled();
      // Bilingual copy.
      expect(result.messageHi).toBeTruthy();
    });
  }

  it('grade 11 + "integrate x^2" -> NOT out_of_grade_domain (calculus is in scope at 11; falls through to T4b)', async () => {
    _callReasoningModel.mockResolvedValue({ content: '{"inScope": true}', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });
    const admin = makeSupabaseAdmin({
      students: { data: { grade: '11' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 7 } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [{ title: 'Integrals' }] },
    });

    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '11', chapter: '7', problem: 'integrate x^2' },
      { supabaseAdmin: admin },
    );

    // Not blocked by the lexicon → T4b runs and confirms.
    expect(result.inScope).toBe(true);
    expect(_callReasoningModel).toHaveBeenCalledTimes(1);
  });

  // ── REGRESSION: logarithm lexicon fix ──────────────────────────────────────
  // Logarithms first appear in CBSE NCERT Class 11, so OUT_OF_GRADE_MATH_DOMAINS
  // now gates `logarithm/logarithms` at minGrade 11 (was 9). A grades-6-10 student
  // asking a logarithm problem must be deterministically blocked at T4a with NO
  // LLM call; a grade-11 student must pass T4a and fall through to T4b.
  // NOTE: the lexicon pattern matches the WORD "logarithm(s)", not the "log"
  // abbreviation — so a deterministic-T4a problem string must spell out "logarithm".

  function logarithmInScopeAdmin(grade: string, chapterNumber: number) {
    return makeSupabaseAdmin({
      students: { data: { grade } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: chapterNumber } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [{ title: 'Numbers' }] },
    });
  }

  it('grade 9 + "find the logarithm of 8 to base 2" -> out_of_grade_domain, callReasoningModel NEVER called (logarithm now gated at 11, was 9)', async () => {
    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '9', chapter: '1', problem: 'find the logarithm of 8 to base 2' },
      { supabaseAdmin: logarithmInScopeAdmin('9', 1) },
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('out_of_grade_domain');
    // T4a is deterministic — the classify LLM must NOT run.
    expect(_callReasoningModel).not.toHaveBeenCalled();
    expect(result.enrolledGrade).toBe('9');
    // Bilingual copy (P7).
    expect(result.messageHi).toBeTruthy();
  });

  it('grade 10 + "evaluate the logarithm log base 2 of 8" -> out_of_grade_domain, no LLM call', async () => {
    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '10', chapter: '1', problem: 'evaluate the logarithm log base 2 of 8' },
      { supabaseAdmin: logarithmInScopeAdmin('10', 1) },
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('out_of_grade_domain');
    expect(_callReasoningModel).not.toHaveBeenCalled();
    expect(result.enrolledGrade).toBe('10');
  });

  it('grade 11 + a "logarithm" problem -> NOT out_of_grade_domain (gate allows 11; falls through to T4b which confirms inScope)', async () => {
    _callReasoningModel.mockResolvedValue({ content: '{"inScope": true}', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });

    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '11', chapter: '1', problem: 'find the logarithm of 8 to base 2' },
      { supabaseAdmin: logarithmInScopeAdmin('11', 1) },
    );

    // Not blocked by the lexicon at grade 11 → T4b runs and confirms.
    expect(result.inScope).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(_callReasoningModel).toHaveBeenCalledTimes(1);
  });
});

// ─── T4b: constrained classify (fail-closed) ──────────────────────────────────

describe('T4b — constrained classify (fail-closed, the only LLM step)', () => {
  function inChapterAdmin() {
    return makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [{ title: 'Fractions' }, { title: 'Addition of fractions' }] },
    });
  }

  it('in-chapter fraction problem + classify {"inScope": true} -> inScope:true', async () => {
    _callReasoningModel.mockResolvedValue({ content: '{"inScope": true}', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin: inChapterAdmin() });

    expect(result.inScope).toBe(true);
    expect(result.enrolledGrade).toBe('6');
    expect(result.reason).toBeUndefined();
    expect(_callReasoningModel).toHaveBeenCalledTimes(1);
    // Classify uses the cheap base tier with jsonMode.
    expect(_callReasoningModel.mock.calls[0][1]).toMatchObject({ startTier: 'base' });
    expect(_callReasoningModel.mock.calls[0][0]).toMatchObject({ jsonMode: true });
  });

  it('classify {"inScope": false} -> topic_not_in_chapter (fail-closed)', async () => {
    _callReasoningModel.mockResolvedValue({ content: '{"inScope": false}', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin: inChapterAdmin() });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('topic_not_in_chapter');
  });

  it('classify THROWS (cascade exhausted) -> topic_not_in_chapter (fail-closed)', async () => {
    _callReasoningModel.mockRejectedValue(new Error('Reasoning cascade exhausted'));

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin: inChapterAdmin() });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('topic_not_in_chapter');
  });

  it('classify returns un-parseable text (no JSON) -> topic_not_in_chapter (fail-closed)', async () => {
    _callReasoningModel.mockResolvedValue({ content: 'sorry I cannot decide', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin: inChapterAdmin() });

    expect(result.reason).toBe('topic_not_in_chapter');
  });

  it('classify returns inScope as a non-true value ("true" string) -> topic_not_in_chapter (strict === true)', async () => {
    _callReasoningModel.mockResolvedValue({ content: '{"inScope": "true"}', model: 'gpt-4o-mini', tokensUsed: 5, tier: 'base' });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin: inChapterAdmin() });

    expect(result.reason).toBe('topic_not_in_chapter');
  });

  it('no topics seeded for the chapter -> topic_not_in_chapter WITHOUT calling the LLM (cannot anchor)', async () => {
    const admin = makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [] }, // no topics to anchor against
    });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin: admin });

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('topic_not_in_chapter');
    // classifyTopicInChapter short-circuits to false on zero topics — no LLM call.
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });
});

// ─── mode 'grade_only' — STEM-only HARD out-of-grade pre-gate (CEO Decision A) ─
//
// 'grade_only' runs ONLY T1 (enrolled-grade authenticity) + T2 (subject via
// validateSubjectWrite) + T4a (deterministic out-of-grade math lexicon). It SKIPS
// T3 (chapter) and T4b (callReasoningModel) ENTIRELY — so NO LLM call is ever made,
// and an in-grade DIFFERENT-chapter query is NOT blocked here (that stays a SOFT
// redirect downstream). Reachable reasons: grade_mismatch, subject_not_allowed,
// out_of_grade_domain.

describe("mode 'grade_only' — out-of-grade lexicon HARD-blocks, NO LLM (CEO Decision A)", () => {
  // A grade-7 student enrolled in math, with a chapter that is NOT consulted in
  // grade_only mode (T3 is skipped). cbse_syllabus/curriculum_topics rows are
  // intentionally absent — if grade_only ever read them this test would expose it.
  function grade7Admin() {
    return makeSupabaseAdmin({
      students: { data: { grade: '7' } },
      // No subjects/chapters/cbse_syllabus/curriculum_topics — grade_only must
      // not need them. validateSubjectWrite (mocked ok) is the only T2 gate.
    });
  }

  it('grade 7 + "Explain to me integration" -> out_of_grade_domain, callReasoningModel NEVER called (THE REPORTED BUG CASE — deterministic, no LLM)', async () => {
    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '7', subject: 'math', chapter: 'Integers', problem: 'Explain to me integration' },
      { supabaseAdmin: grade7Admin() },
      'grade_only',
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('out_of_grade_domain');
    expect(result.enrolledGrade).toBe('7');
    // The whole point of grade_only: T4b is skipped, so the cascade is fully
    // deterministic — the classify LLM must NEVER run.
    expect(_callReasoningModel).not.toHaveBeenCalled();
    // Bilingual copy (P7).
    expect(result.messageEn).toBeTruthy();
    expect(result.messageHi).toBeTruthy();
    expect(result.suggestedActionEn).toBeTruthy();
    expect(result.suggestedActionHi).toBeTruthy();
  });

  it('grade 7 + "Give me example of integration, and apply integration" -> out_of_grade_domain, no LLM', async () => {
    const result = await validateCurriculumScope(
      {
        ...baseInput,
        requestGrade: '7',
        subject: 'math',
        chapter: 'Integers',
        problem: 'Give me example of integration, and apply integration',
      },
      { supabaseAdmin: grade7Admin() },
      'grade_only',
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('out_of_grade_domain');
    expect(_callReasoningModel).not.toHaveBeenCalled();
    expect(result.messageHi).toBeTruthy();
  });

  it('grade_only with enrolled-grade mismatch (requestGrade "12" vs enrolled "7") -> grade_mismatch, no LLM', async () => {
    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '12', subject: 'math', chapter: 'Integers', problem: 'add 1/2 + 3/4' },
      { supabaseAdmin: grade7Admin() },
      'grade_only',
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('grade_mismatch');
    expect(result.enrolledGrade).toBe('7');
    // T1 deny happens before T2/T4a — subject + LLM untouched.
    expect(_validateSubjectWrite).not.toHaveBeenCalled();
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('grade_only subject not allowed -> subject_not_allowed, no LLM, no chapter reads', async () => {
    _validateSubjectWrite.mockResolvedValue({ ok: false });

    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '7', subject: 'math', chapter: 'Integers', problem: 'add 1/2 + 3/4' },
      { supabaseAdmin: grade7Admin() },
      'grade_only',
    );

    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('subject_not_allowed');
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('grade_only IN-GRADE in-subject DIFFERENT-CHAPTER conceptual question (grade 7 "what are decimals" while chapter=Integers) -> inScope:TRUE, callReasoningModel NOT called (Decision A: in-grade different-chapter stays SOFT — T3/T4b skipped)', async () => {
    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '7', subject: 'math', chapter: 'Integers', problem: 'what are decimals' },
      { supabaseAdmin: grade7Admin() },
      'grade_only',
    );

    // grade_only does NOT block on chapter — a different in-grade chapter is in
    // scope for the HARD pre-gate; the SOFT redirect happens downstream.
    expect(result.inScope).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.enrolledGrade).toBe('7');
    // No LLM (T4b skipped) — this is the deterministic guarantee that lets the
    // pre-gate run on EVERY query without an extra model call.
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('grade_only in-grade NON-out-of-grade math problem -> inScope:TRUE, no LLM (T4a passes, T3/T4b skipped)', async () => {
    const result = await validateCurriculumScope(
      { ...baseInput, requestGrade: '7', subject: 'math', chapter: 'Integers', problem: 'add 1/2 + 3/4' },
      { supabaseAdmin: grade7Admin() },
      'grade_only',
    );

    expect(result.inScope).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });
});

// ─── Hard invariant: validateCurriculumScope NEVER throws ──────────────────────

describe('validateCurriculumScope — NEVER throws (every layer is fail-closed)', () => {
  it('returns a result (never rejects) even when every DB read throws', async () => {
    const admin = makeSupabaseAdmin({}, { throwTables: ['students', 'subjects', 'chapters', 'cbse_syllabus', 'curriculum_topics'] });

    await expect(validateCurriculumScope(baseInput, { supabaseAdmin: admin })).resolves.toBeDefined();
  });

  it('returns a result even when the classify LLM throws AND subject read throws', async () => {
    _validateSubjectWrite.mockResolvedValue({ ok: true });
    _callReasoningModel.mockRejectedValue(new Error('boom'));
    const admin = makeSupabaseAdmin({
      students: { data: { grade: '6' } },
      subjects: { data: { id: 'subj-math', code: 'math' } },
      chapters: { data: { chapter_number: 3 } },
      cbse_syllabus: { data: { is_in_scope: true } },
      curriculum_topics: { data: [{ title: 'Fractions' }] },
    });

    const result = await validateCurriculumScope(baseInput, { supabaseAdmin: admin });
    expect(result.inScope).toBe(false);
    expect(result.reason).toBe('topic_not_in_chapter');
  });
});
