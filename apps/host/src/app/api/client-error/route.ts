import { NextRequest, NextResponse } from 'next/server';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { redactPIIInText } from '@alfanumrik/lib/ops-events-redactor';
import { sanitizeUrl } from '@alfanumrik/lib/sentry-client-redact';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
// NOTE (not fixed here, low priority — flagged by audit, out of scope for
// this pass): this in-memory `buckets` Map grows unboundedly over the life
// of the server instance. Stale IP keys are only ever overwritten on their
// next hit, never evicted, so IPs that hit once and never return leak a
// small entry forever. Not a correctness or security issue at current
// traffic, but should get the same MAX_MAP_SIZE-eviction treatment as
// api-rate-limit.ts / proxy.ts's in-memory limiters if this route ever sees
// meaningful unique-IP volume.
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

  // P13: message/stack are free-form client-supplied text that can carry
  // emails/phone numbers/Razorpay IDs pasted or thrown into an error; page_url
  // can carry auth codes/tokens/emails in query params (e.g. /auth/callback?
  // code=...&email=...). ops-events.ts's redactContext() only does key-based
  // redaction on the context object shape — it can't see into these string
  // VALUES. Apply text-level PII redaction / URL query sanitization before
  // this ever reaches storage.
  logOpsEvent({
    category: 'client_error',
    source: 'client-error-api',
    severity: 'warning',
    message: redactPIIInText(body.message.slice(0, 500)).text,
    context: {
      stack: typeof body.stack === 'string' ? redactPIIInText(body.stack.slice(0, 4000)).text : undefined,
      page_url: typeof body.url === 'string' ? sanitizeUrl(body.url) : undefined,
      user_agent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : undefined,
      client_ip: ip,
    },
    requestId: body.requestId,
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
