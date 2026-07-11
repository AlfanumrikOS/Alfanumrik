'use client';

import { useEffect, useState } from 'react';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { supabase } from '@alfanumrik/lib/supabase-client';
import SuperAdminV3Workspace from './SuperAdminV3Workspace';
import { DataState } from '@alfanumrik/ui/v3';

export default function SuperAdminV3ClientGate({ legacy, children }: { legacy: React.ReactNode; children: React.ReactNode }) {
  const { enabled, loading, manifest, routeAllowed } = useExperienceV3('super-admin');
  const [name, setName] = useState('Administrator');
  useEffect(() => {
    if (!enabled) return;
    void supabase.auth.getUser().then(({ data: { user } }) => setName(String(user?.user_metadata?.name || user?.email || 'Administrator')));
  }, [enabled]);
  if (loading) return null;
  if (!enabled) return <>{legacy}</>;
  if (!manifest || !routeAllowed) return <DataState state="permission" title="This operator destination is unavailable" />;
  return <SuperAdminV3Workspace adminName={name} adminLevel="server-enforced" manifest={manifest}>{children}</SuperAdminV3Workspace>;
}
