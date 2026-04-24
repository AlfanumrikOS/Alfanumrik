/**
 * PATCH /api/parent/profile
 *
 * Updates guardian profile: name, phone.
 * Replaces direct anon-client write in parent/profile/page.tsx.
 *
 * Auth: JWT → auth_user_id → guardians.auth_user_id lookup (ownership enforced server-side)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getGuardianByAuthUserId } from '@/lib/domains/identity';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

const PHONE_RE = /^[+]?\d{7,15}$/;

export async function PATCH(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return err('Unauthorized', 401);
  const token = authHeader.slice(7);

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return err('Invalid or expired token', 401);

  const guardianResult = await getGuardianByAuthUserId(user.id);
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
