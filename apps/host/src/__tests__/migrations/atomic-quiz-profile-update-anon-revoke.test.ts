import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Audit remediation regression (2026-08-14): unauthenticated (anon) EXECUTE on
 * the three client-reachable `atomic_quiz_profile_update` overloads.
 *
 * Pins the ACL posture introduced by
 * `supabase/migrations/20260814000005_revoke_anon_execute_atomic_quiz_profile_update.sql`.
 *
 * ── The defect being pinned ────────────────────────────────────────────────
 * All four overloads are SECURITY DEFINER owned by `postgres` (rolbypassrls),
 * so they run with RLS bypassed. The 6- and 7-arg overloads carry a
 * byte-identical ownership guard, and the 4-arg inherits it by PERFORMing the
 * 7-arg:
 *
 *   IF auth.uid() IS NOT NULL AND NOT EXISTS (
 *     SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
 *   ) THEN RAISE EXCEPTION 'Access denied: ...'; END IF;
 *
 * Measured on the live DB by evaluating that predicate verbatim against the
 * real `students` table (2026-08-14):
 *
 *   auth_uid_under_anon_jwt                = NULL
 *   guard_expr_evaluated_verbatim_for_anon = f   <- guard SKIPPED for anon
 *   guard_A_fires_for_authed_nonowner      = t   <- guard WORKS when signed in
 *
 * i.e. DE-AUTHENTICATING WAS A PRIVILEGE ESCALATION: an authenticated attacker
 * is blocked, but the same attacker who drops the Authorization header and
 * calls with the bare (shipped, public) anon key is not — the
 * `auth.uid() IS NOT NULL` conjunct short-circuits and the guard never runs.
 * Anon-reachable writes on a caller-supplied p_student_id included XP (clamped
 * by the P2 200/day cap), UNCLAMPED student_learning_profiles counters,
 * arbitrary-subject profile rows, students.streak_days/last_active, and a
 * `learner.quiz_completed` state_event with an unvalidated p_session_id.
 *
 * ── Why the fix is the GRANT and not the guard ─────────────────────────────
 * The conjunct is intentional and documented in-source as "an app-level
 * ownership assertion, not a privilege boundary" — it exists so service_role
 * callers pass. It cannot be repaired in place because `auth.uid() IS NULL` is
 * equally true for service_role and for anon (neither presents a `sub` claim).
 * Only the EXECUTE grant can tell those two apart, because PostgREST maps them
 * to different Postgres roles. So the migration edits the ACL and leaves every
 * function body untouched.
 *
 * Structural/source-level checks only (same pattern as
 * `anon-execute-revoke-batch.test.ts`): Postgres is not run from Vitest. Every
 * content assertion runs against `ddl` — the migration text with all `--`
 * comment lines stripped — so the long explanatory header prose can never
 * satisfy an assertion.
 */

const MIGRATION_FILE =
  'supabase/migrations/20260814000005_revoke_anon_execute_atomic_quiz_profile_update.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readFile(rel: string): string {
  const resolved = resolveRepo(rel);
  if (!resolved) return '';
  return fs.readFileSync(resolved, 'utf-8');
}

/** Strip `--` comment lines so header prose cannot satisfy a DDL assertion. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}

const MIGRATION_PRESENT = resolveRepo(MIGRATION_FILE) !== null;

const FN = String.raw`public\.atomic_quiz_profile_update`;

/**
 * Render an EXACT identity-argument list as a regex fragment.
 *
 * Exactness matters: GRANT/REVOKE resolve by exact identity-arg match and do
 * NOT fall through via DEFAULT parameters, so a wrong signature raises 42883
 * and rolls back the whole migration on CI live-DB / fresh staging / DR. The
 * trailing `\)` is what keeps the 6-arg pattern from also matching the 7-arg
 * statement (which continues `, uuid)`).
 */
function argsRe(args: string[]): string {
  return String.raw`\(\s*` + args.join(String.raw`\s*,\s*`) + String.raw`\s*\)`;
}

/**
 * The three overloads this migration locks. Signatures sourced from:
 *   4-arg — baseline 00000000000000_baseline_from_prod.sql:642 (RETURNS void);
 *           identity list also used by 20260515000002:171.
 *   6-arg — baseline:717, last redefined 20260729130000:182 (RETURNS jsonb);
 *           identity list also used by 20260515000002:169, 20260702150000:563.
 *   7-arg — baseline:794, last redefined 20260729120001:714 (RETURNS void);
 *           identity list also used by 20260515000002:170, 20260702150000:819.
 */
const OVERLOADS: Array<{ label: string; args: string[] }> = [
  { label: '4-arg (uuid, integer, integer, integer)', args: ['uuid', 'integer', 'integer', 'integer'] },
  {
    label: '6-arg (uuid, text, integer, integer, integer, integer)',
    args: ['uuid', 'text', 'integer', 'integer', 'integer', 'integer'],
  },
  {
    label: '7-arg (uuid, text, integer, integer, integer, integer, uuid)',
    args: ['uuid', 'text', 'integer', 'integer', 'integer', 'integer', 'uuid'],
  },
];

/** The 5-arg overload — OUT OF SCOPE, already locked by 20260814000004 (B1). */
const FIVE_ARG = ['uuid', 'integer', 'integer', 'integer', 'text'];

describe.skipIf(!MIGRATION_PRESENT)(
  '20260814000005 atomic_quiz_profile_update — anon/PUBLIC EXECUTE revoke',
  () => {
    const sql = readFile(MIGRATION_FILE);
    const ddl = stripComments(sql);

    it('migration exists', () => {
      expect(MIGRATION_PRESENT).toBe(true);
    });

    it('is transactional (BEGIN ... COMMIT)', () => {
      expect(ddl).toMatch(/^BEGIN;/m);
      expect(ddl).toMatch(/^COMMIT;/m);
    });

    it('comment stripping actually removed the header prose', () => {
      // Sanity check on the helper itself: the header records the empirical
      // proof, and none of that prose may leak into `ddl`.
      expect(sql).toMatch(/guard_expr_evaluated_verbatim_for_anon/);
      expect(ddl).not.toMatch(/guard_expr_evaluated_verbatim_for_anon/);
    });

    // ── Per-overload ACL posture ────────────────────────────────────────────
    describe.each(OVERLOADS)('$label', ({ args }) => {
      const sig = argsRe(args);

      it('revokes FROM PUBLIC and anon', () => {
        const revoke = ddl.match(
          new RegExp(
            String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${FN}\s*${sig}\s+FROM\s+([^;]+);`,
            'i',
          ),
        );
        expect(revoke).not.toBeNull();
        const targets = revoke![1].toLowerCase();
        // PUBLIC is the load-bearing one: anon holds NO explicit `anon=X` entry
        // on these overloads, so its EXECUTE derives entirely from the baseline
        // `=X/postgres` PUBLIC grant. That is exactly why 20260515000002:169-171
        // and 20260702150000:563/819 (`REVOKE ... FROM anon`) were silent no-ops.
        expect(targets).toMatch(/\bpublic\b/);
        expect(targets).toMatch(/\banon\b/);
      });

      it('REGRESSION WITNESS: still grants EXECUTE TO authenticated (and service_role)', () => {
        // Revoking `authenticated` here would break the LIVE browser quiz-XP
        // write path (packages/lib/src/supabase.ts submitQuizResults -> 7-arg;
        // packages/lib/src/domains/quiz.ts + profile.ts -> 6-arg) — a P2/P4
        // student-facing outage, not a hardening. It is also unnecessary: the
        // in-body guard demonstrably FIRES for signed-in non-owners
        // (guard_A_fires_for_authed_nonowner = t).
        const grant = ddl.match(
          new RegExp(
            String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${FN}\s*${sig}\s+TO\s+([^;]+);`,
            'i',
          ),
        );
        expect(grant).not.toBeNull();
        const targets = grant![1].toLowerCase();
        expect(targets).toMatch(/\bauthenticated\b/);
        expect(targets).toMatch(/\bservice_role\b/);
        expect(targets).not.toMatch(/\banon\b/);
      });

      it('records the posture in a COMMENT ON FUNCTION', () => {
        expect(ddl).toMatch(
          new RegExp(String.raw`COMMENT\s+ON\s+FUNCTION\s+${FN}\s*${sig}\s+IS`, 'i'),
        );
      });
    });

    // ── The `authenticated` carve-out, stated globally ──────────────────────
    //
    // Statements are matched LINE-ANCHORED (`^\s*REVOKE`). The COMMENT ON
    // bodies legitimately contain the words "REVOKED;" and "`REVOKE ... FROM
    // anon`" inside quoted prose; an unanchored `/REVOKE[^;]*;/` would treat
    // that prose as DDL and mis-count. Every real statement in this migration
    // starts at column 0.
    const statements = (verb: 'REVOKE' | 'GRANT'): string[] =>
      ddl.match(new RegExp(String.raw`^\s*${verb}\b[^;]*;`, 'gim')) ?? [];

    it('contains NO statement revoking `authenticated` anywhere in the file', () => {
      const revokes = statements('REVOKE');
      expect(revokes.length).toBe(OVERLOADS.length);
      for (const stmt of revokes) {
        expect(stmt.toLowerCase()).not.toMatch(/\bauthenticated\b/);
      }
    });

    it('locks exactly the three in-scope overloads — no more, no fewer', () => {
      const revokes = statements('REVOKE');
      const grants = statements('GRANT');
      expect(revokes.length).toBe(3);
      expect(grants.length).toBe(3);
      for (const stmt of [...revokes, ...grants]) {
        expect(stmt).toMatch(/atomic_quiz_profile_update/);
      }
    });

    // ── Scope guard: the 5-arg overload is NOT this migration's business ────
    it('does NOT touch the 5-arg overload (already locked by 20260814000004 B1)', () => {
      // 20260814000004 revoked PUBLIC, anon AND authenticated on
      // (uuid, integer, integer, integer, text) and issued no grant. Re-touching
      // it here — especially with a GRANT — would silently reopen it.
      expect(ddl).not.toMatch(
        new RegExp(String.raw`${FN}\s*${argsRe(FIVE_ARG)}`, 'i'),
      );
      // The named-parameter spelling used by 20260702170000 / 20260814000004
      // must not appear in active DDL either.
      expect(ddl).not.toMatch(/p_subject\s+text/i);
    });

    // ── No body change ──────────────────────────────────────────────────────
    it('modifies no function bodies and drops nothing (revoke/grant/comment only)', () => {
      expect(ddl).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
      expect(ddl).not.toMatch(/CREATE\s+FUNCTION/i);
      expect(ddl).not.toMatch(/ALTER\s+FUNCTION/i);
      expect(ddl).not.toMatch(/DROP\s+(FUNCTION|TABLE|COLUMN|POLICY|TRIGGER)/i);
      // No dollar-quoted body and no plpgsql anywhere: the ownership guard is
      // left byte-for-byte as-is, and there is no DO block either. (`auth.uid()`
      // is deliberately NOT asserted against — it appears inside the COMMENT ON
      // prose, which is active DDL, describing the guard rather than editing it.)
      expect(ddl).not.toMatch(/\$\$/);
      expect(ddl).not.toMatch(/LANGUAGE\s+plpgsql/i);
      expect(ddl).not.toMatch(/^\s*DO\s+\$/im);
      expect(ddl).not.toMatch(/RAISE\s+EXCEPTION/i);
    });

    it('the durable guard fix is documented as a FOLLOW-UP and NOT implemented here', () => {
      // The real fix — gate the service-role escape on something that actually
      // identifies service_role (auth.role() / jwt claims role) rather than on
      // the absence of a `sub` claim — is higher blast radius (body edit on the
      // hottest write path) and is tracked separately.
      expect(sql).toMatch(/FOLLOW-UP\s+[—-]\s+NOT\s+IMPLEMENTED\s+HERE/i);
      expect(ddl).not.toMatch(/auth\.role\s*\(\s*\)/i);
      expect(ddl).not.toMatch(/request\.jwt\.claims/i);
    });
  },
);
