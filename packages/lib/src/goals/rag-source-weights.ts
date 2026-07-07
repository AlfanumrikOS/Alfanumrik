/**
 * Goal-Aware RAG Source Weights (Phase 4 of Goal-Adaptive Learning Layers)
 *
 * Pure function module that computes a re-rank multiplier for a given
 * (goal, chunk source, chunk exam_relevance) triple. Used by the
 * retrieval pipeline to boost goal-aligned NCERT/PYQ/JEE/NEET/Olympiad
 * chunks above generic ones AFTER Voyage rerank-2 + RRF have already
 * scored them by semantic similarity.
 *
 * Owner: assessment (rules) + ai-engineer (consumer)
 * Founder constraint: this module ships dormant. Caller (ncert-retriever)
 * gates the multiplication behind ff_goal_aware_rag. When the flag is off,
 * weights are never read and re-ranking is byte-identical to today's
 * RRF order.
 *
 * Pure: zero IO, zero React, zero side effects. All weights are author-
 * defined constants.
 *
 * Schema reference (already in baseline):
 *   rag_content_chunks.source         text DEFAULT 'legacy'
 *   rag_content_chunks.exam_relevance text[] DEFAULT '{CBSE}'
 *
 * The module is FORWARD-COMPATIBLE with future content packs (JEE archive,
 * NEET archive, Olympiad). When those packs are ingested with appropriate
 * source/exam_relevance values, the weights here automatically apply.
 *
 * Today's effective behavior (with current content):
 *   - board_topper: PYQ-tagged chunks (source containing 'pyq' or
 *     exam_relevance containing 'CBSE_BOARD') get a 1.5x boost.
 *   - All other goals: weight = 1.0 (no-op until corpus expands).
 */

import type { GoalCode } from './goal-profile';

export interface ChunkRankMetadata {
  /** Free-form source tag from rag_content_chunks.source. Examples: 'ncert_2025', 'legacy', 'pyq', 'jee_archive', 'neet_archive', 'olympiad'. */
  source?: string | null;
  /** Free-form exam-relevance tags from rag_content_chunks.exam_relevance. Examples: 'CBSE', 'CBSE_BOARD', 'JEE', 'NEET', 'OLYMPIAD'. */
  examRelevance?: ReadonlyArray<string> | null;
}

const NEUTRAL = 1.0;

/**
 * Compute the goal-aware re-rank multiplier for a single chunk.
 *
 * Returns 1.0 when:
 *  - goal is null/unknown (caller should skip this function entirely in that case)
 *  - no source/exam_relevance metadata is present on the chunk
 *  - goal is set but no boost rule matches the chunk metadata
 *
 * Returns >1.0 when the chunk's source or exam_relevance aligns with the
 * goal's preferred packs (defined in goal-profile.sourcePriority).
 */
export function getRagSourceWeight(
  goal: GoalCode | null | undefined,
  metadata: ChunkRankMetadata,
): number {
  if (!goal) return NEUTRAL;

  const src = (metadata.source ?? '').toLowerCase();
  const tags = (metadata.examRelevance ?? []).map((t) => t.toUpperCase());

  switch (goal) {
    case 'board_topper': {
      // PYQ-tagged chunks (board paper questions from past years) AND
      // chunks explicitly tagged as CBSE_BOARD relevance get the strongest
      // boost. Standard NCERT chunks remain at NEUTRAL.
      if (src.includes('pyq') || src.includes('board_paper')) return 1.5;
      if (tags.includes('CBSE_BOARD') || tags.includes('BOARD')) return 1.35;
      // NCERT (the default) stays neutral - already the substrate.
      return NEUTRAL;
    }

    case 'competitive_exam': {
      if (src.includes('jee_archive')) return 1.5;
      if (src.includes('neet_archive')) return 1.5;
      if (tags.includes('JEE') || tags.includes('NEET')) return 1.35;
      // For competitive exam students, NCERT chunks below standard
      // application difficulty are slightly de-emphasised. We keep them
      // available but downweight to 0.9 (still surfaced if no better
      // option exists).
      if (src.includes('ncert') || src.includes('legacy')) return 0.9;
      return NEUTRAL;
    }

    case 'olympiad': {
      if (src.includes('olympiad')) return 1.6;
      if (tags.includes('OLYMPIAD')) return 1.4;
      // For olympiad goal, vanilla NCERT is significantly less useful;
      // downweight to 0.8 so any specialized content surfaces above it.
      if (src.includes('ncert') || src.includes('legacy')) return 0.8;
      return NEUTRAL;
    }

    case 'school_topper': {
      // Slightly favour PYQ + CBSE-tagged content but keep NCERT neutral.
      if (src.includes('pyq') || src.includes('board_paper')) return 1.2;
      if (tags.includes('CBSE_BOARD')) return 1.1;
      return NEUTRAL;
    }

    case 'pass_comfortably': {
      // High-frequency board topics (PYQ-marked) help most for getting
      // a passing grade. Modest boost.
      if (src.includes('pyq') || src.includes('board_paper')) return 1.25;
      return NEUTRAL;
    }

    case 'improve_basics': {
      // For basics-improvement, heavily favour NCERT foundation content
      // and de-prioritise advanced tagged content (JEE/NEET/Olympiad would
      // overwhelm). Curated/foundation chunks get a small boost; archive
      // packs get downweighted.
      if (src.includes('jee') || src.includes('neet') || src.includes('olympiad')) {
        return 0.6;
      }
      if (tags.includes('JEE') || tags.includes('NEET') || tags.includes('OLYMPIAD')) {
        return 0.7;
      }
      // NCERT and curated content stay at 1.0 (the substrate works fine).
      return NEUTRAL;
    }

    default:
      return NEUTRAL;
  }
}

/**
 * Re-rank a list of chunks (already scored by similarity) by applying
 * goal-aware source weights.
 *
 * Pure function. Returns a NEW array; never mutates the input.
 *
 * Algorithm:
 *   adjustedScore = chunk.similarity * getRagSourceWeight(goal, chunk)
 *
 * The output is sorted by adjustedScore DESC. The top-N items are returned
 * (where N defaults to the input length, i.e. order preserved with new
 * priority).
 */
export function applyGoalRerank<
  C extends ChunkRankMetadata & { similarity: number },
>(chunks: ReadonlyArray<C>, goal: GoalCode | null | undefined): C[] {
  if (!goal) return chunks.slice();
  return chunks
    .map((c) => ({
      chunk: c,
      adjustedScore: c.similarity * getRagSourceWeight(goal, c),
    }))
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
    .map((x) => x.chunk);
}
