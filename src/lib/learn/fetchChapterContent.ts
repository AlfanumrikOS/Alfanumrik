/**
 * Read-mode content fetcher for /learn/[subject]/[chapter] (Phase 2-B).
 *
 * Pulls NCERT chapter prose from `rag_content_chunks` — the same table the
 * grounded-answer RAG pipeline retrieves from — and returns it as ordered
 * markdown plus chunk-level source attribution. No new infrastructure: this
 * is a focused query alongside the existing RRF retrieval (no embedding, no
 * re-ranking, just `WHERE grade=$ AND subject=$ AND chapter_number=$
 * ORDER BY chunk_index`).
 *
 * The fetcher does:
 *   - Subject normalisation (the upper layer uses lowercase codes like
 *     'math' / 'science'; rag_content_chunks stores 'Mathematics' /
 *     'Science'). Normalises by reusing the same map the existing RPC
 *     `match_rag_chunks_*` uses.
 *   - Grade normalisation ('9' → 'Grade 9').
 *   - 5-min in-process cache via cacheFetch.
 *   - 50 KB markdown cap with a soft truncation marker.
 *
 * The fetcher does NOT do:
 *   - Embedding lookups, MMR, or RRF — those are for Foxy's RAG. Read mode
 *     wants the chapter in order, end-to-end.
 *   - Hindi rendering — `rag_content_chunks` is English-medium today. When
 *     Hindi rows land, this fetcher will need a `language` param.
 *   - Markdown sanitisation — react-markdown handles XSS at render time.
 */

import { cacheFetch, CACHE_TTL } from '@/lib/cache';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const SUBJECT_NORMALISATION: Record<string, string> = {
  math: 'Mathematics',
  mathematics: 'Mathematics',
  science: 'Science',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  english: 'English',
  hindi: 'Hindi',
  sanskrit: 'Sanskrit',
  social_studies: 'Social Studies',
  social_science: 'Social Studies',
  computer_science: 'Computer Science',
  informatics_practices: 'Informatics Practices',
  economics: 'Economics',
  accountancy: 'Accountancy',
  political_science: 'Political Science',
  history: 'History',
  geography: 'Geography',
};

const MAX_MARKDOWN_BYTES = 50_000;

export interface ChapterContentSource {
  chunk_id: string;
  chapter_title: string | null;
  chunk_index: number | null;
  page_number: number | null;
}

export interface ChapterContent {
  /** Concatenated markdown of every chunk_text in chunk_index order. */
  markdown: string;
  /** Per-chunk attribution for the "sources" footer. */
  sources: ChapterContentSource[];
  /** True iff `markdown` was truncated at MAX_MARKDOWN_BYTES. */
  truncated: boolean;
}

function normaliseSubject(subjectCode: string): string {
  const key = subjectCode.toLowerCase().trim();
  return SUBJECT_NORMALISATION[key] ?? subjectCode;
}

function normaliseGrade(grade: string): string {
  const trimmed = grade.trim();
  if (/^\d+$/.test(trimmed)) return `Grade ${trimmed}`;
  if (/^grade/i.test(trimmed)) {
    return `Grade ${trimmed.replace(/[^0-9]/g, '')}`;
  }
  return trimmed;
}

/**
 * Fetch the entire ordered chapter as markdown.
 *
 * Returns null when no rows match. Callers (the chapter page) treat null as
 * "fall back to practice mode" and emit `learn_read_mode_fallback`.
 */
export async function fetchChapterContent(args: {
  subjectCode: string;
  grade: string;
  chapterNumber: number;
}): Promise<ChapterContent | null> {
  const subject = normaliseSubject(args.subjectCode);
  const grade = normaliseGrade(args.grade);
  const cacheKey = `learn:chapter:${subject}:${grade}:${args.chapterNumber}`;

  return cacheFetch(
    cacheKey,
    CACHE_TTL.STATIC,
    async () => {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('rag_content_chunks')
        .select(
          'id, chapter_title, chunk_index, page_number, chunk_text',
        )
        .eq('grade', grade)
        .eq('subject', subject)
        .eq('chapter_number', args.chapterNumber)
        .eq('is_active', true)
        .order('chunk_index', { ascending: true });

      if (error || !data || data.length === 0) return null;

      const sources: ChapterContentSource[] = [];
      let totalBytes = 0;
      const parts: string[] = [];
      let truncated = false;

      for (const row of data) {
        const text = (row.chunk_text as string) || '';
        if (!text) continue;
        const segmentBytes = Buffer.byteLength(text, 'utf8');
        if (totalBytes + segmentBytes > MAX_MARKDOWN_BYTES) {
          truncated = true;
          break;
        }
        parts.push(text);
        totalBytes += segmentBytes;
        sources.push({
          chunk_id: row.id as string,
          chapter_title: (row.chapter_title as string | null) ?? null,
          chunk_index: (row.chunk_index as number | null) ?? null,
          page_number: (row.page_number as number | null) ?? null,
        });
      }

      if (parts.length === 0) return null;

      return {
        markdown: parts.join('\n\n'),
        sources,
        truncated,
      };
    },
  );
}
