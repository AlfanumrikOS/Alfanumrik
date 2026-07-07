/**
 * GET /api/public/v1/marketplace/listings — Public API v1 marketplace (Track A.6).
 * ============================================================================
 * The world-readable catalog of installable integrations (active-only). Served
 * to any VALID public-API key (scope-agnostic — the catalog is platform content,
 * not tenant data, so there is no per-key scope and no tenant filter on the rows
 * themselves). Authentication is still required (a valid key) so the catalog is
 * not anonymously enumerable, and rate-limit headers are attached as usual.
 *
 * P13: listings are platform content — no student/school PII. `scopes_required`
 * is surfaced so an integrator knows which key scopes an install will need.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizePublicApiKey } from '@alfanumrik/lib/public-api/auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Scope-agnostic: any valid (active, unexpired) key may browse the catalog.
  const auth = await authorizePublicApiKey(request, null);
  if (!auth.authorized) return auth.errorResponse!;

  const headers = auth.rateLimitHeaders;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('integration_listings')
      .select('id, slug, name, description, scopes_required, metadata, created_at')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      logger.error('public_api_marketplace_listings_failed', {
        error: new Error(error.message),
        route: '/api/public/v1/marketplace/listings',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch listings' },
        { status: 500, headers },
      );
    }

    return NextResponse.json(
      { success: true, data: { listings: data ?? [] } },
      { headers },
    );
  } catch (err) {
    logger.error('public_api_marketplace_listings_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/public/v1/marketplace/listings',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers },
    );
  }
}
