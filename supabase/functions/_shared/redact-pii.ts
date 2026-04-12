/**
 * Shared PII redactor — single source of truth for both Next.js and Deno runtimes.
 *
 * Used by:
 * - src/lib/ops-events-redactor.ts (re-exports for Next.js / Vitest)
 * - src/lib/logger.ts (structured logging)
 * - supabase/functions/_shared/ops-events.ts (Deno Edge Functions)
 *
 * Enforces product invariant P13 (Data Privacy):
 *   No PII in client-side logs or Sentry events.
 */

const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password', 'token', 'secret', 'email', 'phone',
  'api_key', 'apikey', 'access_token', 'refresh_token',
  'service_role_key', 'authorization', 'cookie', 'x-api-key',
]);

const REDACTED = '[REDACTED]';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function redactPII(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[Circular]';
    seen.add(v as object);

    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : walk(val);
      }
      return out;
    }
    return v;
  }

  return walk(value);
}