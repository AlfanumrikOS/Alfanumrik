// src/app/api/super-admin/announcements/route.ts
//
// Gate-2 D1 — global announcements CRUD (admin_announcements). The table
// (supabase/migrations/00000000000000_baseline_from_prod.sql) already
// existed with RLS (announce_read: any authenticated reader; announce_admin_
// write/update: is_admin()) but had zero UI/API anywhere — this is net-new,
// not wiring an orphan. Deliberately distinct from the per-school
// `school_announcements` feature (apps/host/src/app/school-admin/announcements)
// — do not conflate the two.
//
// No DELETE endpoint: the table's own `is_active` column is the intended
// soft-delete/archive mechanism (see PATCH), which avoids needing a new RLS
// policy (only SELECT/INSERT/UPDATE policies exist today).
//
// GET  — lists all announcements (admin view: active + inactive + expired),
//        paginated, newest first.
// POST — creates a new announcement.
//
// Auth: super_admin.access (same permission code as the comparable
// super-admin/misconceptions curation route).

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { logAdminAuditByUserId } from '@alfanumrik/lib/admin-auth';
import { logger } from '@alfanumrik/lib/logger';
import { validateCreatePayload } from '@alfanumrik/lib/super-admin/announcement-validation';

export const runtime = 'nodejs';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  target_grades: string[] | null;
  target_subjects: string[] | null;
  is_active: boolean | null;
  created_by: string | null;
  created_at: string | null;
  expires_at: string | null;
}

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function decodeCursor(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const url = request.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const offset = decodeCursor(url.searchParams.get('cursor'));

    const { data, error, count } = await supabaseAdmin
      .from('admin_announcements')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('admin_announcements_list_failed', { error });
      return NextResponse.json({ error: 'list_failed', message: error.message }, { status: 500 });
    }

    const items = (data ?? []) as AnnouncementRow[];
    const nextCursor =
      count != null && offset + items.length < count ? String(offset + items.length) : null;

    return NextResponse.json({ items, next_cursor: nextCursor, total: count ?? items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('admin_announcements_list_unhandled', { message });
    return NextResponse.json({ error: 'unhandled', message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const validated = validateCreatePayload(body);
  if (typeof validated === 'string') {
    return NextResponse.json({ error: validated }, { status: 400 });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('admin_announcements')
    .insert({
      title: validated.title,
      content: validated.content,
      target_grades: validated.target_grades,
      target_subjects: validated.target_subjects,
      expires_at: validated.expires_at,
      created_by: auth.userId ?? null,
      is_active: true,
    })
    .select('id')
    .single();

  if (insertErr) {
    logger.error('admin_announcement_insert_failed', { error: insertErr });
    return NextResponse.json({ error: 'insert_failed', message: insertErr.message }, { status: 500 });
  }

  void logOpsEvent({
    category: 'content.curation',
    source: 'super-admin.announcements',
    severity: 'info',
    message: `announcement created: ${validated.title}`,
    context: { announcement_id: inserted!.id, created_by: auth.userId },
  }).catch(() => {});

  void logAdminAuditByUserId(
    auth.userId,
    'announcement.created',
    'admin_announcement',
    inserted!.id,
    { title: validated.title },
    request.headers.get('x-forwarded-for') ?? undefined,
  );

  return NextResponse.json({ id: inserted!.id, ok: true }, { status: 201 });
}
