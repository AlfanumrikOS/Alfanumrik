import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { createClient } from '@supabase/supabase-js';

function getDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
}

/**
 * GET /api/v1/child/:id/report — Download child monthly report
 * Permission: child.download_report
 * Resource check: parent must be linked to this child.
 *
 * Query params:
 *   - month: YYYY-MM-DD format (defaults to first of current month)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: childId } = await params;

    const auth = await authorizeRequest(request, 'child.download_report', {
      resourceCheck: { type: 'student', id: childId },
    });
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const month =
      url.searchParams.get('month') ||
      new Date().toISOString().slice(0, 7) + '-01';

    // Validate month format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: 'Invalid month format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const { data: report } = await getDb()
      .from('monthly_reports')
      .select('*')
      .eq('student_id', childId)
      .eq('report_month', month)
      .single();

    logAudit(auth.userId, {
      action: 'download',
      resourceType: 'report',
      resourceId: childId,
      details: { month },
    });

    if (!report) {
      return NextResponse.json(
        { error: 'No report found for this month' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: report });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
