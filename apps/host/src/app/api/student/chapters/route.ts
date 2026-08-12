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
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';

// Response contract of available_chapters_for_student_subject_v2.
//
// The two *_ready_count fields are added by migration 20260814000014
// (Decision A option 3, tiered verification) and are OPTIONAL here on purpose:
// this route must keep working against a database where that migration has not
// been applied yet, in which case the RPC returns the original four columns and
// these come back undefined. Callers must treat `undefined` as "unknown" and
// fall back to their previous rendering — never as zero.
//
//   verified_question_count  UNCHANGED. verification_state = 'verified' only.
//                            An agent proved this against NCERT. NOT a
//                            servability signal — do not badge with it.
//   practice_ready_count     Questions the practice / daily-quiz path can
//                            actually serve today (Tier-0 floor). This is the
//                            honest "how many questions do I get" number.
//   exam_ready_count         practice floor AND the human SME gate
//                            (is_verified) that mock tests still enforce.
//                            Chapter-level upper bound: mock papers assemble at
//                            subject scope with an extra source_type filter, so
//                            > 0 does not guarantee a paper can be filled, but
//                            0 does reliably mean "nothing here can appear in a
//                            mock test".
interface ChapterV2Row {
  chapter_number: number;
  chapter_title: string;
  chapter_title_hi: string | null;
  verified_question_count: number;
  practice_ready_count?: number;
  exam_ready_count?: number;
}

interface ChapterResponse {
  chapter_number: number;
  chapter_title: string;
  chapter_title_hi: string | null;
  verified_question_count: number;
  practice_ready_count?: number;
  exam_ready_count?: number;
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
      // Passed through verbatim. `undefined` (pre-migration DB) serialises away
      // rather than becoming 0 — see the contract note above.
      practice_ready_count: r.practice_ready_count,
      exam_ready_count: r.exam_ready_count,
    }));

    return NextResponse.json({ chapters });
  } catch (e) {
    logger.error('student_chapters_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
