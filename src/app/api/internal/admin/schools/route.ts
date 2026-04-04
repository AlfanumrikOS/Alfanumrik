import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// GET /api/internal/admin/schools?page=&limit=&search=
export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(100, parseInt(sp.get('limit') || '25'));
  const search = sp.get('search') || '';
  const offset = (page - 1) * limit;

  // Schools + teacher count + student count
  let q = supabase
    .from('schools')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) q = q.ilike('name', `%${search}%`);

  const { data: schools, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with counts
  const enriched = await Promise.all(
    (schools || []).map(async (school: Record<string, unknown>) => {
      const [{ count: tc }, { count: sc }] = await Promise.all([
        supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
        supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', school.id).eq('is_active', true),
      ]);
      return { ...school, teacher_count: tc ?? 0, student_count: sc ?? 0 };
    })
  );

  return NextResponse.json({ data: enriched, total: count ?? 0, page, limit });
}

// POST /api/internal/admin/schools — create school
export async function POST(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const fields = await request.json();
    if (!fields.name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const { data, error } = await supabase.from('schools').insert(fields).select().single();
    if (error) throw error;

    await logAdminAction({ action: 'create_school', entity_type: 'school', entity_id: data.id, details: { name: fields.name }, ip });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
