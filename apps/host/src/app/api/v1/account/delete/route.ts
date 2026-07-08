/**
 * /api/v1/account/delete — DPDP Section 17 right-to-erasure (Wave 2 D7 follow-up #1).
 *
 * Methods:
 *   POST   — initiate deletion (writes log + soft-deletes row + schedules sub cancel)
 *   DELETE — cancel an in-flight deletion during the 30-day cooling-off window
 *   GET    — fetch the caller's current deletion-log entry (or 404)
 *
 * Auth: authorizeRequest(request, 'account.delete'). The permission is granted to
 * student / parent / teacher roles by migration 20260505120000. Server-side
 * ownership checks below ensure the caller can ONLY delete their own account
 * (the permission name is misleading otherwise — it's not an admin-style power).
 *
 * Confirm-email guard: POST requires { reason, confirmEmail } and verifies that
 * confirmEmail matches the auth.users.email for the caller. This is a
 * defense-in-depth against accidental clicks on a deletion link in a CSRF
 * attack — the user must type their own email.
 *
 * Subscription handling:
 *   For students with an active paid subscription, the request_account_deletion
 *   RPC also calls atomic_cancel_subscription with p_immediate=false so the user
 *   keeps paid access until current_period_end and is not billed again. If the
 *   sub-cancel fails inside the RPC's transaction, the whole request rolls back
 *   and we return 503 — Razorpay state stays untouched and the user can retry.
 *
 * Edge Function contract (out of scope, follow-up):
 *   The 30-day purge cron (src/app/api/cron/account-purge/route.ts) selects rows
 *   where deletion_requested_at < NOW() - INTERVAL '30 days' AND
 *   deletion_completed_at IS NULL, then invokes the `account-purge` Supabase
 *   Edge Function with { account_id, account_role, deletion_log_id }. The Edge
 *   Function is responsible for (1) anonymising payment FKs to a synthetic UUID,
 *   (2) hard-deleting PII columns (email, name, phone, school, learning history,
 *   foxy_chat_messages, image_uploads), (3) deleting the auth.users row via
 *   service-role admin API, (4) updating the log row to status='purged' with
 *   purged_categories populated. On failure it sets status='failed' + error_text.
 *   This route layer has no responsibility for that work.
 *
 * Privacy: error responses NEVER include the deletion reason text or the user's
 * email. Logs go through the structured logger which redacts PII automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_TO_TABLE: Record<'student' | 'teacher' | 'parent', 'students' | 'teachers' | 'guardians'> = {
  student: 'students',
  teacher: 'teachers',
  parent: 'guardians',
};

const VALID_ROLES = ['student', 'teacher', 'parent'] as const;
type AccountRole = (typeof VALID_ROLES)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the caller's account row id + role from auth_user_id.
 * Returns the FIRST role found in priority order: student → teacher → parent.
 * A given auth_user_id should only have one role row, but the priority is
 * defensive against test data.
 */
async function resolveAccount(
  authUserId: string,
): Promise<{ accountId: string; role: AccountRole } | null> {
  // Try student first (most common)
  const { data: s } = await supabaseAdmin
    .from('students')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (s?.id) return { accountId: s.id, role: 'student' };

  const { data: t } = await supabaseAdmin
    .from('teachers')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (t?.id) return { accountId: t.id, role: 'teacher' };

  const { data: g } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (g?.id) return { accountId: g.id, role: 'parent' };

  return null;
}

async function getAuthEmail(authUserId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId);
    if (error || !data?.user?.email) return null;
    return data.user.email.toLowerCase();
  } catch {
    return null;
  }
}

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json(
    { success: false, error: message, ...(code ? { code } : {}) },
    { status },
  );
}

// ─── POST — initiate deletion ─────────────────────────────────────────────────

interface PostBody {
  reason?: unknown;
  confirmEmail?: unknown;
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'account.delete');
  if (!auth.authorized) return auth.errorResponse!;
  const authUserId = auth.userId!;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return jsonError('Invalid JSON body', 400, 'BAD_REQUEST');
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const confirmEmailRaw = typeof body.confirmEmail === 'string' ? body.confirmEmail.trim() : '';

  if (!reason || reason.length < 3) {
    return jsonError('Reason is required (min 3 chars)', 400, 'REASON_REQUIRED');
  }
  if (reason.length > 1000) {
    return jsonError('Reason exceeds 1000 character limit', 400, 'REASON_TOO_LONG');
  }
  if (!confirmEmailRaw) {
    return jsonError('confirmEmail is required', 400, 'CONFIRM_EMAIL_REQUIRED');
  }

  // Verify confirmEmail matches the caller's email (defense vs. accidental clicks).
  const callerEmail = await getAuthEmail(authUserId);
  if (!callerEmail) {
    logger.error('account_delete_email_lookup_failed', {
      route: '/api/v1/account/delete',
      auth_user_id: authUserId,
    });
    return jsonError('Email verification unavailable', 503, 'EMAIL_LOOKUP_FAILED');
  }
  if (confirmEmailRaw.toLowerCase() !== callerEmail) {
    logger.warn('account_delete_confirm_email_mismatch', {
      route: '/api/v1/account/delete',
      auth_user_id: authUserId,
    });
    return jsonError('confirmEmail does not match account email', 400, 'CONFIRM_EMAIL_MISMATCH');
  }

  // Resolve which role table the caller belongs to.
  const account = await resolveAccount(authUserId);
  if (!account) {
    return jsonError('No account profile found for caller', 404, 'NO_ACCOUNT');
  }

  // Call the transactional RPC.
  const { data, error } = await supabaseAdmin.rpc('request_account_deletion', {
    p_account_id: account.accountId,
    p_role: account.role,
    p_reason: reason,
    p_auth_user_id: authUserId,
  });

  if (error) {
    // Errors raised by the RPC's inner subscription-cancel block bubble up here.
    // We treat any RPC failure as a transient 503 so the client can retry — the
    // RPC is fully transactional, so a failure means nothing was persisted.
    logger.error('account_delete_rpc_failed', {
      route: '/api/v1/account/delete',
      auth_user_id: authUserId,
      role: account.role,
      error: new Error(error.message),
    });
    return jsonError('Deletion request failed; please retry', 503, 'RPC_FAILED');
  }

  // RPC returns SETOF (deletion_id, cooling_off_ends_at, outcome, subscription_outcome).
  // PostgREST surfaces the single row as an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.deletion_id) {
    logger.error('account_delete_rpc_unexpected_shape', {
      route: '/api/v1/account/delete',
      auth_user_id: authUserId,
      role: account.role,
    });
    return jsonError('Deletion request failed; please retry', 503, 'RPC_NO_ROW');
  }

  const isReplay = row.outcome === 'already_requested';

  logger.info('account_delete_requested', {
    route: '/api/v1/account/delete',
    deletion_id: row.deletion_id,
    role: account.role,
    outcome: row.outcome,
    subscription_outcome: row.subscription_outcome,
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        deletion_id: row.deletion_id,
        cooling_off_ends_at: row.cooling_off_ends_at,
        can_cancel: true,
        idempotent_replay: isReplay,
        subscription_outcome: row.subscription_outcome,
      },
    },
    { status: isReplay ? 200 : 201 },
  );
}

// ─── DELETE — cancel during cooling-off ──────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const auth = await authorizeRequest(request, 'account.delete');
  if (!auth.authorized) return auth.errorResponse!;
  const authUserId = auth.userId!;

  const account = await resolveAccount(authUserId);
  if (!account) {
    return jsonError('No account profile found for caller', 404, 'NO_ACCOUNT');
  }

  // Pre-check: is there an in-flight request? If not — distinguish
  // "never requested" (404) from "already purged" (410).
  const { data: existing } = await supabaseAdmin
    .from('account_deletion_log')
    .select('id, status')
    .eq('account_id', account.accountId)
    .eq('account_role', account.role)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    return jsonError('No deletion request found', 404, 'NO_REQUEST');
  }
  if (existing.status === 'purged') {
    return jsonError('Account already purged; cannot cancel', 410, 'ALREADY_PURGED');
  }
  if (existing.status === 'cancelled_by_user') {
    return jsonError('Deletion request already cancelled', 410, 'ALREADY_CANCELLED');
  }

  const { data, error } = await supabaseAdmin.rpc('cancel_account_deletion', {
    p_account_id: account.accountId,
  });

  if (error) {
    logger.error('account_delete_cancel_rpc_failed', {
      route: '/api/v1/account/delete',
      auth_user_id: authUserId,
      error: new Error(error.message),
    });
    return jsonError('Cancellation failed; please retry', 503, 'RPC_FAILED');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.cancelled) {
    const reasonCode = row?.reason ?? 'unknown';
    logger.warn('account_delete_cancel_refused', {
      route: '/api/v1/account/delete',
      auth_user_id: authUserId,
      reason: reasonCode,
    });
    if (reasonCode === 'cooling_off_ended') {
      return jsonError('Cooling-off window has ended', 410, 'COOLING_OFF_ENDED');
    }
    return jsonError('No deletion request to cancel', 404, 'NO_REQUEST');
  }

  logger.info('account_delete_cancelled_by_user', {
    route: '/api/v1/account/delete',
    role: account.role,
  });

  return NextResponse.json({
    success: true,
    data: { cancelled: true },
  });
}

// ─── GET — status ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'account.delete');
  if (!auth.authorized) return auth.errorResponse!;
  const authUserId = auth.userId!;

  const account = await resolveAccount(authUserId);
  if (!account) {
    return jsonError('No account profile found for caller', 404, 'NO_ACCOUNT');
  }

  // Most-recent log row only — historical cancellations are not surfaced here.
  const { data, error } = await supabaseAdmin
    .from('account_deletion_log')
    .select(
      'id, status, requested_at, cooling_off_ends_at, completed_at, purged_categories',
    )
    .eq('account_id', account.accountId)
    .eq('account_role', account.role)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('account_delete_status_query_failed', {
      route: '/api/v1/account/delete',
      auth_user_id: authUserId,
      error: new Error(error.message),
    });
    return jsonError('Status lookup failed', 500, 'QUERY_FAILED');
  }

  if (!data) {
    return jsonError('No deletion request found', 404, 'NO_REQUEST');
  }

  return NextResponse.json({
    success: true,
    data: {
      deletion_id: data.id,
      status: data.status,
      requested_at: data.requested_at,
      cooling_off_ends_at: data.cooling_off_ends_at,
      completed_at: data.completed_at,
      purged_categories: data.purged_categories ?? {},
      can_cancel: data.status === 'requested' || data.status === 'cooling_off',
    },
  });
}
