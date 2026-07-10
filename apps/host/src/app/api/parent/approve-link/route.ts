/**
 * POST /api/parent/approve-link
 *
 * Allows a logged-in student to approve or reject a pending parent link request.
 *
 * Auth: student session via supabase-server.ts (cookie-based JWT)
 * Body: { linkId: string, action: 'approve' | 'reject' }
 *
 * Security:
 * - Session is read via the server client (respects RLS, validates JWT)
 * - student ownership of the link is verified inside an auth.uid()-anchored RPC
 * - the route never imports the service-role admin client
 *
 * Response: { success: true, status: 'approved' | 'rejected' }
 *           { success: false, error: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';

const VALID_ACTIONS = ['approve', 'reject'] as const;
type LinkAction = typeof VALID_ACTIONS[number];

type ReviewLinkRpcResult = {
  success?: boolean;
  status?: string;
  error_code?: string;
  error?: string;
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    // ── 1. Authenticate the caller via cookie session ──────────────────────
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser();

    if (sessionError || !user) {
      return err('Unauthorized', 401);
    }

    // ── 2. Parse and validate request body ────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return err('Invalid JSON body', 400);
    }

    if (!body || typeof body !== 'object') {
      return err('Request body must be a JSON object', 400);
    }

    const { linkId, action } = body as Record<string, unknown>;

    if (typeof linkId !== 'string' || !isValidUUID(linkId)) {
      return err('linkId must be a valid UUID', 400);
    }

    if (!VALID_ACTIONS.includes(action as LinkAction)) {
      return err('action must be "approve" or "reject"', 400);
    }

    const newStatus = (action as LinkAction) === 'approve' ? 'approved' : 'rejected';

    // ── 3. Review the link through an auth.uid()-scoped DB boundary ────────
    const { data, error: rpcError } = await supabase.rpc('student_review_guardian_link', {
      p_link_id: linkId,
      p_action: newStatus,
    });

    if (rpcError) {
      logger.error('approve_link: rpc failed', {
        error: new Error(rpcError.message),
        linkId,
        newStatus,
      });
      return err('Failed to update link status', 500);
    }

    const result = (data ?? {}) as ReviewLinkRpcResult;

    if (!result.success) {
      if (result.error_code === 'unauthorized') {
        return err('Unauthorized', 401);
      }

      if (result.error_code === 'invalid_action') {
        return err('action must be "approve" or "reject"', 400);
      }

      if (result.error_code === 'no_student') {
        return err('Student account not found for this session', 403);
      }

      if (result.error_code === 'not_found') {
        return err('Link request not found or already processed', 404);
      }

      logger.error('approve_link: rpc returned failure', {
        error: new Error(result.error ?? 'Unknown link review failure'),
        linkId,
        errorCode: result.error_code,
      });
      return err('Failed to update link status', 500);
    }

    if (result.status !== 'approved' && result.status !== 'rejected') {
      logger.error('approve_link: rpc returned invalid status', {
        error: new Error(`Invalid status: ${String(result.status)}`),
        linkId,
      });
      return err('Failed to update link status', 500);
    }

    logger.info('approve_link: link status updated', {
      linkId,
      newStatus: result.status,
      authUserId: user.id,
    });

    return NextResponse.json({ success: true, status: result.status });
  } catch (err_) {
    logger.error('approve_link: unexpected error', {
      error: err_ instanceof Error ? err_ : new Error(String(err_)),
    });
    return err('Internal server error', 500);
  }
}
