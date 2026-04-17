// src/app/api/student/subjects/route.ts
//
// GET /api/student/subjects
//
// Returns the list of subjects the authenticated student can access, sourced
// from the cbse_syllabus Layer-2 SSoT via get_available_subjects_v2().
//
// Phase 3 change (spec §5.1, §7):
//   Removed the soft-fail fallback to GRADE_SUBJECTS + SUBJECT_META. An RPC
//   failure NOW returns 500 { error: 'service_unavailable' } instead of
//   silently returning a (possibly stale) constants-derived list. Explicit
//   failure is required because the legacy path could surface subjects that
//   have no NCERT content ready — which violates P12 (AI safety).
//
// GRADE_SUBJECTS/SUBJECT_META are retained in @/lib/constants temporarily;
// TODO-1 tracks their full removal.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

interface SubjectV2Row {
  subject_code: string;
  subject_display: string;
  subject_display_hi: string | null;
  ready_chapter_count: number;
}

export async function GET(request: NextRequest) {
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

    // Admin client for RPC (bypasses RLS; the RPC enforces caller ownership
    // internally via (students.id OR students.auth_user_id) = p_student_id).
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.rpc('get_available_subjects_v2', {
      p_student_id: userId,
    });

    if (error) {
      logger.error('subjects.v2_rpc_failed', {
        userId,
        rpcError: error.message,
      });
      return NextResponse.json(
        { error: 'service_unavailable' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as SubjectV2Row[];

    // Empty result = student has no ready subjects yet. This is a legitimate
    // state (e.g. new grade with ingestion pending) and is returned as 200
    // with an empty array — the client shows an "no content yet" banner.
    // If the student row itself is missing the RPC also returns empty, so we
    // cannot distinguish "missing student" from "no ready content"; both
    // surface as an empty subjects list which is safe.

    const subjects = rows.map((r) => ({
      code: r.subject_code,
      name: r.subject_display,
      nameHi: r.subject_display_hi ?? r.subject_display,
      readyChapterCount: r.ready_chapter_count,
    }));

    return NextResponse.json({ subjects });
  } catch (e) {
    logger.error('subjects.list_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}