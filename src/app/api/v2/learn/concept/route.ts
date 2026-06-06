/**
 * GET /api/v2/learn/concept — concept content for a subject + chapter (mobile Learn).
 *
 * Thin read. Reuses fetchChapterContent (src/lib/learn/fetchChapterContent.ts) —
 * the SAME rag_content_chunks reader the web /learn/[subject]/[chapter] read mode
 * uses (ordered chunk_text + per-chunk source attribution, is_active filtered,
 * 5-min cache, 50 KB cap). No new query logic.
 *
 * Academic-scope safety: the requested grade must match the student's profile
 * grade (403 otherwise) — mirrors the /api/quiz grade-match guard so a student
 * can't read out-of-grade content.
 *
 * The student's preferred language is honored (en/hi) with the helper's built-in
 * English fallback when Hindi chunks are missing.
 *
 * P5: grade is a string.
 *
 * Auth: study_plan.view (student-scoped read).
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { fetchChapterContent } from '@/lib/learn/fetchChapterContent';
import { logger } from '@/lib/logger';
import { v2Success, v2Error } from '@/lib/api/v2/envelope';

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'study_plan.view', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const subject = url.searchParams.get('subject');
    const grade = url.searchParams.get('grade');
    const chapterParam = url.searchParams.get('chapter');

    if (!subject || !grade || !chapterParam) {
      return v2Error('Missing required parameters: subject, grade, chapter', 400, 'VALIDATION_ERROR');
    }
    if (!/^(6|7|8|9|10|11|12)$/.test(grade)) {
      return v2Error('Grade must be a string from "6" through "12"', 400, 'VALIDATION_ERROR');
    }
    const chapter = parseInt(chapterParam, 10);
    if (Number.isNaN(chapter) || chapter < 1) {
      return v2Error('chapter must be a positive integer', 400, 'VALIDATION_ERROR');
    }

    // Grade-match guard + preferred language (one read).
    const admin = getSupabaseAdmin();
    const { data: student } = await admin
      .from('students')
      .select('grade, preferred_language')
      .eq('id', auth.studentId)
      .maybeSingle();
    if (!student?.grade) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }
    if (String(student.grade) !== grade) {
      return v2Error('Requested grade does not match your profile grade', 403, 'GRADE_MISMATCH');
    }
    const language: 'en' | 'hi' = student.preferred_language === 'hi' ? 'hi' : 'en';

    // Reuse the existing sanctioned chapter-content reader.
    const content = await fetchChapterContent({
      subjectCode: subject,
      grade,
      chapterNumber: chapter,
      language,
    });

    if (!content) {
      return v2Error('No content available for this chapter', 404, 'NO_CONTENT');
    }

    return v2Success({
      schemaVersion: 1 as const,
      subject,
      grade,
      chapter_number: chapter,
      markdown: content.markdown,
      sources: content.sources,
      truncated: content.truncated,
      language: content.language,
      fell_back_from_hindi: content.fellBackFromHindi,
    });
  } catch (err) {
    logger.error('v2_learn_concept_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/learn/concept',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
