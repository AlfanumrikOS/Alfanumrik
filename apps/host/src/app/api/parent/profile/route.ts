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
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

const PHONE_RE = /^[+]?\d{7,15}$/;

interface ParentProfileRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
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
        // RLS-scoped profile RPC only; this route does not mutate auth cookies.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

export async function PATCH(request: NextRequest) {
  // P9: authenticated session + permission gate (granted to the parent role).
  const auth = await authorizeRequest(request, 'profile.update_own');
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const { name, phone } = body;
  const updatePayload: Record<string, string | null> = {};
  const updateMask = {
    name: false,
    phone: false,
  };

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return err('name must be 2–100 characters', 400);
    }
    updatePayload.name = name.trim();
    updateMask.name = true;
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
    updateMask.phone = true;
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ success: true, message: 'No changes' });
  }

  const rpcClient = await createRlsScopedClient(request);
  const { data: rpcData, error: rpcErr } = await rpcClient.rpc('parent_update_own_profile', {
    p_name: updatePayload.name ?? null,
    p_phone: updatePayload.phone ?? null,
    p_update_name: updateMask.name,
    p_update_phone: updateMask.phone,
  });
  if (rpcErr) {
    logger.error('guardian_profile_update_failed', { error: new Error(rpcErr.message) });
    return err('Failed to update profile', 500);
  }

  const result = rpcData as ParentProfileRpcResponse | null;
  if (!result?.success) {
    return err(result?.error ?? 'Failed to update profile', result?.status ?? 500);
  }

  return NextResponse.json({ success: true });
}
