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
 *   - Erasure guard tripped → empty layers + erasurePending:true, and
 *     getStudentMemory is never called.
 * DELETE:
 *   - authorizeRequest('memory.erase_own') gates it; zod-validates the scope;
 *   - inserts a scoped data_erasure_requests row (status pending, scope jsonb).
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

let _erasurePending = false;
vi.mock('@alfanumrik/lib/memory/erasure-guard', () => ({
  isErasurePending: vi.fn(() => Promise.resolve(_erasurePending)),
}));

const _getStudentMemory = vi.fn();
vi.mock('@/lib/memory/student-memory', () => ({
  getStudentMemory: (...args: unknown[]) => _getStudentMemory(...args),
}));

let _studentRow: Record<string, unknown> | null = { subscription_plan: 'free', grade: '8' };
let _erasureInsertPayload: Record<string, unknown> | null = null;
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
      if (table === 'data_erasure_requests') {
        return {
          insert: (payload: Record<string, unknown>) => {
            _erasureInsertPayload = payload;
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'req-uuid-1' }, error: null }),
              }),
            };
          },
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
function makeDelete(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/learner/memory', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _authorizeCalls.length = 0;
  _erasurePending = false;
  _erasureInsertPayload = null;
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
      ['cognitive', 'erasurePending', 'longMemory', 'preferences', 'twin'].sort(),
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
    expect(data.erasurePending).toBe(false);

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

  it('erasure guard tripped → empty layers + erasurePending:true, no memory read', async () => {
    _erasurePending = true;
    const { GET } = await import('@/app/api/learner/memory/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.erasurePending).toBe(true);
    expect(body.data.twin).toBeNull();
    expect(body.data.cognitive).toEqual({
      weakTopics: [],
      strongTopics: [],
      revisionDue: [],
      recentErrors: [],
    });
    expect(_getStudentMemory).not.toHaveBeenCalled();
  });
});

describe('DELETE — scoped erasure request', () => {
  it('gates with memory.erase_own and inserts a pending scoped row', async () => {
    const { DELETE } = await import('@/app/api/learner/memory/route');
    const res = await DELETE(makeDelete({ scope: { layer: 'long_memory', subject: 'science' } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      accepted: true,
      note: 'memory blanked immediately; purge within 30 days',
    });
    expect(_authorizeCalls[0]?.[1]).toBe('memory.erase_own');
    expect(_erasureInsertPayload).toMatchObject({
      student_id: 'student-uuid-1',
      status: 'pending',
      scope: { layer: 'long_memory', subject: 'science' },
    });
    // purge_at ≈ now + 30 days.
    const purgeAt = new Date(_erasureInsertPayload!.purge_at as string).getTime();
    const expected = Date.now() + 30 * 86_400_000;
    expect(Math.abs(purgeAt - expected)).toBeLessThan(60_000);
  });

  it('rejects an unknown scope layer with 400 and inserts nothing', async () => {
    const { DELETE } = await import('@/app/api/learner/memory/route');
    const res = await DELETE(makeDelete({ scope: { layer: 'everything' } }));
    expect(res.status).toBe(400);
    expect(_erasureInsertPayload).toBeNull();
  });

  it('audits metadata only (layer + has_subject, never memory content)', async () => {
    const { DELETE } = await import('@/app/api/learner/memory/route');
    await DELETE(makeDelete({ scope: { layer: 'preferences' } }));
    expect(_logAudit).toHaveBeenCalledTimes(1);
    const payload = _logAudit.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.action).toBe('memory.erase_own');
    expect((payload.details as Record<string, unknown>).layer).toBe('preferences');
  });
});
