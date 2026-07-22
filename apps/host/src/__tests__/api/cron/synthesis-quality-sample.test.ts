/**
 * POST /api/cron/synthesis-quality-sample — Phase 8 item 8.6.
 *
 * Covers: cron-secret auth, missing-API-key → 503, empty-window, single-run
 * happy path (insert shape), judge-null counted as failed (no insert, no
 * crash), a judge THROW swallowed as failed (P12 — never crash the cron), and
 * already-scored anti-join skip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const CRON_SECRET = 'cron-secret-fixture';
const ANTHROPIC_KEY = 'sk-test-fixture';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const _cronHealth = vi.fn();
vi.mock('@alfanumrik/lib/cron-job-health', () => ({
  recordCronJobHealth: (...args: unknown[]) => _cronHealth(...args),
}));

const _scoreFn = vi.fn();
vi.mock('@alfanumrik/lib/ai/validation/synthesis-quality-eval', () => ({
  scoreSynthesisSummary: (...args: unknown[]) => _scoreFn(...args),
  SYNTHESIS_RUBRIC_VERSION: 'v1',
}));

type Stub = { data: unknown; error: unknown };
let _candidates: Stub = { data: [], error: null };
let _existing: Stub = { data: [], error: null };
let _students: Stub = { data: [], error: null };
let _insertResult: Stub = { data: null, error: null };
const _insertCalls: unknown[] = [];

function setCandidates(s: Stub) { _candidates = s; }
function setExisting(s: Stub) { _existing = s; }
function setStudents(s: Stub) { _students = s; }
function setInsertResult(s: Stub) { _insertResult = s; }

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'monthly_synthesis_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn(() => Promise.resolve(_candidates)),
        };
      }
      if (table === 'synthesis_quality_scores') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(() => Promise.resolve(_existing)),
          insert: vi.fn((row: unknown) => {
            _insertCalls.push(row);
            return Promise.resolve(_insertResult);
          }),
        };
      }
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn(() => Promise.resolve(_students)),
        };
      }
      throw new Error(`unexpected from(${table})`);
    }),
  },
}));

function makeReq(headers: Record<string, string> = {}, query = ''): Request {
  return new Request(`http://localhost/api/cron/synthesis-quality-sample${query}`, {
    method: 'POST',
    headers,
  });
}

const RUN = {
  id: 'run-1',
  student_id: 'stu-1',
  synthesis_month: '2026-06',
  bundle: {
    monthLabel: '2026-06',
    weeklyArtifactIds: [],
    masteryDelta: { chaptersTouched: [], topicsMastered: 2, topicsImproved: 1, topicsRegressed: 0 },
    chapterMockSummary: null,
  },
  summary_text_en: 'Summary EN.',
  summary_text_hi: 'सारांश।',
  created_at: '2026-06-30T12:00:00Z',
};

const SCORE = {
  groundingScore: 90,
  toneScore: 85,
  noFabricationScore: 100,
  cbseScopeScore: 95,
  overallScore: 92,
  judgeModel: 'claude-sonnet-4-20250514',
  rubricVersion: 'v1',
  oracleFindings: { unbacked_number_count: 0, unbacked_topic_count: 0 },
  rawJudgeResponse: { grounding: 90, tone: 85, no_fabrication: 100, cbse_scope: 95 },
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
  _candidates = { data: [], error: null };
  _existing = { data: [], error: null };
  _students = { data: [], error: null };
  _insertResult = { data: null, error: null };
  _insertCalls.length = 0;
  _scoreFn.mockReset();
  _cronHealth.mockReset();
});

describe('POST /api/cron/synthesis-quality-sample', () => {
  it('returns 401 when no secret', async () => {
    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
  });

  it('returns 503 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    expect(res.status).toBe(503);
  });

  it('returns 0 scored when no candidate runs exist', async () => {
    setCandidates({ data: [], error: null });
    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.scored).toBe(0);
    expect(_scoreFn).not.toHaveBeenCalled();
  });

  it('happy path: scores a run and inserts the score', async () => {
    setCandidates({ data: [RUN], error: null });
    setExisting({ data: [], error: null });
    setStudents({ data: [{ id: 'stu-1', name: 'Asha', grade: '9' }], error: null });
    _scoreFn.mockResolvedValue(SCORE);

    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.scored).toBe(1);
    expect(body.failed).toBe(0);
    expect(_insertCalls).toHaveLength(1);
    const inserted = _insertCalls[0] as Record<string, unknown>;
    expect(inserted.synthesis_run_id).toBe('run-1');
    expect(inserted.overall_score).toBe(92);
    expect(inserted.no_fabrication_score).toBe(100);
    // P13: the persisted row carries NO summary body / name / phone.
    expect(Object.keys(inserted)).not.toContain('summary_text_en');
    expect(Object.keys(inserted)).not.toContain('name');
    expect(JSON.stringify(inserted)).not.toMatch(/Asha|सारांश|Summary EN/);
    // The judge got the name/grade server-side (fine — used, not persisted).
    const scoreInput = (_scoreFn.mock.calls[0] as unknown[])[0] as { studentGrade: string; studentName: string };
    expect(scoreInput.studentGrade).toBe('9');
    expect(scoreInput.studentName).toBe('Asha');
  });

  it('counts judge null as failed; no insert; no crash', async () => {
    setCandidates({ data: [RUN], error: null });
    setStudents({ data: [{ id: 'stu-1', name: 'Asha', grade: '9' }], error: null });
    _scoreFn.mockResolvedValue(null);

    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.scored).toBe(0);
    expect(body.failed).toBe(1);
    expect(_insertCalls).toHaveLength(0);
  });

  it('swallows a judge THROW as failed (never crashes the cron)', async () => {
    setCandidates({ data: [RUN], error: null });
    setStudents({ data: [{ id: 'stu-1', name: 'Asha', grade: '9' }], error: null });
    _scoreFn.mockRejectedValue(new Error('unexpected judge explosion'));

    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scored).toBe(0);
    expect(body.failed).toBe(1);
  });

  it('skips runs already scored for this rubric_version (anti-join)', async () => {
    setCandidates({ data: [RUN], error: null });
    setExisting({ data: [{ synthesis_run_id: 'run-1' }], error: null });

    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.scored).toBe(0);
    expect(body.skipped).toBe(1);
    expect(_scoreFn).not.toHaveBeenCalled();
  });

  it('treats UNIQUE-violation insert as a silent skip (race-safe)', async () => {
    setCandidates({ data: [RUN], error: null });
    setStudents({ data: [{ id: 'stu-1', name: 'Asha', grade: '9' }], error: null });
    _scoreFn.mockResolvedValue(SCORE);
    setInsertResult({ data: null, error: { message: 'duplicate key value violates unique constraint' } });

    const { POST } = await import('@/app/api/cron/synthesis-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.scored).toBe(0);
    expect(body.failed).toBe(0);
  });
});
