import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/grounding/coverage
 *
 * Surfaces ingestion_gaps (cbse_syllabus rows where rag_status != 'ready').
 *
 * Query params:
 *   ?grade=10        filter by grade string
 *   ?subject=science filter by subject_code
 *
 * Auth: super_admin.access permission.
 */

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const params = new URL(request.url).searchParams;
    const grade = params.get('grade');
    const subject = params.get('subject');

    let query = supabaseAdmin
      .from('ingestion_gaps')
      .select(
        'board, grade, subject_code, subject_display, chapter_number, chapter_title, ' +
        'rag_status, chunk_count, verified_question_count, severity, request_count, ' +
        'potential_affected_students, last_verified_at'
      );

    if (grade) query = query.eq('grade', grade);
    if (subject) query = query.eq('subject_code', subject);

    // Sort matches docs §5.5: severity DESC (critical first), then request_count DESC,
    // then potential_affected_students DESC.
    query = query.order('severity', { ascending: false })
      .order('request_count', { ascending: false })
      .order('potential_affected_students', { ascending: false })
      .limit(1000);

    const { data, error } = await query;
    if (error) throw new Error(`ingestion_gaps: ${error.message}`);

    const gaps = ((data ?? []) as unknown) as Array<{
      board: string; grade: string; subject_code: string; subject_display: string;
      chapter_number: number; chapter_title: string;
      rag_status: string; chunk_count: number; verified_question_count: number;
      severity: string; request_count: number;
      potential_affected_students: number; last_verified_at: string | null;
    }>;

    let critical = 0, high = 0, medium = 0;
    for (const g of gaps) {
      if (g.severity === 'critical') critical++;
      else if (g.severity === 'high') high++;
      else if (g.severity === 'medium') medium++;
    }

    return NextResponse.json({
      success: true,
      data: {
        gaps,
        summary: {
          total_gaps: gaps.length,
          critical,
          high,
          medium,
        },
        filters: { grade: grade || null, subject: subject || null },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}