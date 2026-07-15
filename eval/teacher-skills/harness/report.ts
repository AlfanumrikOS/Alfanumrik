// eval/teacher-skills/harness/report.ts
//
// Teacher-skills eval harness — report ASSEMBLY (pure) + artifact WRITE +
// operator summary. Follows the eval/rag/harness report posture: the harness
// writes its OWN JSON artifact under eval/teacher-skills/reports/
// (gitignored), and the printed summary is per-criterion and per-artifact —
// NEVER an aggregate-only score. Per the upstream guidance (evals/README.md):
// "aggregate pass rates can mask meaningful gaps", so per-criterion pass
// rates across the fixture suite are the primary view, with a per-bucket
// rollup as a secondary lens and a PASS/REVIEW verdict per artifact.
//
// Offline dev/CI tooling only — writes ONLY to the reports dir. Zero DB.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { bucketLetter } from './rubric-schema';
import type { TeacherEvalRun, CriterionStatus } from './run-eval';

// ─── Report shapes ───────────────────────────────────────────────────────────

export interface CriterionStat {
  id: string;
  bucket: string;
  criterion: string;
  /** Artifacts where this criterion produced pass|fail (i.e. was evaluated). */
  evaluated: number;
  passed: number;
  failed: number;
  skipped: number;
  judgeErrors: number;
  notJudged: number;
  /** passed / evaluated; null when never evaluated (no false 100%s). */
  passRate: number | null;
}

export interface BucketStat {
  bucket: string;
  evaluated: number;
  passed: number;
  passRate: number | null;
}

export interface TeacherEvalReport {
  run: {
    harness: 'teacher-skills-v1';
    rubric: string;
    generated_at: string;
    judge: 'on' | 'off';
    artifact_count: number;
    /** Structural PII posture, stated in the artifact itself. */
    data_source: 'synthetic-fixtures-only';
  };
  perCriterion: CriterionStat[];
  perBucket: BucketStat[];
  artifacts: TeacherEvalRun['artifacts'];
}

// ─── Assembly (pure) ─────────────────────────────────────────────────────────

const SKIPPED: ReadonlySet<CriterionStatus> = new Set([
  'skipped-conditional',
  'skipped-no-chat-response',
]);

/**
 * Build the report from a completed run. `now` is injected (default wall
 * clock) so tests stay deterministic.
 */
export function buildReport(run: TeacherEvalRun, now: () => Date = () => new Date()): TeacherEvalReport {
  const perCriterion = new Map<string, CriterionStat>();

  for (const artifact of run.artifacts) {
    for (const c of artifact.criteria) {
      let stat = perCriterion.get(c.id);
      if (!stat) {
        stat = {
          id: c.id,
          bucket: c.bucket,
          criterion: c.criterion,
          evaluated: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          judgeErrors: 0,
          notJudged: 0,
          passRate: null,
        };
        perCriterion.set(c.id, stat);
      }
      if (c.status === 'pass') {
        stat.evaluated++;
        stat.passed++;
      } else if (c.status === 'fail') {
        stat.evaluated++;
        stat.failed++;
      } else if (SKIPPED.has(c.status)) {
        stat.skipped++;
      } else if (c.status === 'judge-error') {
        stat.judgeErrors++;
      } else if (c.status === 'not-judged') {
        stat.notJudged++;
      }
    }
  }

  const criterionStats = Array.from(perCriterion.values()).map((s) => ({
    ...s,
    passRate: s.evaluated > 0 ? s.passed / s.evaluated : null,
  }));

  const bucketMap = new Map<string, { evaluated: number; passed: number }>();
  for (const s of criterionStats) {
    const letter = bucketLetter(s.bucket) ?? '?';
    const b = bucketMap.get(letter) ?? { evaluated: 0, passed: 0 };
    b.evaluated += s.evaluated;
    b.passed += s.passed;
    bucketMap.set(letter, b);
  }
  const perBucket: BucketStat[] = Array.from(bucketMap.entries()).map(([bucket, b]) => ({
    bucket,
    evaluated: b.evaluated,
    passed: b.passed,
    passRate: b.evaluated > 0 ? b.passed / b.evaluated : null,
  }));

  return {
    run: {
      harness: 'teacher-skills-v1',
      rubric: run.rubricName,
      generated_at: now().toISOString(),
      judge: run.judgeEnabled ? 'on' : 'off',
      artifact_count: run.artifacts.length,
      data_source: 'synthetic-fixtures-only',
    },
    perCriterion: criterionStats,
    perBucket,
    artifacts: run.artifacts,
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export const REPORTS_DIR = resolve(__dirname, '..', 'reports');

export function writeReport(report: TeacherEvalReport, dir: string = REPORTS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.run.generated_at.replace(/[:.]/g, '-');
  const path = resolve(dir, `teacher-eval-${report.run.rubric}-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return path;
}

// ─── Operator summary (per-criterion + per-artifact — no aggregate-only) ─────

function fmtRate(v: number | null): string {
  return v === null ? 'n/a  ' : `${(v * 100).toFixed(0).padStart(3)}% `;
}

export function formatSummary(report: TeacherEvalReport): string {
  const lines: string[] = [];
  lines.push('─── teacher-skills eval summary ───');
  lines.push(`rubric     : ${report.run.rubric}`);
  lines.push(`judge      : ${report.run.judge}`);
  lines.push(`artifacts  : ${report.run.artifact_count}`);
  lines.push(`data source: ${report.run.data_source}`);
  lines.push('');
  lines.push('Per-artifact verdicts:');
  for (const a of report.artifacts) {
    lines.push(`  ${a.verdict.padEnd(7)} ${a.artifactId}`);
    for (const r of a.reasons) lines.push(`           - ${r}`);
  }
  lines.push('');
  lines.push('Per-criterion (pass/evaluated across artifacts):');
  for (const s of report.perCriterion) {
    const extras: string[] = [];
    if (s.skipped > 0) extras.push(`${s.skipped} skipped`);
    if (s.notJudged > 0) extras.push(`${s.notJudged} not-judged`);
    if (s.judgeErrors > 0) extras.push(`${s.judgeErrors} judge-error`);
    lines.push(
      `  ${s.id.padEnd(8)} ${fmtRate(s.passRate)} ${s.passed}/${s.evaluated}${extras.length ? ` (${extras.join(', ')})` : ''}`,
    );
  }
  lines.push('');
  lines.push('Per-bucket rollup (secondary lens — per-criterion is the primary view):');
  for (const b of report.perBucket) {
    lines.push(`  ${b.bucket.padEnd(3)} ${fmtRate(b.passRate)} ${b.passed}/${b.evaluated}`);
  }
  return lines.join('\n');
}
