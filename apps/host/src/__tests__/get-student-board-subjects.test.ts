/**
 * Unit pins for `getStudentBoardSubjects(studentId, grade)` —
 * `apps/host/src/app/api/cron/board-score/_lib/get-student-board-subjects.ts`.
 *
 * This is the BoardScore subject-scoping fix's core logic (spec
 * docs/superpowers/specs/2026-07-30-boardscore-subject-scoping.md §4, §8
 * acceptance criteria AC2-AC4). It is a pure-ish function: no logic branches
 * on anything but the three mocked Supabase reads, so a fully-mocked
 * `supabaseAdmin` gives full behavioral coverage without a live DB.
 *
 * Mock shape: `supabaseAdmin.from(table)` returns a thenable chainable
 * builder (every method returns itself; `await` resolves via `.then`) whose
 * resolved `{ data, error }` is configured per-table via `_state`. Each
 * chain method call is also recorded in `_calls[table]` so tests can assert
 * the EXACT filter arguments the function used — not just trust that the
 * final return value happens to match, per the task instruction to verify
 * subject_kind filtering "via a subject_kind join, not by assuming."
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

interface TableResponse {
  data: unknown;
  error: unknown;
}

const _state: {
  students: TableResponse;
  subjects: TableResponse;
  cbse_chapter_weights: TableResponse;
} = {
  students: { data: { selected_subjects: ['math'] }, error: null },
  subjects: { data: [{ code: 'math' }], error: null },
  cbse_chapter_weights: { data: [{ subject_code: 'math' }], error: null },
};

type CallRecord = { method: string; args: unknown[] };
const _calls: Record<string, CallRecord[]> = {
  students: [],
  subjects: [],
  cbse_chapter_weights: [],
};

const fromSpy = vi.fn();

function makeBuilder(table: keyof typeof _state) {
  const builder: Record<string, unknown> = {};
  const record = (method: string) =>
    (...args: unknown[]) => {
      _calls[table].push({ method, args });
      return builder;
    };
  builder.select = vi.fn(record('select'));
  builder.eq = vi.fn(record('eq'));
  builder.in = vi.fn(record('in'));
  builder.single = vi.fn(record('single'));
  builder.then = (resolve: (v: TableResponse) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(_state[table]).then(resolve, reject);
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      fromSpy(table);
      return makeBuilder(table as keyof typeof _state);
    },
  },
}));

let getStudentBoardSubjects: (studentId: string, grade: string) => Promise<string[]>;

beforeEach(async () => {
  vi.clearAllMocks();
  fromSpy.mockClear();
  _calls.students = [];
  _calls.subjects = [];
  _calls.cbse_chapter_weights = [];
  _state.students = { data: { selected_subjects: ['math'] }, error: null };
  _state.subjects = { data: [{ code: 'math' }], error: null };
  _state.cbse_chapter_weights = { data: [{ subject_code: 'math' }], error: null };

  const mod = await import('@/app/api/cron/board-score/_lib/get-student-board-subjects');
  getStudentBoardSubjects = mod.getStudentBoardSubjects;
});

describe('getStudentBoardSubjects', () => {
  // ── AC2 ────────────────────────────────────────────────────────────────────
  it('AC2: selected_subjects=["math"] at grade 10 returns exactly ["math"], never the other grade-10-weighted subjects', async () => {
    _state.students = { data: { selected_subjects: ['math'] }, error: null };
    _state.subjects = { data: [{ code: 'math' }], error: null };
    _state.cbse_chapter_weights = { data: [{ subject_code: 'math' }], error: null };

    const result = await getStudentBoardSubjects(STUDENT_ID, '10');

    expect(result).toEqual(['math']);
    expect(result).not.toContain('science');
    expect(result).not.toContain('social_studies');
    expect(result).not.toContain('english');

    // The subjects table was queried scoped to the elected list only — the
    // function never asks the DB about subjects the student didn't pick.
    const subjectsInCalls = _calls.subjects.filter((c) => c.method === 'in');
    expect(subjectsInCalls[0].args).toEqual(['code', ['math']]);
    expect(subjectsInCalls[1].args).toEqual(['subject_kind', ['cbse_core', 'cbse_elective']]);

    const weightCalls = _calls.cbse_chapter_weights;
    expect(weightCalls.some((c) => c.method === 'eq' && c.args[0] === 'grade' && c.args[1] === '10')).toBe(true);
    expect(weightCalls.some((c) => c.method === 'eq' && c.args[0] === 'board' && c.args[1] === 'CBSE')).toBe(true);
  });

  // ── AC3 ────────────────────────────────────────────────────────────────────
  it('AC3: selected_subjects=[] returns [] with no fallback to "all subjects" — subjects/weights tables never queried', async () => {
    _state.students = { data: { selected_subjects: [] }, error: null };

    const result = await getStudentBoardSubjects(STUDENT_ID, '10');

    expect(result).toEqual([]);
    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith('students');
    expect(fromSpy).not.toHaveBeenCalledWith('subjects');
    expect(fromSpy).not.toHaveBeenCalledWith('cbse_chapter_weights');
  });

  it('AC3: selected_subjects=NULL returns [] (NULL-safe, not a throw)', async () => {
    _state.students = { data: { selected_subjects: null }, error: null };

    const result = await getStudentBoardSubjects(STUDENT_ID, '10');

    expect(result).toEqual([]);
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });

  // ── AC4 ────────────────────────────────────────────────────────────────────
  it('AC4: "coding" in selected_subjects never appears in the result, verified via the subject_kind filter args (not assumed)', async () => {
    // A student who legitimately picked both math (cbse_core) and coding
    // (platform_elective). The real DB's `.in('subject_kind', [...])` filter
    // would exclude coding from the `subjects` response — we simulate that
    // DB-side filtering in the mocked response, matching what a real
    // Postgres filter would return.
    _state.students = { data: { selected_subjects: ['math', 'coding'] }, error: null };
    _state.subjects = { data: [{ code: 'math' }], error: null }; // coding filtered out by subject_kind
    _state.cbse_chapter_weights = { data: [{ subject_code: 'math' }], error: null };

    const result = await getStudentBoardSubjects(STUDENT_ID, '10');

    expect(result).toEqual(['math']);
    expect(result).not.toContain('coding');

    // Prove the exclusion is structural, not incidental: the subjects query
    // requested BOTH elected codes (coding included) but constrained by
    // subject_kind IN (cbse_core, cbse_elective) — platform_elective is
    // never in that allow-list.
    const subjectsInCalls = _calls.subjects.filter((c) => c.method === 'in');
    expect(subjectsInCalls[0].args).toEqual(['code', ['math', 'coding']]);
    const kindFilterArgs = subjectsInCalls[1].args as [string, string[]];
    expect(kindFilterArgs[0]).toBe('subject_kind');
    expect(kindFilterArgs[1]).not.toContain('platform_elective');
    expect(kindFilterArgs[1]).toEqual(['cbse_core', 'cbse_elective']);

    // And the cbse_chapter_weights query is scoped to the board-eligible set
    // (math only) — coding can never even be asked about at step 3, even if
    // a stray weights row for it existed.
    const weightInCall = _calls.cbse_chapter_weights.find((c) => c.method === 'in');
    expect(weightInCall?.args).toEqual(['subject_code', ['math']]);
  });

  // ── No-weights-at-grade exclusion ────────────────────────────────────────────
  it('a selected subject with NO cbse_chapter_weights row at this grade (e.g. hindi) is excluded, not an error', async () => {
    _state.students = { data: { selected_subjects: ['math', 'hindi'] }, error: null };
    _state.subjects = { data: [{ code: 'math' }, { code: 'hindi' }], error: null };
    // hindi has no weight data at this grade — DB returns only math's row.
    _state.cbse_chapter_weights = { data: [{ subject_code: 'math' }], error: null };

    const result = await getStudentBoardSubjects(STUDENT_ID, '10');

    expect(result).toEqual(['math']);
    expect(result).not.toContain('hindi');
  });

  it('returns [] (not a throw) when subjects table returns zero board-eligible rows, and never queries cbse_chapter_weights', async () => {
    _state.students = { data: { selected_subjects: ['coding'] }, error: null };
    _state.subjects = { data: [], error: null }; // coding filtered out entirely

    const result = await getStudentBoardSubjects(STUDENT_ID, '10');

    expect(result).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalledWith('cbse_chapter_weights');
  });

  // ── Malformed / error handling ──────────────────────────────────────────────
  it('returns [] when the students lookup errors, without throwing', async () => {
    _state.students = { data: null, error: { message: 'not found' } };

    await expect(getStudentBoardSubjects(STUDENT_ID, '10')).resolves.toEqual([]);
  });

  it('returns [] when the students row itself is null (no throw)', async () => {
    _state.students = { data: null, error: null };

    await expect(getStudentBoardSubjects(STUDENT_ID, '10')).resolves.toEqual([]);
  });

  it('de-duplicates subject_code across multiple cbse_chapter_weights rows (one per chapter) into a single entry', async () => {
    _state.students = { data: { selected_subjects: ['math'] }, error: null };
    _state.subjects = { data: [{ code: 'math' }], error: null };
    // Real cbse_chapter_weights has one row PER CHAPTER for a subject — many
    // rows, same subject_code.
    _state.cbse_chapter_weights = {
      data: [
        { subject_code: 'math' },
        { subject_code: 'math' },
        { subject_code: 'math' },
      ],
      error: null,
    };

    const result = await getStudentBoardSubjects(STUDENT_ID, '10');

    expect(result).toEqual(['math']);
  });
});
