'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import type { RoleName } from '@/lib/rbac';

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
}

// Client-side cache
let cachedPerms: { userId: string; roles: RoleName[]; permissions: string[]; expires: number } | null = null;

export function usePermissions(): UsePermissionsResult {
  const { activeRole } = useAuth();
  const [roles, setRoles] = useState<RoleName[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPermissions = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

        // Check client-side cache
        if (cachedPerms && cachedPerms.userId === user.id && cachedPerms.expires > Date.now()) {
          setRoles(cachedPerms.roles);
          setPermissions(cachedPerms.permissions);
          setLoading(false);
          return;
        }

        const { data, error } = await supabase.rpc('get_user_permissions', { p_auth_user_id: user.id });
        if (error || !data) {
          console.warn('[usePermissions] Failed to load:', error?.message);
          // Fallback: infer from activeRole
          const fallbackRole = (activeRole || 'student') as RoleName;
          setRoles([fallbackRole]);
          setLoading(false);
          return;
        }

        const r = (data.roles || []).map((role: { name: string }) => role.name as RoleName);
        const p: string[] = data.permissions || [];
        setRoles(r);
        setPermissions(p);

        // Cache for 5 minutes
        cachedPerms = { userId: user.id, roles: r, permissions: p, expires: Date.now() + 5 * 60 * 1000 };
      } catch {
        setRoles([(activeRole || 'student') as RoleName]);
      }
      setLoading(false);
    };

    loadPermissions();
  }, [activeRole]);

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
  };
}
