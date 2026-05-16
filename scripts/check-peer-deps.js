#!/usr/bin/env node
/**
 * Phase E.7 — Peer-deps + cold-boot guard
 *
 * Prevents a repeat of the PR #779 / #784 incident.
 *
 * Background:
 *   PR #779 pruned four @opentelemetry/* packages that looked unused at the
 *   import level. They were actually optional peer-dependencies of
 *   @sentry/node-core (a transitive of @sentry/nextjs). npm v7+ does NOT
 *   auto-install peer-deps unless they appear in the consuming package's
 *   `dependencies`. The prune broke every Vercel cold deploy across six
 *   follow-up PRs (#779-#783) until the hotfix landed in PR #784.
 *
 * The CLAUDE.md memory entry "Don't prune @opentelemetry/*" stops the LLM
 * from repeating the mistake. This script is the independent CI guard that
 * catches the regression if a human (or a future agent without that memory)
 * removes the deps anyway.
 *
 * What it checks:
 *   1. Each peer-dep below resolves through `npm ls` (no UNMET / missing).
 *   2. `next.config.js` can be `require()`d from a sub-Node process — that
 *      is the exact path Vercel takes on cold boot, and is what surfaced
 *      the #779 regression in production.
 *
 * Add to package.json: "check:peer-deps": "node scripts/check-peer-deps.js"
 * Wire in CI: .github/workflows/peer-deps-guard.yml
 */

'use strict';

/* eslint-disable no-console -- CLI tool; console.log is the user-facing output channel. */

const { spawnSync } = require('child_process');
const path = require('path');

/**
 * The peer-dep set that must remain in `dependencies`.
 *
 * Verified 2026-05-16 against node_modules/@sentry/node-core@10.52.0
 * (transitive of @sentry/nextjs@10.52.0). That package's peerDependencies
 * block lists @opentelemetry/{api,core,instrumentation,sdk-trace-base}
 * among others — all marked `optional: true` in peerDependenciesMeta, which
 * is exactly why npm stays silent when they go missing.
 *
 * If you add a new Sentry/OTel direct dep, verify the peer-dep list with:
 *   node -e "console.log(require('@sentry/node-core/package.json').peerDependencies)"
 * and update this array.
 */
const REQUIRED_PEERS = [
  '@opentelemetry/api',
  '@opentelemetry/core',
  '@opentelemetry/instrumentation',
  '@opentelemetry/sdk-trace-base',
];

/**
 * The downstream package whose peer-deps the above satisfies. Surfaced in
 * the error message so a future maintainer knows why these are pinned.
 */
const PEER_OF = '@sentry/node-core (transitive of @sentry/nextjs)';

const FAIL_PREFIX = 'FAIL:';
const PASS_PREFIX = 'PASS:';

let exitCode = 0;

function fail(msg) {
  console.error(`${FAIL_PREFIX} ${msg}`);
  exitCode = 1;
}

function pass(msg) {
  console.log(`${PASS_PREFIX} ${msg}`);
}

// ── Check 1: npm ls resolves every required peer ─────────────────────────
//
// We invoke `npm ls <pkg> --json --depth=0` for each peer. We deliberately
// do not rely on the parent process's exit code from a combined `npm ls`
// call — npm exits non-zero for any peer-dep warning across the whole
// tree, which is too noisy. We parse the JSON per-peer instead and treat
// either a missing `dependencies[<peer>]` entry OR a `problems` array
// containing the peer as a failure.
//
// Windows note: Node 22+ refuses to spawn `.cmd` / `.bat` files directly
// without `shell: true` (CVE-2024-27980). We feature-detect and pass
// `shell: true` only on win32 where the npm launcher is `npm.cmd`. CI
// runs on ubuntu-latest where `npm` is a real ELF symlink and `shell`
// is not needed.
function checkNpmLs() {
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';

  for (const pkg of REQUIRED_PEERS) {
    const result = spawnSync(
      npmCmd,
      ['ls', pkg, '--json', '--depth=0'],
      {
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '..'),
        shell: isWindows,
      }
    );

    let parsed;
    try {
      parsed = JSON.parse(result.stdout || '{}');
    } catch (err) {
      fail(
        `Could not parse \`npm ls ${pkg}\` output. stdout was:\n${result.stdout}\nstderr was:\n${result.stderr}`
      );
      continue;
    }

    const direct = parsed.dependencies && parsed.dependencies[pkg];
    if (!direct) {
      fail(
        `${pkg} is a peer dep of ${PEER_OF} but is not in dependencies. ` +
          `Add it to package.json. (Phase E.7)`
      );
      continue;
    }

    if (direct.missing || direct.invalid) {
      fail(
        `${pkg} is declared but unresolved (missing=${!!direct.missing}, ` +
          `invalid=${!!direct.invalid}). Run \`npm install\` and re-check. (Phase E.7)`
      );
      continue;
    }

    // `npm ls` also surfaces "extraneous" or peer-conflict problems in a
    // top-level problems[] array. Any problem mentioning our peer counts.
    const problems = Array.isArray(parsed.problems) ? parsed.problems : [];
    const peerProblems = problems.filter((p) => p.includes(pkg));
    if (peerProblems.length > 0) {
      fail(
        `${pkg} has unresolved npm problems:\n  - ${peerProblems.join('\n  - ')}\n` +
          `(Phase E.7)`
      );
      continue;
    }

    pass(`${pkg}@${direct.version} resolves (peer of ${PEER_OF}).`);
  }
}

// ── Check 2: next.config.js loads in a fresh Node process ────────────────
//
// This is the path Vercel takes on cold boot. If a transitive peer is
// missing, the Sentry plugin in next.config.js throws at require() time
// and the deploy fails. We use a sub-process so any module side-effects
// (env reads, console output) don't leak into this script's own state.
function checkNextConfigBoots() {
  const repoRoot = path.resolve(__dirname, '..');
  const configPath = path.join(repoRoot, 'next.config.js');

  const result = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(configPath)})`],
    { encoding: 'utf8', cwd: repoRoot }
  );

  if (result.status !== 0) {
    fail(
      `\`require('./next.config.js')\` failed in a fresh Node process — ` +
        `this is the exact path Vercel takes on cold boot. ` +
        `A missing transitive peer-dep is the most likely cause. (Phase E.7)\n` +
        `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`
    );
    return;
  }

  pass('next.config.js loads in a fresh Node process (Vercel cold-boot path).');
}

console.log('Phase E.7 — peer-deps + cold-boot guard');
console.log(`Checking ${REQUIRED_PEERS.length} peer(s) of ${PEER_OF}…\n`);
checkNpmLs();
checkNextConfigBoots();

if (exitCode === 0) {
  console.log('\nAll checks passed.');
} else {
  console.error(
    '\nOne or more checks failed. See https://github.com/AlfanumrikOS/Alfanumrik/pull/779 ' +
      'and docs/runbooks/peer-deps.md for the incident this guard prevents.'
  );
}

process.exit(exitCode);
