// src/app/api/student/chapters/route.ts
//
// GET /api/student/chapters?subject=<code>
//
// Returns the list of ready chapters for the authenticated student + subject,
// sourced from cbse_syllabus via available_chapters_for_student_subject_v2().
//
// Phase 3 change (spec §5.1, §7):
//   Removed the soft-fail fallback to the direct chapters table read. An RPC
//   failure NOW returns 500 { error: 'service_unavailable' } instead of
//   silently returning a (possibly inaccurate) chapters-table-derived list.

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
      return NextResponse.json(
        { error: 'service_unavailable' },
        { status: 500 },
      );
    }

    // Empty result is legitimate (subject has no ready chapters for this
    // grade yet). Return 200 with an empty list; client shows an empty-state
    // card.
    const chapters = ((data ?? []) as ChapterV2Row[]).map((r) => ({
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