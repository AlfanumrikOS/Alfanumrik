#!/usr/bin/env node
/**
 * Auth Flow Guard — Pre-deploy Check
 *
 * Runs before every production build (apps/host/package.json:
 * `node ../../scripts/auth-guard.js && next build --webpack`).
 * Blocks deployment if core auth files are broken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2026-07-28 CI-GATE FORENSIC REPAIR — read before editing.
 *
 * This guard was validating STUBS. After the apps/* + packages/* monorepo
 * migration, `apps/host/src/lib/<x>.ts(x)` files became 2-line auto-generated
 * re-export stubs (`export * from '../../../../packages/lib/src/<x>'`):
 *
 *     apps/host/src/lib/AuthContext.tsx     ->    91 bytes  (stub)
 *     packages/lib/src/AuthContext.tsx      -> 41371 bytes  (canonical)
 *     apps/host/src/lib/supabase-admin.ts   ->    94 bytes  (stub)
 *     packages/lib/src/supabase-admin.ts    ->  3908 bytes  (canonical)
 *
 * The P8 "no client-side profile insert" check read the 91-byte stub, matched
 * nothing, and reported PASS forever. Three compounding defects:
 *
 *   1. STUB TARGETING — checks pointed at apps/host/src/lib/*, which contains
 *      no logic at all.
 *   2. SINGLE-LINE REGEX — `\.from\('students'\)\.insert` cannot match this
 *      codebase's actual style, which chains across lines:
 *          supabase
 *            .from('students')
 *            .insert({...})
 *      So even against the canonical file the check was blind.
 *   3. NO VACUITY FLOOR — a missing/empty/stub file silently produced "no
 *      match" == "clean".
 *
 * Repairs, all three of which are structural (not one-file patches):
 *
 *   A. Every check below reads its target from the canonical path directly
 *      (packages/lib/src/*, packages/ui/src/*) and works from EITHER cwd
 *      (repo root or apps/host).
 *   B. All content patterns are multi-line-aware (`\s` spans newlines, and
 *      interleaved // and /* *\/ comments are tolerated).
 *   C. Three fail-loud floors:
 *        - byte floor: any content-scanned file under MIN_CONTENT_BYTES is a
 *          FATAL "guard is reading a stub" error, not a pass;
 *        - scan floor: fewer than MIN_SCANNED_FILES resolved files is FATAL;
 *        - known-bad fixture: every content pattern is executed against an
 *          embedded violating sample at startup and MUST flag it. If a future
 *          refactor breaks a regex, the guard fails instead of going green.
 *
 * 2026-08-04 — P2-3 deleted the entire re-export-stub layer repo-wide (zero
 * `export * from '<canonical>'` stubs remain anywhere under apps/host/src).
 * Point A above originally read "resolveSource() follows stub re-exports to
 * the canonical implementation" — that chain-following machinery is now
 * unreachable (every path this guard scans is already canonical) and has
 * been removed. resolveSource() is now a plain file reader. The vacuity
 * floors in point C are untouched and still guard against any future
 * regression (stub or otherwise) that would make a check read empty/missing
 * content.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Checks:
 *   0.  Self-test: every detection pattern flags its known-bad fixture
 *   1.  apps/host/src/middleware.ts must NOT exist (Next.js 16 uses proxy.ts)
 *   2.  apps/host/src/proxy.ts MUST exist, export `proxy`, set security headers
 *   3.  login page must exist
 *   4.  auth/callback route must exist
 *   5.  auth/confirm route must exist
 *   6.  AuthScreen (canonical, packages/ui) has no client-side profile inserts
 *   7.  AuthContext (canonical, packages/lib) has no client-side profile inserts
 *   8.  api/auth/session route must exist
 *   9.  AuthScreen has all 4 role tabs (Student, Teacher, Parent, School)
 *  10.  identity/constants.ts has all 4 roles
 *  11.  P8: supabase-admin canonical is the real service-role client
 *  12.  P8: supabase-admin is server-only ('use client' / NEXT_PUBLIC_ leak)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const errors = [];

console.log('🔒 Auth Flow Guard — Pre-deploy Check');
console.log('');

// ── Repo-root resolution (works from repo root OR apps/host) ─────────────────
function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, 'packages', 'lib', 'src')) &&
      fs.existsSync(path.join(dir, 'apps', 'host', 'src'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const ROOT = findRepoRoot(process.cwd()) || findRepoRoot(path.join(__dirname, '..'));
if (!ROOT) {
  console.error(
    '❌ FATAL: could not locate the monorepo root (needs packages/lib/src + apps/host/src).',
  );
  console.error(`   cwd=${process.cwd()} scriptDir=${__dirname}`);
  console.error('   Failing CLOSED: an unresolvable root means every check below would be vacuous.');
  process.exit(1);
}
console.log(`repo root: ${ROOT}`);

// ── Vacuity floors ──────────────────────────────────────────────────────────
// A re-export stub is ~90-120 bytes. Anything under this is not an
// implementation and must never be accepted as "scanned clean".
const MIN_CONTENT_BYTES = 500;
// Number of content-scanned (not merely existence-checked) files we must
// successfully resolve. If path drift collapses this, the guard fails.
const MIN_SCANNED_FILES = 4;

let scannedFiles = 0;

function fail(msg) {
  errors.push(msg);
  console.error(msg);
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

/**
 * Read a source file's content for content-scanning.
 *
 * Returns { file, source } or null when unresolvable.
 *
 * Historical note: this used to also transparently follow auto-generated
 * re-export stubs (`export * from '<relative path>'`) to their canonical
 * implementation, because every apps/host/src/lib/* file was once a ~90-byte
 * stub. P2-3 (2026-08) deleted that stub layer repo-wide — every path this
 * guard scans below is already the canonical implementation file, so the
 * chain-following branch was unreachable dead code and has been removed. If
 * a stub-shaped indirection layer is ever reintroduced, MIN_CONTENT_BYTES
 * below still fails the build loudly (see loadForScan) rather than passing
 * vacuously — that floor does not depend on this function "seeing through"
 * the indirection.
 */
function resolveSource(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  const source = fs.readFileSync(abs, 'utf-8');
  return { file: relPath, source };
}

/**
 * Resolve a file that will be CONTENT-scanned. Enforces the byte floor and
 * an optional positive marker that a stub/empty file cannot satisfy.
 */
function loadForScan(relPath, label, positiveMarker) {
  const resolved = resolveSource(relPath);
  if (!resolved) {
    fail(`❌ FATAL: ${label} not found at ${relPath} (root=${ROOT}). Failing CLOSED — the check cannot run.`);
    return null;
  }
  if (resolved.source.length < MIN_CONTENT_BYTES) {
    fail(
      `❌ FATAL: ${label} resolved to ${resolved.file} at only ${resolved.source.length} bytes ` +
        `(floor ${MIN_CONTENT_BYTES}). That is a re-export stub or an empty file — the guard would ` +
        `be validating nothing. This is the exact vacuous-gate bug this script was repaired for.`,
    );
    return null;
  }
  if (positiveMarker && !positiveMarker.re.test(resolved.source)) {
    fail(
      `❌ FATAL: ${label} (${resolved.file}) does not contain the expected marker ` +
        `${positiveMarker.name}. Either the file moved again or the guard is reading the wrong ` +
        `file. Failing CLOSED rather than reporting a vacuous pass.`,
    );
    return null;
  }
  scannedFiles++;
  console.log(`  scanned ${label}: ${resolved.file} (${resolved.source.length} bytes)`);
  return resolved.source;
}

// ── Detection patterns (MULTI-LINE aware) ───────────────────────────────────
// supabase-js chains `.insert(...)` / `.upsert(...)` directly onto `.from(...)`,
// but this codebase formats each link on its own line and interleaves comments.
// `\s` spans newlines; the comment alternation absorbs // and /* */ blocks.
const GAP = String.raw`(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*`;
const PROFILE_TABLES = 'students|teachers|guardians|school_admins';

const PATTERNS = {
  clientProfileInsert: {
    re: new RegExp(
      String.raw`\.from\(${GAP}['"\`](?:${PROFILE_TABLES})['"\`]${GAP}\)${GAP}\.(?:insert|upsert)${GAP}\(`,
    ),
    // Known-bad fixture: MUST be flagged. Uses this repo's real multi-line style.
    knownBad: [
      "const { error } = await supabase\n  .from('students')\n  // create the profile row\n  .insert({ auth_user_id: user.id });",
      "await supabase.from('guardians').upsert({ id })",
    ],
    knownGood: [
      "const { data } = await supabase\n  .from('students')\n  .select('*')\n  .eq('id', id);",
      "await fetch('/api/auth/bootstrap', { method: 'POST' })",
    ],
  },
  publicServiceRoleLeak: {
    // Built from fragments so the flagged identifier shape never appears
    // verbatim in this file (see the fixture note below).
    re: new RegExp('NEXT_' + 'PUBLIC_[A-Z0-9_]*(?:SERVICE' + '_ROLE|SECRET|PRIVATE_KEY)'),
    // Fixture is assembled at runtime so the forbidden identifier never appears
    // verbatim in this file — otherwise this guard would trip the repo's own
    // secret scanners with a permanent false positive.
    knownBad: ['const k = process.env.' + 'NEXT_PUBLIC_SUPABASE_' + 'SERVICE' + '_ROLE_KEY;'],
    knownGood: ['const k = process.env.' + 'SUPABASE_' + 'SERVICE' + '_ROLE_KEY;'],
  },
  useClientDirective: {
    re: /^\s*['"]use client['"]/m,
    knownBad: ["'use client';\nexport const x = 1;"],
    knownGood: ['export const x = 1;'],
  },
};

// ── Check 0: pattern self-test (anti-vacuity) ───────────────────────────────
// Every detector is proven live against a known-bad sample BEFORE it is used.
// A regex that has silently stopped matching now fails the build instead of
// waving violations through.
for (const [name, p] of Object.entries(PATTERNS)) {
  for (const bad of p.knownBad) {
    if (!p.re.test(bad)) {
      fail(
        `❌ FATAL: detector "${name}" FAILED its known-bad self-test. The pattern no longer ` +
          `matches a real violation, so every check using it would pass vacuously.`,
      );
    }
  }
  for (const good of p.knownGood || []) {
    if (p.re.test(good)) {
      fail(`❌ FATAL: detector "${name}" false-positives on a known-good sample.`);
    }
  }
}
if (errors.length === 0) {
  console.log(`  self-test: ${Object.keys(PATTERNS).length} detectors verified against fixtures`);
}

// ── Check 1: middleware.ts must NOT exist ───────────────────────────────────
for (const legacy of ['apps/host/src/middleware.ts', 'src/middleware.ts']) {
  if (exists(legacy)) {
    fail(`❌ FATAL: ${legacy} exists! Next.js 16 only allows proxy.ts. Delete it.`);
  }
}

// ── Check 2: proxy.ts MUST exist and export proxy function ──────────────────
const proxyContent = loadForScan('apps/host/src/proxy.ts', 'proxy.ts', {
  name: 'export function proxy',
  re: /export\s+(?:async\s+)?function\s+proxy\s*\(/,
});
if (proxyContent !== null) {
  if (!/export\s+async\s+function\s+proxy\s*\(/.test(proxyContent)) {
    fail('❌ FATAL: apps/host/src/proxy.ts does not export an async `proxy` function. Auth routing is broken.');
  }
  if (!proxyContent.includes('X-Frame-Options')) {
    fail('❌ FATAL: apps/host/src/proxy.ts is missing security headers (X-Frame-Options).');
  }
}

// ── Checks 3-5, 8: required auth route files ────────────────────────────────
const REQUIRED_FILES = [
  ['apps/host/src/app/login/page.tsx', 'Users cannot log in.'],
  ['apps/host/src/app/auth/callback/route.ts', 'Email verification is broken.'],
  ['apps/host/src/app/auth/confirm/route.ts', 'Token-hash email flows are broken.'],
  ['apps/host/src/app/api/auth/session/route.ts', 'Session management is broken.'],
];
for (const [rel, why] of REQUIRED_FILES) {
  if (!exists(rel)) fail(`❌ FATAL: ${rel} is missing! ${why}`);
}

// ── Check 6 + 9: AuthScreen (canonical shipped copy in packages/ui) ─────────
// apps/host/src/app/login/page.tsx imports @alfanumrik/ui/auth/AuthScreen.
const authScreenContent = loadForScan('packages/ui/src/auth/AuthScreen.tsx', 'AuthScreen', {
  name: 'role tab config',
  re: /label:\s*t\(/,
});
if (authScreenContent !== null) {
  if (PATTERNS.clientProfileInsert.re.test(authScreenContent)) {
    fail('❌ FATAL: AuthScreen.tsx has client-side profile inserts. This bypasses RLS — violates P8.');
  }
  // 2026-06-16: role-tab labels became bilingual, so `label: 'Student'` is now
  // `label: t('Student', 'विद्यार्थी')`. We match the English term inside t().
  // (The School tab's key is `institution_admin`; its English label is `School`.)
  for (const role of ['Student', 'Teacher', 'Parent', 'School']) {
    if (!authScreenContent.includes(`label: t('${role}'`)) {
      fail(`❌ FATAL: AuthScreen.tsx is missing the ${role} role tab.`);
    }
  }
}

// ── Check 7: AuthContext (canonical implementation in packages/lib) ─────────
// This is the check that was reading a 91-byte stub for the whole monorepo era.
const authContextContent = loadForScan('packages/lib/src/AuthContext.tsx', 'AuthContext', {
  name: 'createContext/AuthProvider',
  re: /createContext|AuthProvider/,
});
if (authContextContent !== null) {
  if (PATTERNS.clientProfileInsert.re.test(authContextContent)) {
    fail('❌ FATAL: AuthContext.tsx has client-side profile inserts. This bypasses RLS — violates P8.');
  }
}

// ── Check 10: identity/constants.ts has all 4 roles ─────────────────────────
const identityContent = loadForScan('packages/lib/src/identity/constants.ts', 'identity/constants', {
  name: 'role literals',
  re: /'student'/,
});
if (identityContent !== null) {
  for (const role of ['student', 'teacher', 'parent', 'institution_admin']) {
    if (!identityContent.includes(`'${role}'`)) {
      fail(`❌ FATAL: identity/constants.ts is missing role: ${role}`);
    }
  }
}

// ── Checks 11-12: P8 service-role admin client (canonical, NOT the stub) ────
// The positive marker is what makes this un-vacuous: a stub or an emptied file
// cannot contain `process.env.SUPABASE_SERVICE_ROLE_KEY`, so the check fails
// loudly instead of "finding no violations".
const adminClientContent = loadForScan('packages/lib/src/supabase-admin.ts', 'supabase-admin', {
  name: 'process.env.SUPABASE_SERVICE_ROLE_KEY',
  re: /process\.env\.SUPABASE_SERVICE_ROLE_KEY/,
});
if (adminClientContent !== null) {
  if (PATTERNS.publicServiceRoleLeak.re.test(adminClientContent)) {
    fail(
      '❌ FATAL: supabase-admin.ts references a NEXT_PUBLIC_* service-role/secret variable. ' +
        'The service role key would be inlined into the client bundle — violates P8/P13.',
    );
  }
  if (PATTERNS.useClientDirective.re.test(adminClientContent)) {
    fail(
      "❌ FATAL: supabase-admin.ts carries a 'use client' directive. The RLS-bypassing service-role " +
        'client must never be a client module — violates P8.',
    );
  }
  if (!/autoRefreshToken:\s*false/.test(adminClientContent) || !/persistSession:\s*false/.test(adminClientContent)) {
    fail(
      '❌ FATAL: supabase-admin.ts no longer disables autoRefreshToken/persistSession. ' +
        'A service-role client must not persist or refresh sessions.',
    );
  }
}

// The apps/host stub must stay a stub — if real logic appears there it has
// escaped the canonical file and this guard's scan of packages/.
const adminStub = path.join(ROOT, 'apps/host/src/lib/supabase-admin.ts');
if (fs.existsSync(adminStub)) {
  const stubSrc = fs.readFileSync(adminStub, 'utf-8');
  if (stubSrc.length > MIN_CONTENT_BYTES && !/^\s*export\s+\*\s+from/m.test(stubSrc)) {
    fail(
      '❌ FATAL: apps/host/src/lib/supabase-admin.ts is no longer a re-export stub. ' +
        'A second service-role client implementation has appeared outside packages/lib — violates P8.',
    );
  }
}

// ── Check: scan floor (anti-vacuity) ────────────────────────────────────────
if (scannedFiles < MIN_SCANNED_FILES) {
  fail(
    `❌ FATAL: only ${scannedFiles} file(s) were content-scanned (floor ${MIN_SCANNED_FILES}). ` +
      'Path drift has collapsed this guard into a no-op. Refusing to report success.',
  );
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log('');
if (errors.length > 0) {
  console.error(`\n🚨 Auth Flow Guard FAILED — ${errors.length} critical issue(s) found.\n`);
  console.error('Fix all issues above before deploying.\n');
  process.exit(1);
}

console.log(
  `✅ Auth Flow Guard — All checks passed (${scannedFiles} files content-scanned, ` +
    `${Object.keys(PATTERNS).length} detectors self-tested). Safe to deploy.\n`,
);
