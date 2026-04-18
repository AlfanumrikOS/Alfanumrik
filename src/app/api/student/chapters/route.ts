// src/app/api/student/chapters/route.ts
//
// GET /api/student/chapters?subject=<code>
//
// Returns the list of ready chapters for the authenticated student + subject,
// sourced from cbse_syllabus via available_chapters_for_student_subject_v2().
//
// Phase 3 change (spec §5.1, §7):
//   Removed the soft-fail fallback. An RPC failure returned 500.
//
// Phase 4 hotfix (2026-04-18, study-path breakage post-deploy):
//   v2 RPC widened to rag_status IN ('partial', 'ready'). When cbse_syllabus
//   returns zero chapters for the (grade, subject) pair, fall back to the
//   `chapters` catalog table for that subject so the picker stays functional
//   during drain. Fallback logged to ops_events.

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

interface ChapterV2Row {
  chapter_number: number;
  chapter_title: string;
  chapter_title_hi: string | null;
  verified_question_count: number;
}

interface ChapterResponse {
  chapter_number: number;
  chapter_title: string;
  chapter_title_hi: string | null;
  verified_question_count: number;
}

async function logFallback(
  studentId: string,
  subject: string,
  reason: string,
  chapterCount: number,
) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from('ops_events').insert({
      category: 'grounding.study_path',
      source: 'api.student.chapters',
      severity: 'warning',
      message: `chapters fallback engaged: ${reason}`,
      subject_type: 'student',
      subject_id: studentId,
      context: { reason, subject, fallback_chapter_count: chapterCount },
    });
  } catch {
    // Non-blocking.
  }
}

/**
 * Fallback: read chapters from the legacy `chapters` catalog table for the
 * student's grade + subject. Returns `verified_question_count: 0` to signal
 * "unverified coverage" — AI surfaces below enforce their own stricter gates.
 */
async function fallbackChaptersFromCatalog(
  grade: string,
  subjectCode: string,
): Promise<ChapterResponse[]> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('chapters')
      .select('chapter_number, chapter_title, chapter_title_hi')
      .eq('grade', grade)
      .eq('subject_code', subjectCode)
      .order('chapter_number', { ascending: true });

    if (error || !data) return [];
    return data.map((c) => ({
      chapter_number: Number(c.chapter_number),
      chapter_title: String(c.chapter_title ?? ''),
      chapter_title_hi: c.chapter_title_hi ? String(c.chapter_title_hi) : null,
      verified_question_count: 0,
    }));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    // Auth: Bearer token first (client sends from localStorage), then cookie.
    let userId: string | null = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const admin = getSupabaseAdmin();
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (!error && user) userId = user.id;
    }

    if (!userId) {
      const supabase = await createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) userId = user.id;
    }

    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const subject = url.searchParams.get('subject');
    if (!subject || !/^[a-z_]+$/.test(subject)) {
      return NextResponse.json(
        {
          error: 'invalid_subject',
          message: 'subject query param is required (snake_case code).',
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc(
      'available_chapters_for_student_subject_v2',
      { p_student_id: userId, p_subject_code: subject },
    );

    if (error) {
      logger.error('chapters.v2_rpc_failed', {
        userId,
        subject,
        rpcError: error.message,
      });
      // RPC failure: try the legacy chapters catalog fallback before 500.
      const { data: student } = await supabase
        .from('students')
        .select('grade')
        .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();
      if (student?.grade) {
        const chapters = await fallbackChaptersFromCatalog(
          String(student.grade),
          subject,
        );
        if (chapters.length > 0) {
          await logFallback(userId, subject, 'v2_rpc_error', chapters.length);
          return NextResponse.json({ chapters });
        }
      }
      return NextResponse.json(
        { error: 'service_unavailable' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as ChapterV2Row[];

    // Drain window or unpopulated cbse_syllabus: fall back to `chapters`
    // catalog for this (grade, subject). Still returns empty if the catalog
    // itself is empty — client renders an empty-state card.
    if (rows.length === 0) {
      const { data: student } = await supabase
        .from('students')
        .select('grade')
        .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();
      if (student?.grade) {
        const chapters = await fallbackChaptersFromCatalog(
          String(student.grade),
          subject,
        );
        if (chapters.length > 0) {
          await logFallback(userId, subject, 'v2_empty_rows', chapters.length);
          return NextResponse.json({ chapters });
        }
      }
      return NextResponse.json({ chapters: [] });
    }

    const chapters: ChapterResponse[] = rows.map((r) => ({
      chapter_number: r.chapter_number,
      chapter_title: r.chapter_title,
      chapter_title_hi: r.chapter_title_hi,
      verified_question_count: r.verified_question_count,
    }));

    return NextResponse.json({ chapters });
  } catch (e) {
    logger.error('student_chapters_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
