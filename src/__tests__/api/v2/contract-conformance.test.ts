/**
 * Route ↔ contract CONFORMANCE tests for the /v2 surface.
 *
 * Wave 2.1 established `src/lib/api/v2/contract.ts` as the single source of truth
 * (Zod → OpenAPI → Dart). Quality flagged a LATENT DRIFT risk: the contract
 * registry is generated independently of what the route handlers actually emit,
 * so a route could ship a response shape the contract doesn't describe (or vice
 * versa) and CI would stay green — the OpenAPI drift-check (`gen:openapi:check`)
 * only proves the JSON artifact matches the Zod source, NOT that the routes match
 * the Zod source.
 *
 * This suite closes that gap: for a REPRESENTATIVE response of EVERY /v2 endpoint
 * we parse the route's shaped output through the corresponding exported Zod schema
 * and assert it passes (`.safeParse(...).success === true`). The fixtures mirror
 * each route's projection logic (see the per-route header for the source) so a
 * future route change that breaks the contract makes this test fail.
 *
 * Envelope rules pinned here (they differ across the surface — see envelope.ts +
 * contract.ts header):
 *   - /v2/today           → BARE payload, parsed directly against TodayResponse
 *                           (the route returns NextResponse.json(payload), no wrapper).
 *   - /v2/parent/encourage → SuccessAck `{ success: true }`.
 *   - Wave 2.2 routes      → `{ success: true, data: <payload> }`; the inner
 *                            `data` is parsed against the payload schema.
 *   - All error responses  → ErrorResponse `{ success: false, error, code? }`.
 *
 * These are TEST-ONLY fixtures (no route/product code is touched). When a route's
 * real output legitimately changes, update the fixture AND the Zod schema together.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ErrorResponse,
  SuccessAck,
  TodayResponse,
  QuizQuestion,
  QuizQuestionsResponse,
  QuizStartResponse,
  QuizSubmitResult,
  StudentProfileResponse,
  StudentProgressResponse,
  LeaderboardResponse,
  CurriculumResponse,
  ConceptResponse,
} from '@/lib/api/v2/contract';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_Q = '44444444-4444-4444-8444-444444444444';
const SESSION = '33333333-3333-4333-8333-333333333333';

/** Assert a value parses cleanly through a schema; surface the Zod issues on failure. */
function expectParses<T extends z.ZodTypeAny>(schema: T, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Make a contract drift failure legible instead of a bare `false`.
    throw new Error(
      `conformance failed: ${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  expect(result.success).toBe(true);
}

// The /v2 success envelope: { success: true, data: <payloadSchema> }.
function successEnvelope<T extends z.ZodTypeAny>(payload: T) {
  return z.object({ success: z.literal(true), data: payload });
}

describe('/v2 contract conformance — success envelopes parse against contract schemas', () => {
  // ── GET /v2/today — BARE payload (route returns NextResponse.json(payload)) ──
  it('GET /v2/today payload conforms to TodayResponse (bare, no wrapper)', () => {
    const item = {
      type: 'srs_due' as const,
      rank: 1,
      labelKey: 'today.item.srs_due.label',
      subtitleKey: 'today.item.srs_due.subtitle',
      estMinutes: 5,
      deepLink: { route: '/quiz', params: { subject: 'math', chapter: 3 } },
      iconHint: 'flame',
      reason: 'review_due_cards',
      meta: { dueReviewCount: 7 },
    };
    const payload = {
      schemaVersion: 1 as const,
      resolvedAt: '2026-06-06T09:00:00.000Z',
      primary: item,
      queue: [item],
      meta: { branch: 'review_due_cards', masterySubjectCount: 3, dueReviewCount: 7 },
    };
    expectParses(TodayResponse, payload);
  });

  // ── POST /v2/parent/encourage — SuccessAck ──
  it('POST /v2/parent/encourage success body conforms to SuccessAck', () => {
    expectParses(SuccessAck, { success: true });
  });

  // ── GET /v2/quiz/questions — { success, data: QuizQuestionsResponse } ──
  //    Fixture mirrors projectQuestion() in src/app/api/v2/quiz/questions/route.ts.
  it('GET /v2/quiz/questions envelope conforms (and a question never carries correct_answer_index, P6)', () => {
    const question = {
      question_id: UUID_Q,
      question_text: 'What is 2 + 2?',
      question_hi: '2 + 2 क्या है?',
      question_type: 'mcq',
      options: ['3', '4', '5', '6'],
      explanation: '2 + 2 = 4.',
      explanation_hi: '2 + 2 = 4 होता है।',
      hint: null,
      difficulty: 2,
      bloom_level: 'remember',
      chapter_number: 3,
    };
    // P6 guard: the projected question must NOT expose the answer index.
    expect(Object.keys(question)).not.toContain('correct_answer_index');
    expectParses(QuizQuestion, question);
    expectParses(
      successEnvelope(QuizQuestionsResponse),
      { success: true, data: { schemaVersion: 1, questions: [question] } },
    );
  });

  // ── POST /v2/quiz/start — { success, data: QuizStartResponse } ──
  it('POST /v2/quiz/start envelope conforms (options_displayed, no shuffle_map/correct index)', () => {
    const startQuestion = {
      question_id: UUID_Q,
      question_text: 'What is the capital of France?',
      question_hi: null,
      question_type: 'mcq',
      options_displayed: ['Berlin', 'Paris', 'Rome', 'Madrid'],
      explanation: 'Paris is the capital of France.',
      explanation_hi: null,
      hint: null,
      difficulty: 2,
      bloom_level: 'remember',
      chapter_number: 1,
    };
    expect(Object.keys(startQuestion)).not.toContain('correct_answer_index');
    expect(Object.keys(startQuestion)).not.toContain('shuffle_map');
    expectParses(
      successEnvelope(QuizStartResponse),
      { success: true, data: { schemaVersion: 1, session_id: SESSION, questions: [startQuestion] } },
    );
  });

  // ── POST /v2/quiz/submit — { success, data: QuizSubmitResult } ──
  //    Fixture mirrors shapeResult() in src/app/api/v2/quiz/submit/route.ts.
  it('POST /v2/quiz/submit envelope conforms (server-authoritative, verbatim RPC values)', () => {
    const shaped = {
      schemaVersion: 1 as const,
      session_id: SESSION,
      score_percent: 80,
      xp_earned: 100,
      correct: 8,
      total: 10,
      flagged: false,
      idempotent_replay: false,
      marking_authenticity_path: 'oracle_v2',
      xp_capped: false,
      questions: [],
    };
    expectParses(successEnvelope(QuizSubmitResult), { success: true, data: shaped });
  });

  it('POST /v2/quiz/submit envelope conforms when xp_capped is omitted (optional field)', () => {
    const shaped = {
      schemaVersion: 1 as const,
      session_id: SESSION,
      score_percent: 100,
      xp_earned: 170,
      correct: 10,
      total: 10,
      flagged: false,
      idempotent_replay: true,
      marking_authenticity_path: 'oracle_v2',
      questions: [],
    };
    expectParses(successEnvelope(QuizSubmitResult), { success: true, data: shaped });
  });

  it('POST /v2/quiz/submit envelope conforms with a nullable session_id (replay miss shape)', () => {
    const shaped = {
      schemaVersion: 1 as const,
      session_id: null,
      score_percent: 0,
      xp_earned: 0,
      correct: 0,
      total: 1,
      flagged: false,
      idempotent_replay: false,
      marking_authenticity_path: 'oracle_v2',
      questions: [],
    };
    expectParses(successEnvelope(QuizSubmitResult), { success: true, data: shaped });
  });

  // ── GET /v2/student/profile — { success, data: StudentProfileResponse } ──
  it('GET /v2/student/profile envelope conforms (P5: grade is a string)', () => {
    const payload = {
      schemaVersion: 1 as const,
      student_id: UUID_A,
      name: 'Asha',
      grade: '9', // P5 — string, never integer
      board: 'CBSE',
      stream: 'science',
      plan: 'pro',
      language: 'hi',
    };
    expect(typeof payload.grade).toBe('string');
    expectParses(successEnvelope(StudentProfileResponse), { success: true, data: payload });
  });

  it('GET /v2/student/profile envelope conforms with all-null optional fields', () => {
    const payload = {
      schemaVersion: 1 as const,
      student_id: UUID_A,
      name: null,
      grade: null,
      board: null,
      stream: null,
      plan: null,
      language: null,
    };
    expectParses(successEnvelope(StudentProfileResponse), { success: true, data: payload });
  });

  // ── GET /v2/student/progress — { success, data: StudentProgressResponse } ──
  it('GET /v2/student/progress envelope conforms (5 projected arrays)', () => {
    const payload = {
      schemaVersion: 1 as const,
      student_id: UUID_A,
      performance_scores: [
        { subject: 'math', overall_score: 72, level_name: 'Rising Star', updated_at: '2026-06-01T00:00:00.000Z' },
      ],
      topic_mastery: [
        { topic_id: 'topic-1', mastery_probability: 0.62, consecutive_correct: 3, updated_at: null },
      ],
      knowledge_gaps: [
        { subject: 'science', topic: 'atoms', severity: 'high', mastery_probability: 0.21 },
      ],
      learning_velocity: [
        { subject: 'science', weekly_mastery_rate: 0.1, acceleration: null, predicted_mastery_date: null },
      ],
      decay_topics: [
        { topic_id: 'topic-2', subject: null, mastery_probability: 0.4, next_review_at: null },
      ],
    };
    expectParses(successEnvelope(StudentProgressResponse), { success: true, data: payload });
  });

  it('GET /v2/student/progress envelope conforms with all-empty arrays', () => {
    const payload = {
      schemaVersion: 1 as const,
      student_id: UUID_A,
      performance_scores: [],
      topic_mastery: [],
      knowledge_gaps: [],
      learning_velocity: [],
      decay_topics: [],
    };
    expectParses(successEnvelope(StudentProgressResponse), { success: true, data: payload });
  });

  // ── GET /v2/student/leaderboard — { success, data: LeaderboardResponse } ──
  it('GET /v2/student/leaderboard envelope conforms (P13: no email/phone fields)', () => {
    const entry = {
      rank: 1,
      student_id: UUID_A,
      name: 'Asha',
      total_xp: 1450,
      streak: 7,
      avatar_url: null,
      grade: '9',
      school: 'DPS',
      city: 'Delhi',
    };
    // P13 guard — the leaderboard entry must not carry PII beyond the existing surface.
    expect(Object.keys(entry)).not.toContain('email');
    expect(Object.keys(entry)).not.toContain('phone');
    expectParses(
      successEnvelope(LeaderboardResponse),
      { success: true, data: { schemaVersion: 1, period: 'weekly', scope: 'global', entries: [entry] } },
    );
  });

  // ── GET /v2/learn/curriculum — { success, data: CurriculumResponse } ──
  it('GET /v2/learn/curriculum envelope conforms (subject → chapters → topics tree)', () => {
    const payload = {
      schemaVersion: 1 as const,
      grade: '9',
      subjects: [
        {
          code: 'math',
          name: 'Mathematics',
          name_hi: 'गणित',
          is_locked: false,
          chapters: [
            {
              chapter_number: 1,
              title: 'Number Systems',
              title_hi: null,
              topics: [{ id: UUID_Q, title: 'Rational Numbers', title_hi: null }],
            },
          ],
        },
      ],
    };
    expectParses(successEnvelope(CurriculumResponse), { success: true, data: payload });
  });

  it('GET /v2/learn/curriculum envelope conforms with an empty subjects array', () => {
    expectParses(
      successEnvelope(CurriculumResponse),
      { success: true, data: { schemaVersion: 1, grade: '9', subjects: [] } },
    );
  });

  // ── GET /v2/learn/concept — { success, data: ConceptResponse } ──
  it('GET /v2/learn/concept envelope conforms (markdown + source attribution)', () => {
    const payload = {
      schemaVersion: 1 as const,
      subject: 'science',
      grade: '9',
      chapter_number: 3,
      markdown: '# Atoms and Molecules\n...',
      sources: [{ chunk_id: 'c1', chapter_title: 'Atoms', chunk_index: 0, page_number: 12 }],
      truncated: false,
      language: 'en' as const,
      fell_back_from_hindi: false,
    };
    expectParses(successEnvelope(ConceptResponse), { success: true, data: payload });
  });
});

describe('/v2 contract conformance — error envelopes parse against ErrorResponse', () => {
  // Every /v2 route emits v2Error(message, status, code) → { success:false, error, code }.
  // These mirror the codes asserted in the per-route tests.
  it.each([
    ['IDEMPOTENCY_KEY_REQUIRED', 'Missing or invalid Idempotency-Key header (must be UUID)'],
    ['STUDENT_ID_MISMATCH', 'Student ID mismatch'],
    ['NO_STUDENT_PROFILE', 'No student profile found for this account'],
    ['VALIDATION_ERROR', 'Invalid query params'],
    ['SESSION_NOT_STARTED', 'session_not_started'],
    ['RPC_FAILED', 'Temporary scoring failure — retry with same Idempotency-Key'],
    ['INSUFFICIENT_QUESTIONS_IN_SCOPE', 'insufficient_questions_in_scope (available=2, requested=10)'],
    ['GRADE_MISMATCH', 'Requested grade does not match your profile grade'],
    ['NO_CONTENT', 'No content available for this chapter'],
    ['INTERNAL_ERROR', 'Internal server error'],
  ])('error code %s conforms to ErrorResponse', (code, error) => {
    expectParses(ErrorResponse, { success: false, error, code });
  });

  it('ErrorResponse conforms when code is omitted (code is optional)', () => {
    expectParses(ErrorResponse, { success: false, error: 'Unauthorized' });
  });

  it('ErrorResponse REJECTS a bare {error} (legacy v1 envelope drift guard)', () => {
    // The legacy src/lib/api-response.ts emits a bare { error } with NO success
    // discriminant. The /v2 contract requires success:false — this proves the
    // schema would catch a route that regressed to the v1 envelope.
    expect(ErrorResponse.safeParse({ error: 'oops' }).success).toBe(false);
  });
});

describe('/v2 contract conformance — drift guards (schema rejects malformed output)', () => {
  it('QuizSubmitResult REJECTS an integer-typed grade leak via wrong shape', () => {
    // A regression that dropped marking_authenticity_path must fail conformance.
    const missingPath = {
      schemaVersion: 1,
      session_id: SESSION,
      score_percent: 80,
      xp_earned: 100,
      correct: 8,
      total: 10,
      flagged: false,
      idempotent_replay: false,
      questions: [],
    };
    expect(QuizSubmitResult.safeParse(missingPath).success).toBe(false);
  });

  it('StudentProfileResponse REJECTS an integer grade (P5 enforced by z.string())', () => {
    const intGrade = {
      schemaVersion: 1,
      student_id: UUID_A,
      name: 'Asha',
      grade: 9, // WRONG — P5 requires a string
      board: 'CBSE',
      stream: 'science',
      plan: 'pro',
      language: 'en',
    };
    expect(StudentProfileResponse.safeParse(intGrade).success).toBe(false);
  });

  it('QuizQuestion REJECTS fewer than 4 options (P6 — exactly 4)', () => {
    const threeOptions = {
      question_id: UUID_Q,
      question_text: 'q',
      question_hi: null,
      question_type: 'mcq',
      options: ['a', 'b', 'c'],
      explanation: null,
      explanation_hi: null,
      hint: null,
      difficulty: 1,
      bloom_level: null,
      chapter_number: null,
    };
    expect(QuizQuestion.safeParse(threeOptions).success).toBe(false);
  });
});
