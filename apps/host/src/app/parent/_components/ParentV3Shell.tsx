'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import type { RoleManifest } from '@alfanumrik/lib/experience-v3';
import { ContextSelector, ExperienceV3Root, RoleShell } from '@alfanumrik/ui/v3';
import { useParentAuth } from './useParentAuth';

export interface ParentV3Child {
  studentId: string;
  name: string;
  grade: string | null;
}

interface ParentV3ScopeValue {
  children: ParentV3Child[];
  childId: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const ParentV3Scope = createContext<ParentV3ScopeValue | null>(null);

export function useParentV3Scope(): ParentV3ScopeValue {
  const value = useContext(ParentV3Scope);
  if (!value) throw new Error('useParentV3Scope must be used within ParentV3Shell');
  return value;
}

async function parentFetch(path: string): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
}

export default function ParentV3Shell({ children, manifest, authoritativeChildId }: { children: React.ReactNode; manifest: RoleManifest; authoritativeChildId: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isHi } = useAuth();
  const { mode, parentName, loading: authLoading } = useParentAuth();
  const [childrenList, setChildrenList] = useState<ParentV3Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode !== 'guardian') {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    parentFetch('/api/v2/parent/children')
      .then(async (response) => {
        if (!response.ok) throw new Error(`children:${response.status}`);
        const body = await response.json() as {
          data?: { children?: Array<{ student_id: string; name: string; grade: string | null }> };
        };
        if (!active) return;
        setChildrenList((body.data?.children ?? []).map((child) => ({
          studentId: child.student_id,
          name: child.name,
          grade: child.grade,
        })));
      })
      .catch(() => {
        if (active) setError(isHi ? 'बच्चों की सूची लोड नहीं हुई।' : 'We could not load your children.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, isHi, mode]);

  const requestedChildId = searchParams?.get('childId') ?? null;
  // The rollout resolver already validated the guardian-child relationship and
  // selected the institution used for cohort assignment. Never independently
  // choose a different first child from a second endpoint.
  const childId = authoritativeChildId;

  useEffect(() => {
    if (!childId || requestedChildId === childId) return;
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('childId', childId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [childId, pathname, requestedChildId, router, searchParams]);

  const selectChild = useCallback((value: string) => {
    if (!childrenList.some((child) => child.studentId === value)) return;
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('childId', value);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }, [childrenList, pathname, router, searchParams]);

  const navigation = useMemo(() => manifest.desktop.map((item) => ({
    ...item,
    href: childId ? `${item.href}?childId=${encodeURIComponent(childId)}` : item.href,
  })), [childId, manifest.desktop]);

  const scope = useMemo<ParentV3ScopeValue>(() => ({
    children: childrenList,
    childId,
    loading,
    error,
    retry: () => setAttempt((value) => value + 1),
  }), [childId, childrenList, error, loading]);

  const context = childrenList.length > 0 ? (
    <ContextSelector
      label={isHi ? 'बच्चा' : 'Child'}
      value={childId ?? ''}
      onChange={selectChild}
      options={childrenList.map((child) => ({
        value: child.studentId,
        label: `${child.name}${child.grade ? ` · Grade ${child.grade}` : ''}`,
      }))}
    />
  ) : undefined;

  if (authLoading) return <div className="flex min-h-dvh items-center justify-center" role="status">Loading parent portal…</div>;
  if (mode !== 'guardian') return <>{children}</>;

  return (
    <ParentV3Scope.Provider value={scope}>
      <ExperienceV3Root role="parent">
      <RoleShell
        role="parent"
        navigation={navigation}
        activeHref={`${pathname ?? '/parent'}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`}
        brand={{ name: 'Alfanumrik' }}
        context={context}
        mobileMoreItems={manifest.more.map((item) => ({ ...item, href: childId ? `${item.href}?childId=${encodeURIComponent(childId)}` : item.href }))}
        headerActions={parentName ? <span aria-label={isHi ? 'अभिभावक' : 'Parent'}>{parentName}</span> : undefined}
      >
        {children}
      </RoleShell>
      </ExperienceV3Root>
    </ParentV3Scope.Provider>
  );
}
