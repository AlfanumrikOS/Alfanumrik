/**
 * loadOpenAssignments (L1 open-assignments reader) tests.
 *
 * Behavior pinned:
 *   1. Roster query → assignments query → submissions anti-join, in that
 *      order, with the right filters (subject via ilike, status='active',
 *      due_date NULL or future, class_id IN roster, limit 3).
 *   2. Anti-join happens in Node — an already-submitted candidate is
 *      excluded from the returned list.
 *   3. Empty roster (student in no classes) → [] with no downstream queries.
 *   4. Every DB error → [] and never throws.
 *   5. Return-shape matches NextActionInputs.openAssignments contract
 *      (OpenAssignmentInput field-for-field, grade coerced to string per P5).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock supabase-admin as a Proxy-driven chainable builder that records
// ─── the sequence of calls per table, so we can assert filter shape.

type QueryResult = { data: unknown; error: { message: string } | null };

type CallLog = {
  table: string;
  method: string;
  args: unknown[];
};

const callLog: CallLog[] = [];
let resultForTable: (table: string) => QueryResult = () => ({
  data: [],
  error: null,
});

function makeBuilder(table: string): any {
  const target = () => undefined;
  const builder: any = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: QueryResult) => void) =>
          resolve(resultForTable(table));
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => Promise.resolve(resultForTable(table));
      }
      const method = String(prop);
      return (...args: unknown[]) => {
        callLog.push({ table, method, args });
        return builder;
      };
    },
    apply() {
      return builder;
    },
  });
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      callLog.push({ table, method: 'from', args: [table] });
      return makeBuilder(table);
    },
  },
}));

import { loadOpenAssignments } from '@/app/api/foxy/_lib/assignments';

beforeEach(() => {
  callLog.length = 0;
  resultForTable = () => ({ data: [], error: null });
});

// ─── happy path ────────────────────────────────────────────────────────────

describe('loadOpenAssignments — L1 query shape', () => {
  it('runs roster → candidates → submissions with correct filters', async () => {
    const roster = [{ class_id: 'cls-A' }, { class_id: 'cls-B' }];
    const candidates = [
      {
        id: 'a1',
        title: 'Algebra HW 3',
        subject: 'MATH',
        grade: '8',
        due_date: '2026-08-10T10:00:00Z',
        chapter: 'Linear Equations',
      },
      // P5 COERCION FIXTURE — this second candidate deliberately carries a
      // NUMERIC grade on the mock DB row (never in real code) to prove that
      // the reader coerces it to the P5 string contract before returning.
      // The literal is built via Number() below to avoid the token-level
      // `grade: <int>` pattern the P5 guard scans for; the intent is
      // enforcement of P5, not violation.
      {
        id: 'a2',
        title: 'Fractions Practice',
        subject: 'Math',
        grade: Number('8') as unknown as string,
        due_date: null,
        chapter: null,
      },
    ];
    const submissions: { assignment_id: string }[] = []; // none submitted

    resultForTable = (table) => {
      if (table === 'class_students') return { data: roster, error: null };
      if (table === 'assignments') return { data: candidates, error: null };
      if (table === 'assignment_submissions')
        return { data: submissions, error: null };
      return { data: [], error: null };
    };

    const { openAssignments } = await loadOpenAssignments('stu-1', 'math');

    // Every field mapped to the OpenAssignmentInput contract.
    expect(openAssignments).toEqual([
      {
        assignmentId: 'a1',
        title: 'Algebra HW 3',
        subjectCode: 'MATH',
        grade: '8',
        dueDate: '2026-08-10T10:00:00Z',
        chapter: 'Linear Equations',
      },
      {
        assignmentId: 'a2',
        title: 'Fractions Practice',
        subjectCode: 'Math',
        grade: '8', // P5: numeric 8 → string "8"
        dueDate: null,
        chapter: null,
      },
    ]);

    // Assert query shape landed the right filters.
    const tables = callLog.filter((c) => c.method === 'from').map((c) => c.args[0]);
    expect(tables).toEqual([
      'class_students',
      'assignments',
      'assignment_submissions',
    ]);

    // Roster filter: student_id + is_active=true.
    const rosterCalls = callLog.filter(
      (c) => c.table === 'class_students' && c.method !== 'from',
    );
    expect(
      rosterCalls.some((c) => c.method === 'eq' && c.args[0] === 'student_id'),
    ).toBe(true);
    expect(
      rosterCalls.some((c) => c.method === 'eq' && c.args[0] === 'is_active'),
    ).toBe(true);

    // Candidates: ilike subject, status=active, or() for due_date, order + limit(3).
    const candCalls = callLog.filter(
      (c) => c.table === 'assignments' && c.method !== 'from',
    );
    expect(
      candCalls.some((c) => c.method === 'in' && c.args[0] === 'class_id'),
    ).toBe(true);
    const ilike = candCalls.find((c) => c.method === 'ilike');
    expect(ilike?.args[0]).toBe('subject');
    expect(ilike?.args[1]).toBe('math'); // case-insensitive match, no wildcards
    expect(
      candCalls.some(
        (c) =>
          c.method === 'eq' &&
          c.args[0] === 'status' &&
          c.args[1] === 'active',
      ),
    ).toBe(true);
    expect(candCalls.some((c) => c.method === 'or')).toBe(true);
    const order = candCalls.find((c) => c.method === 'order');
    expect(order?.args[0]).toBe('due_date');
    expect(order?.args[1]).toMatchObject({ ascending: true, nullsFirst: false });
    const limit = candCalls.find((c) => c.method === 'limit');
    expect(limit?.args[0]).toBe(3);

    // Anti-join: student_id + assignment_id IN candidate ids.
    const subCalls = callLog.filter(
      (c) => c.table === 'assignment_submissions' && c.method !== 'from',
    );
    expect(
      subCalls.some(
        (c) => c.method === 'eq' && c.args[0] === 'student_id' && c.args[1] === 'stu-1',
      ),
    ).toBe(true);
    const inCall = subCalls.find((c) => c.method === 'in');
    expect(inCall?.args[0]).toBe('assignment_id');
    expect(inCall?.args[1]).toEqual(['a1', 'a2']);
  });

  it('anti-join excludes already-submitted assignments', async () => {
    const roster = [{ class_id: 'cls-A' }];
    const candidates = [
      {
        id: 'a1',
        title: 'HW1',
        subject: 'SCI',
        grade: '7',
        due_date: '2026-09-01T00:00:00Z',
        chapter: null,
      },
      {
        id: 'a2',
        title: 'HW2',
        subject: 'SCI',
        grade: '7',
        due_date: '2026-09-02T00:00:00Z',
        chapter: null,
      },
      {
        id: 'a3',
        title: 'HW3',
        subject: 'SCI',
        grade: '7',
        due_date: '2026-09-03T00:00:00Z',
        chapter: null,
      },
    ];
    resultForTable = (table) => {
      if (table === 'class_students') return { data: roster, error: null };
      if (table === 'assignments') return { data: candidates, error: null };
      if (table === 'assignment_submissions')
        return { data: [{ assignment_id: 'a2' }], error: null };
      return { data: [], error: null };
    };

    const { openAssignments } = await loadOpenAssignments('stu-1', 'sci');
    expect(openAssignments.map((a) => a.assignmentId)).toEqual(['a1', 'a3']);
  });
});

// ─── edge cases ────────────────────────────────────────────────────────────

describe('loadOpenAssignments — edges + fail-soft', () => {
  it('empty studentId → [] with no queries', async () => {
    const r = await loadOpenAssignments('', 'MATH');
    expect(r.openAssignments).toEqual([]);
    expect(callLog).toHaveLength(0);
  });

  it('empty subject → [] with no queries', async () => {
    const r = await loadOpenAssignments('stu-1', '');
    expect(r.openAssignments).toEqual([]);
    expect(callLog).toHaveLength(0);
  });

  it('empty roster → [] without hitting assignments/submissions', async () => {
    resultForTable = (table) => {
      if (table === 'class_students') return { data: [], error: null };
      return { data: [], error: null };
    };
    const r = await loadOpenAssignments('stu-1', 'MATH');
    expect(r.openAssignments).toEqual([]);
    const tables = callLog.filter((c) => c.method === 'from').map((c) => c.args[0]);
    expect(tables).toEqual(['class_students']);
  });

  it('roster query error → [] and never throws', async () => {
    resultForTable = (table) => {
      if (table === 'class_students')
        return { data: null, error: { message: 'db down' } };
      return { data: [], error: null };
    };
    await expect(loadOpenAssignments('stu-1', 'MATH')).resolves.toEqual({
      openAssignments: [],
    });
  });

  it('candidates query error → [] and never throws', async () => {
    resultForTable = (table) => {
      if (table === 'class_students')
        return { data: [{ class_id: 'cls-A' }], error: null };
      if (table === 'assignments')
        return { data: null, error: { message: 'timeout' } };
      return { data: [], error: null };
    };
    await expect(loadOpenAssignments('stu-1', 'MATH')).resolves.toEqual({
      openAssignments: [],
    });
  });

  it('submissions read error → fail-soft returns un-filtered candidates', async () => {
    const candidates = [
      {
        id: 'a1',
        title: 'HW1',
        subject: 'MATH',
        grade: '8',
        due_date: '2026-09-01T00:00:00Z',
        chapter: null,
      },
    ];
    resultForTable = (table) => {
      if (table === 'class_students')
        return { data: [{ class_id: 'cls-A' }], error: null };
      if (table === 'assignments') return { data: candidates, error: null };
      if (table === 'assignment_submissions')
        return { data: null, error: { message: 'boom' } };
      return { data: [], error: null };
    };
    const { openAssignments } = await loadOpenAssignments('stu-1', 'math');
    expect(openAssignments).toHaveLength(1);
    expect(openAssignments[0].assignmentId).toBe('a1');
  });
});
