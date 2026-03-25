import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
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

    // Structured logging — picked up by Vercel log drains
    logger.error('Client error report', {
      errorMessage: data.message,
      errorStack: data.stack?.slice(0, 500),
      componentStack: data.componentStack?.slice(0, 300),
      url: data.url,
      userAgent: request.headers.get('user-agent')?.slice(0, 200),
      ip,
      source: 'client_error_boundary',
    });

    // Persist to audit_logs (fire-and-forget, don't block response)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      // Fire-and-forget: persist error to audit_logs
      Promise.resolve(
        supabase
          .from('audit_logs')
          .insert({
            action: 'client_error',
            resource_type: 'frontend',
            resource_id: data.url || null,
            details: {
              message: data.message?.slice(0, 500),
              stack: data.stack?.slice(0, 1000),
              componentStack: data.componentStack?.slice(0, 500),
              userAgent: request.headers.get('user-agent')?.slice(0, 200),
            },
            ip_address: ip,
            user_agent: request.headers.get('user-agent')?.slice(0, 500),
            status: 'failure',
          })
      ).catch(() => {}); // never fail the response due to logging
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }
}
