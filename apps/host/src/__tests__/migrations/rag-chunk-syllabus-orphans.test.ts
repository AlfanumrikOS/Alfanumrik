import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv, skipIfNoSubstrate } from '../helpers/integration';

/**
 * RAG CHUNK ↔ SYLLABUS ORPHAN BUDGET — integration lane. Testing-strategy gap:
 * RAG atomic-purge / "old syllabus resurfacing" (blueprint §6, failure mode #2).
 *
 * THE GAP
 * =======
 * `rag_content_chunks` cascade-delete only from `rag_content_documents`
 * (document-centric lifecycle). NOTHING ties chunk lifecycle to the chapter
 * taxonomy: there is no FK or trigger from a chunk's (grade, subject_code,
 * chapter_number) to `cbse_syllabus`. So when a chapter is removed or moved out
 * of scope in the syllabus SSoT, its chunks can remain ACTIVE and retrievable —
 * exactly the "purge stale rows AND stale RAG vectors atomically; a partial
 * purge is what causes old syllabus to resurface" hazard.
 *
 * Verified live (prod, 2026-07-13): 106 / 27,228 active chunks (0.39%) reference
 * a (grade, subject_code, chapter_number) with no in-scope cbse_syllabus row.
 *
 * WHAT THIS PINS
 * ==============
 * The ORPHAN FRACTION must stay below a small budget. A ratio (not an absolute
 * count) is used because the integration DB is not prod — content volume
 * differs — so an absolute baseline would be meaningless across environments.
 * If a curriculum update removes chapters without purging their vectors, the
 * fraction climbs and this fails. Budget should RATCHET toward 0 as the content
 * team purges the current backlog and/or a retrieval-time in-scope filter lands
 * (the durable guard — see the recommendation in the gap-5/RAG writeup).
 *
 * Skips cleanly without live creds; skips (not fails) when the target DB has too
 * little RAG content to be meaningful.
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

// 1.5% leaves ~4x headroom over the observed 0.39% so normal churn doesn't
// flake, while still catching a real purge regression (a dropped chapter's
// chunks would spike the fraction well past this).
const ORPHAN_FRACTION_BUDGET = 0.015;
// Below this many chunks the ratio is noise — skip rather than assert.
const MIN_CHUNKS_FOR_SIGNAL = 500;

interface ChunkKey {
  board: string | null;
  grade: string | null;
  grade_short: string | null;
  subject: string | null;
  subject_code: string | null;
  chapter_number: number | null;
}
interface SyllabusKey {
  grade: string | null;
  subject_code: string | null;
  chapter_number: number | null;
}

async function pageAll<T>(table: string, columns: string, filter: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(
      supabaseAdmin.from(table).select(columns).range(from, from + PAGE - 1),
    );
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const skey = (grade: string | null, code: string | null, ch: number | null) =>
  `${grade ?? ''}|${code ?? ''}|${ch ?? ''}`;

describeIntegration('RAG chunk ↔ syllabus orphan budget (no old-syllabus resurfacing)', () => {
  it('active RAG chunks map to in-scope syllabus chapters within budget', async (ctx) => {
    const inScope = await pageAll<SyllabusKey>(
      'cbse_syllabus',
      'grade,subject_code,chapter_number',
      (q) => q.eq('is_in_scope', true),
    );
    // Only key columns — never select `embedding` (1024-dim vectors would be huge).
    const chunks = await pageAll<ChunkKey>(
      'rag_content_chunks',
      'board,grade,grade_short,subject,subject_code,chapter_number,is_active',
      (q) => q.neq('is_active', false).not('chapter_number', 'is', null),
    );

    skipIfNoSubstrate(
      ctx,
      chunks.length >= MIN_CHUNKS_FOR_SIGNAL && inScope.length > 0,
      `too little RAG content on this DB to measure orphan fraction (${chunks.length} chunks, ${inScope.length} syllabus rows)`,
    );

    const inScopeSet = new Set(inScope.map((s) => skey(s.grade, s.subject_code, s.chapter_number)));
    let orphans = 0;
    for (const c of chunks) {
      const grade = c.grade_short ?? c.grade;
      const code = c.subject_code ?? c.subject;
      if (!inScopeSet.has(skey(grade, code, c.chapter_number))) orphans += 1;
    }

    const fraction = orphans / chunks.length;
    expect(
      fraction,
      `${orphans}/${chunks.length} (${(fraction * 100).toFixed(2)}%) active RAG chunks reference a chapter with ` +
        `no in-scope cbse_syllabus row — stale vectors that can resurface in retrieval. Budget ${(ORPHAN_FRACTION_BUDGET * 100).toFixed(1)}%. ` +
        `Purge orphaned chunks when a chapter leaves scope (atomic with the syllabus edit), and/or filter retrieval to in-scope chapters.`,
    ).toBeLessThanOrEqual(ORPHAN_FRACTION_BUDGET);
  });
});
