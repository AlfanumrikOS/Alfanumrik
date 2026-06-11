/**
 * GET /api/super-admin/subscribers/[name]/dead-letters
 *
 * List unresolved dead-letter rows for one subscriber. Used by the
 * operator UI drawer to populate the per-event "Retry" actions.
 *
 * Auth: authorizeAdmin.
 *
 * Response: { success: true, data: { dead_letters: Array<...> } }
 *   Each row: { event_id, subscriber_name, attempt_count, last_error,
 *               first_attempted_at, last_attempted_at }.
 *   Cap: 200 rows (operator UI; full set lives in the table itself).
 *
 * Spine: read-side runtime metadata. No state_event emit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  const { name: rawName } = await context.params;
  const subscriberName = decodeURIComponent(rawName);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('subscriber_dead_letters')
    .select(
      'event_id, subscriber_name, attempt_count, last_error, first_attempted_at, last_attempted_at, resolved_at',
    )
    .eq('subscriber_name', subscriberName)
    .is('resolved_at', null)
    .order('last_attempted_at', { ascending: false })
    .limit(DEFAULT_LIMIT);

  if (error) {
    logger.error('super_admin_dead_letters_list_failed', {
      error: new Error(error.message),
      subscriber: subscriberName,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to list dead-letters' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: { dead_letters: data ?? [] },
  });
}
