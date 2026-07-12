'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { supabase } from './supabase';
import type { ExperienceRole } from './experience-v3/types';
import type { RoleManifest } from './experience-v3/types';
import { experienceV3ScopeQuery } from './experience-v3/scope';
export { experienceV3ScopeQuery } from './experience-v3/scope';

export interface ExperienceV3ClientState {
  enabled: boolean;
  loading: boolean;
  capabilities: Readonly<Record<string, boolean>>;
  manifest: RoleManifest | null;
  /** True only when the current path is explicitly owned by the V3 manifest or a governed migration alias. */
  routeMapped: boolean;
  routeAllowed: boolean;
  scope: ExperienceV3ClientScope | null;
  /** True after explicit flag-off or when the legacy auth boundary must handle an unauthenticated visitor. */
  legacyAllowed: boolean;
  /** Authorization, invalid scope and resolver failures fail closed. */
  denied: boolean;
}

export interface ExperienceV3ClientScope {
  childId?: string;
  schoolId?: string;
  schools?: ReadonlyArray<{ id: string; name: string }>;
}

const CLOSED: ExperienceV3ClientState = { enabled: false, loading: true, capabilities: {}, manifest: null, routeMapped: false, routeAllowed: false, scope: null, legacyAllowed: false, denied: false };
const DENIED: ExperienceV3ClientState = { ...CLOSED, loading: false, denied: true };
const FLAG_OFF: ExperienceV3ClientState = { ...CLOSED, loading: false, legacyAllowed: true };
const DEDUPE_MS = 5_000;
const requestCache = new Map<string, { at: number; promise: Promise<ExperienceV3ClientState | null> }>();

function normalizeScope(value: unknown): ExperienceV3ClientScope | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { childId?: unknown; schoolId?: unknown; schools?: unknown };
  const schools = Array.isArray(raw.schools)
    ? raw.schools.flatMap((school) => {
        if (!school || typeof school !== 'object') return [];
        const item = school as { id?: unknown; name?: unknown };
        return typeof item.id === 'string' && typeof item.name === 'string' ? [{ id: item.id, name: item.name }] : [];
      })
    : undefined;
  return {
    ...(typeof raw.childId === 'string' ? { childId: raw.childId } : {}),
    ...(typeof raw.schoolId === 'string' ? { schoolId: raw.schoolId } : {}),
    ...(schools ? { schools } : {}),
  };
}

function resolveClientState(role: ExperienceRole, pathname: string, scopeQuery: string, token: string, userId: string): Promise<ExperienceV3ClientState | null> {
  const key = `${userId}:${role}:${pathname}?${scopeQuery}`;
  const now = Date.now();
  const cached = requestCache.get(key);
  if (cached && now - cached.at < DEDUPE_MS) return cached.promise;
  for (const [cacheKey, entry] of requestCache) if (now - entry.at >= DEDUPE_MS) requestCache.delete(cacheKey);

  const query = new URLSearchParams({ role, path: pathname });
  new URLSearchParams(scopeQuery).forEach((value, name) => query.set(name, value));
  const promise = fetch(`/api/experience-v3?${query.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (response) => {
    // A server authorization denial (including an invalid child/school scope)
    // must never fall through to a more permissive legacy shell.
    if (response.status === 401) return DENIED;
    if (response.status === 403) return DENIED;
    if (!response.ok) return DENIED;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    const value = body as Partial<ExperienceV3ClientState>;
    if (value.enabled === false) return FLAG_OFF;
    return value.enabled === true && value.manifest && Array.isArray(value.manifest.desktop)
      ? {
          enabled: true,
          loading: false,
          capabilities: value.capabilities && typeof value.capabilities === 'object' ? value.capabilities : {},
          manifest: value.manifest,
          routeMapped: value.routeMapped === true,
          routeAllowed: value.routeAllowed === true,
          scope: normalizeScope(value.scope),
          legacyAllowed: false,
          denied: false,
        }
      : DENIED;
  }).catch((error) => {
    requestCache.delete(key);
    throw error;
  });
  requestCache.set(key, { at: now, promise });
  return promise;
}

/**
 * Client dispatcher for legacy page boundaries. It starts OFF and asks the
 * authenticated server endpoint to resolve environment, role, institution and
 * deterministic user rollout. A global enabled row with rollout_percentage=0
 * therefore remains OFF. The browser never evaluates cohort configuration.
 */
export function useExperienceV3(role: ExperienceRole): ExperienceV3ClientState {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const scopeQuery = experienceV3ScopeQuery(role, searchParams?.toString() ?? '');
  const requestKey = `${role}:${pathname}?${scopeQuery}`;
  const [resolution, setResolution] = useState<{ key: string; state: ExperienceV3ClientState }>({ key: '', state: CLOSED });
  useEffect(() => {
    let cancelled = false;
    setResolution({ key: requestKey, state: CLOSED });
    supabase.auth.getSession()
      .then(({ data }) => {
        const session = data.session;
        // No Supabase session is not an authenticated authorization denial.
        // Preserve legacy login redirects and Parent's signed link-code flow;
        // authenticated 401/403 and invalid scope responses remain fail-closed.
        if (!session?.access_token || !session.user?.id) return FLAG_OFF;
        return resolveClientState(role, pathname, scopeQuery, session.access_token, session.user.id);
      })
      .then((resolved) => { if (!cancelled) setResolution({ key: requestKey, state: resolved || DENIED }); })
      .catch(() => { if (!cancelled) setResolution({ key: requestKey, state: DENIED }); });
    return () => { cancelled = true; };
  }, [pathname, requestKey, role, scopeQuery]);
  // Path changes are fail-closed during render itself, before the effect for
  // the new URL runs. The previous route can never flash as allowed.
  return resolution.key === requestKey ? resolution.state : CLOSED;
}
