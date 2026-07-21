'use client';

/**
 * /school-admin/escalations — Teacher Dashboard RCA follow-up (T13).
 *
 * Simplest-reasonable school-admin visibility surface for teacher -> school
 * admin escalations (see `apps/host/src/app/api/teacher/escalate/route.ts`
 * for the write side and `apps/host/src/app/api/school-admin/escalations/route.ts`
 * for this page's data source). Read-only list, newest first.
 *
 * NOTE (scoping, honestly stated): this is intentionally a minimal standalone
 * list page, NOT a full case-management inbox. A fuller surface would add:
 * mark-as-read / acknowledge, assign-to-admin, resolve/close workflow, and a
 * home inside the School Command Center's alert rail. Deferred — see the
 * frontend agent's task report for T13.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import SchoolAdminPageHeader from '../_components/SchoolAdminPageHeader';
import { Card, Skeleton, EmptyState, Button } from '@alfanumrik/ui/ui';

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

interface EscalationRow {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  student_id: string | null;
  class_id: string | null;
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EscalationCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="space-y-2">
        <Skeleton variant="title" height={16} width="40%" />
        <Skeleton variant="text" height={12} width="90%" />
        <Skeleton variant="text" height={12} width="30%" />
      </div>
    </Card>
  );
}

function EscalationCard({ escalation, isHi }: { escalation: EscalationRow; isHi: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-sm font-bold text-[var(--text-1)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t(isHi, 'Teacher escalation', 'शिक्षक एस्केलेशन')}
        </h3>
        {!escalation.is_read && (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[rgba(220,38,38,0.1)] text-[#DC2626]">
            {t(isHi, 'New', 'नया')}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--text-2)] mt-2 whitespace-pre-wrap">{escalation.message}</p>
      <p className="text-[11px] text-[var(--text-3)] mt-3">{formatDateTime(escalation.created_at)}</p>
    </Card>
  );
}

export default function SchoolAdminEscalationsPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi } = useAuth();

  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [escalations, setEscalations] = useState<EscalationRow[]>([]);
  const [loadingEscalations, setLoadingEscalations] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);
    const { data, error } = await supabase
      .from('school_admins')
      .select('school_id')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !data) {
      router.replace('/login');
      return;
    }
    setLoadingAdmin(false);
  }, [authUserId, router]);

  const fetchEscalations = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoadingEscalations(true);
    setApiError(null);
    try {
      const res = await fetch('/api/school-admin/escalations', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setEscalations((json.data ?? []) as EscalationRow[]);
    } catch (err: any) {
      setApiError(err.message || t(isHi, 'Failed to load escalations', 'एस्केलेशन लोड करने में विफल'));
    } finally {
      setLoadingEscalations(false);
    }
  }, [getToken, isHi]);

  useEffect(() => {
    if (!authLoading && !authUserId) router.replace('/login');
  }, [authLoading, authUserId, router]);

  useEffect(() => {
    if (!authLoading && authUserId) fetchAdminRecord();
  }, [authLoading, authUserId, fetchAdminRecord]);

  useEffect(() => {
    if (!loadingAdmin && authUserId) fetchEscalations();
  }, [loadingAdmin, authUserId, fetchEscalations]);

  const isPageLoading = authLoading || loadingAdmin;

  if (isPageLoading) {
    return (
      <div className="space-y-4">
        <Skeleton variant="rect" height={40} rounded="rounded-xl" />
        {[1, 2, 3].map((i) => (
          <EscalationCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (apiError && !loadingEscalations && escalations.length === 0) {
    return (
      <>
        <SchoolAdminPageHeader
          title="Teacher Escalations"
          titleHi="शिक्षक एस्केलेशन"
          isHi={isHi}
        />
        <div className="space-y-4 max-w-4xl">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">⚠</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{apiError}</p>
            <Button variant="primary" onClick={fetchEscalations}>
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <SchoolAdminPageHeader
        title="Teacher Escalations"
        titleHi="शिक्षक एस्केलेशन"
        isHi={isHi}
      />
      <div className="space-y-4 max-w-4xl">
        {loadingEscalations && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <EscalationCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!loadingEscalations && escalations.length > 0 && (
          <section aria-label={t(isHi, 'Escalation list', 'एस्केलेशन सूची')} className="space-y-3">
            {escalations.map((e) => (
              <EscalationCard key={e.id} escalation={e} isHi={isHi} />
            ))}
          </section>
        )}

        {!loadingEscalations && escalations.length === 0 && (
          <EmptyState
            icon="🚩"
            title={t(isHi, 'No escalations', 'कोई एस्केलेशन नहीं')}
            description={t(
              isHi,
              'When a teacher escalates a student case to you, it will appear here.',
              'जब कोई शिक्षक किसी छात्र का मामला आपको भेजेगा, तो वह यहाँ दिखाई देगा।',
            )}
          />
        )}
      </div>
    </>
  );
}
