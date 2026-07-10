/**
 * GET /api/parent/messages/threads/[id]/messages — list and mark read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

type ParentThreadMessagesRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  messages?: unknown[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id: threadId } = await context.params;
  if (!threadId || !UUID_RE.test(threadId)) return err('Invalid thread id', 400);

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? url.searchParams.get('before');
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('parent_list_thread_messages', {
    p_thread_id: threadId,
    p_cursor: cursor,
    p_limit: limit,
  });

  if (error) {
    logger.error('parent_thread_messages_rpc_failed', {
      error: new Error(error.message),
      route: 'parent/messages/threads/[id]/messages',
    });
    return err('Failed to load messages', 500);
  }

  const result = (data ?? {}) as ParentThreadMessagesRpcResult;
  if (result.success !== true) {
    if (result.error_code === 'thread_not_found') return err(result.error ?? 'Thread not found', 404);
    if (result.error_code === 'thread_not_owned' || result.error_code === 'no_guardian') {
      return err(result.error ?? 'Thread not owned by caller', 403);
    }
    return err(result.error ?? 'Failed to load messages', 500);
  }

  return NextResponse.json({
    success: true,
    messages: result.messages ?? [],
    nextCursor: result.nextCursor ?? null,
    hasMore: result.hasMore === true,
  });
}
