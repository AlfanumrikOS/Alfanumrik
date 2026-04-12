import { NextRequest, NextResponse } from 'next/server';
import { logOpsEvent } from '@/lib/ops-events';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const buckets = new Map<string, { count: number; windowStart: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

interface ClientErrorPayload {
  message?: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  requestId?: string;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(ip)) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
  }

  let body: ClientErrorPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 });
  }

  if (!body.message || typeof body.message !== 'string') {
    return NextResponse.json({ ok: false, reason: 'missing_message' }, { status: 400 });
  }

  logOpsEvent({
    category: 'client_error',
    source: 'client-error-api',
    severity: 'warning',
    message: body.message.slice(0, 500),
    context: {
      stack: typeof body.stack === 'string' ? body.stack.slice(0, 4000) : undefined,
      page_url: typeof body.url === 'string' ? body.url : undefined,
      user_agent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : undefined,
      client_ip: ip,
    },
    requestId: body.requestId,
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
