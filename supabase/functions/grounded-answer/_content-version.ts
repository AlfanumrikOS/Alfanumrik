// supabase/functions/grounded-answer/_content-version.ts
//
// Reader for `rag_content_versions` (grade text, subject_code text,
// version int, PK(grade, subject_code)) — the per-scope content-generation
// counter that every ingestion writer (embed-ncert-qa, embed-questions,
// generate-embeddings, extract-ncert-questions) bumps after a successful
// content write (see supabase/functions/_shared/rag-content-version.ts).
//
// The version is folded into the response-cache v2 gen_ctx tuple so a
// content re-ingestion invalidates every cached answer for that
// (grade, subject) scope on the next request — without any explicit cache
// flush.
//
// Mirrors the _l2-cache-flags.ts pattern: a 60s in-process memo per
// (grade, subject_code) so the read costs at most one DB roundtrip per
// scope per minute per instance.
//
// Failure semantics (hardening fix, response-cache v2):
//   - MISSING row → version 0 (a scope that has never been re-ingested
//     since the table shipped). Safe: 0 is that scope's true version.
//   - Read ERROR (returned PostgREST error OR thrown) → null sentinel.
//     The pipeline treats null as cache-INELIGIBLE for the request (no
//     read, no write, on all tiers). Defaulting an ERROR to 0 was unsafe:
//     after an ingestion bump to version N, a transient read error would
//     rebuild version-0 keys and could resurrect stale pre-bump entries.
//   - The null sentinel is memoized with the same 60s TTL, preserving the
//     one-roundtrip-per-scope-per-minute contract; the degrade direction
//     (≤60s of cache-ineligibility per instance) is safe — it only costs
//     regeneration, never staleness.
// Never throws (contract preserved).

interface VersionCacheEntry {
  value: number | null;
  expiresAt: number;
}

const VERSION_CACHE_TTL_MS = 60_000;
const versionCache = new Map<string, VersionCacheEntry>();

/**
 * Read the (grade, subject_code) content version.
 *   - number  → the version (0 for a missing row — never re-ingested).
 *   - null    → the READ ERRORED; the caller must treat the request as
 *               cache-ineligible (scope 'none': no cache read, no write).
 * Never throws.
 */
// deno-lint-ignore no-explicit-any
export async function getRagContentVersion(sb: any, grade: string, subjectCode: string): Promise<number | null> {
  const key = `${grade}|${subjectCode}`;
  const now = Date.now();
  const cached = versionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  let value: number | null;
  try {
    const { data, error } = await sb
      .from('rag_content_versions')
      .select('version')
      .eq('grade', grade)
      .eq('subject_code', subjectCode)
      .maybeSingle();
    if (error) {
      // Returned PostgREST error (supabase-js does not throw these). A
      // missing row is { data: null, error: null } and stays version 0
      // below — ONLY a real error takes this branch.
      console.warn(`rag_content_versions read error — cache-ineligible for scope — ${String(error.message ?? error)}`);
      value = null;
    } else {
      value = typeof data?.version === 'number' ? data.version : 0;
    }
  } catch (err) {
    console.warn(`rag_content_versions lookup threw — cache-ineligible for scope — ${String(err)}`);
    value = null;
  }
  versionCache.set(key, { value, expiresAt: now + VERSION_CACHE_TTL_MS });
  return value;
}

export function __resetContentVersionCacheForTests(): void {
  versionCache.clear();
}
