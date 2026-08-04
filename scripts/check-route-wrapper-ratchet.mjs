#!/usr/bin/env node
// scripts/check-route-wrapper-ratchet.mjs
//
// P2-2 (API response-envelope consolidation) — withRoute() adoption ratchet.
//
// withRoute() (packages/lib/src/api/v2/with-route.ts) is the shared
// error-safety wrapper for /v2 API route handlers. This script guards against
// a SILENT REGRESSION: a route that was migrated onto withRoute() later
// reverting to an unwrapped handler (e.g. during an unrelated refactor)
// without anyone noticing.
//
// It re-derives, from source, how many `apps/host/src/app/api/**/route.ts`
// files import `withRoute` (either via the canonical
// `@alfanumrik/lib/api/v2/with-route` alias or the apps/host re-export stub
// `@/lib/api/v2/with-route`), and compares that count against the recorded
// floor in `scripts/route-wrapper-adoption.json`.
//
// THE RULE: the ledger's `count` can only be a FLOOR. A live count BELOW the
// ledger is a regression and FAILS. A live count AT OR ABOVE the ledger PASSES
// — if it's above, this prints a "ratchet opportunity" hint to bump the
// ledger in the same PR that added the new adoption, but does not fail the
// build for it (mirrors scripts/check-bundle-size.mjs's non-failing
// "ratchet opportunity" hint for routes that shrink below their baseline).
//
// Usage:
//   node scripts/check-route-wrapper-ratchet.mjs
//
// Exit code 0: live adoption count >= ledger floor.
// Exit code 1: live adoption count < ledger floor (regression), OR the
//   ledger file is missing/malformed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const API_ROOT = path.join(REPO_ROOT, 'apps', 'host', 'src', 'app', 'api');
const LEDGER_PATH = path.join(REPO_ROOT, 'scripts', 'route-wrapper-adoption.json');

// Matches an import/require whose module specifier resolves to the withRoute
// module, covering both the canonical alias and the apps/host stub, plus any
// relative-path form:
//   import { withRoute } from '@alfanumrik/lib/api/v2/with-route'
//   import { withRoute } from '@/lib/api/v2/with-route'
//   import { withRoute } from '../../../../lib/api/v2/with-route'
const WITH_ROUTE_IMPORT_RE = /(?:from|require\(\s*)\s*['"][^'"]*\bapi\/v2\/with-route['"]/;

/** Recursively collect every route.ts under API_ROOT, repo-relative + POSIX. */
function collectRoutes(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRoutes(abs));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      out.push(abs.slice(REPO_ROOT.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

function detectAdopters() {
  if (!fs.existsSync(API_ROOT)) return [];
  const out = [];
  for (const rel of collectRoutes(API_ROOT)) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    if (WITH_ROUTE_IMPORT_RE.test(src)) out.push(rel);
  }
  return out.sort();
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    console.error(`[check-route-wrapper-ratchet] ledger not found: ${LEDGER_PATH}`);
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  if (typeof parsed.count !== 'number' || !Array.isArray(parsed.routes)) {
    console.error(
      '[check-route-wrapper-ratchet] ledger is malformed — expected { count: number, routes: string[] }.',
    );
    process.exit(1);
  }
  return parsed;
}

function main() {
  const ledger = loadLedger();
  const adopters = detectAdopters();
  const liveCount = adopters.length;

  if (liveCount < ledger.count) {
    const missing = ledger.routes.filter((r) => !adopters.includes(r));
    console.error(
      `BLOCKED: withRoute() adoption dropped below the ratchet floor.\n` +
        `  Ledger floor (scripts/route-wrapper-adoption.json): ${ledger.count}\n` +
        `  Live count:                                          ${liveCount}\n`,
    );
    if (missing.length > 0) {
      console.error('Route(s) previously recorded as adopters that no longer import withRoute:');
      for (const r of missing) console.error(`  • ${r}`);
      console.error('');
    }
    console.error(
      'If this regression is intentional (route genuinely reverted off withRoute), update ' +
        'scripts/route-wrapper-adoption.json in the same PR (decrement "count" and prune the ' +
        'route from "routes") with architect review. Otherwise, restore the withRoute() wrapper.',
    );
    process.exit(1);
  }

  if (liveCount > ledger.count) {
    console.log(`[check-route-wrapper-ratchet] OK — withRoute() adoption at ${liveCount} route(s).`);
    console.log(
      `  Ratchet opportunity: live adoption (${liveCount}) exceeds the recorded floor ` +
        `(${ledger.count}). Consider bumping "count" and "routes" in ` +
        `scripts/route-wrapper-adoption.json in this PR to lock in the new floor.`,
    );
    process.exit(0);
  }

  console.log(
    `[check-route-wrapper-ratchet] OK — withRoute() adoption at ${liveCount} route(s), meets the ledger floor.`,
  );
  process.exit(0);
}

main();
