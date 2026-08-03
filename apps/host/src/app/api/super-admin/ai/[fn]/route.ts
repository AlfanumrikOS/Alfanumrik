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
import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';
import { buildInternalCallerHeaders } from '@alfanumrik/lib/security/internal-caller-signing';

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

// Bound the edge-function hop so a hung upstream can't pin this route to the
// full Vercel function budget. Bulk/embed functions self-report progress via
// GET status polls, so 20s is generous for a single hop.
const EDGE_PROXY_TIMEOUT_MS = 20_000;

// Timeout-bounded fetch. Mirrors the module-private helper at
// packages/lib/src/supabase.ts:40 (`fetchWithTimeout`) — that copy is not
// exported from @alfanumrik/lib, so the canonical semantics are replicated
// here until packages/lib exposes a shared export (P1-4a follow-up).
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

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

  let res: Response;
  try {
    res = await fetchWithTimeout(targetUrl.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(signingHeaders ?? {}),
      },
      ...(method === 'POST' ? { body: bodyText } : {}),
    }, EDGE_PROXY_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: `Edge function "${fn}" timed out after ${EDGE_PROXY_TIMEOUT_MS / 1000}s` },
        { status: 504 },
      );
    }
    throw err; // non-timeout network errors keep the pre-existing unhandled-500 path
  }

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
