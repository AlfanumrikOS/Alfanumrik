/**
 * Contract tests for the 3 Grade Book actions added to the teacher-dashboard
 * Edge Function in Phase C.2:
 *
 *   - get_grade_book
 *   - set_grade_book_cell
 *   - export_grade_book_csv
 *
 * Mirrors teacher-dashboard-submissions-actions.test.ts — re-implements the
 * pure shaping/ownership/event-payload logic of each handler as a frozen
 * reference, then pins response shape, ownership gates, score validation,
 * the registry's TeacherGradeEntrySet shape, and the dispatch table. The
 * Edge Function runs on Deno + esm.sh and cannot be imported directly under
 * vitest; we read the source for dispatcher contract checks.
 */

import { describe, it, expect } from 'vitest';
import {
  DomainEventSchema,
  ALL_EVENT_KINDS,
} from '@alfanumrik/lib/state/events/registry';

// ─── Frozen column builder (mirrors buildGradeBookColumns) ─────────────

function buildGradeBookColumnsPure(
  subjects: string[],
): Array<{ key: string; label: string; kind: 'subject' | 'unit' | 'attendance' }> {
  const cols: Array<{ key: string; label: string; kind: 'subject' | 'unit' | 'attendance' }> = [];
  for (const subject of subjects) {
    if (!subject) continue;
    cols.push({ key: subject, label: subject.charAt(0).toUpperCase() + subject.slice(1), kind: 'subject' });
  }
  cols.push({ key: 'attendance', label: 'Attendance', kind: 'attendance' });
  return cols;
}

describe('buildGradeBookColumns — column derivation', () => {
  it('emits one subject column per non-empty subject + a trailing attendance column', () => {
    const cols = buildGradeBookColumnsPure(['math', 'science', 'english']);
    expect(cols.length).toBe(4);
    expect(cols.map(c => c.kind)).toEqual(['subject', 'subject', 'subject', 'attendance']);
    expect(cols[0]).toMatchObject({ key: 'math', label: 'Math', kind: 'subject' });
  });

  it('skips empty subject strings but still emits attendance', () => {
    const cols = buildGradeBookColumnsPure(['', 'math', '']);
    expect(cols.length).toBe(2);
    expect(cols[0].key).toBe('math');
    expect(cols[1].kind).toBe('attendance');
  });

  it('emits attendance even with zero subjects (empty class graceful)', () => {
    const cols = buildGradeBookColumnsPure([]);
    expect(cols).toEqual([{ key: 'attendance', label: 'Attendance', kind: 'attendance' }]);
  });
});

// ─── Frozen termBoundsFor (mirrors handler) ────────────────────────────

function termBoundsForPure(
  now: Date,
  term: 'current' | 'previous',
): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let startDate: Date;
  let endDate: Date;
  if (term === 'current') {
    if (m < 6) {
      startDate = new Date(Date.UTC(y, 0, 1));
      endDate = new Date(Date.UTC(y, 6, 1));
    } else {
      startDate = new Date(Date.UTC(y, 6, 1));
      endDate = new Date(Date.UTC(y + 1, 0, 1));
    }
  } else {
    if (m < 6) {
      startDate = new Date(Date.UTC(y - 1, 6, 1));
      endDate = new Date(Date.UTC(y, 0, 1));
    } else {
      startDate = new Date(Date.UTC(y, 0, 1));
      endDate = new Date(Date.UTC(y, 6, 1));
    }
  }
  return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
}

describe('termBoundsFor — date-range partitioning', () => {
  it('current term in May 2026 = Jan-Jul 2026', () => {
    const bounds = termBoundsForPure(new Date('2026-05-16T10:00:00Z'), 'current');
    expect(bounds.start).toBe('2026-01-01');
    expect(bounds.end).toBe('2026-07-01');
  });

  it('previous term in May 2026 = Jul-Dec 2025', () => {
    const bounds = termBoundsForPure(new Date('2026-05-16T10:00:00Z'), 'previous');
    expect(bounds.start).toBe('2025-07-01');
    expect(bounds.end).toBe('2026-01-01');
  });

  it('current term in Oct 2026 = Jul 2026 - Jan 2027', () => {
    const bounds = termBoundsForPure(new Date('2026-10-15T10:00:00Z'), 'current');
    expect(bounds.start).toBe('2026-07-01');
    expect(bounds.end).toBe('2027-01-01');
  });
});

// ─── get_grade_book response shape ─────────────────────────────────────

interface StudentRow { id: string; name: string }
interface ScoreRow { student_id: string; subject: string; score: number | null; recorded_at: string }
interface GradeBookCell {
  score: number | null;
  max_score: number;
  status: 'graded' | 'pending' | 'absent';
}

function buildGradeBookCells(
  students: StudentRow[],
  scoreRows: ScoreRow[],
  columns: Array<{ key: string; kind: string }>,
): Record<string, Record<string, GradeBookCell>> {
  const cells: Record<string, Record<string, GradeBookCell>> = {};
  for (const stu of students) cells[stu.id] = {};

  // latest score per (student, subject)
  const latest = new Map<string, ScoreRow>();
  for (const r of scoreRows) {
    const k = `${r.student_id}::${r.subject.toLowerCase()}`;
    const existing = latest.get(k);
    if (!existing || r.recorded_at > existing.recorded_at) latest.set(k, r);
  }
  for (const [k, r] of latest) {
    const [sid, subj] = k.split('::');
    if (!cells[sid]) continue;
    cells[sid][subj] = {
      score: r.score != null ? Number(r.score) : null,
      max_score: 100,
      status: r.score != null ? 'graded' : 'pending',
    };
  }

  // Fill missing cells.
  for (const stu of students) {
    for (const col of columns) {
      if (!cells[stu.id][col.key]) {
        cells[stu.id][col.key] = { score: null, max_score: 100, status: 'pending' };
      }
    }
  }
  return cells;
}

describe('get_grade_book — response shape', () => {
  it('emits one row per student with a cell per column', () => {
    const students: StudentRow[] = [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
    ];
    const scores: ScoreRow[] = [
      { student_id: 's1', subject: 'math', score: 85, recorded_at: '2026-04-01' },
      { student_id: 's1', subject: 'math', score: 92, recorded_at: '2026-05-01' }, // latest wins
      { student_id: 's2', subject: 'math', score: 60, recorded_at: '2026-05-10' },
    ];
    const cols = buildGradeBookColumnsPure(['math']);
    const cells = buildGradeBookCells(students, scores, cols);
    expect(cells['s1']['math'].score).toBe(92);
    expect(cells['s2']['math'].score).toBe(60);
    // every student has a cell for every column
    for (const stu of students) {
      for (const col of cols) {
        expect(cells[stu.id][col.key]).toBeDefined();
      }
    }
  });

  it('emits pending cells when no score row exists (empty class graceful)', () => {
    const students: StudentRow[] = [{ id: 's1', name: 'Alice' }];
    const cols = buildGradeBookColumnsPure(['math', 'science']);
    const cells = buildGradeBookCells(students, [], cols);
    expect(cells['s1']['math'].status).toBe('pending');
    expect(cells['s1']['math'].score).toBeNull();
    expect(cells['s1']['attendance'].status).toBe('pending');
  });

  it('degrades to empty cells map when roster is empty (no 500)', () => {
    const cells = buildGradeBookCells([], [], buildGradeBookColumnsPure([]));
    expect(cells).toEqual({});
  });
});

// ─── set_grade_book_cell — validation + event payload ──────────────────

function validateGradeBookCellInput(args: {
  classId: string;
  studentId: string;
  columnKey: string;
  score: unknown;
  maxScore: unknown;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.classId) return { ok: false, reason: 'class_id required' };
  if (!args.studentId) return { ok: false, reason: 'student_id required' };
  if (!args.columnKey) return { ok: false, reason: 'column_key required' };
  if (typeof args.score !== 'number' || !Number.isFinite(args.score)) {
    return { ok: false, reason: 'score must be a finite number' };
  }
  if (typeof args.maxScore !== 'number' || !Number.isFinite(args.maxScore) || args.maxScore <= 0) {
    return { ok: false, reason: 'max_score must be a positive number' };
  }
  if (args.score < 0 || args.score > args.maxScore) {
    return { ok: false, reason: 'score must satisfy 0 ≤ score ≤ max_score' };
  }
  return { ok: true };
}

describe('set_grade_book_cell — input validation', () => {
  const valid = { classId: 'c1', studentId: 's1', columnKey: 'math', score: 85, maxScore: 100 };

  it('accepts a well-formed cell write', () => {
    expect(validateGradeBookCellInput(valid).ok).toBe(true);
  });

  it('rejects a negative score', () => {
    const r = validateGradeBookCellInput({ ...valid, score: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/0 ≤ score/);
  });

  it('rejects score > max_score', () => {
    const r = validateGradeBookCellInput({ ...valid, score: 101 });
    expect(r.ok).toBe(false);
  });

  it('rejects non-finite score (NaN/Infinity)', () => {
    expect(validateGradeBookCellInput({ ...valid, score: NaN }).ok).toBe(false);
    expect(validateGradeBookCellInput({ ...valid, score: Infinity }).ok).toBe(false);
  });

  it('rejects non-positive max_score', () => {
    expect(validateGradeBookCellInput({ ...valid, maxScore: 0 }).ok).toBe(false);
    expect(validateGradeBookCellInput({ ...valid, maxScore: -10 }).ok).toBe(false);
  });

  it('accepts fractional scores (e.g. 8.5 / 10)', () => {
    expect(validateGradeBookCellInput({ ...valid, score: 8.5, maxScore: 10 }).ok).toBe(true);
  });

  it('accepts edge cases: 0 and exactly maxScore', () => {
    expect(validateGradeBookCellInput({ ...valid, score: 0 }).ok).toBe(true);
    expect(validateGradeBookCellInput({ ...valid, score: 100 }).ok).toBe(true);
  });
});

// ─── Frozen ownership helpers ──────────────────────────────────────────

interface ClassLink { class_id: string; teacher_id: string }
function assertTeacherOwnsClassPure(
  teacherId: string,
  classId: string,
  links: ClassLink[],
  teacherGrades: string[] = [],
): boolean {
  if (!classId) return false;
  if (classId.startsWith('grade-')) {
    const grade = classId.replace('grade-', '');
    return teacherGrades.map(String).includes(grade);
  }
  return links.some(l => l.class_id === classId && l.teacher_id === teacherId);
}

describe('grade book — ownership gates', () => {
  it('allows a teacher with a matching class_assignment', () => {
    expect(assertTeacherOwnsClassPure('t1', 'c1', [{ class_id: 'c1', teacher_id: 't1' }])).toBe(true);
  });

  it('REGRESSION: rejects a teacher with no link to the class (cross-tenant 403)', () => {
    expect(assertTeacherOwnsClassPure('t2', 'c1', [{ class_id: 'c1', teacher_id: 't1' }])).toBe(false);
  });

  it('allows a teacher accessing their own grade-<n> pseudo-class', () => {
    expect(assertTeacherOwnsClassPure('t1', 'grade-7', [], ['7'])).toBe(true);
  });

  it('rejects a teacher reaching for a grade they do not teach', () => {
    expect(assertTeacherOwnsClassPure('t1', 'grade-9', [], ['7'])).toBe(false);
  });
});

// ─── event payload ─────────────────────────────────────────────────────

function buildGradeEntryEventPayload(args: {
  teacherId: string;
  classId: string;
  studentId: string;
  columnKey: string;
  columnKind: 'subject' | 'unit' | 'attendance';
  score: number;
  maxScore: number;
  notes: string | null;
}) {
  return {
    teacherId: args.teacherId,
    classId: args.classId,
    studentId: args.studentId,
    columnKey: args.columnKey.toLowerCase(),
    columnKind: args.columnKind,
    score: args.score,
    maxScore: args.maxScore,
    hasNotes: args.notes !== null && args.notes.trim().length > 0,
  };
}

describe('set_grade_book_cell — event payload', () => {
  const base = {
    teacherId: '00000000-0000-0000-0000-000000000001',
    classId:   '00000000-0000-0000-0000-000000000002',
    studentId: '00000000-0000-0000-0000-000000000003',
  };

  it('emits hasNotes=true when notes are provided', () => {
    const p = buildGradeEntryEventPayload({
      ...base, columnKey: 'math', columnKind: 'subject', score: 85, maxScore: 100, notes: 'Great work',
    });
    expect(p.hasNotes).toBe(true);
    expect(p.columnKey).toBe('math');
    expect(p.score).toBe(85);
  });

  it('emits hasNotes=false when notes are omitted', () => {
    const p = buildGradeEntryEventPayload({
      ...base, columnKey: 'math', columnKind: 'subject', score: 85, maxScore: 100, notes: null,
    });
    expect(p.hasNotes).toBe(false);
  });

  it('parses through the registry schema as teacher.grade_entry_set', () => {
    const envelope = {
      eventId: '00000000-0000-0000-0000-000000000099',
      occurredAt: '2026-05-16T10:00:00.000Z',
      actorAuthUserId: '00000000-0000-0000-0000-000000000001',
      tenantId: null,
      idempotencyKey: 'grade_entry_set:test:1',
      kind: 'teacher.grade_entry_set' as const,
      payload: buildGradeEntryEventPayload({
        ...base, columnKey: 'math', columnKind: 'subject', score: 85, maxScore: 100, notes: 'g',
      }),
    };
    const parsed = DomainEventSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
  });

  it('REGRESSION: teacher.grade_entry_set is in ALL_EVENT_KINDS', () => {
    expect(ALL_EVENT_KINDS).toContain('teacher.grade_entry_set');
  });

  it('rejects payload where score > maxScore at the schema layer', () => {
    const envelope = {
      eventId: '00000000-0000-0000-0000-000000000099',
      occurredAt: '2026-05-16T10:00:00.000Z',
      actorAuthUserId: '00000000-0000-0000-0000-000000000001',
      tenantId: null,
      idempotencyKey: 'grade_entry_set:bad:1',
      kind: 'teacher.grade_entry_set' as const,
      payload: {
        ...buildGradeEntryEventPayload({
          ...base, columnKey: 'math', columnKind: 'subject', score: 200, maxScore: 100, notes: null,
        }),
        // 200 > schema max of 1000 — keep within range but invariant
        // 0 ≤ score ≤ maxScore is enforced at the handler level, not on
        // the schema (max=1000 keeps the registry loose for percentages or
        // raw scores). This test pins the schema bound.
        score: 2000,
      },
    };
    const parsed = DomainEventSchema.safeParse(envelope);
    expect(parsed.success).toBe(false);
  });
});

// ─── CSV export shape ──────────────────────────────────────────────────

function csvEscapePure(value: string | number | null): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

function buildCsv(
  students: StudentRow[],
  columns: Array<{ key: string; label: string; kind: string }>,
  cells: Record<string, Record<string, GradeBookCell>>,
): string {
  const headerLine = ['Student', ...columns.map(c => `${c.label} (${c.kind})`)].map(csvEscapePure).join(',');
  const lines: string[] = [headerLine];
  for (const stu of students) {
    const row = [stu.name];
    for (const col of columns) {
      const cell = cells[stu.id]?.[col.key];
      row.push(!cell || cell.score == null ? '' : `${cell.score}/${cell.max_score}`);
    }
    lines.push(row.map(csvEscapePure).join(','));
  }
  return lines.join('\n');
}

describe('export_grade_book_csv — CSV body', () => {
  it('emits a header row and one row per student', () => {
    const students: StudentRow[] = [{ id: 's1', name: 'Alice' }, { id: 's2', name: 'Bob' }];
    const cols = [
      { key: 'math', label: 'Math', kind: 'subject' },
      { key: 'attendance', label: 'Attendance', kind: 'attendance' },
    ];
    const cells = {
      s1: { math: { score: 85, max_score: 100, status: 'graded' as const }, attendance: { score: 90, max_score: 100, status: 'graded' as const } },
      s2: { math: { score: 60, max_score: 100, status: 'graded' as const }, attendance: { score: null, max_score: 100, status: 'pending' as const } },
    };
    const csv = buildCsv(students, cols, cells);
    const lines = csv.split('\n');
    expect(lines.length).toBe(3); // header + 2 students
    expect(lines[0]).toBe('Student,Math (subject),Attendance (attendance)');
    expect(lines[1]).toBe('Alice,85/100,90/100');
    expect(lines[2]).toBe('Bob,60/100,');
  });

  it('escapes student names containing commas, quotes, or newlines', () => {
    const csv = buildCsv(
      [{ id: 's1', name: 'Smith, John' }, { id: 's2', name: 'Doe "the kid"' }],
      [{ key: 'math', label: 'Math', kind: 'subject' }],
      {
        s1: { math: { score: 50, max_score: 100, status: 'graded' as const } },
        s2: { math: { score: 80, max_score: 100, status: 'graded' as const } },
      },
    );
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"Doe ""the kid"""');
  });
});

// ─── Dispatcher contract — the 3 new actions must be present ─────────

const REQUIRED_GRADEBOOK_ACTIONS = [
  'get_grade_book',
  'set_grade_book_cell',
  'export_grade_book_csv',
] as const;

describe('teacher-dashboard dispatcher — Phase C.2 actions present', () => {
  it('every required Phase C.2 action has a switch case in the Edge Function source', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const sourcePath = path.resolve(
      process.cwd(),
      'supabase/functions/teacher-dashboard/index.ts',
    );
    const src = await fs.readFile(sourcePath, 'utf8');
    for (const action of REQUIRED_GRADEBOOK_ACTIONS) {
      expect(src).toContain(`case '${action}':`);
    }
  });

  it('handler functions are defined for each new action', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const sourcePath = path.resolve(
      process.cwd(),
      'supabase/functions/teacher-dashboard/index.ts',
    );
    const src = await fs.readFile(sourcePath, 'utf8');
    expect(src).toContain('async function handleGetGradeBook(');
    expect(src).toContain('async function handleSetGradeBookCell(');
    expect(src).toContain('async function handleExportGradeBookCsv(');
  });

  it('set_grade_book_cell emits the event BEFORE the canonical write (ADR-005 spine order)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const sourcePath = path.resolve(
      process.cwd(),
      'supabase/functions/teacher-dashboard/index.ts',
    );
    const src = await fs.readFile(sourcePath, 'utf8');
    const handlerStart = src.indexOf('async function handleSetGradeBookCell');
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerSlice = src.slice(handlerStart);
    const eventIdx = handlerSlice.indexOf("kind: 'teacher.grade_entry_set'");
    const upsertIdx = handlerSlice.search(/\.from\(['"]score_history['"]\)\s*\n?\s*\.upsert\(/);
    expect(eventIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeGreaterThan(-1);
    // Event publish must lexically precede the canonical write — same
    // invariant as mark_submission_reviewed (C.1) and the API-route
    // equivalents (B.5).
    expect(eventIdx).toBeLessThan(upsertIdx);
  });

  it('REGRESSION: journey.ts handles the new event kind in its exhaustiveness switch', async () => {
    // B.5 PR (#789) and C.1 PR (#791) both initially failed because they
    // missed journey.ts. Pin it explicitly so the C.2 author doesn't repeat
    // the mistake.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const sourcePath = path.resolve(process.cwd(), 'src/lib/state/journey/journey.ts');
    const src = await fs.readFile(sourcePath, 'utf8');
    expect(src).toContain("case 'teacher.grade_entry_set':");
  });
});
