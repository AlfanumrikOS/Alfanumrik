/**
 * /api/super-admin/ai/[fn]
 *
 * Authenticated proxy for admin bulk/embed Edge Functions that use the
 * Platform Security Layer (Phase 4). Routes to one of the 10 allowed
 * Edge Functions, signing each request with HMAC-SHA256 internal caller
 * headers so the Edge Function's admitAiRoute layer can verify the caller.
 *
 * Auth: super_admin level via authorizeAdmin (session-based).
 * Signing: buildInternalCallerHeaders (${fn}-proxy caller name).
 *
 * Supports both GET (status/overview) and POST (generation/ingestion).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { buildInternalCallerHeaders } from '@/lib/security/internal-caller-signing';

const ALLOWED_FUNCTIONS = new Set([
  'embed-questions',
  'embed-ncert-qa',
  'embed-diagrams',
  'extract-diagrams',
  'bulk-jee-neet-import',
  'generate-answers',
  'generate-concepts',
  'extract-ncert-questions',
  'bulk-non-mcq-gen',
  'bulk-question-gen',
]);

async function proxyToEdgeFunction(
  request: NextRequest,
  fn: string,
  method: 'GET' | 'POST',
): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const edgePath = `/functions/v1/${fn}`;
  const bodyText = method === 'POST' ? await request.text() : '';

  // Preserve query string for GET (status) requests
  const srcUrl = new URL(request.url);
  const targetUrl = new URL(`${supabaseUrl}${edgePath}`);
  srcUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  const signingHeaders = buildInternalCallerHeaders(method, edgePath, bodyText, `${fn}-proxy`);

  const res = await fetch(targetUrl.toString(), {
    method,
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(signingHeaders ?? {}),
    },
    ...(method === 'POST' ? { body: bodyText } : {}),
  });

  const responseBody = await res.text();
  return new NextResponse(responseBody, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fn: string }> },
): Promise<NextResponse> {
  const { fn } = await params;
  if (!ALLOWED_FUNCTIONS.has(fn)) {
    return NextResponse.json({ error: 'Unknown function' }, { status: 404 });
  }
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;
  return proxyToEdgeFunction(request, fn, 'GET');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fn: string }> },
): Promise<NextResponse> {
  const { fn } = await params;
  if (!ALLOWED_FUNCTIONS.has(fn)) {
    return NextResponse.json({ error: 'Unknown function' }, { status: 404 });
  }
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;
  return proxyToEdgeFunction(request, fn, 'POST');
}
