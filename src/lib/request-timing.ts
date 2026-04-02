/**
 * ALFANUMRIK -- Request Timing Wrapper
 *
 * Wraps Next.js API route handlers to measure execution time,
 * log slow requests, and add timing headers for observability.
 *
 * Usage:
 *   import { withTiming } from '@/lib/request-timing';
 *
 *   async function handler(request: NextRequest) {
 *     // ... business logic ...
 *     return NextResponse.json({ ok: true });
 *   }
 *   export const GET = withTiming(handler, 'GET /api/v1/example');
 *
 * Integrates with:
 *   - src/lib/logger.ts (structured logging)
 *   - src/lib/slo.ts (slow request threshold)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { SLOW_REQUEST_THRESHOLD_MS } from '@/lib/slo';

type RouteHandler = (
  request: NextRequest,
  context?: { params: Record<string, string> },
) => Promise<NextResponse> | NextResponse;

/**
 * Wrap a Next.js API route handler with request timing.
 *
 * @param handler - The route handler function
 * @param label - Human-readable label for logs (e.g. "GET /api/v1/health")
 * @param slowThresholdMs - Override the default slow request threshold
 */
export function withTiming(
  handler: RouteHandler,
  label: string,
  slowThresholdMs: number = SLOW_REQUEST_THRESHOLD_MS,
): RouteHandler {
  return async (request: NextRequest, context?: { params: Record<string, string> }) => {
    const start = performance.now();

    try {
      const response = await handler(request, context);
      const durationMs = Math.round(performance.now() - start);

      // Add Server-Timing header for browser DevTools and monitoring
      response.headers.set('Server-Timing', `handler;dur=${durationMs}`);

      if (durationMs > slowThresholdMs) {
        logger.warn('Slow request detected', {
          label,
          durationMs,
          thresholdMs: slowThresholdMs,
          url: request.url,
          method: request.method,
          status: response.status,
        });
      } else {
        logger.debug('Request completed', {
          label,
          durationMs,
          status: response.status,
        });
      }

      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      logger.error('Request failed', {
        label,
        durationMs,
        url: request.url,
        method: request.method,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}

/**
 * Measure the duration of an async operation and log it.
 * Useful for timing individual sub-operations within a handler.
 *
 * Usage:
 *   const result = await measureAsync('db-query', async () => {
 *     return supabaseAdmin.from('students').select('*');
 *   });
 */
export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>,
  warnThresholdMs: number = SLOW_REQUEST_THRESHOLD_MS,
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = Math.round(performance.now() - start);

  if (durationMs > warnThresholdMs) {
    logger.warn('Slow operation', { label, durationMs, thresholdMs: warnThresholdMs });
  }

  return { result, durationMs };
}
