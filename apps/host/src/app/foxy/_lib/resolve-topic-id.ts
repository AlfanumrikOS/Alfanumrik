/**
 * resolve-topic-id — turn a `?topic_id=<uuid>` deep-link param into the
 * {title, subject code, chapter} triple the Foxy page's URL-context path
 * already understands.
 *
 * WHY (defect #10): several surfaces hold a `concept_mastery.topic_id` but no
 * topic name — /progress' decay list, the Revision Center's due buckets,
 * RevisionCenter's primary CTA. They all deep-linked `/foxy?topic_id=<uuid>`,
 * and the Foxy page NEVER read that param: it reads `topic`, `chapter`,
 * `subject`, `mode`, `grade`. So the tap navigated to a completely unscoped
 * Foxy and read to the student as "nothing happened".
 *
 * Resolving here makes `topic_id` a first-class deep-link param that routes
 * through the SAME switchSubject path a normal `?subject=&chapter=` link uses.
 *
 * Best-effort by design: any error (bad uuid, RLS, offline) yields null and the
 * caller falls back to whatever other params the URL carried. A failed lookup
 * must never block the page from mounting.
 *
 * Extracted into `_lib/` so it is unit-testable (Next.js page files may only
 * export the default component + route config).
 */
import { supabase } from '@alfanumrik/lib/supabase';

/** Fixed column contract — explicit columns, never `*`. */
export const TOPIC_LOOKUP_COLUMNS = 'id, title, title_hi, chapter_number, subjects(code)';

export interface ResolvedTopic {
  topicId: string;
  title: string | null;
  titleHi: string | null;
  chapterNumber: number | null;
  /** Canonical subject CODE (`subjects.code`), never a display name. */
  subjectCode: string | null;
}

interface TopicRow {
  id: string;
  title: string | null;
  title_hi: string | null;
  chapter_number: number | null;
  // PostgREST returns an embedded to-one relation as an object; some client
  // versions type it as an array. Accept both.
  subjects: { code: string | null } | { code: string | null }[] | null;
}

function subjectCodeOf(row: TopicRow): string | null {
  const s = row.subjects;
  if (!s) return null;
  if (Array.isArray(s)) return s[0]?.code ?? null;
  return s.code ?? null;
}

/**
 * Look up one curriculum topic by id. Returns null when the id is absent,
 * malformed, or not readable.
 */
export async function resolveTopicId(topicId: string | null | undefined): Promise<ResolvedTopic | null> {
  const id = topicId?.trim();
  if (!id) return null;
  try {
    // ADR-007's cached-taxonomy module is SERVER-ONLY (it builds on
    // getSupabaseAdmin, the RLS-bypassing service-role client) and this
    // resolver runs inside the /foxy CLIENT component. Importing it here would
    // pull the service-role key into client code (P8). This is a single-row,
    // by-primary-key lookup through the RLS-respecting browser client — it
    // defines no taxonomy shape of its own, so it cannot drift from the shared
    // chapter fetcher the rule exists to protect.
    // eslint-disable-next-line alfanumrik/no-inline-taxonomy-reads
    const { data, error } = await supabase
      .from('curriculum_topics')
      .select(TOPIC_LOOKUP_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as TopicRow;
    return {
      topicId: row.id,
      title: row.title ?? null,
      titleHi: row.title_hi ?? null,
      chapterNumber: typeof row.chapter_number === 'number' ? row.chapter_number : null,
      subjectCode: subjectCodeOf(row),
    };
  } catch {
    return null;
  }
}
