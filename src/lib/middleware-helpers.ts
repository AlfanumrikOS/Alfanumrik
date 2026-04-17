/**
 * ⚠️ CRITICAL AUTH PATH — middleware helpers
 *
 * Helpers invoked from src/proxy.ts (the Next.js proxy/middleware).
 * These must be Edge-runtime-safe:
 *   - No `supabase-admin` import (uses service-role key via `getSupabaseAdmin()` which
 *     is NOT middleware-safe because it pulls in `@/lib/audit-pipeline` and other
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
 *     onboarding or admin grants.
 */
import type { Redis as RedisType } from '@upstash/redis';

// Role identifiers returned by the get_user_role RPC. The RPC returns "guardian"
// for parents (DB table name) — callers should normalize via ROLE_ALIASES from
// '@/lib/identity' if they need the canonical "parent" name.
export type MiddlewareRole =
  | 'student'
  | 'teacher'
  | 'guardian' // aka parent
  | 'institution_admin'
  | 'admin'
  | 'super_admin'
  | 'none';

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
 * Fetch the primary role for a user by calling the `get_user_role` RPC
 * through PostgREST with the service-role key. The RPC already considers
 * students, teachers, and guardians tables; it returns a JSONB object with
 * `primary_role` ("student" | "teacher" | "guardian" | "none").
 *
 * Returns 'none' if the user has no role (e.g., not yet onboarded).
 * Returns null on network/DB errors so callers can fail-open.
 */
async function fetchPrimaryRole(userId: string): Promise<MiddlewareRole | null> {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return null;

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
    if (!res.ok) return null;

    const payload = (await res.json()) as {
      primary_role?: string;
      roles?: string[];
    } | null;

    const primary = payload?.primary_role;

    // Check for elevated roles (admin / super_admin / institution_admin).
    // get_user_role does not currently return these — they live in the RBAC
    // user_roles table. If the caller needs them, we probe the user_roles
    // table and promote the result.
    const elevated = await fetchElevatedRole(userId, sbUrl, serviceKey);
    if (elevated) return elevated;

    if (primary === 'student' || primary === 'teacher' || primary === 'guardian') {
      return primary;
    }
    return 'none';
  } catch {
    return null;
  }
}

/**
 * Probe the `user_roles` table for elevated roles (admin, super_admin,
 * institution_admin). These roles are assigned via the RBAC system and
 * are NOT returned by get_user_role.  We check them explicitly so that
 * middleware can enforce /super-admin and /school-admin role gates.
 */
async function fetchElevatedRole(
  userId: string,
  sbUrl: string,
  serviceKey: string
): Promise<MiddlewareRole | null> {
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
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ role?: { name?: string } | null }>;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // Prefer highest-privilege role if user has multiple.
    const names = rows
      .map(r => r?.role?.name)
      .filter((n): n is string => typeof n === 'string');

    if (names.includes('super_admin')) return 'super_admin';
    if (names.includes('admin')) return 'admin';
    if (names.includes('institution_admin')) return 'institution_admin';
    // Fall through — no elevated role.
    return null;
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Return the primary role for a user, using a short-TTL cache (Redis → memory).
 *
 * @returns
 *   - 'student' | 'teacher' | 'guardian' | 'institution_admin' | 'admin' | 'super_admin'
 *     for authenticated users with a role,
 *   - 'none' for authenticated users who are not yet onboarded,
 *   - null on lookup errors (caller should fail-open — never lock out on infra error).
 */
export async function getUserRoleFromCache(userId: string): Promise<MiddlewareRole | null> {
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
    // Lookup failed entirely — do NOT cache; propagate null so caller fails open.
    return null;
  }

  // Write through both caches.
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
 * getRoleDestination() in @/lib/identity/constants but lives here to avoid
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
