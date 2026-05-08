import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { validateBody, zPlanCode } from '@/lib/validation';

export const runtime = 'nodejs';

// Bulk-action body schema. `upgrade_plan` requires a `plan` field constrained
// to the canonical plan codes; the previous version accepted ['free','basic','premium']
// — `basic` and `premium` are legacy values that the chk_student_plan_code DB
// constraint still accepts for backwards compat but no downstream entitlement
// code recognises. Setting subscription_plan='premium' silently broke Foxy
// limits, leaderboard tier badges, and renewal flow until reconciliation.
// Now constrained to zPlanCode (free/starter/pro/unlimited) — the same enum
// used everywhere else (payments/verify, payments/create-order, plan_subject_access
// CHECK constraint).
const BulkActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('suspend'),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal('restore'),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal('upgrade_plan'),
    ids: z.array(z.string().uuid()).min(1).max(500),
    plan: zPlanCode,
  }),
  z.object({
    action: z.literal('downgrade_plan'),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
]);

// POST /api/internal/admin/bulk-action
export async function POST(request: NextRequest) {
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
  const validation = validateBody(BulkActionSchema, rawBody);
  if (!validation.success) return validation.error;
  const body = validation.data;

  try {
    switch (body.action) {
      case 'suspend': {
        const { error } = await supabase
          .from('students')
          .update({ is_active: false, account_status: 'suspended' })
          .in('id', body.ids);
        if (error) throw error;
        break;
      }
      case 'restore': {
        const { error } = await supabase
          .from('students')
          .update({ is_active: true, account_status: 'active' })
          .in('id', body.ids);
        if (error) throw error;
        break;
      }
      case 'upgrade_plan': {
        const { error } = await supabase
          .from('students')
          .update({ subscription_plan: body.plan })
          .in('id', body.ids);
        if (error) throw error;
        break;
      }
      case 'downgrade_plan': {
        const { error } = await supabase
          .from('students')
          .update({ subscription_plan: 'free' })
          .in('id', body.ids);
        if (error) throw error;
        break;
      }
    }

    await logAdminAction({
      action: `bulk_${body.action}`,
      entity_type: 'students',
      details: {
        ids_count: body.ids.length,
        ...(body.action === 'upgrade_plan' ? { plan: body.plan } : {}),
      },
      ip,
    });

    return NextResponse.json({ success: true, action: body.action, affected: body.ids.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
