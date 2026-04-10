/**
 * Singleton Supabase admin client for server-side API routes.
 *
 * CRITICAL: Every API route was creating a new createClient() per request.
 * At 5K concurrent users this exhausts the Supabase connection pool.
 * This module creates ONE client that reuses connections across all requests.
 *
 * Usage:
 *   import { supabaseAdmin } from '@/lib/supabase-admin';
 *   const { data } = await supabaseAdmin.from('students').select('*');
 *
 * NOTE: This uses the SERVICE_ROLE_KEY — it bypasses RLS.
 * Only use in server-side API routes, never expose to the client.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateServerEnv } from '@/lib/env';

let _adminClient: SupabaseClient | null = null;

// ── Connection health tracking ──
// Tracks recent request outcomes to detect persistent connection issues.
// Used by the health endpoint and for circuit-breaker-style diagnostics.
interface ConnectionHealth {
  totalRequests: number;
  failedRequests: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const _health: ConnectionHealth = {
  totalRequests: 0,
  failedRequests: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  consecutiveFailures: 0,
};

/** Get a snapshot of connection health for monitoring */
export function getAdminClientHealth(): Readonly<ConnectionHealth> {
  return { ..._health };
}

function recordSuccess(): void {
  _health.totalRequests++;
  _health.lastSuccessAt = Date.now();
  _health.consecutiveFailures = 0;
}

function recordFailure(error: unknown): void {
  _health.totalRequests++;
  _health.failedRequests++;
  _health.lastFailureAt = Date.now();
  _health.lastError = error instanceof Error ? error.message : String(error);
  _health.consecutiveFailures++;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;

  // Validate all server env vars (including the NEXT_PUBLIC_ leak check)
  validateServerEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for admin client'
    );
  }

  _adminClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // Global fetch timeout: abort requests that take longer than 10s.
    // Prevents hanging connections from tying up Vercel serverless functions.
    // Vercel has a 30s hard limit; we fail fast at 10s to allow for retries.
    // Also tracks connection health for monitoring/diagnostics.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);
        return fetch(input, {
          ...init,
          signal: controller.signal,
        })
          .then((response) => {
            if (response.ok || response.status < 500) {
              recordSuccess();
            } else {
              recordFailure(new Error(`HTTP ${response.status}`));
            }
            return response;
          })
          .catch((err) => {
            recordFailure(err);
            throw err;
          })
          .finally(() => clearTimeout(timeoutId));
      },
    },
    db: {
      schema: 'public',
    },
  });

  return _adminClient;
}

// Convenience export — lazy-initialized on first property access
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseAdmin();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
