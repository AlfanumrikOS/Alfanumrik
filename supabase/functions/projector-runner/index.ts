/**
 * projector-runner — Alfanumrik Edge Function
 *
 * Invoked every 1 minute by pg_cron via pg_net.http_post (see migration
 * 20260524110002_projector_runner_cron.sql). Calls `tickAll`, which:
 *
 *   1. Checks `ff_projector_runner_v1` (kill-switch). When OFF — or when
 *      reading the flag throws — returns `{ skipped: true }` and does NOT
 *      advance any subscriber cursors.
 *   2. Iterates registered subscribers (currently just mastery-state-writer)
 *      and processes their queue independently. One subscriber's failure
 *      does not affect another.
 *
 * The function fires a PostHog `projector_runner_summary` event after each
 * tick (fire-and-forget; capture failures never affect the HTTP response).
 *
 * --- Code-sharing note ---
 *
 * The state-runtime lives in `src/lib/state/...` (Next.js / Node TS with
 * `@/*` path aliases and Zod via npm). Supabase Edge Functions run on Deno
 * and cannot reach into the Next.js tree. The standing pattern in this repo
 * (see _shared/posthog.ts, _shared/quiz-oracle.ts, etc.) is to copy
 * cross-platform code into `supabase/functions/_shared/...` and import via
 * relative paths. We follow that pattern here: see
 * `supabase/functions/_shared/state-runtime/`. Keep the two copies in sync
 * by hand; a registry shape test in `src/__tests__/state/` pins the canonical
 * domain-event registry.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { tickAll } from '../_shared/state-runtime/tick-all.ts'
import { standardDispatcher } from '../_shared/state-runtime/dispatcher.ts'
import { defaultLog } from '../_shared/state-runtime/subscriber.ts'
import { capture as posthogCapture } from '../_shared/posthog.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Phase D.6 cold-start mitigation: hoist the supabase-js client construction
// to module scope so a warm Edge Function instance reuses the same client
// across every cron tick. Construction is non-trivial (URL parsing, fetch
// wrapper, internal auth state) and the runner fires every minute — paying
// that cost per tick is wasteful. We still tolerate the env-unset path by
// gating construction on both vars being non-empty; the handler re-checks
// and returns 500 with a clear error if so.
const SB = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null

Deno.serve(async (_req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE || !SB) {
    return new Response(
      JSON.stringify({
        error: 'projector-runner: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }

  const sb = SB
  const start = performance.now()

  try {
    const result = await tickAll({
      sb,
      dispatcher: standardDispatcher,
      ctx: {
        sb,
        dryRun: false,
        now: () => new Date(),
        log: defaultLog,
      },
    })
    const durationMs = Math.round(performance.now() - start)

    // Fire-and-forget. The capture helper swallows its own errors, but
    // belt-and-braces a .catch() in case of unexpected synchronous throw.
    posthogCapture(
      'projector_runner_summary',
      'projector-runner',
      {
        skipped: result.skipped,
        per_subscriber: result.perSubscriber,
        failed_closed_reason: result.failedClosedReason ?? null,
        duration_ms: durationMs,
      },
    ).catch(() => {
      /* never let analytics failures affect the response */
    })

    return new Response(JSON.stringify({ ...result, durationMs }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('projector-runner fatal:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
