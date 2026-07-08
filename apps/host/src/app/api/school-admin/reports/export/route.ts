/**
 * Phase 3B — School Command Center (Wave D)
 * GET /api/school-admin/reports/export?format=json|csv
 *
 * One PII-SAFE board/parent-ready aggregate snapshot of the school:
 *   { school_id, overview, mastery_by_grade[], bloom_summary[], data_state,
 *     generated_at }.
 *
 * Thin handler:
 *   1. Flag gate (ff_school_reports_depth) FIRST — 404 BEFORE auth when OFF, so
 *      the flag-OFF portal is byte-identical (this endpoint is not present today).
 *   2. Validate ?format (default 'json'; reject unknown with 400 BEFORE the RPC).
 *   3. Resolve caller's school + authorize (institution.view_analytics) and build
 *      the USER-CONTEXT client via resolveCommandCenterContext (so auth.uid()
 *      resolves and the SECURITY DEFINER RPC's internal scope guard passes).
 *   4. Call export_school_report:
 *        - format=json → return the jsonb verbatim.
 *        - format=csv  → serialize the aggregate snapshot to CSV server-side in a
 *                        SINGLE PASS, with `Content-Type: text/csv` and a
 *                        `Content-Disposition: attachment` header.
 *
 * PII safety (P13): the RPC returns AGGREGATES ONLY — group-level rows (overview
 * counts, per-grade mastery, Bloom buckets). There are NO student names/emails/
 * ids in the snapshot, so the CSV (which serializes exactly those aggregate
 * fields and nothing else) is PII-safe by construction. No PII is logged.
 *
 * PDF is NOT generated here — the frontend offers print-to-PDF from a
 * print-friendly view, so no heavy PDF dependency is added (P10).
 *
 * Error mapping: RPC 42501 (scope guard) → 403.
 *
 * Contract: src/lib/school-admin/reporting-types.ts (SchoolReportSnapshot).
 * RPC:      export_school_report(p_school_id) in 20260614000003.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  COMMAND_CENTER_REPORTS_CACHE_CONTROL,
} from '@alfanumrik/lib/school-admin/command-center-context';
import {
  reportingRpcErrorResponse,
  type SchoolReportSnapshot,
} from '@alfanumrik/lib/school-admin/reporting-types';
import { isFeatureEnabled, SCHOOL_REPORTS_DEPTH_FLAGS } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

const ROUTE = '/api/school-admin/reports/export';

export const dynamic = 'force-dynamic';

type ExportFormat = 'json' | 'csv';

/** Uniform "feature absent" response when the flag is OFF (404 before auth). */
function notPresent(): NextResponse {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

/**
 * RFC-4180-style CSV field escaper. A field is quoted when it contains a comma,
 * double-quote, CR, or LF; embedded double-quotes are doubled. null/undefined
 * become empty fields. Numbers/booleans are stringified plainly.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Join a row of already-escaped-or-raw cells into one CSV line. */
function csvRow(cells: unknown[]): string {
  return cells.map(csvField).join(',');
}

/**
 * Serialize the PII-safe aggregate snapshot to a section-labeled CSV in a SINGLE
 * PASS over the snapshot's three bounded arrays (overview is a fixed set of
 * scalars; mastery_by_grade and bloom_summary are small group-level arrays). No
 * nested iteration, no per-row DB work — O(grades + bloom buckets).
 */
function snapshotToCsv(snapshot: SchoolReportSnapshot): string {
  const lines: string[] = [];

  // Header / provenance.
  lines.push(csvRow(['section', 'key', 'value']));
  lines.push(csvRow(['meta', 'school_id', snapshot.school_id]));
  lines.push(csvRow(['meta', 'data_state', snapshot.data_state]));
  lines.push(csvRow(['meta', 'generated_at', snapshot.generated_at]));

  // Overview (aggregate counts only — no PII).
  const ov = snapshot.overview;
  if (ov) {
    lines.push(csvRow(['overview', 'class_count', ov.class_count]));
    lines.push(csvRow(['overview', 'teacher_count', ov.teacher_count]));
    lines.push(csvRow(['overview', 'student_count', ov.student_count]));
    lines.push(csvRow(['overview', 'seats_purchased', ov.seats_purchased]));
    lines.push(csvRow(['overview', 'active_students', ov.active_students]));
    lines.push(csvRow(['overview', 'seat_utilization_pct', ov.seat_utilization_pct]));
    lines.push(csvRow(['overview', 'avg_mastery', ov.avg_mastery]));
  }

  // Per-grade mastery comparatives (group-level rows only — no student ids).
  lines.push(
    csvRow(['mastery_by_grade', 'grade', 'label', 'student_count', 'avg_mastery', 'at_risk_count']),
  );
  for (const row of snapshot.mastery_by_grade ?? []) {
    lines.push(
      csvRow([
        'mastery_by_grade',
        row.grade,
        row.label,
        row.student_count,
        row.avg_mastery,
        row.at_risk_count,
      ]),
    );
  }

  // Bloom's distribution (bucket-level rows only — no student ids).
  lines.push(csvRow(['bloom_summary', 'bloom_level', 'response_count', 'correct_count', 'accuracy']));
  for (const row of snapshot.bloom_summary ?? []) {
    lines.push(
      csvRow([
        'bloom_summary',
        row.bloom_level,
        row.response_count,
        row.correct_count,
        row.accuracy,
      ]),
    );
  }

  // CRLF line endings per RFC 4180 (Excel-friendly).
  return lines.join('\r\n') + '\r\n';
}

export async function GET(request: NextRequest) {
  // 1. Flag OFF → endpoint behaves as not-present, BEFORE any auth work.
  const enabled = await isFeatureEnabled(SCHOOL_REPORTS_DEPTH_FLAGS.V1, {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
  if (!enabled) return notPresent();

  try {
    // 2. Validate ?format BEFORE calling the RPC. Default 'json'; reject unknown.
    const rawFormat = new URL(request.url).searchParams.get('format')?.trim().toLowerCase();
    let format: ExportFormat;
    if (!rawFormat || rawFormat === 'json') {
      format = 'json';
    } else if (rawFormat === 'csv') {
      format = 'csv';
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid format (expected json | csv)' },
        { status: 400 },
      );
    }

    // 3. Authorize (institution.view_analytics) + resolve school + user-context client.
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;

    const { supabase, schoolId } = resolved.ctx;

    // 4. Single RPC call through the user-context client.
    const { data, error } = await supabase.rpc('export_school_report', {
      p_school_id: schoolId,
    });

    if (error) {
      return reportingRpcErrorResponse(error, ROUTE);
    }

    // The RPC returns a single jsonb object. A null result is unexpected (the
    // scope guard would have raised), but degrade safely to an empty snapshot.
    const snapshot = (data ?? null) as SchoolReportSnapshot | null;

    if (format === 'json') {
      // Return the jsonb verbatim (already the PII-safe aggregate shape).
      return NextResponse.json(snapshot ?? {}, {
        headers: { 'Cache-Control': COMMAND_CENTER_REPORTS_CACHE_CONTROL },
      });
    }

    // format === 'csv': serialize the aggregate snapshot server-side (PII-safe).
    const safeSnapshot: SchoolReportSnapshot =
      snapshot ??
      ({
        school_id: schoolId,
        overview: {
          class_count: 0,
          teacher_count: 0,
          student_count: 0,
          seats_purchased: 0,
          active_students: 0,
          seat_utilization_pct: null,
          avg_mastery: null,
          data_state: 'no_data',
        },
        mastery_by_grade: [],
        bloom_summary: [],
        data_state: 'no_data',
        generated_at: new Date().toISOString(),
      } satisfies SchoolReportSnapshot);

    const csv = snapshotToCsv(safeSnapshot);
    const datePart = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `school-report-${datePart}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': COMMAND_CENTER_REPORTS_CACHE_CONTROL,
      },
    });
  } catch (err) {
    logger.error('school_reporting_export_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
