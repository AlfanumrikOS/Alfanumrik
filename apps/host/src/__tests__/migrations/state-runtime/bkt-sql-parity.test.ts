/**
 * SQL ↔ TS parity for the BKT update function.
 *
 * The route's Path C optimistic compute uses the TS updateMasteryBKT.
 * The projector's catch-up compute uses the same TS function. Both must
 * also equal the SQL public.bkt_update that ran inside the atomic RPC
 * (which is what produced the priorMasteryMean in the event payload).
 *
 * If TS and SQL drift, the optimistic value the user sees would not match
 * the projected value the picker reads — the BKT determinism contract
 * (ADR-005 / Path C v2) would be silently broken.
 *
 * This test runs only under the integration suite (RUN_INTEGRATION_TESTS=1
 * + real Supabase env). Required pre-merge run is staging.
 */
import { describe, it, expect } from 'vitest';
import { updateMasteryBKT } from '@alfanumrik/lib/tutor/bkt';
import { makeServiceSupabase } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();

interface ParityFixture {
  prior: number;
  correct: boolean;
}

const fixtures: ParityFixture[] = [
  { prior: 0.30, correct: true },
  { prior: 0.30, correct: false },
  { prior: 0.95, correct: true },
  { prior: 0.95, correct: false },
  { prior: 0.50, correct: true },
  { prior: 0.10, correct: false },
  { prior: 0.78, correct: true },
  { prior: 0.22, correct: false },
  { prior: 0.999, correct: true },
  { prior: 0.001, correct: false },
];

describe('public.bkt_update ≡ updateMasteryBKT (within 1e-9)', () => {
  for (const f of fixtures) {
    it(`prior=${f.prior} correct=${f.correct}`, async () => {
      const { data, error } = await sb.rpc('bkt_update', {
        p_prior: f.prior,
        p_correct: f.correct,
      });
      expect(error).toBeNull();
      const sqlValue = Number(data);
      const tsValue = updateMasteryBKT(f.prior, f.correct);
      // 1e-9 is the determinism contract for Path C v2 — anything looser
      // means the optimistic and projected mastery_mean values can disagree
      // at the boundary cases that students notice.
      expect(Math.abs(sqlValue - tsValue)).toBeLessThan(1e-9);
    });
  }
});
