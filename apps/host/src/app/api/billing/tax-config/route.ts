import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { z } from 'zod';

/**
 * GET /api/billing/tax-config — current active GST rate for a SAC.
 *
 * Track A.3 (per-state GST). Reads the in-force tax_config row (greatest
 * effective_from <= today, active) for the requested SAC and returns the rate +
 * exempt flag. Read-only, no PII (P13) — money/codes only.
 *
 * Auth: any authenticated caller with the 'payments.subscribe' grant can read
 * the rate (it's needed to render tax-inclusive prices at checkout); super_admin
 * / admin bypass automatically via authorizeRequest. No tenant data is exposed.
 *
 * Query:
 *   ?sac=9992  (optional; defaults to 9992 education services)
 *
 * Response: { success, data: { sac, gst_rate, is_exempt, effective_from } }
 */

const querySchema = z.object({
  sac: z.string().trim().min(1).max(16).regex(/^[0-9]+$/, 'sac must be numeric').optional(),
});

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'payments.subscribe');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({ sac: searchParams.get('sac') ?? undefined });
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid sac parameter' }, { status: 400 });
    }
    const sac = parsed.data.sac ?? '9992';

    // Current in-force row: greatest effective_from <= today, active, within period.
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin
      .from('tax_config')
      .select('sac, gst_rate, is_exempt, effective_from, effective_to')
      .eq('sac', sac)
      .eq('is_active', true)
      .lte('effective_from', today)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('billing_tax_config_read_error', { error: new Error(error.message), route: '/api/billing/tax-config' });
      return NextResponse.json({ success: false, error: 'Failed to read tax config' }, { status: 500 });
    }

    if (!data) {
      // No config row for this SAC → treat as 0% (matches compute_gst's no-row behavior).
      return NextResponse.json({
        success: true,
        data: { sac, gst_rate: 0, is_exempt: false, effective_from: null, configured: false },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        sac: data.sac,
        gst_rate: Number(data.gst_rate),
        is_exempt: data.is_exempt === true,
        effective_from: data.effective_from,
        configured: true,
      },
    });
  } catch (err) {
    logger.error('billing_tax_config_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/billing/tax-config',
    });
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
