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

export const LearnerReviewGradedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.review_graded'),
  payload: z.object({
    cardId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    // SM-2 quality button. 0 = forgot, 3 = hard, 4 = good, 5 = easy.
    quality: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(5)]),
    // Source of the card — same enum as /review's filter tabs.
    source: z.enum(['quiz_wrong_answer', 'foxy_chat', 'study_plan']),
    previousIntervalDays: z.number().int().nonnegative(),
  }),
});

export const LearnerScanExtractedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.scan_extracted'),
  payload: z.object({
    uploadId: uuidLike(),
    // Type of artefact the student scanned. Same enum as /scan's IMAGE_TYPES.
    imageType: z.enum(['assignment', 'question_paper', 'notes', 'textbook']),
    // OCR-detected subject + chapter — both nullable when OCR is unsure.
    subjectCode: z.string().nullable(),
    chapterNumber: z.number().int().positive().nullable(),
    questionCount: z.number().int().nonnegative(),
  }),
});

// ADR-004 Phase 2 / ADR-005 Path C v2 — one row per /api/tutor/answer call
// committed under the (student, concept) advisory lock by the atomic
// tutor_commit_attempt RPC. The concept-mastery-projector consumes these
// and rolls them up into public.concept_mastery. The payload carries
// priorMasteryMean so the route's optimistic compute and the projector's
// catch-up compute are deterministically identical.
export const LearnerConceptCheckAnsweredSchema = EventBaseSchema.extend({
  kind: z.literal('learner.concept_check_answered'),
  payload: z.object({
    studentId:        uuidLike(),
    conceptId:        uuidLike(),
    attemptId:        uuidLike(),
    // `${conceptId}:practice:v1` in Phase 0/2; reserved for variant questions later.
    questionId:       z.string().min(1).max(200),
    correct:          z.boolean(),
    chosenIndex:      z.number().int().min(0).max(3),
    responseTimeMs:   z.number().int().nonnegative().nullable(),
    occurredAt:       isoDatetime(),
    attemptSequence:  z.number().int().positive(),
    priorMasteryMean: z.number().min(0).max(1),
    eventVersion:     z.literal(1),
    subjectCode:      z.string(),
    chapterNumber:    z.number().int().min(1),
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

// Phase B.5 (ADR-005 canonical-writer alignment): teacher classroom CRUD
// previously went straight from the page to the DB via the anon-key client.
// These events let any downstream subscriber (notifications, analytics,
// audit trail) react to teacher actions without re-querying the DB.
//
// Naming uses `teacher.classroom_*` rather than `classroom.*` to keep the
// actor in the canonical set (learner/parent/teacher/school/ai/billing/mesh) —
// same pattern as `tenant.*` events living under `school.*`.
export const TeacherClassroomCreatedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.classroom_created'),
  payload: z.object({
    classId:     uuidLike(),
    teacherId:   uuidLike(),
    name:        z.string().min(1).max(100),
    grade:       z.string().min(1).max(4),
    section:     z.string().max(4).nullable(),
    subjectCode: z.string().max(64).nullable(),
    classCode:   z.string().min(1).max(16),
  }),
});

export const TeacherClassroomUpdatedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.classroom_updated'),
  payload: z.object({
    classId:   uuidLike(),
    teacherId: uuidLike(),
    // Only fields actually changed appear in the patch — nulls signal
    // "explicitly cleared", absent fields signal "unchanged".
    patch: z.object({
      name:    z.string().min(1).max(100).optional(),
      section: z.string().max(4).nullable().optional(),
    }),
  }),
});

export const TeacherClassroomArchivedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.classroom_archived'),
  payload: z.object({
    classId:   uuidLike(),
    teacherId: uuidLike(),
  }),
});

export const TeacherStudentNoteSetSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.student_note_set'),
  payload: z.object({
    teacherId: uuidLike(),
    studentId: uuidLike(),
    // Note bodies are intentionally short — full text isn't sent on the
    // bus to keep payloads bounded; the projector fetches it from the
    // canonical `teacher_student_notes` row when it needs the full body.
    hasNote: z.boolean(),
    hasGoal: z.boolean(),
  }),
});

export const TeacherProfileUpdatedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.profile_updated'),
  payload: z.object({
    teacherId: uuidLike(),
    // Which scalar fields were updated this call. Names mirror the
    // teachers-table column names so subscribers don't need a mapping.
    fields: z.array(z.enum(['name', 'school_name'])).min(1),
  }),
});

// Phase C.1 (ADR-005). Teacher reviewing a student's assignment submission:
// records feedback and (optionally) a score override. Surfaces audit trail,
// drives parent notifications, and feeds analytics on review turnaround.
// The canonical `assignment_submissions.{teacher_feedback, graded_at,
// graded_by, score}` columns are still updated directly today — projector
// extraction is tracked TODO. Payload deliberately omits the feedback body
// (subscribers fetch from the canonical row); we send only booleans + the
// score override so payloads stay bounded.
export const TeacherSubmissionReviewedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.submission_reviewed'),
  payload: z.object({
    submissionId:  uuidLike(),
    assignmentId: uuidLike(),
    studentId:    uuidLike(),
    teacherId:    uuidLike(),
    hasFeedback:  z.boolean(),
    // Final score the teacher endorsed (or auto-graded score if no
    // override). null when neither the system nor the teacher set one.
    scorePercent: z.number().min(0).max(100).nullable(),
    scoreOverridden: z.boolean(),
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
  LearnerReviewGradedSchema,
  LearnerScanExtractedSchema,
  LearnerConceptCheckAnsweredSchema,
  FoxySessionStartedSchema,
  FoxySessionCompletedSchema,
  ParentLinkedSchema,
  ParentReportViewedSchema,
  TeacherAssignmentCreatedSchema,
  TeacherClassroomCreatedSchema,
  TeacherClassroomUpdatedSchema,
  TeacherClassroomArchivedSchema,
  TeacherStudentNoteSetSchema,
  TeacherProfileUpdatedSchema,
  TeacherSubmissionReviewedSchema,
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
  'learner.review_graded',
  'learner.scan_extracted',
  'learner.concept_check_answered',
  'ai.foxy_session_started',
  'ai.foxy_session_completed',
  'parent.linked_to_learner',
  'parent.report_viewed',
  'teacher.assignment_created',
  'teacher.classroom_created',
  'teacher.classroom_updated',
  'teacher.classroom_archived',
  'teacher.student_note_set',
  'teacher.profile_updated',
  'teacher.submission_reviewed',
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
