/**
 * Identity System — Audit Logger
 *
 * Structured logging for all identity events. All auth state
 * transitions go through this module for observability.
 *
 * Events are written to the auth_audit_log table (best-effort).
 * A console log is always emitted for server-side visibility.
 *
 * WARNING: Never log passwords, tokens, or session data.
 * Only log: user ID, event type, role, IP, user agent, and
 * safe metadata.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthEventType } from './constants';
import { logger } from '@/lib/logger';

export interface AuditContext {
  /** Supabase admin client (service role) for writing to auth_audit_log */
  supabase: SupabaseClient;
  /** The auth user's UUID */
  authUserId: string;
  /** Client IP address (from x-forwarded-for) */
  ipAddress?: string | null;
  /** Client user agent string */
  userAgent?: string | null;
}

/**
 * Log an identity event to auth_audit_log and console.
 * Best-effort: never throws, never blocks the auth flow.
 *
 * @param ctx - Audit context with supabase client and user info
 * @param eventType - The event type (from AUTH_EVENT_TYPES)
 * @param metadata - Additional context (role, profile_id, error, etc.)
 */
export async function logIdentityEvent(
  ctx: AuditContext,
  eventType: AuthEventType | string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  // Structured log via project logger (PII-safe, Sentry-integrated)
  const isError =
    eventType.includes('failure') || eventType.includes('error');

  if (isError) {
    logger.error(`[Identity] ${eventType}`, {
      authUserId: ctx.authUserId,
      ...metadata,
    });
  } else {
    logger.info(`[Identity] ${eventType}`, {
      authUserId: ctx.authUserId,
      ...metadata,
    });
  }

  // Write to auth_audit_log (best-effort, never block)
  try {
    await ctx.supabase.from('auth_audit_log').insert({
      auth_user_id: ctx.authUserId,
      event_type: eventType,
      ip_address: ctx.ipAddress || null,
      user_agent: ctx.userAgent || null,
      metadata,
    });
  } catch {
    // Audit log write failed — already logged to console above
  }
}

/**
 * Extract audit context from a Next.js request.
 * Helper for API routes.
 */
export function extractAuditContext(
  request: { headers: { get(name: string): string | null } },
  supabase: SupabaseClient,
  authUserId: string
): AuditContext {
  return {
    supabase,
    authUserId,
    ipAddress:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: request.headers.get('user-agent') || null,
  };
}
