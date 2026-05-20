/**
 * GET /api/super-admin/alfabot/sessions/[sessionId]
 *
 * Returns the full message thread for a single AlfaBot session for forensic
 * abuse review. Distinct from /api/super-admin/alfabot/sessions (the dashboard
 * roster) because this endpoint surfaces MESSAGE CONTENT — a higher-privilege
 * read.
 *
 * Auth: `authorizeAdmin(request, 'super_admin')` plus a check for the NEW
 * permission `alfabot.read_messages`. Until the RBAC migration lands the
 * permission, super_admin level passes (super_admin holds every permission
 * implicitly). The route is designed to be tightened later by swapping in
 * `authorizeRequest(request, 'alfabot.read_messages')` without changing the
 * response shape.
 *
 * Audit (P14): every successful page load writes an audit_logs row with
 * action='alfabot.admin_message_read', resource_id = sessionId, and the
 * caller's admin id. This is the architect's PR 2 plan — message-read access
 * is itself auditable.
 *
 * P13: this endpoint DOES return message content. It is the deliberate
 * exception to the AlfaBot no-PII contract, gated by an admin-level
 * permission. The aggregate dashboard and the recent-sessions list route
 * do not return content.
 *
 * Owner: ops
 * Reviewers: architect (RBAC + audit), backend, testing
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SessionRow {
  id: string;
  anon_id: string;
  audience: string;
  lang: string;
  ip_hash: string | null;
  started_at: string;
  last_message_at: string;
  message_count: number | null;
  rate_limit_hit: boolean | null;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: unknown;
  tokens_used: number | null;
  latency_ms: number | null;
  degraded_mode: boolean | null;
  model: string | null;
  created_at: string;
}

interface AuditRow {
  action: string;
  created_at: string;
  details: Record<string, unknown> | null;
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  // Phase G.1: forensic message read requires super_admin (the highest level
  // currently available). Once `alfabot.read_messages` lands in the RBAC
  // matrix, swap to `authorizeRequest(request, 'alfabot.read_messages')`.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  const { sessionId } = await ctx.params;
  if (!sessionId || !UUID_RX.test(sessionId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid sessionId', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  try {
    // 1. Session metadata
    const { data: sessionRow, error: sessionErr } = await supabaseAdmin
      .from('alfabot_sessions')
      .select('id, anon_id, audience, lang, ip_hash, started_at, last_message_at, message_count, rate_limit_hit')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionErr) {
      logger.error('super-admin.alfabot-session-detail: session fetch failed', {
        error: sessionErr.message,
      });
      return NextResponse.json(
        { success: false, error: 'Fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    if (!sessionRow) {
      return NextResponse.json(
        { success: false, error: 'Session not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const session = sessionRow as SessionRow;

    // 2. Messages, chronological
    const { data: messageRows, error: msgErr } = await supabaseAdmin
      .from('alfabot_messages')
      .select('id, role, content, sources, tokens_used, latency_ms, degraded_mode, model, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (msgErr) {
      logger.error('super-admin.alfabot-session-detail: messages fetch failed', {
        error: msgErr.message,
      });
      return NextResponse.json(
        { success: false, error: 'Fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    const messages = (messageRows ?? []) as MessageRow[];

    // 3. Abuse events for this session (audit_logs.resource_id = sessionId)
    const { data: auditRows, error: auditErr } = await supabaseAdmin
      .from('audit_logs')
      .select('action, created_at, details')
      .in('action', ['alfabot.abuse_blocked', 'alfabot.upstream_failed'])
      .eq('resource_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (auditErr) {
      logger.warn('super-admin.alfabot-session-detail: audit fetch failed (non-fatal)', {
        error: auditErr.message,
      });
    }
    const audits = (auditRows ?? []) as AuditRow[];

    // 4. Write the admin_message_read audit row BEFORE returning. We swallow
    //    audit-write failures so the page can still render, but we MUST attempt
    //    the write — that's the architect's PR 2 contract.
    await logAdminAudit(
      auth,
      'alfabot.admin_message_read',
      'alfabot_session',
      sessionId,
      {
        messageCount: messages.length,
        audience: session.audience,
        lang: session.lang,
      },
      request.headers.get('x-forwarded-for') ?? undefined,
    );

    return NextResponse.json({
      success: true,
      data: {
        session: {
          id: session.id,
          anonId: session.anon_id,
          audience: session.audience,
          lang: session.lang,
          ipHashTruncated: session.ip_hash ? session.ip_hash.slice(0, 12) : null,
          startedAt: session.started_at,
          lastMessageAt: session.last_message_at,
          messageCount: session.message_count ?? messages.length,
          rateLimitHit: Boolean(session.rate_limit_hit),
        },
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sources: m.sources,
          tokensUsed: m.tokens_used,
          latencyMs: m.latency_ms,
          degradedMode: Boolean(m.degraded_mode),
          model: m.model,
          createdAt: m.created_at,
        })),
        abuseEvents: audits.map((a) => ({
          action: a.action,
          createdAt: a.created_at,
          reason: (a.details?.reason as string | undefined) ?? null,
        })),
      },
    });
  } catch (err) {
    logger.error('super-admin.alfabot-session-detail: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
