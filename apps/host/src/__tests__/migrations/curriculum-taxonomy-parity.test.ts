import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * CANONICAL CHAPTER-TAXONOMY PARITY — integration lane. Testing-strategy gap 5
 * (Hard Rule 6: "Chapter structure must be identical across Foxy, Quiz, and UI";
 * failure mode #2: "old syllabus resurfacing").
 *
 * THE TWO POPULATED TAXONOMIES (verified live 2026-07-13)
 * ======================================================
 *  - `curriculum_topics` (537 active chapters) — the CANONICAL learn taxonomy.
 *    Foxy chapter-scope + the learn UI read it through the single shared fetcher
 *    `src/lib/curriculum/cached-taxonomy.ts` (ADR-007, built to kill the historic
 *    Foxy/Quiz two-fetcher drift). Keyed (board, grade, subject_id→subjects.code,
 *    chapter_number).
 *  - `cbse_syllabus` (1,148 rows) — the syllabus CATALOG / "Layer 2 SSoT"
 *    (per its table comment). Keyed (board, grade, subject_code, chapter_number)
 *    with is_in_scope + rag_status.
 *
 * THE INVARIANT PINNED (the DANGEROUS direction)
 * ==============================================
 * Every ACTIVE learn chapter MUST exist in the syllabus catalog AND be in-scope:
 *     active curriculum_topics  ⊆  cbse_syllabus WHERE is_in_scope
 * i.e. a chapter can never be served to a student that the current NCERT
 * syllabus SSoT does not contain or has marked out of scope. That is exactly the
 * "old-syllabus-resurfacing" P0 — a stale/rogue chapter live on the learn
 * surface. Verified live: 537 active chapters, 0 orphans — the invariant holds.
 *
 * DELIBERATELY NOT ASSERTED (the intentional backlog direction)
 * ============================================================
 * The reverse — cbse_syllabus ⊆ curriculum_topics — is FALSE by design: 611
 * in-scope catalog chapters are not (yet) in the learn taxonomy, and 0 of them
 * are rag_status='ready'. That is the content-readiness pipeline backlog
 * (curriculum_topics = the curated/published subset), NOT drift. Asserting it
 * would fail on healthy state. If product later declares full parity the goal,
 * flip this into a two-way assertion.
 *
 * WHY A LIVE DB: this is a data-integrity invariant over production content;
 * it cannot be exercised against a mock. Self-skips without real creds, like
 * every sibling under __tests__/migrations/.
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

interface CtRow { board: string | null; grade: string | null; subject_id: string; chapter_number: number | null }
interface SubjRow { id: string; code: string }
interface CsRow { board: string | null; grade: string | null; subject_code: string; chapter_number: number | null; is_in_scope: boolean }

// supabase-js caps a select at 1000 rows by default; page with .range() so a
// growing catalog can't silently truncate and make the test vacuously pass.
async function fetchAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const key = (board: string | null, grade: string | null, code: string, ch: number | null) =>
  `${board ?? ''}|${grade ?? ''}|${code}|${ch ?? ''}`;

describeIntegration('curriculum taxonomy parity (Hard Rule 6 / no old-syllabus)', () => {
  it('every active learn chapter exists and is in-scope in the cbse_syllabus SSoT', async () => {
    const [topics, subjects, syllabus] = await Promise.all([
      fetchAll<CtRow>('curriculum_topics', 'board,grade,subject_id,chapter_number,is_active,deleted_at',
        (q) => q.eq('is_active', true).is('deleted_at', null).not('chapter_number', 'is', null)),
      fetchAll<SubjRow>('subjects', 'id,code'),
      fetchAll<CsRow>('cbse_syllabus', 'board,grade,subject_code,chapter_number,is_in_scope',
        (q) => q.eq('is_in_scope', true)),
    ]);

    // Non-vacuity: an empty curriculum_topics (as a stale snapshot once suggested)
    // must NOT let this pass silently.
    expect(topics.length, 'no active curriculum_topics chapters found — parity check would be vacuous').toBeGreaterThan(0);
    expect(syllabus.length, 'no in-scope cbse_syllabus rows found').toBeGreaterThan(0);

    const codeById = new Map(subjects.map((s) => [s.id, s.code]));
    const inScope = new Set(syllabus.map((r) => key(r.board, r.grade, r.subject_code, r.chapter_number)));

    const orphans: string[] = [];
    for (const t of topics) {
      const code = codeById.get(t.subject_id);
      if (!code) continue; // a topic with no resolvable subject is a separate data issue, not this invariant
      const k = key(t.board, t.grade, code, t.chapter_number);
      if (!inScope.has(k)) orphans.push(k);
    }

    expect(
      orphans,
      `Active learn chapters NOT present+in-scope in cbse_syllabus (old-syllabus-resurfacing risk, Hard Rule 6): ${
        [...new Set(orphans)].slice(0, 25).join(' ; ')
      }${orphans.length > 25 ? ` … (+${orphans.length - 25} more)` : ''}`,
    ).toEqual([]);
  });
});
