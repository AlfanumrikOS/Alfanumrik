# Public API v1 (`/api/public/v1/*`) — Architect Contract

Track A.6 — the white-label school SaaS public API + outbound webhooks +
marketplace. This directory holds the **auth + tenant-scoping boundary** that
every public endpoint MUST use. Architect owns this contract; backend builds the
endpoints + the webhook dispatcher + the marketplace management on top of it.

## Namespace

All third-party / school-integration endpoints live under **`/api/public/v1/*`**.
(The pre-existing `/api/v1/school/*` ERP routes are the v0 precursor; new public
surface area goes under `/api/public/v1/*` and uses `authorizePublicApiKey`.)

`v1` shapes are **stable and additive-only** — never change a field's meaning or
type in place; add new fields or a new version namespace instead.

## The non-negotiable rules (every `/api/public/v1/*` handler)

1. **Authenticate first.** Call `authorizePublicApiKey(request, '<scope>')` before
   any DB I/O. If `!result.authorized`, `return result.errorResponse`.
2. **Tenant comes from the KEY, never the request.** Scope every query to
   `result.schoolId` (`.eq('school_id', result.schoolId)`). Do **not** read a
   school/tenant id from the path, query string, or body. This is the cross-tenant
   isolation guarantee (P9-equivalent): a leaked key exposes only its own school.
3. **Scope-gate via the argument.** The helper verifies the key carries the
   required scope (the same vocabulary as `school_api_keys.permissions`, e.g.
   `students.read`, `reports.read`, `classes.read`).
4. **Rate limit is built in.** Enforced per **key id** (not IP) inside the helper.
   A 429 is returned as `errorResponse`. Attach `result.rateLimitHeaders` to your
   success response too.
5. **No PII (P13).** Never return student email/phone or any redacted field
   through the public API. Keys/secrets are stored and compared as **hashes only**.

## `authorizePublicApiKey` signature

```ts
authorizePublicApiKey(
  request: Request,
  requiredScope: string | null,   // e.g. 'students.read'; null only for scope-agnostic
): Promise<{
  authorized: boolean;
  schoolId: string | null;        // ← the ONLY tenant source of truth
  scopes: string[];               // all scopes the key carries
  keyId: string | null;           // rate-limit bucket + audit id
  rateLimitHeaders: Partial<{      // attach to success responses
    'X-RateLimit-Limit': string;
    'X-RateLimit-Remaining': string;
    'X-RateLimit-Reset': string;
  }>;
  errorResponse?: Response;        // return as-is when !authorized
}>
```

Status codes the helper returns: **401** (missing / invalid / expired / inactive
key — single generic message, no key existence leak), **403** (valid key, missing
scope), **429** (per-key rate limit, with `Retry-After` + `X-RateLimit-*`), **500**
(internal). `200`-path concerns are the route's.

### Minimal handler shape

```ts
export async function GET(request: NextRequest) {
  const auth = await authorizePublicApiKey(request, 'students.read');
  if (!auth.authorized) return auth.errorResponse;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('students')
    .select('id, name, grade, is_active') // NO email/phone (P13)
    .eq('school_id', auth.schoolId);       // tenant from the KEY

  return NextResponse.json({ success: true, data }, { headers: auth.rateLimitHeaders });
}
```

## Outbound webhooks (backend implements the dispatcher)

Schema: migration `20260621000600_track_a6_public_api_webhooks_marketplace.sql`.

- **`webhook_subscriptions`** — per-school sinks. `secret_hash` = SHA-256 of the
  HMAC signing secret (raw shown **once** at creation, never persisted). Sign each
  delivery body with HMAC-SHA256 and send `X-Alfanumrik-Signature`. `target_url`
  is https-only (DB CHECK); the dispatcher must additionally block private/loopback
  ranges (SSRF guard) and validate the host.
- **`webhook_deliveries`** — delivery log + DLQ. Lifecycle
  `pending → delivered | failed → retry → dead_letter`. Worker eligibility:
  `status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= now())`.
  Backoff: `next_retry_at = now() + LEAST(cap, base * 2^(attempts-1))` + jitter
  (recommend base 60s, cap 6h, MAX_ATTEMPTS 8). On the final failure set
  `status='dead_letter'`, `next_retry_at=NULL`. Operator replay (service-role only):
  reset to `pending`, `next_retry_at=now()`. Dedupe by (subscription_id, event id).
  Deliveries are **read-only** to school admins (RLS); only the service-role
  dispatcher writes them.

## Marketplace (backend/frontend build management later)

- **`integration_listings`** — world-readable (authenticated, active-only) catalog.
  `scopes_required` declares the public-API scopes an install needs. Service-role
  writes only.
- **`integration_installs`** — own-school installs (RLS). Lifecycle
  `pending → active → paused → uninstalled`. `config` holds **non-secret** install
  config only; any secret (issued key, webhook secret) lives hashed in its own
  table, never raw in `config` (P13). One active install per (school, listing)
  via partial unique index.
