/**
 * src/lib/api/v2/contract.ts — the SINGLE SOURCE OF TRUTH for the /v2 API contract.
 *
 * Every /v2 request and response shape is defined here as a Zod schema and
 * registered in an `OpenAPIRegistry`. The registry feeds two generators:
 *   - `scripts/gen-openapi.mjs`  → `openapi/v2.json` (OpenAPI 3.1 doc; the
 *                                   committed contract artifact, drift-checked in CI)
 *   - `npm run gen:dart`         → `mobile/lib/api/v2/` (Dart-dio client + models)
 *
 * so web (TS) and mobile (Dart) consume the exact same contract. Change the
 * Zod schema here, regenerate, and both ends stay in lockstep.
 *
 * SINGLE-SOURCE DISCIPLINE (Wave 2.1 foundation):
 *   - These schemas MIRROR the existing /v2 route shapes (today, parent/encourage).
 *     They are the authoritative declaration going forward.
 *   - The route handlers in `src/app/api/v2/**` should import + validate against
 *     these schemas (responses) and via `validateBody()` (requests). That
 *     migration is NOT done in this wave — this file only ESTABLISHES the registry.
 *     Do not refactor the routes here; just keep these schemas in sync when a
 *     route shape legitimately changes.
 *   - `schemaVersion` is carried in payloads so clients can branch when a shape
 *     grows. Bump it in the schema when the shape changes incompatibly.
 *
 * Conventions:
 *   - All schemas get an `.openapi('Name')` ref id so they emit as named
 *     `components.schemas.*` (clean Dart class names, no inlining).
 *   - The success/error envelope helpers mirror `src/lib/api-response.ts`.
 */

import { z } from 'zod';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

// Teach Zod the `.openapi()` method. Idempotent — safe to call once at module load.
extendZodWithOpenApi(z);

// ── Shared primitives ────────────────────────────────────────────────────────
// Defined locally (NOT imported from @alfanumrik/lib/validation) so the OpenAPI codegen
// tsx loader, which does not resolve the `@/*` path alias, can load this module.
// These MUST stay in sync with `zUuid` / `zGrade` in src/lib/validation.ts.

/** Zod: valid UUID string. Mirrors `zUuid` in src/lib/validation.ts. */
const zUuid = z.string().uuid();

/** Zod: grade string "6" through "12" (P5). Mirrors `zGrade` in src/lib/validation.ts. */
const zGrade = z
  .string()
  .regex(/^(6|7|8|9|10|11|12)$/, 'Grade must be a string from "6" through "12"');

/**
 * The shared registry. Schemas + path definitions are appended below, then
 * consumed by `scripts/gen-openapi.mjs` via `OpenApiGeneratorV31`.
 */
export const registry = new OpenAPIRegistry();

// ════════════════════════════════════════════════════════════════════════
// Response envelope (mirrors src/lib/api-response.ts)
//
//   success: { success: true,  data: <T> }
//   error:   { success: false, error: string, code?: string }
//
// NOTE: `src/lib/api-response.ts` currently emits a BARE `{ data }` / `{ error }`
// envelope (no top-level `success` boolean). The /v2 standard (see
// src/app/api/v2/README.md) adopts the discriminated `success` boolean so
// mobile + web can branch on one field. The encourage route already emits
// `{ success: true }` / `{ success: false, error }`, which this matches.
// ════════════════════════════════════════════════════════════════════════

/** Generic error envelope — every /v2 route returns this shape on failure. */
export const ErrorResponse = z
  .object({
    success: z.literal(false),
    error: z.string().openapi({ example: 'Validation failed' }),
    code: z.string().optional().openapi({ example: 'VALIDATION_ERROR' }),
  })
  .openapi('ErrorResponse');

/** Bare success acknowledgement — `{ success: true }` (no data payload). */
export const SuccessAck = z
  .object({
    success: z.literal(true),
  })
  .openapi('SuccessAck');

// ════════════════════════════════════════════════════════════════════════
// GET /v2/today  — mirrors src/lib/today/types.ts
// ════════════════════════════════════════════════════════════════════════

/** Mirrors `TodayItemType` in src/lib/today/types.ts. */
export const TodayItemType = z
  .enum([
    'resume_in_progress',
    'cold_start_diagnostic',
    'srs_due',
    'revise_decayed_topic',
    'weak_topic_zpd',
    'continue_lesson',
    'weekly_dive_due',
    'monthly_synthesis_due',
    'practice_weakest',
  ])
  .openapi('TodayItemType');

/** Mirrors `TodayDeepLink` in src/lib/today/types.ts. */
export const TodayDeepLink = z
  .object({
    /** The pathname, e.g. `/quiz`, `/learn/science/3`, `/review`. */
    route: z.string().openapi({ example: '/quiz' }),
    /** Parsed querystring params; omitted entirely when the url had none. */
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .openapi('TodayDeepLink');

/** Mirrors `TodayQueueItem` in src/lib/today/types.ts. */
export const TodayQueueItem = z
  .object({
    type: TodayItemType,
    /** 1-based position; rank === 1 is the primary CTA. */
    rank: z.number().int().min(1).openapi({ example: 1 }),
    /** i18n key — `today.item.<type>.label`. */
    labelKey: z.string().openapi({ example: 'today.item.srs_due.label' }),
    /** i18n key — `today.item.<type>.subtitle`. */
    subtitleKey: z.string().openapi({ example: 'today.item.srs_due.subtitle' }),
    /** Presentation-only minutes badge. NOT a timing-model value (P1/P2). */
    estMinutes: z.number().int().min(0).openapi({ example: 5 }),
    deepLink: TodayDeepLink,
    /** Opaque icon identifier the UI maps to a glyph. */
    iconHint: z.string().openapi({ example: 'flame' }),
    /** Resolver's opaque reason string — telemetry + aria, not copy. */
    reason: z.string().openapi({ example: 'review_due_cards' }),
    /** Per-type diagnostics lifted verbatim from the source action. */
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('TodayQueueItem');

/** Mirrors `TodayResponse` in src/lib/today/types.ts. */
export const TodayResponse = z
  .object({
    schemaVersion: z.literal(1),
    /** ISO-8601 timestamp the queue was resolved at. */
    resolvedAt: z.string().openapi({ example: '2026-06-06T09:00:00.000Z' }),
    /** The single primary CTA (equals queue[0]). */
    primary: TodayQueueItem,
    /** The ordered Today queue, primary first. */
    queue: z.array(TodayQueueItem),
    /** Cheap telemetry diagnostics; clients should not depend on them. */
    meta: z
      .object({
        branch: z.string().openapi({ example: 'review_due_cards' }),
        masterySubjectCount: z.number().int().min(0).openapi({ example: 3 }),
        dueReviewCount: z.number().int().min(0).openapi({ example: 7 }),
      })
      .openapi('TodayResponseMeta'),
  })
  .openapi('TodayResponse');

// ════════════════════════════════════════════════════════════════════════
// POST /v2/parent/encourage — mirrors src/app/api/v2/parent/encourage/route.ts
//
// Request body: { student_id: uuid; message_key?: string }
//   - message_key is a CURATED preset key (see src/lib/parent/cheer-catalog.ts).
//     Free text is never accepted (P12). Absent → server default ('great_work').
// Response: { success: true }
// ════════════════════════════════════════════════════════════════════════

/** Mirrors the POST /v2/parent/encourage request body. */
export const EncourageRequest = z
  .object({
    student_id: z
      .string()
      .uuid()
      .openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    /**
     * Optional curated preset key. Validated server-side against the cheer
     * catalog; an unknown key is a 400. Absent → server default. Free text is
     * NEVER accepted (P12) — this is an enum-like key, not a message.
     */
    message_key: z.string().optional().openapi({ example: 'great_work' }),
  })
  .openapi('EncourageRequest');

// ════════════════════════════════════════════════════════════════════════
// Path registrations
//
// Both routes accept BOTH Bearer JWT (mobile) and cookie (web) auth + RBAC.
// Declared as a bearer security scheme + a cookie scheme so the generated
// Dart client knows to attach the Authorization header. (Cookie auth is
// browser-implicit; documented for completeness.)
// ════════════════════════════════════════════════════════════════════════

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Supabase access-token JWT (mobile clients).',
});

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'sb-access-token',
  description: 'Supabase session cookie (web clients).',
});

registry.registerPath({
  method: 'get',
  path: '/v2/today',
  operationId: 'getToday',
  summary: 'Today home queue',
  description:
    'Returns the ordered "what could I do today?" queue for the authenticated student as render-ready DTOs. Requires study_plan.view. 404 when ff_today_home_v1 is off.',
  tags: ['today'],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: {
      description: 'The resolved Today queue.',
      content: { 'application/json': { schema: TodayResponse } },
    },
    404: {
      description:
        'Feature flag off, or the caller has no student profile. Callers fall back to /dashboard.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/v2/parent/encourage',
  operationId: 'postParentEncourage',
  summary: 'Send a preset cheer to a linked child',
  description:
    'Parent sends a curated, preset-keyed encouragement to a linked child. Requires child.encourage and an approved guardian↔student link. Rate-limited to one cheer per (guardian, student) per 6 hours.',
  tags: ['parent'],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: EncourageRequest } },
    },
  },
  responses: {
    200: {
      description: 'Cheer sent.',
      content: { 'application/json': { schema: SuccessAck } },
    },
    400: {
      description: 'Invalid body (bad student_id or unknown message_key).',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'No parent profile, or not linked to this student.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Rate limited — already cheered within the last 6 hours.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    502: {
      description: 'Notification fan-out failed.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ════════════════════════════════════════════════════════════════════════
// Wave 2.2 — student-facing consumer endpoints.
//
// All shapes MIRROR existing domain reads / RPCs (see each route handler's
// header for the exact reuse source). The `/v2` routes are thin pass-throughs:
// no scoring / XP / anti-cheat math in any route (P1-P6 owned by the RPCs).
// ════════════════════════════════════════════════════════════════════════

// ── A) QUIZ ────────────────────────────────────────────────────────────────

/**
 * One quiz question as served by GET /v2/quiz/questions.
 * MIRRORS the `select_quiz_questions_rag` row shape used by /api/quiz GET,
 * minus `correct_answer_index` — that field MUST NOT cross the wire (P6).
 */
export const QuizQuestion = z
  .object({
    question_id: zUuid.openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    question_text: z.string().openapi({ example: 'What is 2 + 2?' }),
    question_hi: z.string().nullable().openapi({ example: '2 + 2 क्या है?' }),
    question_type: z.string().openapi({ example: 'mcq' }),
    options: z.array(z.string()).length(4).openapi({ example: ['3', '4', '5', '6'] }),
    explanation: z.string().nullable().openapi({ example: '2 + 2 = 4.' }),
    explanation_hi: z.string().nullable().openapi({ example: '2 + 2 = 4 होता है।' }),
    hint: z.string().nullable().openapi({ example: 'Count on your fingers.' }),
    difficulty: z.number().openapi({ example: 2 }),
    bloom_level: z.string().nullable().openapi({ example: 'remember' }),
    chapter_number: z.number().int().nullable().openapi({ example: 3 }),
  })
  .openapi('QuizQuestion');

/** Response for GET /v2/quiz/questions. NEVER carries correct_answer_index (P6). */
export const QuizQuestionsResponse = z
  .object({
    schemaVersion: z.literal(1),
    questions: z.array(QuizQuestion),
  })
  .openapi('QuizQuestionsResponse');

/** Request body for POST /v2/quiz/start. */
export const QuizStartRequest = z
  .object({
    studentId: zUuid.openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    questionIds: z
      .array(zUuid)
      .min(1)
      .max(50)
      .openapi({ example: ['550e8400-e29b-41d4-a716-446655440000'] }),
  })
  .openapi('QuizStartRequest');

/**
 * A server-shuffled question returned by POST /v2/quiz/start.
 * `options_displayed` is the per-session shuffled order; the shuffle_map and
 * correct index stay server-side (P6).
 */
export const QuizStartQuestion = z
  .object({
    question_id: zUuid,
    question_text: z.string(),
    question_hi: z.string().nullable(),
    question_type: z.string(),
    options_displayed: z.array(z.string()).length(4),
    explanation: z.string().nullable(),
    explanation_hi: z.string().nullable(),
    hint: z.string().nullable(),
    difficulty: z.number(),
    bloom_level: z.string().nullable(),
    chapter_number: z.number().int().nullable(),
  })
  .openapi('QuizStartQuestion');

/** Response for POST /v2/quiz/start. */
export const QuizStartResponse = z
  .object({
    schemaVersion: z.literal(1),
    session_id: zUuid,
    questions: z.array(QuizStartQuestion),
  })
  .openapi('QuizStartResponse');

/** One response in a quiz submission. MIRRORS /api/quiz/submit's responseSchema. */
export const QuizSubmitResponseItem = z
  .object({
    question_id: zUuid,
    selected_option: z.number().int().min(0).max(3).openapi({ example: 1 }),
    time_taken_seconds: z.number().int().min(0).max(3600).openapi({ example: 12 }),
  })
  .openapi('QuizSubmitResponseItem');

/**
 * A per-question displayed→canonical permutation. Each value is the canonical
 * (question_bank) option index that the displayed slot maps to. It MUST be a
 * true 4-permutation of {0,1,2,3} — exactly the four indices, no repeats. This
 * is the client's record of the shuffle it graded against; the server VERIFIES
 * it equals the server-stored `quiz_session_shuffles` snapshot (it never grades
 * against it — P1/P3). Reject non-permutations at the Zod layer (defence in
 * depth; the route also re-checks element-for-element against the server map).
 */
export const ShuffleMapEntry = z
  .array(z.number().int().min(0).max(3))
  .length(4)
  .refine(
    (arr) => new Set(arr).size === 4,
    { message: 'shuffle map entry must be a permutation of {0,1,2,3} (no repeats)' },
  )
  .openapi('ShuffleMapEntry', { example: [2, 0, 3, 1] });

/**
 * Request body for POST /v2/quiz/submit. MIRRORS /api/quiz/submit's
 * submitBodySchema, plus 5 OPTIONAL backward-compatible offline-replay fields
 * (Wave 2.5.1). When `attemptMode` is absent or `'online'`, the route behaves
 * BYTE-IDENTICALLY to today (no offline field gates fire). The RPC remains the
 * sole grading authority — NO score/correct/XP field is ever accepted here.
 */
export const QuizSubmitRequest = z
  .object({
    sessionId: zUuid,
    studentId: zUuid,
    responses: z.array(QuizSubmitResponseItem).min(1).max(50),
    totalTimeSeconds: z.number().int().min(0).max(7200).openapi({ example: 120 }),
    subject: z.string().optional().openapi({ example: 'math' }),
    grade: zGrade.optional(),
    topic: z.string().nullable().optional(),
    chapter: z.number().int().nullable().optional(),

    // ── Wave 2.5.1 offline-replay fields (ALL optional, backward-compatible) ──

    /**
     * Branch selector. Absent → `'online'` (today's path, byte-identical). When
     * `'offline_replay'` the route runs the offline gates BEFORE the RPC call.
     */
    attemptMode: z
      .enum(['online', 'offline_replay'])
      .default('online')
      .openapi({ example: 'online' }),

    /**
     * Device completion time (ISO-8601 with offset). REQUIRED when
     * attemptMode === 'offline_replay' (the route returns 400 if missing then).
     * Used ONLY for clock-skew + staleness gates and telemetry — NEVER to
     * derive attempt duration (P3 stays driven by totalTimeSeconds).
     */
    capturedAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .openapi({ example: '2026-06-06T09:00:00.000+05:30' }),

    /**
     * Device-summed attempt duration as the client recorded it. If present and
     * !== totalTimeSeconds the route returns 400 OFFLINE_TIME_INCONSISTENT.
     * This is a consistency check only — totalTimeSeconds remains the single
     * P3 timing source forwarded to the RPC.
     */
    clientCapturedTotalSeconds: z
      .number()
      .int()
      .min(0)
      .max(7200)
      .optional()
      .openapi({ example: 120 }),

    /**
     * Per-question displayed→canonical permutation the client graded against.
     * Keyed by question_id (UUID). The server VERIFIES each entry equals the
     * server-stored quiz_session_shuffles snapshot element-for-element; any
     * mismatch fails closed (422 SHUFFLE_MAP_MISMATCH). The server NEVER grades
     * against this map.
     */
    shuffleMapsClientGradedAgainst: z
      .record(zUuid, ShuffleMapEntry)
      .optional()
      .openapi({ example: { '550e8400-e29b-41d4-a716-446655440000': [2, 0, 3, 1] } }),

    /**
     * Telemetry retry counter — which drain attempt this submission is (1-based).
     * Rides ops_events for offline-sync observability; never affects grading.
     */
    drainAttempt: z.number().int().min(1).optional().openapi({ example: 1 }),
  })
  .openapi('QuizSubmitRequest');

/**
 * Response for POST /v2/quiz/submit. EVERY field is server-authoritative —
 * lifted verbatim from `submit_quiz_results_v2`. The route does NO score / XP /
 * anti-cheat math (P1-P4 owned by the RPC).
 */
export const QuizSubmitResult = z
  .object({
    schemaVersion: z.literal(1),
    session_id: zUuid.nullable(),
    score_percent: z.number().openapi({ example: 80 }),
    xp_earned: z.number().openapi({ example: 100 }),
    correct: z.number().int().openapi({ example: 8 }),
    total: z.number().int().openapi({ example: 10 }),
    flagged: z.boolean().openapi({ example: false }),
    idempotent_replay: z.boolean().openapi({ example: false }),
    marking_authenticity_path: z.string().openapi({ example: 'oracle_v2' }),
    xp_capped: z.boolean().optional().openapi({ example: false }),
    questions: z.array(z.record(z.string(), z.unknown())).openapi({ example: [] }),
  })
  .openapi('QuizSubmitResult');

// ── B) STUDENT ───────────────────────────────────────────────────────────────

/** Response for GET /v2/student/profile. P5: grade is a string. */
export const StudentProfileResponse = z
  .object({
    schemaVersion: z.literal(1),
    student_id: zUuid,
    name: z.string().nullable().openapi({ example: 'Asha' }),
    grade: z.string().nullable().openapi({ example: '9' }),
    board: z.string().nullable().openapi({ example: 'CBSE' }),
    stream: z.string().nullable().openapi({ example: 'science' }),
    plan: z.string().nullable().openapi({ example: 'free' }),
    language: z.string().nullable().openapi({ example: 'en' }),
  })
  .openapi('StudentProfileResponse');

/** A single performance-score row in the progress payload. */
export const ProgressPerformanceScore = z
  .object({
    subject: z.string().openapi({ example: 'math' }),
    overall_score: z.number().openapi({ example: 72 }),
    level_name: z.string().nullable().openapi({ example: 'Rising Star' }),
    updated_at: z.string().nullable(),
  })
  .openapi('ProgressPerformanceScore');

/** A topic-mastery row. */
export const ProgressTopicMastery = z
  .object({
    topic_id: z.string().nullable(),
    mastery_probability: z.number().openapi({ example: 0.62 }),
    consecutive_correct: z.number().int().nullable(),
    updated_at: z.string().nullable(),
  })
  .openapi('ProgressTopicMastery');

/** A knowledge-gap row. */
export const ProgressKnowledgeGap = z
  .object({
    subject: z.string().nullable(),
    topic: z.string().nullable(),
    severity: z.string().nullable().openapi({ example: 'high' }),
    mastery_probability: z.number().nullable(),
  })
  .openapi('ProgressKnowledgeGap');

/** A learning-velocity row. */
export const ProgressLearningVelocity = z
  .object({
    subject: z.string().openapi({ example: 'science' }),
    weekly_mastery_rate: z.number().nullable(),
    acceleration: z.number().nullable(),
    predicted_mastery_date: z.string().nullable(),
  })
  .openapi('ProgressLearningVelocity');

/** A decayed-topic row (mastery fading, review due). */
export const ProgressDecayTopic = z
  .object({
    topic_id: z.string().nullable(),
    subject: z.string().nullable(),
    mastery_probability: z.number().nullable(),
    next_review_at: z.string().nullable(),
  })
  .openapi('ProgressDecayTopic');

/** Response for GET /v2/student/progress. */
export const StudentProgressResponse = z
  .object({
    schemaVersion: z.literal(1),
    student_id: zUuid,
    performance_scores: z.array(ProgressPerformanceScore),
    topic_mastery: z.array(ProgressTopicMastery),
    knowledge_gaps: z.array(ProgressKnowledgeGap),
    learning_velocity: z.array(ProgressLearningVelocity),
    decay_topics: z.array(ProgressDecayTopic),
  })
  .openapi('StudentProgressResponse');

/** One ranked leaderboard entry. No PII beyond the existing leaderboard (P13). */
export const LeaderboardEntry = z
  .object({
    rank: z.number().int().openapi({ example: 1 }),
    student_id: zUuid,
    name: z.string().nullable().openapi({ example: 'Asha' }),
    total_xp: z.number().int().openapi({ example: 1450 }),
    streak: z.number().int().openapi({ example: 7 }),
    avatar_url: z.string().nullable(),
    grade: z.string().nullable().openapi({ example: '9' }),
    school: z.string().nullable(),
    city: z.string().nullable(),
  })
  .openapi('LeaderboardEntry');

/** Response for GET /v2/student/leaderboard. */
export const LeaderboardResponse = z
  .object({
    schemaVersion: z.literal(1),
    period: z.enum(['weekly', 'monthly', 'all']).openapi({ example: 'weekly' }),
    scope: z.enum(['school', 'global']).openapi({ example: 'global' }),
    entries: z.array(LeaderboardEntry),
  })
  .openapi('LeaderboardResponse');

// ── B) LEARN ─────────────────────────────────────────────────────────────────

/** A topic leaf (from curriculum_topics). */
export const CurriculumTopic = z
  .object({
    id: zUuid,
    title: z.string().nullable(),
    title_hi: z.string().nullable(),
  })
  .openapi('CurriculumTopic');

/** A chapter node, carrying its topics (from curriculum_topics). */
export const CurriculumChapter = z
  .object({
    chapter_number: z.number().int().nullable().openapi({ example: 1 }),
    title: z.string().nullable().openapi({ example: 'Number Systems' }),
    title_hi: z.string().nullable(),
    topics: z.array(CurriculumTopic),
  })
  .openapi('CurriculumChapter');

/** A subject node in the curriculum tree (from get_available_subjects). */
export const CurriculumSubject = z
  .object({
    code: z.string().openapi({ example: 'math' }),
    name: z.string().openapi({ example: 'Mathematics' }),
    name_hi: z.string().nullable().openapi({ example: 'गणित' }),
    is_locked: z.boolean().openapi({ example: false }),
    chapters: z.array(CurriculumChapter),
  })
  .openapi('CurriculumSubject');

/** Response for GET /v2/learn/curriculum. */
export const CurriculumResponse = z
  .object({
    schemaVersion: z.literal(1),
    grade: z.string().nullable().openapi({ example: '9' }),
    subjects: z.array(CurriculumSubject),
  })
  .openapi('CurriculumResponse');

/** Per-chunk source attribution for a concept read. */
export const ConceptSource = z
  .object({
    chunk_id: z.string(),
    chapter_title: z.string().nullable(),
    chunk_index: z.number().int().nullable(),
    page_number: z.number().int().nullable(),
  })
  .openapi('ConceptSource');

/** Response for GET /v2/learn/concept. Concept markdown from rag_content_chunks. */
export const ConceptResponse = z
  .object({
    schemaVersion: z.literal(1),
    subject: z.string().openapi({ example: 'science' }),
    grade: z.string().openapi({ example: '9' }),
    chapter_number: z.number().int().openapi({ example: 3 }),
    markdown: z.string().openapi({ example: '# Atoms and Molecules\n...' }),
    sources: z.array(ConceptSource),
    truncated: z.boolean().openapi({ example: false }),
    language: z.enum(['en', 'hi']).openapi({ example: 'en' }),
    fell_back_from_hindi: z.boolean().openapi({ example: false }),
  })
  .openapi('ConceptResponse');

// ════════════════════════════════════════════════════════════════════════
// Wave 2.2 path registrations
// ════════════════════════════════════════════════════════════════════════

const SECURITY: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { cookieAuth: [] },
];

registry.registerPath({
  method: 'get',
  path: '/v2/quiz/questions',
  operationId: 'getQuizQuestions',
  summary: 'Fetch quiz questions in academic scope',
  description:
    'Returns in-scope quiz questions for the authenticated student. Reuses the select_quiz_questions_rag path with subject-governance + academic-scope checks. correct_answer_index is NEVER returned (P6). 422 with { available, requested, scope } when a chapter is set and fewer than `count` in-scope questions exist. Requires quiz.attempt.',
  tags: ['quiz'],
  security: SECURITY,
  request: {
    query: z.object({
      subject: z.string().openapi({ example: 'math' }),
      grade: zGrade,
      chapter: z.number().int().positive().optional(),
      // Allowed values are 5 | 10 | 15 | 20 (validated in the route). Declared as
      // a plain bounded int here so the dart-dio generator doesn't choke on a
      // composed (oneOf) query-parameter schema.
      count: z.number().int().min(5).max(20).openapi({ example: 10 }),
      difficulty: z.enum(['easy', 'medium', 'hard', 'mixed', 'progressive']).optional(),
      mode: z.enum(['practice', 'cognitive', 'exam']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'In-scope quiz questions (no correct_answer_index).',
      content: { 'application/json': { schema: QuizQuestionsResponse } },
    },
    400: { description: 'Invalid query params.', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'Missing quiz.attempt, grade mismatch, or subject not allowed.', content: { 'application/json': { schema: ErrorResponse } } },
    422: { description: 'Insufficient questions in scope.', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Unexpected server error.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/v2/quiz/start',
  operationId: 'postQuizStart',
  summary: 'Start a server-shuffled quiz session',
  description:
    'Creates a quiz session via the start_quiz_session RPC (server-owned shuffle authority). Returns the per-session shuffled options; the shuffle_map and correct index stay server-side (P6). studentId is cross-checked against the JWT (403 on mismatch). Requires quiz.attempt.',
  tags: ['quiz'],
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: QuizStartRequest } } } },
  responses: {
    200: { description: 'Quiz session created.', content: { 'application/json': { schema: QuizStartResponse } } },
    400: { description: 'Invalid body.', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'Missing quiz.attempt or studentId mismatch.', content: { 'application/json': { schema: ErrorResponse } } },
    503: { description: 'start_quiz_session RPC failed.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/v2/quiz/submit',
  operationId: 'postQuizSubmit',
  summary: 'Submit a quiz for server-authoritative grading',
  description:
    'Thin pass-through to the submit_quiz_results_v2 RPC, which owns P1 scoring, P2 XP + 200/day cap, all 3 P3 anti-cheat checks, and P4 atomicity. The route does NO score / XP / anti-cheat math — it forwards inputs and returns the RPC result verbatim. Requires an Idempotency-Key (UUID) header and quiz.attempt. studentId is cross-checked against the JWT (403 on mismatch). When attemptMode === offline_replay the route runs offline gates BEFORE the RPC: capturedAt required (400 OFFLINE_CAPTURED_AT_REQUIRED), clock-skew (422 REPLAY_CLOCK_INVALID), staleness >168h (422 REPLAY_TOO_STALE), clientCapturedTotalSeconds mismatch (400 OFFLINE_TIME_INCONSISTENT), and shuffle-map verification against the server snapshot (422 SHUFFLE_MAP_MISMATCH). Online submissions are byte-identical to today — no offline gate fires.',
  tags: ['quiz'],
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: QuizSubmitRequest } } } },
  responses: {
    200: { description: 'Graded result (server-authoritative).', content: { 'application/json': { schema: QuizSubmitResult } } },
    400: { description: 'Missing/invalid Idempotency-Key or body; missing capturedAt or clientCapturedTotalSeconds mismatch on an offline replay.', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'Missing quiz.attempt or studentId mismatch.', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'session_not_started — client should restart the quiz.', content: { 'application/json': { schema: ErrorResponse } } },
    422: { description: 'Offline replay rejected: REPLAY_CLOCK_INVALID, REPLAY_TOO_STALE, or SHUFFLE_MAP_MISMATCH.', content: { 'application/json': { schema: ErrorResponse } } },
    503: { description: 'Transient scoring failure — retry with same Idempotency-Key.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v2/student/profile',
  operationId: 'getStudentProfile',
  summary: 'Authenticated student profile',
  description:
    'Returns the authenticated student\'s profile (name, grade(string,P5), board, stream, plan, language). Reuses the identity profile read. Requires profile.view_own.',
  tags: ['student'],
  security: SECURITY,
  responses: {
    200: { description: 'Student profile.', content: { 'application/json': { schema: StudentProfileResponse } } },
    404: { description: 'No student profile for this account.', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Unexpected server error.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v2/student/progress',
  operationId: 'getStudentProgress',
  summary: 'Authenticated student progress',
  description:
    'Returns the structured progress payload (performance_scores, topic_mastery, knowledge_gaps, learning_velocity, decay_topics) the web /progress page reads. RLS-safe. Requires progress.view_own.',
  tags: ['student'],
  security: SECURITY,
  responses: {
    200: { description: 'Progress payload.', content: { 'application/json': { schema: StudentProgressResponse } } },
    404: { description: 'No student profile for this account.', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Unexpected server error.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v2/student/leaderboard',
  operationId: 'getStudentLeaderboard',
  summary: 'XP leaderboard',
  description:
    'Returns ranked leaderboard entries via the get_leaderboard RPC the web /leaderboard page uses. No PII beyond what the existing leaderboard exposes (P13). Requires progress.view_own.',
  tags: ['student'],
  security: SECURITY,
  request: {
    query: z.object({
      period: z.enum(['weekly', 'monthly', 'all']).optional(),
      scope: z.enum(['school', 'global']).optional(),
    }),
  },
  responses: {
    200: { description: 'Ranked leaderboard.', content: { 'application/json': { schema: LeaderboardResponse } } },
    500: { description: 'Unexpected server error.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v2/learn/curriculum',
  operationId: 'getLearnCurriculum',
  summary: 'Curriculum tree (subjects → chapters → topics)',
  description:
    'Returns the plan-gated curriculum tree the mobile Learn screen needs. Reuses get_available_subjects (plan/grade/stream gating) + curriculum_topics. Requires study_plan.view.',
  tags: ['learn'],
  security: SECURITY,
  request: { query: z.object({ subject: z.string().optional() }) },
  responses: {
    200: { description: 'Curriculum tree.', content: { 'application/json': { schema: CurriculumResponse } } },
    404: { description: 'No student profile for this account.', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Unexpected server error.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v2/learn/concept',
  operationId: 'getLearnConcept',
  summary: 'Concept content for a subject + chapter',
  description:
    'Returns the ordered NCERT chapter prose (markdown + source attribution) for a subject + chapter. Reuses fetchChapterContent (rag_content_chunks read used by /learn). Requires study_plan.view.',
  tags: ['learn'],
  security: SECURITY,
  request: {
    query: z.object({
      subject: z.string().openapi({ example: 'science' }),
      grade: zGrade,
      chapter: z.number().int().positive().openapi({ example: 3 }),
    }),
  },
  responses: {
    200: { description: 'Concept content.', content: { 'application/json': { schema: ConceptResponse } } },
    400: { description: 'Invalid query params.', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'No content for this chapter.', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Unexpected server error.', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ════════════════════════════════════════════════════════════════════════
// Wave 2.4 — parent-facing consumer endpoints (mobile parent screen parity).
//
// Both reuse EXISTING parent data sources (no new aggregation):
//   - GET /v2/parent/children → relationship domain listChildrenForGuardian()
//     (the same guardian_student_links ∩ students read the web child-selector
//     uses, status IN active/approved).
//   - GET /v2/parent/glance   → the parent-portal Edge Function `get_child_dashboard`
//     action (the SAME payload ParentGlanceHome consumes). The route shapes the
//     Edge Function output into Snapshot + Moments + weeklyActivity.
//
// P5: grade is a string. P13: only parent-entitled child fields (name/grade) —
// no email / phone / other PII.
// ════════════════════════════════════════════════════════════════════════

/** One linked child in GET /v2/parent/children. P13: name + grade only — no PII. */
export const ParentChild = z
  .object({
    student_id: zUuid.openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    name: z.string().nullable().openapi({ example: 'Asha' }),
    // P5: grade is a string "6"–"12" (nullable when the profile has no grade yet).
    grade: z.string().nullable().openapi({ example: '9' }),
    board: z.string().nullable().optional().openapi({ example: 'CBSE' }),
    last_active_at: z.string().nullable().optional().openapi({ example: '2026-06-06T09:00:00.000Z' }),
  })
  .openapi('ParentChild');

/** Response for GET /v2/parent/children — the guardian's linked children. */
export const ParentChildrenResponse = z
  .object({
    schemaVersion: z.literal(1),
    children: z.array(ParentChild),
  })
  .openapi('ParentChildrenResponse');

/** The selected child's identity header in the glance payload. P5: grade string. */
export const ParentGlanceChild = z
  .object({
    student_id: zUuid,
    name: z.string().nullable().openapi({ example: 'Asha' }),
    grade: z.string().nullable().openapi({ example: '9' }),
  })
  .openapi('ParentGlanceChild');

/**
 * The weekly snapshot block. MIRRORS the `get_child_dashboard` stats the web
 * ParentGlanceHome reads (xp/streak/accuracy/quizzes/minutes/avg_score) plus the
 * derived weekly session count. All numbers come verbatim from the Edge Function.
 */
export const ParentGlanceSnapshot = z
  .object({
    sessions_this_week: z.number().int().min(0).nullable().openapi({ example: 4 }),
    streak_days: z.number().int().min(0).nullable().openapi({ example: 7 }),
    accuracy: z.number().nullable().optional().openapi({ example: 72 }),
    avg_score: z.number().nullable().optional().openapi({ example: 68 }),
    time_minutes: z.number().nullable().optional().openapi({ example: 120 }),
    xp: z.number().nullable().optional().openapi({ example: 1450 }),
    total_quizzes: z.number().nullable().optional().openapi({ example: 23 }),
    total_chats: z.number().nullable().optional().openapi({ example: 11 }),
  })
  .openapi('ParentGlanceSnapshot');

/**
 * The Moments block — short parent-readable feed derived from the SAME existing
 * `get_child_dashboard` fields (weekSummary / streak / bktMastery / insights)
 * the web ParentGlanceHome derives its moments from. Plain strings; bilingual
 * rendering is the client's job (P7) — the server sends English source lines.
 */
export const ParentGlanceMoments = z
  .object({
    highlights: z.array(z.string()).openapi({ example: ['Completed 4 quizzes this week.'] }),
    concerns: z.array(z.string()).openapi({ example: [] }),
    suggestion: z.string().nullable().optional().openapi({ example: 'A short daily session keeps the streak alive.' }),
  })
  .openapi('ParentGlanceMoments');

/** One day in the weekly activity strip (from the Edge Function `dailyActivity`). */
export const ParentGlanceWeeklyDay = z
  .object({
    label: z.string().openapi({ example: 'Mon' }),
    active: z.boolean().openapi({ example: true }),
    quizzes: z.number().int().min(0).openapi({ example: 2 }),
  })
  .openapi('ParentGlanceWeeklyDay');

/** Response for GET /v2/parent/glance — one linked child's at-a-glance view. */
export const ParentGlanceResponse = z
  .object({
    schemaVersion: z.literal(1),
    child: ParentGlanceChild,
    snapshot: ParentGlanceSnapshot,
    moments: ParentGlanceMoments,
    weeklyActivity: z.array(ParentGlanceWeeklyDay).optional(),
  })
  .openapi('ParentGlanceResponse');

registry.registerPath({
  method: 'get',
  path: '/v2/parent/children',
  operationId: 'getParentChildren',
  summary: "List the authenticated guardian's linked children",
  description:
    "Returns the children linked to the authenticated guardian (guardian_student_links status IN active/approved, joined to students). Reuses the relationship domain listChildrenForGuardian read. P13: only name + grade(string,P5) are returned — no email/phone. Requires child.view_progress.",
  tags: ['parent'],
  security: SECURITY,
  responses: {
    200: {
      description: 'The linked children.',
      content: { 'application/json': { schema: ParentChildrenResponse } },
    },
    403: {
      description: 'No guardian profile for this account.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v2/parent/glance',
  operationId: 'getParentGlance',
  summary: 'At-a-glance view for one linked child',
  description:
    "Returns the Snapshot + Moments glance for one linked child (mirrors the web ParentGlanceHome). Reuses the parent-portal Edge Function `get_child_dashboard` payload — no new aggregation. Requires child.view_progress AND an approved guardian↔student link (403 otherwise). P13: only the parent-entitled child data.",
  tags: ['parent'],
  security: SECURITY,
  request: {
    query: z.object({
      student_id: zUuid.openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    }),
  },
  responses: {
    200: {
      description: 'The child glance payload.',
      content: { 'application/json': { schema: ParentGlanceResponse } },
    },
    400: {
      description: 'Missing or invalid student_id.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'No guardian profile, or not linked to this student.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: 'No data available for this child.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    502: {
      description: 'The parent-portal data source failed.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ── Inferred TS types (convenient for route handlers to import) ─────────────
export type TErrorResponse = z.infer<typeof ErrorResponse>;
export type TSuccessAck = z.infer<typeof SuccessAck>;
export type TTodayResponse = z.infer<typeof TodayResponse>;
export type TTodayQueueItem = z.infer<typeof TodayQueueItem>;
export type TEncourageRequest = z.infer<typeof EncourageRequest>;

// Wave 2.2 inferred types.
export type TQuizQuestion = z.infer<typeof QuizQuestion>;
export type TQuizQuestionsResponse = z.infer<typeof QuizQuestionsResponse>;
export type TQuizStartRequest = z.infer<typeof QuizStartRequest>;
export type TQuizStartResponse = z.infer<typeof QuizStartResponse>;
export type TQuizSubmitRequest = z.infer<typeof QuizSubmitRequest>;
export type TQuizSubmitResult = z.infer<typeof QuizSubmitResult>;
export type TStudentProfileResponse = z.infer<typeof StudentProfileResponse>;
export type TStudentProgressResponse = z.infer<typeof StudentProgressResponse>;
export type TLeaderboardResponse = z.infer<typeof LeaderboardResponse>;
export type TCurriculumResponse = z.infer<typeof CurriculumResponse>;
export type TConceptResponse = z.infer<typeof ConceptResponse>;

// Wave 2.4 inferred types.
export type TParentChild = z.infer<typeof ParentChild>;
export type TParentChildrenResponse = z.infer<typeof ParentChildrenResponse>;
export type TParentGlanceResponse = z.infer<typeof ParentGlanceResponse>;
