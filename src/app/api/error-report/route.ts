import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/error-report
 * Collects client-side error reports from ErrorBoundary and error.tsx.
 * IP-based rate limiting to prevent abuse.
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

    if (process.env.NODE_ENV === 'development') {
      const data = JSON.parse(body);
      console.warn('[Error Report]', data.message || data);
    }

    // TODO: Forward to Sentry, Supabase logs, or external logging service
    // Example: await fetch('https://sentry.io/api/...', { method: 'POST', body });

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }
}
