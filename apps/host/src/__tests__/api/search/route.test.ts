/**
 * GET /api/search — Gate-2 Phase C global search.
 *
 * Pins:
 *   - 401/403 when authorizeRequest denies (super_admin.access gate).
 *   - 400 on missing/too-short q, or an unknown scope.
 *   - scope=X calls only that entity's table; scope=all fans out to all 5.
 *   - Result column projection never leaks student/teacher email — search
 *     results are compact identifiers, not full record dumps (P13/P-01).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthorize = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Rows keyed by table name — each test can seed what a given table "has".
const rowsByTable: Record<string, Record<string, unknown>[]> = {};
const tablesQueried: string[] = [];

function chain() {
  const c = {
    select: () => c,
    ilike: () => c,
    textSearch: () => c,
    eq: () => c,
    limit: () => c,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
      const table = tablesQueried[tablesQueried.length - 1];
      return Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve);
    },
  };
  return c;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      tablesQueried.push(table);
      return chain();
    },
  },
}));

import { GET } from '@/app/api/search/route';

function authedOk() {
  mockAuthorize.mockResolvedValue({ authorized: true, userId: 'admin-1' });
}

beforeEach(() => {
  mockAuthorize.mockReset();
  tablesQueried.length = 0;
  for (const k of Object.keys(rowsByTable)) delete rowsByTable[k];
});

describe('GET /api/search — auth gate', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    mockAuthorize.mockResolvedValue({ authorized: false, errorResponse: denied });

    const req = new NextRequest('https://x.test/api/search?q=raj');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('asks for the super_admin.access permission', async () => {
    authedOk();
    const req = new NextRequest('https://x.test/api/search?q=raj');
    await GET(req);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });
});

describe('GET /api/search — validation', () => {
  beforeEach(authedOk);

  it('rejects a missing q', async () => {
    const req = new NextRequest('https://x.test/api/search');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('rejects a q shorter than 2 characters', async () => {
    const req = new NextRequest('https://x.test/api/search?q=a');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown scope', async () => {
    const req = new NextRequest('https://x.test/api/search?q=raj&scope=bogus');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/search — scoping', () => {
  beforeEach(authedOk);

  it('scope=students queries only the students table', async () => {
    const req = new NextRequest('https://x.test/api/search?q=raj&scope=students');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(tablesQueried).toEqual(['students']);
  });

  it('scope=all fans out to all 5 entity tables', async () => {
    const req = new NextRequest('https://x.test/api/search?q=raj&scope=all');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(new Set(tablesQueried)).toEqual(
      new Set(['students', 'teachers', 'schools', 'curriculum_topics', 'question_bank']),
    );
  });
});

describe('GET /api/search — result shape (P13/P-01 column allowlist)', () => {
  beforeEach(authedOk);

  it('never includes email in a student result, even though students.email exists', async () => {
    rowsByTable.students = [
      { id: 's1', name: 'Raj Kumar', email: 'raj@example.com', grade: '9', school_id: 'sch1' },
    ];
    const req = new NextRequest('https://x.test/api/search?q=raj&scope=students');
    const res = await GET(req);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toEqual({ type: 'student', id: 's1', title: 'Raj Kumar', subtitle: 'Grade 9' });
    expect(JSON.stringify(json.results)).not.toContain('example.com');
  });

  it('never includes email in a teacher result', async () => {
    rowsByTable.teachers = [{ id: 't1', name: 'Priya Singh', email: 'priya@example.com', school_id: 'sch1' }];
    const req = new NextRequest('https://x.test/api/search?q=priya&scope=teachers');
    const res = await GET(req);
    const json = await res.json();
    expect(JSON.stringify(json.results)).not.toContain('example.com');
  });

  it('truncates a long question_text into a compact title', async () => {
    rowsByTable.question_bank = [
      { id: 'q1', question_text: 'x'.repeat(200), subject: 'Physics', grade: '10' },
    ];
    const req = new NextRequest('https://x.test/api/search?q=motion&scope=questions');
    const res = await GET(req);
    const json = await res.json();
    expect(json.results[0].title.length).toBeLessThanOrEqual(121);
    expect(json.results[0].title.endsWith('…')).toBe(true);
  });
});
