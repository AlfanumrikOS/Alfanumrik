/**
 * supabase/functions/_shared/state-runtime/events-registry.ts
 *
 * Deno-side copy of `packages/lib/src/state/events/registry.ts`. Kept in sync by
 * hand because Supabase Edge Functions cannot import from the Next.js `src/`
 * tree (Deno runtime, no `@/*` path aliases, no Node TS resolution).
 *
 * If you change the domain event registry in
 * `packages/lib/src/state/events/registry.ts`, mirror the change here. The
 * Node↔Deno kind-set PARITY is enforced by
 * `apps/host/src/__tests__/state/events-registry-deno-parity.test.ts`, and the
 * Node registry shape by
 * `apps/host/src/__tests__/state/events-registry.test.ts`.
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

// ADR-004 Phase 2 / ADR-005 Path C v2 — emitted by the atomic
// tutor_commit_attempt RPC, consumed by concept-mastery-projector to
// roll up canonical concept_mastery. priorMasteryMean is the chain
// head's posterior at lock-acquisition time, which makes the route's
// optimistic compute byte-identical to the projector's catch-up compute.
export const LearnerConceptCheckAnsweredSchema = EventBaseSchema.extend({
  kind: z.literal('learner.concept_check_answered'),
  payload: z.object({
    studentId:        uuidLike(),
    conceptId:        uuidLike(),
    attemptId:        uuidLike(),
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
})

// Foxy Post-Answer Learning Actions (Phase 1). NON-EVIDENTIAL self-report
// telemetry (Got it / Explain simpler / Show example / Quiz me / Save).
//
//   ⚠️ BINDING learner-state contract (assessment-issued): no subscriber may
//   consume this event to write ANY mastery surface. Only a REAL "Quiz me"
//   answer moves mastery, through learner.concept_check_answered — never this
//   event. The bus row is pure observability. P13: ids + enums only, no text.
export const LearnerLearningActionSchema = EventBaseSchema.extend({
  kind: z.literal('learner.learning_action'),
  payload: z.object({
    messageId: uuidLike(),
    sessionId: uuidLike(),
    conceptId: uuidLike().nullable().optional(),
    actionType: z.enum(['got_it', 'explain_simpler', 'show_example', 'quiz_me', 'save']),
    subjectCode: z.string().nullable(),
    chapterNumber: z.number().int().nonnegative().nullable(),
  }),
})

// Foxy weak-area loop — struggle signal (PART B2). ADVISORY, NON-MASTERY
// telemetry emitted when Foxy OBSERVES a struggle pattern mid-turn.
//
//   ⚠️ BINDING learner-state contract (assessment-issued, mirrors
//   learner.learning_action): no subscriber may write ANY mastery surface from
//   it. A struggle OBSERVATION cannot move mastery_mean / p_know / error_count_*.
//   Only learner.concept_check_answered feeds mastery. Pure observability.
//   P13: ids + enums only — the student's words are never echoed onto the bus.
export const LearnerStruggleObservedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.struggle_observed'),
  payload: z.object({
    studentId: uuidLike(),
    sessionId: uuidLike(),
    conceptId: uuidLike().nullable(),
    subjectCode: z.string(),
    signalType: z.enum([
      'repeated_hint',
      'repeated_wrong',
      'explicit_confusion',
      'long_idle',
      'give_up',
    ]),
    occurredAt: isoDatetime(),
  }),
})

// Foxy per-turn PERCEPTION classifier (Phase 1 — Foxy Intelligent Learning OS).
// One structured read per Foxy assistant turn: what the turn was about
// (subject / grade / chapter / topic / Bloom level), which misconception (if
// any) was detected, which struggle signal was observed, and the learner's
// intent. Feeds Foxy's in-turn adaptation + analytics + reports.
//
//   ⚠️ BINDING learner-state contract (assessment-issued, mirrors
//   learner.learning_action / learner.struggle_observed): no subscriber may
//   consume this event to write ANY mastery / p_know / error surface. A
//   PERCEPTION of a turn cannot move mastery. Only learner.concept_check_answered
//   feeds mastery. The bus row is pure observability.
//
// P5: `grade` is a STRING ("6".."12"), never an integer.
// P13: codes + ids + enums ONLY — never the student's message text, email,
//   phone, or name. `misconceptionCode` / `intent` are short LABELS, not text.
export const LearnerTurnClassifiedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.turn_classified'),
  payload: z.object({
    studentId: uuidLike(),
    foxySessionId: uuidLike(),
    messageId: uuidLike(),
    subjectCode: z.string(),
    grade: z.string().regex(/^(?:[6-9]|1[0-2])$/),
    chapterNumber: z.number().int().positive().nullable(),
    topicId: uuidLike().nullable(),
    // Canonical LOWERCASE Bloom codes — identical to cognitive-engine's
    // BloomLevel and the bloom_progression / question_bank columns this feeds.
    // (Producer normalizes Foxy's PascalCase block enum to lowercase at emit.)
    bloomLevel: z
      .enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'])
      .nullable(),
    misconceptionCode: z.string().min(1).max(64).nullable(),
    struggleSignal: z.enum([
      'none',
      'repeated_hint',
      'repeated_wrong',
      'explicit_confusion',
      'long_idle',
      'give_up',
    ]),
    intent: z.string().min(1).max(64),
  }),
})

// ADR-001 Phase 3c / ADR-005 E10 sunset — the Learner Loop resolver's answer as
// a durable event, consumed by the scheduled-actions-writer projector. Payload
// mirrors the route's scheduled_actions upsert columns 1:1. P13: ids + enums +
// the action body the resolver already returns to the client — no PII.
export const LearnerNextActionResolvedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.next_action_resolved'),
  payload: z.object({
    studentId:    uuidLike(),
    horizon:      z.literal('daily'),
    dayBucket:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rank:         z.literal(0),
    actionKind:   z.string().min(1).max(64),
    actionPayload: z.record(z.string(), z.unknown()),
    generatedAt:  isoDatetime(),
    expiresAt:    isoDatetime(),
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

// Phase D.1 — DPDP parental-consent capture.
export const ParentConsentGrantedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.consent_granted'),
  payload: z.object({
    consentId:     uuidLike(),
    guardianId:    uuidLike(),
    studentId:     uuidLike(),
    consentVersion: z.string().min(1).max(64),
    scopes: z.object({
      curriculum_access:                       z.boolean().optional(),
      performance_data_sharing_with_teacher:   z.boolean().optional(),
      marketing_emails:                        z.boolean().optional(),
    }),
    locale: z.enum(['en', 'hi']),
  }),
})

// Phase D.1 — DPDP parental-consent revocation.
export const ParentConsentRevokedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.consent_revoked'),
  payload: z.object({
    consentId:  uuidLike(),
    guardianId: uuidLike(),
    studentId:  uuidLike(),
    consentVersion: z.string().min(1).max(64),
  }),
})

// Phase D.2 — DPDP §13 child-data export.
export const ParentChildDataExportedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.child_data_exported'),
  payload: z.object({
    guardianId: uuidLike(),
    studentId:  uuidLike(),
    schemaVersion: z.string().min(1).max(32),
    payloadBytes:  z.number().int().nonnegative(),
    tableCount:    z.number().int().nonnegative(),
    rowCountTotal: z.number().int().nonnegative(),
  }),
})

// Phase D.3 — DPDP §15 right-to-erasure events.
export const ParentChildErasureRequestedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.child_erasure_requested'),
  payload: z.object({
    requestId: uuidLike(),
    guardianId: uuidLike(),
    studentId: uuidLike(),
    purgeAt: isoDatetime(),
    hasReason: z.boolean(),
  }),
})

export const ParentChildErasureCancelledSchema = EventBaseSchema.extend({
  kind: z.literal('parent.child_erasure_cancelled'),
  payload: z.object({
    requestId: uuidLike(),
    guardianId: uuidLike(),
    studentId: uuidLike(),
    elapsedSec: z.number().int().nonnegative().nullable(),
  }),
})

export const ParentChildErasureCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.child_erasure_completed'),
  payload: z.object({
    requestId: uuidLike(),
    guardianId: uuidLike(),
    studentId: uuidLike(),
    rowsDeleted: z.record(z.string(), z.number().int().nonnegative()),
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

// Phase B.5 (ADR-005) — teacher classroom CRUD events.
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
})

export const TeacherClassroomUpdatedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.classroom_updated'),
  payload: z.object({
    classId:   uuidLike(),
    teacherId: uuidLike(),
    patch: z.object({
      name:    z.string().min(1).max(100).optional(),
      section: z.string().max(4).nullable().optional(),
    }),
  }),
})

export const TeacherClassroomArchivedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.classroom_archived'),
  payload: z.object({
    classId:   uuidLike(),
    teacherId: uuidLike(),
  }),
})

export const TeacherStudentNoteSetSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.student_note_set'),
  payload: z.object({
    teacherId: uuidLike(),
    studentId: uuidLike(),
    hasNote: z.boolean(),
    hasGoal: z.boolean(),
  }),
})

export const TeacherProfileUpdatedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.profile_updated'),
  payload: z.object({
    teacherId: uuidLike(),
    fields: z.array(z.enum(['name', 'school_name'])).min(1),
  }),
})

// Phase C.1 (ADR-005) — teacher reviewing a student's submission.
export const TeacherSubmissionReviewedSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.submission_reviewed'),
  payload: z.object({
    submissionId:  uuidLike(),
    assignmentId: uuidLike(),
    studentId:    uuidLike(),
    teacherId:    uuidLike(),
    hasFeedback:  z.boolean(),
    scorePercent: z.number().min(0).max(100).nullable(),
    scoreOverridden: z.boolean(),
  }),
})

// Phase C.2 (ADR-005) — teacher grade-book cell entry.
export const TeacherGradeEntrySetSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.grade_entry_set'),
  payload: z.object({
    teacherId: uuidLike(),
    classId:   uuidLike(),
    studentId: uuidLike(),
    columnKey: z.string().min(1).max(64),
    columnKind: z.enum(['subject', 'unit', 'attendance']),
    score:    z.number().min(0).max(1000),
    maxScore: z.number().positive().max(1000),
    hasNotes: z.boolean(),
  }),
})

// Phase C.3 (ADR-005) — teacher↔parent messaging.
export const TeacherParentMessageSentSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.parent_message_sent'),
  payload: z.object({
    threadId:        uuidLike(),
    messageId:       uuidLike(),
    teacherId:       uuidLike(),
    guardianId:      uuidLike(),
    studentId:       uuidLike(),
    bodyLength:      z.number().int().nonnegative().max(10000),
    isNewThread:     z.boolean(),
  }),
})

export const ParentTeacherMessageSentSchema = EventBaseSchema.extend({
  kind: z.literal('parent.teacher_message_sent'),
  payload: z.object({
    threadId:        uuidLike(),
    messageId:       uuidLike(),
    teacherId:       uuidLike(),
    guardianId:      uuidLike(),
    studentId:       uuidLike(),
    bodyLength:      z.number().int().nonnegative().max(10000),
    isNewThread:     z.boolean(),
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

// ── System (autonomous tiered-authority) events — Phase A Loop A ──────
// Producer is the daily-cron adaptive-remediation worker. Canonical state lives
// on adaptive_interventions; the bus is observability. Payloads are UUIDs +
// derived metrics only — no PII (P13).

export const SystemRemediationInjectedSchema = EventBaseSchema.extend({
  kind: z.literal('system.remediation_injected'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    largestDrop: z.number().min(0).max(1).nullable(),
    declineStreak: z.number().int().nonnegative(),
    baselineMastery: z.number().min(0).max(1).nullable(),
    verifyBy: isoDatetime(),
  }),
})

export const SystemRemediationRecoveredSchema = EventBaseSchema.extend({
  kind: z.literal('system.remediation_recovered'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    recoveredMastery: z.number().min(0).max(1),
    daysToRecovery: z.number().int().nonnegative(),
  }),
})

export const SystemRemediationEscalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.remediation_escalated'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    escalatedTo: z.enum(['teacher', 'parent']).nullable(),
    teacherAssignmentId: uuidLike().nullable(),
  }),
})

// ── System — Phase A Loops B (inactivity) & C (at-risk concentration) ─
// Same actor + substrate + worker as Loop A. Loop B is subject-less; Loop C is
// subject-scoped with a real chapter (>= 1). Payloads are UUIDs + subject codes
// + derived integer metrics only — no PII (P13).

export const SystemEngagementNudgedSchema = EventBaseSchema.extend({
  kind: z.literal('system.engagement_nudged'),
  payload: z.object({
    interventionId: uuidLike(),
    daysSinceActive: z.number().int().nonnegative(),
    verifyBy: isoDatetime(),
  }),
})

export const SystemEngagementReturnedSchema = EventBaseSchema.extend({
  kind: z.literal('system.engagement_returned'),
  payload: z.object({
    interventionId: uuidLike(),
    daysToReturn: z.number().int().nonnegative(),
  }),
})

export const SystemEngagementEscalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.engagement_escalated'),
  payload: z.object({
    interventionId: uuidLike(),
    escalatedTo: z.literal('parent').nullable(),
  }),
})

export const SystemConcentrationEscalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.concentration_escalated'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    atRiskChapterCount: z.number().int().nonnegative(),
    escalatedTo: z.enum(['teacher', 'parent']).nullable(),
    teacherAssignmentId: uuidLike().nullable(),
    verifyBy: isoDatetime(),
  }),
})

export const SystemConcentrationResolvedSchema = EventBaseSchema.extend({
  kind: z.literal('system.concentration_resolved'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    atRiskChapterCount: z.number().int().nonnegative(),
    daysToResolve: z.number().int().nonnegative(),
  }),
})

export const SystemConcentrationReescalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.concentration_reescalated'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    escalatedTo: z.enum(['teacher', 'parent']).nullable(),
    teacherAssignmentId: uuidLike().nullable(),
  }),
})

// ── System — Loop D (blocked-prerequisite, Digital Twin + Knowledge Graph
// Slice 1) ─────────────────────────────────────────────────────────────
// Same actor + adaptive_interventions substrate as Loops A/B/C. Gated by
// ff_digital_twin_v1. Payloads are UUIDs + subject codes + chapter numbers +
// a bounded reason enum only — no PII (P13).

export const SystemPrerequisiteBlockedSchema = EventBaseSchema.extend({
  kind: z.literal('system.prerequisite_blocked'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    dependentChapterNumber: z.number().int().positive(),
    prerequisiteChapterNumber: z.number().int().positive(),
    reason: z.enum(['mastery', 'decay', 'both']),
  }),
})

export const SystemPrerequisiteResolvedSchema = EventBaseSchema.extend({
  kind: z.literal('system.prerequisite_resolved'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    dependentChapterNumber: z.number().int().positive(),
    prerequisiteChapterNumber: z.number().int().positive(),
    daysToResolve: z.number().int().nonnegative(),
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
// Keep this list in the SAME ORDER as packages/lib/src/state/events/registry.ts
// so the two files diff cleanly.

export const DomainEventSchema = z.discriminatedUnion('kind', [
  LearnerSignedUpSchema,
  LearnerSessionStartedSchema,
  LearnerQuizCompletedSchema,
  LearnerLessonCompletedSchema,
  LearnerMasteryChangedSchema,
  LearnerReviewGradedSchema,
  LearnerScanExtractedSchema,
  LearnerConceptCheckAnsweredSchema,
  LearnerLearningActionSchema,
  LearnerStruggleObservedSchema,
  LearnerTurnClassifiedSchema,
  LearnerNextActionResolvedSchema,
  FoxySessionStartedSchema,
  FoxySessionCompletedSchema,
  ParentLinkedSchema,
  ParentReportViewedSchema,
  ParentConsentGrantedSchema,
  ParentConsentRevokedSchema,
  ParentChildDataExportedSchema,
  ParentChildErasureRequestedSchema,
  ParentChildErasureCancelledSchema,
  ParentChildErasureCompletedSchema,
  TeacherAssignmentCreatedSchema,
  TeacherClassroomCreatedSchema,
  TeacherClassroomUpdatedSchema,
  TeacherClassroomArchivedSchema,
  TeacherStudentNoteSetSchema,
  TeacherProfileUpdatedSchema,
  TeacherSubmissionReviewedSchema,
  TeacherGradeEntrySetSchema,
  TeacherParentMessageSentSchema,
  ParentTeacherMessageSentSchema,
  SchoolModuleToggledSchema,
  BillingInvoicePaidSchema,
  SystemRemediationInjectedSchema,
  SystemRemediationRecoveredSchema,
  SystemRemediationEscalatedSchema,
  SystemEngagementNudgedSchema,
  SystemEngagementReturnedSchema,
  SystemEngagementEscalatedSchema,
  SystemConcentrationEscalatedSchema,
  SystemConcentrationResolvedSchema,
  SystemConcentrationReescalatedSchema,
  SystemPrerequisiteBlockedSchema,
  SystemPrerequisiteResolvedSchema,
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
  'learner.concept_check_answered',
  'learner.learning_action',
  'learner.struggle_observed',
  'learner.turn_classified',
  'learner.next_action_resolved',
  'ai.foxy_session_started',
  'ai.foxy_session_completed',
  'parent.linked_to_learner',
  'parent.report_viewed',
  'parent.consent_granted',
  'parent.consent_revoked',
  'parent.child_data_exported',
  'parent.child_erasure_requested',
  'parent.child_erasure_cancelled',
  'parent.child_erasure_completed',
  'teacher.assignment_created',
  'teacher.classroom_created',
  'teacher.classroom_updated',
  'teacher.classroom_archived',
  'teacher.student_note_set',
  'teacher.profile_updated',
  'teacher.submission_reviewed',
  'teacher.grade_entry_set',
  'teacher.parent_message_sent',
  'parent.teacher_message_sent',
  'school.module_toggled',
  'billing.invoice_paid',
  'system.remediation_injected',
  'system.remediation_recovered',
  'system.remediation_escalated',
  'system.engagement_nudged',
  'system.engagement_returned',
  'system.engagement_escalated',
  'system.concentration_escalated',
  'system.concentration_resolved',
  'system.concentration_reescalated',
  'system.prerequisite_blocked',
  'system.prerequisite_resolved',
  'mesh.cycle_completed',
] as const
