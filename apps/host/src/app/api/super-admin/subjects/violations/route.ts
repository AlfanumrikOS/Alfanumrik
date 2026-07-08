import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '../../../../../lib/rbac';
import { supabaseAdmin } from '../../../../../lib/supabase-admin';

/**
 * Subject Enrollment Violations Report — surfaces students whose current
 * enrollment is no longer valid for their (grade, stream, plan).
 *
 * A "violation" = a row in student_subject_enrollment whose subject_code
 * is NOT in the intersection of grade_subject_map ∩ plan_subject_access
 * for the student's current (grade, stream, plan).
 *
 * Implementation: calls the SECURITY DEFINER RPC `get_subject_violations`
 * (migration 20260415000010), which is scoped, granted only to service_role,
 * and set-based — fast even on 10K+ student cohorts.
 *
 * Read-only — no audit log emitted (admin browsing).
 */

interface ViolationRow {
  student_id: string;
  grade: string | null;
  stream: string | null;
  plan: string | null;
  invalid_subjects: string[];
  total: number;
  total_count?: number;
}

function escapeCsvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: ViolationRow[]): string {
  const header = ['student_id', 'grade', 'stream', 'plan', 'invalid_subjects', 'total'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(row.student_id),
        escapeCsvField(row.grade),
        escapeCsvField(row.stream),
        escapeCsvField(row.plan),
        escapeCsvField(row.invalid_subjects),
        escapeCsvField(row.total),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.subjects.manage');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const sp = new URL(request.url).searchParams;
    const plan = sp.get('plan');
    const grade = sp.get('grade');
    const stream = sp.get('stream');
    const limitRaw = parseInt(sp.get('limit') || '100', 10);
    const offsetRaw = parseInt(sp.get('offset') || '0', 10);
    const format = (sp.get('format') || 'json').toLowerCase();

    const limit = Math.min(5000, Math.max(1, Number.isNaN(limitRaw) ? 100 : limitRaw));
    const offset = Math.max(0, Number.isNaN(offsetRaw) ? 0 : offsetRaw);

    if (format !== 'json' && format !== 'csv') {
      return NextResponse.json(
        { error: "Invalid format. Must be 'json' or 'csv'." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin.rpc('get_subject_violations' as never, {
      p_plan: plan,
      p_grade: grade,
      p_stream: stream,
      p_limit: limit,
      p_offset: offset,
    } as never);

    if (error) {
      return NextResponse.json(
        { error: 'violations_query_failed', detail: error.message },
        { status: 500 },
      );
    }

    const rows: ViolationRow[] = Array.isArray(data) ? (data as ViolationRow[]) : [];
    // total_count is the same on every row (window-function aggregate); pick first.
    const count: number = rows[0]?.total_count ?? 0;

    if (format === 'csv') {
      const csv = toCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="subject-violations-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // `data` + `total` aliases are additive for frontend compatibility.
    return NextResponse.json({
      violations: rows,
      count,
      data: rows,
      total: count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}