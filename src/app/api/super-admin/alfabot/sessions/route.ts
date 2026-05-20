/**
 * GET /api/super-admin/alfabot/sessions
 *
 * Recent-sessions roster for the AlfaBot super-admin dashboard. The dashboard
 * table never shows message content — only:
 *   - started_at, last_message_at, audience, lang, message_count
 *   - truncated ip_hash (first 8 chars)
 *   - rate_limit_hit boolean
 *
 * Pagination: `?limit=50&before=<iso>` keyset on `last_message_at`. Default
 * limit is 50; max 200.
 *
 * Auth: `authorizeAdmin(request, 'support')` — operational listing.
 *
 * P13: NO PII. ip_hash is a salted SHA-256 of the request IP (see route.ts
 * IP-hash construction); truncating to 8 chars preserves uniqueness for
 * debugging without making the original IP recoverable. user_agent_hash
 * is omitted from the response entirely.
 *
 * Owner: ops
 * Reviewers: backend (query), architect (PII review), testing
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionListItem {
  id: string;
  audience: string;
  lang: string;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  ipHashTruncated: string | null;
  rateLimitHit: boolean;
}

interface SessionRow {
  id: string;
  audience: string;
  lang: string;
  started_at: string;
  last_message_at: string;
  message_count: number | null;
  ip_hash: string | null;
  rate_limit_hit: boolean | null;
}

function parseLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 50;
  if (!Number.isFinite(n)) return 50;
  return Math.min(200, Math.max(1, n));
}

function isIsoDate(s: string | null): s is string {
  if (!s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const limit = parseLimit(params.get('limit'));
    const before = params.get('before');

    let query = supabaseAdmin
      .from('alfabot_sessions')
      .select('id, audience, lang, started_at, last_message_at, message_count, ip_hash, rate_limit_hit')
      .order('last_message_at', { ascending: false })
      .limit(limit + 1); // fetch one extra to compute `hasMore`

    if (isIsoDate(before)) {
      query = query.lt('last_message_at', before);
    }

    const { data, error } = await query;
    if (error) {
      logger.error('super-admin.alfabot-sessions: fetch failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as SessionRow[];
    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;

    const items: SessionListItem[] = visible.map((r) => ({
      id: r.id,
      audience: r.audience,
      lang: r.lang,
      startedAt: r.started_at,
      lastMessageAt: r.last_message_at,
      messageCount: r.message_count ?? 0,
      // ip_hash is already a hash; truncate further for the UI just to keep
      // the table compact.
      ipHashTruncated: r.ip_hash ? r.ip_hash.slice(0, 8) : null,
      rateLimitHit: Boolean(r.rate_limit_hit),
    }));

    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].lastMessageAt
      : null;

    return NextResponse.json({
      success: true,
      data: items,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (err) {
    logger.error('super-admin.alfabot-sessions: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
