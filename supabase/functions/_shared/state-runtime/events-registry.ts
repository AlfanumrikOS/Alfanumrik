/**
 * supabase/functions/_shared/state-runtime/events-registry.ts
 *
 * Deno-side copy of `src/lib/state/events/registry.ts`. Kept in sync by hand
 * because Supabase Edge Functions cannot import from the Next.js `src/`
 * tree (Deno runtime, no `@/*` path aliases, no Node TS resolution).
 *
 * If you change the domain event registry in `src/lib/state/events/registry.ts`,
 * mirror the change here. A registry shape test (see
 * `src/__tests__/state/events-registry.test.ts`) is the source of truth.
 */
import { z } from 'https://esm.sh/zod@4.3.6'

const uuidLike = () =>
  z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    )
const isoDatetime = () =>
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    )

// ── Common envelope every event has ──────────────────────────────────

const EventBaseSchema = z.object({
  eventId: uuidLike(),
  occurredAt: isoDatetime(),
  actorAuthUserId: uuidLike(),
  tenantId: uuidLike().nullable(),
  idempotencyKey: z.string().min(1).max(128),
})

// ── Learner events ───────────────────────────────────────────────────

export const LearnerSignedUpSchema = EventBaseSchema.extend({
  kind: z.literal('learner.signed_up'),
  payload: z.object({
    grade: z.string(),
    board: z.enum(['CBSE', 'ICSE', 'STATE', 'OTHER']),
    language: z.enum(['en', 'hi']),
    invitedBy: uuidLike().nullable(),
  }),
})

export const LearnerSessionStartedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.session_started'),
  payload: z.object({
    surface: z.enum(['web', 'flutter']),
    referrer: z.string().nullable(),
  }),
})

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
})

export const LearnerLessonCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.lesson_completed'),
  payload: z.object({
    lessonId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    durationSec: z.number().int().nonnegative(),
  }),
})

export const LearnerMasteryChangedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.mastery_changed'),
  payload: z.object({
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    fromMastery: z.number().min(0).max(1).nullable(),
    toMastery: z.number().min(0).max(1),
    trigger: z.enum(['quiz', 'lesson', 'foxy', 'manual']),
  }),
})

export const LearnerReviewGradedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.review_graded'),
  payload: z.object({
    cardId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    quality: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(5)]),
    source: z.enum(['quiz_wrong_answer', 'foxy_chat', 'study_plan']),
    previousIntervalDays: z.number().int().nonnegative(),
  }),
})

export const LearnerScanExtractedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.scan_extracted'),
  payload: z.object({
    uploadId: uuidLike(),
    imageType: z.enum(['assignment', 'question_paper', 'notes', 'textbook']),
    subjectCode: z.string().nullable(),
    chapterNumber: z.number().int().positive().nullable(),
    questionCount: z.number().int().nonnegative(),
  }),
})

// ── AI / Foxy events ─────────────────────────────────────────────────

export const FoxySessionStartedSchema = EventBaseSchema.extend({
  kind: z.literal('ai.foxy_session_started'),
  payload: z.object({
    foxySessionId: uuidLike(),
    subjectCode: z.string().nullable(),
    chapterNumber: z.number().int().positive().nullable(),
    mode: z.enum(['tutor', 'doubt_solve', 'revision']),
  }),
})

export const FoxySessionCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('ai.foxy_session_completed'),
  payload: z.object({
    foxySessionId: uuidLike(),
    turnCount: z.number().int().nonnegative(),
    durationSec: z.number().int().nonnegative(),
    helpful: z.boolean().nullable(),
  }),
})

// ── Parent events ────────────────────────────────────────────────────

export const ParentLinkedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.linked_to_learner'),
  payload: z.object({
    learnerAuthUserId: uuidLike(),
    verificationMethod: z.enum(['otp', 'invite_code', 'admin']),
  }),
})

export const ParentReportViewedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.report_viewed'),
  payload: z.object({
    learnerAuthUserId: uuidLike(),
    reportKind: z.enum(['daily', 'weekly', 'monthly']),
  }),
})

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
})

// ── School / tenant events ───────────────────────────────────────────

export const SchoolModuleToggledSchema = EventBaseSchema.extend({
  kind: z.literal('school.module_toggled'),
  payload: z.object({
    moduleKey: z.string(),
    isEnabled: z.boolean(),
    reason: z.string().nullable(),
  }),
})

// ── Billing events ───────────────────────────────────────────────────

export const BillingInvoicePaidSchema = EventBaseSchema.extend({
  kind: z.literal('billing.invoice_paid'),
  payload: z.object({
    invoiceId: uuidLike(),
    amountInr: z.number().int().nonnegative(),
    planSlug: z.string(),
  }),
})

// ── Mesh (autonomous improvement) events ─────────────────────────────

export const MeshCycleCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('mesh.cycle_completed'),
  payload: z.object({
    cycleId: uuidLike(),
    decision: z.enum([
      'approve',
      'request_changes',
      'reject',
      'escalate_to_human',
    ]),
    targetMetric: z.string(),
    tokensSpent: z.number().int().nonnegative(),
  }),
})

// ── The discriminated union ──────────────────────────────────────────

export const DomainEventSchema = z.discriminatedUnion('kind', [
  LearnerSignedUpSchema,
  LearnerSessionStartedSchema,
  LearnerQuizCompletedSchema,
  LearnerLessonCompletedSchema,
  LearnerMasteryChangedSchema,
  LearnerReviewGradedSchema,
  LearnerScanExtractedSchema,
  FoxySessionStartedSchema,
  FoxySessionCompletedSchema,
  ParentLinkedSchema,
  ParentReportViewedSchema,
  TeacherAssignmentCreatedSchema,
  SchoolModuleToggledSchema,
  BillingInvoicePaidSchema,
  MeshCycleCompletedSchema,
])

export type DomainEvent = z.infer<typeof DomainEventSchema>
export type DomainEventKind = DomainEvent['kind']

export const ALL_EVENT_KINDS: readonly DomainEventKind[] = [
  'learner.signed_up',
  'learner.session_started',
  'learner.quiz_completed',
  'learner.lesson_completed',
  'learner.mastery_changed',
  'learner.review_graded',
  'learner.scan_extracted',
  'ai.foxy_session_started',
  'ai.foxy_session_completed',
  'parent.linked_to_learner',
  'parent.report_viewed',
  'teacher.assignment_created',
  'school.module_toggled',
  'billing.invoice_paid',
  'mesh.cycle_completed',
] as const
