// src/app/api/super-admin/announcements/[id]/route.ts
//
// PATCH — partial update of one announcement, including `is_active` (the
// soft-delete/archive toggle — see the parent route.ts header for why there
// is no DELETE endpoint).

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logAdminAuditByUserId } from '@alfanumrik/lib/admin-auth';
import { logger } from '@alfanumrik/lib/logger';
import { validateUpdatePayload } from '@alfanumrik/lib/super-admin/announcement-validation';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const validated = validateUpdatePayload(body);
  if (typeof validated === 'string') {
    return NextResponse.json({ error: validated }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('admin_announcements')
    .update(validated)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (updateErr) {
    logger.error('admin_announcement_update_failed', { error: updateErr });
    return NextResponse.json({ error: 'update_failed', message: updateErr.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  void logAdminAuditByUserId(
    auth.userId,
    validated.is_active === false ? 'announcement.deactivated' : 'announcement.updated',
    'admin_announcement',
    id,
    { fields: Object.keys(validated) },
    request.headers.get('x-forwarded-for') ?? undefined,
  );

  return NextResponse.json({ id, ok: true });
}
