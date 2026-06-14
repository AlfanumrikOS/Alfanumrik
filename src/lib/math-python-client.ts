/**
 * math-python-client.ts — Cloud Run SymPy math-verifier HTTP client
 * (Foxy 3-Agent Math Pipeline, Part 1D — VERIFIER wiring).
 *
 * Pure fetch wrapper around the FastAPI service hosted on Google Cloud Run
 * (asia-south1 / Mumbai). Mirrors `src/lib/voice-python-client.ts`. The
 * verifier endpoint:
 *
 *   POST {base}/v1/math/verify   — JSON problem+answer → tristate verdict
 *
 * It requires a Supabase student JWT (same auth path as the voice endpoints).
 *
 * The TS contract MUST stay in lock-step with the Pydantic models at
 * python/services/ai/business/math/models.py — fields renamed on the Python
 * side break this client.
 *
 * Design constraints (P12 fail-CLOSED, but "unavailable != wrong"):
 *   - Pure function. No React, no state, no SWR. The /api/foxy route owns the
 *     lifecycle + escalation decision.
 *   - FAIL-SOFT (not fail-throw): on ANY non-2xx, network error, timeout,
 *     abort, or shape-mismatch we resolve to `{ is_correct: null, confidence: 0 }`.
 *     A `null` verdict means "could not verify" — the route shows the answer
 *     WITHOUT escalation (verifier unavailability must never escalate a correct
 *     answer, and must never strip a correct answer). A confident `false` is the
 *     ONLY thing that triggers the route's single Sonnet escalation, and the
 *     server (SymPy) is the only producer of `false`.
 *   - Hard timeout: 8s. The verifier is ~10-100ms server-side; 8s leaves
 *     generous headroom for a cold Cloud Run start while staying well inside
 *     the per-plan Foxy timeout. On timeout we fail-soft to null.
 *   - No retries. A transient blip fails soft to null (answer shown, no
 *     escalation) — cheaper and safer than spinning the student.
 *   - No PII in any log/throw — this client never logs; the route logs verdict
 *     + reason only.
 */

// The Cloud Run service URL is injected via NEXT_PUBLIC_PYTHON_AI_BASE_URL.
// This client runs SERVER-SIDE (called from /api/foxy/route.ts), so we read
// both the public and a non-public PYTHON_AI_BASE_URL, falling back to the
// shared prod default used by voice-python-client.ts.
const PROD_DEFAULT_BASE_URL = 'https://ai-services-518404877846.asia-south1.run.app';

/** Resolved Cloud Run base URL. Server-side: prefer PYTHON_AI_BASE_URL, then the public var, then prod. */
export const PYTHON_AI_BASE_URL: string =
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  (typeof process !== 'undefined' &&
    (process.env?.PYTHON_AI_BASE_URL || process.env?.NEXT_PUBLIC_PYTHON_AI_BASE_URL)) ||
  PROD_DEFAULT_BASE_URL;

/** Verify timeout — server work is ~10-100ms; 8s covers a cold start. */
const VERIFY_TIMEOUT_MS = 8_000;

// ── Types (must match python/services/ai/business/math/models.py) ───────────

/** Which deterministic check to run. Mirrors `VerifyKind`. */
export type VerifyMathKind = 'evaluate' | 'solve_equation' | 'simplify';

/** Request body — mirrors `VerifyMathRequest`. */
export interface VerifyMathRequest {
  /** The originating problem in SymPy-parseable form (e.g. "1/2 + 3/4"). */
  problem_expression: string;
  /** The answer Foxy's solver claimed (e.g. "5/4" or "x = 2 or x = 3"). */
  claimed_answer: string;
  /** The check to run. */
  kind: VerifyMathKind;
  /** P5: CBSE grade as a string ("6".."12"). Telemetry only on the server. */
  grade?: string;
}

/**
 * Verdict envelope — mirrors `VerifyMathResponse`.
 *
 * `is_correct` is the TRISTATE fail-closed verdict:
 *   - true  → verified correct.
 *   - false → confidently wrong (the route escalates ONCE to Sonnet).
 *   - null  → could not verify / unavailable (NOT wrong — show without escalation).
 */
export interface VerifyMathResult {
  is_correct: boolean | null;
  confidence: number;
  /** The canonical value/result SymPy computed (diagnostics). May be absent. */
  computed?: string | null;
  /** Short machine/diagnostic reason. Never PII. May be absent. */
  reason?: string | null;
}

/** The canonical fail-soft result: unavailable, NOT wrong. No escalation. */
const UNVERIFIABLE: VerifyMathResult = { is_correct: null, confidence: 0 };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify a claimed math answer via the Cloud Run SymPy endpoint.
 *
 * NEVER throws — on any failure (no JWT, non-2xx, network error, timeout,
 * abort, malformed body) it resolves to `{ is_correct: null, confidence: 0 }`
 * so the /api/foxy route shows the answer without escalation. Only a clean
 * server-side `false` triggers the route's single Sonnet escalation.
 *
 * @param req        problem_expression + claimed_answer + kind (+ optional grade).
 * @param options.jwt Supabase student JWT (Authorization: Bearer ...).
 * @param options.signal Optional AbortSignal for caller-driven cancellation.
 */
export async function verifyMath(
  req: VerifyMathRequest,
  options: { jwt: string; signal?: AbortSignal },
): Promise<VerifyMathResult> {
  // No JWT → can't authenticate; fail-soft to unverifiable (NOT an escalation).
  if (!options.jwt) return UNVERIFIABLE;

  const problem = (req.problem_expression ?? '').trim();
  const claimed = (req.claimed_answer ?? '').trim();
  // Empty inputs can't be verified; don't even spend the round-trip.
  if (!problem || !claimed) return UNVERIFIABLE;

  const url = `${PYTHON_AI_BASE_URL.replace(/\/$/, '')}/v1/math/verify`;
  const body = JSON.stringify({
    problem_expression: problem,
    claimed_answer: claimed,
    kind: req.kind,
    ...(req.grade ? { grade: req.grade } : {}),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.jwt}`,
        Accept: 'application/json',
      },
      body,
      signal: controller.signal,
    });

    // Any non-2xx (auth, 422, 500, 503) → fail-soft to unverifiable. The server
    // returns "could not verify" as a 200 with is_correct=null, so a non-200
    // here is an infra/auth condition, never a wrong-answer signal.
    if (!res.ok) return UNVERIFIABLE;

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return UNVERIFIABLE;
    }
    if (!json || typeof json !== 'object') return UNVERIFIABLE;

    const r = json as Record<string, unknown>;

    // is_correct MUST be exactly true | false | null. Anything else → null.
    const isCorrect: boolean | null =
      r.is_correct === true ? true : r.is_correct === false ? false : null;

    const confidence =
      typeof r.confidence === 'number' && Number.isFinite(r.confidence)
        ? Math.min(1, Math.max(0, r.confidence))
        : 0;

    const computed =
      typeof r.computed === 'string' ? r.computed : r.computed === null ? null : undefined;
    const reason =
      typeof r.reason === 'string' ? r.reason : r.reason === null ? null : undefined;

    return {
      is_correct: isCorrect,
      // When the server couldn't verify (is_correct null) force confidence 0
      // so callers can't misread a stale confidence as a graded signal.
      confidence: isCorrect === null ? 0 : confidence,
      computed,
      reason,
    };
  } catch {
    // Network error / timeout / abort → unverifiable (NOT wrong).
    return UNVERIFIABLE;
  } finally {
    clearTimeout(timer);
  }
}
