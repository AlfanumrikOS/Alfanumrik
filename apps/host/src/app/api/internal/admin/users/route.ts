import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminSecret, logAdminAction } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { validateBody, zPlanCode } from '@alfanumrik/lib/validation';

export const runtime = 'nodejs';

// Per-table update field allowlist with TYPE constraints. The previous version
// accepted any value as long as the field name was on a string allowlist —
// admin could set students.subscription_plan='banana' or grade='Kindergarten'
// and it'd write through (only DB CHECK constraints would catch it, and only
// for some columns). Now zod validates each field's value type as well.
const STUDENT_UPDATE_SCHEMA = z.object({
  is_active: z.boolean().optional(),
  account_status: z.enum(['active', 'suspended', 'deactivated', 'pending_deletion']).optional(),
  subscription_plan: zPlanCode.optional(),
  grade: z.enum(['6', '7', '8', '9', '10', '11', '12']).optional(),
  board: z.enum(['CBSE', 'ICSE', 'State Board']).optional(),
}).strict();

const TEACHER_UPDATE_SCHEMA = z.object({
  is_active: z.boolean().optional(),
}).strict();

const GUARDIAN_UPDATE_SCHEMA = z.object({
  is_active: z.boolean().optional(),
}).strict();

const PatchBodySchema = z.discriminatedUnion('table', [
  z.object({ table: z.literal('students'), user_id: z.string().uuid(), updates: STUDENT_UPDATE_SCHEMA }),
  z.object({ table: z.literal('teachers'), user_id: z.string().uuid(), updates: TEACHER_UPDATE_SCHEMA }),
  z.object({ table: z.literal('guardians'), user_id: z.string().uuid(), updates: GUARDIAN_UPDATE_SCHEMA }),
]);

export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;
  const role = sp.get('role') || 'student';
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25')));
  const search = sp.get('search') || '';
  const grade = sp.get('grade') || '';
  const status = sp.get('status') || '';
  const plan = sp.get('plan') || '';
  const offset = (page - 1) * limit;

  try {
    const table = role === 'teacher' ? 'teachers' : role === 'guardian' || role === 'parent' ? 'guardians' : 'students';

    let q = supabase
      .from(table)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) q = q.ilike('name', `%${search}%`);
    if (table === 'students') {
      if (grade) q = q.eq('grade', grade);
      if (plan) q = q.eq('subscription_plan', plan);
      if (status === 'active') q = q.eq('is_active', true);
      if (status === 'suspended') q = q.eq('is_active', false);
    }

    const { data, count, error } = await q;
    if (error) throw error;

    return NextResponse.json({
      data: (data || []).map((r: Record<string, unknown>) => ({ ...r, role: table === 'guardians' ? 'parent' : role })),
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const validation = validateBody(PatchBodySchema, rawBody);
  if (!validation.success) return validation.error;
  const { user_id, table, updates } = validation.data;

  // strict() + per-field types means `updates` already contains only allowlisted,
  // type-safe values — no need to filter again.
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  try {
    const { error } = await supabase.from(table).update(updates).eq('id', user_id);
    if (error) throw error;

    await logAdminAction({ action: 'update_user', entity_type: table, entity_id: user_id, details: updates, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
