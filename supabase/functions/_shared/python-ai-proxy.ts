// supabase/functions/_shared/python-ai-proxy.ts
//
// Phase 1 (2026-05-24) — Python AI services cutover proxy helper.
//
// Background:
//   Phase 0 (PR #905) shipped the FastAPI service skeleton on Google Cloud Run
//   (asia-south1 / Mumbai). Phase 1 moves real traffic over per-function, one
//   function at a time, behind dedicated rollout flags. The clients (mobile +
//   web) keep calling the same Supabase Edge URLs. Each TS Edge Function adds
//   a 10-line proxy block at the TOP of its handler that:
//
//     1. reads its dedicated feature flag envelope
//        ({ enabled, kill_switch, rollout_pct })
//     2. hash-buckets the per-request id against `rollout_pct`
//     3. if `should_proxy` → forwards to Cloud Run, returns the response
//        verbatim (including stream)
//     4. on ANY proxy error → falls through to the existing TS path
//
// Default OFF everywhere (rollout_pct=0). Ops manually bumps to 10% → 25% →
// 50% → 100% over 24-48h per the
// docs/PYTHON_AI_OPERATIONS.md rollout playbook.
//
// Architecture decisions (locked):
//
//   * One flag per function — NOT one shared flag. Each function has its own
//     blast radius and its own cutover schedule. ff_python_bulk_question_gen_v1
//     is the first; ff_python_foxy_tutor_v1, ff_python_ncert_solver_v1 etc.
//     will follow. The shared-flag pattern (ff_mol_admin_functions_v1) only
//     made sense because all six admin functions used the same MoL framework;
//     here Python vs TS is an actual runtime swap and per-function control
//     matters.
//
//   * Hash bucket the REQUEST id (not the student id). The same student making
//     two requests should be able to get one bucket-hit and one bucket-miss —
//     we want a uniform random fraction of TRAFFIC on Python, not a uniform
//     random fraction of STUDENTS. bulk-question-gen is admin-only so there's
//     no student id anyway.
//
//   * 30s timeout. Cloud Run cold-start budget is ~5s + the function's own
//     processing (~3-15s for bulk-question-gen with 50 questions). 30s leaves
//     headroom; longer would conflict with Vercel's 60s wall on the eventual
//     API-route side.
//
//   * Streaming-friendly. bulk-question-gen doesn't stream today but
//     foxy-tutor will in Phase 3. The forwarder pipes the response body
//     through unchanged so SSE works without code changes.
//
//   * Proxy failure → caller fallback. The forwarder THROWS on non-2xx or
//     timeout. The caller (the Edge Function) catches and falls through to
//     its existing TS path. Never 502 the user because Cloud Run is down —
//     the TS path is the safety net during transition.
//
//   * PYTHON_AI_BASE_URL env var. When empty, the helper reports
//     should_proxy=false unconditionally regardless of flag state. This is
//     the architect-controlled kill: until the Cloud Run service URL is
//     wired in, the proxy is dead code even with the flag bumped.

import { getFlagEnvelope } from './mol/feature-flag.ts'

/** Decision returned by `shouldProxyToPython`. */
export interface ProxyDecision {
  /** When true, the caller MUST forward via `forwardToPython`. */
  should_proxy: boolean
  /** Full URL the forwarder will POST to (origin + endpoint_path). Null when should_proxy=false. */
  target_url: string | null
  /** Human-readable reason for the decision. For diagnostic logs only — not stable for parsing. */
  reason: string
}

/** Envelope shape stored in feature_flags.metadata. All fields optional at the type level. */
interface ProxyEnvelope {
  enabled?: boolean
  kill_switch?: boolean
  rollout_pct?: number
}

/** Conservative default if rollout_pct is missing from the envelope. */
const DEFAULT_ROLLOUT_PCT = 0

/**
 * Default forward timeout. Cloud Run cold start budget + bulk-question-gen
 * worst-case (50 questions × ~600ms LLM token streaming) leaves headroom.
 * Exposed via the `signal` parameter on `forwardToPython` if the caller
 * needs a tighter cap.
 */
const DEFAULT_FORWARD_TIMEOUT_MS = 30_000

/**
 * Deterministic 0-99 hash bucket from a request_id. Same xor-shift shape
 * as feature-flag.ts:inRolloutBucket and mol-shadow.ts:shadowBucket so
 * downstream analytics see identical bucket semantics across all three
 * sampling layers.
 */
function hashBucket(request_id: string): number {
  let h = 0
  for (let i = 0; i < request_id.length; i++) {
    h = ((h << 5) - h + request_id.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 100
}

/**
 * Read + normalize the proxy envelope for a named flag. Never throws — on
 * any error (flag missing, malformed metadata, network failure), returns a
 * fully-disabled envelope so the helper short-circuits to the TS path.
 *
 * Defensive default mirrors isMolAdminRoutingEnabled(): if Supabase is
 * down briefly we lose the rollout for a few minutes, but we NEVER
 * accidentally proxy to Cloud Run when ops thinks the flag is off.
 */
async function readEnvelope(flag_name: string): Promise<Required<ProxyEnvelope>> {
  try {
    const { is_enabled, metadata } = await getFlagEnvelope(flag_name)
    const env = (metadata ?? {}) as ProxyEnvelope
    // Mirror the ff_mol_admin_functions_v1 precedence:
    //   1. metadata.enabled === false  → disabled (explicit override)
    //   2. typeof metadata.enabled === 'boolean' → that value
    //   3. else → is_enabled column
    const enabled = typeof env.enabled === 'boolean' ? env.enabled : is_enabled === true
    const kill_switch = env.kill_switch === true
    const rollout_pct =
      typeof env.rollout_pct === 'number' && Number.isFinite(env.rollout_pct)
        ? Math.max(0, Math.min(100, env.rollout_pct))
        : DEFAULT_ROLLOUT_PCT
    return { enabled, kill_switch, rollout_pct }
  } catch {
    return { enabled: false, kill_switch: false, rollout_pct: 0 }
  }
}

/**
 * Decide whether THIS request should be forwarded to Python on Cloud Run
 * or executed by the local TS path.
 *
 * Short-circuit order (all return should_proxy=false):
 *   1. PYTHON_AI_BASE_URL env var missing or empty (architect kill)
 *   2. envelope.enabled !== true
 *   3. envelope.kill_switch === true
 *   4. hashBucket(request_id) >= rollout_pct
 *
 * Never throws. On any internal error returns should_proxy=false with a
 * `reason` describing the fallback path.
 */
export async function shouldProxyToPython(args: {
  flag_name: string
  endpoint_path: string
  request_id: string
}): Promise<ProxyDecision> {
  const baseUrl = (Deno.env.get('PYTHON_AI_BASE_URL') ?? '').trim()
  if (!baseUrl) {
    return {
      should_proxy: false,
      target_url: null,
      reason: 'PYTHON_AI_BASE_URL is empty — Cloud Run service URL not wired in',
    }
  }

  const envelope = await readEnvelope(args.flag_name)
  if (!envelope.enabled) {
    return { should_proxy: false, target_url: null, reason: `flag ${args.flag_name} disabled` }
  }
  if (envelope.kill_switch) {
    return { should_proxy: false, target_url: null, reason: `flag ${args.flag_name} kill_switch=true` }
  }
  const bucket = hashBucket(args.request_id)
  if (bucket >= envelope.rollout_pct) {
    return {
      should_proxy: false,
      target_url: null,
      reason: `request_id bucket ${bucket} >= rollout_pct ${envelope.rollout_pct}`,
    }
  }

  // Compose the full target URL. Tolerate trailing-slash + leading-slash
  // combinations because the env var convention is loose ("base URL" might
  // or might not end in /; "endpoint path" might or might not start with /).
  const left = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const right = args.endpoint_path.startsWith('/') ? args.endpoint_path : `/${args.endpoint_path}`

  return {
    should_proxy: true,
    target_url: `${left}${right}`,
    reason: `flag ${args.flag_name} enabled, bucket ${bucket} < rollout_pct ${envelope.rollout_pct}`,
  }
}

/**
 * Forward a Request to the Python service on Cloud Run and return the
 * response verbatim.
 *
 * Body + headers are forwarded as-is (including Authorization — the Python
 * service performs its own JWT verification + admin gate, mirroring the TS
 * verifyAdminAuth contract). The response body is STREAMED back so SSE
 * content types work transparently (foxy-tutor Phase 3 needs this).
 *
 * THROWS on:
 *   - network errors
 *   - timeout (default 30s, override via `signal`)
 *   - any non-2xx response (caller decides whether to fall through to the
 *     TS path or return 502 to the user — bulk-question-gen falls through)
 *
 * The throw is intentional: a caller that prefers a hard 502 can re-raise.
 * A caller that prefers safety (bulk-question-gen) catches and falls
 * through to the legacy TS code below the proxy block.
 *
 * NB: this function does NOT log the body. Per P13 the body may carry
 * student-identifiable text (foxy-tutor's userMessage) once it's wired in.
 * Forwarding is purely byte-for-byte; the helper never inspects payload.
 */
export async function forwardToPython(args: {
  target_url: string
  request: Request
  /** Optional override for the 30s default timeout. Useful in tests. */
  timeout_ms?: number
}): Promise<Response> {
  const timeoutMs = args.timeout_ms ?? DEFAULT_FORWARD_TIMEOUT_MS

  // Clone the incoming body so we don't consume the original Request stream
  // (the caller may still need to fall through to the TS path on failure,
  // which re-reads req.json()).
  //
  // Notes:
  //   * For non-GET/HEAD methods we capture the body as an ArrayBuffer once
  //     and pass it through. This forces us to buffer (Cloud Run anyway
  //     buffers in the function front-end), but it preserves the ability
  //     for the caller to call `req.clone().json()` after a proxy failure.
  //   * For GET/HEAD we skip the body entirely.
  let body: ArrayBuffer | null = null
  if (args.request.method !== 'GET' && args.request.method !== 'HEAD') {
    // Read from a clone so the original Request stays usable by the
    // fallback TS path.
    try {
      body = await args.request.clone().arrayBuffer()
    } catch (err) {
      throw new Error(`python-ai-proxy: failed to capture body — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Build the forwarded headers. We preserve everything (Authorization,
  // content-type, x-request-id, x-cron-secret if present) and let the
  // Python service decide what it cares about. We deliberately do NOT
  // strip headers — that's the Python service's responsibility per the
  // PYTHON_AI_ARCHITECTURE spec (which mirrors the TS auth contract).
  const headers = new Headers(args.request.headers)
  // Host is incorrect after a cross-origin POST and breaks some HTTP
  // stacks; Cloud Run computes its own Host so we drop it to be safe.
  headers.delete('host')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let upstream: Response
  try {
    upstream = await fetch(args.target_url, {
      method: args.request.method,
      headers,
      body,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`python-ai-proxy: timeout after ${timeoutMs}ms forwarding to ${args.target_url}`)
    }
    throw new Error(
      `python-ai-proxy: fetch to ${args.target_url} failed — ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  clearTimeout(timer)

  if (!upstream.ok) {
    // Drain the body for the error message (cap at 200 chars to avoid
    // huge log spam) then throw. The caller decides the next step
    // (fall through, or 502 to user).
    let snippet = ''
    try {
      const txt = await upstream.text()
      snippet = txt.slice(0, 200)
    } catch {
      // ignore
    }
    throw new Error(
      `python-ai-proxy: upstream returned HTTP ${upstream.status} from ${args.target_url} — ${snippet}`,
    )
  }

  // Pass the response through verbatim — body stream + status + headers.
  // Returning `upstream` directly works because Response is single-use; the
  // helper has not read the body on the success path.
  return upstream
}
