/**
 * supabase-client.ts — Pure Supabase client singleton.
 *
 * WHY this file exists:
 *   supabase.ts is 1094 lines and mixes client instantiation with data-access
 *   functions and XP calculations. 51 files import from it. Importing it pulls
 *   XP_RULES, scoring, and 30+ functions into every page bundle — even pages
 *   that only need the Supabase client for reads.
 *
 *   This file exports ONLY the client. New code should import from here.
 *   Existing imports from '@/lib/supabase' continue to work — supabase.ts
 *   re-exports everything from this file.
 *
 * MIGRATION PATH:
 *   1. New files: import { supabase } from '@/lib/supabase-client'
 *   2. Existing files: migrate to supabase-client as they are touched
 *   3. Once supabase.ts has no remaining importers, delete it
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return _supabase;
}

/**
 * Lazy proxy — zero overhead until first use, safe during SSG build.
 * Import this instead of the full supabase.ts for read-only pages.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
