import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard — UI barrel single-resolution + SheetModal scroll/stacking fix.
 *
 * Background (Batch 2 Increment 0): `packages/ui/src/ui/` previously shipped a
 * stale `index.tsx` that was a TWIN of `wonder-blocks.tsx`. webpack resolves a
 * bare directory import to `index.tsx` while tsc (moduleResolution) resolves it
 * to `index.ts` — so `@alfanumrik/ui/ui` resolved to DIFFERENT files under the
 * build vs. the type-checker (a build-vs-typecheck split-brain across the ~134
 * `@alfanumrik/ui/ui` importers). The consequence: the runtime shipped a
 * SheetModal missing its `min-h-0` internal-scroll fix that tsc-checked source
 * appeared to have. `index.tsx` (and a dead `card.tsx`) were deleted so only the
 * barrel `index.ts` remains and both toolchains resolve the same file.
 *
 * These two guards prevent silent recurrence:
 *   1. No directory that is a barrel-resolution target may contain BOTH
 *      `index.ts` and `index.tsx` (pinned hard for `packages/ui/src/ui/`).
 *   2. The `SheetModal` in `wonder-blocks.tsx` (the file that now actually
 *      ships) must retain the `min-h-0` (internal scroll under `max-h-[80vh]`)
 *      and `isolate` (stacking-context) classes.
 *
 * cwd when vitest runs is `apps/host` (root `npm test` → `--workspaces`), so the
 * shared package sits at `../../packages/...`. `repoPath` also tolerates a
 * repo-root cwd for direct `npx vitest run` invocations.
 */

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

/**
 * Recursively collect every directory (under `root`) that contains an
 * `index.ts` and/or `index.tsx`, returning a map dir -> { ts, tsx }.
 * Skips the usual non-source noise so the walk stays fast and meaningful.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.git',
  '.turbo',
  '__snapshots__',
]);

function collectIndexDirs(
  root: string,
  acc: Map<string, { ts: boolean; tsx: boolean }> = new Map(),
): Map<string, { ts: boolean; tsx: boolean }> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return acc;
  }

  const hasTs = entries.includes('index.ts');
  const hasTsx = entries.includes('index.tsx');
  if (hasTs || hasTsx) {
    acc.set(root, { ts: hasTs, tsx: hasTsx });
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = resolve(root, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) collectIndexDirs(full, acc);
  }

  return acc;
}

describe('UI barrel single-resolution (no index.ts/index.tsx twin)', () => {
  it('packages/ui/src/ui/ has the barrel index.ts and NOT a webpack-shadowing index.tsx', () => {
    const uiDir = repoPath('packages/ui/src/ui');
    // Non-vacuous: the directory itself must exist, else the guard means nothing.
    expect(existsSync(uiDir), `${uiDir} should exist`).toBe(true);

    expect(
      existsSync(resolve(uiDir, 'index.ts')),
      'packages/ui/src/ui/index.ts (the barrel) must exist',
    ).toBe(true);

    expect(
      existsSync(resolve(uiDir, 'index.tsx')),
      'packages/ui/src/ui/index.tsx must NOT exist — it re-introduces the ' +
        'webpack(.tsx)-vs-tsc(.ts) resolution split for @alfanumrik/ui/ui importers',
    ).toBe(false);

    // Legacy leftovers that were removed in the same increment must stay gone.
    expect(
      existsSync(resolve(uiDir, 'card.tsx')),
      'packages/ui/src/ui/card.tsx was deleted (0 consumers) — must stay gone',
    ).toBe(false);
  });

  it('no barrel-resolution target under the shared packages has BOTH index.ts and index.tsx', () => {
    // These src roots back the `@alfanumrik/ui/*` and `@alfanumrik/lib/*`
    // subpath imports, where the webpack-vs-tsc directory-resolution split bites.
    const roots = ['packages/ui/src', 'packages/lib/src']
      .map(repoPath)
      .filter((p) => existsSync(p));

    // Non-vacuous: we must actually have roots to scan.
    expect(roots.length, 'expected at least packages/ui/src to exist').toBeGreaterThan(0);

    const indexDirs = new Map<string, { ts: boolean; tsx: boolean }>();
    for (const root of roots) collectIndexDirs(root, indexDirs);

    // Non-vacuous: the walk must have found the known barrel(s), otherwise the
    // scan silently passed by reading nothing.
    expect(
      indexDirs.size,
      'walk found no index.ts/index.tsx anywhere — scan is vacuous',
    ).toBeGreaterThan(0);
    const uiBarrel = repoPath('packages/ui/src/ui');
    expect(
      indexDirs.has(uiBarrel),
      'the packages/ui/src/ui barrel should have been discovered by the walk',
    ).toBe(true);

    const twins = [...indexDirs.entries()]
      .filter(([, kinds]) => kinds.ts && kinds.tsx)
      .map(([dir]) => dir);

    expect(
      twins,
      `these directories have BOTH index.ts and index.tsx, re-introducing the ` +
        `webpack(.tsx)-vs-tsc(.ts) resolution split-brain: ${twins.join(', ')}`,
    ).toEqual([]);
  });
});

describe('SheetModal scroll/stacking fix present in the file that ships (wonder-blocks.tsx)', () => {
  const wonderBlocksPath = repoPath('packages/ui/src/ui/wonder-blocks.tsx');

  it('wonder-blocks.tsx exists and is the canonical single source', () => {
    expect(existsSync(wonderBlocksPath), `${wonderBlocksPath} should exist`).toBe(true);
  });

  it('SheetModal retains min-h-0 (internal scroll under max-h-[80vh]) and isolate (stacking)', () => {
    const source = readFileSync(wonderBlocksPath, 'utf8');
    // Non-vacuous: real, non-trivial file content.
    expect(source.length).toBeGreaterThan(1000);

    const sheetStart = source.indexOf('function SheetModal');
    expect(sheetStart, 'SheetModal component must exist in wonder-blocks.tsx').toBeGreaterThan(-1);

    // Bound the assertion to the SheetModal block so a stray class elsewhere
    // in this 56 kB file can't satisfy the guard vacuously.
    const afterStart = source.slice(sheetStart);
    const nextExport = afterStart.indexOf('\nexport function ', 'export function SheetModal'.length);
    const sheetBlock = nextExport > -1 ? afterStart.slice(0, nextExport) : afterStart;

    expect(
      sheetBlock.includes('max-h-[80vh]'),
      'SheetModal must cap height at max-h-[80vh] (the scroll container)',
    ).toBe(true);
    expect(
      sheetBlock.includes('min-h-0'),
      'SheetModal must keep min-h-0 so its content scrolls internally under max-h-[80vh]',
    ).toBe(true);
    expect(
      sheetBlock.includes('isolate'),
      'SheetModal must keep the isolate stacking-context class',
    ).toBe(true);
  });
});
