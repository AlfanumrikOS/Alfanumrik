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

// ── Inferred TS types (convenient for route handlers to import) ─────────────
export type TErrorResponse = z.infer<typeof ErrorResponse>;
export type TSuccessAck = z.infer<typeof SuccessAck>;
export type TTodayResponse = z.infer<typeof TodayResponse>;
export type TTodayQueueItem = z.infer<typeof TodayQueueItem>;
export type TEncourageRequest = z.infer<typeof EncourageRequest>;
