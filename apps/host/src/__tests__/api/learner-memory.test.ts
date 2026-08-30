import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Foxy North-Star Phase 1 — /api/learner/memory.
 *
 * GET:
 *   - authorizeRequest('memory.view_own', { requireStudentId: true }) gates it.
 *   - Returns ONLY the whitelisted student-facing projection: cognitive
 *     {weakTopics,strongTopics,revisionDue,recentErrors}, longMemory
 *     {summary,highConcepts,lowConcepts,topMisconceptions}, preferences,
 *     twin: null. Twin/cohort internals, loSkills, knowledgeGaps, nextAction
 *     must NEVER leak.
 *
 * (The DELETE endpoint this file used to also cover was removed 2026-08-30
 * along with the DPDP erasure subsystem it was built on — see
 * supabase/migrations/20260830130000_remove_dpdp_erasure_system.sql.)
 */

let _authResult: Record<string, unknown>;
const _authorizeCalls: unknown[][] = [];
const _logAudit = vi.fn(() => Promise.resolve());
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn((...args: unknown[]) => {
    _authorizeCalls.push(args);
    return Promise.resolve(_authResult);
  }),
  logAudit: (...args: unknown[]) => _logAudit(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const _getStudentMemory = vi.fn();
vi.mock('@/lib/memory/student-memory', () => ({
  getStudentMemory: (...args: unknown[]) => _getStudentMemory(...args),
}));

let _studentRow: Record<string, unknown> | null = { subscription_plan: 'free', grade: '8' };
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: _studentRow, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
  getSupabaseAdmin: vi.fn(),
}));

// A deliberately "over-full" memory fixture — internals that must NOT leak.
const FULL_MEMORY = {
  studentId: 'student-uuid-1',
  subject: 'science',
  grade: '8',
  chapter: null,
  cognitive: {
    weakTopics: [{ title: 'Cells', mastery: 0.4, attempts: 5 }],
    strongTopics: [{ title: 'Plants', mastery: 0.9 }],
    knowledgeGaps: [{ target: 'X', prerequisite: 'Y', gapType: 'hard' }],
    revisionDue: [{ title: 'Tissues', lastReviewed: '2026-07-01', mastery: 0.6 }],
    recentErrors: [{ errorType: 'conceptual', count: 3 }],
    nextAction: { actionType: 'review', conceptName: 'Cells', reason: 'weak' },
    masteryLevel: 'medium',
    loSkills: [{ loCode: 'LO1', loStatement: 'secret internal', pKnow: 0.3, pSlip: 0.1, theta: -0.4 }],
    recentMisconceptions: [{ code: 'M1', label: 'lbl', count: 2, remediationText: 'internal' }],
  },
  twin: {
    isEmpty: false,
    cohortPercentile: 42, // never-disclose guardrail — must not leak
    weakTopics: [],
    decayedTopics: [],
    highlights: [],
  },
  longMemory: {
    synthesis_month: '2026-07',
    synthesis_summary: 'Making steady progress in science.',
    high_concepts: ['Photosynthesis'],
    low_concepts: ['Respiration'],
    top_misconceptions: ['Plants eat soil'],
  },
  preferences: { learningStyle: 'visual', preferredExplanationDepth: 'medium' },
  isEmpty: false,
};

function makeGet(query = '?subject=science'): NextRequest {
  return new NextRequest(`http://localhost/api/learner/memory${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  _authorizeCalls.length = 0;
  _studentRow = { subscription_plan: 'free', grade: '8' };
  _authResult = {
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    schoolId: null,
  };
  _getStudentMemory.mockResolvedValue(FULL_MEMORY);
});

describe('GET — auth + whitelisted projection', () => {
  it('gates with memory.view_own + requireStudentId and 401s through', async () => {
    _authResult = {
      authorized: false,
      errorResponse: NextResponse.json({ error: 'no' }, { status: 401 }),
    };
    const { GET } = await import('@/app/api/learner/memory/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(_authorizeCalls[0]?.[1]).toBe('memory.view_own');
    expect(_authorizeCalls[0]?.[2]).toMatchObject({ requireStudentId: true });
  });

  it('requires subject', async () => {
    const { GET } = await import('@/app/api/learner/memory/route');
    const res = await GET(makeGet(''));
    expect(res.status).toBe(400);
  });

  it('uses the SERVER grade (P5 string) and returns only whitelisted fields — twin is null', async () => {
    const { GET } = await import('@/app/api/learner/memory/route');
    const res = await GET(makeGet('?subject=science&chapter=Cell%20Structure'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };

    // Server-fetched grade, not a client value.
    expect(_getStudentMemory).toHaveBeenCalledWith('student-uuid-1', {
      subject: 'science',
      grade: '8',
      chapter: 'Cell Structure',
    });

    const data = body.data;
    expect(Object.keys(data).sort()).toEqual(
      ['cognitive', 'longMemory', 'preferences', 'twin'].sort(),
    );
    expect(data.twin).toBeNull();
    expect(Object.keys(data.cognitive as Record<string, unknown>).sort()).toEqual(
      ['recentErrors', 'revisionDue', 'strongTopics', 'weakTopics'].sort(),
    );
    expect(data.longMemory).toEqual({
      summary: 'Making steady progress in science.',
      highConcepts: ['Photosynthesis'],
      lowConcepts: ['Respiration'],
      topMisconceptions: ['Plants eat soil'],
    });
    expect(data.preferences).toEqual({ learningStyle: 'visual', preferredExplanationDepth: 'medium' });

    // Never-disclose internals must not appear anywhere in the payload.
    const serialized = JSON.stringify(body);
    for (const leaked of ['cohortPercentile', 'loSkills', 'pKnow', 'knowledgeGaps', 'nextAction', 'remediationText', 'secret internal']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('409s when the student has no enrolled grade yet (pre-onboarding)', async () => {
    _studentRow = { subscription_plan: 'free', grade: null };
    const { GET } = await import('@/app/api/learner/memory/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(409);
    expect(_getStudentMemory).not.toHaveBeenCalled();
  });
});
