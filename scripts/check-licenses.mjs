#!/usr/bin/env node
/**
 * check-licenses.mjs — production dependency license gate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS REPLACES THE INLINE `license-checker` CALL (CI forensic audit, 2026-07-28)
 *
 * The old CI step was:
 *
 *   npx license-checker --production --summary --onlyAllow '<allowlist>' 2>/dev/null || {
 *     echo "license-checker not available, falling back to npm ls"
 *     ...
 *     npm ls --all --depth=0 || true      <-- swallows the violation exit code
 *   }
 *
 * THREE independent defects, each alone enough to make the gate unable to fail:
 *
 *   1. `|| true` at the end of the fallback. license-checker exits non-zero for
 *      BOTH "could not run" AND "found a disallowed license"; both landed in the
 *      same fallback, and the fallback always exited 0.
 *   2. `2>/dev/null` discarded the message naming the offending package, so even
 *      a human reading the log learned nothing.
 *   3. `--production` DOES NOT WORK from this monorepo's workspace root. The root
 *      package.json is `private` with a `workspaces` array and NO `dependencies`
 *      field, so license-checker's read-installed walk finds nothing. Verified:
 *      `npx license-checker --production --summary` prints
 *      "Error: No packages found in this path." and exits 0 — zero packages
 *      examined. Even with the `|| true` removed, the gate would have been
 *      inspecting an empty set.
 *
 * This script enumerates the REAL production tree through
 * `npm ls --omit=dev --all --json`, which is workspace-aware (538 packages as of
 * 2026-07-28, vs 0 for the old command), resolves each package's SPDX license
 * from its installed package.json, and compares against the allowlist.
 *
 * ANTI-VACUITY (this gate's entire history is "passed while checking nothing"):
 *   - package floor        : fewer than MIN_PACKAGES resolved -> FAIL (exit 2)
 *   - license resolution   : more than MAX_UNRESOLVED_PCT of packages with an
 *                            unreadable license -> FAIL (exit 2)
 *   - known-bad self-test  : the evaluator is run against synthetic AGPL-3.0 /
 *                            UNLICENSED / SEE LICENSE IN file packages, which
 *                            MUST be rejected, and synthetic MIT / (MIT OR
 *                            Apache-2.0) packages, which MUST be accepted. If
 *                            the comparator stops working, the gate fails
 *                            instead of passing everything.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Exit: 0 clean | 1 disallowed license found | 2 vacuity / could-not-verify
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Unlicense',
  'Python-2.0',
  'BlueOak-1.0.0',
  'MIT-0',
  'MPL-2.0',
  'CC-BY-SA-4.0',
  'Artistic-2.0',
  'WTFPL',
  'BSD',
]);

// ── Grandfathered exceptions (RATCHET, not an allowlist widening) ───────────
// Same discipline as the P10 per-page ratchet: the gate could never fail before
// today, so turning it on found pre-existing debt. Rather than widening ALLOWED
// (which would quietly bless the whole license class for every future package)
// each pre-existing package is pinned by NAME with a reason. Anything new is
// blocked. Removing an entry is always safe; adding one requires legal review
// recorded in the PR description.
//
// Found by the first real run of this gate on 2026-07-28.
const EXCEPTIONS = new Map([
  [
    '@sentry/cli',
    'FSL-1.1-MIT (Functional Source License, converts to MIT). Sentry\'s own release/upload CLI, pulled in by @sentry/nextjs. Build-time tool, not shipped to the browser. NEEDS LEGAL SIGN-OFF.',
  ],
  [
    '@sentry/cli-linux-x64',
    'FSL-1.1-MIT. Platform binary of @sentry/cli above; same disposition.',
  ],
  [
    'posthog-js',
    'Declares "SEE LICENSE IN LICENSE"; the bundled LICENSE file is MIT. Blocked only because the SPDX field is unparseable. NEEDS LEGAL SIGN-OFF to confirm the file contents.',
  ],
  [
    '@img/sharp-wasm32',
    'Apache-2.0 AND LGPL-3.0-or-later AND MIT. WASM fallback binary shipped by `sharp` (Next.js\'s image-optimization dependency, transitive via `sharp` -> `next`) for cross-platform resilience. Never the binary actually executed on the supported linux-x64 Vercel deployment target -- that\'s `@img/sharp-linux-x64` (Apache-2.0, MIT, already allowed). Newly installed on disk starting with the sharp 0.34.5 -> 0.35.3 bump: on 0.34.5 this package declared `cpu:["wasm32"]` directly on itself and was a direct optionalDependency of `sharp`, so npm\'s platform matching skipped it cleanly on linux-x64/win32 runners; on 0.35.3 it was restructured into a shared runtime helper required by two new sibling packages (`@img/sharp-freebsd-wasm32`, os:freebsd; `@img/sharp-webcontainers-wasm32`, cpu:wasm32) and no longer carries any cpu/os restriction of its own, so npm installs it unconditionally even though both siblings that need it are themselves correctly skipped. NEEDS LEGAL SIGN-OFF to confirm the LGPL component poses no distribution risk given it ships in node_modules but is never loaded at runtime on the deployed platform.',
  ],
]);

const MIN_PACKAGES = 200;
const MAX_UNRESOLVED_PCT = 5;
const ROOT = process.cwd();

// ── License expression evaluator ────────────────────────────────────────────
// Handles the SPDX shapes npm actually produces: plain ids, `(A OR B)`,
// `(A AND B)`, and the legacy `licenses: [{type}]` array.
function isAllowedExpression(expr) {
  if (!expr || typeof expr !== 'string') return false;
  const e = expr.trim();
  if (/^SEE LICENSE IN/i.test(e)) return false;
  if (/^UNLICENSED$/i.test(e)) return false;
  const clean = e.replace(/^\(|\)$/g, '').trim();
  if (/\sOR\s/i.test(clean)) {
    // Permissive if ANY disjunct is allowed.
    return clean.split(/\s+OR\s+/i).some((p) => isAllowedExpression(p));
  }
  if (/\sAND\s/i.test(clean)) {
    // Restrictive: ALL conjuncts must be allowed.
    return clean.split(/\s+AND\s+/i).every((p) => isAllowedExpression(p));
  }
  return ALLOWED.has(clean.replace(/\+$/, ''));
}

// ── Known-bad / known-good self-test (anti-vacuity) ─────────────────────────
const SELF_TEST = [
  { expr: 'MIT', expect: true },
  { expr: 'Apache-2.0', expect: true },
  { expr: '(MIT OR CC0-1.0)', expect: true },
  { expr: 'AGPL-3.0', expect: false },
  { expr: 'AGPL-3.0-only', expect: false },
  { expr: 'GPL-3.0-or-later', expect: false },
  { expr: 'LGPL-3.0-or-later', expect: false },
  { expr: 'UNLICENSED', expect: false },
  { expr: 'SEE LICENSE IN LICENSE.md', expect: false },
  { expr: '(MIT AND AGPL-3.0)', expect: false },
];
const selfTestFailures = SELF_TEST.filter((t) => isAllowedExpression(t.expr) !== t.expect);
if (selfTestFailures.length > 0) {
  console.error('=== LICENSE GATE SELF-CHECK FAILED ===');
  for (const t of selfTestFailures) {
    console.error(`  "${t.expr}" -> ${isAllowedExpression(t.expr)}, expected ${t.expect}`);
  }
  console.error('The allow/deny comparator is broken; every "pass" would be meaningless.');
  process.exit(2);
}
console.log(`license gate self-check: ${SELF_TEST.length}/${SELF_TEST.length} fixtures correct`);

// ── Enumerate the production tree ───────────────────────────────────────────
let treeJson;
try {
  // `npm ls` exits non-zero on peer-dep warnings; the JSON is still valid.
  treeJson = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (err) {
  treeJson = err.stdout || '';
}

let tree;
try {
  tree = JSON.parse(treeJson);
} catch {
  console.error('=== LICENSE GATE CANNOT VERIFY ===');
  console.error('`npm ls --omit=dev --all --json` produced no parseable output.');
  console.error('Failing CLOSED: "could not verify" must never be reported as "verified clean".');
  process.exit(2);
}

const packages = new Map(); // name -> version
(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies || {})) {
    const key = name;
    if (!packages.has(key)) {
      packages.set(key, dep.version || '?');
      walk(dep);
    }
  }
})(tree);

// Our own workspace packages are first-party code, not third-party licensing
// risk. Names come from the root package.json workspaces globs, resolved to the
// package names actually declared, so this list cannot silently over-exclude.
const FIRST_PARTY = new Set(['alfanumrik-workspace']);
for (const wsDir of ['apps/host', 'packages/lib', 'packages/ui', 'eslint-plugin-alfanumrik']) {
  try {
    FIRST_PARTY.add(JSON.parse(readFileSync(join(ROOT, wsDir, 'package.json'), 'utf8')).name);
  } catch {
    /* workspace missing — it will simply not be excluded */
  }
}
for (const name of [...packages.keys()]) {
  if (FIRST_PARTY.has(name)) packages.delete(name);
}

console.log(`production packages enumerated: ${packages.size} (first-party excluded: ${[...FIRST_PARTY].join(', ')})`);
if (packages.size < MIN_PACKAGES) {
  console.error('=== VACUOUS LICENSE SCAN ===');
  console.error(
    `Only ${packages.size} production package(s) found (floor ${MIN_PACKAGES}). This is the ` +
      'same failure mode as the old `license-checker --production` call, which found ZERO ' +
      'packages in this workspace root and still exited 0. Failing CLOSED.',
  );
  process.exit(2);
}

// ── Resolve licenses ────────────────────────────────────────────────────────
// Returns:
//   { state: 'ok', license }        installed, license readable
//   { state: 'unreadable' }         installed but no license field   -> GATED
//   { state: 'not-installed' }      no directory on disk (optional/peer for a
//                                   different platform or framework) -> excluded
//                                   from the denominator, counted and printed.
// The not-installed bucket is deliberately NARROW: it requires that no
// package.json exists anywhere. "Installed but unreadable" is never waved
// through, because that is how a scan quietly stops covering real code.
function readLicense(name) {
  const bases = [join(ROOT, 'node_modules'), join(ROOT, 'apps/host/node_modules')];
  let found = false;
  for (const base of bases) {
    const pj = join(base, ...name.split('/'), 'package.json');
    if (!existsSync(pj)) continue;
    found = true;
    try {
      const p = JSON.parse(readFileSync(pj, 'utf8'));
      if (typeof p.license === 'string') return { state: 'ok', license: p.license };
      if (p.license && typeof p.license.type === 'string') {
        return { state: 'ok', license: p.license.type };
      }
      if (Array.isArray(p.licenses)) {
        return {
          state: 'ok',
          license:
            '(' + p.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ') + ')',
        };
      }
    } catch {
      /* fall through */
    }
  }
  return { state: found ? 'unreadable' : 'not-installed' };
}

const violations = [];
const grandfathered = [];
const unresolved = [];
const notInstalled = [];
const histogram = new Map();

for (const [name, version] of packages) {
  const r = readLicense(name);
  if (r.state === 'not-installed') {
    notInstalled.push(`${name}@${version}`);
    continue;
  }
  if (r.state === 'unreadable') {
    unresolved.push(`${name}@${version}`);
    continue;
  }
  histogram.set(r.license, (histogram.get(r.license) || 0) + 1);
  if (!isAllowedExpression(r.license)) {
    if (EXCEPTIONS.has(name)) {
      grandfathered.push({ name, version, license: r.license, reason: EXCEPTIONS.get(name) });
    } else {
      violations.push({ name, version, license: r.license });
    }
  }
}

const scanned = packages.size - notInstalled.length;
if (scanned < MIN_PACKAGES) {
  console.error('=== VACUOUS LICENSE SCAN ===');
  console.error(
    `Only ${scanned} installed production package(s) after excluding ${notInstalled.length} ` +
      `not-installed optional/peer entries (floor ${MIN_PACKAGES}). Failing CLOSED.`,
  );
  process.exit(2);
}
console.log(
  `not installed on this platform (excluded, not shipped): ${notInstalled.length}` +
    (notInstalled.length ? ` — e.g. ${notInstalled.slice(0, 5).join(', ')}` : ''),
);
const unresolvedPct = (unresolved.length / scanned) * 100;
console.log('license distribution (production tree):');
for (const [lic, n] of [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(n).padStart(4)}  ${lic}`);
}
console.log(
  `resolved ${scanned - unresolved.length}/${scanned} installed packages ` +
    `(${unresolvedPct.toFixed(1)}% unreadable, ceiling ${MAX_UNRESOLVED_PCT}%)`,
);

if (unresolvedPct > MAX_UNRESOLVED_PCT) {
  console.error('=== LICENSE GATE CANNOT VERIFY ===');
  console.error(
    `${unresolved.length} package(s) (${unresolvedPct.toFixed(1)}%) had no readable license. ` +
      'Too much of the tree is unverified to call this a pass. Failing CLOSED.',
  );
  console.error('  ' + unresolved.slice(0, 20).join('\n  '));
  process.exit(2);
}

if (grandfathered.length > 0) {
  console.log('');
  console.log('#########################################################################');
  console.log(`## LICENSE DEBT: ${grandfathered.length} production dependency(ies) carry a NON-ALLOWLISTED license.`);
  console.log('## They are grandfathered by name — they are NOT approved. Legal sign-off pending.');
  console.log('#########################################################################');
  for (const g of grandfathered) {
    console.log(`  ${g.license.padEnd(26)} ${g.name}@${g.version}`);
    console.log(`      reason: ${g.reason}`);
  }
  console.log('');
}

// Stale exceptions are themselves a hazard: an entry for a package that is gone
// (or has since been relicensed) silently widens the gate for a future package
// of the same name.
const staleExceptions = [...EXCEPTIONS.keys()].filter(
  (n) => !grandfathered.some((g) => g.name === n),
);
if (staleExceptions.length > 0) {
  console.log(
    `NOTE: ${staleExceptions.length} license exception(s) no longer needed — delete them: ` +
      staleExceptions.join(', '),
  );
}

if (violations.length > 0) {
  console.error('=== DISALLOWED DEPENDENCY LICENSES ===');
  for (const v of violations) console.error(`  ${v.license.padEnd(28)} ${v.name}@${v.version}`);
  console.error('');
  console.error(`Allowed: ${[...ALLOWED].sort().join(', ')}`);
  console.error('Remove the dependency, or add the license to ALLOWED in this file only after');
  console.error('a deliberate legal review — recorded in the PR description.');
  process.exit(1);
}

console.log(
  `No NEW license violations: ${scanned - grandfathered.length}/${scanned} installed production ` +
    `dependencies carry an allowed license; ${grandfathered.length} grandfathered (listed above, ` +
    `NOT approved). ${SELF_TEST.length} comparator fixtures verified.`,
);
process.exit(0);
