import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logSchoolAudit } from '@/lib/audit';

const VALID_EXPORT_TYPES = ['students', 'quiz_results', 'progress', 'full'] as const;
type ExportType = typeof VALID_EXPORT_TYPES[number];

// ─── CSV helpers ────────────────────────────────────────────

/** Escape a single CSV field (handles commas, quotes, newlines). */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Build a CSV string from headers and rows. */
function buildCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(csvField).join(',');
  const dataLines = rows.map((row) => row.map(csvField).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

// ─── Export generators ──────────────────────────────────────

async function exportStudents(schoolId: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: students, error } = await supabase
    .from('students')
    .select('id, name, grade, is_active, xp_total, last_active, created_at')
    .eq('school_id', schoolId)
    .order('name', { ascending: true });

  if (error) throw new Error(`Students query failed: ${error.message}`);

  const headers = ['id', 'name', 'grade', 'is_active', 'xp_total', 'last_active', 'created_at'];
  const rows = (students ?? []).map((s) => [
    s.id,
    s.name,
    s.grade,   // string per P5
    s.is_active ? 'Yes' : 'No',
    s.xp_total ?? 0,
    s.last_active ?? '',
    s.created_at,
  ]);

  // P13: NO email/phone columns included
  return buildCsv(headers, rows);
}

async function exportQuizResults(schoolId: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  // Get student IDs and names for this school
  const { data: students } = await supabase
    .from('students')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  if (!students || students.length === 0) {
    return buildCsv(
      ['student_name', 'subject', 'score_percent', 'total_questions', 'correct_answers', 'created_at'],
      []
    );
  }

  const studentIds = students.map((s) => s.id);
  const nameMap = new Map(students.map((s) => [s.id, s.name]));

  const { data: quizzes, error } = await supabase
    .from('quiz_sessions')
    .select('student_id, subject, score_percent, total_questions, correct_answers, created_at')
    .in('student_id', studentIds)
    .eq('is_completed', true)
    .order('created_at', { ascending: false })
    .limit(10000); // Cap at 10K rows to prevent timeout

  if (error) throw new Error(`Quiz results query failed: ${error.message}`);

  const headers = ['student_name', 'subject', 'score_percent', 'total_questions', 'correct_answers', 'created_at'];
  const rows = (quizzes ?? []).map((q) => [
    nameMap.get(q.student_id) || 'Unknown',
    q.subject ?? '',
    q.score_percent ?? 0,
    q.total_questions ?? 0,
    q.correct_answers ?? 0,
    q.created_at,
  ]);

  return buildCsv(headers, rows);
}

async function exportProgress(schoolId: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  // Get students for this school
  const { data: students } = await supabase
    .from('students')
    .select('id, name, grade, xp_total, last_active')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  if (!students || students.length === 0) {
    return buildCsv(
      ['student_name', 'grade', 'xp_total', 'total_quizzes', 'avg_score', 'last_active'],
      []
    );
  }

  const studentIds = students.map((s) => s.id);

  // Aggregate quiz data per student
  const { data: quizzes } = await supabase
    .from('quiz_sessions')
    .select('student_id, score_percent')
    .in('student_id', studentIds)
    .eq('is_completed', true);

  // Build per-student aggregates
  const quizAgg = new Map<string, { count: number; totalScore: number }>();
  for (const q of quizzes ?? []) {
    const agg = quizAgg.get(q.student_id) || { count: 0, totalScore: 0 };
    agg.count += 1;
    agg.totalScore += q.score_percent || 0;
    quizAgg.set(q.student_id, agg);
  }

  const headers = ['student_name', 'grade', 'xp_total', 'total_quizzes', 'avg_score', 'last_active'];
  const rows = students.map((s) => {
    const agg = quizAgg.get(s.id);
    const avgScore = agg && agg.count > 0
      ? Math.round(agg.totalScore / agg.count * 100) / 100
      : 0;
    return [
      s.name,
      s.grade, // string per P5
      s.xp_total ?? 0,
      agg?.count ?? 0,
      avgScore,
      s.last_active ?? '',
    ];
  });

  return buildCsv(headers, rows);
}

async function exportFull(schoolId: string): Promise<string> {
  const [studentsCsv, quizCsv, progressCsv] = await Promise.all([
    exportStudents(schoolId),
    exportQuizResults(schoolId),
    exportProgress(schoolId),
  ]);

  const sections = [
    '# SECTION: Students',
    studentsCsv,
    '',
    '# SECTION: Quiz Results',
    quizCsv,
    '',
    '# SECTION: Progress Summary',
    progressCsv,
  ];

  return sections.join('\r\n');
}

// ─── Route handler ──────────────────────────────────────────

/**
 * POST /api/school-admin/data-export — Generate a data export (CSV)
 * Permission: school.export_data
 *
 * Body: { type: 'students' | 'quiz_results' | 'progress' | 'full' }
 *
 * Returns CSV content as a downloadable file.
 * P13: email/phone are never included. Names and grades are included.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.export_data');
    if (!auth.authorized) return auth.errorResponse;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const exportType = body.type as ExportType | undefined;

    if (!exportType || !VALID_EXPORT_TYPES.includes(exportType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid export type. Must be one of: ${VALID_EXPORT_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Generate the CSV
    let csvContent: string;
    switch (exportType) {
      case 'students':
        csvContent = await exportStudents(auth.schoolId);
        break;
      case 'quiz_results':
        csvContent = await exportQuizResults(auth.schoolId);
        break;
      case 'progress':
        csvContent = await exportProgress(auth.schoolId);
        break;
      case 'full':
        csvContent = await exportFull(auth.schoolId);
        break;
    }

    // Log the export action for audit trail
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    await logSchoolAudit({
      schoolId: auth.schoolId,
      actorId: auth.userId,
      action: 'data.exported',
      resourceType: 'export',
      resourceId: exportType,
      metadata: { export_type: exportType },
      ipAddress,
    });

    // Build filename with current date
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${exportType}-export-${dateStr}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error('school_data_export_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/data-export',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
