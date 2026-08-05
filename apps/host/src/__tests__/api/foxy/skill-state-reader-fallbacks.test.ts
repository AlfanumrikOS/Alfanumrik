/**
 * student_skill_state reader fallback audit (assessment-flagged sweep,
 * Phase 2 Canonical Learner Model, 2026-08-05).
 *
 * Per the Phase 2 design, every reader of `student_skill_state` must FAIL
 * SOFT on empty results and on DB errors — skill state is a display/prompt
 * enhancement, never a reason to 500 a route or abort a workflow.
 *
 * Reader audit result (what this file covers vs what already had coverage):
 *   1. foxy _lib cognitive-context `loadCognitiveContext` (loSkills lane)
 *      — `?? []` + outer catch → EMPTY_COGNITIVE_CONTEXT. NOT previously
 *      tested at the loader level (foxy-skill-state-misconception-context
 *      covers only the FORMATTER's empty-state) → tested HERE.
 *   2. ai/workflows/context-loader `loadWorkflowCognitiveContext`
 *      — only the missing-studentId early-return was tested
 *      (workflow-cognitive-context.test.ts:131); the valid-student
 *      zero-rows / DB-error paths are tested HERE.
 *   3. /api/foxy/learning-action — does NOT read student_skill_state at all
 *      (its binding contract is never to WRITE any mastery surface, pinned
 *      by learning-action-source-guards.test.ts) → N/A, no test added.
 *   4. /api/foxy/suggest-prompts — reads concept_mastery/quiz_sessions (not
 *      student_skill_state); its never-4xx static-fallback shape is already
 *      pinned by suggest-prompts-bloom.test.ts ("static fallback shape
 *      contract") → covered, no test added.
 *   5. adaptive-loops-rules — pure module, takes plain records; null p_know
 *      already covered (adaptive-loops-rules.test.ts "handles null/empty
 *      inputs without throwing", blocked-prerequisite-verify-evaluation
 *      null prereqPKnowNow cases) → covered, no test added.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── supabase-admin mock: a universal chainable builder ─────────────────────
// Every method returns the builder; awaiting it resolves the configured
// result. Covers any chain shape (.select().eq().order().limit(), nested
// .eq() on joins, .maybeSingle(), .in().limit(), ...).

type QueryResult = { data: unknown; error: { message: string } | null };

let resultForTable: (table: string) => QueryResult;

function makeBuilder(table: string): any {
  const target = () => undefined;
  const builder: any = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: QueryResult) => void) =>
          resolve(resultForTable(table));
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => Promise.resolve(resultForTable(table));
      }
      return () => builder;
    },
    apply() {
      return builder;
    },
  });
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeBuilder(table),
  },
}));

import { loadCognitiveContext } from '@/app/api/foxy/_lib/cognitive-context';
import { loadWorkflowCognitiveContext } from '@alfanumrik/lib/ai/workflows/context-loader';

const DB_ERROR: QueryResult = { data: null, error: { message: 'db down' } };
const EMPTY_OK: QueryResult = { data: [], error: null };

beforeEach(() => {
  resultForTable = () => DB_ERROR;
});

describe('foxy _lib loadCognitiveContext — student_skill_state fail-soft', () => {
  it('every query erroring (data null) → returns an empty context, never throws', async () => {
    resultForTable = () => DB_ERROR;
    const ctx = await loadCognitiveContext('stu-1', 'MATH', '8');
    expect(ctx.loSkills).toEqual([]);
    expect(ctx.recentMisconceptions).toEqual([]);
    expect(ctx.weakTopics).toEqual([]);
    expect(ctx.strongTopics).toEqual([]);
    expect(ctx.knowledgeGaps).toEqual([]);
    expect(ctx.revisionDue).toEqual([]);
    expect(ctx.recentErrors).toEqual([]);
    // avg-mastery default 0.5 → 'medium' (the documented cold-start posture)
    expect(ctx.masteryLevel).toBe('medium');
  });

  it('valid student with ZERO skill_state rows (empty data, no error) → loSkills [] and no throw', async () => {
    resultForTable = () => EMPTY_OK;
    const ctx = await loadCognitiveContext('stu-1', 'SCI', '9');
    expect(ctx.loSkills).toEqual([]);
    expect(ctx.recentMisconceptions).toEqual([]);
  });

  it('ONLY the student_skill_state read failing does not poison the rest of the context', async () => {
    resultForTable = (table) =>
      table === 'student_skill_state' ? DB_ERROR : EMPTY_OK;
    const ctx = await loadCognitiveContext('stu-1', 'MATH', '8');
    expect(ctx.loSkills).toEqual([]);
    // The context still resolves with its normal empty shape.
    expect(ctx.masteryLevel).toBe('medium');
    expect(ctx.recentMisconceptions).toEqual([]);
  });
});

describe('ai/workflows loadWorkflowCognitiveContext — student_skill_state fail-soft', () => {
  it('every query erroring → { loSkills: [], misconceptions: [] }, never throws', async () => {
    resultForTable = () => DB_ERROR;
    const ctx = await loadWorkflowCognitiveContext('stu-1', 'MATH', '8');
    expect(ctx).toEqual({ loSkills: [], misconceptions: [] });
  });

  it('valid student with zero rows on all tables → empty arrays', async () => {
    resultForTable = () => EMPTY_OK;
    const ctx = await loadWorkflowCognitiveContext('stu-1', 'MATH', '8', '3');
    expect(ctx).toEqual({ loSkills: [], misconceptions: [] });
  });

  it('only student_skill_state erroring → loSkills [] without dropping misconception lane', async () => {
    resultForTable = (table) =>
      table === 'student_skill_state' ? DB_ERROR : EMPTY_OK;
    const ctx = await loadWorkflowCognitiveContext('stu-1', 'PHY', '10');
    expect(ctx.loSkills).toEqual([]);
    expect(ctx.misconceptions).toEqual([]);
  });
});
