/**
 * GET /api/parent/messages/threads — list the calling guardian's threads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/validation';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

type ParentThreadsRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  threads?: unknown[];
  unreadTotal?: number;
};

type ParentThreadRow = {
  student_id?: unknown;
  unread_count?: unknown;
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const url = new URL(request.url);
  const requestedStudentId = url.searchParams.get('student_id')?.trim() || null;
  if (requestedStudentId && !isValidUUID(requestedStudentId)) {
    return err('Invalid student id', 400);
  }
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const supabase = await createSupabaseServerClient();
  // The RPC is already guardian-owned through auth.uid(). When a child scope
  // is requested, read its maximum governed window before narrowing so another
  // child's newer conversations cannot consume a smaller client page first.
  const { data, error } = await supabase.rpc('parent_list_message_threads', {
    p_limit: requestedStudentId ? MAX_LIMIT : limit,
  });

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

  const guardianOwnedThreads = Array.isArray(result.threads) ? result.threads : [];
  const filteredThreads = requestedStudentId
    ? guardianOwnedThreads.filter((thread) => (
        Boolean(thread)
        && typeof thread === 'object'
        && (thread as ParentThreadRow).student_id === requestedStudentId
      )).slice(0, limit)
    : guardianOwnedThreads;
  const unreadTotal = requestedStudentId
    ? filteredThreads.reduce<number>((total, thread) => {
        const value = thread && typeof thread === 'object'
          ? (thread as ParentThreadRow).unread_count
          : 0;
        return total + (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
      }, 0)
    : result.unreadTotal ?? 0;

  return NextResponse.json({
    success: true,
    threads: filteredThreads,
    unreadTotal,
  });
}
