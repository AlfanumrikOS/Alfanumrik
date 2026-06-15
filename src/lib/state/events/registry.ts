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
 *   Actors: learner, parent, teacher, school, ai, billing, mesh, system
 *   The compiler can't enforce this; the test in
 *   src/__tests__/state/events-registry.test.ts can.
 *
 * The `system` actor (added with Phase A Loop A, spec Decision 8 in
 * docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md)
 * is the platform acting AUTONOMOUSLY under tiered authority — no existing
 * actor fits (it is not a learner/teacher/ai-tutor action). Adding an actor
 * is sanctioned ONLY as a paired change: this header comment AND the
 * CANONICAL_ACTORS pin in src/__tests__/state/events-registry.test.ts move
 * together in the same PR.
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

// Foxy Post-Answer Learning Actions (Phase 1, 2026-06-14). NON-EVIDENTIAL
// telemetry emitted when a student taps a post-answer action chip on a Foxy
// assistant message (Got it / Explain simpler / Show example / Quiz me on this
// / Save to notebook). This is a SELF-REPORT signal, NOT a graded answer:
//
//   ⚠️ BINDING learner-state contract (assessment-issued):
//   No subscriber may consume this event to write ANY mastery surface
//   (concept_mastery, cme_concept_state, student_skill_state, knowledge_gaps,
//   learner_mastery, cme_error_log, quiz_sessions, student_learning_profiles,
//   bloom_progression). A self-report cannot move mastery_mean / p_know.
//   Only a REAL "Quiz me" answer feeds mastery, and it does so through the
//   EXISTING concept-check / BKT path (learner.concept_check_answered) — never
//   through this event. Award 0 XP. The bus row is pure observability.
//
// P13: payload is IDs + enums only — no free text (the saved answer body lives
// in student_bookmarks, never on the bus; the message text is never echoed).
export const LearnerLearningActionSchema = EventBaseSchema.extend({
  kind: z.literal('learner.learning_action'),
  payload: z.object({
    messageId: uuidLike(),
    sessionId: uuidLike(),
    // The concept the answer was about, when the client knows it. Nullable +
    // optional because the post-answer bar fires before any concept is bound.
    conceptId: uuidLike().nullable().optional(),
    actionType: z.enum(['got_it', 'explain_simpler', 'show_example', 'quiz_me', 'save']),
    subjectCode: z.string().nullable(),
    chapterNumber: z.number().int().nonnegative().nullable(),
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

// Phase D.1 — DPDP parental-consent capture. Emitted when a guardian
// records explicit consent for a linked child via the consent capture
// screen. Payload carries the consent_version + the boolean scope grants
// so downstream subscribers (audit pipeline, parent notifications, DPDP
// regulator report) can fan out without re-reading parental_consent.
// IP and user-agent stay in the canonical row — payload is bounded to
// what subscribers actually need.
export const ParentConsentGrantedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.consent_granted'),
  payload: z.object({
    consentId:     uuidLike(),
    guardianId:    uuidLike(),
    studentId:     uuidLike(),
    consentVersion: z.string().min(1).max(64),
    // Per-scope boolean grants. Keys mirror CONSENT_SCOPES in
    // src/lib/dpdp/consent.ts. Subscribers MUST treat missing keys as
    // "not granted" — a forward-compatible default.
    scopes: z.object({
      curriculum_access:                       z.boolean().optional(),
      performance_data_sharing_with_teacher:   z.boolean().optional(),
      marketing_emails:                        z.boolean().optional(),
    }),
    locale: z.enum(['en', 'hi']),
  }),
});

// Phase D.1 — DPDP parental-consent revocation. Emitted when a guardian
// withdraws consent for a linked child. Subscribers should treat this as
// a "stop processing this child's data" signal — pause notifications,
// flag the account for human review, etc.
export const ParentConsentRevokedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.consent_revoked'),
  payload: z.object({
    consentId:  uuidLike(),
    guardianId: uuidLike(),
    studentId:  uuidLike(),
    // The version of consent that was revoked — lets the regulator audit
    // which policy iteration the parent had agreed to.
    consentVersion: z.string().min(1).max(64),
  }),
});

// Phase D.2 — DPDP §13. Emitted when a verified guardian downloads the
// full export of their child's data via /api/parent/children/[id]/export.
// `tableCounts` lets analytics + audit subscribers see the per-table row
// volumes returned without re-reading the audit_logs row. `payloadBytes`
// is the JSON byte size of the file the guardian downloaded — useful for
// triggering ops handoff alerts when guardians repeatedly hit the
// 10MB guardrail (an indicator the in-app endpoint isn't sufficient for
// that child's history).
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
});

// ── Phase D.3 — DPDP §15 right-to-erasure events ─────────────────────
//
// Three events span the lifecycle of a parent-initiated child-data
// deletion request. All three actor is the guardian (the parent who
// clicked the CTA); studentId carries who the data belongs to. The
// `requestId` corresponds to public.data_erasure_requests.id and is
// the idempotency anchor for downstream subscribers.
//
// The cron purger is the producer of `.completed` — the route layer
// produces `.requested` and `.cancelled`. journey.ts intentionally
// returns null for all three: child-data erasure is an admin / DPDP
// concern, not a learner-facing milestone.

export const ParentChildErasureRequestedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.child_erasure_requested'),
  payload: z.object({
    requestId:  uuidLike(),
    guardianId: uuidLike(),
    studentId:  uuidLike(),
    purgeAt:    isoDatetime(),
    // Free-form reason the parent typed in the confirmation dialog.
    // Bounded to keep payloads small. null when the parent skipped it.
    hasReason:  z.boolean(),
  }),
});

export const ParentChildErasureCancelledSchema = EventBaseSchema.extend({
  kind: z.literal('parent.child_erasure_cancelled'),
  payload: z.object({
    requestId:   uuidLike(),
    guardianId:  uuidLike(),
    studentId:   uuidLike(),
    // For analytics: how long after `requested` did the parent change their
    // mind? null when occurredAt parsing fails on the route side.
    elapsedSec:  z.number().int().nonnegative().nullable(),
  }),
});

export const ParentChildErasureCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('parent.child_erasure_completed'),
  payload: z.object({
    requestId:        uuidLike(),
    guardianId:       uuidLike(),
    studentId:        uuidLike(),
    // Map of table → row count actually deleted, for ops dashboards. Keys
    // are stable strings (table names) so subscribers can roll up by table
    // without re-parsing. Bounded to ≤32 entries by the producer.
    rowsDeleted:      z.record(z.string(), z.number().int().nonnegative()),
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

// Phase C.3 (ADR-005). Messaging events for the teacher↔parent surface.
// One event per send — payload deliberately omits the body to keep
// payloads bounded; subscribers fetch the body from teacher_parent_messages
// if they need it. `hasThreadOpened` lets the notification subscriber tell
// "first message in this thread" from "follow-up reply" without an extra
// DB read.
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
});

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
});

// Phase C.2 (ADR-005). Teacher entering a single cell in the grade book —
// recorded score on (student, column_key) for the current term. column_key
// is the bare subject code today (subject-level grade book); kind is one of
// 'subject' | 'unit' | 'attendance' so subscribers can branch on the
// canonical-row shape without re-reading the column registry. Score is
// retained on the payload (un-normalised to 0-1) so downstream consumers
// can pre-compute report-card aggregates without joining back to
// `score_history`. Notes are NOT on the payload — keep bounded; subscribers
// fetch the body from the canonical row if needed.
export const TeacherGradeEntrySetSchema = EventBaseSchema.extend({
  kind: z.literal('teacher.grade_entry_set'),
  payload: z.object({
    teacherId: uuidLike(),
    classId:   uuidLike(),
    studentId: uuidLike(),
    // Free-form column id ("math", "unit-3", "attendance"). Bounded.
    columnKey: z.string().min(1).max(64),
    columnKind: z.enum(['subject', 'unit', 'attendance']),
    // Score the teacher recorded — must satisfy 0 ≤ score ≤ maxScore.
    score:    z.number().min(0).max(1000),
    maxScore: z.number().positive().max(1000),
    hasNotes: z.boolean(),
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

// ── System (autonomous tiered-authority) events ─────────────────────
//
// Phase A Loop A — adaptive closed loop (mastery-cliff → auto-remediation →
// recovery verification). Producer is the daily-cron worker route
// (/api/cron/adaptive-remediation) acting WITHOUT human approval under the
// CEO-approved TIERED authority model; these events are the immutable audit
// trail of every autonomous action ("show me every time the system acted on
// its own"). The canonical state lives on adaptive_interventions — the bus is
// observability, never load-bearing (spec Decision 4; escalations additionally
// write an audit_logs row so the trail survives a bus-off environment).
//
// Envelope: actorAuthUserId carries the LEARNER's auth_user_id (the envelope
// contract is "who the event is about"); tenantId carries the school for B2B,
// null for B2C; idempotencyKey = `remediation:<interventionId>:<phase>` so
// cron retries dedupe. Payloads are UUIDs + derived metrics only — no PII (P13).

export const SystemRemediationInjectedSchema = EventBaseSchema.extend({
  kind: z.literal('system.remediation_injected'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    // Largest single-event mastery drop that triggered the cliff (0..1).
    // Null when the flag fired without a measurable delta.
    largestDrop: z.number().min(0).max(1).nullable(),
    declineStreak: z.number().int().nonnegative(),
    // Pre-cliff baseline frozen into trigger_snapshot. Null when unknown
    // (score-trend cliff path) — then only the gain branch can recover.
    baselineMastery: z.number().min(0).max(1).nullable(),
    // Denormalized recovery deadline (created_at + verification window).
    verifyBy: isoDatetime(),
  }),
});

export const SystemRemediationRecoveredSchema = EventBaseSchema.extend({
  kind: z.literal('system.remediation_recovered'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    // Mastery at the latest in-window observation that satisfied recovery.
    recoveredMastery: z.number().min(0).max(1),
    daysToRecovery: z.number().int().nonnegative(),
  }),
});

export const SystemRemediationEscalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.remediation_escalated'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    // 'teacher' (B2B roster), 'parent' (B2C linked guardian), or null when
    // neither exists — the null case is deliberately on the payload so ops
    // can see unreachable escalations (spec Decision 7).
    escalatedTo: z.enum(['teacher', 'parent']).nullable(),
    // FK of the Phase 3A teacher_remediation_assignments row created on B2B
    // escalation; null for parent / no-recipient escalations.
    teacherAssignmentId: uuidLike().nullable(),
  }),
});

// ── System — Phase A Loops B & C (autonomous tiered-authority) events ────────
//
// Phase A Loops B (inactivity re-engagement) + C (at-risk-concentration
// escalation) ride the SAME `system` actor + the SAME daily-cron worker route
// (/api/cron/adaptive-remediation) as Loop A — no new actor (spec §5.4).
// Producer is the worker acting WITHOUT human approval under the CEO-approved
// TIERED authority model; these events are the autonomous-action audit trail.
// Canonical state lives on adaptive_interventions; the bus is observability,
// never load-bearing. Loop C escalations additionally write an audit_logs row.
//
// Envelope: actorAuthUserId = the LEARNER's auth_user_id; tenantId = the school
// for B2B (Loop C teacher path), null for B2C / Loop B; idempotencyKey =
// `<loop>:<interventionId>:<phase>` so cron retries dedupe. Payloads are UUIDs +
// subject codes + derived integer metrics only — no PII (P13).
//
// Loop B is subject-less (sentinel `_inactivity` row); its event payloads carry
// NO subjectCode/chapterNumber. Loop C is subject-scoped and always attaches a
// REAL chapter (>= 1, never the Loop B sentinel 0).

export const SystemEngagementNudgedSchema = EventBaseSchema.extend({
  kind: z.literal('system.engagement_nudged'),
  payload: z.object({
    interventionId: uuidLike(),
    // Whole UTC days since the student's last activity at trigger time.
    daysSinceActive: z.number().int().nonnegative(),
    // Denormalized return deadline (created_at + inactivity return window).
    verifyBy: isoDatetime(),
  }),
});

export const SystemEngagementReturnedSchema = EventBaseSchema.extend({
  kind: z.literal('system.engagement_returned'),
  payload: z.object({
    interventionId: uuidLike(),
    // Whole rolling days from the nudge to the qualifying return.
    daysToReturn: z.number().int().nonnegative(),
  }),
});

export const SystemEngagementEscalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.engagement_escalated'),
  payload: z.object({
    interventionId: uuidLike(),
    // 'parent' (B2C linked guardian) or null when no guardian is linked — the
    // null case is on the payload so ops can see unreachable escalations.
    // NEVER 'teacher' (Decision B4 — disengagement is a parent matter).
    escalatedTo: z.literal('parent').nullable(),
  }),
});

export const SystemConcentrationEscalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.concentration_escalated'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    // Real chapter (>= 1) — the worst at-risk chapter at trigger time.
    chapterNumber: z.number().int().positive(),
    atRiskChapterCount: z.number().int().nonnegative(),
    // 'teacher' (B2B roster), 'parent' (B2C linked guardian), or null when
    // neither exists — null on the payload for ops visibility.
    escalatedTo: z.enum(['teacher', 'parent']).nullable(),
    // FK of the teacher_remediation_assignments row created on B2B escalation;
    // null for parent / no-recipient escalations.
    teacherAssignmentId: uuidLike().nullable(),
    // Denormalized resolution deadline (created_at + concentration return window).
    verifyBy: isoDatetime(),
  }),
});

export const SystemConcentrationResolvedSchema = EventBaseSchema.extend({
  kind: z.literal('system.concentration_resolved'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    // Current at-risk-chapter count at the resolving snapshot (now below 'high').
    atRiskChapterCount: z.number().int().nonnegative(),
    daysToResolve: z.number().int().nonnegative(),
  }),
});

export const SystemConcentrationReescalatedSchema = EventBaseSchema.extend({
  kind: z.literal('system.concentration_reescalated'),
  payload: z.object({
    interventionId: uuidLike(),
    subjectCode: z.string(),
    escalatedTo: z.enum(['teacher', 'parent']).nullable(),
    teacherAssignmentId: uuidLike().nullable(),
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
  LearnerLearningActionSchema,
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
  'learner.learning_action',
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
  'mesh.cycle_completed',
] as const;

/** Narrow an event by kind. Useful for subscribers handling a subset. */
export function isEventKind<K extends DomainEventKind>(
  event: DomainEvent,
  kind: K,
): event is Extract<DomainEvent, { kind: K }> {
  return event.kind === kind;
}
