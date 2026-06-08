/**
 * Contract tests for the Phase 3A Wave C MASTERY + BLOOM'S report actions added
 * to the teacher-dashboard Edge Function:
 *
 *   - get_student_mastery_report      (per-student deep dive)
 *   - get_class_mastery_bloom_summary (class-level rollup)
 *   - export_student_report           (parent-readable CSV)
 *
 * Mirrors teacher-dashboard-gradebook-actions.test.ts and
 * teacher-dashboard-grading-queue-action.test.ts — re-implements the PURE
 * shaping logic of each handler as a frozen reference, then pins:
 *   - Bloom aggregation (correct/total per level; weakest_level selection),
 *   - mastery report shaping (BKT p_know surfaced verbatim as a percent),
 *   - roster scoping (a non-roster student is rejected),
 *   - the parent-export CSV shape,
 *   - the dispatch table (the 3 new actions wired + handlers defined).
 *
 * The Edge Function runs on Deno + esm.sh and cannot be imported directly under
 * vitest; we read the source for dispatcher contract checks (same approach as
 * the sibling teacher-dashboard suites).
 *
 * Why this matters: Wave C deepens the gradebook with two reporting dimensions —
 * MASTERY (the existing BKT signal, read verbatim) and BLOOM'S (per-CBSE-level
 * accuracy over the questions the student actually answered). accuracy_pct is a
 * DISPLAY figure only; it never feeds scoring/XP (P1/P2 untouched). The report
 * is roster-scoped (P13) and CBSE Bloom's level names are technical terms (P7)
 * left untranslated.
 */

import { describe, it, expect } from 'vitest';

// ─── Frozen Bloom aggregation (mirrors aggregateBloomDistribution) ─────

const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const;

interface BloomLevelRow {
  bloom_level: string;
  correct: number;
  total: number;
  accuracy_pct: number;
}
interface BloomDistribution {
  by_level: BloomLevelRow[];
  weakest_level: string | null;
}

function aggregateBloomDistributionPure(
  responses: Array<{ bloom_level: string | null; is_correct: boolean | null }>,
): BloomDistribution {
  const tally = new Map<string, { correct: number; total: number }>();
  for (const r of responses) {
    const level = typeof r.bloom_level === 'string' ? r.bloom_level.trim().toLowerCase() : '';
    if (!level) continue;
    const bucket = tally.get(level) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (r.is_correct === true) bucket.correct += 1;
    tally.set(level, bucket);
  }

  const canonicalOrder = (lvl: string): number => {
    const idx = (BLOOM_LEVELS as readonly string[]).indexOf(lvl);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const levels = [...tally.keys()].sort((a, b) => {
    const ca = canonicalOrder(a);
    const cb = canonicalOrder(b);
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b);
  });

  const by_level: BloomLevelRow[] = levels.map((level) => {
    const { correct, total } = tally.get(level)!;
    return {
      bloom_level: level,
      correct,
      total,
      accuracy_pct: total > 0 ? Math.round((correct / total) * 100) : 0,
    };
  });

  let weakest: string | null = null;
  let weakestPct = Number.POSITIVE_INFINITY;
  for (const row of by_level) {
    if (row.accuracy_pct < weakestPct) {
      weakestPct = row.accuracy_pct;
      weakest = row.bloom_level;
    }
  }

  return { by_level, weakest_level: weakest };
}

describe('aggregateBloomDistribution — per-level correct/total', () => {
  it('tallies correct/total per Bloom level from answered questions', () => {
    const responses = [
      { bloom_level: 'remember', is_correct: true },
      { bloom_level: 'remember', is_correct: true },
      { bloom_level: 'remember', is_correct: false },
      { bloom_level: 'apply', is_correct: false },
      { bloom_level: 'apply', is_correct: false },
    ];
    const dist = aggregateBloomDistributionPure(responses);
    const remember = dist.by_level.find((b) => b.bloom_level === 'remember')!;
    const apply = dist.by_level.find((b) => b.bloom_level === 'apply')!;
    expect(remember).toMatchObject({ correct: 2, total: 3, accuracy_pct: 67 });
    expect(apply).toMatchObject({ correct: 0, total: 2, accuracy_pct: 0 });
  });

  it('emits by_level in canonical CBSE Bloom order (remember→create)', () => {
    const responses = [
      { bloom_level: 'create', is_correct: true },
      { bloom_level: 'remember', is_correct: true },
      { bloom_level: 'analyze', is_correct: true },
      { bloom_level: 'understand', is_correct: true },
    ];
    const dist = aggregateBloomDistributionPure(responses);
    expect(dist.by_level.map((b) => b.bloom_level)).toEqual([
      'remember',
      'understand',
      'analyze',
      'create',
    ]);
  });

  it('selects weakest_level as the lowest-accuracy answered level', () => {
    const responses = [
      { bloom_level: 'remember', is_correct: true }, // 100%
      { bloom_level: 'understand', is_correct: true },
      { bloom_level: 'understand', is_correct: false }, // 50%
      { bloom_level: 'apply', is_correct: false },
      { bloom_level: 'apply', is_correct: false }, // 0% — weakest
    ];
    const dist = aggregateBloomDistributionPure(responses);
    expect(dist.weakest_level).toBe('apply');
  });

  it('breaks weakest_level ties toward the lower canonical Bloom order', () => {
    // remember and apply both at 0% — remember (lower order) wins.
    const responses = [
      { bloom_level: 'apply', is_correct: false },
      { bloom_level: 'remember', is_correct: false },
    ];
    const dist = aggregateBloomDistributionPure(responses);
    expect(dist.weakest_level).toBe('remember');
  });

  it('omits levels the student never answered (no fabricated 0% rows)', () => {
    const responses = [{ bloom_level: 'understand', is_correct: true }];
    const dist = aggregateBloomDistributionPure(responses);
    expect(dist.by_level.map((b) => b.bloom_level)).toEqual(['understand']);
    // 'remember', 'apply', etc. are NOT invented.
    expect(dist.by_level.length).toBe(1);
  });

  it('skips rows with no recorded bloom_level (null / empty)', () => {
    const responses = [
      { bloom_level: null, is_correct: true },
      { bloom_level: '', is_correct: false },
      { bloom_level: '  ', is_correct: true },
      { bloom_level: 'apply', is_correct: true },
    ];
    const dist = aggregateBloomDistributionPure(responses);
    expect(dist.by_level).toHaveLength(1);
    expect(dist.by_level[0]).toMatchObject({ bloom_level: 'apply', total: 1 });
  });

  it('normalises bloom_level casing/whitespace so labels aggregate', () => {
    const responses = [
      { bloom_level: 'Apply', is_correct: true },
      { bloom_level: ' apply ', is_correct: false },
      { bloom_level: 'APPLY', is_correct: true },
    ];
    const dist = aggregateBloomDistributionPure(responses);
    expect(dist.by_level).toHaveLength(1);
    expect(dist.by_level[0]).toMatchObject({ bloom_level: 'apply', correct: 2, total: 3 });
  });

  it('degrades to an empty distribution when there are no answered questions', () => {
    const dist = aggregateBloomDistributionPure([]);
    expect(dist).toEqual({ by_level: [], weakest_level: null });
  });

  it('REGRESSION: accuracy_pct is display-only — same correct/total never changes regardless of weakest selection', () => {
    // Two levels, identical accuracy; weakest tie-break must not perturb the
    // per-level numbers. Pins that the accuracy figure is a pure correct/total
    // readout and not a score that the aggregation mutates.
    const responses = [
      { bloom_level: 'remember', is_correct: true },
      { bloom_level: 'remember', is_correct: false },
      { bloom_level: 'apply', is_correct: true },
      { bloom_level: 'apply', is_correct: false },
    ];
    const dist = aggregateBloomDistributionPure(responses);
    for (const row of dist.by_level) {
      expect(row.accuracy_pct).toBe(50);
      expect(row.correct).toBe(1);
      expect(row.total).toBe(2);
    }
  });
});

// ─── Frozen mastery shaping (mirrors shapeMasterySummary) ──────────────

interface ConceptMasteryRow {
  topic_id: string;
  concept: string;
  mastery_pct: number;
  attempts: number;
}
interface MasterySummary {
  by_concept: ConceptMasteryRow[];
  overall_pct: number;
}

function shapeMasterySummaryPure(
  rows: Array<{ topic_id: string; concept: string; p_know: number; attempts: number }>,
): MasterySummary {
  const by_concept: ConceptMasteryRow[] = rows.map((r) => ({
    topic_id: r.topic_id,
    concept: r.concept,
    mastery_pct: Math.round((Number(r.p_know) || 0) * 100),
    attempts: Number(r.attempts) || 0,
  }));
  const overall_pct =
    by_concept.length > 0
      ? Math.round(by_concept.reduce((acc, c) => acc + c.mastery_pct, 0) / by_concept.length)
      : 0;
  return { by_concept, overall_pct };
}

describe('shapeMasterySummary — BKT mastery surfaced verbatim', () => {
  it('surfaces p_know as a percent (round(p_know*100)) per concept', () => {
    const rows = [
      { topic_id: 't1', concept: 'Fractions', p_know: 0.82, attempts: 12 },
      { topic_id: 't2', concept: 'Decimals', p_know: 0.4, attempts: 5 },
    ];
    const m = shapeMasterySummaryPure(rows);
    expect(m.by_concept[0]).toEqual({ topic_id: 't1', concept: 'Fractions', mastery_pct: 82, attempts: 12 });
    expect(m.by_concept[1]).toEqual({ topic_id: 't2', concept: 'Decimals', mastery_pct: 40, attempts: 5 });
  });

  it('computes overall_pct as the mean of per-concept mastery percents', () => {
    const rows = [
      { topic_id: 't1', concept: 'A', p_know: 0.8, attempts: 1 },
      { topic_id: 't2', concept: 'B', p_know: 0.6, attempts: 1 },
      { topic_id: 't3', concept: 'C', p_know: 0.4, attempts: 1 },
    ];
    const m = shapeMasterySummaryPure(rows);
    expect(m.overall_pct).toBe(60); // (80+60+40)/3
  });

  it('REGRESSION: does NOT re-derive mastery — p_know passes through untouched (no scoring math)', () => {
    // A weird BKT value must round-trip as round(p_know*100), not be clamped,
    // bonused, or recomputed. Pins "mastery = existing BKT value read verbatim".
    const rows = [{ topic_id: 't1', concept: 'X', p_know: 0.999, attempts: 3 }];
    const m = shapeMasterySummaryPure(rows);
    expect(m.by_concept[0].mastery_pct).toBe(100);
  });

  it('degrades to overall_pct 0 + empty by_concept when no BKT rows exist', () => {
    const m = shapeMasterySummaryPure([]);
    expect(m).toEqual({ by_concept: [], overall_pct: 0 });
  });
});

// ─── Roster scoping (mirrors resolveStudentsForTeacher gate) ───────────

interface OwnedStudent {
  id: string;
  name: string;
  grade: string;
}
function studentIsOnRoster(owned: OwnedStudent[], studentId: string): OwnedStudent | null {
  return owned.find((s) => s.id === studentId) ?? null;
}

describe('get_student_mastery_report — roster scoping (P13)', () => {
  const roster: OwnedStudent[] = [
    { id: 's1', name: 'Alice', grade: '7' },
    { id: 's2', name: 'Bob', grade: '7' },
  ];

  it('allows a report for a student on the caller-teacher roster', () => {
    expect(studentIsOnRoster(roster, 's1')).toMatchObject({ id: 's1', name: 'Alice' });
  });

  it('REGRESSION: rejects a non-roster student (cross-tenant 403)', () => {
    expect(studentIsOnRoster(roster, 's-other-school')).toBeNull();
  });

  it('P5: the roster student carries grade as a string', () => {
    const target = studentIsOnRoster(roster, 's2');
    expect(typeof target?.grade).toBe('string');
    expect(target?.grade).toBe('7');
  });
});

// ─── Full per-student report shape ─────────────────────────────────────

interface RecentActivity {
  quizzes: number;
  avg_score: number;
  streak: number;
}
function buildStudentMasteryReport(args: {
  studentId: string;
  studentName: string;
  grade: string;
  masteryRows: Array<{ topic_id: string; concept: string; p_know: number; attempts: number }>;
  bloomRows: Array<{ bloom_level: string | null; is_correct: boolean | null }>;
  recent: RecentActivity;
}) {
  return {
    student_id: args.studentId,
    student_name: args.studentName,
    grade: String(args.grade || ''),
    mastery: shapeMasterySummaryPure(args.masteryRows),
    bloom: aggregateBloomDistributionPure(args.bloomRows),
    recent: args.recent,
  };
}

describe('get_student_mastery_report — response shape', () => {
  it('emits the documented { student_id, student_name, grade, mastery, bloom, recent } shape', () => {
    const report = buildStudentMasteryReport({
      studentId: 's1',
      studentName: 'Alice',
      grade: '7',
      masteryRows: [{ topic_id: 't1', concept: 'Fractions', p_know: 0.75, attempts: 8 }],
      bloomRows: [
        { bloom_level: 'remember', is_correct: true },
        { bloom_level: 'apply', is_correct: false },
      ],
      recent: { quizzes: 4, avg_score: 78, streak: 3 },
    });
    expect(report).toEqual({
      student_id: 's1',
      student_name: 'Alice',
      grade: '7',
      mastery: {
        by_concept: [{ topic_id: 't1', concept: 'Fractions', mastery_pct: 75, attempts: 8 }],
        overall_pct: 75,
      },
      bloom: {
        by_level: [
          { bloom_level: 'remember', correct: 1, total: 1, accuracy_pct: 100 },
          { bloom_level: 'apply', correct: 0, total: 1, accuracy_pct: 0 },
        ],
        weakest_level: 'apply',
      },
      recent: { quizzes: 4, avg_score: 78, streak: 3 },
    });
  });

  it('P5: grade is always a string in the report payload', () => {
    const report = buildStudentMasteryReport({
      studentId: 's1',
      studentName: 'Alice',
      // simulate a numeric grade leaking from a row — must coerce to string
      grade: 8 as unknown as string,
      masteryRows: [],
      bloomRows: [],
      recent: { quizzes: 0, avg_score: 0, streak: 0 },
    });
    expect(typeof report.grade).toBe('string');
    expect(report.grade).toBe('8');
  });

  it('degrades gracefully to empty mastery/bloom blocks for a quiet student', () => {
    const report = buildStudentMasteryReport({
      studentId: 's1',
      studentName: 'Alice',
      grade: '7',
      masteryRows: [],
      bloomRows: [],
      recent: { quizzes: 0, avg_score: 0, streak: 0 },
    });
    expect(report.mastery).toEqual({ by_concept: [], overall_pct: 0 });
    expect(report.bloom).toEqual({ by_level: [], weakest_level: null });
  });
});

// ─── Class-level rollup ────────────────────────────────────────────────

function buildClassMasteryRollup(
  bktRows: Array<{ topic_id: string; p_know: number; attempts: number }>,
  titleById: Map<string, string>,
): { by_concept: Array<{ topic_id: string; concept: string; avg_mastery_pct: number; student_count: number }>; overall_pct: number } {
  const agg = new Map<string, { masterySum: number; n: number }>();
  for (const r of bktRows) {
    const topicId = String(r.topic_id || '');
    if (!topicId) continue;
    const a = agg.get(topicId) ?? { masterySum: 0, n: 0 };
    a.masterySum += Math.round((Number(r.p_know) || 0) * 100);
    a.n += 1;
    agg.set(topicId, a);
  }
  const by_concept: Array<{ topic_id: string; concept: string; avg_mastery_pct: number; student_count: number }> = [];
  for (const [topicId, a] of agg) {
    by_concept.push({
      topic_id: topicId,
      concept: titleById.get(topicId) || topicId,
      avg_mastery_pct: a.n > 0 ? Math.round(a.masterySum / a.n) : 0,
      student_count: a.n,
    });
  }
  by_concept.sort((x, y) => x.avg_mastery_pct - y.avg_mastery_pct);
  const overall_pct =
    by_concept.length > 0
      ? Math.round(by_concept.reduce((acc, c) => acc + c.avg_mastery_pct, 0) / by_concept.length)
      : 0;
  return { by_concept, overall_pct };
}

describe('get_class_mastery_bloom_summary — class mastery rollup', () => {
  it('averages mastery per concept across the class', () => {
    const bktRows = [
      { topic_id: 't1', p_know: 0.8, attempts: 4 }, // s1 on t1
      { topic_id: 't1', p_know: 0.4, attempts: 2 }, // s2 on t1 → avg 60
      { topic_id: 't2', p_know: 0.9, attempts: 5 }, // s1 on t2 → 90
    ];
    const titles = new Map([['t1', 'Fractions'], ['t2', 'Decimals']]);
    const rollup = buildClassMasteryRollup(bktRows, titles);
    const t1 = rollup.by_concept.find((c) => c.topic_id === 't1')!;
    const t2 = rollup.by_concept.find((c) => c.topic_id === 't2')!;
    expect(t1).toMatchObject({ concept: 'Fractions', avg_mastery_pct: 60, student_count: 2 });
    expect(t2).toMatchObject({ concept: 'Decimals', avg_mastery_pct: 90, student_count: 1 });
  });

  it('orders concepts weakest-first (drill-through to where to intervene)', () => {
    const bktRows = [
      { topic_id: 'strong', p_know: 0.9, attempts: 1 },
      { topic_id: 'weak', p_know: 0.2, attempts: 1 },
      { topic_id: 'mid', p_know: 0.55, attempts: 1 },
    ];
    const rollup = buildClassMasteryRollup(bktRows, new Map());
    expect(rollup.by_concept.map((c) => c.topic_id)).toEqual(['weak', 'mid', 'strong']);
  });

  it('pools class Bloom rows the same way the per-student aggregation does', () => {
    // Class-level Bloom uses the identical aggregator over pooled rows.
    const pooled = [
      { bloom_level: 'apply', is_correct: false },
      { bloom_level: 'apply', is_correct: false }, // s1+s2 both wrong on apply
      { bloom_level: 'remember', is_correct: true },
    ];
    const dist = aggregateBloomDistributionPure(pooled);
    expect(dist.by_level.find((b) => b.bloom_level === 'apply')).toMatchObject({
      correct: 0,
      total: 2,
      accuracy_pct: 0,
    });
    expect(dist.weakest_level).toBe('apply');
  });

  it('degrades to empty mastery + bloom when the class has no signal', () => {
    expect(buildClassMasteryRollup([], new Map())).toEqual({ by_concept: [], overall_pct: 0 });
    expect(aggregateBloomDistributionPure([])).toEqual({ by_level: [], weakest_level: null });
  });
});

// ─── Parent-readable CSV export ────────────────────────────────────────

function csvEscapePure(value: string | number | null): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

function buildStudentReportCsv(report: {
  student_name: string;
  grade: string;
  mastery: MasterySummary;
  bloom: BloomDistribution;
  recent: RecentActivity;
}): string {
  const lines: string[] = [];
  lines.push(['Student Report', report.student_name].map(csvEscapePure).join(','));
  lines.push(['Grade', report.grade].map(csvEscapePure).join(','));
  lines.push(['Overall Mastery (%)', report.mastery.overall_pct].map(csvEscapePure).join(','));
  lines.push(['Quizzes Completed', report.recent.quizzes].map(csvEscapePure).join(','));
  lines.push(['Average Score (%)', report.recent.avg_score].map(csvEscapePure).join(','));
  lines.push(['Best Streak (days)', report.recent.streak].map(csvEscapePure).join(','));
  lines.push('');
  lines.push(['Concept Mastery', '', ''].map(csvEscapePure).join(','));
  lines.push(['Concept', 'Mastery (%)', 'Attempts'].map(csvEscapePure).join(','));
  for (const c of report.mastery.by_concept) {
    lines.push([c.concept, c.mastery_pct, c.attempts].map(csvEscapePure).join(','));
  }
  lines.push('');
  lines.push(["Bloom's Level Performance", '', '', ''].map(csvEscapePure).join(','));
  lines.push(["Bloom's Level", 'Correct', 'Total', 'Accuracy (%)'].map(csvEscapePure).join(','));
  for (const b of report.bloom.by_level) {
    lines.push([b.bloom_level, b.correct, b.total, b.accuracy_pct].map(csvEscapePure).join(','));
  }
  if (report.bloom.weakest_level) {
    lines.push('');
    lines.push(['Weakest Bloom Level', report.bloom.weakest_level].map(csvEscapePure).join(','));
  }
  return lines.join('\n');
}

describe('export_student_report — parent-readable CSV', () => {
  const report = {
    student_name: 'Alice',
    grade: '7',
    mastery: {
      by_concept: [
        { topic_id: 't1', concept: 'Fractions', mastery_pct: 82, attempts: 12 },
        { topic_id: 't2', concept: 'Decimals', mastery_pct: 40, attempts: 5 },
      ],
      overall_pct: 61,
    },
    bloom: {
      by_level: [
        { bloom_level: 'remember', correct: 5, total: 6, accuracy_pct: 83 },
        { bloom_level: 'apply', correct: 1, total: 4, accuracy_pct: 25 },
      ],
      weakest_level: 'apply',
    },
    recent: { quizzes: 9, avg_score: 71, streak: 4 },
  };

  it('renders a sectioned report a parent can read top-to-bottom', () => {
    const csv = buildStudentReportCsv(report);
    expect(csv).toContain('Student Report,Alice');
    expect(csv).toContain('Grade,7');
    expect(csv).toContain('Overall Mastery (%),61');
    expect(csv).toContain('Concept,Mastery (%),Attempts');
    expect(csv).toContain('Fractions,82,12');
    expect(csv).toContain('Decimals,40,5');
    expect(csv).toContain("Bloom's Level,Correct,Total,Accuracy (%)");
    expect(csv).toContain('remember,5,6,83');
    expect(csv).toContain('apply,1,4,25');
    expect(csv).toContain('Weakest Bloom Level,apply');
  });

  it("does NOT translate CBSE Bloom's level names (P7 technical terms)", () => {
    const csv = buildStudentReportCsv(report);
    // The canonical English Bloom labels appear verbatim — never localised.
    for (const level of ['remember', 'apply']) {
      expect(csv).toContain(level);
    }
  });

  it('escapes a student name containing a comma', () => {
    const csv = buildStudentReportCsv({ ...report, student_name: 'Smith, John' });
    expect(csv).toContain('"Smith, John"');
  });

  it('handles a quiet student (empty concept/Bloom sections) without crashing', () => {
    const csv = buildStudentReportCsv({
      student_name: 'Quiet',
      grade: '6',
      mastery: { by_concept: [], overall_pct: 0 },
      bloom: { by_level: [], weakest_level: null },
      recent: { quizzes: 0, avg_score: 0, streak: 0 },
    });
    expect(csv).toContain('Student Report,Quiet');
    expect(csv).toContain('Overall Mastery (%),0');
    // No "Weakest Bloom Level" row when there is no weakest level.
    expect(csv).not.toContain('Weakest Bloom Level');
  });
});

// ─── Dispatcher contract — the 3 Wave C actions must be wired ──────────

const REQUIRED_WAVE_C_ACTIONS = [
  'get_student_mastery_report',
  'get_class_mastery_bloom_summary',
  'export_student_report',
] as const;

async function readEdgeSource(): Promise<string> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  return fs.readFile(
    path.resolve(process.cwd(), 'supabase/functions/teacher-dashboard/index.ts'),
    'utf8',
  );
}

describe('teacher-dashboard dispatcher — Phase 3A Wave C actions present', () => {
  it('every required Wave C action has a switch case in the Edge Function source', async () => {
    const src = await readEdgeSource();
    for (const action of REQUIRED_WAVE_C_ACTIONS) {
      expect(src).toContain(`case '${action}':`);
    }
  });

  it('handler functions are defined for each new action', async () => {
    const src = await readEdgeSource();
    expect(src).toContain('async function handleGetStudentMasteryReport(');
    expect(src).toContain('async function handleGetClassMasteryBloomSummary(');
    expect(src).toContain('async function handleExportStudentReport(');
  });

  it('REGRESSION: Bloom is sourced from quiz_responses.bloom_level (the answered-question read)', async () => {
    // Pin the Bloom source so a refactor cannot silently swap to a different
    // (e.g. question_bank join) path that might disagree with what the student
    // actually answered. quiz_responses carries bloom_level + is_correct on the
    // same row.
    const src = await readEdgeSource();
    expect(src).toContain("from('quiz_responses')");
    expect(src).toContain("select('bloom_level, is_correct')");
  });

  it('REGRESSION: mastery reuses the bkt_mastery_state read (BKT verbatim, no new scoring)', async () => {
    const src = await readEdgeSource();
    expect(src).toContain("from('bkt_mastery_state')");
    // p_know is read, surfaced as a percent — never recomputed.
    expect(src).toContain("select('topic_id, p_know, attempts')");
  });

  it('REGRESSION: the per-student report is roster-scoped via resolveStudentsForTeacher (P13)', async () => {
    const src = await readEdgeSource();
    const handlerStart = src.indexOf('async function handleGetStudentMasteryReport');
    expect(handlerStart).toBeGreaterThan(-1);
    const slice = src.slice(handlerStart, handlerStart + 2000);
    expect(slice).toContain('resolveStudentsForTeacher');
    expect(slice).toContain('Student not owned by caller');
  });

  it('REGRESSION: export_student_report reuses the report pipeline + inherits its 403 gate', async () => {
    const src = await readEdgeSource();
    const handlerStart = src.indexOf('async function handleExportStudentReport');
    expect(handlerStart).toBeGreaterThan(-1);
    const slice = src.slice(handlerStart, handlerStart + 1500);
    // It calls the inner report handler and short-circuits on a non-ok response.
    expect(slice).toContain('handleGetStudentMasteryReport(body, origin)');
    expect(slice).toContain('if (!inner.ok) return inner');
  });

  it('REGRESSION: all 3 Wave C handlers are READ-ONLY — no write/XP/score perturbation (P1/P2/P4)', async () => {
    // The pure-logic suites above prove the *shaping* is display-only, but they
    // cannot see the Edge body. Pin here that none of the three Wave C handler
    // bodies performs a DB write or touches the scoring/XP economy. A future
    // refactor that tried to (e.g.) "also bump a counter" or re-derive a score
    // inside the report path would trip this guard, not silently pass the
    // frozen-reference tests. mastery = BKT p_know verbatim; accuracy = a pure
    // correct/total readout — neither ever writes back.
    const src = await readEdgeSource();
    const HANDLERS = [
      'async function handleGetStudentMasteryReport',
      'async function handleGetClassMasteryBloomSummary',
      'async function handleExportStudentReport',
      // shaping/read helpers the handlers delegate to
      'function aggregateBloomDistribution',
      'function shapeMasterySummary',
      'async function readStudentConceptMastery',
      'async function readStudentBloomResponses',
      'async function readStudentRecentActivity',
    ];
    // Forbidden tokens: any DB mutation or any scoring/XP arithmetic. These must
    // not appear anywhere inside a Wave C handler/helper body.
    const FORBIDDEN = [
      '.insert(',
      '.update(',
      '.upsert(',
      '.delete(',
      'atomic_quiz_profile_update',
      'xp_earned',
      'xp_total',
      'quiz_per_correct',
      'quiz_high_score_bonus',
      'quiz_perfect_bonus',
    ];
    for (const sig of HANDLERS) {
      const start = src.indexOf(sig);
      expect(start, `${sig} should exist in the Edge source`).toBeGreaterThan(-1);
      // Body = from the signature to the next top-level `\nasync function ` /
      // `\nfunction ` (or EOF) — generous upper bound, then trimmed at the next
      // top-level declaration so we only inspect THIS handler's body.
      const afterSig = src.slice(start + sig.length);
      const nextAsync = afterSig.indexOf('\nasync function ');
      const nextFn = afterSig.indexOf('\nfunction ');
      const ends = [nextAsync, nextFn].filter((n) => n > -1);
      const end = ends.length > 0 ? Math.min(...ends) : afterSig.length;
      const body = afterSig.slice(0, end);
      for (const tok of FORBIDDEN) {
        expect(
          body.includes(tok),
          `${sig} must be read-only — found forbidden write/scoring token "${tok}"`,
        ).toBe(false);
      }
    }
  });
});
