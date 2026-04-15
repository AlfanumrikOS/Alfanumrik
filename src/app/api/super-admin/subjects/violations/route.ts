import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '../../../../../lib/admin-auth';
import { supabaseAdmin } from '../../../../../lib/supabase-admin';

/**
 * Subject Enrollment Violations Report — surfaces students whose current
 * enrollment is no longer valid for their (grade, stream, plan).
 *
 * A "violation" = a row in student_subject_enrollment whose subject_code
 * is NOT returned by get_available_subjects(student_id), OR is_locked.
 *
 * Read-only — no audit log emitted (admin browsing).
 *
 * Implementation: server-side JOIN/CTE rather than N RPC calls so that a
 * cohort with 10K students does not trigger 10K RPC round-trips. The
 * inline CTE assembles allowed-subject sets per student via
 * grade_subject_map JOIN plan_subject_access JOIN subscription_plans,
 * then anti-joins against student_subject_enrollment.
 *
 * Phase E (Subject Governance) — backend.
 */

interface ViolationRow {
  student_id: string;
  grade: string | null;
  stream: string | null;
  plan: string | null;
  invalid_subjects: string[];
  total: number;
}

const VIOLATION_QUERY = `
WITH student_plan AS (
  SELECT
    s.id AS student_id,
    s.grade,
    COALESCE(s.stream, 'none') AS stream,
    COALESCE(ss.plan_code, 'free') AS plan_code
  FROM students s
  LEFT JOIN LATERAL (
    SELECT plan_code
    FROM student_subscriptions
    WHERE student_id = s.id
      AND status IN ('active','past_due','cancelled')
    ORDER BY created_at DESC
    LIMIT 1
  ) ss ON true
  WHERE ($1::text IS NULL OR COALESCE(ss.plan_code,'free') = $1)
    AND ($2::text IS NULL OR s.grade = $2)
    AND ($3::text IS NULL OR COALESCE(s.stream,'none') = $3)
),
allowed AS (
  SELECT
    sp.student_id,
    array_agg(DISTINCT gsm.subject_code) FILTER (
      WHERE gsm.subject_code IS NOT NULL
        AND (psa.subject_code IS NOT NULL OR gsm.is_core)
    ) AS allowed_subjects
  FROM student_plan sp
  LEFT JOIN grade_subject_map gsm
    ON gsm.grade = sp.grade
   AND gsm.stream = sp.stream
  LEFT JOIN plan_subject_access psa
    ON psa.plan_code = sp.plan_code
   AND psa.subject_code = gsm.subject_code
  GROUP BY sp.student_id
),
enrolled AS (
  SELECT
    sse.student_id,
    array_agg(sse.subject_code) FILTER (WHERE sse.subject_code IS NOT NULL) AS enrolled_subjects,
    array_agg(sse.subject_code) FILTER (WHERE sse.is_locked) AS locked_subjects
  FROM student_subject_enrollment sse
  WHERE sse.student_id IN (SELECT student_id FROM student_plan)
  GROUP BY sse.student_id
),
violations AS (
  SELECT
    sp.student_id,
    sp.grade,
    sp.stream,
    sp.plan_code AS plan,
    COALESCE(
      (
        SELECT array_agg(s) FROM unnest(COALESCE(e.enrolled_subjects, ARRAY[]::text[])) AS s
        WHERE s <> ALL(COALESCE(a.allowed_subjects, ARRAY[]::text[]))
           OR s = ANY(COALESCE(e.locked_subjects, ARRAY[]::text[]))
      ),
      ARRAY[]::text[]
    ) AS invalid_subjects
  FROM student_plan sp
  LEFT JOIN allowed a USING (student_id)
  LEFT JOIN enrolled e USING (student_id)
)
SELECT student_id, grade, stream, plan, invalid_subjects,
       array_length(invalid_subjects, 1) AS total
FROM violations
WHERE invalid_subjects IS NOT NULL
  AND array_length(invalid_subjects, 1) > 0
ORDER BY total DESC, student_id ASC
LIMIT $4 OFFSET $5;
`;

const COUNT_QUERY = `
WITH student_plan AS (
  SELECT
    s.id AS student_id,
    s.grade,
    COALESCE(s.stream, 'none') AS stream,
    COALESCE(ss.plan_code, 'free') AS plan_code
  FROM students s
  LEFT JOIN LATERAL (
    SELECT plan_code
    FROM student_subscriptions
    WHERE student_id = s.id
      AND status IN ('active','past_due','cancelled')
    ORDER BY created_at DESC
    LIMIT 1
  ) ss ON true
  WHERE ($1::text IS NULL OR COALESCE(ss.plan_code,'free') = $1)
    AND ($2::text IS NULL OR s.grade = $2)
    AND ($3::text IS NULL OR COALESCE(s.stream,'none') = $3)
),
allowed AS (
  SELECT
    sp.student_id,
    array_agg(DISTINCT gsm.subject_code) FILTER (
      WHERE gsm.subject_code IS NOT NULL
        AND (psa.subject_code IS NOT NULL OR gsm.is_core)
    ) AS allowed_subjects
  FROM student_plan sp
  LEFT JOIN grade_subject_map gsm
    ON gsm.grade = sp.grade
   AND gsm.stream = sp.stream
  LEFT JOIN plan_subject_access psa
    ON psa.plan_code = sp.plan_code
   AND psa.subject_code = gsm.subject_code
  GROUP BY sp.student_id
),
enrolled AS (
  SELECT
    sse.student_id,
    array_agg(sse.subject_code) FILTER (WHERE sse.subject_code IS NOT NULL) AS enrolled_subjects,
    array_agg(sse.subject_code) FILTER (WHERE sse.is_locked) AS locked_subjects
  FROM student_subject_enrollment sse
  WHERE sse.student_id IN (SELECT student_id FROM student_plan)
  GROUP BY sse.student_id
)
SELECT COUNT(*)::int AS count
FROM (
  SELECT
    sp.student_id,
    COALESCE(
      (
        SELECT array_agg(s) FROM unnest(COALESCE(e.enrolled_subjects, ARRAY[]::text[])) AS s
        WHERE s <> ALL(COALESCE(a.allowed_subjects, ARRAY[]::text[]))
           OR s = ANY(COALESCE(e.locked_subjects, ARRAY[]::text[]))
      ),
      ARRAY[]::text[]
    ) AS invalid_subjects
  FROM student_plan sp
  LEFT JOIN allowed a USING (student_id)
  LEFT JOIN enrolled e USING (student_id)
) v
WHERE invalid_subjects IS NOT NULL
  AND array_length(invalid_subjects, 1) > 0;
`;

function escapeCsvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (Array.isArray(v)) s = v.join('|');
  else s = String(v);
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
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
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const sp = new URL(request.url).searchParams;
    const plan = sp.get('plan');
    const grade = sp.get('grade');
    const stream = sp.get('stream');
    const limitRaw = parseInt(sp.get('limit') || '100', 10);
    const offsetRaw = parseInt(sp.get('offset') || '0', 10);
    const format = (sp.get('format') || 'json').toLowerCase();

    const limit = Math.min(5000, Math.max(1, isNaN(limitRaw) ? 100 : limitRaw));
    const offset = Math.max(0, isNaN(offsetRaw) ? 0 : offsetRaw);

    if (format !== 'json' && format !== 'csv') {
      return NextResponse.json(
        { error: "Invalid format. Must be 'json' or 'csv'." },
        { status: 400 }
      );
    }

    // Try a server-side execute via the `exec_sql` RPC if it exists; otherwise
    // fall back to per-student RPC calls. The CTE is the preferred path; the
    // RPC fallback is provided so this route is functional even before the
    // exec helper is in place.
    let rows: ViolationRow[] = [];
    let count = 0;

    const execRpc = await supabaseAdmin.rpc('exec_admin_query' as never, {
      query: VIOLATION_QUERY,
      params: [plan, grade, stream, limit, offset],
    } as never);

    if (!execRpc.error && Array.isArray(execRpc.data)) {
      rows = (execRpc.data as ViolationRow[]) || [];
      const countRpc = await supabaseAdmin.rpc('exec_admin_query' as never, {
        query: COUNT_QUERY,
        params: [plan, grade, stream],
      } as never);
      if (!countRpc.error && Array.isArray(countRpc.data) && countRpc.data[0]) {
        count = Number((countRpc.data[0] as { count: number }).count) || 0;
      }
    } else {
      // Fallback: call get_available_subjects per student. Capped at limit*5
      // to avoid runaway scans on huge cohorts.
      const studentQuery = supabaseAdmin
        .from('students')
        .select('id, grade, stream')
        .order('id', { ascending: true })
        .range(offset, offset + Math.min(limit * 5, 5000) - 1);
      if (grade) studentQuery.eq('grade', grade);
      if (stream) studentQuery.eq('stream', stream === 'none' ? null : stream);

      const { data: students } = await studentQuery;
      if (Array.isArray(students)) {
        for (const stu of students) {
          if (rows.length >= limit) break;

          // Pull current plan
          const { data: subRows } = await supabaseAdmin
            .from('student_subscriptions')
            .select('plan_code, status')
            .eq('student_id', stu.id)
            .in('status', ['active', 'past_due', 'cancelled'])
            .order('created_at', { ascending: false })
            .limit(1);
          const planCode = (Array.isArray(subRows) && subRows[0]?.plan_code) || 'free';

          if (plan && planCode !== plan) continue;

          // Pull allowed
          const allowedRpc = await supabaseAdmin.rpc('get_available_subjects' as never, {
            p_student_id: stu.id,
          } as never);
          const allowedRaw = (allowedRpc.data as Array<{ subject_code: string }> | null) || [];
          const allowedSet = new Set(allowedRaw.map((r) => r.subject_code));

          // Pull enrolled
          const { data: enrolled } = await supabaseAdmin
            .from('student_subject_enrollment')
            .select('subject_code, is_locked')
            .eq('student_id', stu.id);
          if (!Array.isArray(enrolled)) continue;

          const invalid = enrolled
            .filter((e) => !allowedSet.has(e.subject_code) || e.is_locked)
            .map((e) => e.subject_code);

          if (invalid.length > 0) {
            rows.push({
              student_id: stu.id,
              grade: (stu as { grade: string | null }).grade ?? null,
              stream: (stu as { stream: string | null }).stream ?? null,
              plan: planCode,
              invalid_subjects: invalid,
              total: invalid.length,
            });
          }
        }
      }
      count = rows.length;
    }

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

    return NextResponse.json({ violations: rows, count });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
