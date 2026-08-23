/**
 * RBAC Permission-Code Drift Guard  (portal RBAC remediation — Phase 0 CI guard)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS
 *   The portal RBAC remediation was triggered by a whole CLASS of latent bug:
 *   an API route authorizes against a permission CODE that is granted to NO
 *   role. Because authorizeRequest()/authorizeSchoolAdmin() resolve the caller's
 *   granted codes from the DB (role_permissions), a code that no role holds 403s
 *   EVERY non-super-admin caller — silently, with no compile-time or test
 *   signal. The original instances were:
 *     - /api/teacher/modules        → 'teacher.read'        (granted to no role
 *                                      → every teacher 403'd; now fixed to
 *                                      'class.view_analytics')
 *     - /api/school-admin/exams/**  → 'school.manage_exams' (existed in no role
 *                                      → every school admin 403'd; now seeded +
 *                                      granted by migration 20260620000000)
 *
 *   This test is the standing CI guard that makes that bug class impossible to
 *   reintroduce: it statically scans every `src/app/api/**\/route.ts` for the
 *   permission-code string literals passed to authorizeRequest(request, '<code>')
 *   and authorizeSchoolAdmin(request, '<code>'), then asserts each referenced
 *   code is resolvable to a role in the canonical SQL permission registry.
 *
 * THE SCHOOLADMINPERMISSIONCODE({off,on}) BLIND SPOT (E2E fix pass, 2026-06-16)
 *   The original regex ONLY matched the two literal helpers above. But many
 *   school-admin routes do NOT pass a literal — they pass a flag-conditional
 *   selector:
 *       authorizeSchoolAdmin(request,
 *         await schoolAdminPermissionCode({ off: 'school.manage_api_keys',
 *                                           on:  'institution.manage' }))
 *   schoolAdminPermissionCode (src/lib/school-admin/permission-code.ts) returns
 *   the `off` code while ff_school_admin_rbac is OFF (today's prod default) and
 *   the `on` code while ON. BOTH codes are live authorization targets — whichever
 *   the flag selects is handed straight to authorizeRequest. The drift-guard's
 *   regex never saw inside the object literal, so when `school.manage_api_keys`
 *   (the `off` code on the api-keys route) was granted to NO role, the guard
 *   stayed GREEN while EVERY school admin 403'd on the API-keys console with the
 *   flag OFF — exactly the bug class this guard exists to kill, slipping through
 *   the one extraction path it didn't cover.
 *
 *   FIX: this guard now ALSO extracts the off:/on: string literals from every
 *   schoolAdminPermissionCode({ ... }) call and treats each as a route-referenced
 *   code subject to the same "must resolve to a granted role" invariant. With
 *   `school.manage_api_keys` seeded + granted to institution_admin by migration
 *   20260620000500, both arms of every selector now resolve and the guard is GREEN
 *   by genuine grant. Reintroducing an ungranted code in EITHER arm now fails.
 *
 * CANONICAL REGISTRY (single source of truth = the SQL migrations, NOT the TS
 *   PERMISSIONS enum in src/lib/rbac.ts)
 *   The TS `PERMISSIONS` enum is a typing convenience and is INCOMPLETE (it omits
 *   e.g. school.manage_exams, school.manage_modules, class.assign_remediation,
 *   competition.access). The authoritative answer to "is this code granted to a
 *   role?" lives in the migrations:
 *     - A code seeded into the `permissions` table (INSERT INTO permissions ...
 *       VALUES) is held by `admin` + `super_admin` via the wildcard CROSS JOIN
 *       grants in 20260612123200_rbac_matrix_conformance.sql, AND every other
 *       role that lists it in an explicit `p.code IN ( ... )` grant block.
 *     - We therefore treat the canonical "resolvable" universe as: every code
 *       seeded into `permissions` ∪ every code named in an explicit grant block,
 *       across ALL applied migration SQL (root + _legacy chain). A code in that
 *       union is held by at least one role; a code outside it is held by NONE.
 *
 * KNOWN PRE-EXISTING DRIFT (documented, tracked — NOT swept under the rug)
 *   Two route-referenced codes are ALREADY orphaned today (predate this Phase 0
 *   work). They are listed explicitly in KNOWN_UNGRANTED_CODES with a reason +
 *   owner so this guard is GREEN now while loudly documenting the debt. Any NEW
 *   orphan code (not in that list) fails the suite. See the per-entry comments
 *   and the test report for the owning-agent handoff.
 *
 * Pattern: offline + deterministic, mirrors
 *   src/__tests__/lib/rbac/matrix-conformance.test.ts (migration-file static
 *   analysis) — no Supabase connection, no network.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = process.cwd();
const API_ROOT = resolve(REPO_ROOT, 'src/app/api');
const MIGRATION_DIRS = [
  'supabase/migrations',
  'supabase/migrations/_legacy',
  'supabase/migrations/_legacy/timestamped',
];

// A permission code is dot-separated lowercase-with-underscores segments.
//
// THE THREE-SEGMENT BLIND SPOT (SEV1 fix pass, 2026-08-11)
//   This was `/^[a-z_]+\.[a-z_]+$/` — exactly TWO segments — and every
//   extraction regex below hard-coded the same two-segment shape. Most codes
//   are `resource.action`, but the registry genuinely contains THREE-segment
//   codes too (e.g. 'super_admin.subjects.manage', seeded in
//   20260612123200_rbac_matrix_conformance.sql). Because the extractor required
//   a closing quote immediately after the second segment, any three-segment
//   literal simply never matched — the guard did not judge it and pass it, it
//   never SAW it.
//
//   That is precisely how `/api/student/engagement` shipped authorizing against
//   'student.profile.read' — a code granted to no role, which 403'd 100% of
//   students — while this suite stayed green. The guard's own regex, not its
//   logic, was the hole.
//
//   FIX: all four patterns now accept `[a-z_]+(?:\.[a-z_]+)+` (two OR MORE
//   segments). Re-scanning with the widened pattern raised the extracted-ref
//   count from 258 to 271 and surfaced exactly one orphan repo-wide
//   ('student.profile.read'), now repointed to 'progress.view_own'.
const CODE_RE = /^[a-z_]+(?:\.[a-z_]+)+$/;

// Shared segment pattern for every extractor below. Keeping it in one place
// stops the four regexes from drifting apart again.
const CODE_SEGMENTS = '[a-z_]+(?:\\.[a-z_]+)+';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Collect every permission-code literal referenced by an API route.
// ─────────────────────────────────────────────────────────────────────────────

interface RouteCodeRef {
  code: string;
  file: string; // repo-relative
}

function walkRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkRouteFiles(full));
    } else if (entry === 'route.ts' || entry === 'route.tsx') {
      out.push(full);
    }
  }
  return out;
}

// Matches authorizeRequest(request, 'code'  AND authorizeSchoolAdmin(request, 'code'
// — the two RBAC-registry helpers. (authorizeAdmin(request, '<AdminLevel>') is a
// SEPARATE admin-level auth system that takes an admin tier, not a permission
// code, so it is intentionally excluded.)
// Built from CODE_SEGMENTS so it accepts three-segment codes — see the blind-spot
// note on CODE_RE above.
const AUTHORIZE_CALL_RE = new RegExp(
  `authorize(?:Request|SchoolAdmin)\\(\\s*request\\s*,\\s*['"](${CODE_SEGMENTS})['"]`,
  'g',
);

// Matches schoolAdminPermissionCode({ off: 'code', on: 'code' }) — the
// flag-conditional selector whose result is handed to authorizeSchoolAdmin. BOTH
// the off and on codes are live authorization targets (the flag picks one at
// runtime), so BOTH must resolve to a granted role. The `off` arm in particular
// is the one the regex above never saw — and the exact arm where
// `school.manage_api_keys` 403'd undetected. Order-independent (off-then-on and
// on-then-off both occur in the tree), so two passes, one per key.
const SAPC_OFF_RE = new RegExp(
  `schoolAdminPermissionCode\\(\\s*\\{[^}]*\\boff\\s*:\\s*['"](${CODE_SEGMENTS})['"]`,
  'g',
);
const SAPC_ON_RE = new RegExp(
  `schoolAdminPermissionCode\\(\\s*\\{[^}]*\\bon\\s*:\\s*['"](${CODE_SEGMENTS})['"]`,
  'g',
);

function collectRouteCodeRefs(): RouteCodeRef[] {
  const files = walkRouteFiles(API_ROOT);
  const refs: RouteCodeRef[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/');
    let m: RegExpExecArray | null;

    AUTHORIZE_CALL_RE.lastIndex = 0;
    while ((m = AUTHORIZE_CALL_RE.exec(src))) {
      refs.push({ code: m[1], file: rel });
    }

    // schoolAdminPermissionCode({ off, on }) — extract BOTH arms. Each is a code
    // authorizeSchoolAdmin may receive depending on ff_school_admin_rbac, so each
    // is subject to the same "granted to ≥1 role" invariant.
    SAPC_OFF_RE.lastIndex = 0;
    while ((m = SAPC_OFF_RE.exec(src))) {
      refs.push({ code: m[1], file: rel });
    }
    SAPC_ON_RE.lastIndex = 0;
    while ((m = SAPC_ON_RE.exec(src))) {
      refs.push({ code: m[1], file: rel });
    }
  }
  return refs;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Build the canonical "granted to at least one role" code universe from SQL.
// ─────────────────────────────────────────────────────────────────────────────

function buildCanonicalCodeUniverse(): {
  definedInPermissions: Set<string>;
  explicitlyGranted: Set<string>;
  universe: Set<string>;
} {
  const definedInPermissions = new Set<string>();
  const explicitlyGranted = new Set<string>();

  for (const rel of MIGRATION_DIRS) {
    const dir = resolve(REPO_ROOT, rel);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    } catch {
      continue; // dir may not exist on a partial checkout
    }
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');

      // (a) codes seeded into the permissions table:
      //     INSERT INTO permissions ... VALUES ('code', 'resource', ...), ...;
      //     The tuple ALWAYS leads with the code as the first quoted value.
      // NOTE: these three SQL extractors are ALSO built from CODE_SEGMENTS. They
      // had the identical two-segment limit, which meant granted three-segment
      // codes (e.g. 'super_admin.subjects.manage') never entered the canonical
      // universe. Widening the route-side regex alone would therefore have
      // turned every such code into a FALSE POSITIVE. Both sides must move
      // together.
      const permBlocks = sql.match(/INSERT INTO permissions[\s\S]*?;/gi) || [];
      for (const block of permBlocks) {
        const tupleRe = new RegExp(`\\(\\s*'(${CODE_SEGMENTS})'\\s*,`, 'g');
        let m: RegExpExecArray | null;
        while ((m = tupleRe.exec(block))) definedInPermissions.add(m[1]);
      }

      // (b) codes named in an explicit grant block: WHERE ... p.code IN ( ... )
      const inBlocks = sql.match(/p\.code\s+IN\s*\(([\s\S]*?)\)/gi) || [];
      for (const block of inBlocks) {
        const cRe = new RegExp(`'(${CODE_SEGMENTS})'`, 'g');
        let m: RegExpExecArray | null;
        while ((m = cRe.exec(block))) explicitlyGranted.add(m[1]);
      }

      // (c) single-code grant: WHERE ... p.code = 'code'
      const eqMatches = sql.match(new RegExp(`p\\.code\\s*=\\s*'${CODE_SEGMENTS}'`, 'gi')) || [];
      for (const expr of eqMatches) {
        const m = expr.match(new RegExp(`'(${CODE_SEGMENTS})'`));
        if (m) explicitlyGranted.add(m[1]);
      }
    }
  }

  const universe = new Set<string>([...definedInPermissions, ...explicitlyGranted]);
  return { definedInPermissions, explicitlyGranted, universe };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. KNOWN PRE-EXISTING DRIFT — documented exceptions (NOT new debt).
//    Each entry is a route-referenced code that is currently granted to no role.
//    Keep this list SHRINKING. Adding to it requires the owning agent to fix the
//    grant; it exists only so this guard ships GREEN while the standing debt is
//    visible. A NEW orphan code (absent here) fails the suite immediately.
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_UNGRANTED_CODES: Record<string, string> = {
  // Flag-gated, drafted-but-unapplied migration (20260616010000). The route
  // (/api/school-admin/ai-assistant) gates on ff_principal_ai_v1 BEFORE authz,
  // so the code is never actually checked while OFF. INTENTIONAL — Phase 3 will
  // apply the migration that seeds + grants it (principal-only). Owner: architect.
  'institution.use_principal_ai':
    'Flag-gated (ff_principal_ai_v1) + grant ships in drafted Phase-3 migration 20260616010000; route returns 503 before authz while OFF.',

  // RESOLVED 2026-06-16 (Phase 0 continuation, migration 20260620000100):
  //   - 'content.read'          — SEEDED + granted to student/teacher/admin/super_admin.
  //   - 'alfabot.read_messages' — SEEDED + granted to super_admin.
  // Both now resolve in the canonical universe, so they are removed from this
  // whitelist; the guard stays GREEN by genuine grant, not by exception.
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures (built once)
// ─────────────────────────────────────────────────────────────────────────────

const routeRefs = collectRouteCodeRefs();
const { definedInPermissions, explicitlyGranted, universe } = buildCanonicalCodeUniverse();

// ═════════════════════════════════════════════════════════════════════════════

describe('RBAC permission-code drift guard — harness sanity', () => {
  it('scanned a meaningful number of authorize() call sites', () => {
    // If this drops near zero the regex or the API tree moved — fail loudly so
    // the guard can never silently become a no-op.
    expect(routeRefs.length).toBeGreaterThan(100);
  });

  it('built a non-trivial canonical permission universe from the migrations', () => {
    expect(definedInPermissions.size).toBeGreaterThan(50);
    expect(universe.size).toBeGreaterThanOrEqual(definedInPermissions.size);
    // Sanity anchors: codes every developer expects to be granted.
    for (const anchor of [
      'quiz.attempt',
      'foxy.chat',
      'class.view_analytics',
      'super_admin.access',
      'study_plan.view',
    ]) {
      expect(universe.has(anchor)).toBe(true);
    }
  });

  it('every referenced code is well-formed (resource.action)', () => {
    for (const { code } of routeRefs) {
      expect(code).toMatch(CODE_RE);
    }
  });
});

describe('RBAC permission-code drift guard — every route code resolves to a role', () => {
  // The core invariant. Build the offenders list once for a single, readable
  // assertion that names every drifting (code → route) pair.
  const offenders = routeRefs
    .filter((r) => !universe.has(r.code) && !(r.code in KNOWN_UNGRANTED_CODES))
    .map((r) => `${r.code}  ←  ${r.file}`);

  it('NO route authorizes against a code granted to no role (excluding documented known-drift)', () => {
    expect(
      offenders,
      `These routes reference permission codes that are granted to NO role in any ` +
        `migration (they 403 every non-super-admin caller). Either seed+grant the ` +
        `code, repoint the route to an already-granted code, or — if intentional — ` +
        `add it to KNOWN_UNGRANTED_CODES with a reason + owner:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it.each([...new Set(routeRefs.map((r) => r.code))].sort())(
    'code "%s" is resolvable (canonical or documented known-drift)',
    (code) => {
      expect(universe.has(code) || code in KNOWN_UNGRANTED_CODES).toBe(true);
    },
  );
});

describe('RBAC permission-code drift guard — Phase 0 fixes locked in', () => {
  it('would have CAUGHT the original "teacher.read" bug (the code is granted to no role)', () => {
    // The bug class regression anchor: 'teacher.read' was the orphan code. If a
    // future change reintroduces it as a route literal, the core assertion above
    // fails. Here we prove the guard's premise: teacher.read is NOT in the
    // canonical universe and is NOT whitelisted — so any route using it offends.
    expect(universe.has('teacher.read')).toBe(false);
    expect('teacher.read' in KNOWN_UNGRANTED_CODES).toBe(false);
  });

  it('proves the fix: no route still authorizes against "teacher.read"', () => {
    const stillUsingTeacherRead = routeRefs.filter((r) => r.code === 'teacher.read');
    expect(stillUsingTeacherRead).toEqual([]);
  });

  it('the replacement code "class.view_analytics" IS granted and IS used by /api/teacher/modules', () => {
    expect(universe.has('class.view_analytics')).toBe(true);
    const modulesRef = routeRefs.find(
      (r) => r.file.endsWith('/api/teacher/modules/route.ts'),
    );
    expect(modulesRef).toBeDefined();
    expect(modulesRef!.code).toBe('class.view_analytics');
  });

  it('proves the fix: "school.manage_exams" now exists in the canonical universe (migration 20260620000000)', () => {
    expect(universe.has('school.manage_exams')).toBe(true);
    // It is referenced by the school-admin exams route, which now resolves.
    const examsRefs = routeRefs.filter((r) =>
      r.file.endsWith('/api/school-admin/exams/route.ts'),
    );
    expect(examsRefs.length).toBeGreaterThan(0);
    for (const ref of examsRefs) expect(ref.code).toBe('school.manage_exams');
  });
});

describe('RBAC permission-code drift guard — three-segment blind spot (SEV1 fix, 2026-08-11)', () => {
  // The bug: /api/student/engagement authorized against 'student.profile.read'
  // — granted to no role, so it 403'd 100% of students — and THIS SUITE STAYED
  // GREEN because the old two-segment regex could not match a three-segment
  // literal. These tests pin the widened extraction so the hole cannot reopen.

  it('the extractor now MATCHES a three-segment code literal (it previously could not)', () => {
    const synthetic =
      "const auth = await authorizeRequest(request, 'student.profile.read');";

    // Widened pattern: matches.
    AUTHORIZE_CALL_RE.lastIndex = 0;
    const m = AUTHORIZE_CALL_RE.exec(synthetic);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('student.profile.read');

    // The OLD two-segment pattern, reconstructed here, does NOT match — this is
    // the precise reason the original defect shipped undetected.
    const legacyTwoSegment =
      /authorize(?:Request|SchoolAdmin)\(\s*request\s*,\s*['"]([a-z_]+\.[a-z_]+)['"]/g;
    expect(legacyTwoSegment.exec(synthetic)).toBeNull();
  });

  it('would have CAUGHT the bug: "student.profile.read" is granted to no role', () => {
    expect(universe.has('student.profile.read')).toBe(false);
    expect('student.profile.read' in KNOWN_UNGRANTED_CODES).toBe(false);
    // => had it remained in a route, the widened extractor would surface it and
    //    the core "every route code resolves" assertion would fail.
  });

  it('proves the fix: no route authorizes against "student.profile.read" any more', () => {
    expect(routeRefs.filter((r) => r.code === 'student.profile.read')).toEqual([]);
  });

  it('the replacement "progress.view_own" IS granted AND IS used by /api/student/engagement', () => {
    expect(universe.has('progress.view_own')).toBe(true);
    const ref = routeRefs.find((r) =>
      r.file.endsWith('/api/student/engagement/route.ts'),
    );
    expect(ref).toBeDefined();
    expect(ref!.code).toBe('progress.view_own');
  });

  it('widening did not break the SQL side: granted three-segment codes still resolve', () => {
    // 'super_admin.subjects.manage' is a real three-segment code seeded in
    // 20260612123200. If only the route-side regex had been widened, this code
    // would have become a false positive. Both sides moved together.
    expect(universe.has('super_admin.subjects.manage')).toBe(true);
  });

  it('the canonical universe contains at least one three-segment code (extractor not a no-op)', () => {
    const threeSegment = [...universe].filter((c) => c.split('.').length > 2);
    expect(threeSegment.length).toBeGreaterThan(0);
  });
});

describe('RBAC permission-code drift guard — schoolAdminPermissionCode({off,on}) coverage (E2E fix pass)', () => {
  // Re-extract directly here so this block proves the EXTENSION itself works,
  // independent of how collectRouteCodeRefs folds the arms into routeRefs.
  function collectSapcCodes(): { off: RouteCodeRef[]; on: RouteCodeRef[] } {
    const files = walkRouteFiles(API_ROOT);
    const off: RouteCodeRef[] = [];
    const on: RouteCodeRef[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/');
      let m: RegExpExecArray | null;
      SAPC_OFF_RE.lastIndex = 0;
      while ((m = SAPC_OFF_RE.exec(src))) off.push({ code: m[1], file: rel });
      SAPC_ON_RE.lastIndex = 0;
      while ((m = SAPC_ON_RE.exec(src))) on.push({ code: m[1], file: rel });
    }
    return { off, on };
  }

  const sapc = collectSapcCodes();

  it('the extension actually finds schoolAdminPermissionCode call sites (not a no-op)', () => {
    // If this drops to zero, the helper was renamed / the regex rotted and the
    // off:/on: blind spot is open again — fail loudly.
    expect(sapc.off.length).toBeGreaterThan(0);
    expect(sapc.on.length).toBeGreaterThan(0);
  });

  it('extracts BOTH the off: AND on: code from a known multi-arm call site (api-keys)', () => {
    const apiKeysOff = sapc.off.filter((r) =>
      r.file.endsWith('/api/school-admin/api-keys/route.ts'),
    );
    const apiKeysOn = sapc.on.filter((r) =>
      r.file.endsWith('/api/school-admin/api-keys/route.ts'),
    );
    // The api-keys route uses { off: 'school.manage_api_keys', on: 'institution.manage' }
    // on all three verbs.
    expect(apiKeysOff.length).toBeGreaterThan(0);
    expect(apiKeysOn.length).toBeGreaterThan(0);
    expect(apiKeysOff.every((r) => r.code === 'school.manage_api_keys')).toBe(true);
    expect(apiKeysOn.every((r) => r.code === 'institution.manage')).toBe(true);
  });

  it('the extracted off:/on: codes are now folded into the main routeRefs set the core assertion scans', () => {
    // The whole point: the core "every route code resolves" assertion must now
    // see school.manage_api_keys. If folding regressed, this catches it.
    const foldedCodes = new Set(routeRefs.map((r) => r.code));
    expect(foldedCodes.has('school.manage_api_keys')).toBe(true);
    expect(foldedCodes.has('institution.manage')).toBe(true);
  });

  it('EVERY off: and on: code resolves to a granted role (the new invariant, now enforced)', () => {
    const all = [...sapc.off, ...sapc.on];
    const offenders = all
      .filter((r) => !universe.has(r.code) && !(r.code in KNOWN_UNGRANTED_CODES))
      .map((r) => `${r.code}  ←  ${r.file}`);
    expect(
      offenders,
      `These schoolAdminPermissionCode({off,on}) arms reference a code granted to ` +
        `NO role — the flag-conditional selector would 403 every school admin in ` +
        `the arm the flag selects:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('REGRESSION: "school.manage_api_keys" (the original blind-spot code) now resolves (migration 20260620000500)', () => {
    // Before the seed+grant migration this code was in NO role, and before this
    // extension the guard could not see it (it lives only in an off: arm). Both
    // gaps are now closed: the code is in the canonical universe AND the guard
    // extracts it. This is the end-to-end proof the blind spot is shut.
    expect(universe.has('school.manage_api_keys')).toBe(true);
  });

  it('would have CAUGHT the original blind spot: an ungranted off:-arm code is now an offender', () => {
    // Simulate the pre-fix world on a synthetic source string: an off: arm whose
    // code is granted to no role. The off-extraction regex must surface it so the
    // core assertion would have failed (proving the guard now covers the path it
    // historically missed).
    const synthetic =
      "authorizeSchoolAdmin(request, await schoolAdminPermissionCode({ off: 'school.totally_ungranted', on: 'institution.manage' }))";
    SAPC_OFF_RE.lastIndex = 0;
    const m = SAPC_OFF_RE.exec(synthetic);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('school.totally_ungranted');
    // And this synthetic code is genuinely absent from the canonical universe,
    // so had it appeared in a real route it would be a hard offender.
    expect(universe.has('school.totally_ungranted')).toBe(false);
  });
});
