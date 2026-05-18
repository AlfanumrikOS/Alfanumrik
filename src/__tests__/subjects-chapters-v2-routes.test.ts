/**
 * Subjects + chapters v2 route tests.
 *
 * History:
 *   Phase 3 (commit 62ff835, migration 20260418101000): removed soft-fail,
 *   routes returned 500 on RPC error or empty-list 200 on empty RPC rows.
 *
 *   Phase 4 hotfix (commit landing with migration 20260418130000 +
 *   study-path-hotfix): the study path broke immediately post-deploy because
 *   the v2 RPCs filtered rag_status='ready' but the verify-question-bank
 *   drain hadn't populated verified_question_count yet. The migration
 *   widens the RPC filter to IN ('partial', 'ready'), and these routes
 *   re-add a BOUNDED fallback:
 *     - If v2 returns empty AND student has a grade → fall back to
 *       GRADE_SUBJECTS (subjects) or `chapters` catalog (chapters) and
 *       log ops_events category='grounding.study_path'.
 *     - If v2 errors AND student has a grade → same fallback.
 *     - If v2 returns empty AND no student record → 200 { subjects: [] }
 *     - If v2 errors AND no student record → 500 service_unavailable
 *
 *   This is the bounded, observable version of the pre-Task-3.7 soft-fail.
 *   Tracked for removal alongside TODO-1 once cbse_syllabus reliably
 *   populates post-rollout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock scaffolding ────────────────────────────────────────────────────────

let _rpcImpl: (name: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
const _authGetUserMock = vi.fn();

// Student row returned by admin.from('students').select('grade')…
// Tests override this per-case to simulate "student found with grade" vs
// "no student record found" (drives the fallback branch).
let _studentLookup: { data: { grade: string } | null; error: null } = {
  data: null,
  error: null,
};

// Chapters catalog fallback (admin.from('chapters').select(...)…)
let _chaptersCatalog: {
  data: Array<{
    chapter_number: number;
    chapter_title: string;
    chapter_title_hi: string | null;
  }> | null;
  error: null;
} = { data: null, error: null };

// ops_events insert tracking — the hotfix emits these whenever fallback engages.
const _opsEventsInserts: Array<Record<string, unknown>> = [];

function makeFromChain(table: string) {
  if (table === 'students') {
    // .select('grade').or(...).limit(1).maybeSingle()
    // Also support the legacy .eq().maybeSingle() path (other callers).
    return {
      select: () => ({
        or: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve(_studentLookup),
          }),
        }),
        eq: () => ({
          maybeSingle: () => Promise.resolve(_studentLookup),
        }),
      }),
    };
  }
  if (table === 'chapters') {
    // .select('…').eq('grade', g).eq('subject_code', s).order('chapter_number', …)
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve(_chaptersCatalog),
          }),
        }),
      }),
    };
  }
  if (table === 'ops_events') {
    return {
      insert: (row: Record<string, unknown>) => {
        _opsEventsInserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }
  // Fallback for any other table — original test scaffold behavior
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  };
}

vi.mock('@/lib/supabase-admin', () => {
  const admin = {
    rpc: (name: string, args: unknown) => _rpcImpl(name, args),
    auth: {
      getUser: (...args: unknown[]) => _authGetUserMock(...args),
    },
    from: (table: string) => makeFromChain(table),
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
  _studentLookup = { data: null, error: null };
  _chaptersCatalog = { data: null, error: null };
  _opsEventsInserts.length = 0;
});

// ─── /api/student/subjects v1 (gating) + v2 (chapter counts) ─────────────────
//
// 2026-05-18 update: the route now calls both `get_available_subjects` (v1) for
// isLocked/icon/color/etc. and `get_available_subjects_v2` for chapter counts,
// merging by subject_code. v1 is the source of truth for the list. The
// fallback path engages when v1 returns empty/errors (not v2).

type V1Row = {
  code: string;
  name: string;
  name_hi: string | null;
  icon: string;
  color: string;
  subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  is_core: boolean;
  is_locked: boolean;
};
type V2Row = {
  subject_code: string;
  subject_display: string;
  subject_display_hi: string | null;
  ready_chapter_count: number;
};

function rpcRouter(opts: {
  v1?: { data: V1Row[] | null; error: { message: string } | null };
  v2?: { data: V2Row[] | null; error: { message: string } | null };
}) {
  return async (name: string) => {
    if (name === 'get_available_subjects') return opts.v1 ?? { data: [], error: null };
    if (name === 'get_available_subjects_v2') return opts.v2 ?? { data: [], error: null };
    return { data: [], error: null };
  };
}

describe('GET /api/student/subjects', () => {
  it('401 without auth', async () => {
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(new NextRequest('http://localhost/api/student/subjects'));
    expect(res.status).toBe(401);
  });

  it('200 empty when both RPCs return no rows AND no student record', async () => {
    authOk();
    _rpcImpl = rpcRouter({ v1: { data: [], error: null }, v2: { data: [], error: null } });
    _studentLookup = { data: null, error: null };
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjects).toEqual([]);
  });

  it('FALLBACK: 200 with GRADE_SUBJECTS-derived list when v1 empty AND student has grade', async () => {
    authOk();
    _rpcImpl = rpcRouter({ v1: { data: [], error: null }, v2: { data: [], error: null } });
    _studentLookup = { data: { grade: '10' }, error: null };
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.subjects)).toBe(true);
    expect(body.subjects.length).toBeGreaterThan(0);
    for (const s of body.subjects) {
      expect(s).toHaveProperty('code');
      expect(s).toHaveProperty('name');
      expect(s.readyChapterCount).toBe(0);
    }
    expect(_opsEventsInserts.length).toBeGreaterThan(0);
    expect(_opsEventsInserts[0]).toMatchObject({
      category: 'grounding.study_path',
      source: 'api.student.subjects',
      severity: 'warning',
    });
    expect(String(_opsEventsInserts[0].message)).toContain('v1_empty_rows');
  });

  it('returns merged subjects: v1 supplies isLocked/icon/color, v2 supplies chapter counts', async () => {
    authOk();
    _rpcImpl = rpcRouter({
      v1: {
        data: [
          {
            code: 'physics', name: 'Physics', name_hi: 'भौतिक विज्ञान',
            icon: '⚡', color: '#2563EB', subject_kind: 'cbse_core',
            is_core: true, is_locked: true,
          },
          {
            code: 'math', name: 'Mathematics', name_hi: null,
            icon: '∑', color: '#6C5CE7', subject_kind: 'cbse_core',
            is_core: true, is_locked: false,
          },
        ],
        error: null,
      },
      v2: {
        data: [
          { subject_code: 'physics', subject_display: 'Physics', subject_display_hi: null, ready_chapter_count: 4 },
          { subject_code: 'math',    subject_display: 'Mathematics', subject_display_hi: null, ready_chapter_count: 3 },
        ],
        error: null,
      },
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
      icon: '⚡',
      color: '#2563EB',
      isCore: true,
      isLocked: true,
      readyChapterCount: 4,
    });
    expect(body.subjects[1]).toMatchObject({
      code: 'math',
      nameHi: 'Mathematics',   // null name_hi falls back to name
      isLocked: false,
      readyChapterCount: 3,
    });
    expect(_opsEventsInserts.length).toBe(0);
  });

  it('chapter count defaults to 0 when v2 has no row for a v1 subject', async () => {
    authOk();
    _rpcImpl = rpcRouter({
      v1: {
        data: [{
          code: 'sanskrit', name: 'Sanskrit', name_hi: null,
          icon: '🪔', color: '#92400E', subject_kind: 'cbse_elective',
          is_core: false, is_locked: false,
        }],
        error: null,
      },
      v2: { data: [], error: null },  // cbse_syllabus drained
    });
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0]).toMatchObject({ code: 'sanskrit', readyChapterCount: 0 });
  });

  it('500 service_unavailable when v1 errors AND no student record', async () => {
    authOk();
    _rpcImpl = rpcRouter({
      v1: { data: null, error: { message: 'rpc down' } },
      v2: { data: [], error: null },
    });
    _studentLookup = { data: null, error: null };
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('service_unavailable');
    expect(body.subjects).toBeUndefined();
  });

  it('FALLBACK: 200 with GRADE_SUBJECTS list on v1 error if student has grade', async () => {
    authOk();
    _rpcImpl = rpcRouter({
      v1: { data: null, error: { message: 'rpc down' } },
      v2: { data: [], error: null },
    });
    _studentLookup = { data: { grade: '9' }, error: null };
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjects.length).toBeGreaterThan(0);
    expect(_opsEventsInserts[0]).toMatchObject({
      category: 'grounding.study_path',
      severity: 'warning',
    });
    expect(String(_opsEventsInserts[0].message)).toContain('v1_rpc_error');
  });

  it('v2 failure is non-fatal — v1 result still returned with readyChapterCount=0', async () => {
    authOk();
    _rpcImpl = rpcRouter({
      v1: {
        data: [{
          code: 'english', name: 'English', name_hi: null,
          icon: 'Aa', color: '#E17055', subject_kind: 'cbse_core',
          is_core: true, is_locked: false,
        }],
        error: null,
      },
      v2: { data: null, error: { message: 'v2 down' } },
    });
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0]).toMatchObject({ code: 'english', isLocked: false, readyChapterCount: 0 });
    expect(_opsEventsInserts.length).toBe(0);  // not a fallback — just a soft v2 miss
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

  it('200 empty when RPC returns no rows AND no student record', async () => {
    authOk();
    _rpcImpl = async (name, args) => {
      expect(name).toBe('available_chapters_for_student_subject_v2');
      expect((args as { p_subject_code: string }).p_subject_code).toBe('physics');
      return { data: [], error: null };
    };
    _studentLookup = { data: null, error: null };
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

  it('PHASE-3-RESTORED: 200 empty when RPC empty AND student has grade (no legacy-chapters fallback)', async () => {
    // The Phase-4 chapters-catalog fallback was reverted on 2026-04-24 (R2
    // stabilization, regression #4 in regression-academic-chain.test.ts)
    // because it produced cross-grade leakage and unverified-count ambiguity
    // that downstream AI surfaces couldn't distinguish from ground truth.
    // The chapters route now returns an empty list on empty RPC rows
    // regardless of whether a student record exists; the client renders an
    // empty-state card. Fallback continues to exist for /api/student/subjects
    // (see tests above) because the subject-level leakage risk is lower.
    authOk();
    _rpcImpl = async () => ({ data: [], error: null });
    _studentLookup = { data: { grade: '10' }, error: null };
    _chaptersCatalog = {
      data: [
        { chapter_number: 1, chapter_title: 'Motion', chapter_title_hi: null },
        { chapter_number: 2, chapter_title: 'Force', chapter_title_hi: null },
      ],
      error: null,
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
    // No ops_events fallback log — there is no fallback anymore.
    expect(_opsEventsInserts.length).toBe(0);
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

  it('503 service_unavailable on RPC error (no soft-fall to legacy chapters)', async () => {
    // Phase-3 contract restored 2026-04-24. RPC failure now returns
    // 503 service_unavailable regardless of student record or catalog
    // state; the client retries. See regression #4 in
    // regression-academic-chain.test.ts.
    authOk();
    _rpcImpl = async () => ({
      data: null,
      error: { message: 'rpc down' },
    });
    _studentLookup = { data: null, error: null };
    _chaptersCatalog = { data: null, error: null };
    const { GET } = await import('@/app/api/student/chapters/route');
    const res = await GET(
      new Request('http://localhost/api/student/chapters?subject=physics', {
        headers: { Authorization: 'Bearer t' },
      }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('service_unavailable');
    expect(body.chapters).toBeUndefined();
  });

  it('PHASE-3-RESTORED: 503 on RPC error even if student has grade AND catalog has rows', async () => {
    // The Phase-4 soft-fall fallback was removed: a populated student record
    // and populated catalog no longer turn an RPC failure into a 200 with
    // legacy-catalog chapters. The contract is now: RPC failure → 503.
    authOk();
    _rpcImpl = async () => ({
      data: null,
      error: { message: 'rpc down' },
    });
    _studentLookup = { data: { grade: '10' }, error: null };
    _chaptersCatalog = {
      data: [{ chapter_number: 1, chapter_title: 'Motion', chapter_title_hi: null }],
      error: null,
    };
    const { GET } = await import('@/app/api/student/chapters/route');
    const res = await GET(
      new Request('http://localhost/api/student/chapters?subject=physics', {
        headers: { Authorization: 'Bearer t' },
      }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('service_unavailable');
    expect(_opsEventsInserts.length).toBe(0);
  });
});
