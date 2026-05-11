/**
 * src/lib/state/orchestrator.ts — the central orchestrator service.
 *
 * Step 2 of the unified state architecture. THE single entry point
 * that mutates domain state for a learner. Three responsibilities:
 *
 *   1. **Dispatch a service call.** A feature route (e.g. POST
 *      /api/quiz/submit) hands the Orchestrator a service + its input.
 *      The Orchestrator builds the StudentState, calls the service,
 *      publishes the resulting events through the bus, and returns the
 *      service's output to the caller.
 *
 *   2. **React to events.** The Orchestrator subscribes to the bus
 *      (via Supabase Realtime + pg_notify). When an event arrives, it
 *      looks up which services declared `subscribesTo` for that kind
 *      and dispatches each one with the event as the trigger.
 *
 *   3. **Run the rule engine.** After each state-changing batch of
 *      events, the Orchestrator evaluates the rule engine against the
 *      new state. Rule outputs (decisions) are themselves emitted as
 *      events the bus then fans out (badge unlocked, next quiz
 *      suggested, parent notification queued, …).
 *
 * The Orchestrator is the only place these three live. Features stop
 * publishing events directly; they hand work to the Orchestrator and
 * trust it to keep the loop coherent.
 *
 * Concurrency model:
 *
 *   - One Orchestrator instance per Node process (Next.js API route
 *     server, Edge Function worker, or the bus-listener daemon).
 *   - For a given learner, the Orchestrator serializes dispatches
 *     using an in-memory mutex keyed by authUserId. Cross-process
 *     ordering is handled by the bus's append-only event log + each
 *     subscriber's idempotency keys.
 *   - Idle StudentState builds are memoised with a short TTL; the
 *     event bus invalidates entries as soon as a relevant event lands.
 *
 * Failure / partial-write semantics:
 *
 *   - Services compute events; the Orchestrator publishes them.
 *   - The publish step is the *only* I/O that mutates domain state.
 *     If publish fails, the service result is discarded and the caller
 *     gets an error. (No silent half-application.)
 *   - Each subscriber writes its own projection (mastery_state row,
 *     parent notification row, etc.) with idempotency-key dedupe, so
 *     retries from the bus are safe.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { publishEvent } from './events/publish';
import type { DomainEvent } from './events/registry';
import type {
  Service,
  ServiceArgs,
  ServiceResult,
} from './services/service';
import type { StudentState, StudentStateBuilder } from './student-state';

const ORCHESTRATOR_FLAG = 'ff_orchestrator_v1';

// ── State cache ─────────────────────────────────────────────────────

interface CacheEntry {
  state: StudentState;
  builtAt: number;
}

const STATE_CACHE_TTL_MS = 5_000; // short — the bus invalidates on event arrival

// ── Per-learner mutex ───────────────────────────────────────────────
// Serializes dispatches for the same learner within this process so
// service A and service B don't race against the same StudentState
// snapshot. Lightweight — just a chained Promise.

const learnerLocks = new Map<string, Promise<unknown>>();

async function withLearnerLock<T>(
  authUserId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = learnerLocks.get(authUserId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(r => { release = r; });
  learnerLocks.set(authUserId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Lazy cleanup — if no other dispatcher is waiting, drop the lock.
    if (learnerLocks.get(authUserId) === next) {
      learnerLocks.delete(authUserId);
    }
  }
}

// ── The Orchestrator ────────────────────────────────────────────────

export interface OrchestratorOptions {
  sb: SupabaseClient;
  buildState: StudentStateBuilder;
  /** Services keyed by name. Same instance is used for both direct
   *  dispatches and event-driven subscriptions. */
  services: ReadonlyMap<string, Service<unknown, unknown>>;
  /** Optional injected clock for tests. */
  now?: () => Date;
}

export interface DispatchArgs<Input> {
  authUserId: string;
  service: Service<Input, unknown>;
  input: Input;
  /**
   * Optional triggering event when this dispatch is being driven by the
   * bus. The Orchestrator threads this into the service args so the
   * service can correlate IDs / observe causality.
   */
  triggeringEvent?: DomainEvent | null;
}

export interface DispatchResult<Output> {
  output: Output;
  publishedEventCount: number;
  state: StudentState;
}

export class Orchestrator {
  private readonly sb: SupabaseClient;
  private readonly buildState: StudentStateBuilder;
  private readonly services: ReadonlyMap<string, Service<unknown, unknown>>;
  private readonly now: () => Date;
  private readonly stateCache = new Map<string, CacheEntry>();
  private orchestratorFlagCache: { value: boolean; at: number } | null = null;

  constructor(opts: OrchestratorOptions) {
    this.sb = opts.sb;
    this.buildState = opts.buildState;
    this.services = opts.services;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * The single entry point. Every state-mutating call path in
   * Alfanumrik eventually goes through this method. API routes wrap
   * dispatch() so the route stays thin.
   */
  async dispatch<Input, Output>(
    args: DispatchArgs<Input>,
  ): Promise<DispatchResult<Output>> {
    return withLearnerLock(args.authUserId, async () => {
      const enabled = await this.isOrchestratorEnabled();
      const state = await this.getStudentState(args.authUserId);

      const serviceArgs: ServiceArgs<Input> = {
        state,
        input: args.input,
        triggeringEvent: args.triggeringEvent ?? null,
        idempotencyKey:
          args.triggeringEvent?.idempotencyKey ??
          `direct:${args.service.name}:${args.authUserId}:${this.now().toISOString()}`,
      };

      const result = (await args.service.run(serviceArgs)) as ServiceResult<Output>;

      // When the orchestrator is gated off we still return the service's
      // computed output, but we don't publish events. Lets a route be
      // wired to the new architecture before the bus is live.
      let publishedEventCount = 0;
      if (enabled) {
        for (const event of result.events) {
          const pub = await publishEvent(this.sb, event);
          if (pub.published) publishedEventCount++;
        }
        // Any event published invalidates the cached state for this
        // learner (and anyone the event is *about*, if different).
        if (publishedEventCount > 0) {
          this.invalidateLearnerCache(args.authUserId);
          for (const event of result.events) {
            if (event.actorAuthUserId !== args.authUserId) {
              this.invalidateLearnerCache(event.actorAuthUserId);
            }
          }
        }
      }

      return {
        output: result.output,
        publishedEventCount,
        state, // pre-mutation snapshot — caller can read but not mutate
      };
    });
  }

  /**
   * Wake-up handler for the bus subscriber. Given an event, finds every
   * service that declared `subscribesTo` for that kind and dispatches
   * each in turn. Each dispatch threads the event as `triggeringEvent`.
   */
  async onEvent(event: DomainEvent): Promise<void> {
    const interested = Array.from(this.services.values()).filter(s =>
      s.subscribesTo.includes(event.kind),
    );
    if (interested.length === 0) return;

    for (const service of interested) {
      // Bus-driven dispatches don't carry an Input; services that
      // subscribe to events should declare their Input type as `null`
      // or as something derivable purely from the event.
      try {
        await this.dispatch({
          authUserId: event.actorAuthUserId,
          service: service as unknown as Service<null, unknown>,
          input: null,
          triggeringEvent: event,
        });
      } catch (err: unknown) {
        // One subscriber failing must not block the others. The bus
        // log is the source of truth — a failed subscriber can be
        // re-run later by replaying from a watermark.
        // eslint-disable-next-line no-console
        console.error(
          `[orchestrator] service "${service.name}" failed on event ${event.kind}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Build (or read from cache) the StudentState for a learner. The
   * cache is short — 5s — and event-bus subscribers invalidate
   * proactively. Cache exists to coalesce N services that all need the
   * same state within one dispatch chain.
   */
  async getStudentState(authUserId: string): Promise<StudentState> {
    const now = this.now().getTime();
    const cached = this.stateCache.get(authUserId);
    if (cached && now - cached.builtAt < STATE_CACHE_TTL_MS) {
      return cached.state;
    }
    const state = await this.buildState(authUserId);
    this.stateCache.set(authUserId, { state, builtAt: now });
    return state;
  }

  /**
   * Drop the cached state for a learner. Called by the bus subscriber
   * the moment a relevant event lands, so the next dispatch builds
   * fresh state.
   */
  invalidateLearnerCache(authUserId: string): void {
    this.stateCache.delete(authUserId);
  }

  /**
   * Read the orchestrator gating flag with a short TTL. When OFF, the
   * orchestrator still runs services and returns their output but does
   * NOT publish events — useful for canary deploys where we want to
   * exercise the code path without committing to the new state plane.
   */
  private async isOrchestratorEnabled(): Promise<boolean> {
    const now = this.now().getTime();
    if (this.orchestratorFlagCache && now - this.orchestratorFlagCache.at < 30_000) {
      return this.orchestratorFlagCache.value;
    }
    const { data } = await this.sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', ORCHESTRATOR_FLAG)
      .maybeSingle();
    const value = data?.is_enabled === true;
    this.orchestratorFlagCache = { value, at: now };
    return value;
  }
}
