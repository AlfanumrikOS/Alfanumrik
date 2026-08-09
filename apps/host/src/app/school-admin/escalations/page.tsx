'use client';

/**
 * /school-admin/escalations — Teacher Dashboard RCA follow-up (T13) +
 * Safeguarding review queue (Foxy North-Star Phase 1).
 *
 * TWO TABS:
 *   1. "Escalations" — read-only list of teacher → school-admin escalations
 *      (data: /api/school-admin/escalations, notifications rows with
 *      type='teacher_escalation'). Original T13 surface, unchanged.
 *   2. "Safeguarding / सुरक्षा" — school-scoped safeguarding case review
 *      queue (data: /api/school-admin/safeguarding). Deep-link:
 *      /school-admin/escalations?tab=safeguarding
 *
 * P10 FOLD-IN DECISION (2026-08-05, quality-gate blocker): the safeguarding
 * queue originally shipped as a standalone route at /school-admin/safeguarding,
 * which measured 290.1 kB first-load — over the 260 kB per-page cap that new
 * routes get no grandfathering from. The cap is structurally unreachable for
 * ANY new route under the school-admin layout: the lightest grandfathered
 * sibling measures 287.4 kB, i.e. the shell alone exceeds 260 kB. Per the
 * approved fallback, the queue was folded into THIS grandfathered page
 * (baseline 295.2 kB) as a second tab, loaded via next/dynamic (ssr:false) so
 * it stays out of this route's first-load chunk set, and the standalone route
 * dir was deleted. The API routes are unchanged.
 *
 * NOTE (scoping, honestly stated): the escalations tab is intentionally a
 * minimal read-only list, NOT a full case-management inbox (see T13 report).
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import SchoolAdminPageHeader from '../_components/SchoolAdminPageHeader';
import { Card, Skeleton, EmptyState, Button } from '@alfanumrik/ui/ui';

// Code-split: the safeguarding queue only loads when its tab is opened.
const SafeguardingQueue = dynamic(() => import('./SafeguardingQueue'), {
  ssr: false,
  loading: () => (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <div className="space-y-2">
            <Skeleton variant="title" height={16} width="40%" />
            <Skeleton variant="text" height={12} width="70%" />
          </div>
        </Card>
      ))}
    </div>
  ),
});

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

type PageTab = 'escalations' | 'safeguarding';

interface EscalationRow {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  student_id: string | null;
  class_id: string | null;
  /**
   * Additive contract (2026-08): the escalations API now also returns
   * 'safeguarding_escalation' notification rows carrying typeLabel /
   * typeLabelHi / link. All four fields are optional — pre-deploy rows
   * (and plain teacher rows) lack them and must render unchanged.
   */
  type?: string | null;
  typeLabel?: string | null;
  typeLabelHi?: string | null;
  link?: string | null;
}

/** Fixed deep-link target for safeguarding rows (the second tab of this page). */
const SAFEGUARDING_TAB_LINK = '/school-admin/escalations?tab=safeguarding';

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

function EscalationCard({
  escalation,
  isHi,
  onOpenSafeguarding,
}: {
  escalation: EscalationRow;
  isHi: boolean;
  onOpenSafeguarding?: () => void;
}) {
  const isSafeguarding = escalation.type === 'safeguarding_escalation';

  // Bilingual type label with fallbacks for pre-deploy rows lacking the
  // additive fields.
  const typeLabel = isHi
    ? escalation.typeLabelHi || escalation.typeLabel || 'सुरक्षा'
    : escalation.typeLabel || 'Safeguarding';

  const body = (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-sm font-bold text-[var(--text-1)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isSafeguarding
            ? escalation.title || typeLabel
            : t(isHi, 'Teacher escalation', 'शिक्षक एस्केलेशन')}
        </h3>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {isSafeguarding && (
            <span
              className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(220,38,38,0.1)', color: '#DC2626' }}
            >
              {typeLabel}
            </span>
          )}
          {!escalation.is_read && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[rgba(220,38,38,0.1)] text-[#DC2626]">
              {t(isHi, 'New', 'नया')}
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-2)] mt-2 whitespace-pre-wrap">{escalation.message}</p>
      <p className="text-[11px] text-[var(--text-3)] mt-3">{formatDateTime(escalation.created_at)}</p>
    </Card>
  );

  if (isSafeguarding) {
    // Whole row links to the safeguarding tab of this page. onClick also flips
    // the tab state directly — the ?tab= deep-link is only read on mount, so a
    // same-route navigation alone would not switch tabs.
    return (
      <Link
        href={SAFEGUARDING_TAB_LINK}
        onClick={onOpenSafeguarding}
        className="block"
        aria-label={t(isHi, 'Open safeguarding queue', 'सुरक्षा सूची खोलें')}
      >
        {body}
      </Link>
    );
  }

  return body;
}

export default function SchoolAdminEscalationsPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi } = useAuth();

  const [tab, setTab] = useState<PageTab>('escalations');
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [escalations, setEscalations] = useState<EscalationRow[]>([]);
  const [loadingEscalations, setLoadingEscalations] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Deep-link: ?tab=safeguarding (used by the nav item and safeguarding
  // notifications). Read once on mount — window is client-only, and reading
  // it in an effect avoids a useSearchParams() Suspense boundary.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'safeguarding') {
      setTab('safeguarding');
    }
  }, []);

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
    // No session token = the read never happened. Bailing silently left
    // `escalations` at [] with no error and no loading flag, so the page then
    // asserted "No escalations" — telling an admin nothing had been escalated
    // when in fact nothing had been READ.
    if (!token) {
      setLoadingEscalations(false);
      setApiError(
        t(isHi, 'Your session has expired. Please sign in again.', 'आपका सेशन समाप्त हो गया। कृपया दोबारा साइन इन करें।'),
      );
      return;
    }
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
    if (!loadingAdmin && authUserId && tab === 'escalations') fetchEscalations();
  }, [loadingAdmin, authUserId, tab, fetchEscalations]);

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

  const tabBar = (
    <div
      className="flex gap-1.5 mb-4"
      role="tablist"
      aria-label={t(isHi, 'Case type', 'मामले का प्रकार')}
    >
      {([
        { key: 'escalations' as const, en: 'Escalations', hi: 'एस्केलेशन' },
        { key: 'safeguarding' as const, en: 'Safeguarding', hi: 'सुरक्षा' },
      ]).map(({ key, en, hi }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => setTab(key)}
          className="px-4 py-2 min-h-[44px] rounded-xl text-sm font-bold transition-all active:scale-[0.97]"
          style={
            tab === key
              ? { background: 'var(--orange, #F97316)', color: '#fff' }
              : { background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border)' }
          }
        >
          {t(isHi, en, hi)}
        </button>
      ))}
    </div>
  );

  if (tab === 'safeguarding') {
    return (
      <>
        <SchoolAdminPageHeader
          title="Safeguarding"
          titleHi="सुरक्षा समीक्षा"
          isHi={isHi}
        />
        {tabBar}
        <SafeguardingQueue isHi={isHi} />
      </>
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
        {tabBar}
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
      {tabBar}
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
              <EscalationCard
                key={e.id}
                escalation={e}
                isHi={isHi}
                onOpenSafeguarding={() => setTab('safeguarding')}
              />
            ))}
          </section>
        )}

        {/* Genuine-empty only: never claim "nothing was escalated" off a read
            we could not complete. */}
        {!loadingEscalations && !apiError && escalations.length === 0 && (
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
