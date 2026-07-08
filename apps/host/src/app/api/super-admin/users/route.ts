import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { validateBody, zUuid, zGrade } from '../../../../lib/validation';
import { z } from 'zod';
import { VALID_ROLES, ROLE_ALIASES } from '@alfanumrik/lib/identity';

export async function GET(request: NextRequest) {
  // Read-only listing — explicit `support` floor (any active admin row passes).
  const auth = await authorizeAdmin(request, 'support');
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
    // Phase F.6 (2026-05-17): plan filter is now server-side; the subscriptions
    // page no longer needs to filter client-side after fetch.
    const plan = params.get('plan');
    const VALID_PLANS = ['free', 'plus', 'pro', 'unlimited', 'family', 'school', 'institutional'];
    if (plan && !VALID_PLANS.includes(plan)) {
      return NextResponse.json({ error: `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}` }, { status: 400 });
    }
    const offset = (page - 1) * limit;

    const table = role === 'teacher' ? 'teachers' : role === 'guardian' || role === 'parent' ? 'guardians' : 'students';
    let query = `select=*&order=created_at.desc&offset=${offset}&limit=${limit}`;
    if (search) query += `&name=ilike.*${encodeURIComponent(search)}*`;
    if (plan && table === 'students') query += `&subscription_plan=eq.${encodeURIComponent(plan)}`;

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
  // Suspend/restore/plan-change/admin-level changes — high blast radius.
  // Plus school_admins reassignment and admin_users mutation, both of which
  // can grant privileged access. super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();

    // Validate patch payload with Zod
    const userPatchSchema = z.object({
      user_id: zUuid,
      table: z.enum(['students', 'teachers', 'guardians', 'school_admins', 'admin_users']),
      updates: z.object({
        // students
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
        // school_admins: name, email, phone, is_active, school_id (above + new)
        name: z.string().trim().min(1).max(200).optional(),
        email: z.string().email().max(254).optional(),
        phone: z.string().trim().max(32).optional(),
        school_id: zUuid.optional(),
        // admin_users: admin_level
        admin_level: z.enum(['support', 'analyst', 'content_manager', 'finance', 'admin', 'super_admin']).optional(),
      }).refine(obj => Object.keys(obj).length > 0, { message: 'At least one update field is required' }),
    });

    const validation = validateBody(userPatchSchema, body);
    if (!validation.success) return validation.error;

    const { user_id, table, updates } = validation.data;

    const allowedFields: Record<string, string[]> = {
      students: ['is_active', 'account_status', 'subscription_plan', 'grade', 'board'],
      teachers: ['is_active'],
      guardians: ['is_active'],
      school_admins: ['name', 'email', 'phone', 'is_active', 'school_id'],
      admin_users: ['name', 'is_active', 'admin_level'],
    };

    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (allowedFields[table].includes(k)) safe[k] = v;
    }
    if (Object.keys(safe).length === 0) return NextResponse.json({ error: 'No valid fields for this table' }, { status: 400 });

    // ── school_admins: validate target school exists before reassigning ──
    // Cross-tenant moves are a real operation (e.g. demo school → live
    // school), but writing a school_id that no longer exists silently
    // orphans the admin's RLS access. Pre-check.
    if (table === 'school_admins' && typeof safe.school_id === 'string') {
      const lookupRes = await fetch(
        supabaseAdminUrl('schools', `select=id&id=eq.${encodeURIComponent(safe.school_id as string)}&deleted_at=is.null&limit=1`),
        { method: 'GET', headers: supabaseAdminHeaders() },
      );
      if (!lookupRes.ok) {
        return NextResponse.json({ error: 'school_id lookup failed' }, { status: 502 });
      }
      const rows = await lookupRes.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: 'Target school not found (or soft-deleted).' }, { status: 400 });
      }
    }

    // ── admin_users: foot-gun guards ──
    // 1. Cannot edit your own admin_users row (prevents self-demotion AND
    //    self-elevation collapse if you accidentally drop yourself below
    //    super_admin).
    // 2. Cannot change admin_level on a current super_admin unless the
    //    caller is themselves super_admin. (authorizeAdmin already gated us
    //    to super_admin above, but we re-check defensively in case this
    //    route's floor is ever loosened.)
    if (table === 'admin_users') {
      // Fetch the current admin_users row to know who we're touching.
      const targetRes = await fetch(
        supabaseAdminUrl('admin_users', `select=id,auth_user_id,admin_level&id=eq.${encodeURIComponent(user_id)}&limit=1`),
        { method: 'GET', headers: supabaseAdminHeaders() },
      );
      if (!targetRes.ok) {
        return NextResponse.json({ error: 'admin lookup failed' }, { status: 502 });
      }
      const targetRows = await targetRes.json();
      if (!Array.isArray(targetRows) || targetRows.length === 0) {
        return NextResponse.json({ error: 'admin_users row not found.' }, { status: 404 });
      }
      const target = targetRows[0] as { id: string; auth_user_id: string | null; admin_level: string | null };

      // Self-edit guard — only applies when admin_level is being changed.
      // Updating your own `name` is fine; flipping your own level is not.
      if ('admin_level' in safe && target.auth_user_id === auth.userId) {
        return NextResponse.json(
          { error: 'You cannot change your own admin_level. Have another super_admin do it.' },
          { status: 400 },
        );
      }

      // Refuse to mutate the admin_level of someone who is currently
      // super_admin unless the caller is super_admin themselves. (Defense
      // in depth — the route's required level is already super_admin.)
      if ('admin_level' in safe && target.admin_level === 'super_admin' && auth.adminLevel !== 'super_admin') {
        return NextResponse.json(
          { error: "Only a super_admin can change a super_admin's level." },
          { status: 403 },
        );
      }
    }

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

    // Pick the most specific audit-action label so triage is easy.
    // school_admins / admin_users mutations get their own actions because
    // they read very differently in the audit log than a student suspend.
    let action: string;
    if (table === 'admin_users') {
      action = 'admin_level' in safe ? 'admin.level_changed' : safe.is_active === false ? 'admin.suspended' : safe.is_active === true ? 'admin.activated' : 'admin.updated';
    } else if (table === 'school_admins') {
      action = 'school_id' in safe ? 'school_admin.reassigned' : safe.is_active === false ? 'school_admin.suspended' : safe.is_active === true ? 'school_admin.activated' : 'school_admin.updated';
    } else {
      action = safe.is_active === false ? 'user.suspended' : safe.is_active === true ? 'user.activated' : 'user.updated';
    }
    await logAdminAudit(auth, action, table, user_id, { updates: safe });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
