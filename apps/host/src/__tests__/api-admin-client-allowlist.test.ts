import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * ADMIN-CLIENT ANTI-REGRESSION ALLOWLIST guard (P8 / P9) — XC-3 Phase 0b.
 *
 * WHY THIS EXISTS
 * ===============
 * The XC-3 audit found that 273 of 362 API `route.ts` files (75.4%) import the
 * RLS-BYPASSING service-role client `@alfanumrik/lib/supabase-admin`. On those routes RLS
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
 * A new API route MUST default to the RLS-respecting `@alfanumrik/lib/supabase-server`
 * client. If service-role is genuinely required (webhooks, reconciliation,
 * super-admin-by-design, cron), the route's path MUST be added to the ledger in
 * the SAME PR — that JSON entry is the explicit, reviewable "service-role
 * justified" record an architect signs off on.
 *
 * HOW IT WORKS (static source scan — no runtime, no DB)
 * =====================================================
 *   1. enumerate every `route.ts` under `src/app/api`;
 *   2. flag any whose source has an import/require of a module specifier ending
 *      in `supabase-admin` (covers `@alfanumrik/lib/supabase-admin` AND relative
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
//   import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin'
//   import { supabaseAdmin }   from '../../../../lib/supabase-admin'
//   const x = require('@alfanumrik/lib/supabase-admin')
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
// XC-3 Phase 2 batch 3 — Bearer batch (2026-06-30, REG-220): ratcheted 271 → 270
// when src/app/api/student/daily-plan/route.ts migrated admin →
// createSupabaseRouteClient (Bearer-aware RLS client; mobile Bearer caller).
// XC-3 Phase 3 first slice (2026-06-30, REG-221): ratcheted 270 → 269 when
// src/app/api/school-admin/contracts/route.ts migrated admin →
// createSupabaseServerClient (RLS-scoped cookie client; teacher/school-admin
// read, tenant upper+lower bound proven via school_admin_can_read_own_contracts).
// RCA-01/XC-3 RCA execution (2026-07-10): ratcheted 269 → 267 when
// src/app/api/teacher/join-class/route.ts moved to the scoped authenticated
// teacher_join_class_by_code RPC and src/app/api/parent/report/route.ts moved
// parent_weekly_reports cache access to an RLS-scoped request client.
// RCA-01/XC-3 parent event-bus publisher migration (2026-07-10): ratcheted
// 267 → 265 when src/app/api/parent/children/[student_id]/export/route.ts and
// src/app/api/parent/children/[student_id]/request-erasure/route.ts moved
// state_events publishing to the scoped parent_publish_child_state_event RPC.
// RCA-01/XC-3 school-admin students Auth Admin narrowing (2026-07-10):
// ratcheted 265 → 264 when src/app/api/school-admin/students/route.ts stopped
// importing the broad supabase-admin route client and moved Auth Admin user
// creation behind a narrow server-only helper.
// RCA-01/XC-3 parent erasure status migration (2026-07-10): ratcheted 264 → 263
// when src/app/api/parent/children/[student_id]/erasure-status/route.ts moved
// guardian/link/status reads to the scoped parent_child_erasure_status RPC.
// RCA-01/XC-3 parent profile migration (2026-07-10): ratcheted 263 → 262
// when src/app/api/parent/profile/route.ts moved guardian own-profile updates
// to the scoped parent_update_own_profile RPC.
// RCA-01/XC-3 parent notifications migration (2026-07-10): ratcheted 262 → 259
// when src/app/api/parent/notifications/route.ts,
// src/app/api/parent/notifications/[id]/read/route.ts, and
// src/app/api/parent/notifications/mark-all-read/route.ts moved guardian-owned
// notification list/read writes to scoped authenticated RPCs.
// RCA-01/XC-3 parent calendar migration (2026-07-10): ratcheted 259 → 258
// when src/app/api/parent/calendar/route.ts moved child calendar aggregation
// reads to an RLS-scoped request client after the existing canAccessStudent gate.
// RCA-01/XC-3 parent billing migration (2026-07-10): ratcheted 258 -> 257
// when src/app/api/parent/billing/route.ts moved subscription, plan, and payment
// aggregation reads to an RLS-scoped request client after guardian-child scoping.
// RCA-01/XC-3 parent approve-link migration (2026-07-10): ratcheted 257 -> 256
// when src/app/api/parent/approve-link/route.ts moved student-owned guardian
// link review to the auth.uid()-anchored student_review_guardian_link RPC.
// RCA-01/XC-3 parent accept-invite migration (2026-07-10): ratcheted 256 -> 255
// when src/app/api/parent/accept-invite/route.ts moved guardian invite
// redemption and placeholder cleanup to the auth.uid()-anchored
// parent_accept_invite_code RPC.
// RCA-01/XC-3 parent link-code OTP migration (2026-07-10): ratcheted 255 -> 253
// when src/app/api/parent/link-code/request-otp/route.ts and
// src/app/api/parent/link-code/redeem/route.ts moved challenge insertion,
// verification, and linking to auth.uid()-anchored OTP RPCs.
// RCA-01/XC-3 parent consent migration (2026-07-10): ratcheted 253 -> 252
// when src/app/api/parent/consent/route.ts moved guardian resolution, consent
// mutation/listing, state events, and audit writes to auth.uid()-anchored RPCs.
// RCA-01/XC-3 parent messages migration (2026-07-10): ratcheted 252 -> 249
// when the three parent messaging routes moved guardian/thread/message reads,
// state events, read marking, and notifications to auth.uid()-anchored RPCs.
// Alfanumrik One Experience V3 (2026-07-12): 249 -> 250 because the unified,
// authenticated rollout/capability endpoint must resolve role membership across
// role-specific tables and support Bearer-session verification. This explicit
// ledger entry remains subject to route-level role, scope, RBAC, and tenant
// checks until those cross-role reads move behind narrower authenticated RPCs.
// Foxy Learning Report (2026-07-14): 250 -> 251 for the new read-only,
// super_admin.access-gated per-student report route
// src/app/api/super-admin/foxy-report/[studentId]/route.ts. It is
// super-admin-by-design (service-role read of already-populated learning-loop
// tables, no writes), mirroring the sibling marking-integrity/[studentId] and
// foxy-quality routes. Subject to route-level RBAC + UUID validation; no new
// permission was introduced.
// Alfanumrik One Experience V3 removal (2026-07-15): 251 -> 250. The unified
// experience-v3 rollout/capability route (src/app/api/experience-v3/route.ts)
// was deleted along with the One Experience V3 feature; its ledger entry is
// pruned in the SAME PR so the guard ratchets DOWN, not drifts.
// Flag-posture drift canary (2026-07-20): 250 -> 251 for the new cron route
// src/app/api/cron/flag-posture-canary/route.ts. Service-role is
// cron-by-design here: the nightly posture canary reads feature_flags via the
// admin client to compare live flag state against the CEO-approved posture
// (protected-flags.ts) — no user session exists on a scheduled invocation.
// Fail-closed CRON_SECRET gate (constant-time compare) runs BEFORE any DB
// I/O; output is counts/flag-names-only (no PII, no operator identity).
// Phase 2.2 mock-exam remediation (2026-07-21): 255 -> 256 for the new
// route src/app/api/exams/papers/[id]/start/route.ts. Service-role is
// justified by the same pattern as its siblings [id]/route.ts,
// [id]/submit/route.ts, and papers/route.ts: it calls the
// `start_mock_test_attempt` SECURITY DEFINER RPC and writes a new
// mock_test_attempts row on behalf of the student for the cbse_board
// dynamic-assembly flow. Subject to the same exam.view authorizeRequest()
// gate as the sibling routes.
// Phase 8 monitoring routes (2026-07-22): 256 -> 263 for 7 new routes, all
// service-role-justified as cron (no user session) or super-admin-by-design
// (cross-student aggregate reads):
//   src/app/api/cron/adaptive-loops-monitor/route.ts,
//   src/app/api/cron/synthesis-delivery-monitor/route.ts,
//   src/app/api/cron/synthesis-quality-sample/route.ts,
//   src/app/api/super-admin/adaptive-loops/route.ts,
//   src/app/api/super-admin/ai/irt-readiness/route.ts,
//   src/app/api/super-admin/synthesis-health/route.ts,
//   src/app/api/super-admin/synthesis-quality/route.ts.
const EXPECTED_COUNT = 263;

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
            `service-role client (@alfanumrik/lib/supabase-admin) but are NOT in the allowlist ` +
            `ledger:\n` +
            offenders.map((r) => `  • ${r}`).join('\n') +
            `\n\nThe 273-route admin-client footprint is FROZEN (P8 RLS boundary / P9 RBAC). ` +
            `It may only RATCHET DOWN. Fix ONE of:\n` +
            `  (a) use the RLS-scoped client \`@alfanumrik/lib/supabase-server\` instead — RLS then ` +
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

  it('pins the admin-client route count at exactly 263 (drift in either direction trips a guard above)', () => {
    const a = loadAllowlist();
    expect(a.count).toBe(EXPECTED_COUNT);
    expect(a.routes.length).toBe(EXPECTED_COUNT);
    expect(detectAdminImporters().length).toBe(EXPECTED_COUNT);
  });
});
