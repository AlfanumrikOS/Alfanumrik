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
 * - student ownership of the link is verified before any mutation
 * - The actual status UPDATE uses the admin client to bypass RLS (the
 *   guardian_student_links RLS does not grant students write access)
 *
 * Response: { success: true, status: 'approved' | 'rejected' }
 *           { success: false, error: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/sanitize';

const VALID_ACTIONS = ['approve', 'reject'] as const;
type LinkAction = typeof VALID_ACTIONS[number];

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

    const safeAction = action as LinkAction;

    // ── 3. Resolve the student record for the authenticated user ──────────
    // Use admin client for this read so we can look up by auth_user_id
    // without depending on RLS policies that may vary.
    const { data: student, error: studentError } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (studentError) {
      logger.error('approve_link: student lookup failed', {
        error: new Error(studentError.message),
      });
      return err('Internal server error', 500);
    }

    if (!student) {
      return err('Student account not found for this session', 403);
    }

    // ── 4. Fetch the pending link and verify the student owns it ──────────
    const { data: link, error: linkError } = await supabaseAdmin
      .from('guardian_student_links')
      .select('id, student_id, guardian_id, status')
      .eq('id', linkId)
      .eq('status', 'pending')
      .maybeSingle();

    if (linkError) {
      logger.error('approve_link: link fetch failed', {
        error: new Error(linkError.message),
        linkId,
      });
      return err('Internal server error', 500);
    }

    if (!link) {
      // Either the link does not exist or it is not in 'pending' state
      return err('Link request not found or already processed', 404);
    }

    if (link.student_id !== student.id) {
      // The authenticated student does not own this link — reject silently as 404
      // to avoid leaking information about other students' links
      return err('Link request not found or already processed', 404);
    }

    // ── 5. Apply the status change via admin client ────────────────────────
    const newStatus = safeAction === 'approve' ? 'approved' : 'rejected';

    const { error: updateError } = await supabaseAdmin
      .from('guardian_student_links')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', linkId);

    if (updateError) {
      logger.error('approve_link: status update failed', {
        error: new Error(updateError.message),
        linkId,
        newStatus,
      });
      return err('Failed to update link status', 500);
    }

    logger.info('approve_link: link status updated', {
      linkId,
      newStatus,
      studentId: student.id,
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err_) {
    logger.error('approve_link: unexpected error', {
      error: err_ instanceof Error ? err_ : new Error(String(err_)),
    });
    return err('Internal server error', 500);
  }
}
