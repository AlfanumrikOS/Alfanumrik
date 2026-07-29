#!/usr/bin/env node
/**
 * lint-package.mjs — workspace lint runner with an anti-vacuity floor.
 *
 * Why this exists (CI-gate forensic audit, 2026-07-28):
 *   The root `npm run lint` is `npm run lint --workspaces --if-present`.
 *   `packages/lib` and `packages/ui` declared NO `lint` script, so
 *   `--if-present` silently skipped them and 900+ production TypeScript files
 *   — including the canonical xp-rules.ts, cognitive-engine.ts, razorpay.ts and
 *   AuthContext.tsx — were never linted by any CI job. The gate was green
 *   because it checked nothing.
 *
 *   A bare `eslint src/ --ext .ts,.tsx` would fix the coverage hole but would
 *   reintroduce the same failure class the moment a path moves again: ESLint
 *   with `--no-error-on-unmatched-pattern` (or a future flat-config default)
 *   can happily lint ZERO files and exit 0. So this runner asserts a POSITIVE
 *   floor: it must actually lint at least `--min-files N` files, otherwise it
 *   fails loudly with a distinct "VACUOUS LINT" message.
 *
 * Usage:
 *   node ../../scripts/lint-package.mjs --dir src --min-files 300
 *
 * Exit codes:
 *   0  lint ran over >= min-files and found no errors
 *   1  lint errors found
 *   2  vacuity floor breached (linted fewer than min-files) or config failure
 */

import { ESLint } from 'eslint';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const dir = arg('--dir', 'src');
const minFiles = Number(arg('--min-files', '1'));
const cwd = process.cwd();
const target = resolve(cwd, dir);

if (!Number.isFinite(minFiles) || minFiles < 1) {
  console.error(`VACUOUS LINT GUARD: --min-files must be a positive integer (got "${minFiles}").`);
  process.exit(2);
}

if (!existsSync(target)) {
  console.error(`VACUOUS LINT GUARD: lint target "${dir}" does not exist under ${cwd}.`);
  console.error('A moved/renamed source root must fail the gate, not silently lint nothing.');
  process.exit(2);
}

const eslint = new ESLint({
  cwd,
  extensions: ['.ts', '.tsx'],
  errorOnUnmatchedPattern: true,
});

let results;
try {
  results = await eslint.lintFiles([dir]);
} catch (err) {
  console.error(`VACUOUS LINT GUARD: ESLint failed to run over "${dir}".`);
  console.error(String(err && err.message ? err.message : err));
  process.exit(2);
}

// ── Anti-vacuity floor ───────────────────────────────────────────────────────
// `results.length` is the number of files ESLint actually opened and parsed.
// If that collapses (path drift, bad --ext, empty glob) the gate MUST fail.
if (results.length < minFiles) {
  console.error('');
  console.error('=== VACUOUS LINT DETECTED ===');
  console.error(
    `ESLint linted only ${results.length} file(s) under "${dir}" (floor: ${minFiles}).`,
  );
  console.error('This means the lint gate is checking (almost) nothing and would have');
  console.error('passed green regardless of code quality. Refusing to report success.');
  console.error('Fix the lint target / extensions, or lower --min-files DELIBERATELY');
  console.error('in package.json if the package genuinely shrank.');
  console.error('');
  process.exit(2);
}

const formatter = await eslint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output.trim()) console.log(output);

const errorCount = results.reduce((n, r) => n + r.errorCount, 0);
const warningCount = results.reduce((n, r) => n + r.warningCount, 0);

console.log(
  `lint: ${results.length} files linted under ${dir} (floor ${minFiles}) — ` +
    `${errorCount} error(s), ${warningCount} warning(s)`,
);

process.exit(errorCount > 0 ? 1 : 0);
