/**
 * Decision-table pin for the live-DB CAPABILITY PROBE (`isMissingRpcError` /
 * `rpcIsDeployed` in `src/__tests__/helpers/integration.ts`).
 *
 * WHY THIS TEST EXISTS
 * ====================
 * The probe lets a live-DB suite SKIP when the RPC it pins is not deployed to the
 * target environment yet (the chicken-and-egg: a PR that adds BOTH a migration and
 * the suite pinning it would otherwise be unmergeable — the suite is red until the
 * migration reaches staging, and it only reaches staging by merging).
 *
 * That escape hatch is a LIABILITY if it is even slightly too wide. A probe that
 * mistakes a REAL breakage for "not deployed" converts a red suite into a silent
 * skip — worse than the deadlock it was built to fix, because the suite then rots
 * into permanent green while the invariant it guards is unprotected.
 *
 * So the asymmetry below is the actual safety property, and it is pinned here
 * rather than left to a comment:
 *   RPC genuinely ABSENT            -> skip   (unmergeable-PR deadlock broken)
 *   RPC PRESENT but MISBEHAVING     -> FAIL   (never swallowed)
 *
 * These are pure-function tests: no DB, no creds, so they run in the NORMAL lane
 * and guard the integration lane's gate even when nobody runs the integration lane.
 */
import { describe, it, expect, vi } from 'vitest';
import { isMissingRpcError, rpcIsDeployed } from './integration';

const FN = 'get_curriculum_versions';

/** Minimal stub of the one client method the probe touches. */
function clientReturning(error: { code?: string; message?: string } | null) {
  const rpc = vi.fn().mockResolvedValue({ error });
  return { client: { rpc }, rpc };
}

describe('isMissingRpcError — treats ONLY function-resolution failures as absence', () => {
  it('PGRST202 (function not in PostgREST schema cache) means ABSENT', () => {
    expect(
      isMissingRpcError(
        {
          code: 'PGRST202',
          message: `Could not find the function public.${FN}(p_grade) in the schema cache`,
        },
        FN,
      ),
    ).toBe(true);
  });

  it('42883 naming the probed function means ABSENT', () => {
    expect(
      isMissingRpcError(
        { code: '42883', message: `function ${FN}(text) does not exist` },
        FN,
      ),
    ).toBe(true);
  });

  it('no error at all is NOT absence', () => {
    expect(isMissingRpcError(null, FN)).toBe(false);
    expect(isMissingRpcError(undefined, FN)).toBe(false);
  });

  // ── The anti-swallow cases. Each of these is a REAL breakage that the repo's
  // deliberately-broad `isMissingObjectError()` would misread as "absent". ──

  it('42P01 undefined_table is NOT absence — a half-applied migration must FAIL, not skip', () => {
    // RPC deployed, but `curriculum_version_watermark` (same migration) missing.
    // This is precisely the delete-safety hole the suite exists to catch; if the
    // probe skipped here, that hole would ship silently green.
    expect(
      isMissingRpcError(
        {
          code: '42P01',
          message: 'relation "curriculum_version_watermark" does not exist',
        },
        FN,
      ),
    ).toBe(false);
  });

  it('42883 raised by a DIFFERENT function is NOT absence (deployed RPC with a broken body)', () => {
    // The RPC resolved fine; something its BODY calls is missing. Real break.
    expect(
      isMissingRpcError(
        { code: '42883', message: 'function some_missing_helper(text) does not exist' },
        FN,
      ),
    ).toBe(false);
  });

  it('a bare "does not exist" message with no code is NOT absence', () => {
    // The substring match that makes the production fail-soft detector wide is
    // exactly what must NOT be inherited here.
    expect(isMissingRpcError({ message: 'column "grade_short" does not exist' }, FN)).toBe(false);
  });

  it('permission / runtime / argument errors are NOT absence', () => {
    expect(
      isMissingRpcError({ code: '42501', message: 'permission denied for function' }, FN),
    ).toBe(false);
    expect(isMissingRpcError({ code: '22P02', message: 'invalid input syntax' }, FN)).toBe(false);
    expect(isMissingRpcError({ code: 'XX000', message: 'internal error' }, FN)).toBe(false);
  });
});

describe('rpcIsDeployed — resolves the probe to a run/skip decision', () => {
  it('returns FALSE (=> suite skips) when the function is not deployed', async () => {
    const { client } = clientReturning({
      code: 'PGRST202',
      message: `Could not find the function public.${FN}(p_grade) in the schema cache`,
    });
    await expect(rpcIsDeployed(client, FN, { p_grade: '6' })).resolves.toBe(false);
  });

  it('returns TRUE (=> suite runs) when the call succeeds', async () => {
    const { client } = clientReturning(null);
    await expect(rpcIsDeployed(client, FN, { p_grade: '6' })).resolves.toBe(true);
  });

  it('returns TRUE (=> suite runs and FAILS) when the RPC is deployed but erroring', async () => {
    // The single most important case: deployed-but-broken must never be skipped.
    const { client } = clientReturning({
      code: '42P01',
      message: 'relation "curriculum_version_watermark" does not exist',
    });
    await expect(rpcIsDeployed(client, FN, { p_grade: '6' })).resolves.toBe(true);
  });

  it('returns TRUE (=> suite runs and FAILS) when the DB is unreachable / errors opaquely', async () => {
    // An unreachable DB is not evidence of absence. Fail loudly rather than skip.
    const { client } = clientReturning({ message: 'fetch failed: getaddrinfo ENOTFOUND' });
    await expect(rpcIsDeployed(client, FN, { p_grade: '6' })).resolves.toBe(true);
  });

  it('probes the named function exactly once, with the benign read-only args given', async () => {
    const { client, rpc } = clientReturning(null);
    await rpcIsDeployed(client, FN, { p_grade: '6' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(FN, { p_grade: '6' });
  });
});
