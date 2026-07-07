import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { z } from 'zod';

/**
 * POST /api/super-admin/billing/tax-config — set/update a per-SAC GST rate.
 *
 * Track A.3 (per-state GST). HISTORY-PRESERVING: a rate change inserts a NEW
 * effective-dated tax_config row (never an UPDATE-in-place), so any issued
 * invoice can always be reconstructed against the rate in force on its date.
 *
 * Auth: super_admin floor (revenue/legal-impacting). Maps onto the existing
 * platform-admin surface — mirrors the migration's is_platform_super_admin()
 * finance-writer stand-in (no dedicated finance role exists yet; adding one is a
 * CEO decision). Audit is metadata-only (P13): SAC + rate codes, no PII.
 *
 * Body:
 *   { sac: string(numeric), gst_rate: number(0..100), is_exempt?: boolean,
 *     effective_from?: 'YYYY-MM-DD', notes?: string }
 *
 * Response: { success, data: { id, sac, gst_rate, is_exempt, effective_from } }
 *
 * NOTE: This does NOT change the seeded placeholder rate — operators choose the
 * value. The CEO/finance go-live confirmation of SAC 9992 taxable-vs-exempt is a
 * deliberate human action performed THROUGH this endpoint, not a code default.
 */

const bodySchema = z.object({
  sac: z.string().trim().min(1).max(16).regex(/^[0-9]+$/, 'sac must be numeric'),
  gst_rate: z.number().min(0).max(100),
  is_exempt: z.boolean().optional().default(false),
  // Defaults to today (server-side) when omitted; history rows are append-only.
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be YYYY-MM-DD').optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' },
        { status: 400 },
      );
    }
    const { sac, gst_rate, is_exempt, notes } = parsed.data;
    const effectiveFrom = parsed.data.effective_from ?? new Date().toISOString().slice(0, 10);

    // History-preserving insert. The migration's uq_tax_config_sac_effective
    // unique index makes (sac, effective_from) idempotent — a same-day re-post
    // is upserted (rate/exempt refreshed) rather than erroring. We NEVER mutate
    // an older effective_from row.
    const { data, error } = await supabaseAdmin
      .from('tax_config')
      .upsert(
        {
          sac,
          gst_rate,
          is_exempt,
          effective_from: effectiveFrom,
          is_active: true,
          notes: notes ?? null,
        },
        { onConflict: 'sac,effective_from' },
      )
      .select('id, sac, gst_rate, is_exempt, effective_from')
      .maybeSingle();

    if (error || !data) {
      logger.error('super_admin_tax_config_write_error', {
        error: new Error(error?.message ?? 'no row returned'),
        route: '/api/super-admin/billing/tax-config',
      });
      return NextResponse.json({ success: false, error: 'Failed to write tax config' }, { status: 500 });
    }

    // Audit (metadata only, P13): codes + rate, no PII.
    await logAdminAudit(
      auth,
      'billing.tax_config_set',
      'tax_config',
      data.id,
      { sac, gst_rate, is_exempt, effective_from: effectiveFrom },
      request.headers.get('x-forwarded-for') || undefined,
    );

    return NextResponse.json({
      success: true,
      data: {
        id: data.id,
        sac: data.sac,
        gst_rate: Number(data.gst_rate),
        is_exempt: data.is_exempt === true,
        effective_from: data.effective_from,
      },
    });
  } catch (err) {
    logger.error('super_admin_tax_config_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/super-admin/billing/tax-config',
    });
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
