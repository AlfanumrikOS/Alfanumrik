/**
 * ALFANUMRIK — In-Process Event Bus (Phase F of white-label foundation)
 *
 * A typed, synchronous, in-process pub/sub. Lets feature code emit declarative
 * events ("student.created", "assessment.completed", "payment.received") and
 * lets cross-cutting concerns (PostHog capture, audit log row, email/WhatsApp
 * triggers) attach as subscribers without the publisher knowing they exist.
 *
 * Scope and limits — read this before using:
 *
 *   - **In-process only.** Vercel serverless runs each request on a possibly-
 *     different node instance. emit() reaches subscribers registered in the
 *     SAME request that's calling emit(). It does NOT reach a worker on
 *     another instance. That's fine for "fire side-effects synchronously
 *     during the request"; it's the wrong tool for cross-process workflow.
 *     For cross-process, use a queue (out of scope for this phase).
 *
 *   - **Subscribers fire synchronously.** emit() returns once every
 *     subscriber's handler has been invoked. Async handlers are fire-and-
 *     forget by default (we don't await them) — pass `{ awaitAsync: true }`
 *     to wait. The bus catches subscriber errors so one broken handler can't
 *     break the others or the publisher.
 *
 *   - **Feature flag `ff_event_bus_v1` gates broadcast.** When OFF, emit() is
 *     a no-op. Lets us deploy publisher call sites ahead of subscriber
 *     readiness. The cached `isFeatureEnabled` keeps overhead low.
 *
 *   - **Idempotency.** The bus does not deduplicate. Subscribers that need
 *     idempotency (e.g. "welcome email must send exactly once") must read
 *     `event.idempotencyKey` and de-dupe themselves. Razorpay webhooks, for
 *     example, already do this.
 *
 * Adding a new event:
 *   1. Add a discriminator to `AlfanumrikEvent` below with its payload shape.
 *   2. emit it from the place the state change happens.
 *   3. Subscribe in `events/subscribers/<name>.ts` (one file per concern).
 *
 * The bus is intentionally minimal. It's the seam for future Kafka/RabbitMQ
 * migration: publishers don't change; only the implementation of emit() and
 * subscribe() does.
 */

import { EventEmitter } from 'node:events';
import { isFeatureEnabled } from '@/lib/feature-flags';

// ─── Event taxonomy ────────────────────────────────────────────────────
//
// Discriminated union keyed by `type`. Each branch carries:
//   - `tenantId` (school_id, optional for B2C)
//   - `idempotencyKey` (subscriber-side dedupe seed)
//   - the event-specific `payload`
//
// Adding new events here is the right place to centralize "what state
// changes does the platform announce." Keep payloads minimal — subscribers
// re-fetch any heavy data they need.

export interface BaseEvent {
  /** Tenant scope. null for B2C / system events. */
  tenantId: string | null;
  /** Stable key for subscriber-side dedupe. SHOULD be deterministic per
   *  state change (e.g. "razorpay_event:<id>" or "session:<sessionId>"). */
  idempotencyKey: string;
  /** Wall-clock timestamp the event was minted. */
  occurredAt: string;
}

export interface StudentCreatedEvent extends BaseEvent {
  type: 'student.created';
  payload: {
    studentId: string;
    /** 'self_signup' | 'invite_code' | 'bulk_upload' | 'super_admin' */
    source: string;
    grade: string;
  };
}

export interface AssessmentCompletedEvent extends BaseEvent {
  type: 'assessment.completed';
  payload: {
    studentId: string;
    /** 'quiz' | 'mock_exam' | 'diagnostic' | 'pyq' */
    surface: string;
    sessionId: string;
    scorePercent: number;
    questionCount: number;
  };
}

export interface AiLessonGeneratedEvent extends BaseEvent {
  type: 'ai.lesson.generated';
  payload: {
    studentId: string;
    lessonId: string;
    subject: string;
    chapterId: string | null;
    tokensIn: number;
    tokensOut: number;
  };
}

export interface PaymentReceivedEvent extends BaseEvent {
  type: 'payment.received';
  payload: {
    /** 'student_subscription' | 'school_subscription' */
    subjectKind: string;
    subjectId: string;
    razorpayPaymentId: string;
    amountPaise: number;
    currency: string;
  };
}

export interface SubscriptionLifecycleEvent extends BaseEvent {
  type: 'subscription.lifecycle';
  payload: {
    /** 'student_subscription' | 'school_subscription' */
    subjectKind: string;
    subjectId: string;
    /** 'activated' | 'cancelled' | 'expired' | 'plan_changed' | 'seat_changed' */
    transition: string;
  };
}

/** Discriminated union of every event the platform emits. Add new variants
 *  here; the dispatch() type guard then enforces typed handlers. */
export type AlfanumrikEvent =
  | StudentCreatedEvent
  | AssessmentCompletedEvent
  | AiLessonGeneratedEvent
  | PaymentReceivedEvent
  | SubscriptionLifecycleEvent;

export type EventType = AlfanumrikEvent['type'];

/** Helper: pick the event variant by its discriminator. */
export type EventOfType<T extends EventType> = Extract<AlfanumrikEvent, { type: T }>;

export type EventHandler<T extends EventType> = (
  event: EventOfType<T>,
) => void | Promise<void>;

// ─── The bus ───────────────────────────────────────────────────────────
//
// Single module-scoped EventEmitter. Long-lived in serverless: warm
// invocations on the same instance reuse it. Cold starts get a fresh one,
// which is fine since subscribers are registered at module-load time (e.g.
// `events/subscribers/posthog.ts` registers on import).

const _bus = new EventEmitter();

// Don't warn about >10 listeners — analytics + audit + email + … will all
// subscribe to common events.
_bus.setMaxListeners(50);

export interface EmitOptions {
  /** If true, emit() awaits every async subscriber. Default false (fire and
   *  forget — keeps the request hot path fast). */
  awaitAsync?: boolean;
}

/**
 * Emit an event. Returns a promise that resolves once all sync handlers have
 * run; with `awaitAsync: true`, also awaits any returned promises.
 *
 * No-op when `ff_event_bus_v1` is OFF — publishers stay deployed but no
 * subscribers fire. Useful for shipping events ahead of subscribers.
 */
export async function emit<T extends EventType>(
  event: EventOfType<T>,
  options: EmitOptions = {},
): Promise<void> {
  const flagOn = await isFeatureEnabled('ff_event_bus_v1', {
    institutionId: event.tenantId ?? undefined,
  });
  if (!flagOn) return;

  const listeners = _bus.listeners(event.type) as Array<EventHandler<T>>;
  const pending: Array<Promise<unknown>> = [];

  for (const handler of listeners) {
    try {
      const result = handler(event);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        // Catch rejections from each subscriber individually; one bad
        // handler must not crash the publisher or the other handlers.
        const safe = (result as Promise<unknown>).catch(err => {
          // Log via console (matches the pattern in proxy.ts where the
          // structured logger is too heavy for the hot path). Runtime can
          // attach a Sentry breadcrumb subscriber if desired.
          // eslint-disable-next-line no-console
          console.warn(JSON.stringify({
            level: 'warn',
            message: 'event_subscriber_threw',
            event: event.type,
            tenantId: event.tenantId,
            error: err instanceof Error ? err.message : String(err),
          }));
        });
        pending.push(safe);
      }
    } catch (err) {
      // Synchronous throw from a subscriber.
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'event_subscriber_threw_sync',
        event: event.type,
        tenantId: event.tenantId,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  if (options.awaitAsync && pending.length > 0) {
    await Promise.allSettled(pending);
  }
}

/**
 * Register a typed subscriber. Returns an unsubscribe function — call it to
 * remove the listener (rare; subscribers are usually module-static).
 *
 * Subscribers SHOULD be idempotent. The bus does not de-dupe; use
 * `event.idempotencyKey` to skip already-handled work.
 */
export function subscribe<T extends EventType>(
  type: T,
  handler: EventHandler<T>,
): () => void {
  _bus.on(type, handler as (...args: unknown[]) => void);
  return () => {
    _bus.off(type, handler as (...args: unknown[]) => void);
  };
}

/**
 * Number of subscribers for a given event. Test-only helper. Production
 * code shouldn't depend on this.
 */
export function listenerCount(type: EventType): number {
  return _bus.listenerCount(type);
}

/**
 * Clear all subscribers. Test-only — calling this in production would
 * break every cross-cutting concern that registered at import time.
 */
export function _resetForTests(): void {
  _bus.removeAllListeners();
}

/**
 * Helper: build an event with `occurredAt` filled in. Saves callers from
 * repeating `new Date().toISOString()` everywhere.
 */
export function makeEvent<T extends EventType>(
  partial: Omit<EventOfType<T>, 'occurredAt'>,
): EventOfType<T> {
  return {
    ...partial,
    occurredAt: new Date().toISOString(),
  } as EventOfType<T>;
}
