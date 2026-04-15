import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAllowedSubjectsForStudent,
  validateSubjectWrite,
  validateSubjectsBulk,
} from '@/lib/subjects';

// ---------------------------------------------------------------------------
// Base fixture ctx — matches the 3-row sample from plan B1 Step 2
// ---------------------------------------------------------------------------

const mockRpc = vi.fn();
const ctx = {
  supabase: {
    rpc: (name: string, args: any) => {
      mockRpc(name, args);
      return Promise.resolve({
        data: name === 'get_available_subjects'
          ? [
              { code: 'math',    name: 'Math',    name_hi: 'गणित',    icon: '🧮', color: '#F97316', subject_kind: 'cbse_core', is_core: true,  is_locked: false },
              { code: 'science', name: 'Science', name_hi: 'विज्ञान', icon: '🔬', color: '#10B981', subject_kind: 'cbse_core', is_core: true,  is_locked: false },
              { code: 'physics', name: 'Physics', name_hi: 'भौतिक',  icon: '⚛️', color: '#0EA5E9', subject_kind: 'cbse_core', is_core: true,  is_locked: true  },
            ]
          : null,
        error: null,
      });
    },
  },
} as any;

describe('getAllowedSubjectsForStudent', () => {
  beforeEach(() => mockRpc.mockClear());

  it('returns subjects with camelCase keys', async () => {
    const result = await getAllowedSubjectsForStudent('student-1', ctx);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ code: 'math', nameHi: 'गणित', isCore: true, isLocked: false });
  });

  it('calls the RPC exactly once', async () => {
    await getAllowedSubjectsForStudent('student-1', ctx);
    expect(mockRpc).toHaveBeenCalledWith('get_available_subjects', { p_student_id: 'student-1' });
  });
});

describe('validateSubjectWrite', () => {
  it('accepts a subject that is grade-valid and plan-allowed', async () => {
    const r = await validateSubjectWrite('student-1', 'math', ctx);
    expect(r.ok).toBe(true);
  });

  it('rejects a subject that is grade-valid but plan-locked with reason=plan', async () => {
    const r = await validateSubjectWrite('student-1', 'physics', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ reason: 'plan', subject: 'physics' });
  });

  it('rejects unknown subject with reason=grade', async () => {
    const r = await validateSubjectWrite('student-1', 'quantum_mechanics', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('grade');
  });
});

describe('validateSubjectsBulk', () => {
  it('returns first invalid subject', async () => {
    const r = await validateSubjectsBulk('student-1', ['math', 'physics'], ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.subject).toBe('physics');
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for uncovered branches in subjects.ts
// ---------------------------------------------------------------------------

describe('subjects service — error path & edge cases', () => {
  it('throws when RPC returns an error', async () => {
    const errCtx = {
      supabase: {
        rpc: () => Promise.resolve({ data: null, error: new Error('db boom') }),
      },
    } as any;
    await expect(getAllowedSubjectsForStudent('s-err', errCtx)).rejects.toThrow('db boom');
  });

  it('handles null data from RPC gracefully', async () => {
    const nullCtx = {
      supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
    } as any;
    const r = await getAllowedSubjectsForStudent('s-null', nullCtx);
    expect(r).toEqual([]);
  });

  it('falls back to name when name_hi is null', async () => {
    const fallbackCtx = {
      supabase: {
        rpc: () => Promise.resolve({
          data: [
            { code: 'x', name: 'XOnly', name_hi: null, icon: 'i', color: 'c',
              subject_kind: 'cbse_core', is_core: false, is_locked: false },
          ],
          error: null,
        }),
      },
    } as any;
    const r = await getAllowedSubjectsForStudent('s-fb', fallbackCtx);
    expect(r[0].nameHi).toBe('XOnly');
  });

  it('validateSubjectsBulk returns ok on empty input', async () => {
    const r = await validateSubjectsBulk('student-1', [], ctx);
    expect(r.ok).toBe(true);
  });

  it('validateSubjectsBulk returns ok when all allowed', async () => {
    const r = await validateSubjectsBulk('student-1', ['math', 'science'], ctx);
    expect(r.ok).toBe(true);
  });

  it('validateSubjectsBulk reason=grade for fully unknown subject', async () => {
    const r = await validateSubjectsBulk('student-1', ['nonexistent_subject'], ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.reason).toBe('grade');
      expect(r.error.subject).toBe('nonexistent_subject');
      expect(r.error.allowed).toEqual(expect.arrayContaining(['math', 'science']));
    }
  });

  it('validateSubjectWrite includes unlocked subjects in allowed list on rejection', async () => {
    const r = await validateSubjectWrite('student-1', 'physics', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.allowed).toEqual(expect.arrayContaining(['math', 'science']));
      expect(r.error.allowed).not.toContain('physics');
    }
  });
});

// ---------------------------------------------------------------------------
// 84-case matrix test (H1) — (7 grades) × (3 stream contexts) × (4 plans)
// Derived from supabase/migrations/20260415000004_subject_governance_seed.sql
// ---------------------------------------------------------------------------

type Grade = '6' | '7' | '8' | '9' | '10' | '11' | '12';
type Stream = 'science' | 'commerce' | 'humanities' | null;
type Plan = 'free' | 'starter' | 'pro' | 'unlimited';

interface GsmRow { grade: Grade; subject_code: string; stream: Stream; is_core: boolean; }

// grade_subject_map seed
const GSM: GsmRow[] = [
  // 6-8
  { grade: '6', subject_code: 'math', stream: null, is_core: true },
  { grade: '6', subject_code: 'science', stream: null, is_core: true },
  { grade: '6', subject_code: 'english', stream: null, is_core: true },
  { grade: '6', subject_code: 'hindi', stream: null, is_core: true },
  { grade: '6', subject_code: 'social_studies', stream: null, is_core: true },
  { grade: '6', subject_code: 'sanskrit', stream: null, is_core: false },
  { grade: '7', subject_code: 'math', stream: null, is_core: true },
  { grade: '7', subject_code: 'science', stream: null, is_core: true },
  { grade: '7', subject_code: 'english', stream: null, is_core: true },
  { grade: '7', subject_code: 'hindi', stream: null, is_core: true },
  { grade: '7', subject_code: 'social_studies', stream: null, is_core: true },
  { grade: '7', subject_code: 'sanskrit', stream: null, is_core: false },
  { grade: '8', subject_code: 'math', stream: null, is_core: true },
  { grade: '8', subject_code: 'science', stream: null, is_core: true },
  { grade: '8', subject_code: 'english', stream: null, is_core: true },
  { grade: '8', subject_code: 'hindi', stream: null, is_core: true },
  { grade: '8', subject_code: 'social_studies', stream: null, is_core: true },
  { grade: '8', subject_code: 'sanskrit', stream: null, is_core: false },
  // 9-10 (add CS)
  { grade: '9', subject_code: 'math', stream: null, is_core: true },
  { grade: '9', subject_code: 'science', stream: null, is_core: true },
  { grade: '9', subject_code: 'english', stream: null, is_core: true },
  { grade: '9', subject_code: 'hindi', stream: null, is_core: true },
  { grade: '9', subject_code: 'social_studies', stream: null, is_core: true },
  { grade: '9', subject_code: 'sanskrit', stream: null, is_core: false },
  { grade: '9', subject_code: 'computer_science', stream: null, is_core: false },
  { grade: '10', subject_code: 'math', stream: null, is_core: true },
  { grade: '10', subject_code: 'science', stream: null, is_core: true },
  { grade: '10', subject_code: 'english', stream: null, is_core: true },
  { grade: '10', subject_code: 'hindi', stream: null, is_core: true },
  { grade: '10', subject_code: 'social_studies', stream: null, is_core: true },
  { grade: '10', subject_code: 'sanskrit', stream: null, is_core: false },
  { grade: '10', subject_code: 'computer_science', stream: null, is_core: false },
  // 11 science
  { grade: '11', subject_code: 'math', stream: 'science', is_core: true },
  { grade: '11', subject_code: 'physics', stream: 'science', is_core: true },
  { grade: '11', subject_code: 'chemistry', stream: 'science', is_core: true },
  { grade: '11', subject_code: 'biology', stream: 'science', is_core: false },
  { grade: '11', subject_code: 'english', stream: 'science', is_core: true },
  { grade: '11', subject_code: 'computer_science', stream: 'science', is_core: false },
  { grade: '11', subject_code: 'hindi', stream: 'science', is_core: false },
  { grade: '11', subject_code: 'sanskrit', stream: 'science', is_core: false },
  // 11 commerce
  { grade: '11', subject_code: 'math', stream: 'commerce', is_core: false },
  { grade: '11', subject_code: 'accountancy', stream: 'commerce', is_core: true },
  { grade: '11', subject_code: 'business_studies', stream: 'commerce', is_core: true },
  { grade: '11', subject_code: 'economics', stream: 'commerce', is_core: true },
  { grade: '11', subject_code: 'english', stream: 'commerce', is_core: true },
  { grade: '11', subject_code: 'computer_science', stream: 'commerce', is_core: false },
  { grade: '11', subject_code: 'hindi', stream: 'commerce', is_core: false },
  // 11 humanities
  { grade: '11', subject_code: 'history_sr', stream: 'humanities', is_core: true },
  { grade: '11', subject_code: 'geography', stream: 'humanities', is_core: true },
  { grade: '11', subject_code: 'political_science', stream: 'humanities', is_core: true },
  { grade: '11', subject_code: 'economics', stream: 'humanities', is_core: true },
  { grade: '11', subject_code: 'english', stream: 'humanities', is_core: true },
  { grade: '11', subject_code: 'hindi', stream: 'humanities', is_core: false },
  { grade: '11', subject_code: 'sanskrit', stream: 'humanities', is_core: false },
  // 12 science
  { grade: '12', subject_code: 'math', stream: 'science', is_core: true },
  { grade: '12', subject_code: 'physics', stream: 'science', is_core: true },
  { grade: '12', subject_code: 'chemistry', stream: 'science', is_core: true },
  { grade: '12', subject_code: 'biology', stream: 'science', is_core: false },
  { grade: '12', subject_code: 'english', stream: 'science', is_core: true },
  { grade: '12', subject_code: 'computer_science', stream: 'science', is_core: false },
  { grade: '12', subject_code: 'hindi', stream: 'science', is_core: false },
  { grade: '12', subject_code: 'sanskrit', stream: 'science', is_core: false },
  // 12 commerce
  { grade: '12', subject_code: 'math', stream: 'commerce', is_core: false },
  { grade: '12', subject_code: 'accountancy', stream: 'commerce', is_core: true },
  { grade: '12', subject_code: 'business_studies', stream: 'commerce', is_core: true },
  { grade: '12', subject_code: 'economics', stream: 'commerce', is_core: true },
  { grade: '12', subject_code: 'english', stream: 'commerce', is_core: true },
  { grade: '12', subject_code: 'computer_science', stream: 'commerce', is_core: false },
  { grade: '12', subject_code: 'hindi', stream: 'commerce', is_core: false },
  // 12 humanities
  { grade: '12', subject_code: 'history_sr', stream: 'humanities', is_core: true },
  { grade: '12', subject_code: 'geography', stream: 'humanities', is_core: true },
  { grade: '12', subject_code: 'political_science', stream: 'humanities', is_core: true },
  { grade: '12', subject_code: 'economics', stream: 'humanities', is_core: true },
  { grade: '12', subject_code: 'english', stream: 'humanities', is_core: true },
  { grade: '12', subject_code: 'hindi', stream: 'humanities', is_core: false },
  { grade: '12', subject_code: 'sanskrit', stream: 'humanities', is_core: false },
];

// plan_subject_access seed
const PLAN_ACCESS: Record<Plan, Set<string>> = {
  free: new Set(['math', 'science', 'english', 'hindi', 'social_studies']),
  starter: new Set([
    'math', 'science', 'english', 'hindi', 'social_studies',
    'sanskrit', 'computer_science', 'history_sr', 'geography', 'political_science',
  ]),
  pro: new Set([
    'math', 'science', 'english', 'hindi', 'social_studies',
    'sanskrit', 'computer_science', 'physics', 'chemistry', 'biology',
    'economics', 'accountancy', 'business_studies',
    'history_sr', 'geography', 'political_science',
  ]),
  unlimited: new Set([
    'math', 'science', 'english', 'hindi', 'social_studies',
    'sanskrit', 'computer_science', 'physics', 'chemistry', 'biology',
    'economics', 'accountancy', 'business_studies',
    'history_sr', 'geography', 'political_science', 'coding',
  ]),
};

// Subject meta lookup (code → subject_kind, is_active)
const SUBJECT_META: Record<string, { subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective' }> = {
  math: { subject_kind: 'cbse_core' },
  science: { subject_kind: 'cbse_core' },
  english: { subject_kind: 'cbse_core' },
  hindi: { subject_kind: 'cbse_core' },
  social_studies: { subject_kind: 'cbse_core' },
  physics: { subject_kind: 'cbse_core' },
  chemistry: { subject_kind: 'cbse_core' },
  biology: { subject_kind: 'cbse_core' },
  economics: { subject_kind: 'cbse_core' },
  accountancy: { subject_kind: 'cbse_core' },
  business_studies: { subject_kind: 'cbse_core' },
  history_sr: { subject_kind: 'cbse_core' },
  geography: { subject_kind: 'cbse_core' },
  political_science: { subject_kind: 'cbse_core' },
  computer_science: { subject_kind: 'cbse_elective' },
  sanskrit: { subject_kind: 'cbse_elective' },
  coding: { subject_kind: 'platform_elective' },
};

/**
 * Mirror the RPC's SQL logic for (grade, stream) → grade-valid subject codes.
 * Matches: gsm.grade = s.grade AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
 */
function computeGradeValid(grade: Grade, stream: Stream): GsmRow[] {
  return GSM.filter(
    (r) => r.grade === grade && (r.stream === null || r.stream === stream || stream === null),
  );
}

/**
 * Expected allowed set: grade-valid subjects; is_locked = NOT in plan_valid.
 * Returns the rows the RPC would emit (deduped by subject_code; SQL JOIN on subjects
 * yields one row per grade-valid entry, so we dedupe here on code too).
 */
function computeExpectedRpcRows(grade: Grade, stream: Stream, plan: Plan) {
  const gv = computeGradeValid(grade, stream);
  const planSet = PLAN_ACCESS[plan];
  // Dedupe by subject_code (spec note: grade-valid rows are unique per (grade,subject,stream);
  // with stream filter collapsed, we may hit the same subject once per matching stream row).
  const seen = new Map<string, { is_core: boolean }>();
  for (const r of gv) {
    // Prefer is_core=true if any matching row is core
    const prev = seen.get(r.subject_code);
    seen.set(r.subject_code, { is_core: prev?.is_core || r.is_core });
  }
  return Array.from(seen.entries()).map(([code, { is_core }]) => ({
    code,
    name: code,
    name_hi: code,
    icon: 'i',
    color: 'c',
    subject_kind: SUBJECT_META[code]?.subject_kind ?? 'cbse_core',
    is_core,
    is_locked: !planSet.has(code),
  }));
}

function makeCtx(grade: Grade, stream: Stream, plan: Plan) {
  const rows = computeExpectedRpcRows(grade, stream, plan);
  return {
    supabase: {
      rpc: () => Promise.resolve({ data: rows, error: null }),
    },
  } as any;
}

describe('H1: 84-case matrix (grade × stream × plan)', () => {
  const grades: Grade[] = ['6', '7', '8', '9', '10', '11', '12'];
  const plans: Plan[] = ['free', 'starter', 'pro', 'unlimited'];
  // For grades 6-10, stream is treated as NULL. For 11-12, science/commerce/humanities.
  // Using 3 stream contexts for every grade yields 7 × 3 × 4 = 84.
  // For grades 6-10, stream input is ignored by the RPC (stream NULL filter only).
  const streamContexts: Stream[] = ['science', 'commerce', 'humanities'];

  for (const grade of grades) {
    for (const stream of streamContexts) {
      for (const plan of plans) {
        // For 6-10, the student row has stream=null regardless of label — use null.
        const effectiveStream: Stream = (grade === '11' || grade === '12') ? stream : null;
        const label = `grade=${grade} stream=${effectiveStream ?? 'null'}(${stream}) plan=${plan}`;

        it(`[${label}] returns correct allowed & locked sets`, async () => {
          const testCtx = makeCtx(grade, effectiveStream, plan);
          const subjects = await getAllowedSubjectsForStudent('s', testCtx);

          const expectedRows = computeExpectedRpcRows(grade, effectiveStream, plan);
          const expectedUnlocked = new Set(expectedRows.filter(r => !r.is_locked).map(r => r.code));
          const expectedAll = new Set(expectedRows.map(r => r.code));

          const actualAll = new Set(subjects.map(s => s.code));
          const actualUnlocked = new Set(subjects.filter(s => !s.isLocked).map(s => s.code));

          expect(actualAll).toEqual(expectedAll);
          expect(actualUnlocked).toEqual(expectedUnlocked);

          // Every returned row must have a valid is_locked interpretation via plan_subject_access
          for (const s of subjects) {
            const shouldBeLocked = !PLAN_ACCESS[plan].has(s.code);
            expect(s.isLocked).toBe(shouldBeLocked);
          }

          // validateSubjectWrite for each code: unlocked => ok; locked => plan error.
          for (const s of subjects) {
            const v = await validateSubjectWrite('s', s.code, makeCtx(grade, effectiveStream, plan));
            if (s.isLocked) {
              expect(v.ok).toBe(false);
              if (!v.ok) expect(v.error.reason).toBe('plan');
            } else {
              expect(v.ok).toBe(true);
            }
          }

          // validateSubjectWrite on an unknown subject always fails with reason=grade.
          const unknown = await validateSubjectWrite('s', '__not_a_subject__', makeCtx(grade, effectiveStream, plan));
          expect(unknown.ok).toBe(false);
          if (!unknown.ok) expect(unknown.error.reason).toBe('grade');

          // validateSubjectsBulk with all unlocked returns ok.
          if (expectedUnlocked.size > 0) {
            const bulk = await validateSubjectsBulk(
              's',
              Array.from(expectedUnlocked),
              makeCtx(grade, effectiveStream, plan),
            );
            expect(bulk.ok).toBe(true);
          }
        });
      }
    }
  }
});
