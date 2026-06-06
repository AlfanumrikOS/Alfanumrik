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

/** `{ success: false, error, code? }` at the given status. */
export function v2Error(
  error: string,
  status: number,
  code?: string,
): NextResponse {
  const body: { success: false; error: string; code?: string } = {
    success: false,
    error,
  };
  if (code) body.code = code;
  return NextResponse.json(body, { status });
}
