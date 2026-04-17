// src/app/api/student/chapters/route.ts
//
// GET /api/student/chapters?subject=<code>
//
// Governed chapter listing. Returns ONLY chapters that the authenticated
// student is allowed to access (subject must be in get_available_subjects()
// AND not is_locked). Backed by available_chapters_for_student_subject RPC,
// which intersects (grade ∩ plan ∩ stream ∩ is_content_ready) and refuses
// to return ANY rows for subjects the student cannot access.
//
// Replaces the legacy anon-client `getChaptersForSubject(subject, grade)`
// helper in src/lib/supabase.ts which read the chapters table directly with
// no governance.

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

interface ChapterRow {
  chapter_number: number;
  title: string;
  title_hi: string | null;
  ncert_page_start: number | null;
  ncert_page_end: number | null;
  total_questions: number;
  has_concepts: boolean;
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const subject = url.searchParams.get('subject');
    if (!subject || !/^[a-z_]+$/.test(subject)) {
      return NextResponse.json(
        { error: 'invalid_subject', message: 'subject query param is required (snake_case code).' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc('available_chapters_for_student_subject', {
      p_student_id:   user.id,
      p_subject_code: subject,
    });

    if (error) {
      logger.error('available_chapters_rpc_failed', {
        error: new Error(error.message),
        userId: user.id,
        subject,
      });
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }

    return NextResponse.json({ chapters: (data ?? []) as ChapterRow[] });
  } catch (e) {
    logger.error('student_chapters_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
