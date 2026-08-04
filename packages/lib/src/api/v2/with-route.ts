/**
 * withRoute() — cross-cutting safety wrapper for /v2 API route handlers.
 *
 * P2-2 (API response-envelope consolidation). This wraps a Next.js App-Router
 * route handler and adds exactly one thing: a last-resort catch so an
 * unhandled throw becomes a well-formed `/v2` error envelope instead of an
 * opaque Next.js 500 HTML page (or, worse, a leaked stack trace).
 *
 * HAPPY-PATH PASS-THROUGH (do not rewrap successful responses)
 * ===============================================================
 * If the wrapped handler resolves to a `NextResponse`, `withRoute` returns it
 * completely unchanged — same status, same headers, same body. This is
 * deliberate: every existing `/v2` route already builds its success/error
 * responses with `v2Success` / `v2Error` (see `./envelope`), and those shapes
 * are pinned by the Zod contract (`src/lib/api/v2/contract.ts` →
 * `openapi/v2.json` → the generated Dart client). Rewrapping a response that
 * already matches the contract would either double-wrap the envelope or
 * silently diverge from it. `withRoute` only ever touches the response on the
 * THROW path, where no contract-shaped response exists yet.
 *
 * ERROR-PATH ENVELOPE + P13 NO-LEAK GUARANTEE
 * ===============================================================
 * If the handler throws, `withRoute` catches it and returns
 * `v2Error('Internal server error', 500, 'INTERNAL_ERROR')` — a fixed,
 * generic message. It NEVER serializes the caught error's message, stack, or
 * any other internal detail into the response body (P13: no PII / internal
 * details in client-facing output). The full error is logged server-side via
 * the structured `logger` (which redacts PII on its own), tagged with the
 * request id and route path so it stays traceable in Sentry/log aggregation
 * without ever reaching the client. Callers must not pass raw request bodies
 * into `onError`/logging themselves — this wrapper never reads or forwards
 * the request body.
 *
 * REQUEST ID
 * ===============================================================
 * Reads the incoming `x-request-id` header if the caller (or an upstream
 * proxy/middleware) set one; otherwise generates a fresh one via
 * `crypto.randomUUID()`. The id is attached as an `x-request-id` response
 * header ONLY on the error path, and is included in the server-side log line,
 * so a client-reported failure can be correlated to the exact log entry.
 * Happy-path responses are passed through unchanged and are never mutated.
 */
import type { NextRequest, NextResponse } from 'next/server';
import { v2Error } from './envelope';
import { logger } from '../../logger';

/** The `{ params }` shape Next 16 passes as the second arg to EVERY App
 * Router route handler — dynamic segments AND static routes alike (for a
 * static route, Next resolves `params` to `Promise<{}>`, never `undefined`).
 * `params` is therefore always present at runtime, so it is typed as
 * REQUIRED here to match Next's own generated `.next/types/**\/route.ts`
 * check (`type RouteContext = { params: Promise<SegmentParams> }`, no `?`).
 * A `params?:` (optional) declaration here type-checks fine at the call site
 * inside this file, but fails Next's generated per-route type-check the
 * moment ANY route — dynamic or static — assigns `withRoute(...)`'s return
 * value to an exported `GET`/`POST`/etc, because
 * `Promise<TParams> | undefined` does not satisfy `Promise<SegmentParams>`.
 * `withRoute` never reads `context.params` itself, only forwards it through
 * untouched. */
export interface RouteContext<TParams = Record<string, string>> {
  params: Promise<TParams>;
}

/** The exact signature Next.js App-Router route handlers export
 * (`export const GET = withRoute(handler)`), preserved by `withRoute` so the
 * wrapped export type-checks identically to an unwrapped handler. */
export type RouteHandler<TParams = Record<string, string>> = (
  request: NextRequest,
  context: RouteContext<TParams>,
) => Promise<NextResponse> | NextResponse;

export interface WithRouteOptions {
  /** Optional side-channel for callers that want their own error hook (e.g.
   * a route-specific metric) in addition to the built-in structured log.
   * Kept minimal on purpose — no retry/timeout/metrics surface here. */
  onError?: (err: unknown) => void;
}

function resolveRequestId(request: NextRequest): string {
  return request.headers.get('x-request-id') || crypto.randomUUID();
}

/**
 * Wrap a `/v2` route handler with the standard error-safety net.
 *
 * @param handler The route handler. On success, its returned `NextResponse`
 *   is passed through unchanged.
 * @param opts Optional extension point (see `WithRouteOptions`).
 */
export function withRoute<TParams = Record<string, string>>(
  handler: RouteHandler<TParams>,
  opts?: WithRouteOptions,
): RouteHandler<TParams> {
  return async (request: NextRequest, context: RouteContext<TParams>) => {
    try {
      // Happy path: return the handler's response exactly as-is.
      return await handler(request, context);
    } catch (err) {
      const requestId = resolveRequestId(request);

      opts?.onError?.(err);

      // Full detail server-side only. `logger` redacts PII on its own; we
      // additionally never pass the request body here (P13).
      logger.error('Unhandled /v2 route error', {
        requestId,
        method: request.method,
        path: request.nextUrl?.pathname ?? request.url,
        error: err instanceof Error ? err : new Error(String(err)),
      });

      // Generic message only — never the caught error's message/stack.
      const response = v2Error('Internal server error', 500, 'INTERNAL_ERROR');
      response.headers.set('x-request-id', requestId);
      return response;
    }
  };
}
