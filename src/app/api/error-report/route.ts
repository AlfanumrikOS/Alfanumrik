import { NextResponse } from 'next/server';

/**
 * POST /api/error-report
 * Collects client-side error reports from ErrorBoundary and error.tsx.
 * In production, forward these to Sentry, Datadog, or a logging service.
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();

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
