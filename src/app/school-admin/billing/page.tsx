'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Badge,
  Skeleton,
  SectionHeader,
  EmptyState,
  BottomNav,
} from '@/components/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface Invoice {
  id: string;
  period_start: string;
  period_end: string;
  seats_used: number;
  amount_inr: number;
  status: string;
  created_at: string;
}

interface SeatSnapshot {
  snapshot_date: string;
  active_students: number;
  seats_purchased: number;
  utilization_pct: number;
}

interface SchoolInfo {
  school_id: string;
  name: string;
  max_students: number;
  subscription_plan: string;
}

/* ─────────────────────────────────────────────────────────────
   STATUS COLOR HELPERS
───────────────────────────────────────────────────────────── */
function statusBadgeColor(status: string): string {
  switch (status) {
    case 'paid': return 'var(--green)';
    case 'overdue': return '#DC2626';
    case 'sent': return 'var(--purple)';
    case 'generated': return 'var(--orange)';
    default: return '#7D7264';
  }
}

function statusLabel(status: string, isHi: boolean): string {
  switch (status) {
    case 'paid': return t(isHi, 'Paid', 'भुगतान हो गया');
    case 'overdue': return t(isHi, 'Overdue', 'बकाया');
    case 'sent': return t(isHi, 'Sent', 'भेजा गया');
    case 'generated': return t(isHi, 'Generated', 'बनाया गया');
    default: return status;
  }
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING
───────────────────────────────────────────────────────────── */
function PageSkeleton() {
  return (
    <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="rect" height={80} rounded="rounded-xl" />
        ))}
      </div>
      <Skeleton variant="text" height={16} width="50%" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rect" height={56} rounded="rounded-xl" />
        ))}
      </div>
      <Skeleton variant="text" height={16} width="50%" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rect" height={48} rounded="rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolBillingPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* State */
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [seatSnapshots, setSeatSnapshots] = useState<SeatSnapshot[]>([]);
  const [currentSeats, setCurrentSeats] = useState({ active: 0, purchased: 0, utilization: 0 });
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Step 1: Auth guard ── */
  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);

    const { data, error: dbErr } = await supabase
      .from('school_admins')
      .select('school_id, name')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (dbErr || !data) {
      router.replace('/login');
      return;
    }

    // Fetch school details
    const { data: school } = await supabase
      .from('schools')
      .select('id, name, max_students, subscription_plan')
      .eq('id', data.school_id)
      .maybeSingle();

    if (school) {
      setSchoolInfo({
        school_id: school.id as string,
        name: school.name as string,
        max_students: (school.max_students as number) || 0,
        subscription_plan: (school.subscription_plan as string) || 'standard',
      });
    }
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Step 2: Fetch billing data ── */
  const fetchBillingData = useCallback(async (schoolId: string) => {
    setLoadingData(true);
    setError(null);

    try {
      // Fetch invoices via the school-admin API
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        router.replace('/login');
        return;
      }

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      // Fetch invoices
      const invRes = await fetch('/api/school-admin/invoices?limit=50', { headers });
      if (invRes.ok) {
        const invJson = await invRes.json();
        setInvoices(invJson.data?.invoices || []);
      }

      // Fetch seat usage data via direct supabase query (scoped by school_id)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sinceStr = thirtyDaysAgo.toISOString().split('T')[0];

      const { data: snapshots } = await supabase
        .from('school_seat_usage')
        .select('snapshot_date, active_students, seats_purchased, utilization_pct')
        .eq('school_id', schoolId)
        .gte('snapshot_date', sinceStr)
        .order('snapshot_date', { ascending: false })
        .limit(30);

      setSeatSnapshots(snapshots || []);

      // Current seat count (from school_seat_usage latest, or student count)
      if (snapshots && snapshots.length > 0) {
        const latest = snapshots[0];
        setCurrentSeats({
          active: latest.active_students,
          purchased: latest.seats_purchased,
          utilization: latest.utilization_pct,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data');
    }

    setLoadingData(false);
  }, [router]);

  /* ── Auth redirect guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── Fetch admin record ── */
  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  /* ── Fetch billing data ── */
  useEffect(() => {
    if (schoolInfo?.school_id) {
      fetchBillingData(schoolInfo.school_id);
    }
  }, [schoolInfo, fetchBillingData]);

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  /* ── Page header ── */
  const PageHeader = (
    <header
      className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
      style={{
        background: 'rgba(251,248,244,0.94)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <button
        onClick={() => router.push('/school-admin')}
        className="flex items-center justify-center rounded-xl transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
        style={{
          minWidth: 40, minHeight: 40,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
          fontSize: '18px',
        }}
        aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस')}
      >
        ←
      </button>

      <div className="flex-1 min-w-0">
        <h1
          className="text-base font-bold text-[var(--text-1)] truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t(isHi, 'Billing', 'बिलिंग')}
        </h1>
      </div>

      <button
        onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
        className="flex items-center justify-center rounded-xl text-xs font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
        style={{
          minWidth: 40, minHeight: 40,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
        }}
        aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
      >
        {isHi ? 'EN' : 'हि'}
      </button>
    </header>
  );

  /* ── Full page skeleton ── */
  if (isPageLoading) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
        <header
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
          style={{
            background: 'rgba(251,248,244,0.94)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="circle" width={40} height={40} />
          <Skeleton variant="title" height={20} width="40%" className="flex-1" />
          <Skeleton variant="rect" width={40} height={40} rounded="rounded-xl" />
        </header>
        <PageSkeleton />
      </div>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
        {PageHeader}
        <main className="px-4 pt-6 pb-24 max-w-2xl mx-auto">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">⚠</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{error}</p>
            <Button
              variant="primary"
              onClick={() => schoolInfo && fetchBillingData(schoolInfo.school_id)}
            >
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  /* ── Derived values ── */
  const planLabel = (schoolInfo?.subscription_plan || 'Standard').replace(/^\w/, c => c.toUpperCase());

  // Estimate monthly cost based on plan pricing
  const SEAT_PRICES: Record<string, number> = {
    basic: 99,
    standard: 199,
    premium: 399,
    enterprise: 599,
  };
  const pricePerSeat = SEAT_PRICES[(schoolInfo?.subscription_plan || 'standard').toLowerCase()] || 199;
  const monthlyCost = currentSeats.active * pricePerSeat;

  // Next invoice date estimate (first of next month)
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextInvoiceStr = nextMonth.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  /* ── Loaded state ── */
  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {PageHeader}

      <main className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-5">

        {/* ── Stat Cards ── */}
        <section aria-label={t(isHi, 'Billing overview', 'बिलिंग अवलोकन')}>
          <div className="grid grid-cols-2 gap-2">
            {/* Current Plan */}
            <Card>
              <div className="text-center py-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  {t(isHi, 'Current Plan', 'वर्तमान प्लान')}
                </p>
                <p className="text-lg font-bold mt-1" style={{ color: 'var(--purple)', fontFamily: 'var(--font-display)' }}>
                  {planLabel}
                </p>
              </div>
            </Card>

            {/* Seats Used */}
            <Card>
              <div className="text-center py-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  {t(isHi, 'Seats Used', 'सीट उपयोग')}
                </p>
                <p className="text-lg font-bold mt-1" style={{ color: 'var(--orange)', fontFamily: 'var(--font-display)' }}>
                  {currentSeats.active} / {schoolInfo?.max_students || currentSeats.purchased}
                </p>
              </div>
            </Card>

            {/* Monthly Cost */}
            <Card>
              <div className="text-center py-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  {t(isHi, 'Monthly Cost', 'मासिक लागत')}
                </p>
                <p className="text-lg font-bold mt-1" style={{ color: '#16A34A', fontFamily: 'var(--font-display)' }}>
                  {monthlyCost.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 })}
                </p>
              </div>
            </Card>

            {/* Next Invoice */}
            <Card>
              <div className="text-center py-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  {t(isHi, 'Next Invoice', 'अगला बिल')}
                </p>
                <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
                  {nextInvoiceStr}
                </p>
              </div>
            </Card>
          </div>
        </section>

        {/* ── Seat Usage History ── */}
        <section aria-label={t(isHi, 'Seat usage history', 'सीट उपयोग इतिहास')}>
          <SectionHeader icon="&#9632;">
            {t(isHi, 'Seat Usage (Last 30 Days)', 'सीट उपयोग (पिछले 30 दिन)')}
          </SectionHeader>

          {loadingData ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} variant="rect" height={40} rounded="rounded-xl" />
              ))}
            </div>
          ) : seatSnapshots.length === 0 ? (
            <EmptyState
              icon="&#9632;"
              title={t(isHi, 'No usage data yet', 'अभी कोई उपयोग डेटा नहीं')}
              description={t(isHi, 'Seat usage data will appear after the first daily snapshot.', 'पहले दैनिक स्नैपशॉट के बाद सीट उपयोग डेटा दिखाई देगा।')}
            />
          ) : (
            <Card>
              {/* Table header */}
              <div
                className="grid grid-cols-4 gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
              >
                <span>{t(isHi, 'Date', 'तारीख')}</span>
                <span className="text-center">{t(isHi, 'Students', 'छात्र')}</span>
                <span className="text-center">{t(isHi, 'Seats', 'सीट')}</span>
                <span className="text-right">{t(isHi, 'Utilization', 'उपयोग %')}</span>
              </div>

              {/* Table rows */}
              {seatSnapshots.slice(0, 15).map((snap) => {
                const utilColor = snap.utilization_pct > 90
                  ? '#DC2626'
                  : snap.utilization_pct > 70
                  ? 'var(--orange)'
                  : 'var(--green)';

                return (
                  <div
                    key={snap.snapshot_date}
                    className="grid grid-cols-4 gap-2 px-3 py-2.5 text-sm"
                    style={{ borderBottom: '1px solid var(--border-light, #f3f4f6)' }}
                  >
                    <span style={{ color: 'var(--text-2)' }}>
                      {new Date(snap.snapshot_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="text-center font-semibold" style={{ color: 'var(--text-1)' }}>
                      {snap.active_students}
                    </span>
                    <span className="text-center" style={{ color: 'var(--text-2)' }}>
                      {snap.seats_purchased}
                    </span>
                    <span className="text-right font-bold" style={{ color: utilColor }}>
                      {snap.utilization_pct}%
                    </span>
                  </div>
                );
              })}
            </Card>
          )}
        </section>

        {/* ── Invoice History ── */}
        <section aria-label={t(isHi, 'Invoice history', 'बिल इतिहास')}>
          <SectionHeader icon="&#9633;">
            {t(isHi, 'Invoice History', 'बिल इतिहास')}
          </SectionHeader>

          {loadingData ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} variant="rect" height={60} rounded="rounded-xl" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <EmptyState
              icon="&#9633;"
              title={t(isHi, 'No invoices yet', 'अभी कोई बिल नहीं')}
              description={t(isHi, 'Invoices will appear here once generated by the admin.', 'व्यवस्थापक द्वारा बनाए जाने पर बिल यहाँ दिखाई देंगे।')}
            />
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => {
                const periodStart = new Date(inv.period_start);
                const periodEnd = new Date(inv.period_end);
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const period = `${months[periodStart.getMonth()]} ${periodStart.getDate()} - ${months[periodEnd.getMonth()]} ${periodEnd.getDate()}, ${periodEnd.getFullYear()}`;

                return (
                  <Card key={inv.id} hoverable>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-1)]">{period}</p>
                        <p className="text-xs text-[var(--text-3)] mt-0.5">
                          {inv.seats_used} {t(isHi, 'seats', 'सीट')}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                          {Number(inv.amount_inr).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 })}
                        </span>
                        <Badge color={statusBadgeColor(inv.status)} size="sm">
                          {statusLabel(inv.status, isHi)}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
