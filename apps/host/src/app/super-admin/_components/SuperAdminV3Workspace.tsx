'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase-client';
import type { RoleManifest } from '@alfanumrik/lib/experience-v3';
import { Button, ContextSelector, DataState, ExperienceV3Root, RoleShell } from '@alfanumrik/ui/v3';

interface SuperAdminV3ContextValue {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  institutionId: string | null;
  environment: string;
  adminLevel: string;
}

const SuperAdminV3Context = createContext<SuperAdminV3ContextValue | null>(null);

export function useSuperAdminV3(): SuperAdminV3ContextValue {
  const value = useContext(SuperAdminV3Context);
  if (!value) throw new Error('useSuperAdminV3 must be used within SuperAdminV3Workspace');
  return value;
}

export default function SuperAdminV3Workspace({
  children,
  adminName,
  adminLevel,
  manifest,
}: {
  children: React.ReactNode;
  adminName: string;
  adminLevel: string;
  manifest: RoleManifest;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session?.access_token) {
        setSessionError(true);
        router.replace('/super-admin/login');
        return;
      }
      setAccessToken(session.access_token);
    });
    return () => { active = false; };
  }, [router]);

  const apiFetch = useCallback((path: string, init?: RequestInit) => fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  }), [accessToken]);

  // The current operator endpoints are platform-wide. Until every endpoint
  // accepts and keys its cache by institutionId, the scope remains explicitly
  // fixed rather than presenting a selector that does not filter the data.
  const institutionId = null;
  const runtimeEnvironment = process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NEXT_PUBLIC_APP_ENV || 'production';
  const environment = runtimeEnvironment;
  const navigation = manifest.desktop;
  const signOut = useCallback(async () => {
    await fetch('/api/super-admin/logout', { method: 'POST', credentials: 'same-origin', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }).catch(() => undefined);
    await supabase.auth.signOut({ scope: 'local' });
    window.location.replace('/super-admin/login');
  }, [accessToken]);

  if (!accessToken) return <DataState state={sessionError ? 'permission' : 'loading'} title={sessionError ? 'Administrator session required' : 'Verifying administrator session'} />;

  return (
    <SuperAdminV3Context.Provider value={{ apiFetch, institutionId, environment, adminLevel }}>
      <ExperienceV3Root role="super-admin">
      <RoleShell
        role="super-admin"
        navigation={navigation}
        activeHref={pathname ?? '/super-admin/command'}
        brand={{ name: 'Alfanumrik' }}
        context={
          <div className="flex flex-wrap items-center gap-2">
            <ContextSelector label="Data scope" value="all" disabled options={[{ value: 'all', label: 'All institutions · platform-wide' }]} />
            <ContextSelector label="Environment" value={environment} disabled options={[{ value: environment, label: environment }]} />
          </div>
        }
        headerActions={<><span className="text-sm" title={`Permission level: ${adminLevel}`}>{adminName}</span><Button variant="ghost" size="sm" onClick={signOut}>Log out</Button></>}
        mobileMoreItems={manifest.more}
      >
        {children}
      </RoleShell>
      </ExperienceV3Root>
    </SuperAdminV3Context.Provider>
  );
}
