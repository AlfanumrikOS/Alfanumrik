/**
 * THROWAWAY proving-ground agent for the LLM-as-planner loop.
 *
 * Goal: validate the loop end-to-end with the smallest tool surface
 * that forces ≥2 chained tool calls.
 *
 * DELETE THIS FILE in the next agent spec (Daily Planner or
 * Question-Bank QA), along with the admin route and smoke script.
 *
 * Spec: docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md §6
 *
 * Schema reality (production, verified 2026-05-10):
 * - rag_content_chunks rows are keyed by (subject_code, grade_short, chapter_number, chunk_index)
 * - topic, page_number, chapter_title (per-chapter) are NULL for most subjects
 * - chapter name lives in the first chunk's text (chunk_index = 0)
 * Hence tools query by chapter_number, and the agent uses chunk previews
 * to identify which chapter matches the user's description.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { runAgent } from '../runAgent';
import type { ToolDefinition, AgentResult } from '../types';

const SYSTEM_PROMPT = `You are a content explorer for NCERT textbooks. The user names a chapter by topic or title; your job is to identify the matching chapter_number, fetch its content, and produce a single paragraph (3-5 sentences) summarizing the main ideas.

You MUST use the available tools — do not rely on memory.

Workflow:
1. Call list_chapters_for_subject to see all chapters with chunk-count and a short preview of each.
2. Pick the chapter_number whose preview best matches the user's described chapter.
3. Call get_chapter_chunks for that chapter_number to fetch 3-5 chunks of actual content.
4. Write the paragraph based on what you read.

Do not call any tool more than 4 times total. Once you have enough material, stop calling tools and write the paragraph.`;

interface ListChaptersInput {
  subject: string;
  grade: string;
}

interface ListChaptersOutput {
  chapters: Array<{ chapter_number: number; chunks: number; preview: string }>;
}

const listChaptersForSubject: ToolDefinition<ListChaptersInput, ListChaptersOutput> = {
  name: 'list_chapters_for_subject',
  description:
    'List all chapters available for a subject + grade. Returns chapter_number, chunk count, and a short text preview from the first chunk so you can identify which chapter is which.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Lowercase subject_code, e.g. "science", "mathematics".' },
      grade: { type: 'string', enum: ['6', '7', '8', '9', '10', '11', '12'] },
    },
    required: ['subject', 'grade'],
  },
  handler: async (input) => {
    const { data, error } = await supabaseAdmin
      .from('rag_content_chunks')
      .select('chapter_number, chunk_index, chunk_text')
      .eq('subject_code', input.subject.toLowerCase())
      .eq('grade_short', input.grade)
      .eq('is_active', true)
      .not('chapter_number', 'is', null);

    if (error) {
      throw new Error(`list_chapters_for_subject failed: ${error.message}`);
    }

    type Row = { chapter_number: number; chunk_index: number; chunk_text: string | null };
    const rows = (data ?? []) as Row[];

    const byChapter = new Map<number, { chunks: number; preview: string }>();
    for (const r of rows) {
      const entry = byChapter.get(r.chapter_number) ?? { chunks: 0, preview: '' };
      entry.chunks += 1;
      if (r.chunk_index === 0 && r.chunk_text) {
        entry.preview = r.chunk_text.slice(0, 200).replace(/\s+/g, ' ').trim();
      }
      byChapter.set(r.chapter_number, entry);
    }

    const chapters = Array.from(byChapter.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([chapter_number, v]) => ({ chapter_number, chunks: v.chunks, preview: v.preview }));

    return { chapters };
  },
  redactInTrace: (input, output) => ({ input, output }),
};

interface GetChapterChunksInput {
  subject: string;
  grade: string;
  chapter_number: number;
  from_index?: number;
  count?: number;
}

interface GetChapterChunksOutput {
  chunks: Array<{ id: string; chunk_index: number; chunk_text: string }>;
}

const getChapterChunks: ToolDefinition<GetChapterChunksInput, GetChapterChunksOutput> = {
  name: 'get_chapter_chunks',
  description:
    'Fetch up to N consecutive content chunks from a specific chapter. Each chunk_text is trimmed to 800 chars. Use chunk_index to navigate within the chapter (0 is the first chunk).',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      grade: { type: 'string', enum: ['6', '7', '8', '9', '10', '11', '12'] },
      chapter_number: { type: 'integer', minimum: 1 },
      from_index: { type: 'integer', minimum: 0, default: 0 },
      count: { type: 'integer', minimum: 1, maximum: 8, default: 4 },
    },
    required: ['subject', 'grade', 'chapter_number'],
  },
  handler: async (input) => {
    const fromIndex = input.from_index ?? 0;
    const count = Math.min(input.count ?? 4, 8);

    const { data, error } = await supabaseAdmin
      .from('rag_content_chunks')
      .select('id, chunk_index, chunk_text')
      .eq('subject_code', input.subject.toLowerCase())
      .eq('grade_short', input.grade)
      .eq('chapter_number', input.chapter_number)
      .eq('is_active', true)
      .gte('chunk_index', fromIndex)
      .order('chunk_index', { ascending: true })
      .limit(count);

    if (error) {
      throw new Error(`get_chapter_chunks failed: ${error.message}`);
    }

    type Row = { id: string; chunk_index: number; chunk_text: string | null };
    const rows = (data ?? []) as Row[];
    return {
      chunks: rows.map((r) => ({
        id: r.id,
        chunk_index: r.chunk_index,
        chunk_text: (r.chunk_text ?? '').slice(0, 800),
      })),
    };
  },
  redactInTrace: (input, output) => ({ input, output }),
};

export interface ChapterExplorerArgs {
  subject: string;
  grade: string;
  /** Chapter description or title — agent will resolve to chapter_number via list_chapters_for_subject. */
  chapter: string;
  userId?: string | null;
}

export async function runChapterExplorer(args: ChapterExplorerArgs): Promise<AgentResult> {
  const userPrompt = `Summarize the main ideas of NCERT Class ${args.grade} ${args.subject}, the chapter titled or about "${args.chapter}".`;

  return runAgent({
    agentName: 'chapter-explorer',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    tools: [listChaptersForSubject, getChapterChunks],
    budget: { maxSteps: 6, maxTotalTokens: 30_000, maxWallMs: 25_000 },
    ctx: {
      userId: args.userId ?? null,
      meta: { subject: args.subject, grade: args.grade, chapter: args.chapter },
    },
  });
}
