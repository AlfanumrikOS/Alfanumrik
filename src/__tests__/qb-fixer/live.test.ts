/**
 * Live integration test for the QB fix-failed-questions agent.
 *
 * Gated by RUN_LIVE_AI_TESTS=1. Pulls 5 known-failed rows from staging,
 * runs the agent against each, asserts ≥3 of 5 land in 'verified'.
 *
 *   RUN_LIVE_AI_TESTS=1 npx vitest run src/__tests__/qb-fixer/live.test.ts
 */

import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runFixFailedQuestions } from '@/lib/ai/agents/agents/fix-failed-questions';

const live = process.env.RUN_LIVE_AI_TESTS === '1';
const d = live ? describe : describe.skip;

d('fix-failed-questions (live)', () => {
  it(
    'recovers ≥60% of 5 failed rows',
    async () => {
      const { data: rows } = await supabaseAdmin
        .from('question_bank')
        .select('id')
        .eq('verification_state', 'failed')
        .limit(5);

      type Row = { id: string };
      const ids = ((rows as Row[] | null) ?? []).map((r) => r.id);
      if (ids.length === 0) {
        console.warn('No failed rows in staging — skipping live test');
        return;
      }

      let verified = 0;
      for (const id of ids) {
        try {
          await runFixFailedQuestions({ question_id: id });
        } catch (err) {
          console.warn(`agent threw on ${id}:`, err);
        }
        const { data: after } = await supabaseAdmin
          .from('question_bank')
          .select('verification_state')
          .eq('id', id)
          .single();
        const state = (after as { verification_state: string } | null)?.verification_state;
        if (state === 'verified') verified += 1;
      }

      expect(verified / ids.length).toBeGreaterThanOrEqual(0.6);
    },
    180_000,
  );
});
