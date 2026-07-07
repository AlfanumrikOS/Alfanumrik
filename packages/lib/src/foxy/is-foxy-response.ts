/**
 * Cheap shape discriminator for `FoxyResponse`.
 *
 * Lives in `src/lib/foxy/` (not `src/components/foxy/FoxyStructuredRenderer.tsx`)
 * so callers can import the predicate without dragging KaTeX (and the
 * structured renderer's full dependency graph) into the synchronous bundle.
 * P10 (bundle budget): the /foxy page imports this synchronously to pick a
 * renderer; the heavy `FoxyStructuredRenderer` itself stays behind a
 * `next/dynamic` boundary.
 *
 * NOT a Zod parse — heavy validation belongs at the API boundary
 * (`FoxyResponseSchema`). This is a fast-path discriminator only.
 */

import type { FoxyResponse } from './schema';

export function isFoxyResponse(value: unknown): value is FoxyResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || v.title.length === 0) return false;
  if (typeof v.subject !== 'string') return false;
  if (!Array.isArray(v.blocks) || v.blocks.length === 0) return false;
  // Quick check on the first block to filter out plausible-but-wrong payloads.
  const first = v.blocks[0] as Record<string, unknown> | null | undefined;
  if (!first || typeof first !== 'object') return false;
  if (typeof first.type !== 'string') return false;
  return true;
}
