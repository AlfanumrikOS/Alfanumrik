/**
 * TOMBSTONE — embed-rag-remaining retired 2026-08-31.
 *
 * Hand-created directly via the Supabase CLI/dashboard (entrypoint path was
 * `/tmp/user_fn_.../source/index.ts`, not the CI runner path), never
 * committed to git, never deployed by CI. A repo-wide grep across
 * `*.ts`, `*.tsx`, `*.dart`, `*.sql` found zero call sites. Appears to be a
 * one-off manual backfill utility (5 revisions, all hand-deployed).
 *
 * Same tombstone-then-delete pattern used for the 39-function orphan sweep
 * (see docs/audit/launch-readiness/29-edge-function-cleanup-and-m5-status.md).
 * Permanent deletion (`supabase functions delete embed-rag-remaining`) is a
 * deliberate follow-up after a 30-day observation window with zero tombstone
 * hits in Edge Function logs.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const RETIRED_ON = '2026-08-31'

serve((req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const userAgent = (req.headers.get('user-agent') || 'unknown').slice(0, 120)
  console.warn(`[embed-rag-remaining:tombstone] method=${req.method} ua="${userAgent}"`)

  return new Response(
    JSON.stringify({
      code: 'GONE',
      error: `The embed-rag-remaining Edge Function was retired on ${RETIRED_ON}. It had zero application callers.`,
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
})
