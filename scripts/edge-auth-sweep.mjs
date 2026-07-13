#!/usr/bin/env node
/**
 * edge-auth-sweep.mjs — LIVE unauthenticated probe of every deployed Edge
 * Function. Testing-strategy Phase 1, gap 1 (behavioral half; the static half
 * is apps/host/src/__tests__/edge-function-auth-guard-sweep.test.ts).
 *
 * WHY
 * ===
 * Every function deploys with `--no-verify-jwt`, so auth is self-enforced.
 * The static sweep proves repo functions CONTAIN a guard; this probe proves
 * the DEPLOYED function ENFORCES one — including the production-only orphans
 * documented in docs/runbooks/edge-function-drift-report.md, which have no
 * source in this repo and therefore can never be covered by a static test.
 *
 * WHAT IT DOES
 * ============
 * 1. Enumerates deployed functions via the Supabase Management API
 *    (GET /v1/projects/{ref}/functions) when SUPABASE_ACCESS_TOKEN is set;
 *    falls back to local `supabase/functions/` directories otherwise.
 * 2. Sends ONE unauthenticated `POST {}` to each function's public URL.
 *    No credentials, no signatures — exactly what an anonymous attacker sends.
 * 3. Classifies the response:
 *      PASS  401 / 403           — guard enforced
 *      PASS  410                 — tombstoned orphan (structured GONE)
 *      WARN  400 / 404 / 405 / 422 / 429
 *                                — rejected, but by validation/rate-limit
 *                                  rather than an explicit auth check; the
 *                                  function may still process a well-formed
 *                                  unauthenticated body. Review.
 *      FAIL  2xx                 — unauthenticated request was SERVED.
 *      FAIL  5xx                 — unauthenticated request reached handler
 *                                  code and crashed it (work happened before
 *                                  any guard).
 * 4. Reports deployed-but-not-in-repo functions (orphans) so the sweep output
 *    doubles as a drift check against the drift-report runbook.
 *
 * PUBLIC_BY_DESIGN: functions that legitimately serve anonymous traffic
 * (marketing-site AlfaBot). For these, 2xx/400 is accepted but they must
 * still never 5xx on the probe body.
 *
 * SAFETY: read-only from the platform's perspective — the probe carries no
 * auth and an empty JSON body. Any state change caused by it is precisely
 * the vulnerability this sweep exists to find.
 *
 * Usage:
 *   SUPABASE_PROJECT_REF=<ref> [SUPABASE_ACCESS_TOKEN=<pat>] node scripts/edge-auth-sweep.mjs
 * Exit codes: 0 = no FAILs; 1 = at least one FAIL; 2 = configuration error.
 */

'use strict';

import { readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_DIR = resolve(ROOT, 'supabase', 'functions');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || '';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const TIMEOUT_MS = Number(process.env.SWEEP_TIMEOUT_MS || 15000);

/**
 * Functions that intentionally serve anonymous traffic. Keep this list SHORT
 * and reviewed — every entry is a standing decision that anonymous POSTs are
 * acceptable for that endpoint (compensating controls: admission layer,
 * rate limiting, denylist).
 */
const PUBLIC_BY_DESIGN = new Set([
  'alfabot-answer', // marketing-site bot; admitAiRoute + alfabot_denylist + rate limits
  'alfabot-send-inquiry', // marketing-site lead capture; validated + rate limited
]);

/**
 * Functions that MUST return 200 to unauthenticated callers by contract, so a
 * 200 here is correct, not a finding. Keep SHORT and reviewed.
 *   - send-auth-email is a Supabase Auth HOOK: P15 requires it to return 200 on
 *     ALL code paths (a non-200 makes Supabase BLOCK the signup). It is invoked
 *     by Supabase's auth system with a signed hook secret, never by end users.
 *     Pinned by its own always-200.test.ts. A 5xx is still a FAIL (a crash the
 *     auth system would see as a failure).
 */
const KNOWN_200 = new Set(['send-auth-email']);

if (!PROJECT_REF) {
  console.error('CONFIG: SUPABASE_PROJECT_REF is required.');
  process.exit(2);
}

function localFunctionSlugs() {
  if (!existsSync(FUNCTIONS_DIR)) return [];
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

async function deployedFunctionSlugs() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${await res.text()}`);
  }
  const list = await res.json();
  return list
    .filter((f) => f.status === 'ACTIVE')
    .map((f) => f.slug)
    .sort();
}

async function probe(slug) {
  const url = `https://${PROJECT_REF}.supabase.co/functions/v1/${slug}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
      redirect: 'manual',
    });
    return { slug, status: res.status };
  } catch (err) {
    return { slug, status: null, error: err.name === 'AbortError' ? 'timeout' : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function classify({ slug, status, error }) {
  if (error) return { verdict: 'WARN', note: `probe error: ${error}` };
  if (PUBLIC_BY_DESIGN.has(slug)) {
    if (status >= 500) return { verdict: 'FAIL', note: 'public-by-design but 5xx on probe body' };
    return { verdict: 'PASS', note: `public-by-design (${status})` };
  }
  if (KNOWN_200.has(slug)) {
    if (status >= 500) return { verdict: 'FAIL', note: 'must-return-200 hook but 5xx on probe body' };
    return { verdict: 'PASS', note: `must-return-200 by contract (${status})` };
  }
  if (status === 401 || status === 403) return { verdict: 'PASS', note: 'auth enforced' };
  if (status === 410) return { verdict: 'PASS', note: 'tombstoned (structured GONE)' };
  if (status >= 200 && status < 300) return { verdict: 'FAIL', note: 'unauthenticated request SERVED' };
  if (status >= 500) return { verdict: 'FAIL', note: 'handler crashed before any auth guard' };
  return { verdict: 'WARN', note: `rejected with ${status} (validation/rate-limit, not an auth check)` };
}

async function main() {
  const local = new Set(localFunctionSlugs());
  let slugs;
  let source;
  if (ACCESS_TOKEN) {
    slugs = await deployedFunctionSlugs();
    source = 'management API (deployed state)';
  } else {
    slugs = [...local];
    source = 'local supabase/functions/ (no SUPABASE_ACCESS_TOKEN — orphans NOT covered)';
  }
  console.log(`edge-auth-sweep: ${slugs.length} function(s) from ${source}\n`);

  const results = [];
  // Sequential with a small gap: this is a probe, not a load test.
  for (const slug of slugs) {
    const r = await probe(slug);
    const { verdict, note } = classify(r);
    const orphan = ACCESS_TOKEN && !local.has(slug) ? ' [ORPHAN: no repo source]' : '';
    results.push({ slug, verdict, status: r.status, note, orphan: Boolean(orphan) });
    console.log(`${verdict.padEnd(4)} ${String(r.status ?? '—').padEnd(4)} ${slug}${orphan} — ${note}`);
    await new Promise((res) => setTimeout(res, 150));
  }

  const fails = results.filter((r) => r.verdict === 'FAIL');
  const warns = results.filter((r) => r.verdict === 'WARN');
  const orphans = results.filter((r) => r.orphan);
  console.log(
    `\nsummary: ${results.length} probed | ${fails.length} FAIL | ${warns.length} WARN | ` +
      `${orphans.length} orphan(s) (see docs/runbooks/edge-function-drift-report.md)`,
  );
  if (fails.length > 0) {
    console.log('\nFAILures — unauthenticated requests reached handler logic:');
    for (const f of fails) console.log(`  - ${f.slug} (${f.status}) ${f.orphan ? '[ORPHAN]' : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`edge-auth-sweep: fatal — ${err.message}`);
  process.exit(2);
});
