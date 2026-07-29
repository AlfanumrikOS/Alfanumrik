#!/usr/bin/env node
/**
 * check-workspace-lint-coverage.mjs
 *
 * Closes the `--if-present` hole in the root lint command.
 *
 * The root script is `npm run lint --workspaces --if-present`. `--if-present`
 * means a workspace WITHOUT a `lint` script is silently skipped and the root
 * command still exits 0. On 2026-07-28 that was hiding 935 unlinted production
 * TypeScript files in packages/lib + packages/ui — including the canonical
 * xp-rules.ts, cognitive-engine.ts, razorpay.ts and AuthContext.tsx — because
 * neither package declared a `lint` script. The lint gate was green while
 * checking roughly a quarter of the codebase.
 *
 * Adding the scripts fixes today. This guard fixes tomorrow: it fails if any
 * workspace with a meaningful TypeScript `src/` tree stops declaring `lint`.
 * It runs BEFORE the workspace fan-out, so the hole can never silently reopen.
 *
 * Rule: a workspace must declare `scripts.lint` iff it contains at least
 * MIN_TS_FILES .ts/.tsx files under src/. Self-adjusting — no hardcoded
 * workspace list to go stale.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIN_TS_FILES = 20;

function countTs(dir, cap = 5000, n = 0) {
  if (!existsSync(dir) || n > cap) return n;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) n = countTs(full, cap, n);
    else if (/\.tsx?$/.test(e.name)) n++;
    if (n > cap) return n;
  }
  return n;
}

function expandWorkspaces(globs) {
  const out = [];
  for (const g of globs) {
    if (g.endsWith('/*')) {
      const base = join(ROOT, g.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const e of readdirSync(base, { withFileTypes: true })) {
        if (e.isDirectory() && existsSync(join(base, e.name, 'package.json'))) {
          out.push(join(g.slice(0, -2), e.name));
        }
      }
    } else if (existsSync(join(ROOT, g, 'package.json'))) {
      out.push(g);
    }
  }
  return out;
}

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const workspaces = expandWorkspaces(rootPkg.workspaces || []);

if (workspaces.length === 0) {
  console.error('LINT COVERAGE GUARD: resolved 0 workspaces from the root package.json.');
  console.error('Refusing to proceed — `--workspaces` would then lint nothing.');
  process.exit(1);
}

const missing = [];
const covered = [];
for (const ws of workspaces) {
  const pkgPath = join(ROOT, ws, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    console.error(`LINT COVERAGE GUARD: cannot read ${ws}/package.json`);
    process.exit(1);
  }
  const tsCount = countTs(join(ROOT, ws, 'src'));
  const hasLint = Boolean(pkg.scripts && pkg.scripts.lint);
  if (tsCount >= MIN_TS_FILES && !hasLint) {
    missing.push({ ws, name: pkg.name, tsCount });
  } else if (hasLint) {
    covered.push({ ws, name: pkg.name, tsCount });
  }
}

console.log(
  `lint coverage: ${covered.length}/${workspaces.length} workspace(s) declare a lint script ` +
    `(${covered.map((c) => `${c.name}:${c.tsCount}ts`).join(', ')})`,
);

if (missing.length > 0) {
  console.error('');
  console.error('=== LINT COVERAGE HOLE ===');
  for (const m of missing) {
    console.error(
      `  ${m.name} (${m.ws}) has ${m.tsCount} TypeScript file(s) under src/ but NO "lint" script.`,
    );
  }
  console.error('');
  console.error('`npm run lint --workspaces --if-present` would SILENTLY SKIP it and still');
  console.error('exit 0 — the exact defect that left 935 files unlinted until 2026-07-28.');
  console.error('Add a lint script to each package.json above.');
  process.exit(1);
}
