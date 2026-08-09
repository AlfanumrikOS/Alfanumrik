import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Audit remediation regression (2026-08-14): anon/PUBLIC EXECUTE revoke batch.
 *
 * Pins the ACL posture introduced by
 * `supabase/migrations/20260814000004_revoke_anon_execute_secdef_batch.sql`.
 *
 * Root cause being pinned: Supabase's baseline `ALTER DEFAULT PRIVILEGES ...
 * GRANT ALL ON FUNCTIONS` means every function in `public` is born with EXECUTE
 * granted to PUBLIC. A `REVOKE ... FROM anon` (or `FROM authenticated`) alone is
 * a SILENT NO-OP against that PUBLIC grant — the same defect class as the
 * #676/#678 saga and 20260515000002. These assertions fail if a future edit
 * reverts to the incomplete shape.
 *
 * Structural/source-level checks only (same pattern as
 * `answer-key-oracle-closure.test.ts`): Postgres is not run from Vitest. To keep
 * the migration's long explanatory header prose from satisfying an assertion,
 * every content check runs against `ddl` — the migration text with all `--`
 * comment lines stripped — not against the raw file.
 */

const MIGRATION_FILE =
  'supabase/migrations/20260814000004_revoke_anon_execute_secdef_batch.sql';

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

/**
 * Extract a specific `DO $tag$ ... $tag$;` block by its dollar-quote tag.
 * The migration now carries TWO DO blocks (B3 + Part C), so an untagged
 * "first DO block" match would silently assert against the wrong one.
 */
function doBlock(ddl: string, tag: string): string | null {
  const m = ddl.match(
    new RegExp(String.raw`DO\s+\$${tag}\$([\s\S]*?)\$${tag}\$\s*;`),
  );
  return m ? m[0] : null;
}

describe.skipIf(!MIGRATION_PRESENT)(
  '20260814000004 anon/PUBLIC EXECUTE revoke batch',
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
      // Sanity check on the helper itself: the header explains the root cause,
      // and none of that prose may leak into `ddl`.
      expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES/);
      expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES/);
    });

    // ── PART A ──────────────────────────────────────────────────────────────
    describe('A1: check_and_record_usage locked to service_role', () => {
      it('revokes from PUBLIC, anon AND authenticated', () => {
        const revoke = ddl.match(
          /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.check_and_record_usage\s*\([^)]*\)\s+FROM\s+([^;]+);/i,
        );
        expect(revoke).not.toBeNull();
        const targets = revoke![1].toLowerCase();
        expect(targets).toMatch(/\bpublic\b/);
        expect(targets).toMatch(/\banon\b/);
        expect(targets).toMatch(/\bauthenticated\b/);
      });

      it('grants EXECUTE to service_role only', () => {
        const grant = ddl.match(
          /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.check_and_record_usage\s*\([^)]*\)\s+TO\s+([^;]+);/i,
        );
        expect(grant).not.toBeNull();
        const targets = grant![1].toLowerCase();
        expect(targets).toMatch(/\bservice_role\b/);
        expect(targets).not.toMatch(/\banon\b/);
        expect(targets).not.toMatch(/\bauthenticated\b/);
      });

      it('documents the service_role-only posture in a COMMENT', () => {
        expect(ddl).toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.check_and_record_usage/i);
      });
    });

    // ── PART B ──────────────────────────────────────────────────────────────
    describe('B1: atomic_quiz_profile_update 5-arg — the missing PUBLIC leg', () => {
      it('revokes from PUBLIC (the piece 20260702170000 omitted)', () => {
        const revoke = ddl.match(
          /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.atomic_quiz_profile_update\s*\([\s\S]*?\)\s*FROM\s+([^;]+);/i,
        );
        expect(revoke).not.toBeNull();
        const targets = revoke![1].toLowerCase();
        expect(targets).toMatch(/\bpublic\b/);
        expect(targets).toMatch(/\banon\b/);
        expect(targets).toMatch(/\bauthenticated\b/);
      });

      it('uses the exact 5-arg identity signature', () => {
        expect(ddl).toMatch(/p_student_id\s+uuid/i);
        expect(ddl).toMatch(/p_xp\s+integer/i);
        expect(ddl).toMatch(/p_correct\s+integer/i);
        expect(ddl).toMatch(/p_total\s+integer/i);
        expect(ddl).toMatch(/p_subject\s+text/i);
      });

      it('does NOT re-grant it to authenticated (zero callers — stays unreachable)', () => {
        const grant = ddl.match(
          /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.atomic_quiz_profile_update[\s\S]*?TO\s+([^;]+);/i,
        );
        expect(grant).toBeNull();
      });
    });

    describe('B2: check_quiz_answer — anon only, authenticated PRESERVED', () => {
      it('revokes EXECUTE FROM anon', () => {
        expect(ddl).toMatch(
          /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.check_quiz_answer\s*\(\s*uuid\s*,\s*uuid\s*,\s*int\s*,\s*int\s*\)\s+FROM\s+anon\s*;/i,
        );
      });

      it('REGRESSION WITNESS: still grants EXECUTE TO authenticated', () => {
        // packages/lib/src/supabase.ts:426 -> apps/host/src/app/(student)/quiz/page.tsx:1176
        // is a LIVE browser caller. Revoking authenticated breaks /quiz
        // per-question immediate feedback.
        const grant = ddl.match(
          /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.check_quiz_answer\s*\([^)]*\)\s+TO\s+([^;]+);/i,
        );
        expect(grant).not.toBeNull();
        const targets = grant![1].toLowerCase();
        expect(targets).toMatch(/\bauthenticated\b/);
        expect(targets).toMatch(/\bservice_role\b/);
      });

      it('contains NO revoke of check_quiz_answer from authenticated or PUBLIC', () => {
        const revokes = ddl.match(
          /REVOKE[^;]*check_quiz_answer[^;]*;/gi,
        );
        expect(revokes).not.toBeNull();
        for (const stmt of revokes!) {
          expect(stmt.toLowerCase()).not.toMatch(/\bauthenticated\b/);
          // `FROM PUBLIC` would also strip the browser path's inherited access
          // path assumptions; 20260802130000 already revoked PUBLIC correctly.
          expect(stmt.toLowerCase()).not.toMatch(/from\s+public\b/);
        }
      });
    });

    describe('B3: submit_mock_test_attempt — overloads resolved DYNAMICALLY', () => {
      /**
       * REGRESSION WITNESS (quality BLOCKER 1, 2026-08-14): an earlier draft
       * hardcoded TWO overloads, including
       * `submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb)`.
       * That 5-arg overload DOES NOT EXIST — 20260722097100:113 executes
       * `DROP FUNCTION IF EXISTS public.submit_mock_test_attempt(
       *    uuid, uuid, jsonb, integer, jsonb);`
       * immediately before creating the 6-arg version, and that migration's own
       * verification block asserts pronargs = 6. GRANT/REVOKE resolve by EXACT
       * identity-arg match and do NOT fall through via DEFAULT params, so the
       * hardcoded statement raises 42883 and rolls back the whole migration on
       * CI live-DB, fresh staging and DR. Overloads must be discovered from
       * pg_proc at apply time instead.
       */
      const block = () => doBlock(ddl, 'revoke_submit_mock_test_attempt');

      it('handles submit_mock_test_attempt inside an existence-checked DO block', () => {
        const b = block();
        expect(b).not.toBeNull();
        expect(b!).toContain('submit_mock_test_attempt');
        expect(b!).toMatch(/FROM\s+pg_proc/i);
        expect(b!).toMatch(/pg_get_function_identity_arguments/i);
        expect(b!).toMatch(/EXECUTE\s+format\s*\(/i);
      });

      it('revokes PUBLIC/anon/authenticated and re-grants service_role per overload found', () => {
        const b = block()!;
        expect(b).toMatch(
          /REVOKE\s+ALL\s+ON\s+ROUTINE\s+public\.%I\(%s\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
        );
        expect(b).toMatch(
          /GRANT\s+EXECUTE\s+ON\s+ROUTINE\s+public\.%I\(%s\)\s+TO\s+service_role/i,
        );
        // Never handed back to a client-reachable role.
        expect(b).not.toMatch(/GRANT[^']*TO\s+(anon|authenticated)/i);
      });

      it('has NO bare top-level REVOKE/GRANT naming submit_mock_test_attempt with a hardcoded signature', () => {
        const outside = ddl.replace(block()!, '');
        expect(outside).not.toMatch(
          /REVOKE[\s\S]{0,60}?submit_mock_test_attempt\s*\(/i,
        );
        expect(outside).not.toMatch(
          /GRANT[\s\S]{0,60}?submit_mock_test_attempt\s*\(/i,
        );
      });

      it('the nonexistent 5-arg signature is NOT a hardcoded target anywhere in active DDL', () => {
        // (uuid, uuid, jsonb, integer, jsonb) — dropped by 20260722097100.
        expect(ddl).not.toMatch(
          /submit_mock_test_attempt\s*\(\s*uuid\s*,\s*uuid\s*,\s*jsonb\s*,\s*integer\s*,\s*jsonb\s*\)/i,
        );
        // …and no hardcoded signature of ANY arity survives in the DDL.
        expect(ddl).not.toMatch(/submit_mock_test_attempt\s*\(\s*uuid/i);
      });
    });

    describe('B4: reset_demo_student — ACL drift removed', () => {
      it('revokes from PUBLIC (had no grant/revoke in any prior migration)', () => {
        const revoke = ddl.match(
          /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.reset_demo_student\s*\(\s*uuid\s*\)\s+FROM\s+([^;]+);/i,
        );
        expect(revoke).not.toBeNull();
        const targets = revoke![1].toLowerCase();
        expect(targets).toMatch(/\bpublic\b/);
        expect(targets).toMatch(/\banon\b/);
        expect(targets).toMatch(/\bauthenticated\b/);
      });
    });

    // ── PART C ──────────────────────────────────────────────────────────────
    /**
     * ⚠ THESE ARE NOT "ZERO-CALLER" / DEAD FUNCTIONS. An earlier revision of
     * this file labelled them that way; the claim is FALSE and must not be
     * reintroduced. What is actually true is narrower: these seven routines
     * have NO REPO SOURCE and no repo reference — no .ts/.tsx/.dart/.sql call
     * site, no entry in the generated database.types.ts `Functions` block —
     * because they were created out-of-band and exist only in the deployed
     * database. "No repository reference" is NOT evidence that a deployed
     * object is dead; a repo grep is not a caller audit.
     *
     * LIVE EVIDENCE (reproduced against the database 2026-08-14; mirrored in
     * the migration's own PART C header). Three of the seven are invoked
     * continuously by pg_cron jobs that exist only in the database:
     *   - job 24 `agent-timeout-sweep-every-minute`, schedule `30 seconds`,
     *     ACTIVE, username=postgres
     *       -> `select public.agent_timeout_sweep();`
     *   - job 26 `agent-worker-tick-every-minute`, schedule `10 seconds`,
     *     ACTIVE, username=postgres
     *       -> `select public.agent_worker_tick('cron-worker');`
     *   - job 27 `adaptive_intervention_pipeline_q15m`, schedule every 15
     *     minutes, ACTIVE, username=postgres
     *       -> `select public.run_adaptive_intervention_pipeline(200, 0.65);`
     * pg_stat_statements corroborates the volume: agent_worker_tick 63,017
     * calls; run_adaptive_intervention_pipeline 699 calls.
     *
     * The other four (agent_claim_step, agent_complete_step,
     * agent_enqueue_step, agent_heartbeat) are called INTERNALLY from those
     * SECURITY DEFINER parents. An internal call runs with the definer's
     * privileges, so those four are immune to EXECUTE grants entirely.
     *
     * INVOKED, BUT NOT PRODUCTIVE — two separate claims, stated separately on
     * purpose. agent_runs holds 2 rows and agent_steps 7, both last written
     * 2026-05-10; agent_anomalies and agent_prompts are empty. What runs is an
     * idle poll loop over an empty queue. Unproductive is not uncalled, and
     * none of these is droppable on this evidence.
     *
     * WHY REVOKING IS NONETHELESS SAFE: `postgres` (the OWNER) and
     * `service_role` each hold an EXPLICIT, separately-listed EXECUTE grant in
     * proacl (`postgres=X/postgres`, `service_role=X/postgres`) — their
     * privilege does NOT derive from the PUBLIC `=X` entry, so
     * `REVOKE ... FROM PUBLIC, anon, authenticated` cannot remove it. All
     * three pg_cron jobs run as `postgres`. The revoke therefore strips only
     * the client-reachable PostgREST roles and leaves every live caller
     * running exactly as before.
     */
    describe('C: routines with NO REPO SOURCE (live-DB-only; several have live pg_cron callers)', () => {
      /**
       * LIVE_ONLY = defined only in the deployed database (no source in
       * supabase/migrations/, no repo reference). The name is about where the
       * DEFINITION lives, not about whether anything calls them — three of
       * these have active pg_cron callers, per the block comment above.
       */
      const LIVE_ONLY = [
        'run_adaptive_intervention_pipeline',
        'agent_claim_step',
        'agent_complete_step',
        'agent_enqueue_step',
        'agent_heartbeat',
        'agent_timeout_sweep',
        'agent_worker_tick',
      ];

      const doBlockMatch = () => doBlock(ddl, 'revoke_live_only_functions');

      it('has a DO block', () => {
        expect(doBlockMatch()).not.toBeNull();
      });

      it('references all 7 live-DB-only routine names inside the DO block', () => {
        const body = doBlockMatch()!;
        for (const name of LIVE_ONLY) {
          expect(body).toContain(name);
        }
      });

      it('checks existence via pg_proc / to_regprocedure rather than assuming', () => {
        const body = doBlockMatch()!;
        expect(body).toMatch(/pg_proc|to_regprocedure/i);
        // Overload-safe dynamic signature rendering.
        expect(body).toMatch(/pg_get_function_identity_arguments/i);
        expect(body).toMatch(/EXECUTE\s+format\s*\(/i);
      });

      it('has NO bare top-level REVOKE on the live-DB-only functions (would break fresh DBs)', () => {
        const block = doBlockMatch()!;
        const outside = ddl.replace(block, '');
        for (const name of LIVE_ONLY) {
          expect(outside).not.toMatch(
            new RegExp(String.raw`REVOKE\s+[\s\S]{0,40}?ON\s+FUNCTION\s+public\.${name}\b`, 'i'),
          );
        }
      });
    });

    // ── Dynamic-DDL safety (quality MAJOR 3 + MINOR 4, 2026-08-14) ──────────
    describe('DO blocks use ON ROUTINE and report a processed count', () => {
      const TAGS = ['revoke_submit_mock_test_attempt', 'revoke_live_only_functions'];

      it('every dynamic REVOKE/GRANT targets ON ROUTINE, never ON FUNCTION', () => {
        // `REVOKE ... ON FUNCTION` raises 42809 against a PROCEDURE. Because a
        // DO block only fires where the object exists, that failure would land
        // on PRODUCTION ONLY and never reproduce in CI. ROUTINE covers
        // functions, aggregates and procedures alike.
        for (const tag of TAGS) {
          const body = doBlock(ddl, tag);
          expect(body, `DO block $${tag}$ missing`).not.toBeNull();
          expect(body!).toMatch(/ON\s+ROUTINE\s+public\.%I\(%s\)/i);
          expect(body!).not.toMatch(/ON\s+FUNCTION/i);
        }
      });

      it('each DO block RAISE NOTICEs how many routines it processed', () => {
        for (const tag of TAGS) {
          const body = doBlock(ddl, tag)!;
          // A counter variable that is incremented in the loop...
          expect(body).toMatch(/v_count\s+integer\s*:=\s*0/i);
          expect(body).toMatch(/v_count\s*:=\s*v_count\s*\+\s*1/i);
          // ...and reported after the loop, so an operator can tell
          // "correctly skipped on a fresh DB" (0) from "loop never ran".
          const afterLoop = body.slice(body.lastIndexOf('END LOOP;'));
          expect(afterLoop).toMatch(/RAISE\s+NOTICE[\s\S]*v_count/i);
        }
      });
    });

    // ── Scope guard ─────────────────────────────────────────────────────────
    it('does NOT touch security_reserve_quota (already locked by 20260618000001)', () => {
      expect(ddl).not.toMatch(/security_reserve_quota/);
    });

    it('modifies no function bodies (revoke/grant/comment only)', () => {
      expect(ddl).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
      expect(ddl).not.toMatch(/DROP\s+FUNCTION/i);
      expect(ddl).not.toMatch(/DROP\s+TABLE/i);
    });
  },
);
