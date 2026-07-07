import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { backfillCbseSyllabus } from '../../scripts/backfill-cbse-syllabus';

// ─── Scaffolding mocks ────────────────────────────────────────────────────────

let _authGetUserMock = vi.fn();
let _rpcImpl = vi.fn();
let _studentLookup: { data: any; error: any } = { data: null, error: null };
let _gradeSubjectMapLookup: { data: any; error: any } = { data: null, error: null };
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
    return {
      select: (fields: string) => {
        const resultPromise = Promise.resolve(_gradeSubjectMapLookup);
        const eq2 = (f2: string, v2: any) => resultPromise;
        const eq1 = (f1: string, v1: any) => ({ eq: eq2 });
        return {
          eq: eq1,
          then: (onfulfilled?: any, onrejected?: any) => resultPromise.then(onfulfilled, onrejected),
        };
      },
    };
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
          { subject_code: 'physics', is_core: true },
          { subject_code: 'chemistry', is_core: true },
          { subject_code: 'biology', is_core: false },
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
      expect(physics.color).toBe('#2563EB'); // standard color from SUBJECT_META

      const biology = body.subjects.find((s: any) => s.code === 'biology');
      expect(biology.isCore).toBe(false);

      expect(_opsEventsInserts).toHaveLength(1);
      expect(_opsEventsInserts[0].message).toContain('v1_empty_rows');
    });

    it('falls back to default CBSE subjects from constants if no custom mapping exists for board', async () => {
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
      expect(body.subjects).toBeDefined();
      // Should fall back to CBSE Grade 10 default subjects: math, science, english, hindi, social_studies, computer_science
      const codes = body.subjects.map((s: any) => s.code);
      expect(codes).toContain('math');
      expect(codes).toContain('science');
      expect(codes).toContain('english');
      expect(codes).toContain('hindi');
      expect(codes).toContain('social_studies');
      expect(codes).toContain('computer_science');
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
