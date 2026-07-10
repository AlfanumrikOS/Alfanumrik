/**
 * GET /api/parent/children/[student_id]/erasure-status — Phase D.3.
 *
 * Returns the current erasure request (if any) for the (caller, student)
 * pair. Used by the parent dashboard to render the "Erasure scheduled for
 * X — cancel?" banner.
 *
 * Strict guardian-ownership: the caller MUST be the guardian linked to the
 * student. Cross-guardian reads return 403.
 *
 * Response:
 *   200 { success: true, request: null }                          — no request
 *   200 { success: true, request: {                                — exists
 *     id, status, requested_at, purge_at, processed_at,
 *     reason: 'foo' | null, error_message: '...' | null
 *   } }
 *   403 { success: false, error: 'Child not linked to your account' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const uuidShape = () =>
  z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface RouteCtx {
  params: Promise<{ student_id: string }>;
}

interface ErasureStatusRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    request: {
      id: string;
      status: string;
      requested_at: string;
      purge_at: string;
      processed_at: string | null;
      reason: string | null;
      error_message: string | null;
    } | null;
  };
}

async function createRlsScopedClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // RLS-scoped status RPC only; this route does not mutate auth cookies.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { student_id: studentIdRaw } = await ctx.params;
  const studentIdParse = uuidShape().safeParse(studentIdRaw);
  if (!studentIdParse.success) return err('Invalid student_id', 400);
  const studentId = studentIdParse.data;

  const rpcClient = await createRlsScopedClient(request);
  const { data: rpcData, error: rpcErr } = await rpcClient.rpc('parent_child_erasure_status', {
    p_student_id: studentId,
  });
  if (rpcErr) {
    logger.error('erasure_status_lookup_failed', {
      error: new Error(rpcErr.message),
      route: 'parent/children/erasure-status',
    });
    return err('Failed to look up erasure status', 500);
  }

  const result = rpcData as ErasureStatusRpcResponse | null;
  if (!result?.success) {
    return err(result?.error ?? 'Failed to look up erasure status', result?.status ?? 500);
  }

  return NextResponse.json({ success: true, request: result.data?.request ?? null });
}
