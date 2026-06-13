// src/__tests__/eval/rag/import-boundary.test.ts
//
// B1 RAG eval-harness — Task 8 (architect carry-forward, spec B6): MECHANICAL
// guard that the offline read-only eval harness under `eval/**` (and especially
// `eval/rag/harness/**`) is NEVER imported by production/client code. The
// harness is build-time/offline-only — it hits a live DB + Voyage + an offline
// Sonnet judge and must never reach a shipped Next.js bundle.
//
// Two layers of enforcement:
//   1. ESLint `no-restricted-imports` (`.eslintrc.json`, error level) — the
//      primary mechanical gate; fails `npm run lint`.
//   2. THIS test — a source-string scan over src/app, src/components, src/lib
//      that fails if ANY non-test file imports from `eval/...`. Defense-in-depth
//      so the boundary holds even if the lint rule is disabled/misconfigured,
//      and so the breach is visible in the normal `npm test` lane.
//
// Test files under `src/__tests__/eval/**` ARE allowed to import the harness
// (the pure-fn lane drives the harness directly) — they are not scanned here.
//
// Pure/offline lane: filesystem read only, no DB, no network, no LLM. Stays in
// the NORMAL `npm test` lane (this is a `*.test.ts`, NOT `*.integration.test.ts`).
//
// Owner: architect. Enforces: B6 (harness never in a shipped bundle).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

// Repo root: this file is src/__tests__/eval/rag/import-boundary.test.ts → 4 up.
const ROOT = resolve(__dirname, '..', '..', '..', '..');

// Production/client source roots that must never reach into the harness.
const SCANNED_ROOTS = ['src/app', 'src/components', 'src/lib'] as const;

// File extensions that can carry an import.
const SCANNED_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

// Skip test files — they are explicitly ALLOWED to import the harness.
function isTestFile(p: string): boolean {
  return (
    p.includes('__tests__') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
    p.includes('.integration.test.') ||
    p.includes('.integration.spec.')
  );
}

// Matches any ESM/CJS import or re-export whose specifier contains an `eval/`
// path segment — i.e. `from '.../eval/...'`, `import('.../eval/...')`,
// `require('.../eval/...')`. The `[./]eval/` boundary anchor is what stops false
// positives on `retrieval/` (the "eval" inside "retri-eval-" is NOT preceded by
// a `.` or `/`), `medieval/`, etc.
const HARNESS_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"][^'"]*[./]eval\/[^'"]*['"]/g;

function walk(dir: string, acc: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { encoding: 'utf-8' }) as string[];
  } catch {
    return acc; // root may not exist in a partial checkout — skip silently.
  }
  for (const name of entries) {
    const full = resolve(dir, name);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (name === 'node_modules') continue;
      walk(full, acc);
    } else if (SCANNED_EXT.test(name) && !isTestFile(full)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('B1 eval-harness import boundary (Task 8, B6)', () => {
  const offenders: { file: string; line: string }[] = [];

  for (const root of SCANNED_ROOTS) {
    const files = walk(resolve(ROOT, root), []);
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const matches = src.match(HARNESS_IMPORT_RE);
      if (matches) {
        for (const m of matches) {
          offenders.push({ file: file.replace(ROOT, '').replace(/\\/g, '/'), line: m });
        }
      }
    }
  }

  it('no production/client file under src/app, src/components, src/lib imports the eval harness', () => {
    // If this fails, a non-test file imported from `eval/...`. The harness is
    // offline-only and must never reach a shipped bundle (B6). Move the caller
    // into src/__tests__/eval/** (allowed) or remove the import.
    expect(
      offenders,
      `Forbidden eval-harness import(s):\n${offenders
        .map((o) => `  ${o.file}: ${o.line}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('the boundary regex matches a real harness import but NOT a "retrieval/" path (no false positive)', () => {
    // Tripwire on the matcher itself — proves the guard would actually FIRE if a
    // breach were introduced, and that it does not over-match the legitimate
    // `retrieval/ncert-retriever` imports already present in src/lib/ai.
    const breach = `import { runEval } from '../../../../eval/rag/harness/run-eval';`;
    const legit = `import { retrieveNcertChunks } from '../retrieval/ncert-retriever';`;
    expect(new RegExp(HARNESS_IMPORT_RE.source).test(breach)).toBe(true);
    expect(new RegExp(HARNESS_IMPORT_RE.source).test(legit)).toBe(false);
  });
});
