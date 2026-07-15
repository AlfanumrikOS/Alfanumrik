// src/__tests__/eval/teacher-skills/cli.test.ts
//
// Teacher-skills eval harness — CLI exit-code policy tests (mirrors the
// eval/rag cli policy: a COMPLETED run is ALWAYS exit 0 whatever the
// verdicts; exit 2 is reserved for operator/config errors that prevented a
// run from happening at all).
//
// No live API: every run here is --judge off (deterministic-only) or fails
// the config gate BEFORE any AI-layer import (ANTHROPIC_API_KEY stubbed
// empty). `main(argv)` is invoked directly — the module is import-safe
// (require.main guard), and reports are routed to a temp dir via --out.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { main, parseArgs } from '../../../../eval/teacher-skills/harness/cli';

// House convention: 4-up asset path, remapped by the setup.ts fs shim.
const FIXTURES_DIR = resolve(__dirname, '../../../../eval/teacher-skills/fixtures');

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'teacher-eval-cli-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('parseArgs', () => {
  it('parses a full arg set', () => {
    const r = parseArgs(['--rubric', 'quiz-generation', '--input', 'x.json', '--judge', 'off', '--out', outDir]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ rubric: 'quiz-generation', input: 'x.json', judge: false });
  });

  it('rejects missing --rubric / --input, bad --judge values, and unknown args', () => {
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(['--rubric', 'x']).ok).toBe(false);
    expect(parseArgs(['--input', 'x.json']).ok).toBe(false);
    expect(parseArgs(['--rubric', 'x', '--input', 'y', '--judge', 'maybe']).ok).toBe(false);
    expect(parseArgs(['--rubric', 'x', '--input', 'y', '--frobnicate']).ok).toBe(false);
  });

  it('rejects a rubric name that is not a plain basename (no path traversal)', () => {
    expect(parseArgs(['--rubric', '../evil', '--input', 'y']).ok).toBe(false);
    expect(parseArgs(['--rubric', 'UPPER', '--input', 'y']).ok).toBe(false);
  });
});

describe('exit-code policy', () => {
  it('exit 0 on a completed deterministic run over the good fixture', async () => {
    const code = await main([
      '--rubric', 'quiz-generation',
      '--input', resolve(FIXTURES_DIR, 'quiz-generation/good.json'),
      '--judge', 'off',
      '--out', outDir,
    ]);
    expect(code).toBe(0);
    expect(readdirSync(outDir).some((f) => f.startsWith('teacher-eval-quiz-generation-'))).toBe(true);
  });

  it('exit 0 even when every artifact is REVIEW (bad fixture) — REVIEW is a finding, not a failure', async () => {
    const code = await main([
      '--rubric', 'quiz-generation',
      '--input', resolve(FIXTURES_DIR, 'quiz-generation/bad.json'),
      '--judge', 'off',
      '--out', outDir,
    ]);
    expect(code).toBe(0);
  });

  it('exit 0 on a directory input (both fixtures)', async () => {
    const code = await main([
      '--rubric', 'quiz-generation',
      '--input', resolve(FIXTURES_DIR, 'quiz-generation'),
      '--judge', 'off',
      '--out', outDir,
    ]);
    expect(code).toBe(0);
  });

  it('exit 2 on bad args', async () => {
    expect(await main([])).toBe(2);
    expect(await main(['--rubric', 'quiz-generation'])).toBe(2);
  });

  it('exit 2 on an unknown rubric', async () => {
    const code = await main([
      '--rubric', 'no-such-rubric',
      '--input', resolve(FIXTURES_DIR, 'quiz-generation/good.json'),
      '--out', outDir,
    ]);
    expect(code).toBe(2);
  });

  it('exit 2 on a missing input path and on an empty directory', async () => {
    expect(
      await main(['--rubric', 'quiz-generation', '--input', resolve(FIXTURES_DIR, 'nope.json'), '--out', outDir]),
    ).toBe(2);
    const empty = mkdtempSync(join(tmpdir(), 'teacher-eval-empty-'));
    try {
      expect(await main(['--rubric', 'quiz-generation', '--input', empty, '--out', outDir])).toBe(2);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('exit 2 when --judge on without ANTHROPIC_API_KEY (config gate fires BEFORE any AI import)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const code = await main([
      '--rubric', 'quiz-generation',
      '--input', resolve(FIXTURES_DIR, 'quiz-generation/good.json'),
      '--judge', 'on',
      '--out', outDir,
    ]);
    expect(code).toBe(2);
  });
});

describe('deterministic-only runs over the shipped fixtures', () => {
  it('good foxy fixture: FX-O2 deterministic pass; verdict REVIEW only because LLM criteria are not-judged', async () => {
    const code = await main([
      '--rubric', 'foxy-explanation',
      '--input', resolve(FIXTURES_DIR, 'foxy-explanation/good.json'),
      '--judge', 'off',
      '--out', outDir,
    ]);
    expect(code).toBe(0);
    const file = readdirSync(outDir).find((f) => f.startsWith('teacher-eval-foxy-explanation-'));
    expect(file).toBeDefined();
    const report = JSON.parse(readFileSync(join(outDir, file as string), 'utf-8'));
    const a = report.artifacts[0];
    const fxO2 = a.criteria.find((c: { id: string }) => c.id === 'FX-O2');
    expect(fxO2.status).toBe('pass');
    expect(a.verdict).toBe('REVIEW'); // LLM criteria unevaluated with --judge off
    expect(a.reasons.join(' ')).toMatch(/not-judged/);
  });

  it('lesson-plan fixtures: good passes A1/A2a, bad fails both deterministically', async () => {
    const code = await main([
      '--rubric', 'ncert-lesson-planning',
      '--input', resolve(FIXTURES_DIR, 'lesson-plan'),
      '--judge', 'off',
      '--out', outDir,
    ]);
    expect(code).toBe(0);
    const file = readdirSync(outDir).find((f) => f.startsWith('teacher-eval-ncert-lesson-planning-'));
    const report = JSON.parse(readFileSync(join(outDir, file as string), 'utf-8'));
    const byId = Object.fromEntries(
      report.artifacts.map((a: { artifactId: string }) => [a.artifactId, a]),
    );
    const goodA1 = byId['good.json'].criteria.find((c: { id: string }) => c.id === 'A1');
    const badA1 = byId['bad.json'].criteria.find((c: { id: string }) => c.id === 'A1');
    const badA2a = byId['bad.json'].criteria.find((c: { id: string }) => c.id === 'A2a');
    expect(goodA1.status).toBe('pass');
    expect(badA1.status).toBe('fail');
    expect(badA2a.status).toBe('fail');
  });
});
