/**
 * Safe DB adapter for fetching approved NCERT content chunks.
 *
 * Queries rag_chunks filtered by grade and subject (P5: grade as string).
 * Never throws — returns empty array on error.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { RetrievedChunk } from '../types';

const DEFAULT_LIMIT = 10;

export async function getNcertChunks(params: {
  subject: string;
  grade: string;
  chapter?: string;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const { subject, grade, chapter, limit = DEFAULT_LIMIT } = params;

  try {
    let query = supabaseAdmin
      .from('rag_chunks')
      .select('id, content, subject, chapter, page_number, content_type')
      .eq('subject', subject)
      .eq('grade', grade)
      .limit(limit);

    if (chapter) {
      query = query.eq('chapter', chapter);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to fetch NCERT chunks', {
        error: error.message,
        subject,
        grade,
        chapter: chapter ?? null,
      });
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      content: row.content,
      subject: row.subject,
      chapter: row.chapter ?? undefined,
      pageNumber: row.page_number ?? undefined,
      similarity: 1.0, // Direct DB fetch, not vector similarity
      contentType: row.content_type ?? undefined,
    }));
  } catch (err) {
    logger.error('Unexpected error fetching NCERT chunks', {
      error: err instanceof Error ? err.message : String(err),
      subject,
      grade,
    });
    return [];
  }
}
