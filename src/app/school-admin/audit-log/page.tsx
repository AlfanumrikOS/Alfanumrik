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
  EmptyState,
  BottomNav,
} from '@/components/ui';

/* -----------------------------------------------------------------
   BILINGUAL HELPER (P7)
----------------------------------------------------------------- */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* -----------------------------------------------------------------
   TYPES
----------------------------------------------------------------- */
interface AuditEntry {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  actor_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/* -----------------------------------------------------------------
   CONSTANTS
----------------------------------------------------------------- */
const ACTION_TYPES = [
  { value: '', labelEn: 'All Actions', labelHi: 'सभी कार्य' },
  { value: 'teacher.invited', labelEn: 'Teacher Invited', labelHi: 'शिक्षक आमंत्रित' },
  { value: 'teacher.deactivated', labelEn: 'Teacher Deactivated', labelHi: 'शिक्षक निष्क्रिय' },
  { value: 'student.invited', labelEn: 'Student Invited', labelHi: 'छात्र आमंत्रित' },
  { value: 'student.deactivated', labelEn: 'Student Deactivated', labelHi: 'छात्र निष्क्रिय' },
  { value: 'branding.updated', labelEn: 'Branding Updated', labelHi: 'ब्रांडिंग अपडेट' },
  { value: 'announcement.published', labelEn: 'Announcement Published', labelHi: 'घोषणा प्रकाशित' },
  { value: 'exam.scheduled', labelEn: 'Exam Scheduled', labelHi: 'परीक्षा निर्धारित' },
  { value: 'content.approved', labelEn: 'Content Approved', labelHi: 'सामग्री स्वीकृत' },
  { value: 'api_key.generated', labelEn: 'API Key Generated', labelHi: 'API कुंजी बनाई' },
  { value: 'api_key.revoked', labelEn: 'API Key Revoked', labelHi: 'API कुंजी रद्द' },
  { value: 'data.exported', labelEn: 'Data Exported', labelHi: 'डेटा एक्सपोर्ट' },
  { value: 'settings.updated', labelEn: 'Settings Updated', labelHi: 'सेटिंग अपडेट' },
];

/* -----------------------------------------------------------------
   DATE HELPERS
----------------------------------------------------------------- */
function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actionColor(action: string): string {
  if (action.includes('invited')) return '#16A34A';
  if (action.includes('deactivated') || action.includes('revoked')) return '#DC2626';
  if (action.includes('published') || action.includes('approved')) return '#0891B2';
  if (action.includes('exported')) return '#7C3AED';
  if (action.includes('generated')) return '#F97316';
  return 'var(--text-2)';
}

function actionLabel(action: string, isHi: boolean): string {
  const match = ACTION_TYPES.find((a) => a.value === action);
  if (match) return isHi ? match.labelHi : match.labelEn;
  return action;
}

/* -----------------------------------------------------------------
   SKELETON
----------------------------------------------------------------- */
function TableSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton variant="title" height={16} width="40%" />
              <Skeleton variant="text" height={12} width="60%" />
            </div>
            <Skeleton variant="rect" height={20} width={80} rounded="rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------------
   METADATA DISPLAY
   Shows metadata JSON formatted nicely in an expandable area
----------------------------------------------------------------- */
interface MetadataDisplayProps {
  metadata: Record<string, unknown>;
  isHi: boolean;
}

function MetadataDisplay({ metadata, isHi }: MetadataDisplayProps) {
  const entries = Object.entries(metadata).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  );

  if (entries.length === 0) {
    return (
      <p className="text-xs italic" style={{ color: 'var(--text-3)' }}>
        {t(isHi, 'No additional details', 'कोई अतिरिक्त विवरण नहीं')}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <span className="font-semibold" style={{ color: 'var(--text-2)', minWidth: '100px' }}>
            {key.replace(/_/g, ' ')}:
          </span>
          <span style={{ color: 'var(--text-3)', wordBreak: 'break-all' }}>
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------------
   AUDIT ENTRY ROW
----------------------------------------------------------------- */
interface AuditRowProps {
  entry: AuditEntry;
  isHi: boolean;
}

function AuditRow({ entry, isHi }: AuditRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-0 bg-transparent border-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 rounded-2xl"
        aria-expanded={expanded}
        aria-label={t(
          isHi,
          `Toggle details for ${entry.action}`,
          `${entry.action} के विवरण टॉगल करें`
        )}
      >
        {/* Main row content */}
        <div className="flex items-start gap-3">
          {/* Time column */}
          <div className="flex-shrink-0" style={{ minWidth: '110px' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              {formatDateTime(entry.created_at)}
            </p>
          </div>

          {/* Actor */}
          <div className="flex-shrink-0" style={{ minWidth: '100px' }}>
            <p className="text-xs font-semibold text-[var(--text-1)] truncate">
              {entry.actor_name}
            </p>
          </div>

          {/* Action badge */}
          <div className="flex-1 min-w-0">
            <Badge color={actionColor(entry.action)} size="sm">
              {actionLabel(entry.action, isHi)}
            </Badge>
          </div>

          {/* Resource */}
          <div className="flex-shrink-0 text-right" style={{ maxWidth: '120px' }}>
            {entry.resource_type && (
              <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                {entry.resource_type}
                {entry.resource_id ? ` #${entry.resource_id.slice(0, 8)}` : ''}
              </p>
            )}
          </div>

          {/* Expand indicator */}
          <span
            className="text-xs flex-shrink-0 transition-transform"
            style={{
              color: 'var(--text-3)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
            aria-hidden="true"
          >
            v
          </span>
        </div>
      </button>

      {/* Expanded metadata */}
      {expanded && (
        <div
          className="mt-3 pt-3"
          style={{
            borderTop: '1px solid var(--border)',
          }}
        >
          <p
            className="text-xs font-semibold mb-2"
            style={{ color: 'var(--text-2)' }}
          >
            {t(isHi, 'Details', 'विवरण')}
          </p>
          <MetadataDisplay metadata={entry.metadata} isHi={isHi} />
        </div>
      )}
    </Card>
  );
}

/* -----------------------------------------------------------------
   MAIN PAGE
----------------------------------------------------------------- */
export default function SchoolAdminAuditLogPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* State */
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, limit: 25, total: 0, total_pages: 0,
  });
  const [loadingPage, setLoadingPage] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  /* Filters */
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  /* Auth guard */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* Verify this user is a school admin */
  const [isSchoolAdmin, setIsSchoolAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authUserId) return;

    (async () => {
      const { data } = await supabase
        .from('school_admins')
        .select('school_id')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .maybeSingle();

      if (!data) {
        router.replace('/login');
        return;
      }

      setIsSchoolAdmin(true);
    })();
  }, [authUserId, router]);

  /* Fetch audit log */
  const fetchAuditLog = useCallback(
    async (page: number = 1) => {
      setLoadingPage(true);
      setPageError(null);

      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', '25');
        if (actionFilter) params.set('action', actionFilter);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);

        const res = await fetch(`/api/school-admin/audit-log?${params.toString()}`, {
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }

        const resBody = await res.json();
        setEntries(resBody.data?.entries ?? []);
        setPagination(
          resBody.data?.pagination ?? { page: 1, limit: 25, total: 0, total_pages: 0 }
        );
      } catch (err: unknown) {
        setPageError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoadingPage(false);
      }
    },
    [actionFilter, dateFrom, dateTo]
  );

  useEffect(() => {
    if (isSchoolAdmin) {
      fetchAuditLog(1);
    }
  }, [isSchoolAdmin, fetchAuditLog]);

  /* Loading state */
  if (authLoading || isSchoolAdmin === null) {
    return (
      <div
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{
            background: 'rgba(251,248,244,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" height={36} width={36} rounded="rounded-xl" />
          <Skeleton variant="title" height={22} width="45%" />
        </div>
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-24">
          <TableSkeleton />
        </div>
      </div>
    );
  }

  /* Error state */
  if (pageError) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <Card className="max-w-xs w-full text-center py-8">
          <div className="text-4xl mb-3">Warning</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{pageError}</p>
          <Button
            variant="primary"
            onClick={() => {
              setPageError(null);
              fetchAuditLog(pagination.page);
            }}
          >
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  /* Main render */
  return (
    <div
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      style={{ background: 'var(--bg)' }}
    >
      {/* ---- STICKY HEADER ---- */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Back button */}
        <button
          onClick={() => router.push('/school-admin')}
          className="rounded-xl flex items-center justify-center transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '18px',
          }}
          aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस जाएं')}
        >
          &larr;
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1
            className="text-base font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'Audit Log', 'ऑडिट लॉग')}
          </h1>
        </div>

        {/* Language toggle */}
        <button
          onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-2)',
            minHeight: '36px',
          }}
          aria-label={isHi ? 'Switch to English' : 'Switch to Hindi'}
        >
          {isHi ? 'EN' : '\u0939\u093F'}
        </button>
      </header>

      {/* ---- PAGE BODY ---- */}
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-24">

        {/* ---- FILTER BAR ---- */}
        <section
          className="mb-4 space-y-3"
          aria-label={t(isHi, 'Filters', 'फ़िल्टर')}
        >
          {/* Action type dropdown */}
          <div>
            <label
              htmlFor="action-filter"
              className="text-xs font-semibold block mb-1"
              style={{ color: 'var(--text-2)' }}
            >
              {t(isHi, 'Action Type', 'कार्य प्रकार')}
            </label>
            <select
              id="action-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
                minHeight: '44px',
              }}
            >
              {ACTION_TYPES.map((at) => (
                <option key={at.value} value={at.value}>
                  {isHi ? at.labelHi : at.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="date-from"
                className="text-xs font-semibold block mb-1"
                style={{ color: 'var(--text-2)' }}
              >
                {t(isHi, 'From', 'से')}
              </label>
              <input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                  minHeight: '44px',
                }}
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="date-to"
                className="text-xs font-semibold block mb-1"
                style={{ color: 'var(--text-2)' }}
              >
                {t(isHi, 'To', 'तक')}
              </label>
              <input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                  minHeight: '44px',
                }}
              />
            </div>
          </div>

          {/* Apply filters button */}
          <Button
            variant="primary"
            size="sm"
            fullWidth
            onClick={() => fetchAuditLog(1)}
          >
            {t(isHi, 'Apply Filters', 'फ़िल्टर लागू करें')}
          </Button>
        </section>

        {/* ---- RESULTS ---- */}
        {loadingPage ? (
          <TableSkeleton />
        ) : entries.length === 0 ? (
          <EmptyState
            icon="(i)"
            title={t(isHi, 'No audit entries found', 'कोई ऑडिट प्रविष्टि नहीं मिली')}
            description={t(
              isHi,
              'Audit log entries will appear here as admin actions are performed.',
              'व्यवस्थापक कार्यों के होने पर ऑडिट लॉग प्रविष्टियाँ यहाँ दिखाई देंगी।'
            )}
          />
        ) : (
          <>
            {/* Total count */}
            <p
              className="text-xs font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              {t(isHi, `${pagination.total} entries`, `${pagination.total} प्रविष्टियाँ`)}
            </p>

            {/* Entry list */}
            <div className="space-y-2">
              {entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} isHi={isHi} />
              ))}
            </div>

            {/* Pagination */}
            {pagination.total_pages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchAuditLog(pagination.page - 1)}
                >
                  {t(isHi, 'Previous', 'पिछला')}
                </Button>

                <span className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
                  {t(
                    isHi,
                    `Page ${pagination.page} of ${pagination.total_pages}`,
                    `पृष्ठ ${pagination.page} / ${pagination.total_pages}`
                  )}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pagination.page >= pagination.total_pages}
                  onClick={() => fetchAuditLog(pagination.page + 1)}
                >
                  {t(isHi, 'Next', 'अगला')}
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ---- BOTTOM NAV ---- */}
      <BottomNav />
    </div>
  );
}
