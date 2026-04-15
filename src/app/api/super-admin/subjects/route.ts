import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeAdmin,
  logAdminAudit,
  supabaseAdminHeaders,
  supabaseAdminUrl,
} from '../../../../lib/admin-auth';
import { validateBody } from '../../../../lib/validation';
import { z } from 'zod';

/**
 * Subjects Master API — list / create CBSE-aligned subjects.
 *
 * Phase E (Subject Governance). All mutations are audit-logged via
 * logAdminAudit() and require a valid admin session via authorizeAdmin().
 *
 * Authorization fallback note:
 *   The plan asks for `super_admin.subjects.manage` permission code, but the
 *   existing super-admin surface uses session-based `authorizeAdmin()` rather
 *   than `authorizeRequest(permissionCode)`. We follow the existing pattern
 *   for consistency. When architect adds the dedicated permission code in a
 *   follow-up migration, the gate can be tightened here.
 */

const SNAKE_CASE = /^[a-z][a-z0-9_]{1,63}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const createSubjectSchema = z.object({
  code: z.string().regex(SNAKE_CASE, 'Subject code must be snake_case (a-z, 0-9, _, max 64 chars)'),
  name: z.string().min(1).max(120),
  name_hi: z.string().min(1).max(120).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().regex(HEX_COLOR, 'Color must be a hex value like #RRGGBB').nullable().optional(),
  subject_kind: z.enum(['core', 'elective', 'language', 'optional']).optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
});

// GET — list all subjects (active + inactive)
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const fields =
      'code,name,name_hi,icon,color,subject_kind,is_active,display_order,created_at,updated_at';
    const url = supabaseAdminUrl(
      'subjects',
      `select=${fields}&order=display_order.asc,code.asc`
    );
    const res = await fetch(url, { headers: supabaseAdminHeaders() });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Fetch failed: ${text}` }, { status: res.status });
    }
    const subjectsRaw = await res.json();
    const subjects = Array.isArray(subjectsRaw) ? subjectsRaw : [];
    // Phase I: `data` alias added for frontend compatibility (additive).
    return NextResponse.json({ subjects, data: subjects });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// POST — create new subject
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateBody(createSubjectSchema, body);
    if (!validation.success) return validation.error;

    const data = validation.data;
    const code = data.code.toLowerCase();

    // Uniqueness check
    const checkRes = await fetch(
      supabaseAdminUrl('subjects', `select=code&code=eq.${encodeURIComponent(code)}&limit=1`),
      { headers: supabaseAdminHeaders() }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        return NextResponse.json(
          { error: `Subject "${code}" already exists.` },
          { status: 409 }
        );
      }
    }

    const payload: Record<string, unknown> = {
      code,
      name: data.name,
      name_hi: data.name_hi ?? null,
      icon: data.icon ?? null,
      color: data.color ?? null,
      subject_kind: data.subject_kind ?? 'core',
      display_order: data.display_order ?? 100,
      is_active: true,
    };

    const res = await fetch(supabaseAdminUrl('subjects'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Create failed: ${text}` }, { status: res.status });
    }

    const created = await res.json();
    const row = Array.isArray(created) ? created[0] : created;

    await logAdminAudit(auth, 'subject.master.created', 'subjects', code, {
      subject: row,
    });

    return NextResponse.json({ success: true, data: row }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
