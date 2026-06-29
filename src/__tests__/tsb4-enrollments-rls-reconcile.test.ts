import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * TSB-4 (engineering-audit remediation) READY-NOW slices —
 * class_enrollments TEACHER RLS + FAIL-CLOSED is_active reconcile (P8).
 *
 * THE CHANGE UNDER TEST (two migrations)
 * ======================================
 *  A) `20260702050000_class_enrollments_teacher_select_policy.sql`
 *     Adds the MISSING teacher SELECT policy to `class_enrollments`, a
 *     byte-for-byte mirror of the `class_students` teacher policy
 *     (`class_id IN (SELECT ct.class_id FROM class_teachers ct
 *       JOIN teachers t ON t.id = ct.teacher_id WHERE t.auth_user_id = auth.uid())`).
 *     class_enrollments today has ZERO teacher policy, so an assigned teacher on
 *     the RLS client gets ZERO rows from the canonical-by-intent roster. The new
 *     symmetric policy gives an ASSIGNED teacher their classes' rows and a
 *     NON-assigned teacher zero rows. Idempotent (DROP POLICY IF EXISTS → CREATE).
 *
 *  B) `20260702060000_class_membership_isactive_backfill.sql`
 *     A one-time, FAIL-CLOSED reconcile of the rows that diverged BEFORE the
 *     20260702030000 UPDATE-mirror triggers existed. It flips
 *     `class_students.is_active` true→false ONLY where the matching
 *     `class_enrollments` row is ALREADY inactive (direction A — completing an
 *     already-authorized de-enroll; this closes the live P8 leak where a
 *     de-enrolled student stayed teacher-visible via `canAccessStudent`,
 *     src/lib/rbac.ts:331). It NEVER reactivates: the reverse direction
 *     (ce=true / cs=false) is REPORT-ONLY (RAISE NOTICE), never auto-applied —
 *     re-activating would GRANT teacher visibility (authorization-widening). A
 *     service-role-only, RLS-enabled backup table (`_tsb4_isactive_backfill_backup`)
 *     snapshots the changed rows for exact rollback.
 *
 * ─── Lane note (why this is a migration-SHAPE test, not a live-DB test) ──────
 * This repo's `src/__tests__/migrations/**` lane is the LIVE-DB integration lane
 * (gated behind RUN_INTEGRATION_TESTS=1 with real Supabase secrets), so a pure
 * source pin placed there would NOT run in the normal per-PR `npm test` gate.
 * This file therefore lives in the normal lane at the `src/__tests__/` root,
 * matching the sibling REG-200 source pin
 * (`src/__tests__/tsb4-class-membership-softdelete-sync.test.ts`). The convention
 * (see also `slc1-quiz-session-trigger-dedupe.test.ts` and
 * `contract/portal-rbac-remediation-migration-canaries.test.ts`) is SOURCE-LEVEL:
 * assert the exact SHAPE of the migration text, because for a gated migration the
 * shape IS the guarantee. A behavioural proof — "an assigned teacher now reads
 * class_enrollments rows; the fail-closed UPDATE only ever removes visibility" —
 * would need a live DB to apply the policy under RLS, run the UPDATE, and read the
 * counterpart row back. That belongs in the integration lane and is deferred;
 * source pins are the accepted + expected gate for this gated migration content.
 *
 * Owner: testing. Catalog: REG-207.
 */

const POLICY_REL = 'supabase/migrations/20260702050000_class_enrollments_teacher_select_policy.sql';
const BACKFILL_REL = 'supabase/migrations/20260702060000_class_membership_isactive_backfill.sql';
const RBAC_REL = 'src/lib/rbac.ts';

function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function readRaw(rel: string): string {
  const p = resolveRepo(rel);
  return p ? readFileSync(p, 'utf8').replace(/\r/g, '') : '';
}

/**
 * Strip every `-- … (end of line)` comment so the absence-assertions inspect
 * EXECUTABLE SQL only. CRITICAL here: both migrations' ADR headers narrate the
 * things they deliberately do NOT do — "DROP TABLE", "reactivate", "is_active =
 * true", "canAccessStudent", "is_teacher_of", "authorization-widening" — as
 * discussion. Without stripping, every "must NOT contain" assertion below would
 * be a false positive. These migrations use line comments only (no C-style block
 * comments around statements), matching the sibling canary convention.
 */
function executableSql(rel: string): string {
  return readRaw(rel)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const POLICY_PRESENT = resolveRepo(POLICY_REL) !== null;
const BACKFILL_PRESENT = resolveRepo(BACKFILL_REL) !== null;

const POLICY_RAW = readRaw(POLICY_REL);
const POLICY_EXEC = executableSql(POLICY_REL);
const BACKFILL_RAW = readRaw(BACKFILL_REL);
const BACKFILL_EXEC = executableSql(BACKFILL_REL);
const RBAC_RAW = readRaw(RBAC_REL);

// Reference RAW vars so the lint/type lanes treat them as used; the RAW text is
// the comment-inclusive source kept available for ADR-header assertions.
void POLICY_RAW;
void BACKFILL_RAW;

// ════════════════════════════════════════════════════════════════════════════
// 0. Presence + NON-VACUITY. An empty/over-stripped parse must NOT pass green.
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4 enrollments RLS + reconcile: presence + parse non-vacuity', () => {
  it(`${POLICY_REL} exists`, () => {
    expect(POLICY_PRESENT).toBe(true);
  });

  it(`${BACKFILL_REL} exists`, () => {
    expect(BACKFILL_PRESENT).toBe(true);
  });

  it('both comment-stripped active bodies are substantial (not over-stripped empties)', () => {
    expect(POLICY_EXEC.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(150);
    expect(BACKFILL_EXEC.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(300);
    // Both wrap in a single transaction.
    expect(POLICY_EXEC).toMatch(/\bBEGIN\b/);
    expect(POLICY_EXEC).toMatch(/\bCOMMIT\b/);
    expect(BACKFILL_EXEC).toMatch(/\bBEGIN\b/);
    expect(BACKFILL_EXEC).toMatch(/\bCOMMIT\b/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. TEACHER POLICY MIRROR — class_enrollments gains a teacher SELECT policy that
//    mirrors the class_students teacher-policy SHAPE (assigned teacher → rows,
//    non-assigned teacher → zero). Idempotent (DROP POLICY IF EXISTS present).
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4 (050000): teacher SELECT policy mirrors class_students', () => {
  it('creates a policy named class_enrollments_teacher_select ON class_enrollments', () => {
    expect(POLICY_EXEC).toMatch(
      /CREATE\s+POLICY\s+"?class_enrollments_teacher_select"?\s+ON\s+"?public"?\."?class_enrollments"?/i,
    );
  });

  it('the policy is a SELECT policy (not ALL / INSERT / UPDATE / DELETE)', () => {
    // The CREATE POLICY for the teacher grant is FOR SELECT.
    expect(POLICY_EXEC).toMatch(
      /CREATE\s+POLICY\s+"?class_enrollments_teacher_select"?[\s\S]*?FOR\s+SELECT/i,
    );
    // No write-scoped policy slipped in.
    expect(POLICY_EXEC).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i);
  });

  it('the USING clause references class_teachers, teachers, auth_user_id and auth.uid()', () => {
    // The teacher-reachability subquery — byte-for-byte the class_students shape.
    expect(POLICY_EXEC).toMatch(/USING\b/i);
    expect(POLICY_EXEC).toMatch(/class_teachers/i);
    expect(POLICY_EXEC).toMatch(/\bteachers\b/i);
    expect(POLICY_EXEC).toMatch(/auth_user_id/i);
    expect(POLICY_EXEC).toMatch(/"?auth"?\."?uid"?\s*\(\s*\)/i);
    // The shape: class_id IN (SELECT ct.class_id FROM class_teachers ct JOIN teachers t
    //   ... WHERE t.auth_user_id = auth.uid()). Identifiers may be double-quoted.
    expect(POLICY_EXEC).toMatch(
      /class_id"?\s+IN\s*\(\s*SELECT[\s\S]*?class_teachers[\s\S]*?JOIN[\s\S]*?teachers[\s\S]*?auth_user_id"?\s*=\s*"?auth"?\."?uid"?\(\)/i,
    );
  });

  it('is idempotent (DROP POLICY IF EXISTS before CREATE)', () => {
    expect(POLICY_EXEC).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"?class_enrollments_teacher_select"?\s+ON\s+"?public"?\."?class_enrollments"?/i,
    );
  });

  it('does NOT toggle RLS on class_enrollments (already enabled at baseline)', () => {
    expect(POLICY_EXEC).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(POLICY_EXEC).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. RLS ON BACKUP TABLE — the new _tsb4_isactive_backfill_backup table is
//    created WITH RLS enabled AND a service-role-only policy in the SAME
//    migration (P8: every new table gets RLS + policy in its own migration).
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4 (060000): backup table is RLS-protected (service-role only)', () => {
  it('creates _tsb4_isactive_backfill_backup (idempotent CREATE TABLE IF NOT EXISTS)', () => {
    expect(BACKFILL_EXEC).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?public"?\."?_tsb4_isactive_backfill_backup"?/i,
    );
  });

  it('ENABLES row level security on the backup table', () => {
    expect(BACKFILL_EXEC).toMatch(
      /ALTER\s+TABLE\s+"?public"?\."?_tsb4_isactive_backfill_backup"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
  });

  it('adds a service-role-only policy on the backup table', () => {
    expect(BACKFILL_EXEC).toMatch(
      /CREATE\s+POLICY\s+"?_tsb4_isactive_backfill_backup_service_role"?\s+ON\s+"?public"?\."?_tsb4_isactive_backfill_backup"?/i,
    );
    // Gated on the service_role.
    expect(BACKFILL_EXEC).toMatch(
      /USING\s*\(\s*\(?\s*"?auth"?\."?role"?\(\)\s*=\s*'service_role'/i,
    );
    // Idempotent re-create.
    expect(BACKFILL_EXEC).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"?_tsb4_isactive_backfill_backup_service_role"?/i,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. FAIL-CLOSED ONLY (the KEY safety pin) — the reconcile UPDATE sets
//    class_students.is_active = false ONLY, conditioned on
//    ce.is_active=false AND cs.is_active=true. There is NO auto-applied
//    reverse-direction UPDATE that sets class_students.is_active = true.
//    The backfill can only REMOVE visibility, never grant it.
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4 (060000): reconcile is FAIL-CLOSED — only removes visibility', () => {
  it('the reconcile UPDATE on class_students sets is_active = false', () => {
    expect(BACKFILL_EXEC).toMatch(
      /UPDATE\s+"?public"?\."?class_students"?[\s\S]*?SET[\s\S]*?is_active\s*=\s*false/i,
    );
  });

  it('the reconcile is conditioned on ce.is_active=false AND cs.is_active=true (direction A)', () => {
    expect(BACKFILL_EXEC).toMatch(/ce\.is_active\s*=\s*false/i);
    expect(BACKFILL_EXEC).toMatch(/cs\.is_active\s*=\s*true/i);
  });

  it('contains NO UPDATE that sets class_students.is_active = true (no reactivation / no over-grant)', () => {
    // The fail-closed reconcile assigns the UNQUALIFIED column (`SET is_active =
    // false`). Every `is_active = true` in this migration is a table-QUALIFIED
    // READ predicate (`cs.is_active = true` in the count/snapshot/UPDATE WHERE
    // clauses). So an UNQUALIFIED `is_active = true` could ONLY be a reactivation
    // ASSIGNMENT — authorization-widening — and must NOT exist anywhere in active
    // SQL. (Negative lookbehind excludes the qualified `cs.`/`ce.` predicates.)
    expect(BACKFILL_EXEC).not.toMatch(/(?<![\w.])is_active\s*=\s*true/i);
    // And the SET target is is_active = false — visibility is only ever REMOVED.
    expect(BACKFILL_EXEC).toMatch(/SET\s+is_active\s*=\s*false/i);
    // Belt-and-braces: no `is_active = true` as a write target in a SET list.
    expect(BACKFILL_EXEC).not.toMatch(/is_active\s*=\s*true\s*,/i);
  });

  it('there is exactly ONE class_students-mutating UPDATE, and class_enrollments is never written', () => {
    const csUpdates =
      BACKFILL_EXEC.match(/UPDATE\s+"?public"?\."?class_students"?/gi) || [];
    expect(csUpdates.length).toBe(1);
    // class_enrollments is never written by this reconcile (the reverse direction
    // is report-only; the de-enroll already lives on class_enrollments).
    expect(BACKFILL_EXEC).not.toMatch(/UPDATE\s+"?public"?\."?class_enrollments"?/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. NO DROP — neither migration drops the roster tables/columns. The
//    consolidation DROP of the redundant table is deferred/CEO-gated.
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: non-destructive — no DROP of the roster tables/columns', () => {
  it('the policy migration has no DROP TABLE / DROP COLUMN', () => {
    expect(POLICY_EXEC).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(POLICY_EXEC).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  it('the backfill migration has no DROP TABLE / DROP COLUMN', () => {
    expect(BACKFILL_EXEC).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(BACKFILL_EXEC).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  it('neither migration DROPs class_students or class_enrollments', () => {
    for (const exec of [POLICY_EXEC, BACKFILL_EXEC]) {
      expect(exec).not.toMatch(/DROP\s+TABLE[\s\S]*?class_students/i);
      expect(exec).not.toMatch(/DROP\s+TABLE[\s\S]*?class_enrollments/i);
    }
  });

  it('the only DROPs in executable SQL are idempotent DROP POLICY IF EXISTS guards', () => {
    for (const exec of [POLICY_EXEC, BACKFILL_EXEC]) {
      const drops = exec.match(/\bDROP\s+\w+/gi) || [];
      expect(drops.length).toBeGreaterThan(0); // sanity: the idempotency guards exist
      for (const d of drops) {
        expect(d).toMatch(/DROP\s+POLICY/i);
      }
    }
  });

  it('no TRUNCATE and no standalone data DELETE in either migration', () => {
    for (const exec of [POLICY_EXEC, BACKFILL_EXEC]) {
      expect(exec).not.toMatch(/\bTRUNCATE\b/i);
      expect(exec).not.toMatch(/(^|;)\s*DELETE\s+FROM\b/im);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. NO READER REPOINT — this slice is migrations-only. The canAccessStudent /
//    is_teacher_of boundary reader is NOT repointed onto class_enrollments
//    (deferred / CEO-gated). Pinned two ways:
//      (a) neither migration repoints the boundary helpers in executable SQL;
//      (b) the live reader src/lib/rbac.ts still reads class_students.is_active.
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: reader NOT repointed (migrations-only; canAccessStudent deferred)', () => {
  it('neither migration redefines/repoints the boundary helpers in executable SQL', () => {
    for (const exec of [POLICY_EXEC, BACKFILL_EXEC]) {
      expect(exec).not.toMatch(/canAccessStudent/i);
      expect(exec).not.toMatch(/is_teacher_of/i);
    }
  });

  it('src/lib/rbac.ts still reads class_students (the teacher boundary is NOT repointed to class_enrollments)', () => {
    expect(RBAC_RAW.length).toBeGreaterThan(0);
    // The canAccessStudent teacher path still queries class_students with
    // .eq('is_active', true) — exactly the reader these migrations are a
    // prerequisite for, but deliberately do NOT touch in this slice.
    expect(RBAC_RAW).toMatch(/\.from\(\s*'class_students'\s*\)/);
    // The reader has NOT been moved onto the canonical enrollments roster yet.
    expect(RBAC_RAW).not.toMatch(/\.from\(\s*'class_enrollments'\s*\)/);
  });
});
