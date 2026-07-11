'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from './supabase';
import type { ExperienceRole } from './experience-v3/types';
import type { RoleManifest } from './experience-v3/types';

export interface ExperienceV3ClientState {
  enabled: boolean;
  loading: boolean;
  capabilities: Readonly<Record<string, boolean>>;
  manifest: RoleManifest | null;
  routeAllowed: boolean;
}

const CLOSED: ExperienceV3ClientState = { enabled: false, loading: true, capabilities: {}, manifest: null, routeAllowed: false };
const DEDUPE_MS = 5_000;
const requestCache = new Map<string, { at: number; promise: Promise<ExperienceV3ClientState | null> }>();

function resolveClientState(role: ExperienceRole, pathname: string, token: string, userId: string): Promise<ExperienceV3ClientState | null> {
  const key = `${userId}:${role}:${pathname}`;
  const now = Date.now();
  const cached = requestCache.get(key);
  if (cached && now - cached.at < DEDUPE_MS) return cached.promise;
  for (const [cacheKey, entry] of requestCache) if (now - entry.at >= DEDUPE_MS) requestCache.delete(cacheKey);

  const promise = fetch(`/api/experience-v3?role=${encodeURIComponent(role)}&path=${encodeURIComponent(pathname)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (response) => {
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    const value = body as Partial<ExperienceV3ClientState>;
    return value.enabled === true && value.manifest && Array.isArray(value.manifest.desktop)
      ? {
          enabled: true,
          loading: false,
          capabilities: value.capabilities && typeof value.capabilities === 'object' ? value.capabilities : {},
          manifest: value.manifest,
          routeAllowed: value.routeAllowed === true,
        }
      : null;
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
  const requestKey = `${role}:${pathname}`;
  const [resolution, setResolution] = useState<{ key: string; state: ExperienceV3ClientState }>({ key: '', state: CLOSED });
  useEffect(() => {
    let cancelled = false;
    setResolution({ key: requestKey, state: CLOSED });
    supabase.auth.getSession()
      .then(({ data }) => {
        const session = data.session;
        if (!session?.access_token || !session.user?.id) return null;
        return resolveClientState(role, pathname, session.access_token, session.user.id);
      })
      .then((resolved) => { if (!cancelled) setResolution({ key: requestKey, state: resolved || { ...CLOSED, loading: false } }); })
      .catch(() => { if (!cancelled) setResolution({ key: requestKey, state: { ...CLOSED, loading: false } }); });
    return () => { cancelled = true; };
  }, [pathname, requestKey, role]);
  // Path changes are fail-closed during render itself, before the effect for
  // the new URL runs. The previous route can never flash as allowed.
  return resolution.key === requestKey ? resolution.state : CLOSED;
}
