import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/observability/events
 *
 * Returns paginated events from v_ops_timeline with filters.
 * Cursor-based pagination via `cursor=<iso>|<uuid>`.
 */

const VALID_RANGES: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const url = request.nextUrl;
    const range = url.searchParams.get('range') || '1h';
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const categoryParam = url.searchParams.get('category');
    const severityParam = url.searchParams.get('severity');
    const env = url.searchParams.get('env') || 'production';
    const q = url.searchParams.get('q');
    const cursor = url.searchParams.get('cursor');
    const limitParam = url.searchParams.get('limit');

    // Validate and compute limit
    let limit = 100;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 500) limit = parsed;
    }

    // Compute time range
    let fromTime: string;
    let toTime: string;

    if (fromParam && toParam) {
      // Custom date range overrides range param
      fromTime = new Date(fromParam).toISOString();
      toTime = new Date(toParam).toISOString();
    } else {
      const rangeMs = VALID_RANGES[range] || VALID_RANGES['1h'];
      const now = new Date();
      toTime = now.toISOString();
      fromTime = new Date(now.getTime() - rangeMs).toISOString();
    }

    // Build query against the v_ops_timeline view
    let query = supabaseAdmin
      .from('v_ops_timeline')
      .select('*')
      .gte('occurred_at', fromTime)
      .lte('occurred_at', toTime)
      .eq('environment', env)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1); // Fetch one extra for nextCursor detection

    // Category filter
    if (categoryParam) {
      const categories = categoryParam.split(',').map(c => c.trim()).filter(Boolean);
      if (categories.length > 0) {
        query = query.in('category', categories);
      }
    }

    // Severity filter
    if (severityParam) {
      const severities = severityParam.split(',').map(s => s.trim()).filter(Boolean);
      if (severities.length > 0) {
        query = query.in('severity', severities);
      }
    }

    // Free-text search across message, subject_id, request_id
    if (q) {
      const escaped = q.replace(/[%_]/g, '\\$&');
      const pattern = `%${escaped}%`;
      query = query.or(`message.ilike.${pattern},subject_id.ilike.${pattern},request_id.ilike.${pattern}`);
    }

    // Cursor-based pagination: cursor format is "<iso>|<uuid>"
    if (cursor) {
      const [cursorTime, cursorId] = cursor.split('|');
      if (cursorTime && cursorId) {
        // Get events that come AFTER (earlier in time) the cursor position
        query = query.or(
          `occurred_at.lt.${cursorTime},and(occurred_at.eq.${cursorTime},id.lt.${cursorId})`
        );
      }
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[observability/events] query error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    let nextCursor: string | null = null;

    if (rows.length > limit) {
      // We fetched limit+1 rows; the extra row proves there's more data
      rows.pop();
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        nextCursor = `${lastRow.occurred_at}|${lastRow.id}`;
      }
    }

    return NextResponse.json({ events: rows, nextCursor });
  } catch (err) {
    console.warn('[observability/events] exception:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
