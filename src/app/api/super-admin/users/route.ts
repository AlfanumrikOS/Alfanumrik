import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { validateBody, zUuid, zGrade } from '../../../../lib/validation';
import { z } from 'zod';
import { VALID_ROLES, ROLE_ALIASES } from '@/lib/identity';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const role = params.get('role') || 'student';
    if (!(role in ROLE_ALIASES)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${[...VALID_ROLES, 'guardian'].join(', ')}` }, { status: 400 });
    }
    const page = Math.max(1, parseInt(params.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25') || 25));
    const search = params.get('search');
    if (search && search.length > 200) {
      return NextResponse.json({ error: 'Search query too long (max 200 characters)' }, { status: 400 });
    }
    const offset = (page - 1) * limit;

    const table = role === 'teacher' ? 'teachers' : role === 'guardian' || role === 'parent' ? 'guardians' : 'students';
    let query = `select=*&order=created_at.desc&offset=${offset}&limit=${limit}`;
    if (search) query += `&name=ilike.*${encodeURIComponent(search)}*`;

    const res = await fetch(supabaseAdminUrl(table, query), { headers: supabaseAdminHeaders() });
    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : Array.isArray(data) ? data.length : 0;

    return NextResponse.json({
      data: (data || []).map((r: Record<string, unknown>) => ({ ...r, role: table === 'guardians' ? 'parent' : role })),
      total, page, limit,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();

    // Validate patch payload with Zod
    const userPatchSchema = z.object({
      user_id: zUuid,
      table: z.enum(['students', 'teachers', 'guardians']),
      updates: z.object({
        is_active: z.boolean().optional(),
        account_status: z.enum(['active', 'demo', 'suspended', 'inactive']).optional(),
        subscription_plan: z.enum([
          'free',
          'starter', 'starter_monthly', 'starter_yearly',
          'pro', 'pro_monthly', 'pro_yearly',
          'ultimate_monthly', 'ultimate_yearly',
          'unlimited', 'unlimited_monthly', 'unlimited_yearly',
          'basic', 'premium',
        ]).optional(),
        grade: zGrade.optional(),
        board: z.string().min(1).max(50).optional(),
      }).refine(obj => Object.keys(obj).length > 0, { message: 'At least one update field is required' }),
    });

    const validation = validateBody(userPatchSchema, body);
    if (!validation.success) return validation.error;

    const { user_id, table, updates } = validation.data;

    const allowedFields: Record<string, string[]> = {
      students: ['is_active', 'account_status', 'subscription_plan', 'grade', 'board'],
      teachers: ['is_active'],
      guardians: ['is_active'],
    };

    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (allowedFields[table].includes(k)) safe[k] = v;
    }
    if (Object.keys(safe).length === 0) return NextResponse.json({ error: 'No valid fields for this table' }, { status: 400 });

    const res = await fetch(supabaseAdminUrl(table, `id=eq.${user_id}`), {
      method: 'PATCH', headers: supabaseAdminHeaders('return=minimal'), body: JSON.stringify(safe),
    });

    if (!res.ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

    // If subscription_plan was overridden on students, sync student_subscriptions.plan_code
    if (table === 'students' && typeof safe.subscription_plan === 'string') {
      const rawPlan = safe.subscription_plan as string;
      const canonicalPlan = rawPlan.replace(/_(monthly|yearly)$/, '').replace(/^ultimate$/, 'unlimited').replace(/^basic$/, 'starter').replace(/^premium$/, 'pro');
      await fetch(supabaseAdminUrl('student_subscriptions', `student_id=eq.${user_id}`), {
        method: 'PATCH', headers: supabaseAdminHeaders('return=minimal'),
        body: JSON.stringify({ plan_code: canonicalPlan }),
      });
    }

    const action = safe.is_active === false ? 'user.suspended' : safe.is_active === true ? 'user.activated' : 'user.updated';
    await logAdminAudit(auth, action, table, user_id, { updates: safe });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
