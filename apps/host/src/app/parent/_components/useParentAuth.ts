'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { loadParentSession } from './parent-session';

export type ParentAuthMode = 'guardian' | 'link-code' | null;

export interface ParentAuthState {
  mode: ParentAuthMode;
  parentId: string | null;
  parentName: string | null;
  /** For link-code mode, the single child this session is bound to. Null for guardian mode. */
  pinnedStudent: { id: string; name: string; grade: string } | null;
  loading: boolean;
}

/**
 * Resolves the parent's authentication state. Two modes:
 *
 * 1. Guardian mode — full Supabase auth, activeRole='guardian' in AuthContext.
 *    Can have multiple linked children; all parent/* routes work.
 *
 * 2. Link-code mode — anonymous link-code login, HMAC payload in sessionStorage.
 *    Single child only; `pinnedStudent` is set; some routes may require guardian mode.
 *
 * Returns mode=null while loading or if neither auth applies.
 */
export function useParentAuth(): ParentAuthState {
  const { authUserId, activeRole } = useAuth();
  const [linkCodeSession, setLinkCodeSession] = useState<Awaited<ReturnType<typeof loadParentSession>>>(null);
  const [linkCodeChecked, setLinkCodeChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadParentSession().then(s => {
      if (!cancelled) {
        setLinkCodeSession(s);
        setLinkCodeChecked(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Guardian mode wins when present
  if (authUserId && activeRole === 'guardian') {
    return {
      mode: 'guardian',
      parentId: authUserId,
      parentName: null, // could fetch from profile if shell needs it
      pinnedStudent: null,
      loading: false,
    };
  }

  if (!linkCodeChecked) {
    return { mode: null, parentId: null, parentName: null, pinnedStudent: null, loading: true };
  }

  if (linkCodeSession) {
    return {
      mode: 'link-code',
      parentId: linkCodeSession.guardian.id,
      parentName: linkCodeSession.guardian.name,
      pinnedStudent: linkCodeSession.student,
      loading: false,
    };
  }

  return { mode: null, parentId: null, parentName: null, pinnedStudent: null, loading: false };
}
