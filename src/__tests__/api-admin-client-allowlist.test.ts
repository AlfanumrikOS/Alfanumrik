import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * ADMIN-CLIENT ANTI-REGRESSION ALLOWLIST guard (P8 / P9) — XC-3 Phase 0b.
 *
 * WHY THIS EXISTS
 * ===============
 * The XC-3 audit found that 273 of 362 API `route.ts` files (75.4%) import the
 * RLS-BYPASSING service-role client `@/lib/supabase-admin`. On those routes RLS
 * is NOT exercised on the request path — authorization rests entirely on
 * hand-written `authorizeRequest()` + app checks (`canAccessStudent`, …). A
 * single missed check is an unbounded data-exposure bug with no second line of
 * defense (P8 RLS boundary, P9 RBAC enforcement, P13 data privacy at risk).
 *
 * We cannot migrate all 273 routes at once. Instead Phase 0b FREEZES the blast
 * radius: this guard fails CI the moment a NEW `route.ts` imports `supabase-admin`
 * without being recorded in the `scripts/admin-client-allowlist.json` ledger. The
 * ledger can only RATCHET DOWN — Phase 2/3 prune entries as they swap routes onto
 * the RLS-scoped `supabase-server` client.
 *
 * THE RULE
 * ========
 * A new API route MUST default to the RLS-respecting `@/lib/supabase-server`
 * client. If service-role is genuinely required (webhooks, reconciliation,
 * super-admin-by-design, cron), the route's path MUST be added to the ledger in
 * the SAME PR — that JSON entry is the explicit, reviewable "service-role
 * justified" record an architect signs off on.
 *
 * HOW IT WORKS (static source scan — no runtime, no DB)
 * =====================================================
 *   1. enumerate every `route.ts` under `src/app/api`;
 *   2. flag any whose source has an import/require of a module specifier ending
 *      in `supabase-admin` (covers `@/lib/supabase-admin` AND relative
 *      `../../lib/supabase-admin` forms);
 *   3. load `scripts/admin-client-allowlist.json`;
 *   4. ASSERT detected \ allowlist === ∅  (no NEW admin-importing route);
 *   5. ASSERT allowlist \ detected === ∅  (no STALE entry — a migrated/removed
 *      route must be pruned so the count ratchets down, never drifts);
 *   6. pin the exact count.
 *
 * Plan: docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5b).
 * Owner: architect (ledger) + testing (guard). Catalog: REG-213.
 */

// ── repo / file resolution (cwd or one level up, matching the sibling pins) ──
function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const API_ROOT = resolveRepo('src/app/api');
const ALLOWLIST_ABS = resolveRepo('scripts/admin-client-allowlist.json');

// Match an import/require whose module specifier ends in `supabase-admin`:
//   import { getSupabaseAdmin } from '@/lib/supabase-admin'
//   import { supabaseAdmin }   from '../../../../lib/supabase-admin'
//   const x = require('@/lib/supabase-admin')
const ADMIN_IMPORT_RE = /(?:from|require\(\s*)\s*['"][^'"]*\bsupabase-admin['"]/;

/** Recursively collect every route.ts under src/app/api, repo-relative + POSIX. */
function collectRoutes(dir: string, repoRoot: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...collectRoutes(abs, repoRoot));
    else if (entry === 'route.ts') {
      out.push(abs.slice(repoRoot.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

const REPO_ROOT = API_ROOT ? resolve(API_ROOT, '..', '..', '..') : null;

function detectAdminImporters(): string[] {
  if (!API_ROOT || !REPO_ROOT) return [];
  const out: string[] = [];
  for (const rel of collectRoutes(API_ROOT, REPO_ROOT)) {
    const src = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    if (ADMIN_IMPORT_RE.test(src)) out.push(rel);
  }
  return out.sort();
}

interface Allowlist {
  _comment?: string;
  count: number;
  routes: string[];
}

function loadAllowlist(): Allowlist {
  return JSON.parse(readFileSync(ALLOWLIST_ABS!, 'utf8')) as Allowlist;
}

/** Normalize any path-separator drift before set math. */
const norm = (p: string) => p.replace(/\\/g, '/');

// The frozen baseline captured 2026-06-30 by scanning the live tree.
// XC-3 Phase 2 batch 1 (2026-06-30, REG-217): ratcheted 273 → 272 when
// src/app/api/student/daily-lab/route.ts migrated admin → supabase-server.
// XC-3 Phase 2 batch 2 (2026-06-30, REG-218): ratcheted 272 → 271 when
// src/app/api/dashboard/reviews-due/route.ts migrated admin → supabase-server.
const EXPECTED_COUNT = 271;

// ════════════════════════════════════════════════════════════════════════════
// 0. Non-vacuity — if resolution failed, every assertion below would be hollow.
// ════════════════════════════════════════════════════════════════════════════
describe('admin-client allowlist guard: non-vacuity', () => {
  it('resolves the API route root and the allowlist ledger', () => {
    expect(API_ROOT).not.toBeNull();
    expect(ALLOWLIST_ABS).not.toBeNull();
    expect(REPO_ROOT).not.toBeNull();
  });

  it('detects a large, non-empty admin-importer set from the live tree', () => {
    expect(detectAdminImporters().length).toBeGreaterThan(200);
  });

  it('the ledger JSON has the expected shape (count + routes[])', () => {
    const a = loadAllowlist();
    expect(typeof a.count).toBe('number');
    expect(Array.isArray(a.routes)).toBe(true);
    expect(a._comment).toMatch(/ratchet/i);
    // self-consistency: declared count equals the listed routes length.
    expect(a.routes.length).toBe(a.count);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE FREEZE — detected ⊆ allowlist (no NEW admin route) and allowlist ⊆
//    detected (no STALE entry). Together they pin the set EXACTLY.
// ════════════════════════════════════════════════════════════════════════════
describe('admin-client allowlist guard: frozen blast radius', () => {
  it('no NEW route imports supabase-admin without a ledger entry (detected \\ allowlist === ∅)', () => {
    const allow = new Set(loadAllowlist().routes.map(norm));
    const detected = detectAdminImporters().map(norm);
    const offenders = detected.filter((r) => !allow.has(r)).sort();

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `XC-3 Phase 0b — ${offenders.length} API route(s) import the RLS-BYPASSING ` +
            `service-role client (@/lib/supabase-admin) but are NOT in the allowlist ` +
            `ledger:\n` +
            offenders.map((r) => `  • ${r}`).join('\n') +
            `\n\nThe 273-route admin-client footprint is FROZEN (P8 RLS boundary / P9 RBAC). ` +
            `It may only RATCHET DOWN. Fix ONE of:\n` +
            `  (a) use the RLS-scoped client \`@/lib/supabase-server\` instead — RLS then ` +
            `provides a real second line of defense behind authorizeRequest(); OR\n` +
            `  (b) if service-role is genuinely required (webhook / reconciliation / ` +
            `super-admin-by-design / cron), add the route's repo-relative path to ` +
            `scripts/admin-client-allowlist.json (and bump its "count") in THIS PR, with ` +
            `architect review — that entry is the reviewable "service-role justified" record.\n` +
            `See docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5b).`,
    ).toEqual([]);
  });

  it('no STALE ledger entry — a migrated/removed route must be pruned (allowlist \\ detected === ∅)', () => {
    const detected = new Set(detectAdminImporters().map(norm));
    const stale = loadAllowlist()
      .routes.map(norm)
      .filter((r) => !detected.has(r))
      .sort();

    expect(
      stale,
      stale.length === 0
        ? ''
        : `XC-3 Phase 0b — ${stale.length} allowlist entry(ies) no longer import ` +
            `supabase-admin (route migrated to supabase-server, renamed, or deleted). ` +
            `Prune them from scripts/admin-client-allowlist.json and decrement "count" so ` +
            `the ledger stays an EXACT mirror of the live debt and ratchets DOWN:\n` +
            stale.map((r) => `  • ${r}`).join('\n'),
    ).toEqual([]);
  });

  it('pins the admin-client route count at exactly 271 (drift in either direction trips a guard above)', () => {
    const a = loadAllowlist();
    expect(a.count).toBe(EXPECTED_COUNT);
    expect(a.routes.length).toBe(EXPECTED_COUNT);
    expect(detectAdminImporters().length).toBe(EXPECTED_COUNT);
  });
});
