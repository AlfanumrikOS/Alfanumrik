import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { backfillCbseSyllabus } from '../../scripts/backfill-cbse-syllabus';

// ─── Scaffolding mocks ────────────────────────────────────────────────────────

let _authGetUserMock = vi.fn();
let _rpcImpl = vi.fn();
let _studentLookup: { data: any; error: any } = { data: null, error: null };
let _gradeSubjectMapLookup: { data: any; error: any } = { data: null, error: null };
// Phase 3 P0: the subjects fallback now joins `subjects` and keeps only
// is_active rows, so the mock needs a second lookup for that table.
let _activeSubjectsLookup: { data: any; error: any } = { data: [], error: null };
let _insertedSyllabusRows: any[] = [];
let _opsEventsInserts: any[] = [];

// Simple mock chain builder
function makeFromChain(table: string) {
  if (table === 'students') {
    return {
      select: (fields: string) => {
        // Assert that we select grade and board
        expect(fields).toContain('grade');
        expect(fields).toContain('board');
        return {
          or: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve(_studentLookup),
            }),
          }),
        };
      },
    };
  }
  if (table === 'grade_subject_map') {
    // Thenable at every link so `.select()`, `.select().eq()` and
    // `.select().eq().eq()` all resolve — the route now filters by grade only
    // (board/stream are applied in TS, mirroring the RPC's grade_valid CTE),
    // while backfill-cbse-syllabus awaits `.select()` directly.
    const makeLink = (): any => ({
      eq: () => makeLink(),
      then: (onfulfilled?: any, onrejected?: any) =>
        Promise.resolve(_gradeSubjectMapLookup).then(onfulfilled, onrejected),
    });
    return { select: () => makeLink() };
  }
  if (table === 'subjects') {
    const link: any = {
      in: () => link,
      eq: () => link,
      then: (onfulfilled?: any, onrejected?: any) =>
        Promise.resolve(_activeSubjectsLookup).then(onfulfilled, onrejected),
    };
    return { select: () => link };
  }
  if (table === 'ops_events') {
    return {
      insert: (row: any) => {
        _opsEventsInserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  };
}

// Scaffold supabase admin mock
vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const admin = {
    rpc: (name: string, args: any) => _rpcImpl(name, args),
    auth: {
      getUser: (...args: any[]) => _authGetUserMock(...args),
    },
    from: (table: string) => {
      if (table === 'cbse_syllabus') {
        return {
          insert: (row: any) => {
            _insertedSyllabusRows.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      return makeFromChain(table);
    },
  };
  return {
    supabaseAdmin: admin,
    getSupabaseAdmin: () => admin,
  };
});

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    }),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Helper to construct request
function reqWithBearer(url: string) {
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer token-123' },
  });
}

function authOk(userId = 'user-123') {
  _authGetUserMock.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
}

describe('Board-Aware Curriculum Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _rpcImpl.mockReset();
    _authGetUserMock.mockReset();
    _studentLookup = { data: null, error: null };
    _gradeSubjectMapLookup = { data: null, error: null };
    _activeSubjectsLookup = { data: [], error: null };
    _insertedSyllabusRows = [];
    _opsEventsInserts = [];
  });

  describe('GET /api/student/subjects Fallback Routing', () => {
    it('selects grade and board from students and falls back to grade_subject_map custom subjects for ICSE', async () => {
      authOk();
      
      // Force RPCs to fail/return empty so the fallback is triggered
      _rpcImpl.mockResolvedValue({ data: [], error: null });

      // Mock student response with board 'ICSE'
      _studentLookup = {
        data: { grade: '10', board: 'ICSE' },
        error: null,
      };

      // Mock custom mappings in grade_subject_map for grade 10 ICSE
      _gradeSubjectMapLookup = {
        data: [
          { subject_code: 'physics', is_core: true, board: 'ICSE', stream: null },
          { subject_code: 'chemistry', is_core: true, board: 'ICSE', stream: null },
          { subject_code: 'biology', is_core: false, board: 'ICSE', stream: null },
        ],
        error: null,
      };
      // The is_active join — all three are active in the catalogue.
      _activeSubjectsLookup = {
        data: [
          { code: 'physics', name: 'Physics', name_hi: 'भौतिकी', icon: '⚛️', color: '#2563EB', subject_kind: 'cbse_core' },
          { code: 'chemistry', name: 'Chemistry', name_hi: 'रसायन', icon: '🧪', color: '#10B981', subject_kind: 'cbse_core' },
          { code: 'biology', name: 'Biology', name_hi: 'जीव विज्ञान', icon: '🧬', color: '#F59E0B', subject_kind: 'cbse_core' },
        ],
        error: null,
      };

      const { GET } = await import('@/app/api/student/subjects/route');
      const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.subjects).toBeDefined();
      expect(body.subjects).toHaveLength(3);

      const codes = body.subjects.map((s: any) => s.code);
      expect(codes).toContain('physics');
      expect(codes).toContain('chemistry');
      expect(codes).toContain('biology');

      const physics = body.subjects.find((s: any) => s.code === 'physics');
      expect(physics.isCore).toBe(true);
      // Display metadata now comes from the `subjects` table, not SUBJECT_META.
      expect(physics.color).toBe('#2563EB');
      expect(physics.nameHi).toBe('भौतिकी');
      // Phase 3 P0: fallback has no plan context, so it fails CLOSED.
      expect(physics.isLocked).toBe(true);

      const biology = body.subjects.find((s: any) => s.code === 'biology');
      expect(biology.isCore).toBe(false);
      expect(biology.isLocked).toBe(true);

      expect(_opsEventsInserts).toHaveLength(1);
      expect(_opsEventsInserts[0].message).toContain('v1_empty_rows');
    });

    it('returns an EMPTY list (never the hardcoded catalogue) when no active mapping exists for the board', async () => {
      // Phase 3 P0 leak closure. This test used to assert the opposite: that a
      // board with no grade_subject_map rows fell through to
      // getSubjectsForGrade('10') and served math/science/english/hindi/
      // social_studies/computer_science with isLocked=false — i.e. the
      // hardcoded 16-subject shim, bypassing `subjects.is_active` entirely.
      // After the KEEP-SET restriction that shim is a leak, so the fallback
      // now returns nothing and lets the picker show a support message.
      authOk();
      _rpcImpl.mockResolvedValue({ data: [], error: null });

      // Student with board 'ICSE' but no mappings returned from DB
      _studentLookup = {
        data: { grade: '10', board: 'ICSE' },
        error: null,
      };
      _gradeSubjectMapLookup = {
        data: [],
        error: null,
      };

      const { GET } = await import('@/app/api/student/subjects/route');
      const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.subjects).toEqual([]);

      // The drift is still logged so ops can see it.
      expect(_opsEventsInserts).toHaveLength(1);
      expect(_opsEventsInserts[0].message).toContain('v1_empty_rows');
      expect(_opsEventsInserts[0].context.fallback_subject_count).toBe(0);
    });

    it('board fallback: a board with no mapping inherits the generic CBSE/NULL rows', async () => {
      // Mirrors get_available_subjects' grade_valid CTE: board-specific rows
      // win outright, and the CBSE/Other/NULL rows apply only when the
      // student's own board has no mapping at that grade.
      authOk();
      _rpcImpl.mockResolvedValue({ data: [], error: null });
      _studentLookup = { data: { grade: '9', board: 'ICSE', stream: null }, error: null };
      _gradeSubjectMapLookup = {
        data: [
          { subject_code: 'math', is_core: true, board: 'CBSE', stream: null },
          { subject_code: 'science', is_core: true, board: null, stream: null },
          // Belongs to another board entirely — must not leak in.
          { subject_code: 'physics', is_core: true, board: 'IB', stream: null },
        ],
        error: null,
      };
      _activeSubjectsLookup = {
        data: [
          { code: 'math', name: 'Mathematics', name_hi: 'गणित', icon: '∑', color: '#111', subject_kind: 'cbse_core' },
          { code: 'science', name: 'Science', name_hi: 'विज्ञान', icon: '🔬', color: '#222', subject_kind: 'cbse_core' },
        ],
        error: null,
      };

      const { GET } = await import('@/app/api/student/subjects/route');
      const res = await GET(reqWithBearer('http://localhost/api/student/subjects'));
      const body = await res.json();

      expect(body.subjects.map((s: any) => s.code).sort()).toEqual(['math', 'science']);
      expect(body.subjects.every((s: any) => s.isLocked === true)).toBe(true);
    });
  });

  describe('backfill-cbse-syllabus.ts Board-Awareness', () => {
    it('inserts cbse_syllabus with resolved board from grade_subject_map lookup if not present in source tuples', async () => {
      // Mock source RPCs returning tuples
      _rpcImpl.mockImplementation((name) => {
        if (name === 'distinct_chapter_tuples_from_chunks') {
          return Promise.resolve({
            data: [
              { grade: '10', subject_code: 'physics', chapter_number: 1, chapter_title: 'Light Reflection', subject_display: 'Physics' }
            ],
            error: null,
          });
        }
        if (name === 'distinct_chapter_tuples_from_bank') {
          return Promise.resolve({
            data: [
              { grade: '10', subject_code: 'chemistry', chapter_number: 2, chapter_title: 'Acids and Bases', subject_display: 'Chemistry' }
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      // Mock grade_subject_map mappings
      _gradeSubjectMapLookup = {
        data: [
          { grade: '10', subject_code: 'physics', board: 'ICSE' },
          { grade: '10', subject_code: 'chemistry', board: 'ICSE' }
        ],
        error: null,
      };

      const result = await backfillCbseSyllabus({ dryRun: false });
      expect(result.inserted).toBe(2);
      expect(result.planned).toBe(2);

      expect(_insertedSyllabusRows).toHaveLength(2);
      
      const physicsRow = _insertedSyllabusRows.find(r => r.subject_code === 'physics');
      expect(physicsRow.board).toBe('ICSE');
      expect(physicsRow.grade).toBe('10');
      expect(physicsRow.chapter_number).toBe(1);

      const chemistryRow = _insertedSyllabusRows.find(r => r.subject_code === 'chemistry');
      expect(chemistryRow.board).toBe('ICSE');
      expect(chemistryRow.grade).toBe('10');
      expect(chemistryRow.chapter_number).toBe(2);
    });

    it('uses board property from source tuple if populated', async () => {
      // Mock source RPCs returning tuples with explicit board property
      _rpcImpl.mockImplementation((name) => {
        if (name === 'distinct_chapter_tuples_from_chunks') {
          return Promise.resolve({
            data: [
              { grade: '10', subject_code: 'biology', chapter_number: 3, chapter_title: 'Life Processes', subject_display: 'Biology', board: 'IB' }
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      _gradeSubjectMapLookup = {
        data: [],
        error: null,
      };

      const result = await backfillCbseSyllabus({ dryRun: false });
      expect(result.inserted).toBe(1);

      expect(_insertedSyllabusRows).toHaveLength(1);
      expect(_insertedSyllabusRows[0].subject_code).toBe('biology');
      expect(_insertedSyllabusRows[0].board).toBe('IB');
    });

    it('falls back to CBSE if no board matches in lookup or source tuple', async () => {
      _rpcImpl.mockImplementation((name) => {
        if (name === 'distinct_chapter_tuples_from_chunks') {
          return Promise.resolve({
            data: [
              { grade: '10', subject_code: 'coding', chapter_number: 1, chapter_title: 'Introduction', subject_display: 'Coding' }
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      _gradeSubjectMapLookup = {
        data: [],
        error: null,
      };

      const result = await backfillCbseSyllabus({ dryRun: false });
      expect(result.inserted).toBe(1);

      expect(_insertedSyllabusRows).toHaveLength(1);
      expect(_insertedSyllabusRows[0].subject_code).toBe('coding');
      expect(_insertedSyllabusRows[0].board).toBe('CBSE');
    });
  });
});
