/**
 * REG-198 — SAO-1/SAO-5: Super-Admin PII-Export Tiering (P9/P13).
 *
 * WHY THIS EXISTS
 * ---------------
 * The Cycle-6 audit found that `/api/super-admin/reports` sat behind a single
 * `authorizeAdmin(request, 'support')` gate for ALL six report types. `support`
 * is the FLOOR tier (any active admin_users row). Four of the six types egress
 * personally-identifiable data — `students` (minors' name+email), `teachers`
 * (name+email), `parents` (name+email+PHONE), `audit` (admin name+email in
 * details) — at up to 5000 rows. Mass minors'/parent PII export at the lowest
 * admin tier is a P9 (RBAC) + P13/DPDP exposure.
 *
 * The remediation gates each report `type` at its own tier via a `REPORT_CONFIG`
 * map: the 4 PII types require `super_admin`; the 2 UUID-only, non-PII types
 * (`quizzes`, `chats`) keep the `support` floor. `type` is validated against the
 * map FIRST — an unknown type returns 400 BEFORE `authorizeAdmin` or any DB
 * access. No new permission/role/migration is involved.
 *
 * This file PINS that posture as STATIC source assertions over the route file
 * (the unit lane has no live admin session — same convention as
 * `admin-route-auth-gate-sweep.test.ts` and `mutation-gate-pins.test.ts`):
 *   1. Per-type tier map: all 6 types present; 4 PII → super_admin, 2 → support.
 *   2. Validation-before-gate-before-data ordering (string-index proof).
 *   3. No floor inheritance: no blanket `authorizeAdmin(request, 'support')`;
 *      the gate is per-type (`config.level`).
 *   4. Missing-`type` default resolves to `students` → super_admin (strictly
 *      safer than the old `support` default).
 *
 * A future edit that re-flattens the gate, drops a PII type below super_admin,
 * moves the gate after a DB call, or restores the unsafe default turns a test red.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ROUTE_REL = 'src/app/api/super-admin/reports/route.ts';
const RAW = readFileSync(path.join(REPO_ROOT, ROUTE_REL), 'utf8');

/**
 * Comments are stripped for all source-order / textual assertions: the route's
 * doc-comment intentionally QUOTES the old unsafe pattern
 * (`authorizeAdmin(request,'support')`) to explain the remediation, and we must
 * not let documentation of the bug satisfy or break a pin on the real code.
 * (No `://` or other comment-like tokens appear in this route's string literals,
 * so a simple stripper is safe here.)
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// The four PII-egress types and the two UUID-only, non-PII types.
const PII_TYPES = ['students', 'teachers', 'parents', 'audit'] as const;
const NON_PII_TYPES = ['quizzes', 'chats'] as const;
const ALL_TYPES = [...PII_TYPES, ...NON_PII_TYPES];

/**
 * Extract the `level: '<tier>'` declared inside a given type's REPORT_CONFIG
 * entry. Each entry is a flat (no nested-brace) object literal, so a non-greedy
 * scan from the type key to its `level:` is unambiguous.
 */
function levelForType(type: string): string | null {
  // `students: { ... level: 'super_admin', ... }`
  const re = new RegExp(`\\b${type}\\s*:\\s*\\{[^}]*?level\\s*:\\s*'([a-z_]+)'`, 's');
  const m = SRC.match(re);
  return m ? m[1] : null;
}

describe('REG-198 — super_admin_reports_pii_export_tier (P9/P13)', () => {
  // ── 1. Per-type tier map ──────────────────────────────────────────────────
  describe('REPORT_CONFIG per-type tier map', () => {
    it('declares a REPORT_CONFIG gating structure keyed by report type', () => {
      expect(SRC).toMatch(/const\s+REPORT_CONFIG\b/);
    });

    it('maps all 6 report types to an explicit admin tier (non-vacuous)', () => {
      const levels = Object.fromEntries(ALL_TYPES.map((t) => [t, levelForType(t)]));
      // Every type must resolve a level — a missing entry would be `null`.
      for (const t of ALL_TYPES) {
        expect(levels[t], `type "${t}" must declare a level in REPORT_CONFIG`).not.toBeNull();
      }
      expect(Object.keys(levels).sort()).toEqual([...ALL_TYPES].sort());
    });

    it('gates the 4 PII types (students/teachers/parents/audit) at super_admin', () => {
      for (const t of PII_TYPES) {
        expect(levelForType(t), `PII type "${t}" must require super_admin`).toBe('super_admin');
      }
    });

    it('keeps the 2 UUID-only types (quizzes/chats) at the support floor', () => {
      for (const t of NON_PII_TYPES) {
        expect(levelForType(t), `non-PII type "${t}" stays at the support floor`).toBe('support');
      }
    });
  });

  // ── 2. Validation-before-gate-before-data ordering ────────────────────────
  describe('fail-closed ordering: validate type → gate → data', () => {
    const invalidTypeIdx = SRC.indexOf("'Invalid report type'");
    const authorizeIdx = SRC.indexOf('authorizeAdmin(');
    // First real data egress in the handler. `fetchAll(` is the route's only
    // PostgREST fetch; `supabaseAdminUrl(` is the URL builder it calls.
    const fetchAllIdx = SRC.indexOf('fetchAll(', authorizeIdx);
    const supabaseUrlIdx = SRC.indexOf('supabaseAdminUrl(');

    it('returns the unknown-type 400 BEFORE calling authorizeAdmin', () => {
      expect(invalidTypeIdx).toBeGreaterThan(-1);
      expect(authorizeIdx).toBeGreaterThan(-1);
      expect(invalidTypeIdx).toBeLessThan(authorizeIdx);
    });

    it('guards the 400 with an `if (!config)` invalid-type check', () => {
      const guardIdx = SRC.search(/if\s*\(\s*!\s*config\s*\)/);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(authorizeIdx);
    });

    it('calls authorizeAdmin BEFORE any data fetch (fetchAll)', () => {
      expect(fetchAllIdx).toBeGreaterThan(-1);
      expect(authorizeIdx).toBeLessThan(fetchAllIdx);
    });

    it('short-circuits on an unauthorized gate before fetching data', () => {
      // `if (!auth.authorized) return auth.response;` must sit between the gate
      // call and the data fetch.
      const denyIdx = SRC.search(/if\s*\(\s*!\s*auth\.authorized\s*\)\s*return\s+auth\.response/);
      expect(denyIdx).toBeGreaterThan(-1);
      expect(denyIdx).toBeGreaterThan(authorizeIdx);
      expect(denyIdx).toBeLessThan(fetchAllIdx);
    });
  });

  // ── 3. No floor inheritance ───────────────────────────────────────────────
  describe('no blanket floor inheritance for PII types', () => {
    it('does NOT gate the whole route with a single authorizeAdmin(request, "support")', () => {
      // Either quote style.
      expect(SRC).not.toMatch(/authorizeAdmin\(\s*request\s*,\s*['"]support['"]\s*\)/);
    });

    it('gates per-type via config.level (the tier is data-driven, not hard-coded)', () => {
      expect(SRC).toMatch(/authorizeAdmin\(\s*request\s*,\s*config\.level\s*\)/);
    });

    it('calls authorizeAdmin exactly once (one per-type gate, not a mix of gates)', () => {
      const count = (SRC.match(/authorizeAdmin\(/g) || []).length;
      expect(count).toBe(1);
    });

    it('declares no PII type at a tier below super_admin', () => {
      const belowSuper = PII_TYPES.filter((t) => levelForType(t) !== 'super_admin');
      expect(belowSuper).toEqual([]);
    });
  });

  // ── 4. Safe default for a missing `type` ──────────────────────────────────
  describe('missing-type default is the safest tier', () => {
    it("defaults a missing `type` to 'students'", () => {
      expect(SRC).toMatch(/params\.get\(\s*['"]type['"]\s*\)\s*\|\|\s*['"]students['"]/);
    });

    it("the default 'students' resolves to super_admin (not the old support floor)", () => {
      expect(levelForType('students')).toBe('super_admin');
    });
  });
});
