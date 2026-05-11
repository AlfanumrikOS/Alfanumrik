/**
 * src/lib/state/events/registry.ts — the typed event registry.
 *
 * Every cross-feature signal in Alfanumrik flows through this union.
 * No feature ever invents an event name as a free-form string.
 * Subscribers exhaustively switch on `kind` (the TS compiler catches a
 * missed case as soon as a new event is added here).
 *
 * Adding a new event:
 *   1. Add a member to DomainEvent below
 *   2. The compiler will flag every subscriber that needs to handle it
 *   3. Run the test that pins the registry shape
 *
 * Naming convention: `<actor>.<verb_past_tense>`.
 *   Actors: learner, parent, teacher, school, ai, billing, mesh
 *   The compiler can't enforce this; the test in
 *   src/__tests__/state/events-registry.test.ts can.
 */

import { z } from 'zod';

// Shape-only UUID + datetime validators. See src/lib/state/student-state.ts
// for the rationale (Zod v4's strict .uuid()/.datetime() reject the fixture
// UUIDs our test code uses, and we don't need cryptographic guarantees in
// the event envelope — just shape).
const uuidLike = () => z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const isoDatetime = () => z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);

// ── Common envelope every event has ──────────────────────────────────

const EventBaseSchema = z.object({
  // ULID/UUID — stable id assigned at publish time. Used for idempotency
  // by subscribers that must not double-process (parent notifications,
  // billing webhooks, mesh outcome attribution).
  eventId: uuidLike(),
  // Wall-clock the publisher captured.
  occurredAt: isoDatetime(),
  // The auth_user_id this event is "about". For learner.* events, the
  // learner. For parent.report_viewed, the parent. For school.* events,
  // the admin who triggered it.
  actorAuthUserId: uuidLike(),
  // Tenant scope. Null for B2C / global events. Subscribers MUST honour
  // tenant boundaries — a teacher event in school A doesn't fan out to
  // school B.
  tenantId: uuidLike().nullable(),
  // Idempotency key for retries / pg_notify replay. Two events with the
  // same idempotencyKey are the same event; subscribers dedupe.
  idempotencyKey: z.string().min(1).max(128),
});

// ── Learner events ───────────────────────────────────────────────────

export const LearnerSignedUpSchema = EventBaseSchema.extend({
  kind: z.literal('learner.signed_up'),
  payload: z.object({
    grade: z.string(),
    board: z.enum(['CBSE', 'ICSE', 'STATE', 'OTHER']),
    language: z.enum(['en', 'hi']),
    invitedBy: uuidLike().nullable(),
  }),
});

export const LearnerSessionStartedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.session_started'),
  payload: z.object({
    surface: z.enum(['web', 'flutter']),
    referrer: z.string().nullable(),
  }),
});

export const LearnerQuizCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.quiz_completed'),
  payload: z.object({
    quizSessionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    questionCount: z.number().int().positive(),
    correctCount: z.number().int().nonnegative(),
    durationSec: z.number().int().nonnegative(),
    xpEarned: z.number().int().nonnegative(),
  }),
});

export const LearnerLessonCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.lesson_completed'),
  payload: z.object({
    lessonId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    durationSec: z.number().int().nonnegative(),
  }),
});

export const LearnerMasteryChangedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.mastery_changed'),
  payload: z.object({
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    fromMastery: z.number().min(0).max(1).nullable(),
    toMastery: z.number().min(0).max(1),
    trigger: z.enum(['quiz', 'lesson', 'foxy', 'manual']),
  }),
});

// ── AI / Foxy events ─────────────────────────────────────────────────

export const FoxySessionStartedSchema = EventBaseSchema.extend({
  kind: z.literal('ai.foxy_session_started'),
  payload: z.object({
    foxySessionId: uuidLike(),
    subjectCode: z.string().nullable(),
    chapterNumber: z.number().int().positive().nullable(),
    mode: z.enum(['tutor', 'doubt_solve', 'revision']),
  }),
});

export const FoxySessionCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('ai.foxy_session_completed'),
  payload: z.object({
    foxySessionId: uuidLike(),
    turnCount: z.number().int().nonnegative(),
    durationSec: z.number().int().nonnegative(),
    helpful: z.boolean().nullable(), // student feedback if given
  }),
});

// ── Parent events ────────────────────────────────────────────────────

export const ParentLinkedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.linked_to_learner'),
  payload: z.object({
    learnerAuthUserId: uuidLike(),
    verificationMethod: z.enum(['otp', 'invite_code', 'admin']),
  }),
});

export const ParentReportViewedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.report_viewed'),
  payload: z.object({
    learnerAuthUserId: uuidLike(),
    reportKind: z.enum(['daily', 'weekly', 'monthly']),
  }),
});

// ── Teacher events ───────────────────────────────────────────────────

export const TeacherAssignmentCreatedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.assignment_created'),
  payload: z.object({
    assignmentId: uuidLike(),
    classId: uuidLike(),
    subjectCode: z.string(),
    chapterNumbers: z.array(z.number().int().positive()),
    dueAt: isoDatetime().nullable(),
  }),
});

// ── School / tenant events ───────────────────────────────────────────

export const SchoolModuleToggledSchema = EventBaseSchema.extend({
  kind: z.literal('school.module_toggled'),
  payload: z.object({
    moduleKey: z.string(),
    isEnabled: z.boolean(),
    reason: z.string().nullable(),
  }),
});

// ── Billing events ───────────────────────────────────────────────────

export const BillingInvoicePaidSchema = EventBaseSchema.extend({
  kind: z.literal('billing.invoice_paid'),
  payload: z.object({
    invoiceId: uuidLike(),
    amountInr: z.number().int().nonnegative(),
    planSlug: z.string(),
  }),
});

// ── Mesh (autonomous improvement) events ─────────────────────────────

export const MeshCycleCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('mesh.cycle_completed'),
  payload: z.object({
    cycleId: uuidLike(),
    decision: z.enum(['approve', 'request_changes', 'reject', 'escalate_to_human']),
    targetMetric: z.string(),
    tokensSpent: z.number().int().nonnegative(),
  }),
});

// ── The discriminated union ──────────────────────────────────────────

export const DomainEventSchema = z.discriminatedUnion('kind', [
  LearnerSignedUpSchema,
  LearnerSessionStartedSchema,
  LearnerQuizCompletedSchema,
  LearnerLessonCompletedSchema,
  LearnerMasteryChangedSchema,
  FoxySessionStartedSchema,
  FoxySessionCompletedSchema,
  ParentLinkedSchema,
  ParentReportViewedSchema,
  TeacherAssignmentCreatedSchema,
  SchoolModuleToggledSchema,
  BillingInvoicePaidSchema,
  MeshCycleCompletedSchema,
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventKind = DomainEvent['kind'];

/**
 * Frozen list of all event kinds. Used by:
 *   - tests that pin the registry shape
 *   - the rule engine's subscription declarations
 *   - the bus's allowlist (we never publish an event whose kind isn't here)
 */
export const ALL_EVENT_KINDS: readonly DomainEventKind[] = [
  'learner.signed_up',
  'learner.session_started',
  'learner.quiz_completed',
  'learner.lesson_completed',
  'learner.mastery_changed',
  'ai.foxy_session_started',
  'ai.foxy_session_completed',
  'parent.linked_to_learner',
  'parent.report_viewed',
  'teacher.assignment_created',
  'school.module_toggled',
  'billing.invoice_paid',
  'mesh.cycle_completed',
] as const;

/** Narrow an event by kind. Useful for subscribers handling a subset. */
export function isEventKind<K extends DomainEventKind>(
  event: DomainEvent,
  kind: K,
): event is Extract<DomainEvent, { kind: K }> {
  return event.kind === kind;
}
