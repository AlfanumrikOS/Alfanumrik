/**
 * src/lib/state/services/service.ts — the Service<I, O> contract.
 *
 * Step 3 of the unified state architecture. Every feature (quiz engine,
 * Foxy tutor, parent notifier, teacher dashboard, billing reconciler,
 * NCERT solver, …) becomes a Service<Input, Output>:
 *
 *   - Takes a typed Input
 *   - Reads from StudentState (or other projections) — never mutates
 *   - Returns a typed Output AND a list of DomainEvents to publish
 *
 * Mutations don't happen inside services. Services are PURE-ish read +
 * decision functions. The Orchestrator is the only thing that writes:
 * it calls services, takes their events, publishes them through the
 * bus, and lets subscribers project new state.
 *
 * Why this discipline pays off:
 *
 *   1. **Testable in isolation.** A service with no DB-mutate side
 *      effects is unit-testable with a StudentState fixture and an
 *      Input. No mocks of Supabase, no race conditions.
 *
 *   2. **Composable.** The Orchestrator can run service A's output
 *      through service B (e.g. quiz-completion → mastery-recompute →
 *      next-quiz-pick → parent-notification) without each feature
 *      needing to know about the others.
 *
 *   3. **Replayable.** Given a stored event log, any service's
 *      decisions can be re-executed for audit or counterfactual analysis
 *      ("what would Foxy have said if X had been mastery 0.6?").
 *
 *   4. **Mesh-friendly.** The agent mesh's L4 worker can replace a
 *      service file without touching the orchestrator or any other
 *      service. Service signatures are the contract.
 *
 * What this is NOT:
 *
 *   - It is not a queue. Services run synchronously when called by the
 *     Orchestrator. Asynchrony (parent notifications, mesh outcome
 *     attribution) happens AFTER the Orchestrator publishes events,
 *     via subscribers — not inside services.
 *
 *   - It is not an RPC layer. Services are local TypeScript functions.
 *     If a feature needs to call out (Razorpay, Sentry, Anthropic), it
 *     does so inside its service implementation; the service's PURITY
 *     guarantee is about not writing to OUR domain state, not about
 *     network-purity.
 */

import type { DomainEvent } from '../events/registry';
import type { StudentState } from '../student-state';

/**
 * The contract every service implements. Two generic parameters:
 *   - Input: the typed thing the service is invoked with
 *   - Output: the typed thing the service returns
 */
export interface Service<Input, Output> {
  /** Human-readable name. Used in logs, metrics, and the mesh's L2 prompts. */
  readonly name: string;

  /**
   * The event kinds this service is interested in. The Orchestrator
   * uses this to decide which services to invoke when an event arrives.
   * A service can also be invoked directly (without an event) by other
   * services or by the API layer.
   *
   * Empty array means "this service only runs on explicit call, not on
   * any bus event". Good for command-shaped services (createAssignment,
   * setAiPersonality).
   */
  readonly subscribesTo: ReadonlyArray<DomainEvent['kind']>;

  /**
   * Run the service. PURE-ISH:
   *   - Reads from `state` (and may pass `state` to other services)
   *   - May call external APIs (Anthropic, Razorpay, NCERT data)
   *   - Returns Output + events to publish
   *   - Does NOT write to domain_events, students, mastery_state, etc.
   *
   * The Orchestrator is the only thing that writes domain state.
   */
  run(args: ServiceArgs<Input>): Promise<ServiceResult<Output>>;
}

export interface ServiceArgs<Input> {
  /** The current student state at the time the orchestrator dispatched. */
  state: StudentState;
  /** The typed input for this service. */
  input: Input;
  /**
   * Optional triggering event. Present when the orchestrator dispatched
   * the service from the bus; null when it's a direct call.
   */
  triggeringEvent: DomainEvent | null;
  /**
   * Idempotency key the service can use for its own external calls
   * (e.g. Razorpay payment refs, Anthropic request_id correlation).
   * Derived from the triggering event when present.
   */
  idempotencyKey: string;
}

export interface ServiceResult<Output> {
  /** Whatever the service was asked to compute / decide. */
  output: Output;
  /**
   * Domain events the service wants published. The orchestrator
   * publishes them — the service does NOT call publishEvent directly.
   * This is the discipline boundary; do not break it.
   */
  events: DomainEvent[];
  /**
   * Optional human-readable notes for telemetry / debugging /
   * mesh-critic context. Surfaced in logs, never user-facing.
   */
  notes?: string;
}

/**
 * Marker for services that take no input (event-only). Slightly nicer
 * than `Service<void, …>` at call sites.
 */
export type EventOnlyService<Output> = Service<null, Output>;
