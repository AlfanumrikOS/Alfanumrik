import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// POST /api/internal/admin/bulk-action
// Body: { action: string, ids: string[], ...extras }
export async function POST(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { action, ids, ...extras } = await request.json();

    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'action and ids[] required' }, { status: 400 });
    }
    if (ids.length > 500) {
      return NextResponse.json({ error: 'Max 500 records per bulk action' }, { status: 400 });
    }

    let affected = 0;

    switch (action) {
      case 'suspend': {
        const { count } = await supabase
          .from('students')
          .update({ is_active: false, account_status: 'suspended' })
          .in('id', ids)
          .select('id', { count: 'exact', head: true });
        affected = count ?? 0;
        break;
      }
      case 'restore': {
        const { count } = await supabase
          .from('students')
          .update({ is_active: true, account_status: 'active' })
          .in('id', ids)
          .select('id', { count: 'exact', head: true });
        affected = count ?? 0;
        break;
      }
      case 'upgrade_plan': {
        const plan = (extras.plan as string) || 'premium';
        if (!['free', 'basic', 'premium'].includes(plan)) {
          return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
        }
        const { count } = await supabase
          .from('students')
          .update({ subscription_plan: plan })
          .in('id', ids)
          .select('id', { count: 'exact', head: true });
        affected = count ?? 0;
        break;
      }
      case 'downgrade_plan': {
        const { count } = await supabase
          .from('students')
          .update({ subscription_plan: 'free' })
          .in('id', ids)
          .select('id', { count: 'exact', head: true });
        affected = count ?? 0;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAdminAction({
      action: `bulk_${action}`,
      entity_type: 'students',
      details: { ids_count: ids.length, affected, ...extras },
      ip,
    });

    return NextResponse.json({ success: true, action, affected });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
