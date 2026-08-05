/**
 * /api/foxy — D8 explanation-format identification (Foxy North-Star Phase 2).
 *
 * Pure classifier over the validated structured FoxyResponse block list:
 * collapses the block types actually served this turn into ONE coarse
 * `formatUsed` label so per-turn telemetry (the existing `foxy.chat`
 * audit-log detail writes in route.ts + _lib/streaming.ts) can feed the
 * Phase-2b explanation-format preference aggregator. Additive field on an
 * EXISTING sink — no new table, no new write.
 *
 * P13: the label is a closed enum derived from block TYPES only — it never
 * carries content, topic strings, or student identifiers.
 *
 * Precedence (most pedagogically distinctive first):
 *   practice  — any mcq/question block (the turn drilled the student)
 *   diagram   — any diagram/mermaid/map visual block
 *   steps     — any step/vertical_math worked-sequence block
 *   example   — any example block
 *   paragraph — everything else (prose-shaped: paragraph/definition/answer/
 *               exam_tip/math/code)
 * `null` — no validated structured payload this turn (legacy/kill-switch/
 * malformed-upstream paths); the aggregator treats null as "unknown", never
 * as a paragraph preference signal.
 */

export type ExplanationFormat =
  | 'practice'
  | 'diagram'
  | 'steps'
  | 'example'
  | 'paragraph';

/** Minimal structural view of a FoxyResponse — avoids importing the full zod schema. */
interface StructuredLike {
  blocks?: Array<{ type?: string | null } | null> | null;
}

const PRACTICE_TYPES = new Set(['mcq', 'question']);
const DIAGRAM_TYPES = new Set(['diagram', 'mermaid', 'map']);
const STEP_TYPES = new Set(['step', 'vertical_math']);

export function identifyExplanationFormat(
  structured: StructuredLike | null | undefined,
): ExplanationFormat | null {
  const blocks = structured?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const types = new Set(
    blocks
      .map((b) => (b && typeof b.type === 'string' ? b.type : null))
      .filter((t): t is string => t !== null),
  );
  if (types.size === 0) return null;
  for (const t of types) if (PRACTICE_TYPES.has(t)) return 'practice';
  for (const t of types) if (DIAGRAM_TYPES.has(t)) return 'diagram';
  for (const t of types) if (STEP_TYPES.has(t)) return 'steps';
  if (types.has('example')) return 'example';
  return 'paragraph';
}
