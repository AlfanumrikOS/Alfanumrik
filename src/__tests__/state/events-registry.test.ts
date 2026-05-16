/**
 * Pin the shape of the domain-event registry.
 *
 * Referenced by src/lib/state/events/registry.ts:
 *   "Run the test that pins the registry shape."
 *
 * Three invariants the bus depends on:
 *
 *   1. ALL_EVENT_KINDS matches the discriminated union exactly. Adding a
 *      schema to the union without updating the frozen list (or vice
 *      versa) silently breaks subscriber allowlists and registry
 *      introspection. Caught here.
 *
 *   2. Every kind follows `<actor>.<verb_past>` where actor is one of
 *      the canonical actors named in the registry comment. The compiler
 *      cannot enforce this; we do.
 *
 *   3. Every schema accepts a minimal valid payload. Catches the "added
 *      a kind to the union but forgot a required payload field"
 *      regression.
 *
 * No DB, no Supabase, no mocks — pure schema introspection + parse.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_EVENT_KINDS,
  DomainEventSchema,
  isEventKind,
  type DomainEvent,
  type DomainEventKind,
} from '@/lib/state/events/registry';

// Canonical actors per registry.ts header comment. Update this list (and
// the registry comment) together if a new actor is introduced.
const CANONICAL_ACTORS = new Set([
  'learner',
  'parent',
  'teacher',
  'school',
  'ai',
  'billing',
  'mesh',
]);

// Deterministic fixtures. The regex validators on the envelope accept
// any well-formed UUID + ISO-8601; we don't need cryptographic UUIDs.
const FIXTURE_UUID_A = '00000000-0000-0000-0000-000000000001';
const FIXTURE_UUID_B = '00000000-0000-0000-0000-000000000002';
const FIXTURE_UUID_C = '00000000-0000-0000-0000-000000000003';
const FIXTURE_ISO = '2026-05-16T12:00:00.000Z';

const baseEnvelope = {
  eventId: FIXTURE_UUID_A,
  occurredAt: FIXTURE_ISO,
  actorAuthUserId: FIXTURE_UUID_B,
  tenantId: null,
  idempotencyKey: 'fixture-key-1',
};

// Minimal valid payloads keyed by event kind. Each must parse cleanly
// through DomainEventSchema. If a new kind is added to ALL_EVENT_KINDS
// without an entry here, the union-completeness test below will fail.
const VALID_PAYLOADS: Record<DomainEventKind, Record<string, unknown>> = {
  'learner.signed_up': { grade: '9', board: 'CBSE', language: 'en', invitedBy: null },
  'learner.session_started': { surface: 'web', referrer: null },
  'learner.quiz_completed': {
    quizSessionId: FIXTURE_UUID_C,
    subjectCode: 'math',
    chapterNumber: 1,
    questionCount: 10,
    correctCount: 8,
    durationSec: 300,
    xpEarned: 50,
  },
  'learner.lesson_completed': {
    lessonId: FIXTURE_UUID_C,
    subjectCode: 'science',
    chapterNumber: 2,
    durationSec: 600,
  },
  'learner.mastery_changed': {
    subjectCode: 'math',
    chapterNumber: 3,
    fromMastery: 0.4,
    toMastery: 0.72,
    trigger: 'quiz',
  },
  'learner.review_graded': {
    cardId: FIXTURE_UUID_C,
    subjectCode: 'science',
    chapterNumber: 4,
    quality: 4,
    source: 'quiz_wrong_answer',
    previousIntervalDays: 7,
  },
  'learner.scan_extracted': {
    uploadId: FIXTURE_UUID_C,
    imageType: 'assignment',
    subjectCode: 'math',
    chapterNumber: 5,
    questionCount: 12,
  },
  'learner.concept_check_answered': {
    studentId: FIXTURE_UUID_B,
    conceptId: FIXTURE_UUID_C,
    attemptId: FIXTURE_UUID_A,
    questionId: `${FIXTURE_UUID_C}:practice:v1`,
    correct: true,
    chosenIndex: 2,
    responseTimeMs: 4500,
    occurredAt: FIXTURE_ISO,
    attemptSequence: 1,
    priorMasteryMean: 0.5,
    eventVersion: 1,
    subjectCode: 'math',
    chapterNumber: 6,
  },
  'ai.foxy_session_started': {
    foxySessionId: FIXTURE_UUID_C,
    subjectCode: 'math',
    chapterNumber: 1,
    mode: 'tutor',
  },
  'ai.foxy_session_completed': {
    foxySessionId: FIXTURE_UUID_C,
    turnCount: 12,
    durationSec: 240,
    helpful: true,
  },
  'parent.linked_to_learner': {
    learnerAuthUserId: FIXTURE_UUID_C,
    verificationMethod: 'otp',
  },
  'parent.report_viewed': {
    learnerAuthUserId: FIXTURE_UUID_C,
    reportKind: 'weekly',
  },
  'parent.consent_granted': {
    consentId: FIXTURE_UUID_A,
    guardianId: FIXTURE_UUID_B,
    studentId: FIXTURE_UUID_C,
    consentVersion: 'v1-2026-05',
    scopes: {
      curriculum_access: true,
      performance_data_sharing_with_teacher: true,
      marketing_emails: false,
    },
    locale: 'en',
  },
  'parent.consent_revoked': {
    consentId: FIXTURE_UUID_A,
    guardianId: FIXTURE_UUID_B,
    studentId: FIXTURE_UUID_C,
    consentVersion: 'v1-2026-05',
  },
  'parent.child_data_exported': {
    guardianId: FIXTURE_UUID_A,
    studentId: FIXTURE_UUID_C,
    schemaVersion: 'v1-2026-05',
    payloadBytes: 12345,
    tableCount: 11,
    rowCountTotal: 432,
  },
  'teacher.assignment_created': {
    assignmentId: FIXTURE_UUID_C,
    classId: FIXTURE_UUID_A,
    subjectCode: 'science',
    chapterNumbers: [1, 2, 3],
    dueAt: FIXTURE_ISO,
  },
  'teacher.classroom_created': {
    classId: FIXTURE_UUID_C,
    teacherId: FIXTURE_UUID_A,
    name: '10-A Science',
    grade: '10',
    section: 'A',
    subjectCode: 'science',
    classCode: 'ABC123',
  },
  'teacher.classroom_updated': {
    classId: FIXTURE_UUID_C,
    teacherId: FIXTURE_UUID_A,
    patch: { name: '10-A Science Renamed' },
  },
  'teacher.classroom_archived': {
    classId: FIXTURE_UUID_C,
    teacherId: FIXTURE_UUID_A,
  },
  'teacher.student_note_set': {
    teacherId: FIXTURE_UUID_A,
    studentId: FIXTURE_UUID_C,
    hasNote: true,
    hasGoal: false,
  },
  'teacher.profile_updated': {
    teacherId: FIXTURE_UUID_A,
    fields: ['name'],
  },
  'teacher.submission_reviewed': {
    submissionId: FIXTURE_UUID_C,
    assignmentId: FIXTURE_UUID_A,
    studentId: FIXTURE_UUID_B,
    teacherId: FIXTURE_UUID_A,
    hasFeedback: true,
    scorePercent: 78,
    scoreOverridden: false,
  },
  'teacher.grade_entry_set': {
    teacherId: FIXTURE_UUID_A,
    classId: FIXTURE_UUID_B,
    studentId: FIXTURE_UUID_C,
    columnKey: 'math',
    columnKind: 'subject',
    score: 85,
    maxScore: 100,
    hasNotes: false,
  },
  'teacher.parent_message_sent': {
    threadId: FIXTURE_UUID_C,
    messageId: FIXTURE_UUID_A,
    teacherId: FIXTURE_UUID_A,
    guardianId: FIXTURE_UUID_B,
    studentId: FIXTURE_UUID_C,
    bodyLength: 42,
    isNewThread: true,
  },
  'parent.teacher_message_sent': {
    threadId: FIXTURE_UUID_C,
    messageId: FIXTURE_UUID_A,
    teacherId: FIXTURE_UUID_A,
    guardianId: FIXTURE_UUID_B,
    studentId: FIXTURE_UUID_C,
    bodyLength: 18,
    isNewThread: false,
  },
  'school.module_toggled': {
    moduleKey: 'ai_tutor',
    isEnabled: true,
    reason: 'pilot rollout',
  },
  'billing.invoice_paid': {
    invoiceId: FIXTURE_UUID_C,
    amountInr: 49900,
    planSlug: 'pro_monthly',
  },
  'mesh.cycle_completed': {
    cycleId: FIXTURE_UUID_C,
    decision: 'approve',
    targetMetric: 'foxy_groundedness',
    tokensSpent: 12500,
  },
};

describe('domain-event registry shape', () => {
  it('ALL_EVENT_KINDS is non-empty and unique', () => {
    expect(ALL_EVENT_KINDS.length).toBeGreaterThan(0);
    expect(new Set(ALL_EVENT_KINDS).size).toBe(ALL_EVENT_KINDS.length);
  });

  it('ALL_EVENT_KINDS matches the discriminated union exactly', () => {
    // Extract the kinds from the discriminated union's options. If a new
    // schema is added to the union without updating ALL_EVENT_KINDS (or
    // vice versa), this fails.
    const unionOptions = DomainEventSchema.options;
    const unionKinds = unionOptions
      .map((opt) => opt.shape.kind.value)
      .sort();
    const listed = [...ALL_EVENT_KINDS].sort();
    expect(listed).toEqual(unionKinds);
  });

  it('every kind follows <actor>.<verb_past> convention with a canonical actor', () => {
    for (const kind of ALL_EVENT_KINDS) {
      const parts = kind.split('.');
      expect(parts.length, `kind "${kind}" must be of the form <actor>.<verb>`).toBe(2);
      const [actor, verb] = parts;
      expect(
        CANONICAL_ACTORS.has(actor),
        `kind "${kind}" uses non-canonical actor "${actor}"; expected one of ${[...CANONICAL_ACTORS].join(', ')}`,
      ).toBe(true);
      // Verb must be lower_snake_case (verb past tense is content-level;
      // we enforce shape only).
      expect(verb, `kind "${kind}" verb must be lower_snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('VALID_PAYLOADS covers every kind in ALL_EVENT_KINDS', () => {
    // Type-level Record<DomainEventKind, ...> already enforces this at
    // compile time. The runtime assertion catches the case where a kind
    // is added to ALL_EVENT_KINDS but the test file is not updated.
    for (const kind of ALL_EVENT_KINDS) {
      expect(VALID_PAYLOADS[kind], `missing fixture for "${kind}"`).toBeDefined();
    }
  });

  it('every kind parses a minimal valid event', () => {
    for (const kind of ALL_EVENT_KINDS) {
      const candidate = {
        ...baseEnvelope,
        idempotencyKey: `fixture-${kind}`,
        kind,
        payload: VALID_PAYLOADS[kind],
      };
      const result = DomainEventSchema.safeParse(candidate);
      expect(
        result.success,
        result.success
          ? ''
          : `kind "${kind}" failed to parse: ${JSON.stringify(result.error.issues, null, 2)}`,
      ).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    const candidate = {
      ...baseEnvelope,
      kind: 'learner.invented_event',
      payload: {},
    };
    const result = DomainEventSchema.safeParse(candidate);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed envelope (missing eventId)', () => {
    const { eventId: _omit, ...envelopeWithoutId } = baseEnvelope;
    const candidate = {
      ...envelopeWithoutId,
      kind: 'learner.session_started',
      payload: VALID_PAYLOADS['learner.session_started'],
    };
    const result = DomainEventSchema.safeParse(candidate);
    expect(result.success).toBe(false);
  });

  it('isEventKind narrows correctly', () => {
    const event: DomainEvent = {
      ...baseEnvelope,
      kind: 'learner.quiz_completed',
      payload: VALID_PAYLOADS['learner.quiz_completed'],
    } as DomainEvent;

    expect(isEventKind(event, 'learner.quiz_completed')).toBe(true);
    expect(isEventKind(event, 'learner.session_started')).toBe(false);

    if (isEventKind(event, 'learner.quiz_completed')) {
      // Type-level narrowing: payload.quizSessionId must be accessible
      // without a cast. If the type guard regresses, this line stops
      // compiling.
      expect(event.payload.quizSessionId).toBe(FIXTURE_UUID_C);
    }
  });
});
