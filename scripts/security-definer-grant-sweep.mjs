#!/usr/bin/env node
/**
 * security-definer-grant-sweep.mjs — LIVE check that no SECURITY DEFINER
 * function in the public schema carries an unreviewed PUBLIC (which, in
 * Postgres ACL terms, anon/authenticated inherit from automatically —
 * `REVOKE ... FROM anon, authenticated` alone is a silent no-op against a
 * PUBLIC grant) EXECUTE grant. P2-8 (2026-09-04 launch-audit follow-up),
 * pairs with the P0-1 sweep it exists to prevent regressing.
 *
 * WHY
 * ===
 * Every function is born with EXECUTE granted to PUBLIC unless someone
 * explicitly REVOKEs it. The 2026-09-02 audit found 58 SECURITY DEFINER
 * functions that had never had that grant revoked and fixed all of them
 * (PRs #1700-#1703) -- but that was a point-in-time remediation, not a
 * standing invariant. Two days later, expire_abandoned_checkout_attempts()
 * (created 2026-09-03, PR #1724, after the sweep) shipped with the same
 * default PUBLIC grant and sat directly callable by anon/authenticated
 * until a manual re-audit caught it on 2026-09-04 (migration
 * 20260904160000). Nothing in CI would have caught it in between --
 * this script is that missing standing check.
 *
 * WHAT IT DOES
 * ============
 * Runs one read-only query against the live production database via the
 * Supabase Management API (POST /v1/projects/{ref}/database/query, same
 * auth as scripts/edge-auth-sweep.mjs's function-listing call): every
 * SECURITY DEFINER function in `public` with an EXECUTE grant to the
 * PUBLIC pseudo-role (pg_proc.proacl, grantee 0). Any result not present
 * in scripts/security-definer-public-grant-allowlist.json is a FAIL.
 *
 * This is a live DB read only -- no writes, no schema changes, nothing
 * mutated. Companion allowlist file documents exactly why each excepted
 * function is safe (RLS helper vs. trigger function) so adding an entry
 * is a real, visible security review, not a rubber stamp.
 *
 * Usage:
 *   SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<pat> node scripts/security-definer-grant-sweep.mjs
 * Exit codes: 0 = no unreviewed grants; 1 = at least one found; 2 = configuration error.
 */

'use strict';

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = resolve(ROOT, 'scripts', 'security-definer-public-grant-allowlist.json');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || '';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';

if (!PROJECT_REF) {
  console.error('CONFIG: SUPABASE_PROJECT_REF is required');
  process.exit(2);
}
if (!ACCESS_TOKEN) {
  console.error('CONFIG: SUPABASE_ACCESS_TOKEN is required');
  process.exit(2);
}

const QUERY = `
SELECT p.proname AS name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
WHERE n.nspname = 'public'
  AND a.grantee = 0
  AND a.privilege_type = 'EXECUTE'
  AND p.prosecdef = true
ORDER BY p.proname;
`.trim();

async function runQuery(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(PROJECT_REF)}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Management API query failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`);
  }
  return res.json();
}

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  const byName = new Map();
  for (const entry of raw.functions) byName.set(entry.name, entry.category);
  return byName;
}

async function main() {
  const allowlist = loadAllowlist();
  let rows;
  try {
    rows = await runQuery(QUERY);
  } catch (err) {
    console.error(`CONFIG: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
    return;
  }

  const live = new Set(rows.map((r) => r.name));
  const unreviewed = [...live].filter((name) => !allowlist.has(name)).sort();
  const staleAllowlistEntries = [...allowlist.keys()].filter((name) => !live.has(name)).sort();

  console.log(`Live SECURITY DEFINER functions with a PUBLIC EXECUTE grant: ${live.size}`);
  console.log(`Allowlisted: ${allowlist.size}`);
  console.log('');

  if (unreviewed.length > 0) {
    console.log('FAIL — unreviewed SECURITY DEFINER function(s) with a PUBLIC EXECUTE grant:');
    for (const name of unreviewed) {
      console.log(`  ${name}`);
    }
    console.log('');
    console.log(
      'Either REVOKE ALL ... FROM PUBLIC, anon, authenticated on this function (matching the ' +
        'pattern in supabase/migrations/20260904160000_p0_revoke_public_execute_expire_abandoned_checkouts.sql), ' +
        'or, if it genuinely needs to stay public (an RLS helper or a trigger function), add it to ' +
        'scripts/security-definer-public-grant-allowlist.json with a real justification.'
    );
  } else {
    console.log('PASS — every live SECURITY DEFINER function with a PUBLIC EXECUTE grant is allowlisted.');
  }

  if (staleAllowlistEntries.length > 0) {
    console.log('');
    console.log(
      'NOTE — allowlist entries with no matching live grant (function dropped, renamed, or already ' +
        'revoked). Not a failure, but prune these to keep the allowlist honest:'
    );
    for (const name of staleAllowlistEntries) {
      console.log(`  ${name}`);
    }
  }

  process.exit(unreviewed.length > 0 ? 1 : 0);
}

main();
