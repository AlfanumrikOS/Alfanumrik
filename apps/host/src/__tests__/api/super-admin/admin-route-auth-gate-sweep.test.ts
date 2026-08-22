/**
 * SAO-7 (Cycle 6 — Super-Admin & Observability) — FULL admin-route auth-gate sweep.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Cycle 6 audit could only read ~10 of the ~134 admin route files line-by-line.
 * A `Grep` confirmed an auth-gate TOKEN exists in all of them, but nothing
 * MECHANICALLY pins it: a future edit (or a brand-new admin route) could ship a
 * handler that does DB I/O before authorizing, or drops the gate entirely. This
 * is a P9 (RBAC enforcement) hole class. This sweep closes it for every current
 * route and every route added later — a new ungated admin route turns this red.
 *
 * This is a complement to the BEHAVIORAL gate tests
 * (`internal-admin-secret-gate.test.ts`, `mutation-gate-pins.test.ts`,
 * `impersonate-gate.test.ts`, ...), which prove the gate actually denies at
 * runtime for a representative subset. This file is a STATIC source sweep over
 * 100% of the admin surface — breadth, not depth.
 *
 * SCOPE (enumerated dynamically, never hard-coded)
 * ------------------------------------------------
 *   - src/app/api/super-admin/ (recursive route.ts)   Gate A: authorizeAdmin(level)
 *   - src/app/api/v1/admin/ (recursive route.ts)       Gate B: authorizeRequest('perm')
 *   - src/app/api/internal/admin/ (recursive route.ts) Gate C: requireAdminSecret(req)
 *
 * CANONICAL GATES (from src/lib/admin-auth.ts + 01-map.md)
 *   Gate A  `authorizeAdmin(request, level)`     — session + admin-level ladder
 *   Gate B  `authorizeRequest(request, 'code')`  — RBAC permission check
 *   Gate C  `requireAdminSecret(request)`        — constant-time x-admin-secret
 *
 * SESSION-BOUNDARY EXCEPTIONS
 *   `super-admin/login/route.ts` is the credential-establishing endpoint. It
 *   CANNOT gate on being-already-an-admin (chicken-and-egg). It performs its own
 *   verification: per-IP rate limit + per-email lockout → GoTrue password grant
 *   → `admin_users` membership confirm (01-map.md "Login"). It is allowlisted
 *   below WITH that justification — not a P9 hole.
 *
 *   `super-admin/logout/route.ts` is the credential-destroying endpoint. It
 *   must remain callable when a session is expired or otherwise no longer
 *   authorizable so its HttpOnly SSR cookies can still be removed. It rejects
 *   cross-origin POSTs, only calls GoTrue local sign-out, and only expires the
 *   caller's own auth-cookie names; it performs no privileged application-data
 *   read or mutation. Requiring authorizeAdmin here would strand stale
 *   HttpOnly cookies, so this narrow session-termination route is allowlisted.
 *
 * THREE ASSERTIONS
 *   1. PRESENCE (hard fail): every non-allowlisted route file contains at least
 *      one canonical gate token. Any file with none is a real P9 hole → FAIL +
 *      list it.
 *   2. ORDERING (hard fail): within each exported handler (GET/POST/PUT/PATCH/
 *      DELETE) that performs DB I/O, a gate token appears BEFORE the first DB
 *      marker in that handler's body. A handler whose gate sits AFTER its first
 *      DB call is a real ordering hole → FAIL.
 *   3. STRENGTHENED ORDERING (hard fail, with documented escape hatch): a handler
 *      that performs DB I/O must contain the gate token IN ITS OWN BODY (so the
 *      gate-before-DB proof is local and statically clear). Handlers that gate
 *      via an out-of-body helper cannot be statically verified and must be added
 *      to UNVERIFIED_ALLOWLIST with a justification — that keeps the guard strong
 *      while leaving a non-weakening escape hatch. Currently EMPTY (all 207
 *      handlers verify locally).
 *
 * DB-MARKER set (start of real DB I/O in these routes):
 *   `.from(`, `.rpc(`, `supabaseAdminUrl(`, `getSupabaseAdmin(`,
 *   `createClient(`, `createServerClient(`.
 *
 * HANDLER-BODY extraction is a brace-matched slice from the `export ... METHOD`
 * declaration. It is intentionally simple (no full TS parse). If a future file's
 * braces-in-strings defeat the matcher, the worst case is a surfaced false
 * positive a human reviews — acceptable for a guard. It currently yields a clean
 * 207/207, so the simple matcher is sufficient.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const ADMIN_ROUTE_ROOTS = [
  'src/app/api/super-admin',
  'src/app/api/v1/admin',
  'src/app/api/internal/admin',
].map((p) => path.join(REPO_ROOT, p));

// Session-boundary endpoints either establish or destroy the caller's own
// admin session and therefore cannot require an already-valid admin session.
// Paths are repo-relative, POSIX-normalized.
const SESSION_BOUNDARY_ALLOWLIST = new Set<string>([
  'src/app/api/super-admin/login/route.ts', // GoTrue password grant + admin_users confirm + rate-limit/lockout
  'src/app/api/super-admin/logout/route.ts', // same-origin caller-cookie expiry; no application-data access
]);

// Handlers that gate via an out-of-body helper (gate token NOT in the handler's
// own body) and therefore cannot have gate-before-DB statically proven locally.
// EMPTY today — every DB-touching handler verifies locally. Adding an entry here
// is a documented, reviewed exception, NOT a weakening of the assertion.
const UNVERIFIED_ALLOWLIST = new Set<string>([]);

const GATE_TOKEN = /authorizeAdmin\s*\(|authorizeRequest\s*\(|requireAdminSecret\s*\(/;
const GATE_TOKEN_G = /authorizeAdmin\s*\(|authorizeRequest\s*\(|requireAdminSecret\s*\(/g;
const DB_MARKER_G =
  /\.from\s*\(|\.rpc\s*\(|supabaseAdminUrl\s*\(|getSupabaseAdmin\s*\(|createClient\s*\(|createServerClient\s*\(/g;
const HANDLER_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function relPosix(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/** Recursively collect every `route.ts` under a root (dir may not exist → []). */
function collectRouteFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (name === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

/** Brace-matched body of each exported handler in `src`. */
function extractHandlerBodies(src: string): Array<{ method: string; body: string }> {
  const bodies: Array<{ method: string; body: string }> = [];
  for (const method of HANDLER_METHODS) {
    const fnDecl = new RegExp('export\\s+async\\s+function\\s+' + method + '\\s*\\(');
    const constDecl = new RegExp('export\\s+const\\s+' + method + '\\s*[=:]');
    let idx = src.search(fnDecl);
    if (idx < 0) idx = src.search(constDecl);
    if (idx < 0) continue;
    const open = src.indexOf('{', idx);
    if (open < 0) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    bodies.push({ method, body: src.slice(idx, i) });
  }
  return bodies;
}

const ALL_ROUTE_FILES = ADMIN_ROUTE_ROOTS.flatMap(collectRouteFiles)
  .map(relPosix)
  .sort();

describe('SAO-7 — admin-route auth-gate sweep (P9)', () => {
  it('enumerates the full admin route surface (glob/path sanity)', () => {
    const superAdmin = ALL_ROUTE_FILES.filter((f) => f.startsWith('src/app/api/super-admin/'));
    const v1Admin = ALL_ROUTE_FILES.filter((f) => f.startsWith('src/app/api/v1/admin/'));
    const internalAdmin = ALL_ROUTE_FILES.filter((f) =>
      f.startsWith('src/app/api/internal/admin/'),
    );

    // Floors guard against a future refactor silently moving routes out of these
    // trees (which would make the sweep vacuously pass on an empty set).
    expect(superAdmin.length).toBeGreaterThanOrEqual(119);
    expect(v1Admin.length).toBeGreaterThanOrEqual(2);
    expect(internalAdmin.length).toBeGreaterThanOrEqual(13);
    expect(ALL_ROUTE_FILES.length).toBeGreaterThanOrEqual(134);
  });

  it('every admin route file has a canonical authorization gate token (presence)', () => {
    const missingGate: string[] = [];
    for (const rel of ALL_ROUTE_FILES) {
      if (SESSION_BOUNDARY_ALLOWLIST.has(rel)) continue;
      const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      if (!GATE_TOKEN.test(src)) missingGate.push(rel);
    }
    // If this list is non-empty, those routes import NO authorizeAdmin /
    // authorizeRequest / requireAdminSecret — a real P9 hole. Expected: [].
    expect(missingGate).toEqual([]);
  });

  it('no handler performs DB I/O before its authorization gate (ordering)', () => {
    const gateAfterDb: string[] = []; // gate token present in body but AFTER first DB marker
    for (const rel of ALL_ROUTE_FILES) {
      if (SESSION_BOUNDARY_ALLOWLIST.has(rel)) continue;
      const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const { method, body } of extractHandlerBodies(src)) {
        GATE_TOKEN_G.lastIndex = 0;
        DB_MARKER_G.lastIndex = 0;
        const gateHit = GATE_TOKEN_G.exec(body);
        const dbHit = DB_MARKER_G.exec(body);
        if (!dbHit) continue; // handler does no DB I/O — nothing to order
        if (gateHit && gateHit.index < dbHit.index) continue; // gate-before-DB: OK
        if (gateHit && gateHit.index > dbHit.index) {
          gateAfterDb.push(`${rel} :: ${method}`);
        }
        // gateHit === null is handled by the strengthened-ordering test below.
      }
    }
    expect(gateAfterDb).toEqual([]);
  });

  it('every DB-touching handler proves gate-before-DB LOCALLY (strengthened ordering)', () => {
    const unverified: string[] = []; // DB marker present, but NO gate token in this handler body
    for (const rel of ALL_ROUTE_FILES) {
      if (SESSION_BOUNDARY_ALLOWLIST.has(rel)) continue;
      const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const { method, body } of extractHandlerBodies(src)) {
        GATE_TOKEN_G.lastIndex = 0;
        DB_MARKER_G.lastIndex = 0;
        const gateHit = GATE_TOKEN_G.exec(body);
        const dbHit = DB_MARKER_G.exec(body);
        if (!dbHit) continue;
        if (!gateHit) {
          const key = `${rel} :: ${method}`;
          if (!UNVERIFIED_ALLOWLIST.has(key)) unverified.push(key);
        }
      }
    }
    // Expected []: every DB-touching handler contains its gate inline, so
    // gate-before-DB is statically provable. A future helper-gated handler that
    // trips this should be inlined OR added to UNVERIFIED_ALLOWLIST with a
    // justification — never by deleting this assertion.
    expect(unverified).toEqual([]);
  });
});
