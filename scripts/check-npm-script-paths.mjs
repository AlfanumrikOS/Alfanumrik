#!/usr/bin/env node
/**
 * scripts/check-npm-script-paths.mjs — npm-script path resolution canary.
 *
 * WHY THIS EXISTS
 * ---------------
 * In a monorepo, `npm run <x> -w apps/host` executes with cwd = `apps/host`,
 * NOT the repo root. A script body written as `node scripts/foo.js` therefore
 * resolves against `apps/host/scripts/foo.js`. When the real file lives at the
 * REPO ROOT (`scripts/foo.js`), that script is dead on arrival — it fails with
 * MODULE_NOT_FOUND / "No such file or directory" the first time anyone runs it.
 *
 * Nothing in the toolchain catches this. `npm run type-check` only compiles
 * source files; `npm run lint` only lints `apps/host/src`; a package.json is
 * just JSON, so no compiler ever reads the script bodies. The failure surfaces
 * only when a human runs the script, which for maintenance/ops scripts can be
 * months later. 22 declarations in `apps/host/package.json` had rotted this way
 * (each missing a `../../` prefix) before this gate existed.
 *
 * WHAT IT CHECKS
 * --------------
 * For every package.json in the workspace (repo root + each `workspaces` glob),
 * every `scripts` entry is tokenized and each file-ish token (ending in .js,
 * .mjs, .cjs, .ts, .mts, .cts, .sh) is resolved relative to the DECLARING
 * package's own directory — the cwd npm will actually use. Any token that does
 * not resolve to an existing file is reported and the process exits 1.
 *
 * `cd <dir> && ...` is honored: tokens after a `cd` resolve against the new
 * base, which is how `apps/host`'s `test:e2e` scripts legitimately reach
 * repo-root `e2e/` specs.
 *
 * WHAT IT DELIBERATELY IGNORES
 * ----------------------------
 * Flags (`--ext`), globs (`src/**\/*.ts`), extension lists (`.ts,.tsx`), shell
 * variables (`$FOO`), and the inline-code argument of `node -e` / `-p`, none of
 * which are filesystem paths. See `isPathish()` for the full rule set. This
 * gate is intentionally conservative: it would rather miss an exotic token than
 * fail CI on a non-path.
 *
 * Run via `npm run check:script-paths`. Enforced in CI by the `quality` job in
 * .github/workflows/ci.yml (blocking, no continue-on-error).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extensions that make a token worth resolving against the filesystem. */
const PATHISH_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.sh'];

/** Shell operators that separate one command from the next. */
const SEGMENT_SEPARATORS = new Set(['&&', '||', ';', '|', '&']);

/**
 * Flags whose FOLLOWING argument is inline source code, not a path
 * (`node -e "require('fs')…"`). Scanning stops at these within a segment.
 */
const INLINE_CODE_FLAGS = new Set(['-e', '--eval', '-p', '--print']);

/**
 * Tokenize a shell-ish script body, respecting single and double quotes so that
 * a quoted argument containing spaces (`-g "public surfaces"`) stays one token.
 * Quote characters are stripped from the emitted token.
 */
function tokenize(body) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasContent = false;

  const flush = () => {
    if (hasContent) tokens.push(current);
    current = '';
    hasContent = false;
  };

  for (const char of body) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      hasContent = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
    hasContent = true;
  }
  flush();
  return tokens;
}

/** Split a token stream into command segments on shell operators. */
function splitSegments(tokens) {
  const segments = [];
  let current = [];
  for (const token of tokens) {
    if (SEGMENT_SEPARATORS.has(token)) {
      segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  segments.push(current);
  return segments.filter((segment) => segment.length > 0);
}

/**
 * Decide whether a token should be resolved as a filesystem path.
 * Conservative by design — see the module header.
 */
function isPathish(token) {
  // Flags and `--opt=value` forms.
  if (token.startsWith('-')) return false;
  // Globs are not single files.
  if (token.includes('*') || token.includes('?')) return false;
  // Extension lists such as the `.ts,.tsx` argument to `--ext`.
  if (token.includes(',')) return false;
  // Shell/env interpolation — value is unknown at lint time.
  if (token.includes('$')) return false;
  // Inline env assignment prefix (`RAG_EVAL_THRESHOLD=0.80`).
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return false;

  const ext = path.extname(token);
  if (!PATHISH_EXTENSIONS.includes(ext)) return false;

  // A bare extension (`.ts`) is not a path; require an actual basename.
  const base = path.basename(token, ext);
  if (base === '' || base === '.') return false;

  return true;
}

/** Collect every package.json to inspect: the repo root plus each workspace. */
function collectPackageJsonPaths() {
  const rootPkgPath = path.join(REPO_ROOT, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  const found = new Set([rootPkgPath]);

  for (const pattern of rootPkg.workspaces ?? []) {
    if (pattern.endsWith('/*')) {
      const parent = path.join(REPO_ROOT, pattern.slice(0, -2));
      if (!fs.existsSync(parent)) continue;
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(parent, entry.name, 'package.json');
        if (fs.existsSync(candidate)) found.add(candidate);
      }
    } else {
      const candidate = path.join(REPO_ROOT, pattern, 'package.json');
      if (fs.existsSync(candidate)) found.add(candidate);
    }
  }

  return [...found].sort();
}

/** Check one script body. Returns an array of failure records. */
function checkScriptBody(pkgDir, scriptName, body, pkgRelPath) {
  const failures = [];
  // npm runs each script with cwd = the declaring package's directory.
  let baseDir = pkgDir;

  for (const segment of splitSegments(tokenize(body))) {
    // `cd <dir>` rebases every subsequent segment.
    const cdIndex = segment.indexOf('cd');
    if (cdIndex !== -1 && segment[cdIndex + 1]) {
      baseDir = path.resolve(baseDir, segment[cdIndex + 1]);
      continue;
    }

    for (const token of segment) {
      // `node -e "<code>"` — everything after this flag is source, not a path.
      if (INLINE_CODE_FLAGS.has(token)) break;
      if (!isPathish(token)) continue;

      const resolved = path.resolve(baseDir, token);
      if (fs.existsSync(resolved)) continue;

      // Produce an actionable hint when the file exists at the repo root —
      // that is the signature of the missing-`../../` monorepo bug.
      const atRepoRoot = path.resolve(REPO_ROOT, token);
      const hint =
        fs.existsSync(atRepoRoot) && atRepoRoot !== resolved
          ? `exists at repo root — prefix with ${path.relative(baseDir, REPO_ROOT)}/`
          : 'no such file anywhere';

      failures.push({
        pkg: pkgRelPath,
        script: scriptName,
        token,
        expected: path.relative(REPO_ROOT, resolved) || '.',
        hint,
      });
    }
  }

  return failures;
}

function main() {
  const failures = [];
  let scriptCount = 0;
  let pkgCount = 0;

  for (const pkgPath of collectPackageJsonPaths()) {
    const pkgDir = path.dirname(pkgPath);
    const pkgRelPath = path.relative(REPO_ROOT, pkgPath) || 'package.json';
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts ?? {};
    pkgCount += 1;

    for (const [scriptName, body] of Object.entries(scripts)) {
      if (typeof body !== 'string') continue;
      scriptCount += 1;
      failures.push(...checkScriptBody(pkgDir, scriptName, body, pkgRelPath));
    }
  }

  if (failures.length === 0) {
    console.log(
      `check:script-paths OK — ${scriptCount} script(s) across ${pkgCount} package.json file(s); ` +
        'every file-ish token resolves from its declaring package directory.'
    );
    return 0;
  }

  console.error(
    `check:script-paths FAILED — ${failures.length} unresolvable path(s) in npm script declarations.\n` +
      'npm runs a script with cwd = the directory of the package.json that declares it.\n'
  );
  for (const f of failures) {
    console.error(`  ${f.pkg}  ->  "${f.script}"`);
    console.error(`      token:    ${f.token}`);
    console.error(`      resolves: ${f.expected}  (does not exist)`);
    console.error(`      hint:     ${f.hint}\n`);
  }
  return 1;
}

process.exit(main());
