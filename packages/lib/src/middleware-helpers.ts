/**
 * ⚠️ CRITICAL AUTH PATH — middleware helpers
 *
 * Helpers invoked from src/proxy.ts (the Next.js proxy/middleware).
 * These must be Edge-runtime-safe:
 *   - No `supabase-admin` import (uses service-role key via `getSupabaseAdmin()` which
 *     is NOT middleware-safe because it pulls in `@alfanumrik/lib/audit-pipeline` and other
 *     Node-only modules transitively).
 *   - Uses the REST endpoint directly with the service role key, mirroring the
 *     pattern used elsewhere in src/proxy.ts for session validation.
 *   - Dynamic import of `@upstash/redis` to keep middleware's synchronous
 *     startup cost small (P10: middleware < 120 kB).
 *
 * Provides:
 *   - getUserRoleFromCache(userId) — cached primary role lookup for the
 *     server-side role-based route protection added in Layer 0.65 of the
 *     proxy. Short TTL (60s) so role changes take effect quickly after
 *     onboarding or admin grants. Resolution consults admin_users (via the
 *     get_admin_level RPC, migration 20260720150000) with precedence over
 *     student/teacher/guardian, and returns the uncached ROLE_UNKNOWN
 *     sentinel on transient probe failure (2026-07-20 super-admin RCA).
 */
import type { Redis as RedisType } from '@upstash/redis';

// Role identifiers returned by the get_user_role RPC. The RPC returns "guardian"
// for parents (DB table name) — callers should normalize via ROLE_ALIASES from
// '@alfanumrik/lib/identity' if they need the canonical "parent" name.
export type MiddlewareRole =
  | 'student'
  | 'teacher'
  | 'guardian' // aka parent
  | 'institution_admin'
  | 'admin'
  | 'super_admin'
  | 'none';

/**
 * Sentinel returned when role resolution could not produce a DEFINITIVE
 * answer (any probe/RPC returned a transient error). Distinct from:
 *   - a real MiddlewareRole (definitive, cacheable),
 *   - 'none' (definitive "authenticated but not onboarded"),
 *   - null (deterministic misconfig — Supabase env vars missing).
 *
 * 2026-07-20 super-admin route-gating RCA: previously a transient failure of
 * the elevated-role probe was indistinguishable from "no elevated role", so
 * an admin could be resolved (and CACHED for 60s) as 'student'/'none' and get
 * bounced off /super-admin intermittently. 'unknown' is NEVER written to the
 * cache — only definitive answers are.
 */
export const ROLE_UNKNOWN = 'unknown' as const;
export type ResolvedMiddlewareRole = MiddlewareRole | typeof ROLE_UNKNOWN;

/** Internal probe result: distinguishes "probe failed" from "definitively empty". */
type ProbeResult<T> = { ok: true; value: T } | { ok: false };

// ── Cache config ─────────────────────────────────────────────
// 60s TTL: short enough that role changes (onboarding completion, admin grant)
// propagate within a minute, long enough to absorb burst traffic on the same
// authenticated user.
const ROLE_CACHE_TTL_SECS = 60;
const ROLE_CACHE_KEY = (uid: string) => `mw:role:${uid}`;

// In-memory fallback — used when Upstash is not configured (local dev) or when
// Redis is transiently unreachable. Keyed by auth user id.
interface LocalRoleCacheEntry {
  role: MiddlewareRole;
  expires: number;
}
const _localRoleCache = new Map<string, LocalRoleCacheEntry>();
const LOCAL_ROLE_CACHE_MAX = 5000;

// ── Upstash Redis (lazy, dynamic import to stay off the hot middleware path) ──
let _redis: RedisType | null = null;
let _redisInitPromise: Promise<RedisType | null> | null = null;

async function getRedis(): Promise<RedisType | null> {
  if (_redis) return _redis;
  if (_redisInitPromise) return _redisInitPromise;

  _redisInitPromise = (async () => {
    try {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) return null;
      const { Redis } = await import('@upstash/redis');
      _redis = new Redis({ url, token });
      return _redis;
    } catch {
      return null;
    }
  })();

  return _redisInitPromise;
}

function readLocalRoleCache(userId: string): MiddlewareRole | null {
  const entry = _localRoleCache.get(userId);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    _localRoleCache.delete(userId);
    return null;
  }
  return entry.role;
}

function writeLocalRoleCache(userId: string, role: MiddlewareRole): void {
  if (_localRoleCache.size >= LOCAL_ROLE_CACHE_MAX) {
    // Evict the oldest entry by iteration order (insertion order for Map).
    const firstKey = _localRoleCache.keys().next().value;
    if (firstKey) _localRoleCache.delete(firstKey);
  }
  _localRoleCache.set(userId, {
    role,
    expires: Date.now() + ROLE_CACHE_TTL_SECS * 1000,
  });
}

// ── RPC lookup via PostgREST (Edge-safe, no node-only imports) ──────
/**
 * Resolve the effective role for a user by combining THREE probes (run in
 * parallel — same latency as the old two-probe sequential path):
 *
 *   1. `get_admin_level` RPC → `admin_users` (operational admin roster read
 *      by `authorizeAdmin()`). HIGHEST precedence: an active admin row yields
 *      'super_admin' (admin_level = 'super_admin') or 'admin' (any other
 *      active admin_level) — even if the same auth user ALSO has a students/
 *      teachers/guardians row. (2026-07-20 super-admin route-gating RCA: an
 *      admin with a students row used to resolve to 'student' and get bounced
 *      off /super-admin.)
 *   2. `user_roles` probe → RBAC elevated roles (admin / super_admin /
 *      institution_admin).
 *   3. `get_user_role` RPC → primary role (student / teacher / guardian).
 *
 * Transient-failure discipline (RCA fix, half 2): if any probe needed for a
 * definitive answer fails, return ROLE_UNKNOWN — never a demoted role. The
 * caller MUST NOT cache 'unknown'. A definitive admin_users hit (probe 1)
 * short-circuits: it cannot be demoted by a failure of the lower-precedence
 * probes ('admin' and 'super_admin' are gating-equivalent under every
 * ROUTE_ROLE_RULES entry and share the same destination).
 *
 * Returns 'none' if the user definitively has no role (not yet onboarded).
 * Returns null only on deterministic misconfig (Supabase env vars missing)
 * so callers can fail-open.
 */
async function fetchPrimaryRole(userId: string): Promise<ResolvedMiddlewareRole | null> {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return null;

  const [adminProbe, elevatedProbe, primaryProbe] = await Promise.all([
    fetchAdminLevel(userId, sbUrl, serviceKey),
    fetchElevatedRole(userId, sbUrl, serviceKey),
    fetchGetUserRolePrimary(userId, sbUrl, serviceKey),
  ]);

  // Precedence 1: active admin_users row (definitive, highest privilege).
  if (adminProbe.ok && adminProbe.value !== null) {
    return adminProbe.value === 'super_admin' ? 'super_admin' : 'admin';
  }
  // No definitive admin hit — if the admin probe FAILED we cannot rule out
  // an admin row; do not demote. Uncached sentinel, retried next request.
  if (!adminProbe.ok) return ROLE_UNKNOWN;

  // Precedence 2: RBAC user_roles elevated role.
  if (elevatedProbe.ok && elevatedProbe.value !== null) return elevatedProbe.value;
  if (!elevatedProbe.ok) return ROLE_UNKNOWN;

  // Precedence 3: primary role from get_user_role.
  if (!primaryProbe.ok) return ROLE_UNKNOWN;
  const primary = primaryProbe.value;
  if (primary === 'student' || primary === 'teacher' || primary === 'guardian') {
    return primary;
  }
  return 'none';
}

/**
 * Call the `get_user_role` RPC through PostgREST with the service-role key.
 * The RPC considers the students, teachers, and guardians tables; it returns
 * a JSONB object with `primary_role` ("student" | "teacher" | "guardian" |
 * "none"). ok:false on any transport/HTTP error (transient — do not cache).
 */
async function fetchGetUserRolePrimary(
  userId: string,
  sbUrl: string,
  serviceKey: string
): Promise<ProbeResult<string | undefined>> {
  try {
    const res = await fetch(`${sbUrl}/rest/v1/rpc/get_user_role`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_auth_user_id: userId }),
    });
    if (!res.ok) return { ok: false };

    const payload = (await res.json()) as {
      primary_role?: string;
      roles?: string[];
    } | null;

    return { ok: true, value: payload?.primary_role };
  } catch {
    return { ok: false };
  }
}

/**
 * Probe the `admin_users` table via the additive `get_admin_level` RPC
 * (migration 20260720150000). Returns the active `admin_level` string, or
 * null when the user definitively has no active admin row.
 *
 * Special case — RPC not yet deployed: PostgREST answers 404 (PGRST202) for
 * a missing function. We treat that as a DEFINITIVE "no admin_users signal"
 * (ok:true, value:null) rather than a transient error, so shipping this code
 * ahead of the migration degrades gracefully to the legacy user_roles-based
 * resolution instead of turning Layer 0.65 into a permanent 'unknown' no-op.
 */
async function fetchAdminLevel(
  userId: string,
  sbUrl: string,
  serviceKey: string
): Promise<ProbeResult<string | null>> {
  try {
    const res = await fetch(`${sbUrl}/rest/v1/rpc/get_admin_level`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId }),
    });
    if (res.status === 404) return { ok: true, value: null }; // RPC not deployed yet — legacy fallback.
    if (!res.ok) return { ok: false };

    // PostgREST returns a scalar-returning RPC's result as a bare JSON value
    // ("admin_level string" or null).
    const payload = (await res.json()) as unknown;
    return {
      ok: true,
      value: typeof payload === 'string' && payload.length > 0 ? payload : null,
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Probe the `user_roles` table for elevated roles (admin, super_admin,
 * institution_admin). These roles are assigned via the RBAC system and
 * are NOT returned by get_user_role.  We check them explicitly so that
 * middleware can enforce /super-admin and /school-admin role gates.
 * ok:false on any transport/HTTP error (transient — do not cache).
 */
async function fetchElevatedRole(
  userId: string,
  sbUrl: string,
  serviceKey: string
): Promise<ProbeResult<MiddlewareRole | null>> {
  try {
    // Query: SELECT roles.name FROM user_roles JOIN roles ON roles.id = user_roles.role_id
    //        WHERE user_roles.auth_user_id = $1 AND user_roles.is_active = true
    // Expressed as a PostgREST embedded resource selection.
    const url = `${sbUrl}/rest/v1/user_roles?auth_user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&select=role:roles(name)`;
    const res = await fetch(url, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });
    if (!res.ok) return { ok: false };
    const rows = (await res.json()) as Array<{ role?: { name?: string } | null }>;
    if (!Array.isArray(rows) || rows.length === 0) return { ok: true, value: null };

    // Prefer highest-privilege role if user has multiple.
    const names = rows
      .map(r => r?.role?.name)
      .filter((n): n is string => typeof n === 'string');

    if (names.includes('super_admin')) return { ok: true, value: 'super_admin' };
    if (names.includes('admin')) return { ok: true, value: 'admin' };
    if (names.includes('institution_admin')) return { ok: true, value: 'institution_admin' };
    // Fall through — definitively no elevated role.
    return { ok: true, value: null };
  } catch {
    return { ok: false };
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Return the primary role for a user, using a short-TTL cache (Redis → memory).
 *
 * @returns
 *   - 'student' | 'teacher' | 'guardian' | 'institution_admin' | 'admin' | 'super_admin'
 *     for authenticated users with a role (definitive — cached 60s),
 *   - 'none' for authenticated users who are not yet onboarded (definitive — cached 60s),
 *   - ROLE_UNKNOWN ('unknown') when any probe/RPC failed transiently — NEVER
 *     cached, so the very next request re-resolves (caller must fail-open;
 *     2026-07-20 RCA: caching transient failures caused 60s of intermittent
 *     /super-admin bouncing),
 *   - null on deterministic misconfig (env vars missing) — caller fails open.
 */
export async function getUserRoleFromCache(userId: string): Promise<ResolvedMiddlewareRole | null> {
  if (!userId) return null;

  // Tier 1: in-memory cache on this Vercel instance.
  const local = readLocalRoleCache(userId);
  if (local) return local;

  // Tier 2: Upstash Redis (shared across instances).
  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get<MiddlewareRole>(ROLE_CACHE_KEY(userId));
      if (cached) {
        writeLocalRoleCache(userId, cached);
        return cached;
      }
    } catch {
      // Redis unavailable — fall through to source of truth.
    }
  }

  // Tier 3: source of truth (PostgREST).
  const role = await fetchPrimaryRole(userId);
  if (role === null) {
    // Deterministic misconfig (env missing) — do NOT cache; caller fails open.
    return null;
  }
  if (role === ROLE_UNKNOWN) {
    // Transient probe failure — do NOT cache (cache only definitive answers);
    // propagate the sentinel so the caller fails open and the next request
    // retries immediately instead of serving a stale/demoted role for 60s.
    return ROLE_UNKNOWN;
  }

  // Definitive answer — write through both caches.
  writeLocalRoleCache(userId, role);
  if (redis) {
    try {
      await redis.set(ROLE_CACHE_KEY(userId), role, { ex: ROLE_CACHE_TTL_SECS });
    } catch {
      /* ignore — in-memory cache is sufficient for this instance */
    }
  }

  return role;
}

/**
 * Invalidate a user's cached role (call after onboarding completion or
 * admin role change to force the next middleware request to re-fetch).
 */
export async function invalidateUserRoleCache(userId: string): Promise<void> {
  if (!userId) return;
  _localRoleCache.delete(userId);
  const redis = await getRedis();
  if (redis) {
    try { await redis.del(ROLE_CACHE_KEY(userId)); } catch { /* ignore */ }
  }
}

// ── Route → required role mapping ────────────────────────────

export interface RouteRoleRule {
  /** Path prefix (matches path === prefix OR path.startsWith(prefix + '/')). */
  prefix: string;
  /** Roles allowed to access this prefix. */
  allowed: MiddlewareRole[];
  /** If true, the prefix itself (without trailing segment) is exempt from role check.
   *  Used for /parent which hosts its own login form and must stay accessible
   *  to unauthenticated / other-role visitors (the page itself redirects them).
   */
  exemptExactMatch?: boolean;
}

// Super admins can access every portal. Admins can access super-admin + school-admin.
// Institution admins own /school-admin. Teachers own /teacher. Parents own /parent.
export const ROUTE_ROLE_RULES: RouteRoleRule[] = [
  {
    // /parent (exact) is a login page — leave it open.
    // /parent/children, /parent/reports, etc. require a parent session.
    prefix: '/parent',
    allowed: ['guardian', 'admin', 'super_admin'],
    exemptExactMatch: true,
  },
  {
    prefix: '/teacher',
    allowed: ['teacher', 'admin', 'super_admin'],
  },
  {
    prefix: '/super-admin',
    allowed: ['admin', 'super_admin'],
  },
  {
    prefix: '/school-admin',
    allowed: ['institution_admin', 'admin', 'super_admin'],
  },
];

/**
 * Find the matching route rule for a path, if any.
 * Returns null when no rule applies (route is not role-gated).
 */
export function findRouteRule(path: string): RouteRoleRule | null {
  for (const rule of ROUTE_ROLE_RULES) {
    if (rule.exemptExactMatch && path === rule.prefix) return null;
    if (path === rule.prefix || path.startsWith(rule.prefix + '/')) {
      return rule;
    }
  }
  return null;
}

/**
 * Map a MiddlewareRole to its post-login destination. Mirrors
 * getRoleDestination() in @alfanumrik/lib/identity/constants but lives here to avoid
 * pulling the identity module's transitive deps into middleware.
 */
export function destinationForRole(role: MiddlewareRole): string {
  switch (role) {
    case 'student': return '/dashboard';
    case 'teacher': return '/teacher';
    case 'guardian': return '/parent';
    case 'institution_admin': return '/school-admin';
    case 'admin':
    case 'super_admin': return '/super-admin';
    case 'none':
    default: return '/onboarding';
  }
}
