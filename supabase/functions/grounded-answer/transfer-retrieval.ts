// supabase/functions/grounded-answer/transfer-retrieval.ts
//
// Digital Twin + Knowledge Graph (Slice 1) — cross-subject retrieval widening.
// "THE MOAT": when (and ONLY when) there is an EXPLICIT concept_edges row with
// edge_type='transfer' connecting the student's current topic to a topic in a
// DIFFERENT subject (same grade), additionally retrieve a small, bounded number
// of NCERT chunks from that other subject and blend them into the reference set.
//
// ─── HARD SAFETY CONTRACT (P12) ──────────────────────────────────────────────
//   • NEVER relaxes curriculum_guard or the abstain logic. It only ADDS chunks
//     along explicit, curated transfer edges. Out-of-scope queries still abstain
//     exactly as before — this code anchors edges on the student's IN-scope
//     topic, so an out-of-scope query has nothing to anchor and adds nothing.
//   • SAME-GRADE ONLY: transfer targets are filtered to the SAME grade as the
//     student, so we never surface above-grade content (P12 grade scope).
//   • SOFT-MODE ONLY: callers gate on request.mode === 'soft'. Strict callers
//     (ncert-solver / concept-engine) keep their exact single-subject contract
//     (3-chunk minimum + grounding check are not diluted by foreign-subject
//     chunks).
//   • FLAG + EDGE GATED: a strict no-op when ff_digital_twin_v1 is OFF (callers
//     check isDigitalTwinEnabled first) AND when no transfer edge exists (the
//     production default — the Slice-1 backfill creates ONLY 'prerequisite'
//     edges; 'transfer' edges are curated later by service-role tooling).
//   • BEST-EFFORT: every failure path returns [] and NEVER throws.
//
// Retrieved transfer chunks ride through the SAME scope verification as primary
// retrieval (retrieveChunks → ../_shared/rag/retrieve), so a transfer target
// only contributes chunks that genuinely belong to that other subject/chapter.

import {
  retrieveChunks,
  type RetrievedChunk,
} from './retrieval.ts';

// ─── Caps (bound latency + prompt size; all flag-gated anyway) ───────────────
const MAX_TRANSFER_EDGES = 4; // explicit edges examined per turn
const MAX_TRANSFER_TARGETS = 2; // distinct (subject, chapter) targets retrieved
const TRANSFER_MATCH_COUNT = 2; // chunks requested per target
const MAX_TRANSFER_CHUNKS = 3; // total transfer chunks blended into the set

export interface TransferRetrievalParams {
  /** The student's raw query (used for hybrid retrieval in the other subject). */
  query: string;
  /** The Voyage embedding of the query (may be null — keyword path still works). */
  embedding: number[] | null;
  /** The CURRENT request scope (the primary subject the student is studying). */
  scope: {
    grade: string;
    subject_code: string;
    chapter_number: number | null;
  };
  /** Similarity floor — identical to the primary retrieval floor. */
  minSimilarity: number;
}

/**
 * Retrieve cross-subject chunks reachable via EXPLICIT transfer edges. Returns
 * [] in the overwhelmingly common case (no transfer edge for the current
 * topic). Never throws.
 */
// deno-lint-ignore no-explicit-any
export async function retrieveTransferChunks(
  sb: any,
  params: TransferRetrievalParams,
): Promise<RetrievedChunk[]> {
  try {
    const { query, embedding, scope, minSimilarity } = params;
    if (!scope.subject_code || scope.chapter_number == null) return [];

    // 1. Resolve the current subject's id.
    const { data: subjRow } = await sb
      .from('subjects')
      .select('id')
      .ilike('code', scope.subject_code)
      .maybeSingle();
    const subjectId: string | null = subjRow?.id ?? null;
    if (!subjectId) return [];

    // 2. Resolve the current topic ids for (subject, grade, chapter).
    const { data: topicRows } = await sb
      .from('curriculum_topics')
      .select('id')
      .eq('subject_id', subjectId)
      .eq('grade', scope.grade)
      .eq('chapter_number', scope.chapter_number)
      .limit(50);
    const currentTopicIds: string[] = (topicRows ?? [])
      .map((t: { id?: string }) => t.id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    if (currentTopicIds.length === 0) return [];
    const currentSet = new Set(currentTopicIds);

    // 3. Explicit transfer edges touching any current topic (either direction).
    const idList = currentTopicIds.join(',');
    const { data: edgeRows } = await sb
      .from('concept_edges')
      .select('from_topic_id, to_topic_id')
      .eq('edge_type', 'transfer')
      .or(`from_topic_id.in.(${idList}),to_topic_id.in.(${idList})`)
      .limit(MAX_TRANSFER_EDGES);
    const edges: Array<{ from_topic_id: string; to_topic_id: string }> = edgeRows ?? [];
    if (edges.length === 0) return [];

    // 4. The OTHER endpoint of each edge is the transfer-linked topic.
    const otherTopicIds: string[] = [];
    for (const e of edges) {
      const other = currentSet.has(e.from_topic_id) ? e.to_topic_id : e.from_topic_id;
      if (other && !currentSet.has(other)) otherTopicIds.push(other);
    }
    if (otherTopicIds.length === 0) return [];

    // 5. Resolve those topics → subject_id + chapter, SAME GRADE only (P12),
    //    and only when the subject genuinely DIFFERS from the current one.
    const { data: otherTopicRows } = await sb
      .from('curriculum_topics')
      .select('id, subject_id, chapter_number, grade')
      .in('id', Array.from(new Set(otherTopicIds)))
      .eq('grade', scope.grade)
      .limit(50);
    const targets = (otherTopicRows ?? []).filter(
      (t: { subject_id?: string; chapter_number?: number | null }) =>
        typeof t.subject_id === 'string' &&
        t.subject_id !== subjectId &&
        typeof t.chapter_number === 'number',
    ) as Array<{ subject_id: string; chapter_number: number }>;
    if (targets.length === 0) return [];

    // 6. Resolve target subject ids → codes.
    const targetSubjectIds = Array.from(new Set(targets.map((t) => t.subject_id)));
    const { data: subjRows } = await sb
      .from('subjects')
      .select('id, code')
      .in('id', targetSubjectIds);
    const codeById = new Map<string, string>();
    for (const s of (subjRows ?? []) as Array<{ id: string; code: string }>) {
      if (s.id && s.code) codeById.set(s.id, s.code);
    }

    // 7. De-duplicate (subjectCode, chapterNumber) targets and cap.
    const seen = new Set<string>();
    const retrievalTargets: Array<{ subjectCode: string; chapterNumber: number }> = [];
    for (const t of targets) {
      const code = codeById.get(t.subject_id);
      if (!code) continue;
      const key = `${code}::${t.chapter_number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      retrievalTargets.push({ subjectCode: code, chapterNumber: t.chapter_number });
      if (retrievalTargets.length >= MAX_TRANSFER_TARGETS) break;
    }
    if (retrievalTargets.length === 0) return [];

    // 8. Retrieve a few chunks from each target (scope-verified by retrieveChunks).
    const collected: RetrievedChunk[] = [];
    const collectedIds = new Set<string>();
    for (const target of retrievalTargets) {
      if (collected.length >= MAX_TRANSFER_CHUNKS) break;
      const { chunks } = await retrieveChunks(sb, {
        query,
        embedding,
        scope: {
          grade: scope.grade,
          subject_code: target.subjectCode,
          chapter_number: target.chapterNumber,
          chapter_title: null,
        },
        matchCount: TRANSFER_MATCH_COUNT,
        minSimilarity,
      });
      for (const c of chunks) {
        if (collected.length >= MAX_TRANSFER_CHUNKS) break;
        if (collectedIds.has(c.id)) continue;
        collectedIds.add(c.id);
        collected.push(c);
      }
    }
    return collected;
  } catch (err) {
    console.warn(`transfer-retrieval: ${String(err)}`);
    return [];
  }
}

/**
 * Merge transfer chunks into the primary set, de-duplicating by chunk id and
 * preserving primary order (transfer chunks appended after). Pure.
 */
export function mergeTransferChunks(
  primary: RetrievedChunk[],
  transfer: RetrievedChunk[],
): RetrievedChunk[] {
  if (transfer.length === 0) return primary;
  const ids = new Set(primary.map((c) => c.id));
  const merged = primary.slice();
  for (const c of transfer) {
    if (ids.has(c.id)) continue;
    ids.add(c.id);
    merged.push(c);
  }
  return merged;
}
