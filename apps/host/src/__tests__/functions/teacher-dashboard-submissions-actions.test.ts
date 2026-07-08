/**
 * Contract tests for the 3 Submission actions added to the teacher-dashboard
 * Edge Function in Phase C.1:
 *
 *   - get_assignment_submissions
 *   - get_submission_detail
 *   - mark_submission_reviewed
 *
 * Mirrors teacher-dashboard-reports-actions.test.ts — re-implements the
 * pure shaping/ownership/event-payload logic of each handler as a frozen
 * reference, then pins the response shape, ownership gates, and the
 * registry's TeacherSubmissionReviewed shape. The Edge Function runs on
 * Deno + esm.sh and cannot be imported directly under vitest; we read
 * the source for dispatcher contract checks.
 *
 * Why this matters: /teacher/submissions calls these 3 actions and the
 * Edge Function dispatch table must list each of them. The shaping logic
 * also feeds parent dashboards (review notifications) and audit trails
 * — drifting from this contract silently breaks downstream subscribers.
 */

import { describe, it, expect } from 'vitest';
import {
  DomainEventSchema,
  ALL_EVENT_KINDS,
} from '@alfanumrik/lib/state/events/registry';

// ─── Frozen ownership helper (mirrors teacherOwnsAssignment) ───────────

interface AssignmentRow {
  id: string;
  class_id: string | null;
  teacher_id: string | null;
}

interface ClassTeacherLink {
  class_id: string;
  teacher_id: string;
}

function teacherOwnsAssignmentPure(
  teacherId: string,
  assignmentId: string,
  assignment: AssignmentRow | null,
  links: ClassTeacherLink[],
): { owns: boolean } {
  if (!assignmentId || !assignment) return { owns: false };
  if (assignment.teacher_id === teacherId) return { owns: true };
  if (!assignment.class_id) return { owns: false };
  const linked = links.some(l => l.class_id === assignment.class_id && l.teacher_id === teacherId);
  return { owns: linked };
}

describe('teacherOwnsAssignment — ownership gate', () => {
  const assignment: AssignmentRow = { id: 'a1', class_id: 'c1', teacher_id: 't1' };
  it('allows the assignment owner', () => {
    expect(teacherOwnsAssignmentPure('t1', 'a1', assignment, []).owns).toBe(true);
  });
  it('allows a co-teacher linked via class_teachers', () => {
    expect(teacherOwnsAssignmentPure('t2', 'a1', assignment, [{ class_id: 'c1', teacher_id: 't2' }]).owns).toBe(true);
  });
  it('REGRESSION: rejects a teacher with no link to the class', () => {
    // A teacher in another school must not be able to fetch this
    // assignment's submissions by passing the id directly.
    expect(teacherOwnsAssignmentPure('t3', 'a1', assignment, []).owns).toBe(false);
  });
  it('rejects when the assignment row is missing entirely', () => {
    expect(teacherOwnsAssignmentPure('t1', 'a1', null, []).owns).toBe(false);
  });
  it('rejects a co-teacher link for a DIFFERENT class', () => {
    expect(teacherOwnsAssignmentPure('t2', 'a1', assignment, [{ class_id: 'c-other', teacher_id: 't2' }]).owns).toBe(false);
  });
});

// ─── Frozen UI-status mapping (mirrors uiStatusForSubmission) ──────────

function uiStatusForSubmissionPure(
  status: string | null | undefined,
  submittedAt: string | null,
  gradedAt: string | null,
): 'pending' | 'submitted' | 'graded' {
  if (gradedAt || status === 'graded' || status === 'reviewed') return 'graded';
  if (submittedAt || status === 'submitted' || status === 'completed') return 'submitted';
  return 'pending';
}

describe('uiStatusForSubmission — status bucketing', () => {
  it('returns "graded" when graded_at is set, regardless of status', () => {
    expect(uiStatusForSubmissionPure('not_started', '2026-05-15T10:00:00Z', '2026-05-16T10:00:00Z')).toBe('graded');
    expect(uiStatusForSubmissionPure(null, null, '2026-05-16T10:00:00Z')).toBe('graded');
  });
  it('returns "submitted" when submitted_at is set but not graded yet', () => {
    expect(uiStatusForSubmissionPure('submitted', '2026-05-15T10:00:00Z', null)).toBe('submitted');
  });
  it('returns "pending" when nothing happened yet', () => {
    expect(uiStatusForSubmissionPure(null, null, null)).toBe('pending');
    expect(uiStatusForSubmissionPure('not_started', null, null)).toBe('pending');
  });
});

// ─── get_assignment_submissions response shape ─────────────────────────

interface StudentRow { id: string; name: string; grade: string }
interface RawSubmissionRow {
  id: string;
  student_id: string;
  score: number | null;
  questions_total: number;
  questions_correct: number;
  time_spent_seconds: number;
  status: string | null;
  submitted_at: string | null;
  graded_at: string | null;
}
interface UiSubmissionRow {
  student_id: string;
  student_name: string;
  submission_id: string | null;
  submitted_at: string | null;
  score_percent: number | null;
  time_spent_sec: number;
  status: 'pending' | 'submitted' | 'graded';
  questions_total: number;
  questions_correct: number;
}

function buildAssignmentSubmissions(
  students: StudentRow[],
  rawSubs: RawSubmissionRow[],
): UiSubmissionRow[] {
  const out: UiSubmissionRow[] = [];
  const byStudent = new Map<string, RawSubmissionRow>();
  for (const s of rawSubs) byStudent.set(s.student_id, s);
  for (const stu of students) {
    const sub = byStudent.get(stu.id);
    if (sub) {
      const total = Number(sub.questions_total ?? 0);
      const correct = Number(sub.questions_correct ?? 0);
      const score = sub.score != null
        ? Number(sub.score)
        : total > 0 ? Math.round((correct / total) * 100) : null;
      out.push({
        student_id: stu.id,
        student_name: stu.name,
        submission_id: sub.id,
        submitted_at: sub.submitted_at,
        score_percent: score,
        time_spent_sec: Number(sub.time_spent_seconds ?? 0),
        status: uiStatusForSubmissionPure(sub.status, sub.submitted_at, sub.graded_at),
        questions_total: total,
        questions_correct: correct,
      });
    } else {
      out.push({
        student_id: stu.id,
        student_name: stu.name,
        submission_id: null,
        submitted_at: null,
        score_percent: null,
        time_spent_sec: 0,
        status: 'pending',
        questions_total: 0,
        questions_correct: 0,
      });
    }
  }
  return out;
}

describe('get_assignment_submissions — response shape', () => {
  it('emits one row per student in the roster (pending if no submission)', () => {
    const students: StudentRow[] = [
      { id: 's1', name: 'Alice', grade: '7' },
      { id: 's2', name: 'Bob', grade: '7' },
      { id: 's3', name: 'Carol', grade: '7' },
    ];
    const subs: RawSubmissionRow[] = [
      // Alice submitted + graded
      { id: 'sub1', student_id: 's1', score: 85, questions_total: 10, questions_correct: 9, time_spent_seconds: 540, status: 'graded', submitted_at: '2026-05-14T10:00:00Z', graded_at: '2026-05-15T10:00:00Z' },
      // Bob submitted, ungraded
      { id: 'sub2', student_id: 's2', score: null, questions_total: 10, questions_correct: 6, time_spent_seconds: 420, status: 'submitted', submitted_at: '2026-05-14T11:00:00Z', graded_at: null },
      // Carol absent — no row
    ];
    const rows = buildAssignmentSubmissions(students, subs);
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ student_name: 'Alice', status: 'graded', score_percent: 85, submission_id: 'sub1' });
    expect(rows[1]).toMatchObject({ student_name: 'Bob', status: 'submitted', score_percent: 60 });
    expect(rows[2]).toMatchObject({ student_name: 'Carol', status: 'pending', score_percent: null, submission_id: null });
  });

  it('degrades to empty array (not 500) when the roster is empty', () => {
    expect(buildAssignmentSubmissions([], [])).toEqual([]);
  });

  it('falls back to questions_correct/total ratio when score column is null', () => {
    const students: StudentRow[] = [{ id: 's1', name: 'Alice', grade: '7' }];
    const subs: RawSubmissionRow[] = [
      { id: 'sub1', student_id: 's1', score: null, questions_total: 4, questions_correct: 3, time_spent_seconds: 0, status: 'submitted', submitted_at: '2026-05-14T10:00:00Z', graded_at: null },
    ];
    expect(buildAssignmentSubmissions(students, subs)[0].score_percent).toBe(75);
  });
});

// ─── get_submission_detail shaping ─────────────────────────────────────

interface RawResponseEntry {
  question_id?: string;
  question_text?: string;
  student_answer?: unknown;
  correct_answer?: unknown;
  is_correct?: boolean;
  time_spent_seconds?: number;
}

interface UiAnswer {
  question_id: string;
  question_text: string;
  student_answer: unknown;
  correct_answer: unknown;
  correct: boolean;
  time_spent: number;
}

function shapeAnswers(raw: unknown): UiAnswer[] {
  const arr = Array.isArray(raw) ? raw as RawResponseEntry[] : [];
  return arr.map((r, idx) => ({
    question_id: String(r?.question_id ?? `q${idx + 1}`),
    question_text: String(r?.question_text ?? `Question ${idx + 1}`),
    student_answer: r?.student_answer ?? null,
    correct_answer: r?.correct_answer ?? null,
    correct: r?.is_correct === true,
    time_spent: Number(r?.time_spent_seconds ?? 0),
  }));
}

describe('get_submission_detail — shape', () => {
  it('maps a jsonb responses array into the UI answers shape', () => {
    const raw = [
      { question_id: 'q1', question_text: 'What is 2+2?', student_answer: '4', correct_answer: '4', is_correct: true, time_spent_seconds: 12 },
      { question_id: 'q2', question_text: 'What is 3+3?', student_answer: '5', correct_answer: '6', is_correct: false, time_spent_seconds: 25 },
    ];
    const out = shapeAnswers(raw);
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ correct: true, student_answer: '4', correct_answer: '4', question_text: 'What is 2+2?' });
    expect(out[1].correct).toBe(false);
  });

  it('degrades to empty array when responses jsonb is malformed or null', () => {
    expect(shapeAnswers(null)).toEqual([]);
    expect(shapeAnswers({})).toEqual([]);
    expect(shapeAnswers('whoops')).toEqual([]);
  });

  it('synthesises question_id/text when source omits them', () => {
    const raw = [{ is_correct: false, student_answer: 'x' }, { is_correct: true, student_answer: 'y' }];
    const out = shapeAnswers(raw);
    expect(out[0].question_id).toBe('q1');
    expect(out[1].question_id).toBe('q2');
    expect(out[0].question_text).toBe('Question 1');
  });
});

// ─── mark_submission_reviewed — event payload + canonical patch ───────

function buildReviewedEventPayload(args: {
  submissionId: string;
  assignmentId: string;
  studentId: string;
  teacherId: string;
  feedback: string | null;
  scoreOverride: number | null;
  currentScore: number | null;
  questionsTotal: number;
  questionsCorrect: number;
}) {
  const total = args.questionsTotal;
  const derivedScore = total > 0 ? Math.round((args.questionsCorrect / total) * 100) : null;
  const finalScore = args.scoreOverride != null
    ? args.scoreOverride
    : args.currentScore != null
      ? args.currentScore
      : derivedScore;
  return {
    submissionId: args.submissionId,
    assignmentId: args.assignmentId,
    studentId: args.studentId,
    teacherId: args.teacherId,
    hasFeedback: args.feedback !== null && args.feedback.trim().length > 0,
    scorePercent: finalScore,
    scoreOverridden: args.scoreOverride != null,
  };
}

function buildReviewedCanonicalPatch(args: {
  feedback: string | null;
  scoreOverride: number | null;
  graded_at: string;
  graded_by: string;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    graded_at: args.graded_at,
    graded_by: args.graded_by,
    status: 'graded',
  };
  if (args.feedback !== null && args.feedback.length > 0) patch.teacher_feedback = args.feedback;
  if (args.scoreOverride != null) patch.score = args.scoreOverride;
  return patch;
}

describe('mark_submission_reviewed — event payload', () => {
  const base = {
    submissionId: '00000000-0000-0000-0000-000000000010',
    assignmentId: '00000000-0000-0000-0000-000000000011',
    studentId: '00000000-0000-0000-0000-000000000012',
    teacherId: '00000000-0000-0000-0000-000000000013',
    questionsTotal: 10,
    questionsCorrect: 7,
  };

  it('emits hasFeedback=true and scoreOverridden=false when only feedback is provided', () => {
    const p = buildReviewedEventPayload({ ...base, feedback: 'Good work', scoreOverride: null, currentScore: 70 });
    expect(p.hasFeedback).toBe(true);
    expect(p.scoreOverridden).toBe(false);
    expect(p.scorePercent).toBe(70);
  });

  it('emits scoreOverridden=true and uses the override when provided', () => {
    const p = buildReviewedEventPayload({ ...base, feedback: null, scoreOverride: 85, currentScore: 70 });
    expect(p.hasFeedback).toBe(false);
    expect(p.scoreOverridden).toBe(true);
    expect(p.scorePercent).toBe(85);
  });

  it('falls back to derived score when no override and no canonical score exists', () => {
    const p = buildReviewedEventPayload({ ...base, feedback: null, scoreOverride: null, currentScore: null });
    expect(p.scorePercent).toBe(70); // 7/10 = 70
  });

  it('parses through the registry schema as teacher.submission_reviewed', () => {
    const envelope = {
      eventId: '00000000-0000-0000-0000-000000000099',
      occurredAt: '2026-05-16T10:00:00.000Z',
      actorAuthUserId: '00000000-0000-0000-0000-000000000001',
      tenantId: null,
      idempotencyKey: 'submission_reviewed:test:1',
      kind: 'teacher.submission_reviewed' as const,
      payload: buildReviewedEventPayload({ ...base, feedback: 'Great', scoreOverride: 90, currentScore: 70 }),
    };
    const parsed = DomainEventSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
  });

  it('REGRESSION: the new event kind is in ALL_EVENT_KINDS', () => {
    // If a future PR drops the kind from the registry's frozen list, this
    // fires. Required because publish.ts validates against the union, and
    // subscribers' allowlists key off ALL_EVENT_KINDS.
    expect(ALL_EVENT_KINDS).toContain('teacher.submission_reviewed');
  });
});

describe('mark_submission_reviewed — canonical patch', () => {
  it('always sets graded_at + graded_by + status=graded', () => {
    const patch = buildReviewedCanonicalPatch({
      feedback: null, scoreOverride: null,
      graded_at: '2026-05-16T10:00:00Z', graded_by: 't1',
    });
    expect(patch).toMatchObject({ graded_at: '2026-05-16T10:00:00Z', graded_by: 't1', status: 'graded' });
    expect('teacher_feedback' in patch).toBe(false);
    expect('score' in patch).toBe(false);
  });

  it('only writes teacher_feedback when feedback is provided', () => {
    const patch = buildReviewedCanonicalPatch({
      feedback: 'Try the next chapter', scoreOverride: null,
      graded_at: '2026-05-16T10:00:00Z', graded_by: 't1',
    });
    expect(patch.teacher_feedback).toBe('Try the next chapter');
    expect('score' in patch).toBe(false);
  });

  it('only writes score when override is provided', () => {
    const patch = buildReviewedCanonicalPatch({
      feedback: null, scoreOverride: 88,
      graded_at: '2026-05-16T10:00:00Z', graded_by: 't1',
    });
    expect(patch.score).toBe(88);
    expect('teacher_feedback' in patch).toBe(false);
  });
});

// ─── Dispatcher contract — the 3 new actions must be present ─────────

const REQUIRED_SUBMISSION_ACTIONS = [
  'get_assignment_submissions',
  'get_submission_detail',
  'mark_submission_reviewed',
] as const;

describe('teacher-dashboard dispatcher — Phase C.1 actions present', () => {
  it('every required Phase C.1 action has a switch case in the Edge Function source', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const sourcePath = path.resolve(
      process.cwd(),
      'supabase/functions/teacher-dashboard/index.ts',
    );
    const src = await fs.readFile(sourcePath, 'utf8');
    for (const action of REQUIRED_SUBMISSION_ACTIONS) {
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
    expect(src).toContain('async function handleGetAssignmentSubmissions(');
    expect(src).toContain('async function handleGetSubmissionDetail(');
    expect(src).toContain('async function handleMarkSubmissionReviewed(');
  });

  it('mark_submission_reviewed emits the event BEFORE the canonical write (ADR-005 spine order)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const sourcePath = path.resolve(
      process.cwd(),
      'supabase/functions/teacher-dashboard/index.ts',
    );
    const src = await fs.readFile(sourcePath, 'utf8');
    const eventIdx = src.indexOf("kind: 'teacher.submission_reviewed'");
    // Search inside the handler scope so we don't trip on any other
    // `.from('assignment_submissions')` usage earlier in the file.
    const handlerStart = src.indexOf('async function handleMarkSubmissionReviewed');
    const handlerSlice = handlerStart >= 0 ? src.slice(handlerStart) : '';
    const localUpdateIdx = handlerSlice.search(/\.from\(['"]assignment_submissions['"]\)\s*\n?\s*\.update\(/);
    const updateIdx = localUpdateIdx >= 0 ? handlerStart + localUpdateIdx : -1;
    expect(eventIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    // Event publish must lexically precede the canonical update — same
    // invariant the API-route equivalents enforce (see Phase B.5 PR).
    expect(eventIdx).toBeLessThan(updateIdx);
  });
});
