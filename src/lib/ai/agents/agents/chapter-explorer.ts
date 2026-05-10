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
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { runAgent } from '../runAgent';
import type { ToolDefinition, AgentResult } from '../types';

const SYSTEM_PROMPT = `You are a content explorer for NCERT textbooks. Given a subject, grade, and chapter, produce a single paragraph (3-5 sentences) summarizing the chapter's main ideas.

You MUST use the available tools to look up actual NCERT content — do not rely on memory.

Workflow:
1. Call list_chapter_pages to see how the chapter is structured.
2. Call lookup_chapter_chunks to fetch actual content from 1-2 of the most central pages.
3. Write a paragraph that reflects what you read.

Do not call any tool more than 4 times total. Once you have enough material, stop calling tools and write the paragraph.`;

interface ListChapterPagesInput {
  subject: string;
  grade: string;
  chapter: string;
}

interface ListChapterPagesOutput {
  pages: Array<{ page_number: number; chunk_count: number }>;
  chapter_title_matched: string | null;
}

const listChapterPages: ToolDefinition<ListChapterPagesInput, ListChapterPagesOutput> = {
  name: 'list_chapter_pages',
  description:
    'List the page numbers covered by a specific NCERT chapter, with the number of content chunks on each page. Useful to see how a chapter is structured before fetching content.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Lowercase subject code, e.g. "science", "mathematics".' },
      grade: { type: 'string', enum: ['6', '7', '8', '9', '10', '11', '12'] },
      chapter: { type: 'string', description: 'Chapter title (e.g. "Force and Laws of Motion") or partial match.' },
    },
    required: ['subject', 'grade', 'chapter'],
  },
  handler: async (input) => {
    const { data, error } = await supabaseAdmin
      .from('rag_content_chunks')
      .select('page_number, chapter_title')
      .eq('subject_code', input.subject.toLowerCase())
      .eq('grade_short', input.grade)
      .ilike('chapter_title', `%${input.chapter}%`)
      .eq('is_active', true);

    if (error) {
      throw new Error(`list_chapter_pages query failed: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ page_number: number | null; chapter_title: string | null }>;
    const matchedTitle = rows[0]?.chapter_title ?? null;

    const byPage = new Map<number, number>();
    for (const r of rows) {
      if (r.page_number == null) continue;
      byPage.set(r.page_number, (byPage.get(r.page_number) ?? 0) + 1);
    }
    const pages = Array.from(byPage.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([page_number, chunk_count]) => ({ page_number, chunk_count }));

    return { pages, chapter_title_matched: matchedTitle };
  },
  redactInTrace: (input, output) => ({ input, output }),
};

interface LookupChapterChunksInput {
  subject: string;
  grade: string;
  chapter: string;
  from_page?: number;
  to_page?: number;
  limit?: number;
}

interface LookupChapterChunksOutput {
  chunks: Array<{ id: string; page_number: number | null; chunk_text: string }>;
}

const lookupChapterChunks: ToolDefinition<LookupChapterChunksInput, LookupChapterChunksOutput> = {
  name: 'lookup_chapter_chunks',
  description:
    'Fetch up to N NCERT content chunks for a specific chapter, optionally restricted to a page range. Returns chunk text trimmed to 800 chars each.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      grade: { type: 'string', enum: ['6', '7', '8', '9', '10', '11', '12'] },
      chapter: { type: 'string' },
      from_page: { type: 'integer', minimum: 1 },
      to_page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 8, default: 4 },
    },
    required: ['subject', 'grade', 'chapter'],
  },
  handler: async (input) => {
    const limit = Math.min(input.limit ?? 4, 8);
    let query = supabaseAdmin
      .from('rag_content_chunks')
      .select('id, page_number, chunk_text')
      .eq('subject_code', input.subject.toLowerCase())
      .eq('grade_short', input.grade)
      .ilike('chapter_title', `%${input.chapter}%`)
      .eq('is_active', true)
      .order('page_number', { ascending: true })
      .order('chunk_index', { ascending: true })
      .limit(limit);

    if (input.from_page != null) query = query.gte('page_number', input.from_page);
    if (input.to_page != null) query = query.lte('page_number', input.to_page);

    const { data, error } = await query;

    if (error) {
      throw new Error(`lookup_chapter_chunks query failed: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ id: string; page_number: number | null; chunk_text: string | null }>;
    return {
      chunks: rows.map((r) => ({
        id: r.id,
        page_number: r.page_number,
        chunk_text: (r.chunk_text ?? '').slice(0, 800),
      })),
    };
  },
  redactInTrace: (input, output) => ({ input, output }),
};

export interface ChapterExplorerArgs {
  subject: string;
  grade: string;
  chapter: string;
  userId?: string | null;
}

export async function runChapterExplorer(args: ChapterExplorerArgs): Promise<AgentResult> {
  const userPrompt = `Summarize the main ideas of NCERT Class ${args.grade} ${args.subject}, chapter "${args.chapter}".`;

  return runAgent({
    agentName: 'chapter-explorer',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    tools: [listChapterPages, lookupChapterChunks],
    budget: { maxSteps: 6, maxTotalTokens: 30_000, maxWallMs: 25_000 },
    ctx: {
      userId: args.userId ?? null,
      meta: { subject: args.subject, grade: args.grade, chapter: args.chapter },
    },
  });
}
