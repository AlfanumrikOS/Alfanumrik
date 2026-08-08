import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Audit remediation regression (2026-08-14): answer-key oracle closure + v1 gate.
 *
 * Pins the security posture introduced by
 * `supabase/migrations/20260814000000_answer_key_oracle_closure_and_v1_gate.sql`:
 *
 *   C1 (Critical): `get_question_answer_key(uuid)` — an unguarded SECURITY DEFINER
 *      answer-key oracle — must have `authenticated` EXECUTE revoked (service_role
 *      only). Before this migration it was granted to authenticated with no
 *      authorization check.
 *   H2 (High):     `get_pending_link_requests(p_student_auth_id uuid)` must contain
 *      an `auth.uid()` ownership guard so a caller cannot read another student's
 *      pending guardian-link requests (guardian name/email IDOR).
 *   H3/F5 (High):  `select_questions_by_irt_info_v2` (zero callers) must have
 *      `authenticated` EXECUTE revoked.
 *   H1 (High):     legacy `submit_quiz_results` (v1) must refuse to grade when the
 *      `ff_v1_quiz_rpc_blocked` kill switch is ON, and its scoring body must be
 *      preserved byte-for-byte from 20260707010000 (the gate is inserted only after
 *      the ownership check — no scoring change).
 *
 * These are source-level structural checks (the same pattern as
 * `rls-student-id-policies.test.ts`): we do NOT run Postgres from Vitest, but the
 * checks catch accidental reverts or regressions during refactors.
 */

const MIGRATION_FILE =
  'supabase/migrations/20260814000000_answer_key_oracle_closure_and_v1_gate.sql';
const V1_SOURCE_FILE = 'supabase/migrations/20260707010000_rca_final_fixes.sql';

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

const MIGRATION_PRESENT = resolveRepo(MIGRATION_FILE) !== null;

describe.skipIf(!MIGRATION_PRESENT)(
  '20260814000000 answer-key oracle closure + v1 gate',
  () => {
    const sql = readFile(MIGRATION_FILE);

    it('migration exists', () => {
      expect(MIGRATION_PRESENT).toBe(true);
    });

    it('is transactional (BEGIN ... COMMIT)', () => {
      expect(sql).toMatch(/BEGIN;/);
      expect(sql).toMatch(/COMMIT;/);
    });

    describe('C1: get_question_answer_key oracle', () => {
      it('revokes authenticated EXECUTE', () => {
        expect(sql).toMatch(
          /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_question_answer_key\(uuid\)\s+FROM\s+authenticated/i,
        );
      });

      it('does NOT re-grant authenticated EXECUTE after the revoke', () => {
        const revokeIndex = sql.search(
          /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_question_answer_key/i,
        );
        const laterGrant = sql
          .slice(revokeIndex)
          .match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_question_answer_key\(uuid\)\s+TO\s+authenticated/i);
        expect(laterGrant).toBeNull();
      });

      it('documents service_role-only posture in a COMMENT', () => {
        expect(sql).toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.get_question_answer_key/i);
      });
    });

    describe('H2: get_pending_link_requests ownership guard', () => {
      it('contains an auth.uid() ownership guard', () => {
        expect(sql).toMatch(
          /auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+auth\.uid\(\)\s+<>\s+p_student_auth_id/i,
        );
        expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'Access\s+denied:\s+caller\s+does\s+not\s+own\s+student\s+auth/i);
      });
    });

    describe('H3/F5: select_questions_by_irt_info_v2 revocation', () => {
      it('revokes authenticated EXECUTE on the zero-caller IRT shadow RPC', () => {
        expect(sql).toMatch(
          /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.select_questions_by_irt_info_v2\(uuid,\s*text,\s*text,\s*integer,\s*integer,\s*uuid\[\]\)\s+FROM\s+authenticated/i,
        );
      });
    });

    describe('H1: v1 submit_quiz_results ff_v1_quiz_rpc_blocked gate', () => {
      it('contains the kill-switch gate reading ff_v1_quiz_rpc_blocked', () => {
        expect(sql).toMatch(/ff_v1_quiz_rpc_blocked/);
        expect(sql).toMatch(
          /WHERE\s+flag_name\s*=\s*'ff_v1_quiz_rpc_blocked'\s+AND\s+is_enabled\s*=\s*true/i,
        );
        expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'v1_quiz_rpc_blocked:/i);
      });

      it('injects the gate AFTER the ownership check (before the response loop)', () => {
        // Search only within the function definition (after CREATE OR REPLACE),
        // so the header comment cannot satisfy the assertion.
        const fnStartIdx = sql.indexOf('CREATE OR REPLACE FUNCTION public.submit_quiz_results(');
        expect(fnStartIdx).toBeGreaterThan(-1);
        const fnText = sql.slice(fnStartIdx);

        const ownershipIdx = fnText.search(/caller\s+does\s+not\s+own\s+student/i);
        const gateIdx = fnText.search(/ff_v1_quiz_rpc_blocked/);
        const loopIdx = fnText.indexOf('FOR r IN SELECT * FROM jsonb_array_elements(p_responses)');
        expect(ownershipIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeGreaterThan(ownershipIdx);
        expect(gateIdx).toBeLessThan(loopIdx);
      });

      it('preserves the v1 scoring body byte-for-byte from 20260707010000 (minus the gate)', () => {
        const orig = readFile(V1_SOURCE_FILE);
        const origLines = orig.split('\n');
        const newLines = sql.split('\n');

        // Original v1 function = lines 7..332 of 20260707010000 (0-indexed 6..331).
        const origFnStart = origLines.findIndex((l) =>
          l.includes('CREATE OR REPLACE FUNCTION public.submit_quiz_results('),
        );
        expect(origFnStart).toBe(6);

        const newFnStart = newLines.findIndex((l) =>
          l.includes('CREATE OR REPLACE FUNCTION public.submit_quiz_results('),
        );
        expect(newFnStart).toBeGreaterThan(-1);

        // Locate the end of the function in both (the first standalone `$$;` after the start).
        const origEnd = origLines.findIndex(
          (l, i) => i > origFnStart && /^\$\$;/.test(l),
        );
        const newEnd = newLines.findIndex(
          (l, i) => i > newFnStart && /^\$\$;/.test(l),
        );
        expect(origEnd).toBeGreaterThan(origFnStart);
        expect(newEnd).toBeGreaterThan(newFnStart);

        const origBody = origLines.slice(origFnStart, origEnd);
        const newBody = newLines.slice(newFnStart, newEnd);

        // Strip the injected gate block (the 14 lines between the ownership END IF;
        // and the response loop) from the new body, then compare byte-for-byte.
        const gateStart = newBody.findIndex((l) => l.includes('-- H1 gate'));
        expect(gateStart).toBeGreaterThan(-1);
        const gateEnd = newBody.findIndex((l, i) => i > gateStart && /^\s*END IF;/.test(l));
        expect(gateEnd).toBeGreaterThan(gateStart);

        const stripped = [
          ...newBody.slice(0, gateStart),
          ...newBody.slice(gateEnd + 1),
        ];

        // Normalize for trailing whitespace/CRLF and blank-line variance
        // (the gate block leaves a blank-line offset), then compare the
        // non-empty line sequences. Any substantive change to the scoring
        // body still fails this comparison.
        const norm = (arr: string[]) =>
          arr.map((l) => l.replace(/\r$/, '').trim()).filter((l) => l.length > 0);
        const a = norm(origBody);
        const b = norm(stripped);
        expect(b).toEqual(a);
      });
    });
  },
);
