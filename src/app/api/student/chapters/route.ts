// src/app/api/student/chapters/route.ts
//
// GET /api/student/chapters?subject=<code>
//
// Returns the list of ready chapters for the authenticated student + subject,
// sourced from cbse_syllabus via available_chapters_for_student_subject_v2().
//
// Phase 3 change (spec §5.1, §7):
//   Removed the soft-fail fallback. An RPC failure returns service_unavailable.
//
// Phase 4 hotfix (2026-04-18, reverted 2026-04-24 for R2 stabilization):
//   The legacy `chapters` catalog fallback introduced during the study-path
//   drain window has been removed again. Regression #4 in
//   regression-academic-chain.test.ts pins this contract: the route MUST NOT
//   read from the `chapters` table, because silent fallback to a stale
//   catalog produces cross-grade leakage and unverified question counts that
//   downstream AI surfaces cannot distinguish from ground truth. When
//   cbse_syllabus is unpopulated for a (grade, subject) pair the client sees
//   an explicit empty list and an empty-state card.
//
// Failure modes:
//   - Unauthenticated                   -> 401 { error: 'unauthorized' }
//   - Missing/invalid subject param     -> 400 { error: 'invalid_subject' }
//   - RPC error                         -> 503 { error: 'service_unavailable' }
//   - RPC returns zero rows             -> 200 { chapters: [] }
//   - Success                           -> 200 { chapters: [...] }
//   - Any other exception               -> 500 { error: 'internal_error' }

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
      // Fail hard — no soft-fall to the legacy chapters catalog. See file
      // header for the rationale and the regression-academic-chain.test.ts
      // assertion that pins this contract.
      return NextResponse.json(
        { error: 'service_unavailable' },
        { status: 503 },
      );
    }

    const rows = (data ?? []) as ChapterV2Row[];

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
