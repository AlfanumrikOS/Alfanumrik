'use client';

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useTenant } from '@alfanumrik/lib/tenant-context';
import type { ExperienceV3ClientScope } from '@alfanumrik/lib/use-experience-v3';
import type { RoleManifest } from '@alfanumrik/lib/experience-v3';
import { ContextSelector, ExperienceV3Root, RoleShell } from '@alfanumrik/ui/v3';

interface SchoolV3ScopeValue {
  schoolId: string | null;
  schoolName: string;
  academicYear: string;
  loading: boolean;
  withSchoolScope: (href: string) => string;
}

const SchoolV3Scope = createContext<SchoolV3ScopeValue | null>(null);

export function useSchoolV3Scope(): SchoolV3ScopeValue {
  const value = useContext(SchoolV3Scope);
  if (!value) throw new Error('useSchoolV3Scope must be used within SchoolAdminV3Shell');
  return value;
}

export default function SchoolAdminV3Shell({
  children,
  manifest,
  authoritativeScope,
}: {
  children: React.ReactNode;
  manifest: RoleManifest;
  authoritativeScope: ExperienceV3ClientScope | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isHi } = useAuth();
  const tenant = useTenant();
  const schoolId = authoritativeScope?.schoolId ?? null;
  const schools = useMemo(() => authoritativeScope?.schools ?? [], [authoritativeScope?.schools]);
  const schoolName = schools.find((school) => school.id === schoolId)?.name ?? 'School';

  useEffect(() => {
    if (!schoolId || searchParams?.get('schoolId') === schoolId) return;
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('schoolId', schoolId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, schoolId, searchParams]);

  const selectSchool = useCallback((value: string) => {
    if (!schools.some((school) => school.id === value)) return;
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('schoolId', value);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, schools, searchParams]);

  const withSchoolScope = useCallback((href: string) => {
    if (!schoolId) return href;
    const url = new URL(href, 'https://alfanumrik.local');
    url.searchParams.set('schoolId', schoolId);
    return `${url.pathname}${url.search}${url.hash}`;
  }, [schoolId]);

  // These read models are school-scoped but not academic-year-scoped. Expose
  // the limitation honestly rather than adding a cosmetic query parameter.
  const academicYear = 'All available years';
  const navigation = useMemo(() => manifest.desktop.map((item) => ({ ...item, href: withSchoolScope(item.href) })), [manifest.desktop, withSchoolScope]);

  const context = (
    <div className="flex flex-wrap items-center gap-2">
      {schools.length > 1 ? (
        <ContextSelector
          label={isHi ? 'विद्यालय' : 'School'}
          value={schoolId ?? ''}
          onChange={selectSchool}
          options={schools.map((school) => ({ value: school.id, label: school.name }))}
        />
      ) : <span className="truncate text-sm font-semibold">{schoolName}</span>}
      <ContextSelector
        label={isHi ? 'डेटा अवधि' : 'Data period'}
        value="all"
        disabled
        options={[{ value: 'all', label: isHi ? 'सभी उपलब्ध वर्ष' : 'All available years' }]}
      />
    </div>
  );

  return (
    <SchoolV3Scope.Provider value={{ schoolId, schoolName, academicYear, loading: false, withSchoolScope }}>
      <ExperienceV3Root role="school-admin">
      <RoleShell
        role="school-admin"
        navigation={navigation}
        activeHref={`${pathname ?? '/school-admin'}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`}
        brand={{
          name: schoolName,
          logoUrl: tenant.schoolId === schoolId ? tenant.branding.logoUrl ?? undefined : undefined,
          accent: tenant.schoolId === schoolId ? tenant.branding.primaryColor : undefined,
        }}
        context={context}
        mobileMoreItems={manifest.more.map((item) => ({ ...item, href: withSchoolScope(item.href) }))}
      >
        {children}
      </RoleShell>
      </ExperienceV3Root>
    </SchoolV3Scope.Provider>
  );
}
