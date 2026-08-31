/**
 * TOMBSTONE — embed-ncert-books retired 2026-08-31.
 *
 * Hand-created directly via the Supabase CLI/dashboard (entrypoint path was
 * `/tmp/user_fn_.../source/index.ts`, not the CI runner path), never
 * committed to git, never deployed by CI. A repo-wide grep across
 * `*.ts`, `*.tsx`, `*.dart`, `*.sql` found zero call sites. NCERT content
 * embedding today runs through `embed-ncert-qa` (live, git-tracked,
 * unaffected by this tombstone).
 *
 * Same tombstone-then-delete pattern used for the 39-function orphan sweep
 * (see docs/audit/launch-readiness/29-edge-function-cleanup-and-m5-status.md).
 * Permanent deletion (`supabase functions delete embed-ncert-books`) is a
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
  console.warn(`[embed-ncert-books:tombstone] method=${req.method} ua="${userAgent}"`)

  return new Response(
    JSON.stringify({
      code: 'GONE',
      error: `The embed-ncert-books Edge Function was retired on ${RETIRED_ON}. It had zero application callers. Use embed-ncert-qa instead.`,
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
})
