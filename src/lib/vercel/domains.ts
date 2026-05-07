/**
 * ALFANUMRIK — Vercel Domain API client (white-label custom domains)
 *
 * Thin typed wrapper around Vercel's REST API for attaching custom
 * domains to the project. Used by /api/super-admin/institutions/
 * attach-vercel-domain to wire a tenant's custom_domain into Vercel
 * routing + TLS provisioning.
 *
 * Auth: requires the env vars
 *   - VERCEL_API_TOKEN     (project-scoped or team-scoped token)
 *   - VERCEL_PROJECT_ID    (e.g. prj_1PRfOVHYbSemMYSU5DXCMIUG9sda)
 *   - VERCEL_TEAM_ID       (optional; only needed for team-scoped tokens)
 *
 * Fail-graceful: when env vars are missing, every helper returns a typed
 * "not configured" error rather than throwing. Callers surface that as a
 * UI message ("Configure VERCEL_API_TOKEN in production") so partial
 * deployments don't 5xx.
 *
 * Why a separate module (not folded into a route file):
 *   - Tested in isolation (no NextRequest scaffolding needed).
 *   - Reused later by the periodic re-verification cron (separate PR).
 *
 * Vercel API reference:
 *   POST /v10/projects/{id}/domains      — attach domain to project
 *   GET  /v9/projects/{id}/domains/{name} — read attach + verification state
 *   DELETE /v10/projects/{id}/domains/{name} — detach
 */

const VERCEL_API_BASE = 'https://api.vercel.com';

// ─── Types ─────────────────────────────────────────────────────────────

export interface VercelEnv {
  apiToken: string;
  projectId: string;
  teamId?: string;
}

/** Vercel-side DNS instruction record (CNAME / A / TXT) the operator
 *  must publish for the domain to verify on Vercel's side. */
export interface VercelVerificationRecord {
  type: string; // 'TXT' | 'CNAME' | 'A' | etc.
  domain: string;
  value: string;
  reason: string;
}

/** Domain attachment response shape, normalised across Vercel's various
 *  API versions. */
export interface VercelDomainState {
  /** Domain name (e.g. 'learn.dps.com'). */
  name: string;
  /** True when Vercel has confirmed ownership AND DNS is correctly pointed. */
  verified: boolean;
  /** When false, DNS is correctly pointed; when true, DNS records still
   *  need to be set or are stale. */
  misconfigured?: boolean;
  /** DNS records the operator must publish to complete Vercel-side
   *  verification. Empty when verified=true. */
  verification: VercelVerificationRecord[];
  createdAt?: number;
}

export type VercelResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string };

// ─── Env resolution ────────────────────────────────────────────────────

/**
 * Read Vercel API credentials from the environment. Returns null when
 * required vars are missing — callers should surface "Vercel API not
 * configured" rather than throwing.
 */
export function getVercelEnv(): VercelEnv | null {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!apiToken || !projectId) return null;
  return { apiToken, projectId, teamId: teamId || undefined };
}

// ─── HTTP helper ───────────────────────────────────────────────────────

async function vercelFetch(
  path: string,
  init: RequestInit & { env: VercelEnv },
): Promise<Response> {
  const url = new URL(VERCEL_API_BASE + path);
  if (init.env.teamId) url.searchParams.set('teamId', init.env.teamId);

  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${init.env.apiToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

// ─── Operations ────────────────────────────────────────────────────────

/**
 * Attach a domain to the Vercel project. Vercel's response shape varies
 * slightly across API versions; we normalise to {@link VercelDomainState}.
 *
 * Idempotent on Vercel's side: re-attaching an already-attached domain
 * returns the same state without error (Vercel deduplicates by name).
 */
export async function attachDomainToProject(
  domain: string,
): Promise<VercelResult<VercelDomainState>> {
  const env = getVercelEnv();
  if (!env) {
    return {
      ok: false,
      status: 500,
      code: 'VERCEL_NOT_CONFIGURED',
      error: 'Vercel API not configured (set VERCEL_API_TOKEN and VERCEL_PROJECT_ID).',
    };
  }

  let res: Response;
  try {
    res = await vercelFetch(`/v10/projects/${env.projectId}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
      env,
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: 'VERCEL_NETWORK_ERROR',
      error: err instanceof Error ? err.message : 'Vercel network error',
    };
  }

  // 409 = domain already attached. Treat as success and re-fetch state
  // so the caller gets the canonical verification array.
  if (res.status === 409) {
    return getDomainState(domain);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      status: res.status,
      code: (body as { error?: { code?: string } })?.error?.code,
      error: (body as { error?: { message?: string } })?.error?.message
        ?? `Vercel returned HTTP ${res.status}`,
    };
  }

  const body = (await res.json()) as Record<string, unknown>;
  return { ok: true, data: normaliseDomainResponse(domain, body) };
}

/**
 * Read the current attachment + verification state for a domain on the
 * project. Useful for the UI to refresh after the operator publishes
 * DNS records.
 */
export async function getDomainState(
  domain: string,
): Promise<VercelResult<VercelDomainState>> {
  const env = getVercelEnv();
  if (!env) {
    return {
      ok: false,
      status: 500,
      code: 'VERCEL_NOT_CONFIGURED',
      error: 'Vercel API not configured (set VERCEL_API_TOKEN and VERCEL_PROJECT_ID).',
    };
  }

  let res: Response;
  try {
    res = await vercelFetch(
      `/v9/projects/${env.projectId}/domains/${encodeURIComponent(domain)}`,
      { method: 'GET', env },
    );
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: 'VERCEL_NETWORK_ERROR',
      error: err instanceof Error ? err.message : 'Vercel network error',
    };
  }

  if (res.status === 404) {
    return {
      ok: false,
      status: 404,
      code: 'DOMAIN_NOT_ATTACHED',
      error: 'Domain is not attached to this Vercel project.',
    };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      status: res.status,
      code: (body as { error?: { code?: string } })?.error?.code,
      error: (body as { error?: { message?: string } })?.error?.message
        ?? `Vercel returned HTTP ${res.status}`,
    };
  }

  const body = (await res.json()) as Record<string, unknown>;
  return { ok: true, data: normaliseDomainResponse(domain, body) };
}

// ─── Normalisation ─────────────────────────────────────────────────────

/**
 * Vercel returns slightly different shapes from /v9 vs /v10 endpoints.
 * Normalise to {@link VercelDomainState} so callers don't branch on shape.
 */
function normaliseDomainResponse(
  domain: string,
  raw: Record<string, unknown>,
): VercelDomainState {
  const verification = Array.isArray(raw.verification)
    ? (raw.verification as Array<Record<string, unknown>>).map(v => ({
        type: String(v.type ?? ''),
        domain: String(v.domain ?? ''),
        value: String(v.value ?? ''),
        reason: String(v.reason ?? ''),
      }))
    : [];

  return {
    name: typeof raw.name === 'string' ? raw.name : domain,
    verified: raw.verified === true,
    misconfigured: typeof raw.misconfigured === 'boolean' ? raw.misconfigured : undefined,
    verification,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : undefined,
  };
}
