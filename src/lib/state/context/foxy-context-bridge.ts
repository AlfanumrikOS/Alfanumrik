/**
 * src/lib/state/context/foxy-context-bridge.ts — additive splicing of the
 * unified-state AI context block into Foxy's system prompt.
 *
 * Phase 3 of the unified state architecture. Foxy keeps every existing
 * scaffold — safety rails, tenant personality overrides, RAG grounding,
 * lab context, mastery-intent injection. This bridge appends ONE more
 * section to the system prompt: a ~1500-token markdown block describing
 * the learner's identity, mastery, engagement, recent journey, and
 * suggested teaching opportunity, built from StudentState + journey
 * projection.
 *
 * Three properties this bridge guarantees:
 *
 *   1. **Flag-gated.** While `ff_foxy_context_rich_v1` is OFF (the
 *      default), this is a no-op — Foxy gets the exact byte-identical
 *      prompt it has today. The flag flips per-tenant for canary.
 *
 *   2. **Never throws.** Every fetch is wrapped. A failed StudentState
 *      build, a missing domain_events row, an unparseable event — all
 *      become a logger.warn and the function returns `{ block: '',
 *      reason: '...' }`. Foxy's grounded-answer service runs unaffected.
 *
 *   3. **Token-bounded.** The underlying buildAiContext() caps its output
 *      around 1500 tokens by selecting weakest chapters, top subjects,
 *      and the most recent 12 journey entries. We add roughly that cost
 *      to every Foxy call when the flag is on. Worth it for personalised
 *      tutoring; not optional once enabled.
 *
 * The bridge composes a JourneyEvent[] from `domain_events` rows. The
 * existing projector in journey.ts does the kind-by-kind shaping; this
 * file just owns the I/O.
 */

import { logger } from '@/lib/logger';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainEventSchema, type DomainEvent } from '../events/registry';
import { projectJourney } from '../journey/journey';
import { buildAiContext, type AiContextBlock } from './builder';
import { createStudentStateBuilder } from '../student-state-builder';

export const FOXY_CONTEXT_FLAG = 'ff_foxy_context_rich_v1';

/** Default window of recent learner events to consider for the journey. */
const DEFAULT_LOOKBACK_DAYS = 14;
/** Max events fetched from domain_events (the projector dedupes/drops further). */
const DEFAULT_FETCH_LIMIT = 80;

export interface FoxyContextArgs {
  authUserId: string;
  /** Subject code from the route (e.g. 'mathematics'). Lower-cased here. */
  subjectCode: string;
  /** Chapter number if known. */
  chapterNumber?: number | null;
  /** Foxy mode → buildAiContext.mode mapping. */
  mode?: 'tutor' | 'doubt_solve' | 'revision';
}

export interface FoxyContextResult {
  /** The text to append to the system prompt. Empty when disabled / errored. */
  block: string;
  /** Approx tokens added to the prompt (0 when block is empty). */
  approxTokens: number;
  /** 'flag_off' | 'no_state' | 'no_events' | 'error' | 'ok'. */
  reason: 'flag_off' | 'no_state' | 'error' | 'ok';
  /** When reason='error', the message — for logs only. */
  errorMessage?: string;
}

/**
 * Best-effort build of the Foxy context block. The caller appends
 * `result.block` to the system prompt verbatim when non-empty.
 *
 * Test injection: pass an `sb` to bypass the admin client (used in unit
 * tests with the FakeSupabase helper).
 */
export async function maybeBuildFoxyContextBlock(
  args: FoxyContextArgs,
  opts?: {
    sb?: SupabaseClient;
    lookbackDays?: number;
    fetchLimit?: number;
    /** Override flag-check for tests. */
    isEnabled?: () => Promise<boolean>;
  },
): Promise<FoxyContextResult> {
  const enabled = opts?.isEnabled
    ? await safeAsync(opts.isEnabled, false)
    : await safeIsFeatureEnabled(FOXY_CONTEXT_FLAG, args.authUserId);

  if (!enabled) {
    return { block: '', approxTokens: 0, reason: 'flag_off' };
  }

  try {
    const sb = opts?.sb ?? getSupabaseAdmin();
    const builder = createStudentStateBuilder({ sb });
    const state = await builder(args.authUserId);

    const events = await fetchRecentEvents(
      sb,
      args.authUserId,
      opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
      opts?.fetchLimit ?? DEFAULT_FETCH_LIMIT,
    );
    const recentJourney = projectJourney(events);

    const ctx: AiContextBlock = buildAiContext({
      state,
      recentJourney,
      currentFocus: {
        subjectCode: args.subjectCode.toLowerCase(),
        chapterNumber: args.chapterNumber ?? undefined,
        mode: args.mode,
      },
    });
    return {
      block: ctx.markdown,
      approxTokens: ctx.approxTokens,
      reason: 'ok',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('foxy-context-bridge: build failed (Foxy continues unaffected)', {
      error: new Error(message),
      authUserId: args.authUserId,
    });
    return {
      block: '',
      approxTokens: 0,
      reason: 'error',
      errorMessage: message,
    };
  }
}

/**
 * Fetch the learner's recent domain_events. Returns Zod-validated
 * `DomainEvent`s; rows that fail parse are dropped and counted in a
 * single log line. Lookback uses occurred_at, not created_at, so a
 * back-dated event still rolls into the journey if applicable.
 */
async function fetchRecentEvents(
  sb: SupabaseClient,
  authUserId: string,
  lookbackDays: number,
  limit: number,
): Promise<DomainEvent[]> {
  const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const since = new Date(sinceMs).toISOString();

  const { data, error } = await sb
    .from('domain_events')
    .select('*')
    .eq('actor_auth_user_id', authUserId)
    .gt('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`fetchRecentEvents: ${error.message}`);
  }

  const rows = data ?? [];
  const parsed: DomainEvent[] = [];
  let dropped = 0;
  for (const row of rows) {
    const candidate = rowToCandidate(row);
    const r = DomainEventSchema.safeParse(candidate);
    if (r.success) parsed.push(r.data);
    else dropped++;
  }
  if (dropped > 0) {
    logger.warn('foxy-context-bridge: dropped unparseable event rows', {
      dropped,
      total: rows.length,
      authUserId,
    });
  }
  return parsed;
}

function rowToCandidate(row: unknown): unknown {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  return {
    eventId: r.event_id,
    occurredAt: r.occurred_at,
    actorAuthUserId: r.actor_auth_user_id,
    tenantId: r.tenant_id ?? null,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    payload: r.payload,
  };
}

async function safeIsFeatureEnabled(
  flag: string,
  userId: string,
): Promise<boolean> {
  try {
    return await isFeatureEnabled(flag, { userId });
  } catch {
    return false;
  }
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
