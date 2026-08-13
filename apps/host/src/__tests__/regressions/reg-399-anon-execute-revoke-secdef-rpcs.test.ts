import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * REG-399a — `anon` must never hold EXECUTE on student/guardian-data
 * SECURITY DEFINER RPCs.
 *
 * ── THE DEFECT (confirmed live, not theoretical) ────────────────────────────
 * Probed 2026-08-13 against production with the PUBLIC anon key that ships in
 * the browser bundle, no session, an arbitrary p_student_id:
 *
 *   get_student_snapshot      200 {"total_xp":12825,"avg_score":84,"quizzes_taken":70,...}
 *   get_student_notifications 200
 *   get_review_cards          200
 *   get_guardian_dashboard    200
 *
 * Controls already hardened by 20260813000007 (get_dashboard_data /
 * get_study_plan / get_knowledge_gaps) answered 401 / SQLSTATE 42501 to the
 * same key — so the probe is sound and the revoke mechanism works. P8 + P13
 * breach.
 *
 * ── THE ROOT CAUSE THIS FILE PINS ───────────────────────────────────────────
 * Supabase's baseline runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL
 * ON FUNCTIONS TO postgres, anon, authenticated, service_role`, and PostgreSQL
 * separately grants EXECUTE to PUBLIC on every new function. So
 *
 *     REVOKE EXECUTE ON FUNCTION f(...) FROM anon;      -- <— NO-OP
 *
 * removes only the `anon=X` ACL entry. The `=X` PUBLIC entry survives, PUBLIC
 * includes anon, and the function stays fully reachable by an unauthenticated
 * PostgREST caller. The statement succeeds, reads authoritatively in the
 * migration chain, and changes nothing.
 *
 * That is not a hypothetical: `20260515000002` line 212 shipped exactly
 *     REVOKE EXECUTE ON FUNCTION public.get_user_role(p_auth_user_id uuid) FROM anon;
 * and `get_user_role` — which returns name + grade + roles for an ARBITRARY
 * auth_user_id — was STILL anon-executable in the 2026-08-13 probe, fifteen
 * months later. That file is read here as a live regression witness so the
 * forbidden shape is proven to be a real shipped defect rather than a
 * hypothetical one this test invented.
 *
 * ── HONEST LIMIT OF THIS FILE — READ BEFORE TRUSTING A GREEN RUN ────────────
 * ⚠ THIS FILE READS A FILE. It proves the migration on disk has the right
 * SHAPE. It proves NOTHING about production, for the same reason
 * `reg-f1-f2-secdef-guards-and-rls-drift.test.ts` was false-green: on-disk is
 * not deployed, and in this very repo `20260815000001` sat on disk fully
 * "tested" while never having been applied to production at all.
 *
 * The REAL gate for this invariant is behavioural and runs at deploy time:
 *   `.github/scripts/assert-db-security-invariants.sh`
 * evaluates `has_function_privilege('anon', oid, 'EXECUTE')` against the LIVE
 * database after every production deploy and fails the release if any overload
 * is anon-executable. That script's wiring, blocking posture and non-vacuity
 * are pinned by `reg-399-migration-parity-non-vacuity.test.ts` (REG-399b).
 * This file is the always-on static backstop that catches a bad EDIT before it
 * ever reaches a deploy; it is not, and must never be cited as, evidence that
 * production is safe.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const MIGRATION_REL =
  'supabase/migrations/20260815000004_revoke_anon_execute_on_student_secdef_rpcs.sql';
/** The migration whose `FROM anon` (no PUBLIC) no-op left get_user_role exposed. */
const ROOT_CAUSE_REL =
  'supabase/migrations/20260515000002_security_hardening_secdef_anon_searchpath_rls_view.sql';
/** Already-hardened controls; their names appear in the CI assertion list. */
const PRIOR_HARDENING_REL =
  'supabase/migrations/20260813000007_reconcile_acl_drift_and_ownership_guards.sql';
const CI_ASSERT_REL = '.github/scripts/assert-db-security-invariants.sh';

function readRepo(rel: string): string {
  const p = join(REPO_ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

/**
 * Strip whole-line `--` comments. The migration carries a ~160-line header that
 * quotes every pattern asserted below (including the forbidden `FROM anon`
 * shape, verbatim, as documentation). Matching raw source would let the prose
 * satisfy the assertions — and would make the file FAIL for documenting itself.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}

const MIGRATION_SQL = readRepo(MIGRATION_REL);
const MIGRATION_PRESENT = MIGRATION_SQL !== '';
const ddl = stripSqlComments(MIGRATION_SQL);

/** `DO $tag$ ... $tag$;` — the migration has two, so tags disambiguate them. */
function doBlock(tag: string): string | null {
  const m = ddl.match(new RegExp(String.raw`DO\s+\$${tag}\$([\s\S]*?)\$${tag}\$\s*;`));
  return m ? m[0] : null;
}

/** The dynamically-resolved target list (`v_names text[] := ARRAY[...]`). */
function targetNames(): string[] {
  const m = ddl.match(/v_names\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
}

/** The closing assertion block's spot-check list. */
function spotCheckNames(): string[] {
  const block = doBlock('verify_anon_revoked');
  if (!block) return [];
  const m = block.match(/proname\s*=\s*ANY\s*\(\s*ARRAY\[([\s\S]*?)\]\s*\)/i);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
}

/**
 * The 9 SECURITY DEFINER RPCs that `20260815000001` guarded and
 * `20260815000003` reverted. Production has NO ownership guard on any of them,
 * so an anon revoke is the ONLY thing standing between the public anon key and
 * these rows — every one must be in the target list.
 */
const F1_NINE = [
  'get_student_notifications',
  'get_student_snapshot',
  'get_review_cards',
  'student_join_class',
  'join_competition',
  'get_guardian_dashboard',
  'link_guardian_to_student_via_code',
  'generate_exam_paper',
  'generate_student_notifications',
] as const;

/** The four confirmed 200-with-real-data responses from the live anon probe. */
const ANON_CONFIRMED_200 = [
  'get_student_snapshot',
  'get_student_notifications',
  'get_review_cards',
  'get_guardian_dashboard',
] as const;

/**
 * Deliberately NOT revoked (documented in the migration header): caller-relative
 * boolean predicates evaluated INSIDE RLS policy expressions. Revoking anon on
 * these turns "policy returns false, zero rows" into a hard 42501 on every
 * anon-reachable table that references them. Each compares against auth.uid(),
 * NULL for anon, so each returns FALSE unconditionally and leaks nothing.
 * Pinned as ABSENT so a well-meaning "we missed six" edit fails loudly here.
 */
const DELIBERATE_EXCLUSIONS = [
  'is_guardian_of',
  'is_teacher_of',
  'is_own_exam_entry',
  'is_school_admin_of_student',
  'is_active_admin',
  'foxy_can_view_student',
] as const;

describe.skipIf(!MIGRATION_PRESENT)('REG-399a: 20260815000004 revokes anon EXECUTE on student SECDEF RPCs', () => {
  it('the migration exists on disk', () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('comment stripping actually removed the header prose (sanity check on the helper)', () => {
    // The header documents the forbidden shape and the baseline GRANT. If the
    // stripper regressed, every "not present" assertion below would be testing
    // documentation instead of DDL.
    expect(MIGRATION_SQL).toMatch(/ALTER DEFAULT PRIVILEGES/);
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES/);
    expect(MIGRATION_SQL).toMatch(/CONFIRMED LIVE EXPOSURE/);
    expect(ddl).not.toMatch(/CONFIRMED LIVE EXPOSURE/);
  });

  it('is transactional (BEGIN ... COMMIT) so a failed assertion rolls the whole thing back', () => {
    expect(ddl).toMatch(/^BEGIN;/m);
    expect(ddl).toMatch(/^COMMIT;/m);
  });

  // ── THE LOAD-BEARING ASSERTION ────────────────────────────────────────────
  describe('revokes from BOTH PUBLIC and anon (revoking only anon is the documented no-op)', () => {
    it('the dynamic revoke names PUBLIC and anon in the same statement', () => {
      const block = doBlock('revoke_anon_execute_student_rpcs');
      expect(block, 'main DO block not found').not.toBeNull();
      expect(block!).toMatch(
        /REVOKE\s+ALL\s+ON\s+ROUTINE\s+public\.%I\(%s\)\s+FROM\s+PUBLIC\s*,\s*anon/i,
      );
    });

    it('EVERY revoke in the migration names PUBLIC — none is the anon-only no-op shape', () => {
      const revokes = ddl.match(/REVOKE[^;']*(?:'|;)/gi) ?? [];
      const anonRevokes = revokes.filter((r) => /\banon\b/i.test(r));
      // Non-vacuity: there must BE anon revokes, or this loop asserts nothing.
      expect(anonRevokes.length).toBeGreaterThan(0);
      for (const stmt of anonRevokes) {
        expect(stmt, `anon-only revoke (the no-op shape): ${stmt}`).toMatch(/\bPUBLIC\b/i);
      }
    });

    it('REGRESSION WITNESS: 20260515000002 shipped the anon-only shape, which is why get_user_role stayed exposed', () => {
      const rootCause = stripSqlComments(readRepo(ROOT_CAUSE_REL));
      // If this file is ever renamed/removed the witness must be re-pointed
      // deliberately rather than silently evaporating.
      expect(rootCause, `${ROOT_CAUSE_REL} not readable — witness lost`).not.toBe('');
      const stmt = rootCause.match(
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_user_role\s*\([^)]*\)\s+FROM\s+([^;]+);/i,
      );
      expect(stmt, 'the historical get_user_role revoke is gone — witness lost').not.toBeNull();
      // The defect: it revokes from anon and ONLY anon. PUBLIC keeps the grant.
      expect(stmt![1].toLowerCase()).toMatch(/\banon\b/);
      expect(stmt![1].toLowerCase()).not.toMatch(/\bpublic\b/);
    });

    it('get_user_role is therefore re-revoked here, and spot-checked in the closing assertion', () => {
      expect(targetNames()).toContain('get_user_role');
      expect(spotCheckNames()).toContain('get_user_role');
    });
  });

  // ── Target list ───────────────────────────────────────────────────────────
  describe('target list', () => {
    it('names 106 distinct routines', () => {
      const names = targetNames();
      expect(names).toHaveLength(106);
      expect(new Set(names).size).toBe(106);
    });

    it.each(F1_NINE)(
      '%s (guarded by 20260815000001, REVERTED by 20260815000003 — unguarded in prod) is revoked',
      (fn) => {
        expect(targetNames()).toContain(fn);
      },
    );

    it.each(ANON_CONFIRMED_200)('%s (live anon probe returned 200 with real data) is revoked', (fn) => {
      expect(targetNames()).toContain(fn);
    });

    it.each(DELIBERATE_EXCLUSIONS)(
      '%s is deliberately NOT revoked (RLS-policy predicate; revoking turns 0 rows into 42501)',
      (fn) => {
        expect(targetNames()).not.toContain(fn);
      },
    );
  });

  // ── Overload safety + privilege preservation ──────────────────────────────
  describe('dynamic overload resolution and privilege preservation', () => {
    const block = () => doBlock('revoke_anon_execute_student_rpcs')!;

    it('resolves overloads from pg_proc rather than hardcoding signatures', () => {
      // A hardcoded signature that does not exist raises 42883 and rolls back
      // the whole transaction on CI live-DB, fresh staging and DR restores.
      expect(block()).toMatch(/FROM\s+pg_proc/i);
      expect(block()).toMatch(/pg_get_function_identity_arguments/i);
      expect(block()).toMatch(/EXECUTE\s+format\s*\(/i);
    });

    it('targets ON ROUTINE, never ON FUNCTION (42809 against a procedure would be prod-only)', () => {
      expect(block()).toMatch(/ON\s+ROUTINE\s+public\.%I\(%s\)/i);
      expect(block()).not.toMatch(/ON\s+FUNCTION/i);
    });

    it('captures each role’s CURRENT privilege BEFORE the revoke, then re-grants only what was held', () => {
      const b = block();
      const authCapture = b.search(/v_auth_had\s*:=\s*has_function_privilege\(\s*'authenticated'/i);
      const svcCapture = b.search(/v_svc_had\s*:=\s*has_function_privilege\(\s*'service_role'/i);
      const revokeIdx = b.search(/REVOKE\s+ALL\s+ON\s+ROUTINE/i);
      expect(authCapture).toBeGreaterThanOrEqual(0);
      expect(svcCapture).toBeGreaterThanOrEqual(0);
      expect(revokeIdx).toBeGreaterThanOrEqual(0);
      // Order is the whole correctness argument: `REVOKE ... FROM PUBLIC` also
      // strips the PUBLIC leg these roles may be relying on, so the privilege
      // must be read while it still exists.
      expect(authCapture).toBeLessThan(revokeIdx);
      expect(svcCapture).toBeLessThan(revokeIdx);
      // …and each re-grant is conditional on the captured boolean, so the
      // migration can never WIDEN access for a role that did not have it.
      expect(b).toMatch(/IF\s+v_auth_had\s+THEN[\s\S]*?GRANT\s+EXECUTE\s+ON\s+ROUTINE[\s\S]*?authenticated/i);
      expect(b).toMatch(/IF\s+v_svc_had\s+THEN[\s\S]*?GRANT\s+EXECUTE\s+ON\s+ROUTINE[\s\S]*?service_role/i);
    });

    it('never grants anything back to anon or PUBLIC', () => {
      const grants = ddl.match(/GRANT[^;']*(?:'|;)/gi) ?? [];
      expect(grants.length).toBeGreaterThan(0);
      for (const g of grants) {
        expect(g, `grant hands access back to anon/PUBLIC: ${g}`).not.toMatch(
          /TO\s+[^;']*\b(anon|PUBLIC)\b/i,
        );
      }
    });

    it('reports a processed count so "0 processed" is distinguishable from "loop never ran"', () => {
      const b = block();
      expect(b).toMatch(/v_count\s+integer\s*:=\s*0/i);
      expect(b).toMatch(/v_count\s*:=\s*v_count\s*\+\s*1/i);
      expect(b.slice(b.lastIndexOf('END LOOP;'))).toMatch(/RAISE\s+NOTICE[\s\S]*v_count/i);
    });
  });

  // ── The closing assertion block ───────────────────────────────────────────
  describe('closing post-condition assertion', () => {
    it('exists as its own DO block', () => {
      expect(doBlock('verify_anon_revoked')).not.toBeNull();
    });

    it('RAISEs EXCEPTION (not NOTICE) when anon still resolves EXECUTE', () => {
      const b = doBlock('verify_anon_revoked')!;
      expect(b).toMatch(/has_function_privilege\(\s*'anon'/i);
      expect(b).toMatch(/RAISE\s+EXCEPTION/i);
      // The RAISE must be reached by the leaky branch, not merely present.
      expect(b).toMatch(/IF\s+v_leaky\s+IS\s+NOT\s+NULL\s+THEN\s*RAISE\s+EXCEPTION/i);
    });

    it('spot-checks 13 routines, including all four confirmed-exposed ones', () => {
      const spot = spotCheckNames();
      expect(spot).toHaveLength(13);
      for (const fn of ANON_CONFIRMED_200) expect(spot).toContain(fn);
    });

    it('every spot-checked routine is also in the revoke target list (no unenforceable assertion)', () => {
      const names = targetNames();
      for (const fn of spotCheckNames()) {
        expect(names, `${fn} is asserted but never revoked`).toContain(fn);
      }
    });
  });

  // ── Scope guard ───────────────────────────────────────────────────────────
  describe('scope: grants only', () => {
    it('modifies no function body, drops nothing, alters no table, touches no policy', () => {
      expect(ddl).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
      expect(ddl).not.toMatch(/\bDROP\b/i);
      expect(ddl).not.toMatch(/ALTER\s+TABLE/i);
      expect(ddl).not.toMatch(/CREATE\s+POLICY/i);
      expect(ddl).not.toMatch(/CREATE\s+TABLE/i);
    });

    it('does not re-land the reverted 20260815000001 ownership guards', () => {
      // 59% of production students have students.auth_user_id = NULL, so the
      // guard denies them (f7fa8ebb3 / 20260815000003). This migration must
      // close the unauthenticated hole WITHOUT reintroducing that outage.
      expect(ddl).not.toMatch(/Access denied/i);
      expect(ddl).not.toMatch(/auth\.uid\(\)/i);
    });
  });

  // ── Cross-artifact: the CI gate cannot assert on an unrevoked RPC ─────────
  describe('cross-artifact consistency with the deploy-time CI assertion', () => {
    it('every RPC in assert-db-security-invariants.sh is revoked here or by 20260813000007', () => {
      const ci = readRepo(CI_ASSERT_REL);
      expect(ci, `${CI_ASSERT_REL} not readable`).not.toBe('');
      const listed = (ci.match(/SECDEF_RPCS=\(([\s\S]*?)\)/) ?? [])[1];
      expect(listed, 'SECDEF_RPCS array not found in the CI script').toBeTruthy();
      const ciNames = listed
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[a-z0-9_]+$/.test(l));
      expect(ciNames.length).toBeGreaterThan(0);

      const here = targetNames();
      const prior = stripSqlComments(readRepo(PRIOR_HARDENING_REL));
      for (const fn of ciNames) {
        const coveredHere = here.includes(fn);
        const coveredPrior = new RegExp(
          String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.${fn}\s*\([^)]*\)\s+FROM\s+PUBLIC\s*,\s*anon`,
          'i',
        ).test(prior);
        expect(
          coveredHere || coveredPrior,
          `${fn} is asserted by the deploy gate but revoked by neither 20260815000004 nor 20260813000007`,
        ).toBe(true);
      }
    });
  });
});
