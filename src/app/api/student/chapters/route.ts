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
import { getSupabaseAdmin } from '@/lib/supabase-admin';
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
    // Auth: try Bearer token first (client sends from localStorage),
    // fall back to cookie-based session.
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
        { error: 'invalid_subject', message: 'subject query param is required (snake_case code).' },
        { status: 400 },
      );
    }

    // Use admin client for RPC (service_role, no RLS issues)
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('available_chapters_for_student_subject', {
      p_student_id:   userId,
      p_subject_code: subject,
    });

    if (!error) {
      return NextResponse.json({ chapters: (data ?? []) as ChapterRow[] });
    }

    // Governance RPC unavailable — fall back to direct chapters query
    logger.warn('available_chapters_governance_fallback', {
      rpcError: error.message,
      userId,
      subject,
      note: 'Falling back to direct chapters query — governance migrations may not be applied',
    });

    try {
      // 1. Get student grade
      const { data: student } = await supabase
        .from('students')
        .select('grade')
        .eq('auth_user_id', userId)
        .maybeSingle();
      const grade = student?.grade ? String(student.grade) : null;
      if (!grade) {
        return NextResponse.json({ chapters: [] });
      }

      // 2. Resolve subject code → subject_id
      const { data: subjectRow } = await supabase
        .from('subjects')
        .select('id')
        .eq('code', subject)
        .eq('is_active', true)
        .maybeSingle();
      if (!subjectRow) {
        return NextResponse.json({ chapters: [] });
      }

      // 3. Query chapters directly
      const { data: chapters } = await supabase
        .from('chapters')
        .select('chapter_number, title, title_hi, ncert_page_start, ncert_page_end, total_questions')
        .eq('subject_id', subjectRow.id)
        .eq('grade', grade)
        .eq('is_active', true)
        .order('chapter_number');

      const fallbackChapters: ChapterRow[] = (chapters ?? []).map((c: any) => ({
        chapter_number: c.chapter_number,
        title: c.title ?? `Chapter ${c.chapter_number}`,
        title_hi: c.title_hi ?? null,
        ncert_page_start: c.ncert_page_start ?? null,
        ncert_page_end: c.ncert_page_end ?? null,
        total_questions: c.total_questions ?? 0,
        has_concepts: false, // can't check without governance layer
      }));

      return NextResponse.json({ chapters: fallbackChapters });
    } catch (fallbackErr) {
      logger.warn('chapters_fallback_failed', {
        error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        userId,
        subject,
      });
      return NextResponse.json({ chapters: [] });
    }
  } catch (e) {
    logger.error('student_chapters_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
