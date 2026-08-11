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
 * The set of columns `authenticated` may read is DERIVED by replaying the whole
 * migration chain (`deriveChainAcl`), not frozen as a literal. 0014's design is
 * that later migrations ADD columns via additive column-level grants — freezing
 * its 10 columns made every such legitimate grant a red test (it did exactly
 * that when 20260814000015 granted `session_mode`). The teeth are unchanged and
 * are proven by the MUTATION PROOFS block: a table-level grant, a grant of
 * either key column, any grant to anon, and a resume column that no migration
 * grants each still fail.
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

/**
 * The allowlist LITERAL spelled out by 20260814000014 itself — the BASE of the
 * chain, NOT the whole of it.
 *
 * Do NOT use this constant to answer "what may `authenticated` read today". The
 * entire design of 20260814000014 is that a column added LATER is not granted
 * by default (it fails CLOSED) and a later migration must grant it explicitly
 * and additively — which is exactly what 20260814000015:121 does for
 * `session_mode`. Freezing this literal as if it were the complete set turned
 * every legitimate additive grant into a red test; the parity assertion below
 * therefore derives the live set from the whole migration CHAIN via
 * `deriveChainAcl()`. This constant survives only to pin 0014's own text.
 */
const ACL_BASE_ALLOWLIST = [
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

// ── chain ACL derivation ─────────────────────────────────────────────────────
//
// WHY A SIMULATOR AND NOT A FROZEN LITERAL
// ========================================
// 20260814000014 revoked the table-level grant and re-granted from a literal
// 10-column allowlist. Its stated design (that file:130-148) is that a column
// added by a LATER migration is NOT granted by default — it fails CLOSED — and
// must be granted deliberately, additively, column-wise. That is the mechanism
// working, not drifting.
//
// A test that freezes 0014's 10 columns as "the set `authenticated` may ever
// read" therefore goes red on every correct, security-reviewed additive grant.
// It did: 20260814000015:121 grants `session_mode` (and asserts it in its own
// in-transaction post-condition 4b, with 4d re-asserting the answer key is
// still denied), the resume route legitimately selects it, and the parity check
// failed on a codebase that was right.
//
// So the granted set is DERIVED by replaying the chain: 0014's allowlist ∪
// every later additive column grant, minus every later column revoke, using the
// same statement-parsing approach as the DRIFT GUARD below. The assertion keeps
// its teeth — a table-level grant, a grant of either key column, a grant to
// anon, or a resume column that NO migration grants all still fail — but a
// legitimate additive column no longer breaks it.

type ClientRole = 'authenticated' | 'anon';
const CLIENT_ROLES: readonly ClientRole[] = ['authenticated', 'anon'];

interface AclState {
  /** Columns each client role may SELECT, after replaying the chain in order. */
  columns: Record<ClientRole, Set<string>>;
  /** `role:column` → the migration file that last granted it (for failure messages). */
  grantedBy: Map<string, string>;
  /** Every COLUMN-LESS grant to a client role. Each one reopens the whole row. */
  tableLevelGrants: string[];
}

function newAclState(): AclState {
  return {
    columns: { authenticated: new Set<string>(), anon: new Set<string>() },
    grantedBy: new Map<string, string>(),
    tableLevelGrants: [],
  };
}

/**
 * GRANT/REVOKE statements naming this table. `[^;]` bounds each match to a
 * single statement so a `GRANT EXECUTE ON FUNCTION …;` cannot swallow its way
 * across a semicolon into a later mention of the table name.
 */
const ACL_STATEMENT_RE =
  /\b(GRANT|REVOKE)\s+([^;]{0,300}?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?"?quiz_session_shuffles"?\s+(TO|FROM)\s+([^;]{0,200});/gi;

/** `SELECT (a, b)` → ['a','b']; `ALL` / bare `SELECT` → null (= table-level). */
function parseColumnList(privileges: string): string[] | null {
  const m = privileges.match(/\(([^)]*)\)/);
  if (!m) return null;
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/"/g, ''))
    .filter(Boolean);
}

/**
 * `PUBLIC` is expanded to both client roles on GRANT (granting to PUBLIC really
 * does hand it to every role) but NOT on REVOKE — `REVOKE … FROM PUBLIC` does
 * not remove a role-specific grant in PostgreSQL, so pretending it does would
 * make the model claim a column is denied when it is not.
 */
function parseRoles(raw: string, verb: 'GRANT' | 'REVOKE'): ClientRole[] {
  const out = new Set<ClientRole>();
  for (const token of raw.split(',').map(s => s.trim().replace(/"/g, '').toLowerCase())) {
    if (!token) continue;
    if (token === 'public') {
      if (verb === 'GRANT') for (const r of CLIENT_ROLES) out.add(r);
      continue;
    }
    if ((CLIENT_ROLES as readonly string[]).includes(token)) out.add(token as ClientRole);
  }
  return [...out];
}

/** Replay one SQL body against the state. `label` is used in failure messages. */
function applyAclSql(state: AclState, rawSql: string, label: string): AclState {
  const body = stripComments(rawSql);
  ACL_STATEMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = ACL_STATEMENT_RE.exec(body)) !== null) {
    const verb = m[1].toUpperCase() as 'GRANT' | 'REVOKE';
    const privileges = m[2];
    const direction = m[3].toUpperCase();
    const columns = parseColumnList(privileges);
    // Only ALL / SELECT move the READ set. A write-only verb is still drift,
    // but it is the DRIFT GUARD's job, not this model's.
    const touchesRead = /\b(ALL|SELECT)\b/i.test(privileges);

    for (const role of parseRoles(m[4], verb)) {
      if (verb === 'GRANT' && direction === 'TO') {
        if (columns === null) {
          state.tableLevelGrants.push(
            `${label}: table-level GRANT ${privileges.trim().replace(/\s+/g, ' ')} TO ${role}`,
          );
          continue;
        }
        if (!touchesRead) continue;
        for (const c of columns) {
          state.columns[role].add(c);
          state.grantedBy.set(`${role}:${c}`, label);
        }
      } else if (verb === 'REVOKE' && direction === 'FROM') {
        if (!touchesRead) continue;
        if (columns === null) {
          state.columns[role].clear();
          continue;
        }
        for (const c of columns) {
          state.columns[role].delete(c);
          state.grantedBy.delete(`${role}:${c}`);
        }
      }
    }
  }
  return state;
}

/**
 * Replay every root migration from `startFile` (inclusive) to `endFile`
 * (inclusive, defaults to the end of the chain). Starting AT 0014 is what makes
 * an empty initial state correct: 0014's own `REVOKE ALL` is the statement that
 * discards the baseline default-privileges table grant.
 */
function deriveChainAcl(files: string[], startFile: string, endFile?: string): AclState {
  const from = files.indexOf(startFile);
  if (from < 0) throw new Error(`deriveChainAcl: ${startFile} not found in the migration chain`);
  const to = endFile ? files.indexOf(endFile) : files.length - 1;
  const state = newAclState();
  for (const f of files.slice(from, to + 1)) {
    applyAclSql(state, readFileSync(resolve(MIGRATIONS_ABS, f), 'utf8'), f);
  }
  return state;
}

/**
 * The security verdict on a derived state. Empty = the boundary holds.
 * Non-empty = the answer key is reachable, or anon got a read, or something
 * re-granted the whole table.
 */
function aclOffenders(state: AclState): string[] {
  const offenders = [...state.tableLevelGrants];
  for (const role of CLIENT_ROLES) {
    for (const key of ANSWER_KEY_COLUMNS) {
      if (state.columns[role].has(key)) {
        offenders.push(
          `${state.grantedBy.get(`${role}:${key}`) ?? 'unknown'}: ANSWER KEY column ` +
            `${key} is granted to ${role}`,
        );
      }
    }
  }
  for (const c of [...state.columns.anon].sort()) {
    offenders.push(`${state.grantedBy.get(`anon:${c}`) ?? 'unknown'}: anon may SELECT ${c}`);
  }
  return offenders;
}

/** Parse `SHUFFLE_RESUME_COLUMNS` out of the resume module's source text. */
function parseResumeColumns(src: string): string[] {
  const m = src.match(/export const SHUFFLE_RESUME_COLUMNS\s*=\s*([\s\S]*?);/);
  if (!m) throw new Error('SHUFFLE_RESUME_COLUMNS not found in packages/lib/src/quiz/resume.ts');
  return m[1]
    .replace(/['"+\n]/g, ' ')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** Resume columns that no migration in the chain grants, or that are key columns. */
function parityOffenders(resumeColumns: string[], state: AclState): string[] {
  const offenders: string[] = [];
  for (const c of resumeColumns) {
    if ((ANSWER_KEY_COLUMNS as readonly string[]).includes(c)) {
      offenders.push(`resume route selects the ANSWER KEY column "${c}"`);
      continue;
    }
    if (!state.columns.authenticated.has(c)) {
      offenders.push(
        `resume route selects "${c}", which NO migration in the chain grants to ` +
          'authenticated — the resume read will fail 42501 at runtime',
      );
    }
  }
  return offenders;
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

    expect(granted).toEqual([...ACL_BASE_ALLOWLIST].sort());
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

  it('KNOWN GAP (architect-owned): 20260814000014 post-condition 4c asserts only 9 of the 10 columns it grants', () => {
    // Found by architect, 2026-08-11. Migration 20260814000014 GRANTs 10
    // columns (:149-160) but its own in-transaction post-condition `v_open_cols`
    // (:180-184) enumerates only 9 — `options_version_at_serve` is granted and
    // never asserted. So if that ONE grant were dropped or misspelled, the
    // migration would still COMMIT green and the resume path would break at
    // runtime instead of at migration time.
    //
    // Testing does not own migrations, so this is NOT fixed here. It is pinned
    // in its CURRENT state so the gap cannot rot silently: the moment architect
    // adds the missing column to v_open_cols, THIS TEST FAILS and forces the
    // pin (and REG-380's known-gap note) to be updated rather than quietly
    // outliving the defect. Same technique as REG-369's dead-link allowlist.
    const grantMatch = sql.match(
      /GRANT\s+SELECT\s*\(([^)]*)\)\s*ON\s+TABLE\s+public\.quiz_session_shuffles\s+TO\s+authenticated\s*;/i,
    );
    const granted = grantMatch![1]
      .split(',')
      .map(s => s.trim().replace(/"/g, ''))
      .filter(Boolean);

    const openColsMatch = sql.match(/v_open_cols\s+TEXT\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i);
    expect(openColsMatch, 'v_open_cols post-condition array not found in 20260814000014').toBeTruthy();
    const asserted = openColsMatch![1]
      .split(',')
      .map(s => s.trim().replace(/'/g, ''))
      .filter(Boolean);

    const unasserted = granted.filter(c => !asserted.includes(c));

    expect(
      unasserted,
      'The set of GRANTed-but-unasserted columns in 20260814000014 changed. If it ' +
        'is now empty, architect has fixed the gap — DELETE this test and update ' +
        "REG-380's known-gap note. If it grew, a new grant lost its post-condition.",
    ).toEqual(['options_version_at_serve']);

    // The asserted set must never claim a column that is NOT granted, and must
    // never name a key column. Those would be defects of a different, worse kind.
    for (const c of asserted) {
      expect(granted, `v_open_cols asserts "${c}", which the migration never grants`).toContain(c);
    }
    for (const key of ANSWER_KEY_COLUMNS) {
      expect(asserted).not.toContain(key);
    }
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

  it('CHAIN DERIVATION self-check: replaying ONLY 20260814000014 reproduces its literal allowlist', () => {
    // Pins the simulator against the hand-written literal it is replacing. If
    // the parser ever stops understanding a GRANT/REVOKE form, this fails
    // BEFORE the derived set is trusted by anything else in this file.
    const base = deriveChainAcl(files, MIGRATION_FILE, MIGRATION_FILE);
    expect([...base.columns.authenticated].sort()).toEqual([...ACL_BASE_ALLOWLIST].sort());
    expect([...base.columns.anon]).toEqual([]);
    expect(base.tableLevelGrants).toEqual([]);
  });

  it('CHAIN ACL: the union of every column grant since 20260814000014 still denies the answer key and gives anon nothing', () => {
    const chain = deriveChainAcl(files, MIGRATION_FILE);

    expect(
      aclOffenders(chain),
      'the derived ACL over the whole migration chain exposes something it must not',
    ).toEqual([]);

    // The derived set must be a SUPERSET of 0014's base — a later migration may
    // add columns, but silently dropping one would break the resume read.
    for (const c of ACL_BASE_ALLOWLIST) {
      expect(chain.columns.authenticated, `${c} was granted by 0014 and later lost`).toContain(c);
    }

    // And every additive grant is real, not inferred: session_mode is granted by
    // 20260814000015, which is precisely the case the frozen literal got wrong.
    expect(chain.columns.authenticated.has('session_mode')).toBe(true);
    expect(chain.grantedBy.get('authenticated:session_mode')).toMatch(/^20260814000015_/);
  });

  it('CROSS-MODULE PARITY: every resume-route column is granted somewhere in the migration chain', () => {
    const resumeSrc = readFileSync(
      resolve(__dirname, '../../../../../packages/lib/src/quiz/resume.ts'),
      'utf8',
    );
    const cols = parseResumeColumns(resumeSrc);
    expect(cols.length).toBeGreaterThan(0);

    const chain = deriveChainAcl(files, MIGRATION_FILE);
    const offenders = parityOffenders(cols, chain);

    expect(
      offenders,
      'the resume route selects a column the migration chain does not grant to ' +
        'authenticated. Granted set:\n  ' +
        [...chain.columns.authenticated].sort().join(', ') +
        '\nOffenders:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MUTATION PROOFS. The derivation above is only worth having if it still
  // FAILS on the things it is supposed to catch. Each of these feeds synthetic
  // SQL through the SAME parser the real chain goes through and asserts the
  // verdict flips. A green suite where these could not go red would prove
  // nothing.
  // ───────────────────────────────────────────────────────────────────────────

  describe('MUTATION PROOFS — the derived assertion must still be able to fail', () => {
    const chain = () => deriveChainAcl(files, MIGRATION_FILE);

    it('MUTATION: a later table-level GRANT to authenticated is caught', () => {
      const state = applyAclSql(
        chain(),
        'GRANT SELECT ON TABLE public.quiz_session_shuffles TO authenticated;',
        '29999999999999_mutation.sql',
      );
      const offenders = aclOffenders(state);
      expect(offenders.some(o => /table-level GRANT/i.test(o))).toBe(true);
      expect(offenders).not.toEqual([]);
    });

    it('MUTATION: a later table-level GRANT ALL to anon is caught', () => {
      const state = applyAclSql(
        chain(),
        'GRANT ALL ON TABLE public.quiz_session_shuffles TO anon;',
        '29999999999999_mutation.sql',
      );
      expect(aclOffenders(state).some(o => /table-level GRANT ALL TO anon/i.test(o))).toBe(true);
    });

    it('MUTATION: a column-less GRANT TO PUBLIC is caught for both client roles', () => {
      const state = applyAclSql(
        chain(),
        'GRANT SELECT ON TABLE public.quiz_session_shuffles TO PUBLIC;',
        '29999999999999_mutation.sql',
      );
      const offenders = aclOffenders(state);
      expect(offenders.some(o => /TO authenticated$/.test(o))).toBe(true);
      expect(offenders.some(o => /TO anon$/.test(o))).toBe(true);
    });

    for (const key of ANSWER_KEY_COLUMNS) {
      it(`MUTATION: a later column GRANT of ${key} to authenticated is caught`, () => {
        const state = applyAclSql(
          chain(),
          `GRANT SELECT (question_id, ${key}) ON TABLE public.quiz_session_shuffles TO authenticated;`,
          '29999999999999_mutation.sql',
        );
        const offenders = aclOffenders(state);
        expect(offenders).toContainEqual(
          `29999999999999_mutation.sql: ANSWER KEY column ${key} is granted to authenticated`,
        );
      });
    }

    it('MUTATION: a later column GRANT to anon is caught even for a non-key column', () => {
      const state = applyAclSql(
        chain(),
        'GRANT SELECT (question_id) ON TABLE public.quiz_session_shuffles TO anon;',
        '29999999999999_mutation.sql',
      );
      expect(aclOffenders(state)).toContainEqual(
        '29999999999999_mutation.sql: anon may SELECT question_id',
      );
    });

    it('MUTATION: SHUFFLE_RESUME_COLUMNS naming a column no migration grants is caught', () => {
      const offenders = parityOffenders(
        ['question_id', 'session_mode', 'never_granted_column'],
        chain(),
      );
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatch(/never_granted_column.*NO migration in the chain grants/s);
    });

    it('MUTATION: SHUFFLE_RESUME_COLUMNS naming an answer-key column is caught', () => {
      const offenders = parityOffenders(
        ['question_id', 'correct_answer_index_snapshot'],
        chain(),
      );
      expect(offenders).toEqual([
        'resume route selects the ANSWER KEY column "correct_answer_index_snapshot"',
      ]);
    });

    it('CONTROL: a legitimate additive column grant does NOT trip anything', () => {
      // The whole point of the rewrite. This is 20260814000015's shape.
      const state = applyAclSql(
        chain(),
        'GRANT SELECT (some_future_metadata_column) ON TABLE public.quiz_session_shuffles TO authenticated;',
        '29999999999999_additive.sql',
      );
      expect(aclOffenders(state)).toEqual([]);
      expect(parityOffenders(['question_id', 'some_future_metadata_column'], state)).toEqual([]);
    });

    it('CONTROL: a later column REVOKE removes the column from the derived set', () => {
      // Proves the model is a real replay, not an accumulate-only union — a
      // revoked column must stop satisfying the parity check.
      const state = applyAclSql(
        chain(),
        'REVOKE SELECT (session_mode) ON TABLE public.quiz_session_shuffles FROM authenticated;',
        '29999999999999_revoke.sql',
      );
      expect(state.columns.authenticated.has('session_mode')).toBe(false);
      expect(parityOffenders(['session_mode'], state)).toHaveLength(1);
    });
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
