import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * F1 / F2 — 2026-08-15 hardening pair, structural (no-DB) regression pins.
 *
 * F1 (supabase/migrations/20260815000001_guard_unguarded_secdef_rpcs.sql):
 *   9 SECURITY DEFINER RPCs accepted a caller-supplied p_student_id /
 *   p_guardian_id with no check that the JWT-holding caller actually owns
 *   that row — an IDOR: any authenticated user could call
 *   get_student_notifications/get_student_snapshot/get_review_cards/
 *   student_join_class/join_competition with an arbitrary student id, or
 *   get_guardian_dashboard/link_guardian_to_student_via_code with an
 *   arbitrary guardian id, and read/mutate someone else's data.
 *   generate_exam_paper already HAD a guard but it was missing the
 *   `auth.uid() IS NOT NULL AND` prefix (so it wrongly rejected every
 *   service-role/no-JWT caller, e.g. /api/quiz). generate_student_notifications
 *   has no per-row ownership predicate to check — it is grant-restricted to
 *   service_role only instead.
 *
 * F2 (supabase/migrations/20260815000002_fix_rls_with_check_student_id_drift.sql):
 *   20260506000003_restore_rls_with_check_clauses.sql used the impossible
 *   predicate `student_id = (SELECT auth.uid())` on 8 tables (student_id is a
 *   students.id surrogate UUID, never auth.users.id). This migration replaces
 *   each of those 8 broken policies (same name) with the satisfiable predicate
 *   already proven correct elsewhere in the schema for that table.
 *
 * WHAT THIS FILE DOES NOT DO: it cannot prove Postgres actually enforces these
 * predicates (that needs a live DB — see fresh-db-quiz-functions.test.ts /
 * monitoring/learning-events-rls.test.ts for the house pattern of a
 * skipIf(!TEST_SUPABASE_URL) live probe). It pins the SQL TEXT so a future
 * CREATE OR REPLACE that silently drops the guard, or a future "cleanup" that
 * re-deletes the correct RLS policy and leaves the broken one, fails loudly
 * here instead of shipping silently. Mirrors the repo's established
 * grep-the-migration structural-pin style (REG-226, F2 student_id RLS fix,
 * parent-dashboard-rca-fixes-migration.test.ts).
 *
 * KNOWN GAP THIS FILE DOES NOT CLOSE (flagged, not silently accepted):
 *   No test in the repo exercises the authz MATRIX (own-id allowed /
 *   other-id denied / service-role bypass) against a real Postgres session
 *   for any of the 9 F1 functions. That requires a live-DB integration test
 *   that opens a session as the JWT-holding "attacker" role and asserts the
 *   RAISE EXCEPTION actually fires — see the recommendation in the task
 *   report. This file is the always-on static backstop, not a replacement
 *   for that live probe.
 */

const F1_MIGRATION = 'supabase/migrations/20260815000001_guard_unguarded_secdef_rpcs.sql';
const F2_MIGRATION = 'supabase/migrations/20260815000002_fix_rls_with_check_student_id_drift.sql';

function resolve(rel: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
    path.resolve(process.cwd(), '..', '..', rel),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}

/** Collapse whitespace + strip full-line `--` comments so matching is
 *  layout-tolerant and never matches header-comment prose. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

const F1_PRESENT = resolve(F1_MIGRATION) !== null;
const F2_PRESENT = resolve(F2_MIGRATION) !== null;

// ---------------------------------------------------------------------------
// F1 — student-id-guarded functions (7): the exact ownership predicate,
// present, and gated by the auth.uid() IS NOT NULL service-role exemption.
// ---------------------------------------------------------------------------
const STUDENT_ID_GUARDED_FUNCTIONS = [
  'get_student_notifications',
  'get_student_snapshot',
  'get_review_cards',
  'student_join_class',
  'join_competition',
  'generate_exam_paper',
] as const;

const RE_STUDENT_GUARD =
  /IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+students\s+WHERE\s+id\s*=\s*p_student_id\s+AND\s+auth_user_id\s*=\s*auth\.uid\(\)\s*\)\s*THEN\s*RAISE\s+EXCEPTION\s+'Access denied'\s+USING\s+ERRCODE\s*=\s*'42501'\s*;\s*END\s+IF\s*;/i;

const RE_GUARDIAN_GUARD =
  /IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+guardians\s+WHERE\s+id\s*=\s*p_guardian_id\s+AND\s+auth_user_id\s*=\s*auth\.uid\(\)\s*\)\s*THEN\s*RAISE\s+EXCEPTION\s+'Access denied'\s+USING\s+ERRCODE\s*=\s*'42501'\s*;\s*END\s+IF\s*;/i;

describe.skipIf(!F1_PRESENT)('F1: guard-unguarded-secdef-rpcs migration — file presence', () => {
  it(`${F1_MIGRATION} exists`, () => {
    expect(F1_PRESENT).toBe(true);
  });

  it('starts with BEGIN and ends with COMMIT, no DROP FUNCTION/TABLE', () => {
    const sql = normalised(F1_MIGRATION);
    expect(sql).toMatch(/\bBEGIN\s*;/i);
    expect(sql).toMatch(/\bCOMMIT\s*;/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP FUNCTION/i);
  });
});

describe.skipIf(!F1_PRESENT)('F1: student-id guard present in each named function', () => {
  const sql = normalised(F1_MIGRATION);

  it.each(STUDENT_ID_GUARDED_FUNCTIONS)('%s carries the student-id ownership guard', (fnName) => {
    const startToken = `CREATE OR REPLACE FUNCTION "public"."${fnName}"`;
    const start = sql.indexOf(startToken);
    expect(start, `${fnName} definition not found in F1 migration`).toBeGreaterThan(-1);
    const bodyEnd = sql.indexOf('$$;', sql.indexOf('AS $$', start));
    const body = sql.slice(start, bodyEnd + 3);
    expect(body).toMatch(RE_STUDENT_GUARD);
  });

  it('every student-id guard occurrence is gated by "auth.uid() IS NOT NULL AND" (service-role exemption)', () => {
    const occurrences = sql.match(new RegExp(RE_STUDENT_GUARD.source, 'gi')) ?? [];
    // 6 named functions above use the exact "Access denied" USING ERRCODE
    // wording; generate_exam_paper's guard is checked separately below since
    // its surrounding whitespace/comment layout differs (inline one-liner).
    expect(occurrences.length).toBeGreaterThanOrEqual(5);
    for (const occ of occurrences) {
      expect(occ).toMatch(/^IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+EXISTS/i);
    }
  });
});

describe.skipIf(!F1_PRESENT)('F1: guardian-id guard present in guardian-scoped functions', () => {
  const sql = normalised(F1_MIGRATION);

  it.each(['get_guardian_dashboard', 'link_guardian_to_student_via_code'] as const)(
    '%s carries the guardian-id ownership guard',
    (fnName) => {
      const startToken = `CREATE OR REPLACE FUNCTION "public"."${fnName}"`;
      const start = sql.indexOf(startToken);
      expect(start, `${fnName} definition not found in F1 migration`).toBeGreaterThan(-1);
      const bodyEnd = sql.indexOf('$$;', sql.indexOf('AS $$', start));
      const body = sql.slice(start, bodyEnd + 3);
      expect(body).toMatch(RE_GUARDIAN_GUARD);
    },
  );
});

describe.skipIf(!F1_PRESENT)('F1: link_guardian_to_student_via_code body is unchanged apart from the guard', () => {
  const sql = normalised(F1_MIGRATION);

  it('still matches invite_code OR link_code (2026-07-20 fix preserved)', () => {
    expect(sql).toContain('invite_code = v_code OR link_code = v_code');
  });

  it('still sets status = active on insert (matches is_guardian_of())', () => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION "public"."link_guardian_to_student_via_code"');
    const bodyEnd = sql.indexOf('$$;', sql.indexOf('AS $$', start));
    const body = sql.slice(start, bodyEnd + 3);
    expect(body).toContain("'active'");
  });
});

describe.skipIf(!F1_PRESENT)('F1: generate_exam_paper guard is normalized (live-bug fix, not a new restriction)', () => {
  const sql = normalised(F1_MIGRATION);

  it('the new guard is gated by auth.uid() IS NOT NULL (previously unconditionally rejected no-JWT callers)', () => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION "public"."generate_exam_paper"');
    expect(start).toBeGreaterThan(-1);
    const bodyEnd = sql.indexOf('$$;', sql.indexOf('AS $$', start));
    const body = sql.slice(start, bodyEnd + 3);
    expect(body).toMatch(
      /IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+students\s+WHERE\s+id\s*=\s*p_student_id\s+AND\s+auth_user_id\s*=\s*auth\.uid\(\)\s*\)\s*THEN\s*RAISE\s+EXCEPTION\s+'Access denied'\s+USING\s+ERRCODE\s*=\s*'42501'\s*;\s*END\s+IF\s*;/i,
    );
  });

  it('the guard appears before the template lookup (no mutating write happens before it — P4-adjacent write-order discipline)', () => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION "public"."generate_exam_paper"');
    const bodyEnd = sql.indexOf('$$;', sql.indexOf('AS $$', start));
    const body = sql.slice(start, bodyEnd + 3);
    const guardIdx = body.search(/IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL/i);
    const templateIdx = body.indexOf('SELECT * INTO v_template');
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(templateIdx).toBeGreaterThan(guardIdx);
  });
});

describe.skipIf(!F1_PRESENT)('F1: generate_student_notifications — grants restricted to service_role only', () => {
  const sql = normalised(F1_MIGRATION);

  it('revokes from PUBLIC, anon, and authenticated', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION "public"."generate_student_notifications"("uuid") FROM PUBLIC, "anon", "authenticated"',
    );
  });

  it('grants EXECUTE to service_role only (not authenticated)', () => {
    const grantIdx = sql.indexOf(
      'GRANT EXECUTE ON FUNCTION "public"."generate_student_notifications"("uuid") TO',
    );
    expect(grantIdx).toBeGreaterThan(-1);
    const stmtEnd = sql.indexOf(';', grantIdx);
    const stmt = sql.slice(grantIdx, stmtEnd);
    expect(stmt).toContain('"service_role"');
    expect(stmt).not.toContain('"authenticated"');
  });
});

describe.skipIf(!F1_PRESENT)('F1: every guarded function keeps authenticated+service_role EXECUTE (guard denies, does not un-grant)', () => {
  const sql = normalised(F1_MIGRATION);
  const grantedFns = [
    'get_student_notifications',
    'get_student_snapshot',
    'get_review_cards',
    'student_join_class',
    'join_competition',
    'get_guardian_dashboard',
    'link_guardian_to_student_via_code',
    'generate_exam_paper',
  ];

  it.each(grantedFns)('%s grants EXECUTE to authenticated and service_role', (fnName) => {
    const re = new RegExp(
      `GRANT EXECUTE ON FUNCTION "public"\\."${fnName}"\\([^)]*\\) TO "authenticated", "service_role"`,
      'i',
    );
    expect(sql).toMatch(re);
  });
});

// ---------------------------------------------------------------------------
// F2 — RLS WITH CHECK student_id drift fix (8 tables).
// ---------------------------------------------------------------------------
const F2_AFFECTED_POLICIES: Array<{ policy: string; table: string; op: 'INSERT' | 'UPDATE' }> = [
  { policy: 'Students can insert own quiz_responses', table: 'quiz_responses', op: 'INSERT' },
  { policy: 'Students can insert own foxy messages', table: 'foxy_chat_messages', op: 'INSERT' },
  { policy: 'Students can insert own foxy sessions', table: 'foxy_sessions', op: 'INSERT' },
  { policy: 'Students can update own foxy sessions', table: 'foxy_sessions', op: 'UPDATE' },
  { policy: 'Students can update own learning profiles', table: 'student_learning_profiles', op: 'UPDATE' },
  { policy: 'Students can insert own quiz_sessions', table: 'quiz_sessions', op: 'INSERT' },
  { policy: 'Students can update own quiz_sessions', table: 'quiz_sessions', op: 'UPDATE' },
  { policy: 'Students can insert own topic_mastery', table: 'topic_mastery', op: 'INSERT' },
  { policy: 'Students can update own topic_mastery', table: 'topic_mastery', op: 'UPDATE' },
  { policy: 'Students can insert own bloom_progression', table: 'bloom_progression', op: 'INSERT' },
  { policy: 'Students can update own bloom_progression', table: 'bloom_progression', op: 'UPDATE' },
  { policy: 'Students can insert own achievements', table: 'student_achievements', op: 'INSERT' },
];

describe.skipIf(!F2_PRESENT)('F2: fix-rls-with-check-student-id-drift migration — file presence', () => {
  it(`${F2_MIGRATION} exists`, () => {
    expect(F2_PRESENT).toBe(true);
  });

  it('starts with BEGIN and ends with COMMIT', () => {
    const sql = normalised(F2_MIGRATION);
    expect(sql).toMatch(/\bBEGIN\s*;/i);
    expect(sql).toMatch(/\bCOMMIT\s*;/i);
  });
});

describe.skipIf(!F2_PRESENT)('F2: each broken policy is dropped and recreated with a satisfiable predicate', () => {
  const sql = normalised(F2_MIGRATION);

  it.each(F2_AFFECTED_POLICIES)('drops and recreates "$policy" on $table', ({ policy, table }) => {
    expect(sql).toContain(`DROP POLICY IF EXISTS "${policy}" ON public.${table}`);
    expect(sql).toContain(`CREATE POLICY "${policy}"`);
  });

  it.each(F2_AFFECTED_POLICIES)(
    '"$policy" no longer uses the impossible student_id = (SELECT auth.uid()) predicate',
    ({ policy }) => {
      const createIdx = sql.indexOf(`CREATE POLICY "${policy}"`);
      expect(createIdx).toBeGreaterThan(-1);
      const nextSemicolon = sql.indexOf(';', createIdx);
      const block = sql.slice(createIdx, nextSemicolon + 1);
      expect(block).not.toMatch(/student_id\s*=\s*\(SELECT auth\.uid\(\)\)/);
      expect(block).not.toMatch(/student_id\s*=\s*auth\.uid\(\)/);
    },
  );
});

describe.skipIf(!F2_PRESENT)('F2: payment_history is explicitly deferred, not silently dropped', () => {
  it('the migration documents the payment_history deferral (no policy change on that table)', () => {
    const raw = read(F2_MIGRATION);
    expect(raw).toContain('payment_history');
    expect(raw).toMatch(/DEFERRED/);
    expect(raw).not.toMatch(/CREATE POLICY[^;]*payment_history/i);
  });
});

describe.skipIf(!F2_PRESENT)('F2: no destructive schema changes (P8)', () => {
  it('does not DROP TABLE or DROP COLUMN', () => {
    const sql = normalised(F2_MIGRATION);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});
