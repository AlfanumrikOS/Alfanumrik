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

let _adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;

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
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);
        return fetch(input, {
          ...init,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
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
