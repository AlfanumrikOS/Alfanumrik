import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/observability/events/[id]
 *
 * Returns a single event plus up to 20 related events (same request_id).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { id } = await params;

    // Fetch the primary event from the view
    const { data: event, error: eventError } = await supabaseAdmin
      .from('v_ops_timeline')
      .select('*')
      .eq('id', id)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    // Fetch related events (same request_id, if present)
    let related: typeof event[] = [];

    if (event.request_id) {
      const { data: relatedData } = await supabaseAdmin
        .from('v_ops_timeline')
        .select('*')
        .eq('request_id', event.request_id)
        .neq('id', id)
        .order('occurred_at', { ascending: true })
        .limit(20);

      related = relatedData ?? [];
    }

    return NextResponse.json({ event, related });
  } catch (err) {
    console.warn('[observability/events/[id]] exception:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
