/**
 * `get_learning_source` — RPC hardening, live-DB regression
 * (`supabase/migrations/20260820000101_fix_get_learning_source_rpc_hardening.sql`,
 * P0-1, `docs/audits/2026-08-20-comprehensive-code-review.md`).
 *
 * No test exercised this RPC before this file (confirmed by grep —
 * `get_learning_source` had zero hits under `apps/host/src/__tests__` prior).
 * The function itself is still dead code (nothing calls it yet — see the
 * migration's own header), but it is SECURITY DEFINER and will be callable by
 * service_role the moment something wires it up, so it is worth pinning now
 * rather than after the next caller inherits a regression silently.
 *
 * WHAT THIS PINS — the two bug classes an implementation agent introduced and
 * an architect-agent review caught mid-implementation, both genuinely subtle:
 *
 *   1. GRADE VALIDATION (P5): the migration comment calls out that
 *      `p_grade <> ANY (array)` was the first-draft form and is WRONG — "x
 *      differs from AT LEAST ONE element" is true for nearly any x against a
 *      multi-element array, so it rejects every grade, including valid ones.
 *      The shipped form is `NOT (p_grade = ANY (array))`. This test proves
 *      the shipped behavior, not just that the SQL text looks right: all 7
 *      valid grades must be ACCEPTED (a regression back to `<> ANY` would
 *      reject literally every one of them) and a representative set of
 *      invalid strings must be REJECTED.
 *
 *   2. PATH-TRAVERSAL GUARD: the ORIGINAL guard (`v_path LIKE '%/..%' OR
 *      v_path LIKE '%..%/'`) had a second arm that only matches strings
 *      ENDING in `/` — so a LEADING `..` segment (e.g. a path starting
 *      `../...`) satisfies neither arm and sails through. The fix replaces
 *      both arms with a per-segment scan. This test reproduces the EXACT
 *      leading-segment case the audit found (a `..` value at the front of
 *      the built path) and proves it is now rejected.
 *
 * LANE: integration. Self-skips unless real Supabase creds are present
 * (`hasSupabaseIntegrationEnv()`) AND the RPC is deployed on the target DB
 * (`rpcIsDeployed` probe) — same convention as
 * `migrations/check-quiz-answer-e2e.test.ts` and friends. On a normal PR in
 * this sandbox (no `STAGING_SUPABASE_*` secrets) this whole file SKIPS; it
 * arms itself automatically once CI's `integration-tests` job runs against a
 * staging DB carrying this migration. See the structure-contract companion
 * (`src/__tests__/get-learning-source-rpc-hardening-structure.test.ts`) for
 * the assertion that DOES run on every PR.
 *
 * SAFETY: `get_learning_source` is read-only (per its own header — it builds
 * and returns a JSON path descriptor; it does not touch storage or any
 * table), so no seed/teardown is required — every call in this file is a
 * pure, side-effect-free RPC invocation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv, rpcIsDeployed, skipIfRpcNotDeployed } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

const RPC = 'get_learning_source';
const MIGRATION = '20260820000101_fix_get_learning_source_rpc_hardening.sql';

const VALID_ARGS = {
  p_board: 'cbse',
  p_grade: '6',
  p_subject_code: 'math',
  p_sha256_16: '0123456789abcdef',
};

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
// Representative invalid grade strings — NOT exhaustive, but chosen to hit
// distinct failure shapes: out-of-range numeric, non-numeric, float-shaped,
// whitespace-padded, zero-padded, and empty.
const INVALID_GRADES = ['5', '13', 'six', '6.0', ' 6', '6 ', '06', '0', ''];

describeIntegration('get_learning_source — RPC hardening (P0-1, live DB)', () => {
  let admin: SupabaseClient;
  let deployed = false;

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    deployed = await rpcIsDeployed(admin, RPC, VALID_ARGS);
  });

  function callRpc(overrides: Partial<typeof VALID_ARGS & { p_filename: string }> = {}) {
    return admin.rpc(RPC, { ...VALID_ARGS, ...overrides });
  }

  describe('P5 — grade must be an exact string match against 6..12 (regression guard for the <> ANY vs NOT (...= ANY) bug)', () => {
    it('accepts ALL 7 valid CBSE grades — a regression to `<> ANY` would reject every single one of these', async (ctx) => {
      skipIfRpcNotDeployed(ctx, deployed, RPC, MIGRATION);
      for (const grade of VALID_GRADES) {
        const { data, error } = await callRpc({ p_grade: grade });
        expect(error, `grade=${grade} should be ACCEPTED but got: ${error?.message}`).toBeNull();
        expect((data as { grade: string } | null)?.grade).toBe(grade);
      }
    });

    it('rejects a representative set of invalid grade strings with invalid_parameter_value', async (ctx) => {
      skipIfRpcNotDeployed(ctx, deployed, RPC, MIGRATION);
      for (const grade of INVALID_GRADES) {
        const { data, error } = await callRpc({ p_grade: grade });
        expect(data, `grade=${JSON.stringify(grade)} should be REJECTED`).toBeNull();
        expect(error, `grade=${JSON.stringify(grade)} should be REJECTED`).not.toBeNull();
        expect(error?.message ?? '').toMatch(/grade must be one of 6\.\.12/);
      }
    });
  });

  describe('path-traversal guard — rejects a LEADING ".." segment (the exact bug the audit found)', () => {
    it('rejects when the board segment (first path component) is ".."', async (ctx) => {
      skipIfRpcNotDeployed(ctx, deployed, RPC, MIGRATION);
      // Builds v_path = '../6/math/0123456789abcdef/source.pdf'. The OLD guard's
      // second LIKE arm only matched strings ENDING in '/', so a path that
      // merely STARTS with '..' slipped through undetected — this is that
      // exact case.
      const { data, error } = await callRpc({ p_board: '..' });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/traversal|malformed/);
    });

    it('rejects an embedded ".." segment introduced via the filename', async (ctx) => {
      skipIfRpcNotDeployed(ctx, deployed, RPC, MIGRATION);
      const { data, error } = await callRpc({ p_filename: '../secret.pdf' });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/traversal|malformed/);
    });

    it('still accepts a well-formed path with the default filename (non-vacuity: the guard does not reject everything)', async (ctx) => {
      skipIfRpcNotDeployed(ctx, deployed, RPC, MIGRATION);
      const { data, error } = await callRpc();
      expect(error).toBeNull();
      expect((data as { path: string } | null)?.path).toBe(
        'cbse/6/math/0123456789abcdef/source.pdf',
      );
    });
  });
});
