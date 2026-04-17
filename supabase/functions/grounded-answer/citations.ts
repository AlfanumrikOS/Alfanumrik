// supabase/functions/grounded-answer/citations.ts
// Citation extraction from Claude's answer text.
//
// Single responsibility: parse [N] references (1-indexed) from the answer,
// resolve to the matching retrieved chunk, and build Citation objects
// for the GroundedResponse. Spec §6.1 Citation shape.
//
// Rules:
//   - A reference like "[3]" resolves to chunks[2] (1-indexed).
//   - Out-of-range references (e.g. "[9]" when only 3 chunks were
//     retrieved) are silently skipped. The grounding check is responsible
//     for flagging unsupported claims; we don't want to surface broken
//     refs as pseudo-citations.
//   - Duplicate references ("[1] ... [1] again") collapse to one Citation.
//   - Output order follows first-occurrence order in the answer so the
//     numbered list the frontend renders matches how the student reads.
//   - Excerpts are truncated to 200 chars of chunk content. Past that,
//     we append "…" to signal truncation.

import type { Citation } from './types.ts';
import type { RetrievedChunk } from './retrieval.ts';

const EXCERPT_MAX_CHARS = 200;
const CITATION_REF_PATTERN = /\[(\d+)\]/g;

export function extractCitations(
  answer: string,
  chunks: RetrievedChunk[],
): Citation[] {
  if (!answer || chunks.length === 0) return [];

  const seen = new Set<number>();
  const ordered: number[] = [];

  for (const match of answer.matchAll(CITATION_REF_PATTERN)) {
    const n = parseInt(match[1], 10);
    if (!Number.isFinite(n) || n < 1) continue;
    if (n > chunks.length) continue; // out-of-range: skip silently
    if (seen.has(n)) continue;
    seen.add(n);
    ordered.push(n);
  }

  return ordered.map((n) => {
    const chunk = chunks[n - 1];
    return {
      index: n,
      chunk_id: chunk.id,
      chapter_number: chunk.chapter_number,
      chapter_title: chunk.chapter_title,
      page_number: chunk.page_number,
      similarity: chunk.similarity,
      excerpt: truncateExcerpt(chunk.content),
      media_url: chunk.media_url,
    };
  });
}

function truncateExcerpt(content: string): string {
  const trimmed = (content ?? '').trim();
  if (trimmed.length <= EXCERPT_MAX_CHARS) return trimmed;
  return trimmed.slice(0, EXCERPT_MAX_CHARS) + '…';
}