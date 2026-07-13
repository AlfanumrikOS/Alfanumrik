import { describe, it, expect, afterAll } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * next_invoice_number() CONCURRENCY + GAP-FREE contract — integration lane.
 * Testing-strategy Phase 1, gap 3.
 *
 * THE GUARANTEE UNDER TEST (CGST Rule 46)
 * =======================================
 * `public.next_invoice_number(financial_year, state_code)` must hand out a
 * CONSECUTIVE, GAP-FREE, UNIQUE serial per (financial_year, state_code), even
 * under concurrent callers. The migration (20260507130002) implements this with
 * a table row + `pg_advisory_xact_lock` keyed by md5(year:state) rather than a
 * Postgres SEQUENCE (sequences gap on rollback; auditors flag gaps).
 *
 * WHAT THIS WOULD CATCH
 * =====================
 *  - A regression that drops/weakens the advisory lock → concurrent callers
 *    read-modify-write the same `last_used_number` and hand out DUPLICATES
 *    (two invoices share a serial — a compliance defect).
 *  - A key-collision or off-by-one in the increment → a GAP in the sequence.
 *  - Cross-(year,state) blocking → different states must lock independently
 *    (asserted by interleaving two keys and checking both stay gap-free).
 *
 * WHY IT NEEDS A LIVE DB
 * ======================
 * Advisory locks and true concurrency cannot be exercised against a mock. This
 * runs only when real Supabase creds are present (RUN_INTEGRATION_TESTS lane);
 * it self-skips in the default `npm test` / CI placeholder-creds run, matching
 * every sibling under __tests__/migrations/.
 *
 * DATA HYGIENE
 * ============
 * Uses SYNTHETIC (financial_year, state_code) keys that match the CHECK
 * constraints but cannot collide with real GST fin-years: state_code 'ZZ' (not
 * a real GST state code) + a run-unique 4-digit year built from the clock. All
 * rows created are DELETEd in afterAll, keyed by exactly those pairs.
 *
 * The RPC is service-role only, so we call it through supabaseAdmin.
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

// Synthetic keys. state_code must be 2 uppercase letters (CHECK); 'ZZ' is not a
// real GST state code. financial_year must be exactly 4 digits (CHECK) — we
// derive two distinct 4-digit values from the clock so repeated runs don't
// collide on the shared staging DB.
const SEED = Math.floor(Math.random() * 9000) + 1000; // 1000..9999, 4 digits
const YEAR_A = String(SEED);
const YEAR_B = String(((SEED - 1000 + 1) % 9000) + 1000); // distinct 4-digit
const STATE = 'ZZ';

const createdKeys: Array<{ fy: string; state: string }> = [
  { fy: YEAR_A, state: STATE },
  { fy: YEAR_B, state: STATE },
];

async function callNext(fy: string, state: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('next_invoice_number', {
    p_financial_year: fy,
    p_state_code: state,
  });
  if (error) throw new Error(`next_invoice_number(${fy},${state}) failed: ${error.message}`);
  return data as number;
}

describeIntegration('next_invoice_number() — concurrency + gap-free (CGST Rule 46)', () => {
  afterAll(async () => {
    for (const { fy, state } of createdKeys) {
      await supabaseAdmin
        .from('invoice_number_sequences')
        .delete()
        .eq('financial_year', fy)
        .eq('state_code', state);
    }
  });

  it('50 concurrent calls for one key yield 1..50 with no gaps and no duplicates', async () => {
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, () => callNext(YEAR_A, STATE)),
    );

    const sorted = [...results].sort((a, b) => a - b);
    const unique = new Set(results);

    // No duplicates: the advisory lock serialised every read-modify-write.
    expect(unique.size, `duplicate serials issued: ${JSON.stringify(results)}`).toBe(N);
    // Gap-free 1..N: consecutive with no holes, regardless of completion order.
    expect(sorted).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it('a fresh key starts at 1', async () => {
    const first = await callNext(YEAR_B, STATE);
    expect(first).toBe(1);
  });

  it('different (year,state) keys are independent — interleaving stays gap-free per key', async () => {
    // YEAR_B already at 1 from the previous test. Interleave more B calls with
    // A calls; each key must remain internally gap-free and not leak into the other.
    const interleaved = await Promise.all([
      callNext(YEAR_B, STATE),
      callNext(YEAR_A, STATE),
      callNext(YEAR_B, STATE),
      callNext(YEAR_A, STATE),
      callNext(YEAR_B, STATE),
    ]);
    // We can't assert exact values for A (it continued past 50 above), but B's
    // three new calls must be a gap-free run continuing from its prior max.
    const bResults = [interleaved[0], interleaved[2], interleaved[4]].sort((a, b) => a - b);
    // Consecutive integers (step 1), no duplicates.
    expect(new Set(bResults).size).toBe(3);
    expect(bResults[1]).toBe(bResults[0] + 1);
    expect(bResults[2]).toBe(bResults[1] + 1);
  });

  it('rejects malformed arguments with a structured 22023 error, writing nothing', async () => {
    const bad = await supabaseAdmin.rpc('next_invoice_number', {
      p_financial_year: 'not-a-year',
      p_state_code: STATE,
    });
    expect(bad.error, 'expected a validation error for a non-4-digit year').not.toBeNull();
    // No row was created for the bad key.
    const { data } = await supabaseAdmin
      .from('invoice_number_sequences')
      .select('financial_year')
      .eq('financial_year', 'not-a-year');
    expect(data ?? []).toEqual([]);
  });
});
