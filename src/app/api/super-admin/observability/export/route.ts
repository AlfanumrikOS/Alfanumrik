import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/observability/export
 *
 * Streams CSV of events from v_ops_timeline.
 * Requires `from` and `to` query params (ISO date strings).
 * Limit: 100,000 rows maximum.
 */

const CSV_COLUMNS = [
  'occurred_at',
  'category',
  'source',
  'severity',
  'subject_type',
  'subject_id',
  'message',
  'request_id',
  'environment',
  'context_json',
] as const;

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const url = request.nextUrl;
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    if (!fromParam || !toParam) {
      return NextResponse.json(
        { error: 'Both "from" and "to" query params are required' },
        { status: 400 }
      );
    }

    const fromTime = new Date(fromParam);
    const toTime = new Date(toParam);

    if (isNaN(fromTime.getTime()) || isNaN(toTime.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format for "from" or "to"' },
        { status: 400 }
      );
    }

    // Query events within the range, limit 100k
    const { data, error } = await supabaseAdmin
      .from('v_ops_timeline')
      .select('*')
      .gte('occurred_at', fromTime.toISOString())
      .lte('occurred_at', toTime.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(100000);

    if (error) {
      console.warn('[observability/export] query error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];

    // Build CSV content
    const lines: string[] = [CSV_COLUMNS.join(',')];

    for (const row of rows) {
      const line = [
        escapeCSV(row.occurred_at),
        escapeCSV(row.category),
        escapeCSV(row.source),
        escapeCSV(row.severity),
        escapeCSV(row.subject_type),
        escapeCSV(row.subject_id),
        escapeCSV(row.message),
        escapeCSV(row.request_id),
        escapeCSV(row.environment),
        escapeCSV(row.context ? JSON.stringify(row.context) : null),
      ].join(',');
      lines.push(line);
    }

    const csv = lines.join('\n');
    const filename = `ops-events-${fromTime.toISOString().slice(0, 10)}-to-${toTime.toISOString().slice(0, 10)}.csv`;

    // Log the export action for audit trail
    logAdminAudit(
      auth,
      'export_ops_events',
      'ops_events',
      'bulk',
      {
        from: fromTime.toISOString(),
        to: toTime.toISOString(),
        row_count: rows.length,
      },
      request.headers.get('x-forwarded-for') || undefined
    ).catch(() => {
      // Fire-and-forget; never let audit log block the response
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.warn('[observability/export] exception:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
