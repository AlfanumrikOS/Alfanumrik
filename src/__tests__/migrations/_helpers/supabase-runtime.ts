import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for state-runtime integration tests. Reads
 * env vars set by the `RUN_INTEGRATION_TESTS=1` runner. Throws if vars are
 * missing — tests importing this helper are expected to run only under the
 * integration suite (see vitest.config.ts include/exclude split).
 *
 * Distinct from the existing `src/__tests__/helpers/integration.ts` skip-guard:
 * that helper lets a describe block decide whether to evaluate to
 * `describe.skip` based on placeholder-env detection. This helper is for the
 * actual client construction once a test has decided to run.
 */
export function makeServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Integration test attempted to construct a Supabase client without ' +
        'NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set. ' +
        'Run with RUN_INTEGRATION_TESTS=1 against a live database.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Per-kind default payloads that satisfy the Zod schemas in
 * `src/lib/state/events/registry.ts`. `insertEvent` falls back to these when
 * the caller doesn't supply a payload, so the inserted row's payload column
 * parses cleanly through the projector/handler `safeParse` step instead of
 * silently slipping into the parse-fail branch and skewing test outcomes.
 *
 * Add a new entry whenever a test starts inserting a new kind. Unknown kinds
 * fall through to `{}` (which still parse-fails — but at least the failure
 * mode is explicit and the test author is forced to register a default).
 */
const DEFAULT_PAYLOADS: Record<string, unknown> = {
  'learner.mastery_changed': {
    subjectCode: 'math',
    chapterNumber: 1,
    fromMastery: null,
    toMastery: 0.5,
    trigger: 'quiz',
  },
  'learner.quiz_completed': {
    quizSessionId: '00000000-0000-0000-0000-000000000001',
    subjectCode: 'math',
    chapterNumber: 1,
    questionCount: 10,
    correctCount: 7,
    durationSec: 300,
    xpEarned: 50,
  },
  'learner.concept_check_answered': {
    studentId: '00000000-0000-0000-0000-000000000010',
    conceptId: '00000000-0000-0000-0000-000000000020',
    attemptId: '00000000-0000-0000-0000-000000000030',
    questionId: '00000000-0000-0000-0000-000000000020:practice:v1',
    correct: true,
    chosenIndex: 0,
    responseTimeMs: 1200,
    occurredAt: '2026-05-12T10:00:00.000Z',
    attemptSequence: 1,
    priorMasteryMean: 0.30,
    eventVersion: 1,
    subjectCode: 'math',
    chapterNumber: 1,
  },
};

/**
 * Map of state-runtime tables to a "delete everything" predicate. Postgres
 * requires a WHERE clause for DELETE via PostgREST, so each predicate picks
 * a column guaranteed to be non-null on every row in that table.
 */
const TABLE_RESET_PREDICATES: Record<string, (q: ReturnType<SupabaseClient['from']>) => unknown> = {
  subscriber_offsets: (q) => q.delete().not('subscriber_name', 'is', null),
  subscriber_retry_state: (q) => q.delete().not('event_id', 'is', null),
  subscriber_dead_letters: (q) => q.delete().not('event_id', 'is', null),
  state_events: (q) => q.delete().not('event_id', 'is', null),
};

/**
 * Truncate the named state-runtime tables. Use in `beforeEach` for hermetic
 * test isolation across the projector substrate suite.
 *
 * Tables not in `TABLE_RESET_PREDICATES` fall through to a permissive
 * `updated_at >= EPOCH` clause; callers that hit this path should add an
 * explicit predicate to the map above rather than rely on the fallback.
 */
export async function resetDb(tables: string[]): Promise<void> {
  const sb = makeServiceSupabase();
  for (const t of tables) {
    const predicate = TABLE_RESET_PREDICATES[t];
    if (predicate) {
      const result = (await predicate(sb.from(t))) as { error: { message: string } | null };
      if (result.error) {
        throw new Error(`resetDb failed for table ${t}: ${result.error.message}`);
      }
    } else {
      const { error } = await sb.from(t).delete().gte('updated_at', '1970-01-01');
      if (error) {
        throw new Error(`resetDb fallback failed for table ${t}: ${error.message}`);
      }
    }
  }
}

/**
 * Insert a `state_events` row with sensible defaults. Returns the inserted
 * row's identity for use in later assertions / cursor comparisons.
 */
export async function insertEvent(
  sb: SupabaseClient,
  partial: {
    kind: string;
    occurredAt?: string;
    actorAuthUserId?: string;
    tenantId?: string | null;
    idempotencyKey?: string;
    payload?: unknown;
  },
): Promise<{ eventId: string; occurredAt: string }> {
  const eventId = crypto.randomUUID();
  const occurredAt = partial.occurredAt ?? new Date().toISOString();
  const { error } = await sb.from('state_events').insert({
    event_id: eventId,
    kind: partial.kind,
    actor_auth_user_id: partial.actorAuthUserId ?? '00000000-0000-0000-0000-000000000000',
    tenant_id: partial.tenantId ?? null,
    idempotency_key: partial.idempotencyKey ?? `test-${eventId}`,
    occurred_at: occurredAt,
    payload: partial.payload ?? DEFAULT_PAYLOADS[partial.kind] ?? {},
  });
  if (error) throw new Error(`insertEvent failed: ${error.message}`);
  return { eventId, occurredAt };
}
