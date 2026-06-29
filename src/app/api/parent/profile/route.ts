/**
 * PATCH /api/parent/profile
 *
 * Updates guardian profile: name, phone.
 * Replaces direct anon-client write in parent/profile/page.tsx.
 *
 * Auth (PP-4 / P9): authorizeRequest(request, 'profile.update_own'). That
 * permission is already granted to the `parent` role in the RBAC matrix
 * (20260612123200_rbac_matrix_conformance.sql), so NO new permission code is
 * introduced — this only brings the route onto the house P9 pattern every
 * sibling parent route already follows. authorizeRequest accepts the Bearer
 * JWT this route previously parsed by hand AND the Supabase cookie session, so
 * existing callers keep working.
 *
 * Self-scope (no IDOR): the update target is the caller's OWN guardian row,
 * resolved from the JWT/cookie-verified auth.userId. No body-supplied id is
 * ever used to select the row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeRequest } from '@/lib/rbac';
import { getGuardianByAuthUserId } from '@/lib/domains/identity';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

const PHONE_RE = /^[+]?\d{7,15}$/;

export async function PATCH(request: NextRequest) {
  // P9: authenticated session + permission gate (granted to the parent role).
  const auth = await authorizeRequest(request, 'profile.update_own');
  if (!auth.authorized) return auth.errorResponse!;

  // Self-scope: resolve the caller's OWN guardian row from the verified
  // auth.userId. The update below targets only this id (never a body id).
  const guardianResult = await getGuardianByAuthUserId(auth.userId!);
  if (!guardianResult.ok || !guardianResult.data) {
    return err('Guardian account not found', 404);
  }
  const guardianId = guardianResult.data.id;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const { name, phone } = body;
  const updatePayload: Record<string, string | null> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return err('name must be 2–100 characters', 400);
    }
    updatePayload.name = name.trim();
  }

  if (phone !== undefined) {
    if (phone === null || phone === '') {
      updatePayload.phone = null;
    } else if (typeof phone !== 'string') {
      return err('phone must be a string or null', 400);
    } else {
      const normalized = phone.trim().replace(/[\s\-()]/g, '');
      if (!PHONE_RE.test(normalized)) {
        return err('Invalid phone number format', 400);
      }
      updatePayload.phone = phone.trim();
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ success: true, message: 'No changes' });
  }

  const { error } = await supabaseAdmin.from('guardians').update(updatePayload).eq('id', guardianId);
  if (error) {
    logger.error('guardian_profile_update_failed', { error: new Error(error.message), guardianId });
    return err('Failed to update profile', 500);
  }

  return NextResponse.json({ success: true });
}
