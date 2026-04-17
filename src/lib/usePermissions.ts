'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import type { RoleName } from '@/lib/rbac';

// NOTE: This hook is a UI convenience only and is NOT a security boundary (P9).
// All real RBAC enforcement happens server-side via `authorizeRequest(request, 'permission.code')`.

export interface UsePermissionsResult {
  roles: RoleName[];
  permissions: string[];
  loading: boolean;
  hasPermission: (code: string) => boolean;
  hasRole: (role: RoleName) => boolean;
  can: (code: string) => boolean;
  isAdmin: boolean;
  isTeacher: boolean;
  isParent: boolean;
  isStudent: boolean;
  refresh: () => Promise<void>;
}

// Client-side cache (module-level, shared across hook instances in the same tab).
let cachedPerms: { userId: string; roles: RoleName[]; permissions: string[]; expires: number; fetchedAt: number } | null = null;

// Track in-flight fetch so concurrent refresh() calls don't stack.
let inflightFetch: Promise<{ roles: RoleName[]; permissions: string[] } | null> | null = null;

// Custom event name used to signal that permissions may have changed.
const PERMISSIONS_CHANGED_EVENT = 'alfanumrik:permissions-changed';

// Stale threshold for visibility-triggered background refresh (60s).
const STALE_THRESHOLD_MS = 60 * 1000;

/**
 * Dispatch a global event signalling that permissions may have changed.
 * Any mounted `usePermissions()` hook will clear its cache and re-fetch.
 * Safe to call from anywhere (no-op on server).
 */
export function notifyPermissionsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PERMISSIONS_CHANGED_EVENT));
  }
}

/**
 * Clear the module-level permissions cache without dispatching an event.
 * Exposed for tests and advanced callers.
 */
export function clearPermissionsCache() {
  cachedPerms = null;
}

async function fetchPermissionsFromServer(userId: string): Promise<{ roles: RoleName[]; permissions: string[] } | null> {
  // De-duplicate concurrent fetches for the same user.
  if (inflightFetch) {
    return inflightFetch;
  }

  inflightFetch = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_user_permissions', { p_auth_user_id: userId });
      if (error || !data) {
        console.warn('[usePermissions] Failed to load:', error?.message);
        return null;
      }
      const r = (data.roles || []).map((role: { name: string }) => role.name as RoleName);
      const p: string[] = data.permissions || [];
      const now = Date.now();
      cachedPerms = { userId, roles: r, permissions: p, expires: now + 5 * 60 * 1000, fetchedAt: now };
      return { roles: r, permissions: p };
    } finally {
      inflightFetch = null;
    }
  })();

  return inflightFetch;
}

export function usePermissions(): UsePermissionsResult {
  const { activeRole } = useAuth();
  const [roles, setRoles] = useState<RoleName[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Guard against setState after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Shared loader used by initial load, event listener, visibility handler, and refresh().
  const load = useCallback(async (opts: { bypassCache?: boolean; silent?: boolean } = {}) => {
    const { bypassCache = false, silent = false } = opts;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (mountedRef.current && !silent) setLoading(false);
        return;
      }

      // Use cache when allowed and valid (keyed by userId, so role swap auto-invalidates).
      if (!bypassCache && cachedPerms && cachedPerms.userId === user.id && cachedPerms.expires > Date.now()) {
        if (mountedRef.current) {
          setRoles(cachedPerms.roles);
          setPermissions(cachedPerms.permissions);
          if (!silent) setLoading(false);
        }
        return;
      }

      if (bypassCache) {
        cachedPerms = null;
      }

      const result = await fetchPermissionsFromServer(user.id);
      if (!mountedRef.current) return;

      if (!result) {
        // Fallback: infer from activeRole (preserves existing behavior on RPC failure).
        const fallbackRole = (activeRole || 'student') as RoleName;
        setRoles([fallbackRole]);
        if (!silent) setLoading(false);
        return;
      }

      setRoles(result.roles);
      setPermissions(result.permissions);
    } catch {
      if (!mountedRef.current) return;
      setRoles([(activeRole || 'student') as RoleName]);
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, [activeRole]);

  // Public refresh: bypass cache, re-fetch, update state. Safe to call repeatedly
  // (concurrent calls coalesce via the module-level inflightFetch promise).
  const refresh = useCallback(async () => {
    await load({ bypassCache: true });
  }, [load]);

  // Initial load + reload when activeRole changes.
  useEffect(() => {
    load();
  }, [load]);

  // Listen for global permission-change events.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePermissionsChanged = () => {
      cachedPerms = null;
      load({ bypassCache: true, silent: true });
    };

    window.addEventListener(PERMISSIONS_CHANGED_EVENT, handlePermissionsChanged);
    return () => {
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, handlePermissionsChanged);
    };
  }, [load]);

  // Silent background refresh on tab visibility change if cache is stale (> 60s old).
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const age = cachedPerms ? Date.now() - cachedPerms.fetchedAt : Infinity;
      if (age > STALE_THRESHOLD_MS) {
        load({ bypassCache: true, silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [load]);

  const hasPermission = useCallback((code: string) => {
    if (roles.includes('super_admin')) return true;
    return permissions.includes(code);
  }, [roles, permissions]);

  const hasRole = useCallback((role: RoleName) => roles.includes(role), [roles]);

  return {
    roles,
    permissions,
    loading,
    hasPermission,
    hasRole,
    can: hasPermission,
    isAdmin: roles.includes('admin') || roles.includes('super_admin'),
    isTeacher: roles.includes('teacher'),
    isParent: roles.includes('parent'),
    isStudent: roles.includes('student'),
    refresh,
  };
}
