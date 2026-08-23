/** @license Apache-2.0 */
/**
 * Phase A.2: Dimension-level Foxy feedback request schema.
 *
 * Zod schema for POST /api/foxy/feedback/dimension body validation.
 * Mirrors the shape of the existing /api/foxy/feedback route but adds
 * the `dimension` field.
 *
 * Note: the route itself uses manual validation (matching /api/foxy/feedback),
 * so this schema is available for tests + reuse but is NOT called from the route.
 */

import { z } from 'zod';

/** Allowed dimension values — mirrors the CHECK constraint in the migration. */
export const ALLOWED_DIMENSIONS = ['accuracy', 'clarity', 'helpfulness', 'scope'] as const;

export type DimensionValue = (typeof ALLOWED_DIMENSIONS)[number];

/**
 * Validated body shape for /api/foxy/feedback/dimension.
 *
 * messageId:    uuid of the Foxy assistant message being rated (required).
 * dimension:    which pedagogical dimension is being rated (required, closed enum).
 * isUp:         true = 👍 on this dimension, false = 👎 (required).
 * reason:       optional free-text explanation (capped at 500 chars server-side).
 */
export const DimensionFeedbackRequestSchema = z.object({
  messageId: z.string().uuid('messageId must be a valid UUID'),
  dimension: z.enum(['accuracy', 'clarity', 'helpfulness', 'scope']),
  isUp: z.boolean(),
  reason: z.string().optional(),
});

export type DimensionFeedbackRequest = z.infer<typeof DimensionFeedbackRequestSchema>;

/**
 * Response shape for /api/foxy/feedback/dimension (success case).
 */
export interface DimensionFeedbackResponse {
  feedbackId: string;
  coachModeUsed: string | null;
}
