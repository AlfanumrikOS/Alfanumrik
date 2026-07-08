import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * RLS boundary regression for `public.learning_events` (P8/P13 — monitoring
 * data boundary). Catalogued as REG-143.
 *
 * Migration under test:
 *   supabase/migrations/20260615122657_create_learning_events.sql
 *
 * The table is the student-owned event stream that backs the monitoring /
 * learner-state substrate. Its security contract has three pillars:
 *   1. A student can ONLY read + insert rows keyed to their own auth.uid()
 *      (student_id = auth.uid() in both USING and WITH CHECK).
 *   2. The table is APPEND-ONLY — there is no UPDATE or DELETE policy, so a
 *      student's UPDATE/DELETE silently affects 0 rows (RLS returns no rows,
 *      NOT an error) and the row survives unchanged.
 *   3. event_type is constrained to exactly 8 values; student_id / session_id /
 *      verb / event_type are NOT NULL; occurred_at DEFAULTs to now().
 *
 * Test strategy — TWO layers, mirroring the repo's established RLS-test pattern:
 *   - STRUCTURAL (always-on): source-level assertions against the migration
 *     .sql text. They catch an accidental revert, a relaxed predicate, or a
 *     dropped CHECK during a refactor — no database required. Mirrors
 *     `rls-student-id-policies.test.ts` / `teacher/remediation-rls-policies.test.ts`.
 *   - LIVE (describe.skipIf(!LIVE_DB)): real per-user authenticated clients so
 *     auth.uid() is the genuine session user. Mirrors the live-DB skipIf gate
 *     in `observability-migration-1a.test.ts` / `1b.test.ts`. Skipped in normal
 *     CI (no TEST_SUPABASE_URL); runs only when a real Supabase is wired up.
 *
 * No real/hardcoded UUIDs anywhere — every id is crypto.randomUUID().
 * auth.uid() is never hardcoded — the live tests authenticate real users so the
 * session drives auth.uid().
 */

// -----------------------------------------------------------------------------
// Migration source resolution + whitespace-tolerant normalisation
// -----------------------------------------------------------------------------

const MIGRATION_FILE =
  'supabase/migrations/20260615122657_create_learning_events.sql';

function resolveMigrationPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), MIGRATION_FILE),
    // Worktree parent resolution (some CI checkouts run from the outer repo).
    path.resolve(process.cwd(), '..', MIGRATION_FILE),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const MIGRATION_PATH = resolveMigrationPath();
const MIGRATION_PRESENT = MIGRATION_PATH !== null;

function readMigration(): string {
  if (!MIGRATION_PATH) return '';
  return fs.readFileSync(MIGRATION_PATH, 'utf-8');
}

/** SQL with line + block comments stripped, then whitespace collapsed — so a
 *  doc comment never false-matches a body assertion and formatting/quoting
 *  changes don't break a structural check. Mirrors the house pattern. */
function normalisedSql(): string {
  const sql = readMigration();
  const noLineComments = sql.replace(/^\s*--.*$/gm, '');
  const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlockComments.replace(/\s+/g, ' ');
}

// The 8 canonical event_type values (must stay in lockstep with
// LearningEventType in src/types/monitoring.ts — cross-checked by REG-143's
// parity test in the catalog).
const EVENT_TYPES = [
  'quiz_attempt',
  'foxy_ask',
  'hint_used',
  'topic_opened',
  'session_start',
  'session_end',
  'mastery_updated',
  'solver_used',
] as const;

// -----------------------------------------------------------------------------
// Live-DB gate (real database). Skipped unless TEST_SUPABASE_URL is set.
// -----------------------------------------------------------------------------

const LIVE_DB = process.env.TEST_SUPABASE_URL !== undefined;
const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// -----------------------------------------------------------------------------
// STRUCTURAL assertions — always run (no DB needed)
// -----------------------------------------------------------------------------

describe('REG-143 — learning_events migration presence & structure (source-level)', () => {
  it(`${MIGRATION_FILE} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('enables Row Level Security on the table', () => {
    expect(normalisedSql()).toMatch(
      /ALTER TABLE public\.learning_events ENABLE ROW LEVEL SECURITY/,
    );
  });

  it('does NOT drop any tables or columns (P8: non-destructive)', () => {
    const sql = normalisedSql();
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  // [10 — structural half] occurred_at DEFAULT now()
  it('occurred_at has DEFAULT now()', () => {
    expect(normalisedSql()).toMatch(
      /occurred_at timestamptz NOT NULL DEFAULT now\(\)/i,
    );
  });

  // [9] Required NOT NULL columns
  it('declares student_id, session_id, verb, event_type as NOT NULL', () => {
    const sql = normalisedSql();
    expect(sql).toMatch(/student_id uuid NOT NULL/i);
    expect(sql).toMatch(/session_id uuid NOT NULL/i);
    expect(sql).toMatch(/verb text NOT NULL/i);
    expect(sql).toMatch(/event_type text NOT NULL/i);
  });

  it('declares the expected indexes (student+time, topic+type, session, type+time)', () => {
    const sql = normalisedSql();
    expect(sql).toContain('idx_learning_events_student_time');
    expect(sql).toContain('idx_learning_events_topic_type');
    expect(sql).toContain('idx_learning_events_session');
    expect(sql).toContain('idx_learning_events_type_time');
  });
});

describe('REG-143 — learning_events student-own-row policies (source-level)', () => {
  it('SELECT policy gates on student_id = auth.uid()', () => {
    const sql = normalisedSql();
    expect(sql).toMatch(
      /CREATE POLICY "students_own_learning_events_select" ON public\.learning_events FOR SELECT USING \(student_id = auth\.uid\(\)\)/i,
    );
  });

  it('INSERT policy gates on WITH CHECK (student_id = auth.uid())', () => {
    const sql = normalisedSql();
    expect(sql).toMatch(
      /CREATE POLICY "students_own_learning_events_insert" ON public\.learning_events FOR INSERT WITH CHECK \(student_id = auth\.uid\(\)\)/i,
    );
  });

  it('NO policy uses an open predicate (USING (true) / WITH CHECK (true))', () => {
    const sql = normalisedSql();
    expect(sql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });

  // [5 & 6 — structural half] append-only: NO UPDATE / DELETE policy exists.
  it('is APPEND-ONLY — no FOR UPDATE or FOR DELETE policy exists', () => {
    const sql = normalisedSql();
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR UPDATE/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });
});

describe('REG-143 — learning_events event_type CHECK list (source-level)', () => {
  // [8 — structural half] event_type CHECK has EXACTLY the 8 values.
  it('event_type CHECK contains all 8 canonical values and no extras', () => {
    const sql = normalisedSql();
    // Each value present.
    for (const t of EVENT_TYPES) {
      expect(sql).toContain(`'${t}'`);
    }
    // Pull the CHECK list and count the quoted literals inside it so a stray
    // 9th value (or a dropped one) fails loudly.
    const m = sql.match(/event_type text NOT NULL CHECK \(event_type IN \(([^)]*)\)/i);
    expect(m).not.toBeNull();
    const literals = (m![1].match(/'[^']+'/g) || []).map((s) => s.replace(/'/g, ''));
    expect(literals.sort()).toEqual([...EVENT_TYPES].sort());
    expect(literals.length).toBe(8);
  });
});

// -----------------------------------------------------------------------------
// LIVE assertions — real database, real authenticated users (auth.uid() = session)
// -----------------------------------------------------------------------------

describe.skipIf(!LIVE_DB)('REG-143 — learning_events live RLS', () => {
  let admin: SupabaseClient; // service role — RLS bypass, used only for setup/teardown
  let studentA: SupabaseClient; // authenticated student A
  let studentB: SupabaseClient; // authenticated student B
  let anon: SupabaseClient; // unauthenticated

  // auth.uid() values are derived from the real sessions — never hardcoded.
  let studentAId: string;
  let studentBId: string;

  const emailA = `le-student-a-${crypto.randomUUID()}@test.invalid`;
  const emailB = `le-student-b-${crypto.randomUUID()}@test.invalid`;
  const password = `Pw-${crypto.randomUUID()}`;
  const sessionId = crypto.randomUUID();
  const insertedIds: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
      auth: { persistSession: false },
    });

    // Provision two confirmed students; capture their auth.uid() from the
    // created user records (so the live session's auth.uid() is the FK target).
    const { data: aUser, error: aErr } = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A failed: ${aErr.message}`);
    studentAId = aUser.user!.id;

    const { data: bUser, error: bErr } = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B failed: ${bErr.message}`);
    studentBId = bUser.user!.id;

    // Per-user authenticated clients — auth.uid() inside RLS = the session user.
    studentA = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false },
    });
    studentB = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false },
    });
    anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false },
    });
    const signInA = await studentA.auth.signInWithPassword({ email: emailA, password });
    if (signInA.error) throw new Error(`signIn A failed: ${signInA.error.message}`);
    const signInB = await studentB.auth.signInWithPassword({ email: emailB, password });
    if (signInB.error) throw new Error(`signIn B failed: ${signInB.error.message}`);
  });

  afterAll(async () => {
    if (admin) {
      for (const id of insertedIds) {
        await admin.from('learning_events').delete().eq('id', id);
      }
      if (studentAId) await admin.auth.admin.deleteUser(studentAId);
      if (studentBId) await admin.auth.admin.deleteUser(studentBId);
    }
  });

  function newEvent(studentId: string) {
    const id = crypto.randomUUID();
    insertedIds.push(id);
    return {
      id,
      student_id: studentId,
      session_id: sessionId,
      event_type: 'quiz_attempt' as const,
      verb: 'attempted',
    };
  }

  // [1] Student can INSERT own row
  it('student CAN insert a row with student_id = auth.uid()', async () => {
    const { error } = await studentA.from('learning_events').insert(newEvent(studentAId));
    expect(error).toBeNull();
  });

  // [2] Student cannot INSERT row with a different student_id → WITH CHECK error
  it('student CANNOT insert a row with a different student_id (WITH CHECK violation → error)', async () => {
    const { error } = await studentA.from('learning_events').insert(newEvent(studentBId));
    expect(error).not.toBeNull();
  });

  // [3] Student can SELECT own rows
  it('student CAN select their own rows', async () => {
    const row = newEvent(studentAId);
    await studentA.from('learning_events').insert(row);
    const { data, error } = await studentA
      .from('learning_events')
      .select('id, student_id')
      .eq('id', row.id);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.student_id).toBe(studentAId);
  });

  // [4] Student cannot SELECT another student's rows → 0 rows, no error
  it("student CANNOT select another student's rows (0 rows, no error)", async () => {
    const bRow = newEvent(studentBId);
    // Service role writes B's row (B's own client would also work; service role
    // keeps the setup deterministic).
    await admin.from('learning_events').insert(bRow);
    const { data, error } = await studentA
      .from('learning_events')
      .select('id')
      .eq('id', bRow.id);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // [5] Student UPDATE any row → 0 rows affected, row survives unchanged
  it('student UPDATE affects 0 rows and the row survives unchanged (append-only)', async () => {
    const row = newEvent(studentAId);
    await studentA.from('learning_events').insert(row);

    const { data: updated, error: updErr } = await studentA
      .from('learning_events')
      .update({ verb: 'tampered' })
      .eq('id', row.id)
      .select('id');

    // Append-only: a blocked UPDATE returns 0 rows AND NO error — do NOT assert
    // error !== null here.
    expect(updErr).toBeNull();
    expect(updated?.length ?? 0).toBe(0);

    // Re-SELECT (via service role, RLS-bypass) proves the row is unchanged.
    const { data: after } = await admin
      .from('learning_events')
      .select('verb')
      .eq('id', row.id)
      .single();
    expect(after?.verb).toBe('attempted');
  });

  // [6] Student DELETE any row → 0 rows affected, row survives
  it('student DELETE affects 0 rows and the row survives (append-only)', async () => {
    const row = newEvent(studentAId);
    await studentA.from('learning_events').insert(row);

    const { data: deleted, error: delErr } = await studentA
      .from('learning_events')
      .delete()
      .eq('id', row.id)
      .select('id');

    // Append-only: blocked DELETE returns 0 rows AND NO error.
    expect(delErr).toBeNull();
    expect(deleted?.length ?? 0).toBe(0);

    // Row still present (service-role re-SELECT).
    const { data: after } = await admin
      .from('learning_events')
      .select('id')
      .eq('id', row.id);
    expect(after?.length).toBe(1);
  });

  // [7] Unauthenticated/anon INSERT → rejected (error or 0 rows)
  it('unauthenticated/anon INSERT is rejected (error or 0 rows)', async () => {
    const row = newEvent(studentAId);
    const { data, error } = await anon
      .from('learning_events')
      .insert(row)
      .select('id');
    const rejected = error !== null || (data?.length ?? 0) === 0;
    expect(rejected).toBe(true);
  });

  // [8 — live half] event_type CHECK rejects an invalid value → error
  it('inserting an invalid event_type errors (CHECK constraint)', async () => {
    const bad = {
      id: crypto.randomUUID(),
      student_id: studentAId,
      session_id: sessionId,
      // not in the 8-value set
      event_type: 'not_a_real_event_type',
      verb: 'attempted',
    };
    insertedIds.push(bad.id);
    const { error } = await studentA.from('learning_events').insert(bad as never);
    expect(error).not.toBeNull();
  });

  // [10 — live half] occurred_at is populated when omitted
  it('occurred_at is populated by DEFAULT now() when omitted on insert', async () => {
    const row = newEvent(studentAId);
    // Insert WITHOUT occurred_at.
    const { error } = await studentA.from('learning_events').insert(row);
    expect(error).toBeNull();
    const { data } = await admin
      .from('learning_events')
      .select('occurred_at')
      .eq('id', row.id)
      .single();
    expect(data?.occurred_at).toBeTruthy();
  });
});

// Always-on guard: if the migration ever moves/renames, the skipIf above would
// silently green the live block — this fails loudly so a path regression is caught.
describe('REG-143 — learning_events migration must be locatable', () => {
  it('migration is present at the expected path', () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });
});
