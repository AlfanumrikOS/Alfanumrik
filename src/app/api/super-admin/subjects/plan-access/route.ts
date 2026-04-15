import { NextRequest, NextResponse } from 'next/server';
import {
  logAdminAudit,
  supabaseAdminHeaders,
  supabaseAdminUrl,
  type AdminAuth,
} from '../../../../../lib/admin-auth';
import { authorizeRequest, type AuthorizationResult } from '../../../../../lib/rbac';
import { z } from 'zod';

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
 * Plan × Subject Access API — controls which subjects each subscription
 * plan unlocks, plus the per-plan max_subjects cap.
 *
 * Phase E (Subject Governance) — backend.
 *
 * GET    list pairs + per-plan caps
 * PUT    action='subject' upsert (plan_code, subject_code) pair
 *        action='cap'     update subscription_plans.max_subjects
 * DELETE remove a (plan_code, subject_code) pair
 */

const SNAKE_CASE = /^[a-z][a-z0-9_]{1,63}$/;
const PLAN_CODE = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]{0,63}$/);

const subjectActionSchema = z.object({
  action: z.literal('subject'),
  plan_code: PLAN_CODE,
  subject_code: z.string().regex(SNAKE_CASE, 'subject_code must be snake_case'),
});

const capActionSchema = z.object({
  action: z.literal('cap'),
  plan_code: PLAN_CODE,
  max_subjects: z.number().int().min(0).max(100),
});

const putSchema = z.discriminatedUnion('action', [subjectActionSchema, capActionSchema]);

const deleteSchema = z.object({
  plan_code: PLAN_CODE,
  subject_code: z.string().regex(SNAKE_CASE),
});

async function planExists(code: string): Promise<boolean> {
  const res = await fetch(
    supabaseAdminUrl(
      'subscription_plans',
      `select=plan_code&plan_code=eq.${encodeURIComponent(code)}&limit=1`
    ),
    { headers: supabaseAdminHeaders() }
  );
  if (!res.ok) return false;
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0;
}

async function subjectExists(code: string): Promise<boolean> {
  const res = await fetch(
    supabaseAdminUrl(
      'subjects',
      `select=code&code=eq.${encodeURIComponent(code)}&limit=1`
    ),
    { headers: supabaseAdminHeaders() }
  );
  if (!res.ok) return false;
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0;
}

// GET — list pairs + plans with caps
export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.subjects.manage');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const [pairsRes, plansRes] = await Promise.all([
      fetch(
        supabaseAdminUrl(
          'plan_subject_access',
          'select=plan_code,subject_code&order=plan_code.asc,subject_code.asc&limit=2000'
        ),
        { headers: supabaseAdminHeaders() }
      ),
      fetch(
        supabaseAdminUrl(
          'subscription_plans',
          'select=plan_code,max_subjects&order=plan_code.asc'
        ),
        { headers: supabaseAdminHeaders() }
      ),
    ]);

    if (!pairsRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch plan_subject_access' }, { status: pairsRes.status });
    }
    if (!plansRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch subscription_plans' }, { status: plansRes.status });
    }

    const rowsRaw = await pairsRes.json();
    const plansRaw = await plansRes.json();
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    const plans = Array.isArray(plansRaw) ? plansRaw : [];
    // Phase I: `data` alias added for frontend compatibility (additive).
    return NextResponse.json({ rows, plans, data: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// PUT — upsert pair OR update cap
export async function PUT(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.subjects.manage');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    if (!(await planExists(data.plan_code))) {
      return NextResponse.json(
        { error: `Unknown plan_code: ${data.plan_code}` },
        { status: 422 }
      );
    }

    if (data.action === 'subject') {
      if (!(await subjectExists(data.subject_code))) {
        return NextResponse.json(
          { error: `Unknown subject_code: ${data.subject_code}` },
          { status: 422 }
        );
      }

      const payload = {
        plan_code: data.plan_code,
        subject_code: data.subject_code,
      };

      const res = await fetch(
        supabaseAdminUrl(
          'plan_subject_access',
          'on_conflict=plan_code,subject_code'
        ),
        {
          method: 'POST',
          headers: {
            ...supabaseAdminHeaders('return=representation'),
            Prefer: 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `Upsert failed: ${text}` }, { status: res.status });
      }

      const upserted = await res.json();
      const row = Array.isArray(upserted) ? upserted[0] : upserted;

      await logAdminAudit(
        asAdminAudit(auth),
        'plan_subject_access.upserted',
        'plan_subject_access',
        `${data.plan_code}:${data.subject_code}`,
        { plan_code: data.plan_code, subject_code: data.subject_code }
      );

      return NextResponse.json({ success: true, data: row });
    }

    // action === 'cap'
    const res = await fetch(
      supabaseAdminUrl(
        'subscription_plans',
        `plan_code=eq.${encodeURIComponent(data.plan_code)}`
      ),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({
          max_subjects: data.max_subjects,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Cap update failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    const row = Array.isArray(updated) ? updated[0] : updated;

    await logAdminAudit(
      asAdminAudit(auth),
      'subscription_plans.cap_updated',
      'subscription_plans',
      data.plan_code,
      { max_subjects: data.max_subjects }
    );

    return NextResponse.json({ success: true, data: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// DELETE — remove a pair
export async function DELETE(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.subjects.manage');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { plan_code, subject_code } = parsed.data;
    const filter =
      `plan_code=eq.${encodeURIComponent(plan_code)}` +
      `&subject_code=eq.${encodeURIComponent(subject_code)}`;

    const res = await fetch(supabaseAdminUrl('plan_subject_access', filter), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Delete failed: ${text}` }, { status: res.status });
    }

    const deleted = await res.json();
    if (Array.isArray(deleted) && deleted.length === 0) {
      return NextResponse.json({ error: 'Pair not found' }, { status: 404 });
    }

    await logAdminAudit(
      asAdminAudit(auth),
      'plan_subject_access.deleted',
      'plan_subject_access',
      `${plan_code}:${subject_code}`,
      { plan_code, subject_code }
    );

    return NextResponse.json({ success: true, deleted });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
