import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * POST /api/error-report
 *
 * Production error collection endpoint:
 * 1. Receives client-side errors from ErrorBoundary / error.tsx / sendBeacon
 * 2. Persists to audit_logs table for monitoring dashboards
 * 3. Logs structured JSON for Vercel log drains (Datadog, Betterstack, etc.)
 * 4. Rate-limited to 10 reports/min per IP to prevent abuse
 */

// Simple in-memory rate limiter: 10 reports per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW = 60_000;
const RATE_MAX = 10;
const MAX_MAP_SIZE = 5_000; // Prevent unbounded memory growth under DDoS

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    // Evict oldest entries if map is at capacity
    if (rateLimitMap.size >= MAX_MAP_SIZE) {
      const firstKey = rateLimitMap.keys().next().value;
      if (firstKey) rateLimitMap.delete(firstKey);
    }
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

// Cleanup stale rate limit entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    rateLimitMap.forEach((entry, key) => {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    });
  }, 5 * 60_000);
}

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many reports' }, { status: 429 });
  }

  try {
    const body = await request.text();

    // Limit payload size (50 KB max)
    if (body.length > 50_000) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const data = JSON.parse(body);

    // Sanitize log inputs to prevent log injection attacks.
    // Strip control characters that could corrupt log parsers.
    const sanitizeLogField = (val: unknown, maxLen: number): string => {
      if (typeof val !== 'string') return '';
      return val
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // strip control chars
        .slice(0, maxLen);
    };

    const safeMessage = sanitizeLogField(data.message, 500);
    const safeStack = sanitizeLogField(data.stack, 500);
    const safeComponentStack = sanitizeLogField(data.componentStack, 300);
    // Validate URL format — only allow http(s) or relative paths
    const rawUrl = typeof data.url === 'string' ? data.url : '';
    const safeUrl = /^(https?:\/\/|\/)[^\s<>"{}|\\^`]*$/.test(rawUrl) ? rawUrl.slice(0, 500) : '';

    // Structured logging — picked up by Vercel log drains
    logger.error('Client error report', {
      errorMessage: safeMessage,
      errorStack: safeStack,
      componentStack: safeComponentStack,
      url: safeUrl,
      userAgent: request.headers.get('user-agent')?.slice(0, 200),
      ip,
      source: 'client_error_boundary',
    });

    // Persist to audit_logs (fire-and-forget, don't block response)
    try {
      const supabase = getSupabaseAdmin();
      // Fire-and-forget: persist error to audit_logs
      Promise.resolve(
        supabase
          .from('audit_logs')
          .insert({
            action: 'client_error',
            resource_type: 'frontend',
            resource_id: safeUrl || null,
            details: {
              message: safeMessage,
              stack: safeStack,
              componentStack: safeComponentStack,
              userAgent: request.headers.get('user-agent')?.slice(0, 200),
            },
            ip_address: ip,
            user_agent: request.headers.get('user-agent')?.slice(0, 500),
            status: 'failure',
          })
      ).catch(() => {}); // never fail the response due to logging
    } catch {
      // Admin client not configured — skip persistence
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }
}
