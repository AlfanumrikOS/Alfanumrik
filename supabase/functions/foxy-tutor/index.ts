/**
 * TOMBSTONE — foxy-tutor was retired 2026-07-01.
 *
 * Foxy (the AI tutor) now runs at the Next.js route `/api/foxy`
 * (`apps/host/src/app/api/foxy/route.ts`). Both web and mobile already POST
 * there — `mobile/lib/core/constants/api_constants.dart` defaults
 * `FOXY_ENDPOINT` to `'api'`, and the `_sendViaEdge` branch in
 * `mobile/lib/data/repositories/chat_repository.dart` is documented dead code
 * kept only so any already-installed APK still pinned to `'edge'` fails
 * predictably instead of silently.
 *
 * This function has NO source-controlled implementation left on purpose:
 * every call — regardless of method, auth, or body — gets a structured
 * HTTP 410 Gone pointing at the canonical replacement. This is the same
 * pattern used for `quiz-generator-v2` / `enhanced-quiz-generator` and the
 * rest of the Category A orphan sweep; see
 * `docs/runbooks/edge-function-drift-report.md` for the full drift history
 * and precondition verification for this specific tombstone
 * (P2-4a, 2026-08-04 execution log entry).
 *
 * Reversible: redeploy the real implementation from git history
 * (`git log -- supabase/functions/foxy-tutor/`) if this needs to come back.
 * Permanent removal (`supabase functions delete foxy-tutor`) is a deliberate
 * follow-up after a clean 30-day observation window with no tombstone hits
 * in the Supabase Edge Function logs.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const RETIRED_ON = '2026-07-01'
const CANONICAL = '/api/foxy'

serve((req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Observability only — no PII. Coarse client hint (truncated user-agent),
  // no auth tokens, no request body, no email/phone, no raw IP. Lets ops
  // confirm via Supabase edge logs whether anything still calls this
  // tombstone before permanent deletion (P13).
  const userAgent = (req.headers.get('user-agent') || 'unknown').slice(0, 120)
  console.warn(`[foxy-tutor:tombstone] method=${req.method} ua="${userAgent}"`)

  return new Response(
    JSON.stringify({
      code: 'GONE',
      error: `The foxy-tutor Edge Function was retired on ${RETIRED_ON}. Update the app; Foxy now runs at ${CANONICAL}.`,
      canonical: CANONICAL,
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
})
