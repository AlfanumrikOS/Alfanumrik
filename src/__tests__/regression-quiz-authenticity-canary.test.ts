/**
 * Quiz authenticity canary — REG-52.
 *
 * Phase B locks the contract Phase A (PR #447) established. The
 * `grounding.scoring` ops_events canary, installed by migration
 * 20260418110000, fires every time the database observes a server-side
 * scoring disagreement (e.g. submit_quiz_results re-derived `is_correct`
 * differently from the client-rendered green check). After Phase A,
 * THERE SHOULD BE ZERO of these in any 24h window — the server is now
 * the only authority that compares `selected_original_index` to
 * `correct_answer_index_snapshot`, and the client never sees the index.
 *
 * This test is the CI-side enforcement of that contract:
 *
 *   - In production CI on PR branches without a real Supabase URL
 *     (NEXT_PUBLIC_SUPABASE_URL is unset OR contains "placeholder"),
 *     the test SKIPS — gracefully and deterministically. Same pattern
 *     as `src/__tests__/helpers/integration.ts` (REG-49 / REG-50 docs
 *     reference this skip-on-placeholder convention).
 *
 *   - In the integration-tests CI job that wires staging Supabase
 *     credentials, the test runs FOR REAL: it queries
 *     `ops_events WHERE category='grounding.scoring' AND
 *     severity='warning' AND occurred_at > now() - 24h`, and FAILS
 *     with a list of affected sessions if any rows exist.
 *
 *   - Locally, `npm test` invocations without integration env will
 *     skip cleanly. To run against staging locally:
 *       NEXT_PUBLIC_SUPABASE_URL=... \
 *       NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *       SUPABASE_SERVICE_ROLE_KEY=... \
 *       npx vitest run src/__tests__/regression-quiz-authenticity-canary.test.ts
 *
 * Why this design (vs. a pure static-source canary like REG-50):
 *   The drift bug Phase A closed was a RUNTIME phenomenon — a stable
 *   client-side seed colliding with a mid-session question_bank edit.
 *   No amount of static source inspection can prove the bug is gone in
 *   production. The ops_events canary already runs in production and
 *   records every disagreement; this test promotes "production canary
 *   has zero entries" into a CI hard gate.
 *
 * REG-52 scope:
 *   - P1 (score accuracy)  — server-derived is_correct must agree with
 *                            the snapshot. ops_events.grounding.scoring
 *                            warnings are direct evidence of P1 violation.
 *   - P6 (question quality) — the snapshot isolates scoring from
 *                            mid-session content edits. A grounding.scoring
 *                            warning means the snapshot was bypassed.
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from './helpers/integration';

// 24-hour lookback window for the canary. Matches the production alerting
// SLO: zero scoring disagreements per rolling day.
const LOOKBACK_HOURS = 24;

// Threshold: zero. Phase A guarantees that the server is the only
// authority — any non-zero count is a regression.
const ALLOWED_DISAGREEMENTS = 0;

describe('REG-52: quiz-authenticity ops_events canary (Phase B)', () => {
  it('reports zero grounding.scoring warnings in the last 24h (skipped without integration env)', async () => {
    if (!hasSupabaseIntegrationEnv()) {
      // Env-gated skip: same pattern used across the regression suite for
      // tests that depend on a real Supabase connection. CI runs this test
      // in the integration-tests job (which sets staging creds) and skips
      // it everywhere else.
      // eslint-disable-next-line no-console
      console.warn(
        '[REG-52] Skipping: integration env not present (staging Supabase ' +
          'credentials missing or placeholder). This is expected on PR branches.',
      );
      return;
    }

    // Lazy import the admin client so module load doesn't blow up on
    // branches without env vars. supabase-admin.ts validates env at import
    // time; gating by hasSupabaseIntegrationEnv() above guarantees we only
    // import when the env is real.
    const { supabaseAdmin } = await import('@/lib/supabase-admin');

    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('ops_events')
      .select('id, occurred_at, subject_id, message, context')
      .eq('category', 'grounding.scoring')
      .eq('severity', 'warning')
      .gte('occurred_at', cutoff)
      .order('occurred_at', { ascending: false })
      .limit(50); // cap for assertion-message readability

    if (error) {
      throw new Error(
        `[REG-52] Failed to query ops_events: ${error.message}. ` +
          'This is a CI infrastructure failure, not a contract violation. ' +
          'Check staging Supabase reachability + service-role key validity.',
      );
    }

    const rows = data ?? [];

    if (rows.length > ALLOWED_DISAGREEMENTS) {
      const affected = rows
        .map(
          (r: { id: string; occurred_at: string; subject_id: string | null; message: string }) =>
            `  - id=${r.id} session=${r.subject_id ?? '<unknown>'} at=${r.occurred_at}: ${r.message}`,
        )
        .join('\n');
      throw new Error(
        `[REG-52] Phase A regression detected: ${rows.length} grounding.scoring ` +
          `warnings recorded in the last ${LOOKBACK_HOURS}h.\n` +
          'Phase A (PR #447) made the server the only authority for scoring; ' +
          'any non-zero count means the server-side re-derivation in ' +
          'submit_quiz_results_v2 disagreed with the client-displayed result.\n' +
          'Affected sessions (first 50):\n' +
          affected,
      );
    }

    expect(rows.length).toBe(ALLOWED_DISAGREEMENTS);
  });
});
