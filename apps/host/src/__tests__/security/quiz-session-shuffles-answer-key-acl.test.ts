import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasSupabaseIntegrationEnv,
  skipIfNoSubstrate,
  type SkippableTestContext,
} from '../helpers/integration';

/**
 * REG-380 — `quiz_session_shuffles` answer-key column ACL (P1 / P3 / P8).
 *
 * WHAT BROKE
 * ==========
 * `public.quiz_session_shuffles` is the server-owned per-question snapshot that
 * `submit_quiz_results_v2` grades against. Two of its columns ARE the answer key:
 *
 *   correct_answer_index_snapshot  — question_bank.correct_answer_index, frozen
 *                                    at serve time (baseline:12885)
 *   integrity_hash                 — sha256(options_snapshot::text ||
 *                                    correct_answer_index::text)
 *                                    (20260801100900:125-128). Because
 *                                    options_snapshot IS client-readable, this is
 *                                    a FOUR-candidate brute-force oracle for the
 *                                    same key.
 *
 * The table has RLS with a student SELECT policy (baseline:21699), a parent one
 * (20260720170000:72-74) and a teacher one (baseline:21704). PostgreSQL RLS is
 * ROW-level: it cannot hide a COLUMN. The baseline pg_dump ships no per-table
 * GRANTs and ends with `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
 * authenticated, service_role` (baseline:22640-22643) — so `authenticated` held a
 * table-level ALL and row visibility was the only gate. A signed-in student could
 * therefore issue
 *
 *   GET /rest/v1/quiz_session_shuffles
 *       ?select=question_id,correct_answer_index_snapshot
 *       &session_id=eq.<their own IN-FLIGHT session>
 *
 * and read the key for every question of a quiz they had not yet submitted.
 *
 * THE FIX (migration 20260814000014)
 * ==================================
 * Table-level REVOKE from anon + authenticated, then a column-level
 * `GRANT SELECT (…10 non-key columns…) TO authenticated`. Nothing else changes:
 * no policy, no function body, no schema. The three SECURITY DEFINER quiz RPCs
 * (start_quiz_session, submit_quiz_results_v2, check_quiz_answer) run as the
 * function OWNER, and every server read of the key is service-role, so P1/P4
 * scoring is untouched.
 *
 * WHAT THIS FILE PINS
 * ===================
 * Lane A (static, ALWAYS runs): the ACL shape in the migration chain, plus a
 * DRIFT GUARD — no later root migration may re-grant a table-level privilege or
 * either key column back to a client role. This is the durable half: it fails in
 * plain `npm test` the moment someone reopens the hole in SQL.
 *
 * Lane B (live DB, self-skips without real Supabase creds): a genuine PostgREST
 * round-trip proving the `authenticated` role is refused (42501) on the key
 * columns while the service-role read that scoring depends on still succeeds.
 *
 * KNOWN RESIDUAL — deliberately NOT asserted closed here.
 * `question_bank.correct_answer_index` remains readable by any authenticated user
 * via policy `question_bank_authenticated_read` (20260728090000:311-312) — audit
 * finding C2, documented as deferred in 20260814000000:21-33. That is a WIDER
 * read than the one closed here. Do not read a green run of this file as "the
 * answer key is unreachable by a student".
 */

// ── shared constants ─────────────────────────────────────────────────────────

const MIGRATION_FILE = '20260814000014_quiz_session_shuffles_answer_key_column_acl.sql';

/** The two columns no client role may ever read. */
const ANSWER_KEY_COLUMNS = ['correct_answer_index_snapshot', 'integrity_hash'] as const;

/** Exactly the columns `authenticated` may read after the fix. */
const EXPECTED_GRANTED_COLUMNS = [
  'session_id',
  'question_id',
  'student_id',
  'shuffle_map',
  'options_snapshot',
  'options_version_at_serve',
  'created_at',
  'student_selected_displayed_index',
  'student_time_spent_seconds',
  'student_answered_at',
] as const;

const MIGRATIONS_ABS = resolve(__dirname, '../../../../../supabase/migrations');

/** Strip `--` line comments and `/* *\/` block comments so prose can't satisfy a regex. */
function stripComments(sql: string): string {
  return sql
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
}

function rootMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_ABS)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// LANE A — static SQL pins. Always run.
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-380 (static) — quiz_session_shuffles answer-key column ACL', () => {
  const files = rootMigrationFiles();
  const migrationPath = resolve(MIGRATIONS_ABS, MIGRATION_FILE);
  const raw = readFileSync(migrationPath, 'utf8');
  const sql = stripComments(raw);

  it('the ACL migration exists and sorts AFTER 20260814000013', () => {
    expect(files).toContain(MIGRATION_FILE);
    const idx = files.indexOf(MIGRATION_FILE);
    const prior = files.filter(f => f.startsWith('20260814000013'));
    expect(prior.length).toBeGreaterThan(0);
    expect(idx).toBeGreaterThan(files.indexOf(prior[0]));
  });

  it('is wrapped in a single BEGIN; … COMMIT; transaction', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;\s*$/m);
    expect((sql.match(/^\s*BEGIN;/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;/gm) ?? []).length).toBe(1);
  });

  it('performs NO destructive or structural DDL (no DROP, no ALTER TABLE, no policy or function change)', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY|FUNCTION|VIEW)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|POLICY|TABLE|VIEW)\b/i);
  });

  it('revokes the baseline table-level grant from BOTH client roles (the step that makes column grants authoritative)', () => {
    for (const role of ['authenticated', 'anon']) {
      expect(
        sql,
        `missing table-level REVOKE ALL from ${role} — a column-level REVOKE alone is a no-op ` +
          'against the baseline default-privileges table grant (see 20260814000000:29-32)',
      ).toMatch(
        new RegExp(
          `REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+public\\.quiz_session_shuffles\\s+FROM\\s+${role}\\s*;`,
          'i',
        ),
      );
    }
  });

  it('re-grants column-level SELECT to authenticated on EXACTLY the 10 non-key columns', () => {
    const m = sql.match(
      /GRANT\s+SELECT\s*\(([^)]*)\)\s*ON\s+TABLE\s+public\.quiz_session_shuffles\s+TO\s+authenticated\s*;/i,
    );
    expect(m, 'no column-scoped GRANT SELECT … TO authenticated found').toBeTruthy();

    const granted = m![1]
      .split(',')
      .map(s => s.trim().replace(/"/g, ''))
      .filter(Boolean)
      .sort();

    expect(granted).toEqual([...EXPECTED_GRANTED_COLUMNS].sort());
    for (const key of ANSWER_KEY_COLUMNS) {
      expect(granted, `${key} must never appear in the authenticated allowlist`).not.toContain(key);
    }
  });

  it('grants NOTHING to anon', () => {
    expect(sql).not.toMatch(/GRANT[\s\S]{0,200}?quiz_session_shuffles[\s\S]{0,80}?TO\s+anon\b/i);
  });

  it('explicitly revokes the two answer-key columns from both client roles (belt-and-braces)', () => {
    for (const role of ['authenticated', 'anon']) {
      const re = new RegExp(
        `REVOKE\\s+SELECT\\s*\\(\\s*correct_answer_index_snapshot\\s*,\\s*integrity_hash\\s*\\)\\s*` +
          `ON\\s+TABLE\\s+public\\.quiz_session_shuffles\\s+FROM\\s+${role}\\s*;`,
        'i',
      );
      expect(sql, `missing explicit column REVOKE from ${role}`).toMatch(re);
    }
  });

  it('carries in-transaction post-conditions that roll back a half-applied or ineffective ACL', () => {
    // Must assert the deny side …
    expect(sql).toMatch(/has_column_privilege\(\s*'authenticated'/);
    expect(sql).toMatch(/has_column_privilege\(\s*'anon'/);
    // … the server side is preserved …
    expect(sql).toMatch(/has_column_privilege\(\s*'service_role'/);
    // … and that writes stay closed.
    expect(sql).toMatch(/has_table_privilege\(\s*'authenticated'[^)]*'INSERT'\s*\)/);
    // Post-conditions must ABORT, not warn.
    expect(sql).toMatch(/RAISE\s+EXCEPTION[\s\S]*POST-CONDITION FAILED/);
  });

  it('DRIFT GUARD: no later root migration re-opens the table to a client role', () => {
    const ours = files.indexOf(MIGRATION_FILE);
    const offenders: string[] = [];

    for (const f of files.slice(ours + 1)) {
      const body = stripComments(readFileSync(resolve(MIGRATIONS_ABS, f), 'utf8'));

      // Any GRANT on this table naming authenticated/anon …
      const grantRe =
        /GRANT\s+([\s\S]{0,300}?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?"?quiz_session_shuffles"?\s+TO\s+([a-z_,\s"]+);/gi;
      let m: RegExpExecArray | null;
      while ((m = grantRe.exec(body)) !== null) {
        const privileges = m[1];
        const roles = m[2].toLowerCase();
        if (!/\b(authenticated|anon|public)\b/.test(roles)) continue;

        // A table-level grant (no column list) reopens everything.
        if (!/\(/.test(privileges)) {
          offenders.push(`${f}: table-level GRANT ${privileges.trim()} TO ${roles.trim()}`);
          continue;
        }
        // A column grant that names either key column reopens the leak.
        for (const key of ANSWER_KEY_COLUMNS) {
          if (privileges.includes(key)) {
            offenders.push(`${f}: GRANT of ${key} TO ${roles.trim()}`);
          }
        }
      }

      // Or a blanket ALTER DEFAULT PRIVILEGES re-grant scoped at the schema.
      if (
        /ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]{0,200}?GRANT\s+(ALL|SELECT)[\s\S]{0,80}?ON\s+TABLES\s+TO\s+[\s\S]{0,60}?\b(authenticated|anon)\b/i.test(
          body,
        )
      ) {
        offenders.push(`${f}: ALTER DEFAULT PRIVILEGES re-grant on TABLES to a client role`);
      }
    }

    expect(
      offenders,
      'a later migration re-opened quiz_session_shuffles to a client role — ' +
        'the answer key is readable again. Offenders:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('CROSS-MODULE PARITY: the resume-route column whitelist is a subset of what is still granted', () => {
    const resumeSrc = readFileSync(
      resolve(__dirname, '../../../../../packages/lib/src/quiz/resume.ts'),
      'utf8',
    );
    const m = resumeSrc.match(/export const SHUFFLE_RESUME_COLUMNS\s*=\s*([\s\S]*?);/);
    expect(m, 'SHUFFLE_RESUME_COLUMNS not found in packages/lib/src/quiz/resume.ts').toBeTruthy();

    const cols = m![1]
      .replace(/['"+\n]/g, ' ')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) {
      expect(
        EXPECTED_GRANTED_COLUMNS as readonly string[],
        `resume route selects "${c}" which the ACL no longer grants to authenticated`,
      ).toContain(c);
      expect(ANSWER_KEY_COLUMNS as readonly string[]).not.toContain(c);
    }
  });

  it('CALLER PARITY: the only app-code read of the answer key is service-role', () => {
    // Comments are stripped first: the prose in these files legitimately names
    // the key column, and a doc comment must not be able to satisfy — or break —
    // a security assertion.
    const stripTs = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

    const daily6 = stripTs(
      readFileSync(resolve(__dirname, '../../app/api/whatsapp/_lib/daily6.ts'), 'utf8'),
    );

    // The WhatsApp grader is the only app-code read of the answer key; it must
    // go through the service-role client, which bypasses both RLS and this ACL.
    expect(daily6, 'expected daily6 to still read the snapshot key').toContain(
      'correct_answer_index_snapshot',
    );

    const FROM = ".from('quiz_session_shuffles')";
    let at = daily6.indexOf(FROM);
    let occurrences = 0;
    while (at !== -1) {
      occurrences++;
      const before = daily6.slice(Math.max(0, at - 80), at);
      expect(
        before,
        'every daily6 read of quiz_session_shuffles must use supabaseAdmin (service role)',
      ).toMatch(/supabaseAdmin\s*$/);
      at = daily6.indexOf(FROM, at + FROM.length);
    }
    expect(occurrences).toBeGreaterThan(0);

    // The Phase 4 resume/progress route reads the table too — service-role with
    // an explicit ownership probe. It must never name the key column.
    const progress = stripTs(
      readFileSync(
        resolve(__dirname, '../../app/api/quiz/session/[sessionId]/progress/route.ts'),
        'utf8',
      ),
    );
    for (const key of ANSWER_KEY_COLUMNS) {
      expect(
        progress,
        `the progress route must not select ${key}`,
      ).not.toContain(key);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LANE B — live DB. Self-skips without real Supabase creds.
// ─────────────────────────────────────────────────────────────────────────────

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

/** PostgreSQL insufficient_privilege. What a column ACL denial looks like over PostgREST. */
const INSUFFICIENT_PRIVILEGE = '42501';

describeIntegration('REG-380 (live DB) — authenticated cannot read the answer key', () => {
  let admin: SupabaseClient;
  let studentClient: SupabaseClient | null = null;
  let studentId: string | null = null;
  let questionId: string | null = null;
  let sessionId: string | null = null;
  let authUserId: string | null = null;
  let setupError: string | null = null;

  const PW = `Reg380!${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    try {
      const email = `reg380+${randomUUID()}@example.test`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: PW,
        email_confirm: true,
      });
      if (createErr || !created?.user) throw new Error(`createUser: ${createErr?.message}`);
      authUserId = created.user.id;

      await admin
        .from('subjects')
        .upsert(
          { code: 'science', name: 'Science', subject_kind: 'cbse_core', is_active: true },
          { onConflict: 'code' },
        );

      const { data: studentRow, error: studentErr } = await admin
        .from('students')
        .insert({
          auth_user_id: authUserId,
          name: 'REG-380 answer-key ACL throwaway',
          email,
          // P5: grades are STRINGS.
          grade: '9',
          board: 'CBSE',
          preferred_language: 'en',
          preferred_subject: 'math',
          account_status: 'active',
          xp_total: 0,
        })
        .select('id')
        .single();
      if (studentErr || !studentRow) throw new Error(`student seed: ${studentErr?.message}`);
      studentId = (studentRow as { id: string }).id;

      const { data: qRow, error: qErr } = await admin
        .from('question_bank')
        .insert({
          question_text: `REG-380 ACL probe question ${randomUUID()}`,
          options: ['Delhi', 'Mumbai', 'Chennai', 'Kolkata'],
          correct_answer_index: 0,
          explanation: 'Delhi is the national capital of India.',
          subject: 'science',
          grade: '9',
          chapter_number: 1,
          difficulty: 2,
          bloom_level: 'understand',
          is_active: true,
        })
        .select('id')
        .single();
      if (qErr || !qRow) throw new Error(`question seed: ${qErr?.message}`);
      questionId = (qRow as { id: string }).id;

      // Start a real session as the server would: this writes the snapshot row.
      const { data: startData, error: startErr } = await admin.rpc('start_quiz_session', {
        p_student_id: studentId,
        p_question_ids: [questionId],
      });
      if (startErr) throw new Error(`start_quiz_session: ${startErr.message}`);
      const parsed = typeof startData === 'string' ? JSON.parse(startData) : startData;
      sessionId = parsed?.session_id ?? null;
      if (!sessionId) throw new Error('start_quiz_session returned no session_id');

      // Sign in as the student → an anon-key client carrying a real
      // `authenticated` JWT. This is the exact posture of the browser.
      const client = createClient(url, anon, { auth: { persistSession: false } });
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PW });
      if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
      studentClient = client;
    } catch (e) {
      setupError = e instanceof Error ? e.message : String(e);
    }
  });

  afterAll(async () => {
    if (!admin) return;
    if (sessionId) await admin.from('quiz_session_shuffles').delete().eq('session_id', sessionId);
    if (questionId) await admin.from('question_bank').delete().eq('id', questionId);
    if (studentId) await admin.from('students').delete().eq('id', studentId);
    if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
  });

  const ready = () => Boolean(studentClient && sessionId && studentId && !setupError);
  const asSkippable = (ctx: unknown) => ctx as SkippableTestContext;

  for (const column of ANSWER_KEY_COLUMNS) {
    it(`the student's OWN session: selecting ${column} is refused with 42501`, async ctx => {
      skipIfNoSubstrate(asSkippable(ctx), ready(), `fixture setup failed: ${setupError ?? ''}`);

      const { data, error } = await studentClient!
        .from('quiz_session_shuffles')
        .select(`question_id, ${column}`)
        .eq('session_id', sessionId!);

      expect(
        error,
        `authenticated must be REFUSED on ${column} — it was not. This is the P1/P3 leak.`,
      ).toBeTruthy();
      expect(error!.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(data).toBeNull();
      // Nothing key-shaped may appear in the error payload either.
      expect(JSON.stringify(error)).not.toMatch(/"correct_answer_index_snapshot"\s*:\s*\d/);
    });
  }

  it('a wildcard select(*) is also refused (no escape hatch)', async ctx => {
    skipIfNoSubstrate(asSkippable(ctx), ready(), `fixture setup failed: ${setupError ?? ''}`);

    const { data, error } = await studentClient!
      .from('quiz_session_shuffles')
      .select('*')
      .eq('session_id', sessionId!);

    expect(error, 'select(*) must be refused — it would return the answer key').toBeTruthy();
    expect(error!.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(data).toBeNull();
  });

  it('the legitimate resume read (non-key columns) still succeeds for the owner', async ctx => {
    skipIfNoSubstrate(asSkippable(ctx), ready(), `fixture setup failed: ${setupError ?? ''}`);

    const { data, error } = await studentClient!
      .from('quiz_session_shuffles')
      .select(
        'question_id, shuffle_map, options_snapshot, student_selected_displayed_index, ' +
          'student_time_spent_seconds, student_answered_at, created_at',
      )
      .eq('session_id', sessionId!);

    expect(error, `resume read must keep working: ${error?.message}`).toBeNull();
    expect(data).toHaveLength(1);
    const row = data![0] as Record<string, unknown>;
    expect(row.question_id).toBe(questionId);
    expect(Array.isArray(row.shuffle_map)).toBe(true);
    for (const key of ANSWER_KEY_COLUMNS) {
      expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(false);
    }
  });

  it('server-side scoring still can: the service-role client reads the answer key', async ctx => {
    skipIfNoSubstrate(asSkippable(ctx), ready(), `fixture setup failed: ${setupError ?? ''}`);

    const { data, error } = await admin
      .from('quiz_session_shuffles')
      .select('question_id, correct_answer_index_snapshot, integrity_hash, shuffle_map')
      .eq('session_id', sessionId!);

    expect(error, `service_role must retain the key: ${error?.message}`).toBeNull();
    expect(data).toHaveLength(1);
    const row = data![0] as { correct_answer_index_snapshot: number; integrity_hash: string };
    expect(row.correct_answer_index_snapshot).toBe(0);
    expect(row.integrity_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('P1 INTACT: submit_quiz_results_v2 still grades the session server-side', async ctx => {
    skipIfNoSubstrate(asSkippable(ctx), ready(), `fixture setup failed: ${setupError ?? ''}`);

    // Read the server-owned shuffle as the SERVER would, to compute the
    // displayed index of the correct option — the client cannot do this any
    // more, which is the whole point.
    const { data: snap } = await admin
      .from('quiz_session_shuffles')
      .select('shuffle_map, correct_answer_index_snapshot')
      .eq('session_id', sessionId!)
      .eq('question_id', questionId!)
      .single();
    const shuffleMap = (snap as { shuffle_map: number[] }).shuffle_map;
    const correctOriginal = (snap as { correct_answer_index_snapshot: number })
      .correct_answer_index_snapshot;
    const correctDisplayed = shuffleMap.indexOf(correctOriginal);
    expect(correctDisplayed).toBeGreaterThanOrEqual(0);

    const { data, error } = await admin.rpc('submit_quiz_results_v2', {
      p_session_id: sessionId,
      p_student_id: studentId,
      p_subject: 'science',
      // P5: grade is a STRING.
      p_grade: '9',
      p_topic: null,
      p_chapter: 1,
      p_responses: [
        {
          question_id: questionId,
          selected_displayed_index: correctDisplayed,
          time_spent: 12,
        },
      ],
      p_time: 12,
    });

    expect(error, `submit_quiz_results_v2 must still grade: ${error?.message}`).toBeNull();
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    // P1: Math.round((correct / total) * 100) — 1/1 → 100.
    expect(parsed?.score_percent).toBe(100);
    expect(parsed?.correct_answers).toBe(1);
    expect(parsed?.total_questions).toBe(1);

    if (parsed?.quiz_session_id) {
      await admin.from('quiz_responses').delete().eq('quiz_session_id', parsed.quiz_session_id);
      await admin.from('quiz_sessions').delete().eq('id', parsed.quiz_session_id);
    }
  });
});
