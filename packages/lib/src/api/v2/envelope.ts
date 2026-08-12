/**
 * /v2 response envelope helpers.
 *
 * The /v2 standard (see src/app/api/v2/README.md) wraps every response in a
 * discriminated `success` boolean so web + mobile branch on one field:
 *
 *   success: { success: true,  data: <T> }
 *   error:   { success: false, error: string, code?: string }
 *
 * This differs from the legacy `src/lib/api-response.ts` helpers, which emit a
 * BARE `{ data }` / `{ error }` envelope. Use THESE helpers in /v2 routes so the
 * shape matches the contract (`SuccessAck` / `ErrorResponse` in contract.ts) and
 * the seeded encourage route.
 *
 * The success payload `<T>` itself carries `schemaVersion` (per the contract),
 * so callers pass the already-versioned payload object as `data`.
 */
import { NextResponse } from 'next/server';

/** `{ success: true, data: <payload> }` with optional headers. */
export function v2Success<T>(
  data: T,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  return NextResponse.json(
    { success: true, data },
    { status: init?.status ?? 200, headers: init?.headers },
  );
}

/**
 * `{ success: false, error, code?, retryable? }` at the given status.
 *
 * `retryable` (optional, boolean, TOP-LEVEL) is the machine-readable
 * "is it worth sending this exact request again?" signal. It exists because the
 * HTTP status code alone cannot express it for the Flutter offline drain queue
 * (`mobile/lib/data/repositories/offline_drain_service.dart`), which classifies
 * `5xx → retain` and `4xx → discard`:
 *
 *   - a PERMANENT server-side failure returned as 5xx is retried forever, and
 *   - the same failure returned as 4xx makes mobile DISCARD the student's
 *     captured quiz data, which is unacceptable.
 *
 * So a permanent failure stays a 500 (data is preserved) and carries
 * `retryable: false`; a genuine transient stays a 503 and carries
 * `retryable: true`. Omitted entirely when not applicable, so every existing
 * `/v2` error response is byte-identical to before. Typed as a narrow boolean
 * rather than a free-form extras bag so the envelope cannot drift from the Zod
 * contract (`ErrorResponse` in contract.ts → openapi/v2.json → Dart client).
 */
export function v2Error(
  error: string,
  status: number,
  code?: string,
  retryable?: boolean,
): NextResponse {
  const body: {
    success: false;
    error: string;
    code?: string;
    retryable?: boolean;
  } = {
    success: false,
    error,
  };
  if (code) body.code = code;
  if (retryable !== undefined) body.retryable = retryable;
  return NextResponse.json(body, { status });
}
