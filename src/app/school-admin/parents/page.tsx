'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Badge,
  Skeleton,
  EmptyState,
  SheetModal,
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
interface ParentLink {
  id: string;
  parent_name: string;
  parent_phone: string | null;
  student_name: string;
  /** Always string "6"–"12" per P5 */
  student_grade: string;
  status: 'approved' | 'pending' | 'rejected';
  linked_at: string;
}

interface SchoolClass {
  id: string;
  name: string;
  /** Always string "6"–"12" per P5 */
  grade: string;
}

interface ParentStats {
  total: number;
  approved: number;
  pending: number;
}

type TabFilter = 'links' | 'message';
// Wire values match the /api/school-admin/parents POST contract exactly:
//   target  : 'all' | 'grade' | 'class'   (single target_value, not arrays)
//   channel : 'notification' | 'whatsapp' | 'email'
type TargetType = 'all' | 'grade' | 'class';
type ChannelType = 'notification' | 'whatsapp' | 'email';

/* ─────────────────────────────────────────────────────────────
   GRADE OPTIONS (strings — P5)
───────────────────────────────────────────────────────────── */
const GRADE_VALUES = ['6', '7', '8', '9', '10', '11', '12'] as const;

/* ─────────────────────────────────────────────────────────────
   DATE HELPER
───────────────────────────────────────────────────────────── */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/* ─────────────────────────────────────────────────────────────
   STATUS HELPERS
───────────────────────────────────────────────────────────── */
function statusColor(status: ParentLink['status']): string {
  if (status === 'approved') return 'var(--green)';
  if (status === 'pending') return 'var(--orange)';
  return '#DC2626';
}

function statusLabel(isHi: boolean, status: ParentLink['status']): string {
  if (status === 'approved') return t(isHi, 'Approved', 'स्वीकृत');
  if (status === 'pending') return t(isHi, 'Pending', 'लंबित');
  return t(isHi, 'Rejected', 'अस्वीकृत');
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATES
───────────────────────────────────────────────────────────── */
function ParentRowSkeleton() {
  return (
    <div
      className="flex items-center gap-3 py-3"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex-1 space-y-2">
        <Skeleton variant="title" height={14} width="45%" />
        <Skeleton variant="text" height={12} width="65%" />
      </div>
      <Skeleton variant="rect" height={22} width={64} rounded="rounded-full" />
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div
      className="rounded-xl p-4 text-center"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <Skeleton variant="title" height={28} width="40%" className="mx-auto" />
      <Skeleton variant="text" height={12} width="60%" className="mx-auto mt-2" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STAT CARD
───────────────────────────────────────────────────────────── */
interface StatCardProps {
  value: number;
  label: string;
  color: string;
}

function StatCard({ value, label, color }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-4 text-center"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs text-[var(--text-3)] mt-1 font-medium">{label}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SEND CONFIRMATION DIALOG
───────────────────────────────────────────────────────────── */
interface SendConfirmProps {
  isHi: boolean;
  recipientCount: number;
  channel: ChannelType;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function SendConfirm({ isHi, recipientCount, channel, onConfirm, onCancel, loading }: SendConfirmProps) {
  const channelLabel = channel === 'notification'
    ? t(isHi, 'In-app notification', 'ऐप अधिसूचना')
    : channel === 'email'
      ? t(isHi, 'Email', 'ईमेल')
      : t(isHi, 'WhatsApp', 'WhatsApp');

  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--text-2)]">
        {t(isHi,
          `Send to ${recipientCount} parent(s) via ${channelLabel}?`,
          `${recipientCount} अभिभावक(ओं) को ${channelLabel} के माध्यम से भेजें?`
        )}
      </p>
      <div className="flex gap-3">
        <Button
          variant="primary"
          fullWidth
          onClick={onConfirm}
          disabled={loading}
          style={{ minHeight: 48 }}
        >
          {loading
            ? t(isHi, 'Sending...', 'भेज रहे हैं...')
            : t(isHi, 'Send', 'भेजें')}
        </Button>
        <Button
          variant="soft"
          onClick={onCancel}
          style={{ minHeight: 48 }}
        >
          {t(isHi, 'Cancel', 'रद्द करें')}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminParentsPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* ── Core state ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [activeTab, setActiveTab] = useState<TabFilter>('links');

  /* ── Parent Links state ── */
  const [parentLinks, setParentLinks] = useState<ParentLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  /* ── Stats ── */
  const [stats, setStats] = useState<ParentStats>({ total: 0, approved: 0, pending: 0 });

  /* ── Send Message state ──
     The backend POST accepts a SINGLE target_value (one grade or one class),
     so the targeting UI is single-select (not multi-set). */
  const [messageEn, setMessageEn] = useState('');
  const [messageHi, setMessageHi] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('all');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [channel, setChannel] = useState<ChannelType>('notification');
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent_count: number; failed_count: number; channel: string } | null>(null);

  /* ── Success toast ── */
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  /* ── Auth helper: get session token ── */
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  /* ── Step 1: Auth guard — fetch school_admins record ── */
  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);

    const { data, error } = await supabase
      .from('school_admins')
      .select('school_id, name')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      router.replace('/login');
      return;
    }

    setSchoolId(data.school_id as string);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Fetch parent links via API ── */
  const fetchParentLinks = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setLoadingLinks(true);
    setLinksError(null);

    try {
      const res = await fetch('/api/school-admin/parents', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');

      const links = (json.data?.links ?? []) as ParentLink[];
      setParentLinks(links);

      // Compute stats
      const approved = links.filter(l => l.status === 'approved').length;
      const pending = links.filter(l => l.status === 'pending').length;
      setStats({ total: links.length, approved, pending });
    } catch (err: any) {
      setLinksError(err.message || t(isHi, 'Failed to load parent links', 'अभिभावक लिंक लोड करने में विफल'));
    } finally {
      setLoadingLinks(false);
    }
  }, [getToken, isHi]);

  /* ── Fetch classes for targeting ── */
  const fetchClasses = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/school-admin/classes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setClasses((json.data ?? []) as SchoolClass[]);
      }
    } catch {
      // Non-critical
    }
  }, [getToken]);

  /* ── Send message ──
     Maps the compose form to the /api/school-admin/parents POST contract:
       { message, message_hi, target, target_value, channel }
     and consumes { success, data: { sent_count, failed_count, channel } }. */
  const handleSendMessage = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setSendLoading(true);
    try {
      // Single target_value per the backend contract (one grade or one class).
      const targetValue =
        targetType === 'grade'
          ? selectedGrade
          : targetType === 'class'
            ? selectedClassId
            : undefined;

      const res = await fetch('/api/school-admin/parents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: messageEn.trim(),
          message_hi: messageHi.trim() || undefined,
          target: targetType,
          ...(targetValue ? { target_value: targetValue } : {}),
          channel,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');

      // Response: { success, data: { sent_count, failed_count, channel } }
      const result = json.data as { sent_count: number; failed_count: number; channel: string };
      setSendResult(result);
      setSendConfirmOpen(false);

      // Real summary toast: sent vs failed.
      setSuccessMsg(
        result.failed_count > 0
          ? t(isHi,
              `Sent to ${result.sent_count} parent(s), ${result.failed_count} failed`,
              `${result.sent_count} अभिभावक(ओं) को भेजा गया, ${result.failed_count} विफल`
            )
          : result.sent_count > 0
            ? t(isHi,
                `Message sent to ${result.sent_count} parent(s)`,
                `${result.sent_count} अभिभावक(ओं) को संदेश भेजा गया`
              )
            : t(isHi,
                'No matching parents to send to',
                'भेजने के लिए कोई मेल खाता अभिभावक नहीं'
              )
      );

      // Reset form
      setMessageEn('');
      setMessageHi('');
      setTargetType('all');
      setSelectedGrade('');
      setSelectedClassId('');
    } catch (err: any) {
      setLinksError(err.message);
      setSendConfirmOpen(false);
    } finally {
      setSendLoading(false);
    }
  }, [getToken, isHi, messageEn, messageHi, targetType, selectedGrade, selectedClassId, channel]);

  /* ── Estimated recipient count ──
     'all'   → all approved links
     'grade' → approved links matching the single selected grade
     'class' → not estimable client-side (need enrollments); show approved as
               an upper bound once a class is chosen. */
  const estimatedRecipients = (() => {
    if (targetType === 'all') return stats.approved;
    if (targetType === 'grade') {
      if (!selectedGrade) return 0;
      return parentLinks.filter(
        l => l.status === 'approved' && l.student_grade === selectedGrade
      ).length;
    }
    return selectedClassId ? stats.approved : 0;
  })();

  /* ── Auth redirect guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── Fetch admin record once auth is ready ── */
  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  /* ── Fetch data once school_id is known ── */
  useEffect(() => {
    if (schoolId) {
      fetchParentLinks();
      fetchClasses();
    }
  }, [schoolId, fetchParentLinks, fetchClasses]);

  /* ── Auto-dismiss success message ── */
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  /* ── Client-side search filter ── */
  const query = searchQuery.trim().toLowerCase();
  const filteredLinks = query
    ? parentLinks.filter(
        l =>
          l.parent_name.toLowerCase().includes(query) ||
          l.student_name.toLowerCase().includes(query)
      )
    : parentLinks;

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(filteredLinks.length / ITEMS_PER_PAGE));
  const paginatedLinks = filteredLinks.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  /* ══════════════════════════════════════════════════════════
     PAGE HEADER
  ══════════════════════════════════════════════════════════ */
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
      {/* Back button */}
      <button
        onClick={() => router.push('/school-admin')}
        className="flex items-center justify-center rounded-xl transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 flex-shrink-0"
        style={{
          minWidth: 44,
          minHeight: 44,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
          fontSize: '18px',
        }}
        aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस')}
      >
        ←
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1
          className="text-base font-bold text-[var(--text-1)] truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t(isHi, 'Parent Communications', 'अभिभावक संचार')}
        </h1>
      </div>

      {/* Language toggle */}
      <button
        onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
        className="flex items-center justify-center rounded-xl text-xs font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 flex-shrink-0"
        style={{
          minWidth: 44,
          minHeight: 44,
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

  /* ══════════════════════════════════════════════════════════
     TAB BAR
  ══════════════════════════════════════════════════════════ */
  const TabBar = (
    <div
      className="flex gap-1 rounded-xl p-1"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      role="tablist"
    >
      {(['links', 'message'] as TabFilter[]).map(tab => {
        const isActive = activeTab === tab;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: isActive ? 'var(--surface-1)' : 'transparent',
              color: isActive ? 'var(--text-1)' : 'var(--text-3)',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {tab === 'links'
              ? t(isHi, 'Parent Links', 'अभिभावक लिंक')
              : t(isHi, 'Send Message', 'संदेश भेजें')}
          </button>
        );
      })}
    </div>
  );

  /* ══════════════════════════════════════════════════════════
     FULL PAGE LOADING SKELETON
  ══════════════════════════════════════════════════════════ */
  if (isPageLoading) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        <header
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
          style={{
            background: 'rgba(251,248,244,0.94)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" width={44} height={44} rounded="rounded-xl" />
          <Skeleton variant="title" height={20} width="50%" className="flex-1" />
          <Skeleton variant="rect" width={44} height={44} rounded="rounded-xl" />
        </header>
        <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-3">
          <Skeleton variant="rect" height={40} rounded="rounded-xl" />
          <div className="grid grid-cols-3 gap-3">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
          <Skeleton variant="rect" height={44} rounded="rounded-xl" />
          {[1, 2, 3, 4].map(i => <ParentRowSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     ERROR STATE
  ══════════════════════════════════════════════════════════ */
  if (linksError && !loadingLinks && parentLinks.length === 0 && activeTab === 'links') {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        {PageHeader}
        <main className="px-4 pt-6 pb-24 max-w-2xl mx-auto">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">⚠</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{linksError}</p>
            <Button variant="primary" onClick={fetchParentLinks}>
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        </main>
        
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     LOADED STATE
  ══════════════════════════════════════════════════════════ */
  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {PageHeader}

      <main className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-4">

        {/* Tab bar */}
        {TabBar}

        {/* ════════════════════════════════════════════════════
           TAB 1: PARENT LINKS
        ════════════════════════════════════════════════════ */}
        {activeTab === 'links' && (
          <>
            {/* Stat cards */}
            {!loadingLinks && parentLinks.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  value={stats.total}
                  label={t(isHi, 'Total Parents', 'कुल अभिभावक')}
                  color="var(--purple)"
                />
                <StatCard
                  value={stats.approved}
                  label={t(isHi, 'Approved', 'स्वीकृत')}
                  color="var(--green)"
                />
                <StatCard
                  value={stats.pending}
                  label={t(isHi, 'Pending', 'लंबित')}
                  color="var(--orange)"
                />
              </div>
            )}

            {/* Search bar */}
            {(parentLinks.length > 0 || loadingLinks) && (
              <Input
                placeholder={t(isHi, 'Search by parent or student name', 'अभिभावक या छात्र के नाम से खोजें')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t(isHi, 'Search parent links', 'अभिभावक लिंक खोजें')}
                style={{ minHeight: 48 }}
              />
            )}

            {/* Loading skeleton */}
            {loadingLinks && (
              <div className="space-y-0">
                {[1, 2, 3, 4, 5].map(i => <ParentRowSkeleton key={i} />)}
              </div>
            )}

            {/* Parent links table */}
            {!loadingLinks && paginatedLinks.length > 0 && (
              <Card className="overflow-hidden">
                {/* Table header */}
                <div
                  className="grid gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider"
                  style={{
                    gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    background: 'var(--surface-2)',
                    color: 'var(--text-3)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span>{t(isHi, 'Parent / Student', 'अभिभावक / छात्र')}</span>
                  <span>{t(isHi, 'Grade', 'कक्षा')}</span>
                  <span>{t(isHi, 'Status', 'स्थिति')}</span>
                  <span>{t(isHi, 'Linked', 'जुड़ा')}</span>
                </div>

                {/* Table rows */}
                {paginatedLinks.map(link => (
                  <div
                    key={link.id}
                    className="grid gap-2 px-4 py-3 items-center"
                    style={{
                      gridTemplateColumns: '2fr 1fr 1fr 1fr',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {/* Parent / Student names — P13: don't log phone */}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-1)] truncate">
                        {link.parent_name}
                      </p>
                      <p className="text-xs text-[var(--text-3)] truncate mt-0.5">
                        {link.student_name}
                        {link.parent_phone && (
                          <span className="ml-2 text-[var(--text-3)]">
                            {link.parent_phone}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Grade — P5: always string */}
                    <span className="text-xs font-medium text-[var(--text-2)]">
                      {t(isHi, `Grade ${link.student_grade}`, `कक्षा ${link.student_grade}`)}
                    </span>

                    {/* Status badge */}
                    <Badge color={statusColor(link.status)} size="sm">
                      {statusLabel(isHi, link.status)}
                    </Badge>

                    {/* Linked date */}
                    <span className="text-xs text-[var(--text-3)]">
                      {formatDate(link.linked_at)}
                    </span>
                  </div>
                ))}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div
                    className="flex items-center justify-between px-4 py-3"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                      style={{
                        background: 'var(--surface-1)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-2)',
                        minHeight: 32,
                      }}
                    >
                      {t(isHi, 'Previous', 'पिछला')}
                    </button>
                    <span className="text-xs text-[var(--text-3)]">
                      {t(isHi, 'Page', 'पृष्ठ')} {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                      style={{
                        background: 'var(--surface-1)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-2)',
                        minHeight: 32,
                      }}
                    >
                      {t(isHi, 'Next', 'अगला')}
                    </button>
                  </div>
                )}
              </Card>
            )}

            {/* Search no results */}
            {!loadingLinks && parentLinks.length > 0 && filteredLinks.length === 0 && query && (
              <Card className="py-8 text-center">
                <p className="text-3xl mb-2" aria-hidden="true">🔍</p>
                <p className="text-sm font-semibold text-[var(--text-2)]">
                  {t(isHi, 'No results for', 'कोई परिणाम नहीं:')} &quot;{searchQuery}&quot;
                </p>
                <p className="text-xs text-[var(--text-3)] mt-1">
                  {t(isHi, 'Try a different name', 'दूसरा नाम खोजें')}
                </p>
              </Card>
            )}

            {/* Empty state: no parent links */}
            {!loadingLinks && parentLinks.length === 0 && (
              <EmptyState
                icon="👨‍👩‍👧"
                title={t(isHi, 'No parent links yet', 'अभी कोई अभिभावक लिंक नहीं')}
                description={t(
                  isHi,
                  'Parent-student links will appear here once parents sign up and connect with their children.',
                  'जब अभिभावक साइन अप करेंगे और अपने बच्चों से जुड़ेंगे तो लिंक यहाँ दिखेंगे।'
                )}
              />
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════
           TAB 2: SEND MESSAGE
        ════════════════════════════════════════════════════ */}
        {activeTab === 'message' && (
          <Card className="p-4 space-y-5">
            <h2
              className="text-sm font-bold text-[var(--text-1)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {t(isHi, 'Send Message to Parents', 'अभिभावकों को संदेश भेजें')}
            </h2>

            {/* Message (English) */}
            <div>
              <label
                className="block text-xs font-semibold mb-1.5"
                style={{ color: 'var(--text-2)' }}
              >
                {t(isHi, 'Message (English)', 'संदेश (अंग्रेज़ी)')} *
              </label>
              <textarea
                value={messageEn}
                onChange={(e) => setMessageEn(e.target.value)}
                placeholder={t(isHi, 'Type your message here...', 'यहाँ अपना संदेश लिखें...')}
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-1)',
                  color: 'var(--text-1)',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Message (Hindi) */}
            <div>
              <label
                className="block text-xs font-semibold mb-1.5"
                style={{ color: 'var(--text-2)' }}
              >
                {t(isHi, 'Message (Hindi, optional)', 'संदेश (हिंदी, वैकल्पिक)')}
              </label>
              <textarea
                value={messageHi}
                onChange={(e) => setMessageHi(e.target.value)}
                placeholder={t(isHi, 'Hindi message (optional)', 'हिंदी संदेश (वैकल्पिक)')}
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-1)',
                  color: 'var(--text-1)',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Target selection */}
            <div>
              <label
                className="block text-xs font-semibold mb-2"
                style={{ color: 'var(--text-2)' }}
              >
                {t(isHi, 'Target', 'लक्ष्य')}
              </label>
              <div className="space-y-2">
                {(['all', 'grade', 'class'] as TargetType[]).map(tt => (
                  <label
                    key={tt}
                    className="flex items-center gap-2 cursor-pointer select-none"
                  >
                    <input
                      type="radio"
                      name="target_type"
                      checked={targetType === tt}
                      onChange={() => setTargetType(tt)}
                      style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                    />
                    <span className="text-sm text-[var(--text-1)]">
                      {tt === 'all' && t(isHi, 'All parents', 'सभी अभिभावक')}
                      {tt === 'grade' && t(isHi, 'By grade', 'कक्षा के अनुसार')}
                      {tt === 'class' && t(isHi, 'By class', 'कक्षा समूह के अनुसार')}
                    </span>
                  </label>
                ))}
              </div>

              {/* Grade single-select — P5: grades as strings.
                  Backend takes ONE target_value, so this is single-select. */}
              {targetType === 'grade' && (
                <div className="mt-3 flex flex-wrap gap-2 pl-6">
                  {GRADE_VALUES.map(g => (
                    <label
                      key={g}
                      className="flex items-center gap-1.5 cursor-pointer select-none"
                    >
                      <input
                        type="radio"
                        name="target_grade"
                        checked={selectedGrade === g}
                        onChange={() => setSelectedGrade(g)}
                        style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                      />
                      <span className="text-xs font-medium text-[var(--text-2)]">
                        {t(isHi, `Grade ${g}`, `कक्षा ${g}`)}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {/* Class single-select */}
              {targetType === 'class' && classes.length > 0 && (
                <div
                  className="mt-3 ml-6"
                  style={{
                    maxHeight: 150,
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: '8px 12px',
                    background: 'var(--surface-1)',
                  }}
                >
                  {classes.map(cls => (
                    <label
                      key={cls.id}
                      className="flex items-center gap-2 py-1.5 cursor-pointer select-none"
                    >
                      <input
                        type="radio"
                        name="target_class"
                        checked={selectedClassId === cls.id}
                        onChange={() => setSelectedClassId(cls.id)}
                        style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                      />
                      <span className="text-xs font-medium text-[var(--text-2)]">
                        {cls.name} ({t(isHi, `Grade ${cls.grade}`, `कक्षा ${cls.grade}`)})
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Channel selection */}
            <div>
              <label
                className="block text-xs font-semibold mb-2"
                style={{ color: 'var(--text-2)' }}
              >
                {t(isHi, 'Channel', 'चैनल')}
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="channel"
                    checked={channel === 'notification'}
                    onChange={() => setChannel('notification')}
                    style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                  />
                  <span className="text-sm text-[var(--text-1)]">
                    {t(isHi, 'In-app notification', 'ऐप अधिसूचना')}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="channel"
                    checked={channel === 'email'}
                    onChange={() => setChannel('email')}
                    style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                  />
                  <span className="text-sm text-[var(--text-1)]">
                    {t(isHi, 'Email', 'ईमेल')}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="channel"
                    checked={channel === 'whatsapp'}
                    onChange={() => setChannel('whatsapp')}
                    style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                  />
                  <span className="text-sm text-[var(--text-1)]">WhatsApp</span>
                </label>
              </div>
            </div>

            {/* Send result display */}
            {sendResult && (
              <div
                className="rounded-xl p-4"
                style={{
                  background: 'rgba(22,163,74,0.06)',
                  border: '1px solid rgba(22,163,74,0.2)',
                }}
              >
                <p className="text-sm font-semibold" style={{ color: '#16A34A' }}>
                  {t(isHi, 'Message sent!', 'संदेश भेजा गया!')}
                </p>
                <p className="text-xs text-[var(--text-2)] mt-1">
                  {t(isHi, 'Sent:', 'भेजा गया:')} {sendResult.sent_count} &nbsp;|&nbsp;{' '}
                  {t(isHi, 'Failed:', 'विफल:')} {sendResult.failed_count}
                </p>
              </div>
            )}

            {/* Error display */}
            {linksError && activeTab === 'message' && (
              <p
                className="text-xs font-medium px-1"
                style={{ color: '#DC2626' }}
                role="alert"
              >
                {linksError}
              </p>
            )}

            {/* Send button — require a target_value when targeting a single
                grade/class so we never POST an invalid body (avoids a 400). */}
            <Button
              variant="primary"
              fullWidth
              disabled={
                !messageEn.trim() ||
                sendLoading ||
                (targetType === 'grade' && !selectedGrade) ||
                (targetType === 'class' && !selectedClassId)
              }
              onClick={() => setSendConfirmOpen(true)}
              style={{ minHeight: 48 }}
            >
              {t(isHi, 'Send Message', 'संदेश भेजें')}
            </Button>
          </Card>
        )}
      </main>

      {/* ── Send Confirmation Modal ── */}
      <SheetModal
        open={sendConfirmOpen}
        onClose={() => setSendConfirmOpen(false)}
        title={t(isHi, 'Confirm Send', 'भेजने की पुष्टि करें')}
      >
        <SendConfirm
          isHi={isHi}
          recipientCount={estimatedRecipients}
          channel={channel}
          onConfirm={handleSendMessage}
          onCancel={() => setSendConfirmOpen(false)}
          loading={sendLoading}
        />
      </SheetModal>

      {/* ── Success Toast ── */}
      {successMsg && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-2xl text-sm font-semibold text-white shadow-lg pointer-events-none animate-fade-in"
          style={{
            background: 'rgba(22,163,74,0.92)',
            backdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
          role="status"
          aria-live="polite"
        >
          {successMsg}
        </div>
      )}

      
    </div>
  );
}
