/**
 * GET /api/parent/messages/threads — list the calling guardian's threads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

type ParentThreadsRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  threads?: unknown[];
  unreadTotal?: number;
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('parent_list_message_threads', { p_limit: limit });

  if (error) {
    logger.error('parent_messages_threads_rpc_failed', {
      error: new Error(error.message),
      route: 'parent/messages/threads',
    });
    return err('Failed to list threads', 500);
  }

  const result = (data ?? {}) as ParentThreadsRpcResult;
  if (result.success !== true) {
    if (result.error_code === 'no_guardian') {
      return err(result.error ?? 'Guardian account not found', 404);
    }
    return err(result.error ?? 'Failed to list threads', 500);
  }

  return NextResponse.json({
    success: true,
    threads: result.threads ?? [],
    unreadTotal: result.unreadTotal ?? 0,
  });
}
