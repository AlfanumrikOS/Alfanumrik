/**
 * Contract tests for the cross-assignment GRADING QUEUE action added to the
 * teacher-dashboard Edge Function in Phase 3A Wave B:
 *
 *   - get_grading_queue
 *
 * Mirrors teacher-dashboard-submissions-actions.test.ts — re-implements the
 * pure aggregation / exception-signal logic of the handler as a frozen
 * reference, then pins the response shape, the awaiting-grading filter,
 * oldest-first ordering, the needs_review_reason derivation, and the dispatch
 * table. The Edge Function runs on Deno + esm.sh and cannot be imported
 * directly under vitest; we read the source for dispatcher contract checks.
 *
 * Why this matters: the Command Center's "N submissions awaiting grading"
 * badge + grading queue call this action. The queue MUST exclude already-graded
 * submissions (no double-grading), MUST stay roster/teacher-scoped, and MUST be
 * oldest-first so the teacher works the backlog FIFO. needs_review_reason is
 * additive metadata only — it never changes a score or XP (P1/P2 untouched).
 */

import { describe, it, expect } from 'vitest';

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

// ─── Frozen needs_review_reason (mirrors deriveNeedsReviewReason) ──────

const ANTI_CHEAT_MIN_AVG_SECONDS_PER_Q = 3; // P3: minimum 3s avg per question

function deriveNeedsReviewReasonPure(args: {
  responses: unknown;
  questionsTotal: number;
  timeSpentSeconds: number;
}): 'all_same_answer' | 'too_fast' | null {
  const answeredOptionIndexes: number[] = [];
  if (Array.isArray(args.responses)) {
    for (const r of args.responses as Array<Record<string, unknown>>) {
      const raw =
        r?.selected_index ?? r?.student_answer ?? r?.answer ?? r?.response ?? null;
      if (raw == null) continue;
      const idx = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(idx)) answeredOptionIndexes.push(idx);
    }
  }

  if (
    answeredOptionIndexes.length > 3 &&
    answeredOptionIndexes.every((v) => v === answeredOptionIndexes[0])
  ) {
    return 'all_same_answer';
  }

  const qCount = Number(args.questionsTotal) || answeredOptionIndexes.length;
  const timeSpent = Number(args.timeSpentSeconds) || 0;
  if (qCount > 0 && timeSpent > 0) {
    const avgPerQ = timeSpent / qCount;
    if (avgPerQ < ANTI_CHEAT_MIN_AVG_SECONDS_PER_Q) return 'too_fast';
  }

  return null;
}

// ─── Frozen queue builder (mirrors buildGradingQueue) ──────────────────

interface GradingQueueItem {
  submission_id: string;
  assignment_id: string;
  assignment_title: string;
  student_id: string;
  student_name: string;
  submitted_at: string | null;
  question_count: number;
  auto_score: number | null;
  needs_review_reason: 'all_same_answer' | 'too_fast' | null;
}

interface RawSub {
  id: string;
  assignment_id: string;
  student_id: string;
  score: number | null;
  questions_total: number | null;
  questions_correct: number | null;
  time_spent_seconds: number | null;
  status: string | null;
  submitted_at: string | null;
  graded_at: string | null;
  responses: unknown;
}

function buildGradingQueuePure(
  assignments: Array<{ id: string; title: string }>,
  submissions: RawSub[],
  studentNameById: Map<string, string>,
): GradingQueueItem[] {
  const titleById = new Map(assignments.map((a) => [a.id, a.title]));
  const out: GradingQueueItem[] = [];

  for (const s of submissions) {
    const uiStatus = uiStatusForSubmissionPure(s.status, s.submitted_at, s.graded_at);
    if (uiStatus !== 'submitted') continue;

    const total = Number(s.questions_total ?? 0);
    const correct = Number(s.questions_correct ?? 0);
    const autoScore =
      s.score != null
        ? Number(s.score)
        : total > 0
          ? Math.round((correct / total) * 100)
          : null;

    out.push({
      submission_id: String(s.id),
      assignment_id: String(s.assignment_id),
      assignment_title: titleById.get(String(s.assignment_id)) || 'Assignment',
      student_id: String(s.student_id),
      student_name: studentNameById.get(String(s.student_id)) || 'Student',
      submitted_at: s.submitted_at ?? null,
      question_count: total,
      auto_score: autoScore,
      needs_review_reason: deriveNeedsReviewReasonPure({
        responses: s.responses,
        questionsTotal: total,
        timeSpentSeconds: Number(s.time_spent_seconds ?? 0),
      }),
    });
  }

  out.sort((a, b) => {
    if (a.submitted_at === b.submitted_at) return 0;
    if (a.submitted_at == null) return 1;
    if (b.submitted_at == null) return -1;
    return a.submitted_at < b.submitted_at ? -1 : 1;
  });

  return out;
}

// Helper: a fully-populated submitted-but-ungraded row, override per test.
function sub(overrides: Partial<RawSub> = {}): RawSub {
  return {
    id: 'sub-x',
    assignment_id: 'a1',
    student_id: 's1',
    score: null,
    questions_total: 10,
    questions_correct: 6,
    time_spent_seconds: 600,
    status: 'submitted',
    submitted_at: '2026-06-05T10:00:00Z',
    graded_at: null,
    responses: [],
    ...overrides,
  };
}

// ─── needs_review_reason derivation ────────────────────────────────────

describe('deriveNeedsReviewReason — exception signal', () => {
  it('flags all_same_answer when >3 questions all carry the same option', () => {
    const responses = [
      { selected_index: 2 },
      { selected_index: 2 },
      { selected_index: 2 },
      { selected_index: 2 },
    ];
    expect(
      deriveNeedsReviewReasonPure({ responses, questionsTotal: 4, timeSpentSeconds: 600 }),
    ).toBe('all_same_answer');
  });

  it('does NOT flag all_same_answer for a uniform 3-question quiz (P3: only >3)', () => {
    const responses = [{ selected_index: 1 }, { selected_index: 1 }, { selected_index: 1 }];
    expect(
      deriveNeedsReviewReasonPure({ responses, questionsTotal: 3, timeSpentSeconds: 600 }),
    ).toBeNull();
  });

  it('flags too_fast when avg time/question is below the 3s P3 floor', () => {
    // 10 questions in 20s = 2s/question < 3s.
    expect(
      deriveNeedsReviewReasonPure({ responses: [], questionsTotal: 10, timeSpentSeconds: 20 }),
    ).toBe('too_fast');
  });

  it('does NOT flag too_fast at or above the 3s floor', () => {
    // 10 questions in 30s = exactly 3s/question — not below the floor.
    expect(
      deriveNeedsReviewReasonPure({ responses: [], questionsTotal: 10, timeSpentSeconds: 30 }),
    ).toBeNull();
  });

  it('prefers all_same_answer over too_fast when both fire', () => {
    const responses = [
      { selected_index: 0 },
      { selected_index: 0 },
      { selected_index: 0 },
      { selected_index: 0 },
    ];
    // 4 questions in 4s = 1s/question (too_fast) AND all-same → all_same wins.
    expect(
      deriveNeedsReviewReasonPure({ responses, questionsTotal: 4, timeSpentSeconds: 4 }),
    ).toBe('all_same_answer');
  });

  it('returns null when no usable signal is present (no fabrication)', () => {
    // Empty responses + zero time = nothing to flag.
    expect(
      deriveNeedsReviewReasonPure({ responses: [], questionsTotal: 5, timeSpentSeconds: 0 }),
    ).toBeNull();
    // Malformed responses + zero time.
    expect(
      deriveNeedsReviewReasonPure({ responses: null, questionsTotal: 0, timeSpentSeconds: 0 }),
    ).toBeNull();
  });

  it('normalises the chosen option across historical response key names', () => {
    const responses = [
      { student_answer: 3 },
      { answer: 3 },
      { response: 3 },
      { selected_index: 3 },
    ];
    expect(
      deriveNeedsReviewReasonPure({ responses, questionsTotal: 4, timeSpentSeconds: 600 }),
    ).toBe('all_same_answer');
  });
});

// ─── queue aggregation ─────────────────────────────────────────────────

describe('buildGradingQueue — aggregation', () => {
  const names = new Map([
    ['s1', 'Alice'],
    ['s2', 'Bob'],
    ['s3', 'Carol'],
  ]);
  const assignments = [
    { id: 'a1', title: 'Algebra HW' },
    { id: 'a2', title: 'Geometry HW' },
  ];

  it('returns ONLY submitted-but-ungraded rows; excludes graded and pending', () => {
    const subs: RawSub[] = [
      sub({ id: 'sub1', student_id: 's1', status: 'submitted', graded_at: null }),
      // graded — excluded
      sub({ id: 'sub2', student_id: 's2', status: 'graded', graded_at: '2026-06-06T10:00:00Z' }),
      // reviewed — excluded
      sub({ id: 'sub3', student_id: 's3', status: 'reviewed', graded_at: '2026-06-06T11:00:00Z' }),
      // pending (not started, no submitted_at) — excluded
      sub({ id: 'sub4', student_id: 's2', status: 'not_started', submitted_at: null, graded_at: null }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q.map((i) => i.submission_id)).toEqual(['sub1']);
  });

  it('treats status "completed" with no graded_at as awaiting grading', () => {
    const subs: RawSub[] = [
      sub({ id: 'sub1', status: 'completed', submitted_at: '2026-06-05T09:00:00Z', graded_at: null }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q).toHaveLength(1);
    expect(q[0].submission_id).toBe('sub1');
  });

  it('spans MULTIPLE assignments and stamps each item with its assignment title', () => {
    const subs: RawSub[] = [
      sub({ id: 'sub1', assignment_id: 'a1', student_id: 's1', submitted_at: '2026-06-05T10:00:00Z' }),
      sub({ id: 'sub2', assignment_id: 'a2', student_id: 's2', submitted_at: '2026-06-05T11:00:00Z' }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q).toHaveLength(2);
    expect(q.find((i) => i.submission_id === 'sub1')?.assignment_title).toBe('Algebra HW');
    expect(q.find((i) => i.submission_id === 'sub2')?.assignment_title).toBe('Geometry HW');
  });

  it('sorts oldest-first by submitted_at (FIFO backlog)', () => {
    const subs: RawSub[] = [
      sub({ id: 'newest', submitted_at: '2026-06-07T10:00:00Z' }),
      sub({ id: 'oldest', submitted_at: '2026-06-01T10:00:00Z' }),
      sub({ id: 'middle', submitted_at: '2026-06-04T10:00:00Z' }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q.map((i) => i.submission_id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('derives auto_score from the score column, falling back to correct/total', () => {
    const subs: RawSub[] = [
      // canonical score present
      sub({ id: 'sub1', student_id: 's1', score: 82, submitted_at: '2026-06-05T10:00:00Z' }),
      // score null → derive 3/4 = 75
      sub({
        id: 'sub2',
        student_id: 's2',
        score: null,
        questions_total: 4,
        questions_correct: 3,
        submitted_at: '2026-06-05T11:00:00Z',
      }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q.find((i) => i.submission_id === 'sub1')?.auto_score).toBe(82);
    expect(q.find((i) => i.submission_id === 'sub2')?.auto_score).toBe(75);
  });

  it('emits the documented item shape and resolves student names', () => {
    const subs: RawSub[] = [
      sub({
        id: 'sub1',
        assignment_id: 'a1',
        student_id: 's1',
        score: 70,
        questions_total: 8,
        submitted_at: '2026-06-05T10:00:00Z',
        time_spent_seconds: 600,
        responses: [],
      }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q[0]).toEqual({
      submission_id: 'sub1',
      assignment_id: 'a1',
      assignment_title: 'Algebra HW',
      student_id: 's1',
      student_name: 'Alice',
      submitted_at: '2026-06-05T10:00:00Z',
      question_count: 8,
      auto_score: 70,
      needs_review_reason: null,
    });
  });

  it('attaches needs_review_reason on anomalous items only', () => {
    const subs: RawSub[] = [
      // normal
      sub({ id: 'ok', student_id: 's1', submitted_at: '2026-06-05T10:00:00Z', responses: [{ selected_index: 0 }, { selected_index: 1 }] }),
      // too fast: 10 Q in 10s
      sub({ id: 'fast', student_id: 's2', questions_total: 10, time_spent_seconds: 10, submitted_at: '2026-06-05T11:00:00Z', responses: [] }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q.find((i) => i.submission_id === 'ok')?.needs_review_reason).toBeNull();
    expect(q.find((i) => i.submission_id === 'fast')?.needs_review_reason).toBe('too_fast');
  });

  it('degrades to an empty queue when there are no submissions', () => {
    expect(buildGradingQueuePure(assignments, [], names)).toEqual([]);
  });

  it('falls back to a default student name when the roster lookup misses', () => {
    const subs: RawSub[] = [
      sub({ id: 'sub1', student_id: 'unknown', submitted_at: '2026-06-05T10:00:00Z' }),
    ];
    const q = buildGradingQueuePure(assignments, subs, names);
    expect(q[0].student_name).toBe('Student');
  });
});

// ─── No-double-grade invariant: a graded item LEAVES the queue ─────────
//
// The static "graded rows are excluded" check above pins the filter for a fresh
// fetch. This block pins the DYNAMIC invariant the catalog entry guards: the
// SAME submission, once a teacher grades it (graded_at stamped + status flipped
// by the unchanged mark_submission_reviewed write), must drop out of a re-fetch.
// A queue that re-surfaced an already-graded item would invite double-grading
// and a score-override race — exactly what Wave B must never do.
describe('buildGradingQueue — graded items leave the queue (no double-grading)', () => {
  const names = new Map([['s1', 'Alice']]);
  const assignments = [{ id: 'a1', title: 'Algebra HW' }];

  it('the same submission appears while submitted, then disappears once graded', () => {
    // Phase 1 — turned in, not yet graded: it IS in the queue.
    const before = sub({
      id: 'sub-grade-me',
      student_id: 's1',
      status: 'submitted',
      submitted_at: '2026-06-05T10:00:00Z',
      graded_at: null,
    });
    const queuedBefore = buildGradingQueuePure(assignments, [before], names);
    expect(queuedBefore.map((i) => i.submission_id)).toEqual(['sub-grade-me']);

    // Phase 2 — mark_submission_reviewed stamps graded_at + status 'graded'
    // (mirrors the unchanged handler patch). The identical row now derives to
    // ui-status 'graded', so a re-fetch must NOT re-surface it.
    const after: RawSub = {
      ...before,
      status: 'graded',
      graded_at: '2026-06-06T09:00:00Z',
    };
    const queuedAfter = buildGradingQueuePure(assignments, [after], names);
    expect(queuedAfter).toEqual([]);
  });

  it('a graded_at stamp alone (status unchanged) is enough to drop the row', () => {
    // Defensive: even if status lags at 'submitted', the graded_at timestamp
    // forces ui-status 'graded' (gradedAt wins in uiStatusForSubmission), so the
    // item still leaves the queue. The server query's .is('graded_at', null)
    // filter and this JS re-derivation are belt-and-suspenders for the same rule.
    const stampedButStatusStale = sub({
      id: 'sub-x',
      status: 'submitted',
      submitted_at: '2026-06-05T10:00:00Z',
      graded_at: '2026-06-06T09:00:00Z',
    });
    expect(buildGradingQueuePure(assignments, [stampedButStatusStale], names)).toEqual([]);
  });
});

// ─── needs_review_reason is signal-only: it never moves the score ──────
//
// The catalog entry pins that the exception flag is derived metadata only —
// P1/P2 untouched. These tests prove auto_score is byte-identical whether or not
// a needs_review_reason fires: the flag and the score are computed from disjoint
// inputs, so flagging an anomaly cannot perturb the number the teacher sees.
describe('needs_review_reason is score-neutral (P1/P2 untouched)', () => {
  const names = new Map([['s1', 'Alice']]);
  const assignments = [{ id: 'a1', title: 'Algebra HW' }];

  it('auto_score is identical whether or not the too_fast flag fires', () => {
    // Same score/total; only the recorded time differs (one trips the 3s floor,
    // one does not). auto_score must be the same on both.
    const flagged = sub({
      id: 'fast',
      student_id: 's1',
      score: null,
      questions_total: 10,
      questions_correct: 7,
      time_spent_seconds: 10, // 1s/q → too_fast
      submitted_at: '2026-06-05T10:00:00Z',
      responses: [],
    });
    const clean = sub({
      id: 'slow',
      student_id: 's1',
      score: null,
      questions_total: 10,
      questions_correct: 7,
      time_spent_seconds: 600, // 60s/q → no flag
      submitted_at: '2026-06-05T11:00:00Z',
      responses: [],
    });
    const q = buildGradingQueuePure(assignments, [flagged, clean], names);
    const flaggedItem = q.find((i) => i.submission_id === 'fast')!;
    const cleanItem = q.find((i) => i.submission_id === 'slow')!;

    expect(flaggedItem.needs_review_reason).toBe('too_fast');
    expect(cleanItem.needs_review_reason).toBeNull();
    // The exception signal did NOT touch the score: both derive 7/10 = 70.
    expect(flaggedItem.auto_score).toBe(70);
    expect(cleanItem.auto_score).toBe(70);
    expect(flaggedItem.auto_score).toBe(cleanItem.auto_score);
  });

  it('auto_score is identical whether or not the all_same_answer flag fires', () => {
    // Both carry a canonical score of 100; only the answer PATTERN differs.
    // The all-same pattern flags the anomalous one but leaves its score at 100.
    const flagged = sub({
      id: 'allsame',
      student_id: 's1',
      score: 100,
      questions_total: 4,
      questions_correct: 4,
      submitted_at: '2026-06-05T10:00:00Z',
      time_spent_seconds: 600,
      responses: [
        { selected_index: 2 },
        { selected_index: 2 },
        { selected_index: 2 },
        { selected_index: 2 },
      ],
    });
    const clean = sub({
      id: 'varied',
      student_id: 's1',
      score: 100,
      questions_total: 4,
      questions_correct: 4,
      submitted_at: '2026-06-05T11:00:00Z',
      time_spent_seconds: 600,
      responses: [
        { selected_index: 0 },
        { selected_index: 1 },
        { selected_index: 2 },
        { selected_index: 3 },
      ],
    });
    const q = buildGradingQueuePure(assignments, [flagged, clean], names);
    const flaggedItem = q.find((i) => i.submission_id === 'allsame')!;
    const cleanItem = q.find((i) => i.submission_id === 'varied')!;

    expect(flaggedItem.needs_review_reason).toBe('all_same_answer');
    expect(cleanItem.needs_review_reason).toBeNull();
    // Flagging the anomaly did not move the score: both stay at the
    // verbatim canonical 100 (no client re-scoring).
    expect(flaggedItem.auto_score).toBe(100);
    expect(cleanItem.auto_score).toBe(100);
  });
});

// ─── Dispatcher contract — the new action must be wired ────────────────

describe('teacher-dashboard dispatcher — get_grading_queue wired', () => {
  it('has a switch case for get_grading_queue', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'supabase/functions/teacher-dashboard/index.ts'),
      'utf8',
    );
    expect(src).toContain("case 'get_grading_queue':");
  });

  it('defines the handler + supporting pure helpers', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'supabase/functions/teacher-dashboard/index.ts'),
      'utf8',
    );
    expect(src).toContain('async function handleGetGradingQueue(');
    expect(src).toContain('function buildGradingQueue(');
    expect(src).toContain('function deriveNeedsReviewReason(');
  });

  it('REGRESSION: filters the query to ungraded submitted/completed rows (no double-grading)', async () => {
    // The queue must never re-surface a graded submission. We pin the SQL
    // filter so a future refactor can't silently widen the queue to graded
    // rows (which would let a teacher re-grade and risk a score override race).
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'supabase/functions/teacher-dashboard/index.ts'),
      'utf8',
    );
    const handlerStart = src.indexOf('async function handleGetGradingQueue');
    const slice = handlerStart >= 0 ? src.slice(handlerStart) : '';
    expect(slice).toContain(".is('graded_at', null)");
    expect(slice).toContain("'submitted', 'completed'");
  });

  it('REGRESSION: scopes assignments to the caller teacher_id (P8 roster boundary)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'supabase/functions/teacher-dashboard/index.ts'),
      'utf8',
    );
    const handlerStart = src.indexOf('async function handleGetGradingQueue');
    const slice = handlerStart >= 0 ? src.slice(handlerStart) : '';
    expect(slice).toContain(".eq('teacher_id', teacherId)");
  });
});
