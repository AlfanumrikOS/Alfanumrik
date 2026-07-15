// src/__tests__/eval/teacher-skills/run-eval.test.ts
//
// Teacher-skills eval harness — pure-assembler + report tests. All deps are
// FAKES (injected) — no DB, no LLM, no network, no file writes except the
// writeReport test which targets a temp dir.
//
// Pins:
//   - P13 gate: a PII-shaped key anywhere → REVIEW, zero criteria evaluated,
//     judge NEVER invoked for that artifact;
//   - deterministic-first: a criterion with a registered check is decided
//     mechanically and NEVER reaches the judge (REG-54 oracle pattern);
//   - --judge off: LLM criteria are `not-judged` → verdict can never be PASS
//     for a rubric with LLM criteria;
//   - malformed judge output (null) → `judge-error` per criterion → REVIEW,
//     not a crash;
//   - conditional criteria skip (not fail) when the artifact doesn't declare
//     the tag; M-bucket criteria skip without a chat response;
//   - report: per-criterion pass rates + per-bucket rollup + per-artifact
//     verdicts (never an aggregate-only score).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { runEval, verdictFor, type EvalArtifact, type InjectedJudge } from '../../../../eval/teacher-skills/harness/run-eval';
import { buildReport, formatSummary, writeReport } from '../../../../eval/teacher-skills/harness/report';
import type { Rubric } from '../../../../eval/teacher-skills/harness/rubric-schema';
import type { DeterministicCheck } from '../../../../eval/teacher-skills/harness/deterministic-checks';

const RUBRIC: Rubric = {
  name: 'test-rubric',
  criteria: [
    { id: 'D1', bucket: 'O — Output', criterion: 'det check', passRequires: 'mechanical', notes: '', conditional: '' },
    { id: 'L1', bucket: 'P — Pedagogy', criterion: 'llm check', passRequires: 'judged', notes: '', conditional: '' },
    { id: 'C1', bucket: 'R — Rigor', criterion: 'conditional check', passRequires: 'when tagged', notes: '', conditional: 'tag-x' },
    { id: 'M1', bucket: 'M — Model Scaffolding', criterion: 'chat check', passRequires: 'chat judged', notes: '', conditional: '' },
  ],
};

const detPass: DeterministicCheck = () => ({ pass: true, explanation: 'mechanically ok' });
const detFail: DeterministicCheck = () => ({ pass: false, explanation: 'mechanically broken' });

const passingJudge: InjectedJudge = async (criteria) =>
  criteria.map((c) => ({ id: c.id, pass: true, explanation: 'judge pass' }));

function artifact(id: string, over: Partial<EvalArtifact> = {}): EvalArtifact {
  return { id, artifact: { grade: '8', ok: true }, chatResponse: null, conditions: [], ...over };
}

describe('runEval — P13 gate', () => {
  it('an artifact with a PII-shaped key is REVIEW, unevaluated, and NEVER sent to the judge', async () => {
    const judge = vi.fn(passingJudge);
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('pii', { artifact: { grade: '8', nested: [{ student_id: 'x' }] } })],
      deterministicChecks: { D1: detPass },
      judge,
    });
    const a = run.artifacts[0];
    expect(a.verdict).toBe('REVIEW');
    expect(a.criteria).toHaveLength(0);
    expect(a.piiGateErrors.join(' ')).toMatch(/student_id/);
    expect(a.reasons.join(' ')).toMatch(/P13 gate/);
    expect(judge).not.toHaveBeenCalled();
  });
});

describe('runEval — deterministic-first (REG-54 oracle pattern)', () => {
  it('a criterion with a registered check never reaches the judge', async () => {
    const judge = vi.fn(passingJudge);
    await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('a1', { chatResponse: 'hello' })],
      deterministicChecks: { D1: detPass },
      judge,
    });
    expect(judge).toHaveBeenCalledTimes(1);
    const judgedIds = judge.mock.calls[0][0].map((c: { id: string }) => c.id);
    expect(judgedIds).toEqual(['L1', 'M1']); // D1 decided mechanically; C1 skipped (no tag)
  });

  it('a deterministic FAIL is authoritative → REVIEW even when the judge passes everything', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('a1', { chatResponse: 'hello' })],
      deterministicChecks: { D1: detFail },
      judge: passingJudge,
    });
    const a = run.artifacts[0];
    expect(a.verdict).toBe('REVIEW');
    const d1 = a.criteria.find((c) => c.id === 'D1');
    expect(d1).toMatchObject({ method: 'deterministic', status: 'fail' });
  });
});

describe('runEval — judge off / judge degraded', () => {
  it('--judge off: LLM criteria are not-judged → verdict is REVIEW, never PASS', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('a1')],
      deterministicChecks: { D1: detPass },
      judge: null,
    });
    const a = run.artifacts[0];
    expect(a.verdict).toBe('REVIEW');
    expect(a.criteria.find((c) => c.id === 'L1')).toMatchObject({ status: 'not-judged', method: 'judge' });
    expect(run.judgeEnabled).toBe(false);
  });

  it('malformed judge output (null) → judge-error per criterion → REVIEW, not a crash', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('a1', { chatResponse: 'hi' })],
      deterministicChecks: { D1: detPass },
      judge: async () => null,
    });
    const a = run.artifacts[0];
    expect(a.verdict).toBe('REVIEW');
    expect(a.criteria.find((c) => c.id === 'L1')).toMatchObject({ status: 'judge-error' });
    expect(a.criteria.find((c) => c.id === 'M1')).toMatchObject({ status: 'judge-error' });
  });

  it('a judge omitting one id marks ONLY that criterion judge-error', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('a1', { chatResponse: 'hi' })],
      deterministicChecks: { D1: detPass },
      judge: async () => [{ id: 'L1', pass: true, explanation: 'ok' }], // M1 omitted
    });
    const a = run.artifacts[0];
    expect(a.criteria.find((c) => c.id === 'L1')).toMatchObject({ status: 'pass' });
    expect(a.criteria.find((c) => c.id === 'M1')).toMatchObject({ status: 'judge-error' });
    expect(a.verdict).toBe('REVIEW');
  });
});

describe('runEval — skips and PASS', () => {
  it('conditional criteria skip (not fail) without the tag and run with it', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [
        artifact('untagged', { chatResponse: 'hi' }),
        artifact('tagged', { chatResponse: 'hi', conditions: ['tag-x'] }),
      ],
      deterministicChecks: { D1: detPass },
      judge: passingJudge,
    });
    expect(run.artifacts[0].criteria.find((c) => c.id === 'C1')).toMatchObject({
      status: 'skipped-conditional',
    });
    expect(run.artifacts[1].criteria.find((c) => c.id === 'C1')).toMatchObject({ status: 'pass' });
  });

  it('M-bucket criteria skip without a chat response', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('nochat')],
      deterministicChecks: { D1: detPass },
      judge: passingJudge,
    });
    expect(run.artifacts[0].criteria.find((c) => c.id === 'M1')).toMatchObject({
      status: 'skipped-no-chat-response',
    });
  });

  it('full PASS: every criterion passes or legitimately skips', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('good', { chatResponse: 'hi', conditions: ['tag-x'] })],
      deterministicChecks: { D1: detPass },
      judge: passingJudge,
    });
    const a = run.artifacts[0];
    expect(a.verdict).toBe('PASS');
    expect(a.reasons).toEqual([]);
  });

  it('verdictFor: zero evaluated criteria is REVIEW, not PASS', () => {
    expect(verdictFor([], []).verdict).toBe('REVIEW');
  });
});

describe('report', () => {
  it('aggregates per-criterion pass rates and per-bucket rollup — never aggregate-only', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [
        artifact('good', { chatResponse: 'hi', conditions: ['tag-x'] }),
        artifact('bad', { chatResponse: 'hi', conditions: ['tag-x'] }),
      ],
      deterministicChecks: {
        D1: (a) => ((a as { grade?: unknown }).grade === '8' ? detPass(a) : detFail(a)),
      },
      judge: async (criteria) =>
        criteria.map((c) => ({ id: c.id, pass: c.id !== 'L1', explanation: 'x' })),
    });
    const report = buildReport(run, () => new Date('2026-07-15T00:00:00Z'));

    expect(report.run).toMatchObject({
      harness: 'teacher-skills-v1',
      rubric: 'test-rubric',
      judge: 'on',
      artifact_count: 2,
      data_source: 'synthetic-fixtures-only',
    });

    const l1 = report.perCriterion.find((s) => s.id === 'L1');
    expect(l1).toMatchObject({ evaluated: 2, passed: 0, failed: 2, passRate: 0 });
    const d1 = report.perCriterion.find((s) => s.id === 'D1');
    expect(d1).toMatchObject({ evaluated: 2, passed: 2, passRate: 1 });

    const pBucket = report.perBucket.find((b) => b.bucket === 'P');
    expect(pBucket).toMatchObject({ evaluated: 2, passed: 0, passRate: 0 });

    // Per-artifact verdicts always present (no aggregate-only view).
    expect(report.artifacts.map((a) => a.verdict)).toEqual(['REVIEW', 'REVIEW']);

    const summary = formatSummary(report);
    expect(summary).toMatch(/Per-artifact verdicts:/);
    expect(summary).toMatch(/Per-criterion/);
    expect(summary).toMatch(/Per-bucket rollup/);
    expect(summary).toMatch(/synthetic-fixtures-only/);
  });

  it('a never-evaluated criterion reports passRate null (no false 100%)', async () => {
    const run = await runEval({
      rubric: RUBRIC,
      artifacts: [artifact('a1')],
      deterministicChecks: { D1: detPass },
      judge: null,
    });
    const report = buildReport(run, () => new Date('2026-07-15T00:00:00Z'));
    expect(report.perCriterion.find((s) => s.id === 'L1')?.passRate).toBeNull();
    expect(report.perCriterion.find((s) => s.id === 'C1')?.passRate).toBeNull();
  });

  it('writeReport writes the JSON artifact to the given dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'teacher-eval-test-'));
    try {
      const run = await runEval({
        rubric: RUBRIC,
        artifacts: [artifact('a1')],
        deterministicChecks: { D1: detPass },
        judge: null,
      });
      const report = buildReport(run, () => new Date('2026-07-15T00:00:00Z'));
      const path = writeReport(report, dir);
      const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
      expect(onDisk.run.rubric).toBe('test-rubric');
      expect(path).toContain('teacher-eval-test-rubric-');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
