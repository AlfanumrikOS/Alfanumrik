// supabase/functions/grounded-answer/_sb.ts
// Shared Supabase service-role client holder.
//
// Lives in its own module so both index.ts (HTTP handler, needs lazy init)
// and pipeline.ts (stage orchestrator, needs the client) can read/write the
// same singleton without a circular import. Tests call setSbForTests() to
// inject a stub.
//
// Design: module-level `let` + getter/setter. The createClient() call
// happens lazily inside ensureSb() so importing this module is free even
// if SUPABASE_URL is not set (e.g., during unit-test collection).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
let sb: any = null;

/**
 * Lazily initialize the service-role client if it hasn't been injected
 * by a test. Throws if the required env vars are missing.
 */
export function ensureSb(): void {
  if (sb) return;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error(
      'grounded-answer: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set',
    );
  }
  sb = createClient(url, key);
}

/** Get the current client. ensureSb() or setSbForTests() must have run. */
// deno-lint-ignore no-explicit-any
export function getSb(): any {
  return sb;
}

/** Inject a stub. Tests only. */
// deno-lint-ignore no-explicit-any
export function setSbForTests(client: any): void {
  sb = client;
}