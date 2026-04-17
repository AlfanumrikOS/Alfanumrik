/**
 * Subjects + chapters v2 route tests.
 *
 * Verifies the Phase 3 rewrite (commit landing with migration
 * 20260418101000_subjects_chapters_rpcs_v2.sql):
 *   - Routes call the _v2 RPCs backed by cbse_syllabus.
 *   - Soft-fail fallback to GRADE_SUBJECTS / direct chapters read is gone.
 *   - RPC failure returns 500 { error: 'service_unavailable' }, not a
 *     silently-fallen-back 200 with stale data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock scaffolding ────────────────────────────────────────────────────────

let _rpcImpl: (name: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
const _authGetUserMock = vi.fn();

vi.mock('@/lib/supabase-admin', () => {
  const admin = {
    rpc: (name: string, args: unknown) => _rpcImpl(name, args),
    auth: {
      getUser: (...args: unknown[]) => _authGetUserMock(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  };
  return {
    supabaseAdmin: admin,
    getSupabaseAdmin: () => admin,
  };
});

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function reqWithBearer(url: string) {
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer token-123' },
  });
}

function authOk(userId = 'user-1') {
  _authGetUserMock.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _rpcImpl = () => Promise.resolve({ data: [], error: null });
});

// ─── /api/student/subjects v2 ────────────────────────────────────────────────

describe('GET /api/student/subjects (v2)', () => {
  it('401 without auth', async () => {
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(new NextRequest('http://localhost/api/student/subjects'));
    expect(res.status).toBe(401);
  });

  it('200 with empty array when RPC returns no rows (no soft-fall)', async () => {
    authOk();
    _rpcImpl = async (name) => {
      expect(name).toBe('get_available_subjects_v2');
      return { data: [], error: null };
    };
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjects).toEqual([]);
  });

  it('returns mapped subjects with code/name/nameHi shape', async () => {
    authOk();
    _rpcImpl = async () => ({
      data: [
        {
          subject_code: 'physics',
          subject_display: 'Physics',
          subject_display_hi: 'भौतिक विज्ञान',
          ready_chapter_count: 4,
        },
        {
          subject_code: 'math',
          subject_display: 'Mathematics',
          subject_display_hi: null,
          ready_chapter_count: 3,
        },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjects).toHaveLength(2);
    expect(body.subjects[0]).toMatchObject({
      code: 'physics',
      name: 'Physics',
      nameHi: 'भौतिक विज्ञान',
      readyChapterCount: 4,
    });
    // Hindi fallback: when subject_display_hi is null, nameHi falls back to
    // the English display so the bilingual UI invariant holds.
    expect(body.subjects[1].nameHi).toBe('Mathematics');
  });

  it('500 service_unavailable on RPC error (NOT 200 with legacy fallback)', async () => {
    authOk();
    _rpcImpl = async () => ({
      data: null,
      error: { message: 'rpc down' },
    });
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('service_unavailable');
    // Critical: the legacy path would have returned 200 with a subjects list
    // derived from GRADE_SUBJECTS. That silent fallback is gone.
    expect(body.subjects).toBeUndefined();
  });
});

// ─── /api/student/chapters v2 ────────────────────────────────────────────────

describe('GET /api/student/chapters (v2)', () => {
  it('401 without auth', async () => {
    const { GET } = await import('@/app/api/student/chapters/route');
    const res = await GET(
      new Request('http://localhost/api/student/chapters?subject=physics'),
    );
    expect(res.status).toBe(401);
  });

  it('400 invalid_subject when subject missing', async () => {
    authOk();
    const { GET } = await import('@/app/api/student/chapters/route');
    const res = await GET(
      new Request('http://localhost/api/student/chapters', {
        headers: { Authorization: 'Bearer t' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('200 with empty chapters array when RPC returns no rows', async () => {
    authOk();
    _rpcImpl = async (name, args) => {
      expect(name).toBe('available_chapters_for_student_subject_v2');
      expect((args as { p_subject_code: string }).p_subject_code).toBe('physics');
      return { data: [], error: null };
    };
    const { GET } = await import('@/app/api/student/chapters/route');
    const res = await GET(
      new Request('http://localhost/api/student/chapters?subject=physics', {
        headers: { Authorization: 'Bearer t' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chapters).toEqual([]);
  });

  it('maps RPC rows to {chapter_number, chapter_title, chapter_title_hi, verified_question_count}', async () => {
    authOk();
    _rpcImpl = async () => ({
      data: [
        {
          chapter_number: 1,
          chapter_title: 'Force and Motion',
          chapter_title_hi: 'बल और गति',
          verified_question_count: 12,
        },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/student/chapters/route');
    const res = await GET(
      new Request('http://localhost/api/student/chapters?subject=physics', {
        headers: { Authorization: 'Bearer t' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chapters[0]).toEqual({
      chapter_number: 1,
      chapter_title: 'Force and Motion',
      chapter_title_hi: 'बल और गति',
      verified_question_count: 12,
    });
  });

  it('500 service_unavailable on RPC error (NOT 200 with fallback)', async () => {
    authOk();
    _rpcImpl = async () => ({
      data: null,
      error: { message: 'rpc down' },
    });
    const { GET } = await import('@/app/api/student/chapters/route');
    const res = await GET(
      new Request('http://localhost/api/student/chapters?subject=physics', {
        headers: { Authorization: 'Bearer t' },
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('service_unavailable');
    // Critical: no legacy fallback to direct chapters query.
    expect(body.chapters).toBeUndefined();
  });
});