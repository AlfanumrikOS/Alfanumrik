'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { useTeacherDashboard } from '@alfanumrik/lib/teacher/use-teacher-data';
import { ContextSelector, DataState, ExperienceV3Root, RoleShell } from '@alfanumrik/ui/v3';
import TeacherShell from './TeacherShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import '../../(student)/_components/student-v3.css';
import { resolveTeacherClassScope } from './teacher-v3-contract';

const CLASS_SCOPE_KEY = 'alfanumrik.teacher.v3.class';

type TeacherScope = {
  enabled: boolean;
  classId: string | null;
  classes: Array<{ id: string; name: string; student_count: number; avg_mastery?: number }>;
  loading: boolean;
  error: unknown;
  setClassId: (classId: string) => void;
};

const TeacherScopeContext = createContext<TeacherScope>({
  enabled: false,
  classId: null,
  classes: [],
  loading: false,
  error: null,
  setClassId: () => undefined,
});

export function useTeacherV3Scope() {
  return useContext(TeacherScopeContext);
}

export default function TeacherV3LayoutGate({ children }: { children: React.ReactNode }) {
  const { enabled, loading: flagLoading, manifest, routeAllowed, legacyAllowed, denied } = useExperienceV3('teacher');
  const { activeRole, isLoading: authLoading } = useAuth();

  if (flagLoading || authLoading) return <DataState state="loading" title="Loading teacher workspace…" />;
  if (legacyAllowed) return <TeacherShell>{children}</TeacherShell>;
  if (denied || !enabled || !routeAllowed || !manifest || activeRole !== 'teacher') return <DataState state="permission" title="This teacher destination is unavailable" />;

  return <TeacherV3Layout manifest={manifest}>{children}</TeacherV3Layout>;
}

function TeacherV3Layout({ children, manifest }: { children: React.ReactNode; manifest: import('@alfanumrik/lib/experience-v3').RoleManifest }) {
  const pathname = usePathname() ?? manifest.homeHref;
  const router = useRouter();
  const search = useSearchParams();
  const dashboard = useTeacherDashboard();
  const classes = useMemo(() => dashboard.data?.classes ?? [], [dashboard.data?.classes]);
  const [persistedClass, setPersistedClass] = useState<string | null>(null);
  const [scopeHydrated, setScopeHydrated] = useState(false);

  useEffect(() => {
    setPersistedClass(window.localStorage.getItem(CLASS_SCOPE_KEY));
    setScopeHydrated(true);
  }, []);

  const requestedClass = search?.get('class') ?? null;
  const classId = scopeHydrated ? resolveTeacherClassScope(classes, requestedClass, persistedClass) : null;

  const setClassId = (nextClassId: string) => {
    if (!classes.some((item) => item.id === nextClassId)) return;
    setPersistedClass(nextClassId);
    window.localStorage.setItem(CLASS_SCOPE_KEY, nextClassId);
    const params = new URLSearchParams(search?.toString() ?? '');
    params.set('class', nextClassId);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    if (!scopeHydrated || !classId) return;
    setPersistedClass(classId);
    window.localStorage.setItem(CLASS_SCOPE_KEY, classId);
    if (requestedClass === classId) return;
    const params = new URLSearchParams(search?.toString() ?? '');
    params.set('class', classId);
    router.replace(`${pathname}?${params.toString()}`);
  }, [classId, pathname, requestedClass, router, scopeHydrated, search]);

  const context = classes.length ? (
    <ContextSelector
      label="Active class"
      name="teacher-class"
      value={classId ?? ''}
      options={classes.map((item) => ({
        value: item.id,
        label: item.name,
        description: `${item.student_count} students`,
      }))}
      onChange={setClassId}
      disabled={dashboard.isLoading}
    />
  ) : undefined;

  const value: TeacherScope = {
    enabled: true,
    classId,
    classes,
    loading: dashboard.isLoading || !scopeHydrated,
    error: dashboard.error,
    setClassId,
  };

  return (
    <TeacherScopeContext.Provider value={value}>
      <ExperienceV3Root role="teacher">
        <RoleShell
          role="teacher"
          navigation={manifest.desktop}
          mobileMoreItems={manifest.more}
          activeHref={pathname}
          brand={{ name: 'Alfanumrik Teacher' }}
          context={context}
        >
          {dashboard.error ? (
            <DataState state="error" title="Class scope is unavailable" description="Restricted class data was not replaced with a fallback." />
          ) : children}
        </RoleShell>
      </ExperienceV3Root>
    </TeacherScopeContext.Provider>
  );
}
