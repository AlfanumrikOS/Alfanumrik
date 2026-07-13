/**
 * Shared, cached chapter-taxonomy fetcher (ADR-007 action item 5).
 *
 * WHY THIS EXISTS
 * ---------------
 * Chapter/topic structure is public, non-user-specific reference data read on
 * nearly every learn surface, but it was being re-queried per request by each
 * caller with its own inline query — the exact two-fetchers-drift pattern
 * behind the historical Foxy/Quiz chapter-mismatch P0 (Hard Rule 6). New code
 * needing grade→subject→chapter→topic structure MUST come through this module
 * rather than querying `curriculum_topics` / `subjects` inline.
 *
 * CACHING RULES (blueprint §8 / ADR-007)
 * --------------------------------------
 * - ONLY public reference data is cached here. Anything plan-gated or
 *   student-scoped (e.g. `get_available_subjects`) must stay OUT of this
 *   module — per-user data never enters a shared cache.
 * - Entries carry the `syllabus` tag. Any write path that mutates
 *   `curriculum_topics` (or `subjects`) must call
 *   `revalidateTag(SYLLABUS_CACHE_TAG, 'max')` so curriculum edits propagate
 *   without waiting out the TTL. Stale-syllabus content is a Hard Rule 2
 *   violation — the TTL is a backstop, not the invalidation mechanism.
 * - TTL 1h: taxonomy changes are rare (content-team edits), and tag
 *   revalidation handles those immediately.
 * - Cache failure degrades to a direct DB read (never to an error): the cache
 *   is an optimization, not a dependency. This also lets unit tests exercise
 *   the route without a Next incremental-cache runtime.
 *
 * NOTE: `unstable_cache` is the per-datum server cache API available without
 * enabling experimental cacheComponents ('use cache'). If/when the app opts
 * into cacheComponents, migrate this module to the `'use cache'` directive +
 * `cacheTag(SYLLABUS_CACHE_TAG)` — keep the tag name identical.
 */
import { unstable_cache } from 'next/cache';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const SYLLABUS_CACHE_TAG = 'syllabus';
const SYLLABUS_TTL_SECONDS = 3600;

export interface TaxonomyTopicRow {
  id: string;
  subject_id: string;
  chapter_number: number | null;
  title: string | null;
  title_hi: string | null;
  parent_topic_id: string | null;
}

export interface SubjectIdCodeRow {
  id: string;
  code: string;
}

// ── Raw (uncached) fetchers ─────────────────────────────────────────────────

async function fetchActiveTopicsRaw(grade: string, sortedSubjectIds: string[]): Promise<TaxonomyTopicRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('curriculum_topics')
    .select('id, subject_id, chapter_number, title, title_hi, parent_topic_id')
    .in('subject_id', sortedSubjectIds)
    .eq('grade', grade)
    .eq('is_active', true)
    .order('chapter_number', { ascending: true })
    .order('display_order', { ascending: true });
  if (error) {
    // Never cache a failure as an empty taxonomy — throw so unstable_cache
    // skips storing and the caller surfaces a structured error.
    throw new Error(`curriculum_topics fetch failed: ${error.message}`);
  }
  return (data ?? []) as TaxonomyTopicRow[];
}

async function fetchSubjectIdCodeRaw(sortedCodes: string[]): Promise<SubjectIdCodeRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('subjects').select('id, code').in('code', sortedCodes);
  if (error) {
    throw new Error(`subjects lookup failed: ${error.message}`);
  }
  return (data ?? []) as SubjectIdCodeRow[];
}

// ── Cached wrappers with direct-read degradation ────────────────────────────

/**
 * Runs the unstable_cache-wrapped fetcher; if the CACHE LAYER itself fails
 * (no incremental-cache runtime, cache backend error), degrades to the raw
 * fetcher. Genuine DB errors are recognizable by our own error prefix and are
 * rethrown without a wasteful second query.
 */
async function withCacheFallback<T>(cached: () => Promise<T>, raw: () => Promise<T>, label: string): Promise<T> {
  try {
    return await cached();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isOwnDbError = message.includes('fetch failed:') || message.includes('lookup failed:');
    if (isOwnDbError) throw err;
    logger.warn('taxonomy_cache_bypass', { label, reason: message.slice(0, 200) });
    return raw();
  }
}

/**
 * Active curriculum topics for a grade across one or more subjects, ordered
 * by (chapter_number, display_order). Cached per (grade, subject-id set).
 */
export async function getActiveTopicsForSubjects(
  grade: string,
  subjectIds: string[],
): Promise<TaxonomyTopicRow[]> {
  if (subjectIds.length === 0) return [];
  // Sort so the cache key is order-independent — the same subject set must
  // hit the same entry regardless of caller ordering.
  const sortedIds = [...subjectIds].sort();
  const cached = unstable_cache(
    () => fetchActiveTopicsRaw(grade, sortedIds),
    ['curriculum-topics-v1', grade, sortedIds.join(',')],
    { revalidate: SYLLABUS_TTL_SECONDS, tags: [SYLLABUS_CACHE_TAG] },
  );
  return withCacheFallback(cached, () => fetchActiveTopicsRaw(grade, sortedIds), 'topics');
}

/**
 * subjects.code ↔ subjects.id lookup for a set of codes. Public reference
 * data; cached under the same `syllabus` tag.
 */
export async function getSubjectIdCodeRows(codes: string[]): Promise<SubjectIdCodeRow[]> {
  if (codes.length === 0) return [];
  const sortedCodes = [...codes].sort();
  const cached = unstable_cache(
    () => fetchSubjectIdCodeRaw(sortedCodes),
    ['subjects-id-code-v1', sortedCodes.join(',')],
    { revalidate: SYLLABUS_TTL_SECONDS, tags: [SYLLABUS_CACHE_TAG] },
  );
  return withCacheFallback(cached, () => fetchSubjectIdCodeRaw(sortedCodes), 'subjects');
}
