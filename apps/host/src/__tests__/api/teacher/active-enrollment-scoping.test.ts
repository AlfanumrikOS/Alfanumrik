import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tier-2 PR A (engineering-audit remediation) — teacher/enrollment `is_active`
 * scoping (P8-adjacent). Catalog: REG-201.
 *
 * THE CHANGE UNDER TEST (3 edits)
 * ===============================
 *   1. `src/app/api/teacher/remediation/route.ts` — the `class_enrollments` roster
 *      lookup adds `.eq('is_active', true)`. A soft-de-enrolled student
 *      (is_active=false) is no longer on the caller's roster, so they cannot be
 *      assigned remediation.
 *   2. `src/app/api/teacher/parent-notify/route.ts` — the SAME `.eq('is_active',
 *      true)` is added to its `class_enrollments` roster lookup. A de-enrolled
 *      student no longer triggers a parent-notify.
 *   3. `src/app/api/schools/enroll/route.ts` — the off-path `class_enrollments`
 *      upsert conflict payload adds `is_active: true`, so a re-enroll RESTORES
 *      the active flag (parity with the seat-enforced RPC path).
 *
 * WHY IT MATTERS (P8 boundary)
 * ----------------------------
 * Both teacher roster lookups run on the RLS-BYPASSING admin client
 * (`supabaseAdmin`). The `.eq('is_active', true)` filter is therefore the ONLY
 * boundary keeping a soft-de-enrolled student out of the teacher's roster on
 * these two routes — there is no RLS backstop on a service-role read. Dropping it
 * re-opens the divergence where a de-enrolled student stays reachable.
 *
 * ─── Lane note (why this is a SOURCE-level pin, not a behavioural test) ───────
 * These routes read through the admin client and the unit lane has NO live
 * Postgres. The established convention for "the filter IS the boundary" pins on
 * admin-client reads is source-level (see the admin-route auth-gate sweep
 * `api/super-admin/admin-route-auth-gate-sweep.test.ts` and the TSB-4 migration
 * shape pin `tsb4-class-membership-softdelete-sync.test.ts`): assert the exact
 * shape of the route source, comment-stripped, because the shape IS the
 * guarantee. The behavioural proof ("de-enrolled student → 403 on remediation")
 * would need a live DB and is deferred to an integration lane.
 *
 * Owner: testing.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
// Monorepo root (one level above `apps/host`) — needed to resolve
// `packages/lib/src/rbac.ts`, which lives outside the `apps/host` app root.
const MONOREPO_ROOT = resolve(REPO_ROOT, '..', '..');

function resolveRepo(rel: string): string {
  for (const c of [
    resolve(REPO_ROOT, rel),
    resolve(process.cwd(), rel),
    resolve(MONOREPO_ROOT, rel),
  ]) {
    if (existsSync(c)) return c;
  }
  return resolve(REPO_ROOT, rel);
}

/**
 * Strip TS comments so the assertions inspect EXECUTABLE source only. CRITICAL
 * here: every route's header JSDoc narrates the roster join, "class_enrollments",
 * "class_teachers", "is_active", etc. as prose. Without stripping, an assertion
 * could pass against a comment even if the live filter were removed (vacuous).
 * Strips `/* block *​/` (incl. JSDoc) first, then `// line` comments.
 */
function stripComments(src: string): string {
  return src
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function readSource(rel: string): string {
  return stripComments(readFileSync(resolveRepo(rel), 'utf8'));
}

/**
 * Extract the `.from('<table>')` query-builder chain as a single whitespace-
 * collapsed string: from the `.from('<table>')` token through the first
 * terminator (`.maybeSingle(` / `.single(` / `;`). Returns null when the table
 * is never queried. Lets us assert a filter is ON THE RIGHT chain.
 */
function fromChain(src: string, table: string): string | null {
  const marker = `.from('${table}')`;
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const rest = src.slice(start);
  const termRe = /\.maybeSingle\(|\.single\(|;/;
  const m = termRe.exec(rest);
  const slice = m ? rest.slice(0, m.index + (m[0] === ';' ? 1 : 0)) : rest;
  return slice.replace(/\s+/g, ' ');
}

/**
 * ALL `.from('<table>')` chains in the file, in source order. 2026-07-13
 * (REG-201 canary repair): the original single-chain extractor silently pinned
 * whichever chain appeared FIRST. When the remediation route later gained a
 * second, earlier `class_enrollments` read (the bulk teacher-classes roster
 * builder for GET), the canary started asserting student-scoping against the
 * bulk chain — a false positive of the extractor, not a P8 regression (the
 * student-scoped membership check still exists, still is_active-filtered).
 * Asserting over EVERY chain is strictly stronger: no enrollment read can now
 * appear anywhere in the file without carrying its boundary filters.
 */
function fromChains(src: string, table: string): string[] {
  const marker = `.from('${table}')`;
  const chains: string[] = [];
  let idx = src.indexOf(marker);
  while (idx !== -1) {
    const rest = src.slice(idx);
    const termRe = /\.maybeSingle\(|\.single\(|;/;
    const m = termRe.exec(rest);
    const slice = m ? rest.slice(0, m.index + (m[0] === ';' ? 1 : 0)) : rest;
    chains.push(slice.replace(/\s+/g, ' '));
    idx = src.indexOf(marker, idx + marker.length);
  }
  return chains;
}

const REMEDIATION = 'src/app/api/teacher/remediation/route.ts';
const PARENT_NOTIFY = 'src/app/api/teacher/parent-notify/route.ts';
const ENROLL = 'src/app/api/schools/enroll/route.ts';
const RBAC = 'packages/lib/src/rbac.ts';

const TEACHER_ROUTES: Array<[string, string]> = [
  ['remediation', REMEDIATION],
  ['parent-notify', PARENT_NOTIFY],
];

// ─── 2026-07-20 update (teacher-dashboard deep RCA canonicalization) ───────
// Both teacher/remediation and teacher/parent-notify no longer inline their
// own class_teachers/class_enrollments roster queries — they delegate to the
// SINGLE canonical resolver `resolveTeacherIdentity` + `resolveTeacherRosterScope`
// in `packages/lib/src/rbac.ts` (the same module `canAccessStudent` lives in).
// The is_active-scoping INVARIANT this file pins is therefore now enforced
// at the canonical-resolver level, not per-route. This file is updated to:
//   (a) assert both routes DELEGATE (import + call the canonical resolver,
//       and no longer contain their own class_teachers/class_enrollments chain)
//   (b) assert the canonical resolver itself carries the is_active boundary
//       on every class_teachers/class_enrollments chain (the invariant, now
//       centralized rather than duplicated).
// This is a stronger guarantee than the original per-route pin: drift can no
// longer happen independently per-route, because there is only one place
// left to drift.
describe('Tier-2 PR A — teacher/enrollment is_active scoping (P8) — REG-201', () => {
  // ── Assertion 1: both routes delegate to the canonical resolver ──────────
  describe.each(TEACHER_ROUTES)(
    'teacher/%s — delegates to the canonical roster resolver (no local re-implementation)',
    (_name, rel) => {
      const src = readSource(rel);

      it('imports resolveTeacherIdentity and resolveTeacherRosterScope from @alfanumrik/lib/rbac', () => {
        expect(src).toContain('resolveTeacherIdentity');
        expect(src).toContain('resolveTeacherRosterScope');
        expect(src).toContain("from '@alfanumrik/lib/rbac'");
      });

      it('does NOT inline its own class_enrollments or class_teachers roster query', () => {
        expect(fromChains(src, 'class_enrollments').length).toBe(0);
        expect(fromChains(src, 'class_teachers').length).toBe(0);
      });
    },
  );

  // ── Assertion 2: the canonical resolver carries the is_active boundary ───
  // on EVERY class_enrollments / class_teachers chain (canAccessStudent's
  // teacher branch + resolveTeacherRosterScope both live in this file).
  describe('packages/lib/src/rbac.ts (canonical resolver) — class_enrollments reads are is_active + class scoped', () => {
    const src = readSource(RBAC);
    const enrollmentChains = fromChains(src, 'class_enrollments');

    it('queries class_enrollments (non-vacuous: at least one chain with select present)', () => {
      expect(enrollmentChains.length).toBeGreaterThan(0);
      for (const chain of enrollmentChains) {
        expect(chain).toContain(".from('class_enrollments')");
        expect(chain).toContain('.select(');
      }
    });

    it("EVERY class_enrollments chain includes .eq('is_active', true) — the only boundary on an admin-client read", () => {
      for (const chain of enrollmentChains) {
        expect(chain).toContain(".eq('is_active', true)");
      }
    });

    it("EVERY class_enrollments chain is scoped to a class (.in('class_id' or .eq('class_id')", () => {
      for (const chain of enrollmentChains) {
        const classScoped = chain.includes(".in('class_id'") || chain.includes(".eq('class_id'");
        expect(classScoped, `chain missing class scoping: ${chain}`).toBe(true);
      }
    });

    it('at least one chain is the student-scoped membership check (.eq(\'student_id\')', () => {
      const studentScoped = enrollmentChains.filter((c) => c.includes(".eq('student_id'"));
      expect(studentScoped.length).toBeGreaterThan(0);
      for (const chain of studentScoped) {
        expect(chain).toContain(".eq('is_active', true)");
      }
    });
  });

  describe('packages/lib/src/rbac.ts (canonical resolver) — class_teachers reads are is_active-scoped (fail-closed teacher auth)', () => {
    const src = readSource(RBAC);
    const teacherChains = fromChains(src, 'class_teachers');

    it('performs the class_teachers teacher-auth lookup on every chain, is_active-scoped', () => {
      expect(teacherChains.length).toBeGreaterThan(0);
      for (const chain of teacherChains) {
        expect(chain).toContain(".from('class_teachers')");
        expect(chain).toContain(".eq('teacher_id'");
        expect(chain).toContain(".eq('is_active', true)");
      }
    });
  });

  // ── Assertion 3: schools/enroll upsert restores is_active on re-enroll ────
  describe('schools/enroll — class_enrollments upsert restores is_active', () => {
    const src = readSource(ENROLL);
    const chain = fromChain(src, 'class_enrollments');

    it('upserts into class_enrollments (non-vacuous: from + upsert present)', () => {
      expect(chain).not.toBeNull();
      expect(chain).toContain(".from('class_enrollments')");
      expect(chain).toContain('.upsert(');
      // The conflict key is the natural (class, student) key.
      expect(chain).toContain("onConflict: 'class_id,student_id'");
    });

    it('the upsert conflict payload sets is_active: true', () => {
      expect(chain).toContain('is_active: true');
    });
  });
});
