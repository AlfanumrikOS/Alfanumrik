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
 * Subject-code validation (P2-7c sibling): `subject` must be one of the
 * student's subject CODES (get_available_subjects — same source as
 * /v2/learn/curriculum). An unknown value (display name "Mathematics",
 * garbage) is a 400 UNKNOWN_SUBJECT with the allowed codes — previously it
 * fell through to a 404 NO_CONTENT, indistinguishable from a genuine content
 * gap. Locked subjects still resolve: this is param validation, not plan
 * gating. Fails CLOSED (503) if the subjects RPC is unavailable.
 *
 * The student's preferred language is honored (en/hi) with the helper's built-in
 * English fallback when Hindi chunks are missing.
 *
 * P5: grade is a string.
 *
 * Auth: study_plan.view (student-scoped read).
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { fetchChapterContent } from '@alfanumrik/lib/learn/fetchChapterContent';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';

export const GET = withRoute(async (request: NextRequest) => {
  try {
    const auth = await authorizeRequest(request, 'study_plan.view', {
      requireStudentId: true,
    });
    if (!auth.authorized || !auth.userId) return auth.errorResponse as unknown as NextResponse;

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

    // Subject-code validation (P2-7c sibling) — same source as /v2/learn/
    // curriculum (get_available_subjects, keyed by auth user). Unknown value →
    // 400 with the valid codes, so a bad param can never masquerade as the
    // 404 NO_CONTENT content-gap signal. Fails CLOSED on RPC outage.
    const { data: subjData, error: subjErr } = await admin.rpc('get_available_subjects', {
      p_student_id: auth.userId,
    });
    if (subjErr) {
      logger.error('v2_learn_concept_subject_governance_unavailable', {
        error: new Error(subjErr.message),
        route: '/api/v2/learn/concept',
        subject,
      });
      return v2Error(
        'Subject eligibility could not be verified — please retry',
        503,
        'SUBJECT_GOVERNANCE_UNAVAILABLE',
        true,
      );
    }
    const allowedCodes = ((subjData ?? []) as Array<{ code: string }>).map((s) => s.code);
    if (!allowedCodes.includes(subject)) {
      return v2Error(
        `Unknown subject '${subject}' — subject must be one of this student's subject codes: ${allowedCodes.join(', ')}`,
        400,
        'UNKNOWN_SUBJECT',
        undefined,
        { subject, reason: 'unknown_subject', allowed: allowedCodes },
      );
    }

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
});
