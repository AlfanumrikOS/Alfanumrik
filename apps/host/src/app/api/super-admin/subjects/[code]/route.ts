import { NextRequest, NextResponse } from 'next/server';
import {
  logAdminAudit,
  supabaseAdminHeaders,
  supabaseAdminUrl,
  type AdminAuth,
} from '../../../../../lib/admin-auth';
import { authorizeRequest, type AuthorizationResult } from '../../../../../lib/rbac';
import { validateBody } from '../../../../../lib/validation';
import { z } from 'zod';

/**
 * Adapter: logAdminAudit() expects the legacy AdminAuth shape with
 * name/email/adminLevel fields; authorizeRequest() returns only
 * userId/roles/permissions. admin_id is populated from userId.
 */
function asAdminAudit(auth: AuthorizationResult): AdminAuth {
  return {
    authorized: true,
    userId: auth.userId!,
    adminId: auth.userId!,
    email: '',
    name: '',
    adminLevel: auth.roles.includes('super_admin') ? 'super_admin' : 'admin',
  };
}

/**
 * Subjects Master API — update / soft-deactivate a subject.
 *
 * DELETE is a soft-inactivate (sets is_active=false). Hard delete is
 * intentionally not exposed: subjects are referenced by historical
 * enrollment, mastery, and quiz rows.
 */

const SNAKE_CASE = /^[a-z][a-z0-9_]{1,63}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const patchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    name_hi: z.string().min(1).max(120).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    color: z.string().regex(HEX_COLOR).nullable().optional(),
    subject_kind: z.enum(['core', 'elective', 'language', 'optional']).optional(),
    is_active: z.boolean().optional(),
    display_order: z.number().int().min(0).max(9999).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided',
  });

async function fetchSubject(code: string) {
  const res = await fetch(
    supabaseAdminUrl(
      'subjects',
      `select=code,name,name_hi,icon,color,subject_kind,is_active,display_order&code=eq.${encodeURIComponent(code)}&limit=1`
    ),
    { headers: supabaseAdminHeaders() }
  );
  if (!res.ok) return null;
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

// PATCH — update subject fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await authorizeRequest(request, 'super_admin.subjects.manage');
  if (!auth.authorized) return auth.errorResponse!;

  const { code } = await params;
  if (!code || !SNAKE_CASE.test(code)) {
    return NextResponse.json({ error: 'Invalid subject code' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateBody(patchSchema, body);
    if (!validation.success) return validation.error;

    const previous = await fetchSubject(code);
    if (!previous) {
      return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      ...validation.data,
      updated_at: new Date().toISOString(),
    };

    const res = await fetch(
      supabaseAdminUrl('subjects', `code=eq.${encodeURIComponent(code)}`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify(updates),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Update failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    const row = Array.isArray(updated) ? updated[0] : updated;

    await logAdminAudit(asAdminAudit(auth), 'subject.master.updated', 'subjects', code, {
      updates: validation.data,
      previous_state: previous,
    });

    return NextResponse.json({ success: true, data: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// DELETE — soft-inactivate (is_active=false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await authorizeRequest(request, 'super_admin.subjects.manage');
  if (!auth.authorized) return auth.errorResponse!;

  const { code } = await params;
  if (!code || !SNAKE_CASE.test(code)) {
    return NextResponse.json({ error: 'Invalid subject code' }, { status: 400 });
  }

  try {
    const previous = await fetchSubject(code);
    if (!previous) {
      return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
    }

    const res = await fetch(
      supabaseAdminUrl('subjects', `code=eq.${encodeURIComponent(code)}`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({
          is_active: false,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Deactivate failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    const row = Array.isArray(updated) ? updated[0] : updated;

    await logAdminAudit(asAdminAudit(auth), 'subject.master.toggled', 'subjects', code, {
      from_active: previous.is_active,
      to_active: false,
    });

    return NextResponse.json({ success: true, data: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
