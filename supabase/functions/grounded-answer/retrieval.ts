// supabase/functions/grounded-answer/retrieval.ts
// Retrieval + scope verification layer.
//
// Single responsibility: call match_rag_chunks_ncert and independently
// verify that every returned chunk belongs to the requested scope.
// Defense-in-depth for spec §6.4 step 4 — if a future RPC refactor
// silently broadens the result (returns wrong-grade or wrong-subject
// chunks), the scopeDrops counter will surface it in the trace instead
// of leaking into student answers.
//
// Contract:
//   - Never throws. RPC errors return empty chunks + 0 drops.
//   - chapter_number is passed as INTEGER to the RPC (never stringified) —
//     the RPC signature is `p_chapter_number INTEGER DEFAULT NULL` and
//     comparing int-to-string inside postgres throws.
//   - When scope.chapter_number is null we ran subject-wide retrieval;
//     we MUST NOT drop rows on chapter mismatch because the caller
//     explicitly asked for any chapter in the subject.

export interface RetrievedChunk {
  id: string;
  content: string;
  chapter_number: number;
  chapter_title: string;
  page_number: number | null;
  similarity: number;
  media_url: string | null;
  media_description: string | null;
}

export interface RetrievalScope {
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  chapter_title: string | null;
}

export interface RetrievalParams {
  query: string;
  embedding: number[] | null;
  scope: RetrievalScope;
  matchCount: number;
  minSimilarity: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  scopeDrops: number;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

// Row shape we ask the RPC for. grade_short / subject_code are not
// returned by match_rag_chunks_ncert today, but we still read them if
// present so a future RPC extension lights up the scope check
// automatically.
interface RpcRow {
  id: string;
  content: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  page_number: number | null;
  similarity: number | null;
  media_url: string | null;
  media_description: string | null;
  grade_short?: string | null;
  subject_code?: string | null;
}

export async function retrieveChunks(
  sb: SupabaseLike,
  params: RetrievalParams,
): Promise<RetrievalResult> {
  const { query, embedding, scope, matchCount, minSimilarity } = params;

  // deno-lint-ignore no-explicit-any
  let result: { data: any; error: any };
  try {
    result = await sb.rpc('match_rag_chunks_ncert', {
      query_text: query,
      p_subject_code: scope.subject_code,
      p_grade: scope.grade,
      match_count: matchCount,
      p_chapter_number: scope.chapter_number, // int | null — pass through as-is
      p_chapter_title: scope.chapter_title,   // string | null
      p_min_quality: 0.4,
      query_embedding: embedding,
    });
  } catch (err) {
    console.warn(`retrieval: rpc threw — ${String(err)}`);
    return { chunks: [], scopeDrops: 0 };
  }

  if (result.error) {
    console.warn(`retrieval: rpc error — ${result.error.message ?? 'unknown'}`);
    return { chunks: [], scopeDrops: 0 };
  }

  const rows: RpcRow[] = Array.isArray(result.data) ? result.data : [];

  let scopeDrops = 0;
  const chunks: RetrievedChunk[] = [];

  for (const row of rows) {
    // Scope verification. Only enforce fields we received — if the RPC
    // doesn't return grade_short/subject_code, we rely on its internal
    // filter (which DOES enforce them). Chapter enforcement is conditional
    // on the caller having specified a chapter.
    if (row.grade_short !== undefined && row.grade_short !== null && row.grade_short !== scope.grade) {
      scopeDrops++;
      continue;
    }
    if (row.subject_code !== undefined && row.subject_code !== null && row.subject_code !== scope.subject_code) {
      scopeDrops++;
      continue;
    }
    if (scope.chapter_number != null && row.chapter_number !== scope.chapter_number) {
      scopeDrops++;
      continue;
    }

    // Similarity floor — defensive even though the RPC already ranks.
    // When embedding path is taken, similarity = 1 - cosine_distance.
    // When FTS path is taken, similarity = ts_rank (small positive floats).
    // When LIKE fallback is taken, similarity is hardcoded to 0.3.
    // The caller passes the appropriate floor for the current mode.
    const sim = typeof row.similarity === 'number' ? row.similarity : 0;
    if (sim < minSimilarity) {
      // Not a scope drop — this is an expected filter, not a defense-in-depth
      // catch. Don't inflate the scopeDrops counter with it.
      continue;
    }

    chunks.push({
      id: row.id,
      content: row.content ?? '',
      chapter_number: row.chapter_number ?? 0,
      chapter_title: row.chapter_title ?? '',
      page_number: row.page_number ?? null,
      similarity: sim,
      media_url: row.media_url ?? null,
      media_description: row.media_description ?? null,
    });
  }

  return { chunks, scopeDrops };
}