'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useTenant } from '@alfanumrik/lib/tenant-context';
import { supabase } from '@alfanumrik/lib/supabase';
import type { RoleManifest } from '@alfanumrik/lib/experience-v3';
import { ContextSelector, ExperienceV3Root, RoleShell } from '@alfanumrik/ui/v3';

interface SchoolV3ScopeValue {
  schoolId: string | null;
  schoolName: string;
  academicYear: string;
  loading: boolean;
}

const SchoolV3Scope = createContext<SchoolV3ScopeValue | null>(null);

export function useSchoolV3Scope(): SchoolV3ScopeValue {
  const value = useContext(SchoolV3Scope);
  if (!value) throw new Error('useSchoolV3Scope must be used within SchoolAdminV3Shell');
  return value;
}

export default function SchoolAdminV3Shell({ children, manifest }: { children: React.ReactNode; manifest: RoleManifest }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authUserId, isHi } = useAuth();
  const tenant = useTenant();
  const [schoolId, setSchoolId] = useState<string | null>(tenant.schoolId);
  const [schoolName, setSchoolName] = useState(tenant.schoolName || 'School');
  const [loading, setLoading] = useState(!tenant.schoolId);

  useEffect(() => {
    if (!authUserId) {
      router.replace('/login');
      return;
    }
    if (tenant.schoolId) {
      setSchoolId(tenant.schoolId);
      setSchoolName(tenant.schoolName || 'School');
      setLoading(false);
      return;
    }
    let active = true;
    void supabase
      .from('school_admins')
      .select('school_id, schools(name)')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .single()
      .then(({ data }) => {
        if (!active) return;
        setSchoolId(typeof data?.school_id === 'string' ? data.school_id : null);
        const joined = Array.isArray(data?.schools) ? data?.schools[0] : data?.schools;
        if (joined && typeof joined === 'object' && 'name' in joined && typeof joined.name === 'string') {
          setSchoolName(joined.name);
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [authUserId, router, tenant.schoolId, tenant.schoolName]);

  // These read models are school-scoped but not academic-year-scoped. Expose
  // the limitation honestly rather than adding a cosmetic query parameter.
  const academicYear = 'All available years';
  const navigation = manifest.desktop;

  const context = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="truncate text-sm font-semibold">{schoolName}</span>
      <ContextSelector
        label={isHi ? 'डेटा अवधि' : 'Data period'}
        value="all"
        disabled
        options={[{ value: 'all', label: isHi ? 'सभी उपलब्ध वर्ष' : 'All available years' }]}
      />
    </div>
  );

  return (
    <SchoolV3Scope.Provider value={{ schoolId, schoolName, academicYear, loading }}>
      <ExperienceV3Root role="school-admin">
      <RoleShell
        role="school-admin"
        navigation={navigation}
        activeHref={pathname ?? '/school-admin'}
        brand={{ name: schoolName, logoUrl: tenant.branding.logoUrl ?? undefined, accent: tenant.branding.primaryColor }}
        context={context}
        mobileMoreItems={manifest.more}
      >
        {children}
      </RoleShell>
      </ExperienceV3Root>
    </SchoolV3Scope.Provider>
  );
}
