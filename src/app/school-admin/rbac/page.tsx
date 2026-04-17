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
type TabKey = 'dashboard' | 'elevations' | 'delegations' | 'approvals';

interface DashboardStats {
  activeElevations: number;
  activeDelegations: number;
  pendingApprovals: number;
}

interface ElevationRecord {
  id: string;
  user_id: string;
  user_email?: string;
  role_id: string;
  role_name?: string;
  granted_by: string;
  reason: string;
  status: string;
  expires_at: string;
  created_at: string;
}

interface DelegationRecord {
  id: string;
  granter: string;
  grantee: string | null;
  permissions: string[];
  status: string;
  token?: string;
  use_count: number;
  max_uses: number | null;
  expires_at: string;
  created_at: string;
}

interface ApprovalRecord {
  id: string;
  request_type: string;
  requested_by: string;
  requester_email?: string;
  description: string;
  status: string;
  created_at: string;
}

/* -----------------------------------------------------------------
   HELPERS
----------------------------------------------------------------- */
function relativeTime(dateStr: string): string {
  if (!dateStr) return '\u2014';
  const now = Date.now();
  const target = new Date(dateStr).getTime();
  const diff = target - now;
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (absDiff < 60000) return diff >= 0 ? 'in <1m' : '<1m ago';
  if (minutes < 60) return diff >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  if (hours < 24) return diff >= 0 ? `in ${hours}h` : `${hours}h ago`;
  return diff >= 0 ? `in ${days}d` : `${days}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'active': return '#16A34A';
    case 'pending': return '#F97316';
    case 'expired': case 'ended': return '#6B7280';
    case 'revoked': case 'rejected': return '#DC2626';
    case 'approved': return '#16A34A';
    default: return '#6B7280';
  }
}

function truncateId(id: string | undefined | null): string {
  if (!id) return '\u2014';
  return id.length > 12 ? id.slice(0, 12) + '\u2026' : id;
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* -----------------------------------------------------------------
   SKELETON LOADING
----------------------------------------------------------------- */
function PageSkeleton() {
  return (
    <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between mb-2">
        <Skeleton variant="title" height={28} width="55%" />
        <Skeleton variant="rect" height={32} width={64} rounded="rounded-xl" />
      </div>
      {/* Tab bar skeleton */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="rect" height={36} width={100} rounded="rounded-xl" />
        ))}
      </div>
      {/* Stat cards row */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rect" height={96} rounded="rounded-2xl" />
        ))}
      </div>
      {/* Table rows */}
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="rect" height={56} rounded="rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
   MAIN PAGE
----------------------------------------------------------------- */
export default function SchoolAdminRBACPage() {
  const router = useRouter();
  const auth = useAuth();
  const { authUserId, isLoading: authLoading, isHi, signOut } = auth;

  /* ── School admin state ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [adminName, setAdminName] = useState('');
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Tab state ── */
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');

  /* ── Data state ── */
  const [stats, setStats] = useState<DashboardStats>({
    activeElevations: 0,
    activeDelegations: 0,
    pendingApprovals: 0,
  });
  const [elevations, setElevations] = useState<ElevationRecord[]>([]);
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  /* ── Message toast ── */
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  /* ── Form visibility ── */
  const [showElevationForm, setShowElevationForm] = useState(false);
  const [showDelegationForm, setShowDelegationForm] = useState(false);
  const [newTokenDisplay, setNewTokenDisplay] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  /* ── Elevation form fields ── */
  const [elevUserId, setElevUserId] = useState('');
  const [elevRoleId, setElevRoleId] = useState('');
  const [elevDuration, setElevDuration] = useState('24');
  const [elevReason, setElevReason] = useState('');

  /* ── Delegation form fields ── */
  const [delPermissions, setDelPermissions] = useState('');
  const [delMaxUses, setDelMaxUses] = useState('');
  const [delDuration, setDelDuration] = useState('72');

  const showMsg = useCallback((text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  /* ── Fetch school admin record ── */
  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);
    setError(null);

    const { data, error: dbErr } = await supabase
      .from('school_admins')
      .select('school_id, name, email, role')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (dbErr) {
      setError(dbErr.message);
      setLoadingAdmin(false);
      return;
    }

    if (!data) {
      setError(t(isHi, 'You must be a school administrator to access this page.', 'इस पेज तक पहुंचने के लिए आपको स्कूल प्रशासक होना चाहिए।'));
      setLoadingAdmin(false);
      return;
    }

    setSchoolId(data.school_id);
    setAdminName(data.name?.split(' ')[0] ?? data.name ?? '');
    setLoadingAdmin(false);
  }, [authUserId, isHi]);

  /* ── API fetch helper ── */
  const apiFetch = useCallback(async (url: string, options?: RequestInit) => {
    return fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  }, []);

  /* ── Data fetchers ── */
  const fetchStats = useCallback(async () => {
    if (!schoolId) return;
    setLoadingData(true);
    try {
      const res = await apiFetch(`/api/school-admin/rbac?action=dashboard_stats&school_id=${schoolId}`);
      if (res.ok) {
        const d = await res.json();
        setStats(d.data || { activeElevations: 0, activeDelegations: 0, pendingApprovals: 0 });
      }
    } catch { /* swallow */ }
    setLoadingData(false);
  }, [schoolId, apiFetch]);

  const fetchElevations = useCallback(async () => {
    if (!schoolId) return;
    setLoadingData(true);
    try {
      const res = await apiFetch(`/api/school-admin/rbac?action=elevations&school_id=${schoolId}`);
      if (res.ok) {
        const d = await res.json();
        setElevations(d.data || []);
      }
    } catch { /* swallow */ }
    setLoadingData(false);
  }, [schoolId, apiFetch]);

  const fetchDelegations = useCallback(async () => {
    if (!schoolId) return;
    setLoadingData(true);
    try {
      const res = await apiFetch(`/api/school-admin/rbac?action=delegations&school_id=${schoolId}`);
      if (res.ok) {
        const d = await res.json();
        setDelegations(d.data || []);
      }
    } catch { /* swallow */ }
    setLoadingData(false);
  }, [schoolId, apiFetch]);

  const fetchApprovals = useCallback(async () => {
    if (!schoolId) return;
    setLoadingData(true);
    try {
      const res = await apiFetch(`/api/school-admin/rbac?action=approvals&school_id=${schoolId}`);
      if (res.ok) {
        const d = await res.json();
        setApprovals(d.data || []);
      }
    } catch { /* swallow */ }
    setLoadingData(false);
  }, [schoolId, apiFetch]);

  /* ── Actions ── */
  const grantElevation = async () => {
    if (!elevUserId || !elevRoleId || !elevReason) {
      showMsg(t(isHi, 'User ID, Role ID, and Reason are required.', 'उपयोगकर्ता ID, भूमिका ID और कारण आवश्यक हैं।'), 'error');
      return;
    }
    try {
      const res = await apiFetch('/api/school-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({
          action: 'grant_elevation',
          school_id: schoolId,
          userId: elevUserId,
          roleId: elevRoleId,
          durationHours: Number(elevDuration) || 24,
          reason: elevReason,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(t(isHi, 'Elevation granted successfully.', 'अधिकार सफलतापूर्वक दिए गए।'), 'success');
        setElevUserId(''); setElevRoleId(''); setElevDuration('24'); setElevReason('');
        setShowElevationForm(false);
        fetchElevations();
      } else {
        showMsg(d.error || t(isHi, 'Failed to grant elevation.', 'अधिकार देने में विफल।'), 'error');
      }
    } catch {
      showMsg(t(isHi, 'Request failed.', 'अनुरोध विफल।'), 'error');
    }
  };

  const revokeElevation = async (elevationId: string) => {
    try {
      const res = await apiFetch('/api/school-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke_elevation', school_id: schoolId, elevationId }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(t(isHi, 'Elevation revoked.', 'अधिकार रद्द किया गया।'), 'success');
        fetchElevations();
      } else {
        showMsg(d.error || t(isHi, 'Failed to revoke.', 'रद्द करने में विफल।'), 'error');
      }
    } catch {
      showMsg(t(isHi, 'Request failed.', 'अनुरोध विफल।'), 'error');
    }
  };

  const createDelegation = async () => {
    if (!delPermissions.trim()) {
      showMsg(t(isHi, 'Permissions are required.', 'अनुमतियां आवश्यक हैं।'), 'error');
      return;
    }
    try {
      const permissions = delPermissions.split(',').map(p => p.trim()).filter(Boolean);
      const res = await apiFetch('/api/school-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_delegation',
          school_id: schoolId,
          permissions,
          maxUses: delMaxUses ? Number(delMaxUses) : null,
          durationHours: Number(delDuration) || 72,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(t(isHi, 'Delegation token created.', 'प्रतिनिधि टोकन बनाया गया।'), 'success');
        if (d.data?.token) {
          setNewTokenDisplay(d.data.token);
          setTokenCopied(false);
        }
        setDelPermissions(''); setDelMaxUses(''); setDelDuration('72');
        setShowDelegationForm(false);
        fetchDelegations();
      } else {
        showMsg(d.error || t(isHi, 'Failed to create token.', 'टोकन बनाने में विफल।'), 'error');
      }
    } catch {
      showMsg(t(isHi, 'Request failed.', 'अनुरोध विफल।'), 'error');
    }
  };

  const revokeDelegation = async (tokenId: string) => {
    try {
      const res = await apiFetch('/api/school-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke_delegation', school_id: schoolId, tokenId }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(t(isHi, 'Delegation revoked.', 'प्रतिनिधि रद्द किया गया।'), 'success');
        fetchDelegations();
      } else {
        showMsg(d.error || t(isHi, 'Failed to revoke.', 'रद्द करने में विफल।'), 'error');
      }
    } catch {
      showMsg(t(isHi, 'Request failed.', 'अनुरोध विफल।'), 'error');
    }
  };

  const handleApproval = async (approvalId: string, decision: 'approve' | 'reject') => {
    try {
      const res = await apiFetch('/api/school-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({
          action: decision === 'approve' ? 'approve_request' : 'reject_request',
          school_id: schoolId,
          approvalId,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(
          decision === 'approve'
            ? t(isHi, 'Request approved.', 'अनुरोध स्वीकृत।')
            : t(isHi, 'Request rejected.', 'अनुरोध अस्वीकृत।'),
          'success'
        );
        fetchApprovals();
      } else {
        showMsg(d.error || t(isHi, 'Action failed.', 'कार्य विफल।'), 'error');
      }
    } catch {
      showMsg(t(isHi, 'Request failed.', 'अनुरोध विफल।'), 'error');
    }
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // Fallback: select the text in the display
      showMsg(t(isHi, 'Could not copy. Please select and copy manually.', 'कॉपी नहीं हो सका। कृपया मैनुअली चुनें और कॉपी करें।'), 'error');
    }
  };

  /* ── Effects ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  useEffect(() => {
    if (!schoolId) return;
    switch (activeTab) {
      case 'dashboard': fetchStats(); break;
      case 'elevations': fetchElevations(); break;
      case 'delegations': fetchDelegations(); break;
      case 'approvals': fetchApprovals(); break;
    }
  }, [activeTab, schoolId, fetchStats, fetchElevations, fetchDelegations, fetchApprovals]);

  /* ── Tab config ── */
  const tabs: { key: TabKey; labelEn: string; labelHi: string }[] = [
    { key: 'dashboard', labelEn: 'Dashboard', labelHi: 'डैशबोर्ड' },
    { key: 'elevations', labelEn: 'Elevations', labelHi: 'अधिकार' },
    { key: 'delegations', labelEn: 'Delegations', labelHi: 'प्रतिनिधि' },
    { key: 'approvals', labelEn: 'Approvals', labelHi: 'अनुमोदन' },
  ];

  /* ── Render: Loading ── */
  if (authLoading || loadingAdmin) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
        <div
          className="sticky top-0 z-10 px-4 py-3"
          style={{
            background: 'rgba(251,248,244,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="title" height={24} width="50%" />
        </div>
        <PageSkeleton />
      </div>
    );
  }

  /* ── Render: Error / Not admin ── */
  if (error) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh flex items-center justify-center px-4">
        <Card className="max-w-xs w-full text-center py-8">
          <div className="text-4xl mb-3" aria-hidden="true">&#x26A0;&#xFE0F;</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{error}</p>
          <Button variant="primary" onClick={() => fetchAdminRecord()}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  if (!schoolId) return null;

  /* ── Render: Page ── */
  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {/* ═══ STICKY HEADER ═══ */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/school-admin')}
            className="text-sm text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors p-1"
            aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस जाएं')}
          >
            &larr;
          </button>
          <div>
            <h1 className="text-base font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
              {t(isHi, 'RBAC Management', 'RBAC प्रबंधन')}
            </h1>
            <p className="text-xs text-[var(--text-3)] mt-0.5">
              {t(isHi, 'Roles, elevations & delegations', 'भूमिकाएं, अधिकार और प्रतिनिधि')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => auth.setLanguage && auth.setLanguage(isHi ? 'en' : 'hi')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              minHeight: '36px',
            }}
            aria-label={isHi ? 'Switch to English' : 'Switch to Hindi'}
          >
            {isHi ? 'EN' : 'HI'}
          </button>
        </div>
      </header>

      {/* ═══ PAGE BODY ═══ */}
      <main className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-5">

        {/* Inline toast */}
        {message && (
          <div
            className="rounded-xl px-4 py-3 text-sm font-medium"
            style={{
              background: message.type === 'success' ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
              border: `1px solid ${message.type === 'success' ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)'}`,
              color: message.type === 'success' ? '#16A34A' : '#DC2626',
            }}
            role="alert"
          >
            {message.text}
          </div>
        )}

        {/* New token display banner */}
        {newTokenDisplay && (
          <Card accent="#F97316">
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-lg" aria-hidden="true">&#x26A0;&#xFE0F;</span>
                <div>
                  <p className="text-sm font-bold text-[var(--text-1)]">
                    {t(isHi, 'Save this token now!', 'इस टोकन को अभी सेव करें!')}
                  </p>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">
                    {t(isHi, "It won't be shown again.", 'यह दोबारा नहीं दिखाया जाएगा।')}
                  </p>
                </div>
              </div>
              <div
                className="rounded-lg p-3 break-all text-xs font-mono"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                }}
              >
                {newTokenDisplay}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => copyToken(newTokenDisplay)}
                >
                  {tokenCopied
                    ? t(isHi, 'Copied!', 'कॉपी किया!')
                    : t(isHi, 'Copy Token', 'टोकन कॉपी करें')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setNewTokenDisplay(null); setTokenCopied(false); }}
                >
                  {t(isHi, 'Dismiss', 'बंद करें')}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Tab bar ── */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all active:scale-95 flex-shrink-0"
              style={{
                background: activeTab === tab.key ? 'rgba(249,115,22,0.1)' : 'transparent',
                border: activeTab === tab.key ? '1.5px solid rgba(249,115,22,0.3)' : '1.5px solid transparent',
                color: activeTab === tab.key ? '#F97316' : 'var(--text-3)',
              }}
            >
              {t(isHi, tab.labelEn, tab.labelHi)}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════
            TAB: DASHBOARD
        ═══════════════════════════════════════ */}
        {activeTab === 'dashboard' && (
          <section aria-label={t(isHi, 'RBAC Overview', 'RBAC अवलोकन')}>
            <div className="grid grid-cols-3 gap-3">
              {/* Active Elevations */}
              <Card accent="#F97316">
                <div className="text-center py-2">
                  <div
                    className="text-2xl font-bold font-['Sora',system-ui,sans-serif]"
                    style={{ color: '#F97316' }}
                  >
                    {loadingData ? '\u2014' : stats.activeElevations}
                  </div>
                  <p className="text-xs font-semibold text-[var(--text-3)] mt-1">
                    {t(isHi, 'Active Elevations', 'सक्रिय अधिकार')}
                  </p>
                </div>
              </Card>

              {/* Active Delegations */}
              <Card accent="#7C3AED">
                <div className="text-center py-2">
                  <div
                    className="text-2xl font-bold font-['Sora',system-ui,sans-serif]"
                    style={{ color: '#7C3AED' }}
                  >
                    {loadingData ? '\u2014' : stats.activeDelegations}
                  </div>
                  <p className="text-xs font-semibold text-[var(--text-3)] mt-1">
                    {t(isHi, 'Active Delegations', 'सक्रिय प्रतिनिधि')}
                  </p>
                </div>
              </Card>

              {/* Pending Approvals */}
              <Card accent="#0891B2">
                <div className="text-center py-2">
                  <div
                    className="text-2xl font-bold font-['Sora',system-ui,sans-serif]"
                    style={{ color: '#0891B2' }}
                  >
                    {loadingData ? '\u2014' : stats.pendingApprovals}
                  </div>
                  <p className="text-xs font-semibold text-[var(--text-3)] mt-1">
                    {t(isHi, 'Pending Approvals', 'लंबित अनुमोदन')}
                  </p>
                </div>
              </Card>
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════
            TAB: ELEVATIONS
        ═══════════════════════════════════════ */}
        {activeTab === 'elevations' && (
          <section aria-label={t(isHi, 'Role Elevations', 'भूमिका अधिकार')}>
            {/* Action button */}
            <div className="flex justify-end mb-3">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowElevationForm(!showElevationForm)}
              >
                {showElevationForm
                  ? t(isHi, 'Cancel', 'रद्द करें')
                  : t(isHi, '+ Grant Elevation', '+ अधिकार दें')}
              </Button>
            </div>

            {/* Grant Elevation form */}
            {showElevationForm && (
              <Card accent="#F97316" className="mb-4">
                <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">
                  {t(isHi, 'Grant Elevation', 'अधिकार दें')}
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--text-3)] mb-1 block font-medium">
                      {t(isHi, 'User ID', 'उपयोगकर्ता ID')}
                    </label>
                    <input
                      value={elevUserId}
                      onChange={e => setElevUserId(e.target.value)}
                      placeholder="UUID"
                      className="input-base w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-3)] mb-1 block font-medium">
                      {t(isHi, 'Role ID', 'भूमिका ID')}
                    </label>
                    <input
                      value={elevRoleId}
                      onChange={e => setElevRoleId(e.target.value)}
                      placeholder="UUID"
                      className="input-base w-full"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[var(--text-3)] mb-1 block font-medium">
                        {t(isHi, 'Duration (hours)', 'अवधि (घंटे)')}
                      </label>
                      <input
                        type="number"
                        value={elevDuration}
                        onChange={e => setElevDuration(e.target.value)}
                        min="1"
                        max="720"
                        className="input-base w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-3)] mb-1 block font-medium">
                        {t(isHi, 'Reason', 'कारण')}
                      </label>
                      <input
                        value={elevReason}
                        onChange={e => setElevReason(e.target.value)}
                        placeholder={t(isHi, 'Justification', 'औचित्य')}
                        className="input-base w-full"
                      />
                    </div>
                  </div>
                  <Button variant="primary" size="sm" onClick={grantElevation}>
                    {t(isHi, 'Grant', 'प्रदान करें')}
                  </Button>
                </div>
              </Card>
            )}

            {/* Elevations table */}
            {loadingData ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} variant="rect" height={72} rounded="rounded-xl" />
                ))}
              </div>
            ) : elevations.length === 0 ? (
              <EmptyState
                icon="&#x1F512;"
                title={t(isHi, 'No elevations', 'कोई अधिकार नहीं')}
                description={t(isHi, 'No role elevations found for this school.', 'इस स्कूल के लिए कोई भूमिका अधिकार नहीं मिले।')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'User', 'उपयोगकर्ता')}
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Role', 'भूमिका')}
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Status', 'स्थिति')}
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Expires', 'समाप्ति')}
                      </th>
                      <th className="text-right py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Actions', 'कार्य')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {elevations.map((elev) => (
                      <tr
                        key={elev.id}
                        className="border-b last:border-b-0"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <td className="py-3 px-2">
                          <div className="text-xs font-mono text-[var(--text-2)]">
                            {elev.user_email || truncateId(elev.user_id)}
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <span className="text-xs text-[var(--text-2)]">
                            {elev.role_name || truncateId(elev.role_id)}
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          <Badge color={statusColor(elev.status)}>
                            {elev.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-2">
                          <span className="text-xs text-[var(--text-3)]">
                            {relativeTime(elev.expires_at)}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right">
                          {elev.status === 'active' ? (
                            <button
                              onClick={() => revokeElevation(elev.id)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                              style={{
                                color: '#DC2626',
                                background: 'rgba(220,38,38,0.06)',
                                border: '1px solid rgba(220,38,38,0.15)',
                              }}
                            >
                              {t(isHi, 'Revoke', 'रद्द करें')}
                            </button>
                          ) : (
                            <span className="text-xs text-[var(--text-3)]">\u2014</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ═══════════════════════════════════════
            TAB: DELEGATIONS
        ═══════════════════════════════════════ */}
        {activeTab === 'delegations' && (
          <section aria-label={t(isHi, 'Delegation Tokens', 'प्रतिनिधि टोकन')}>
            {/* Action button */}
            <div className="flex justify-end mb-3">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowDelegationForm(!showDelegationForm)}
              >
                {showDelegationForm
                  ? t(isHi, 'Cancel', 'रद्द करें')
                  : t(isHi, '+ Create Token', '+ टोकन बनाएं')}
              </Button>
            </div>

            {/* Create Delegation Token form */}
            {showDelegationForm && (
              <Card accent="#7C3AED" className="mb-4">
                <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">
                  {t(isHi, 'Create Delegation Token', 'प्रतिनिधि टोकन बनाएं')}
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--text-3)] mb-1 block font-medium">
                      {t(isHi, 'Permissions (comma-separated)', 'अनुमतियां (कॉमा से अलग)')}
                    </label>
                    <input
                      value={delPermissions}
                      onChange={e => setDelPermissions(e.target.value)}
                      placeholder="teacher.view, student.view"
                      className="input-base w-full"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[var(--text-3)] mb-1 block font-medium">
                        {t(isHi, 'Max Uses (optional)', 'अधिकतम उपयोग (वैकल्पिक)')}
                      </label>
                      <input
                        type="number"
                        value={delMaxUses}
                        onChange={e => setDelMaxUses(e.target.value)}
                        min="1"
                        placeholder="\u221E"
                        className="input-base w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-3)] mb-1 block font-medium">
                        {t(isHi, 'Duration (hours)', 'अवधि (घंटे)')}
                      </label>
                      <input
                        type="number"
                        value={delDuration}
                        onChange={e => setDelDuration(e.target.value)}
                        min="1"
                        max="720"
                        className="input-base w-full"
                      />
                    </div>
                  </div>
                  <Button variant="primary" size="sm" onClick={createDelegation}>
                    {t(isHi, 'Create Token', 'टोकन बनाएं')}
                  </Button>
                </div>
              </Card>
            )}

            {/* Delegations table */}
            {loadingData ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} variant="rect" height={72} rounded="rounded-xl" />
                ))}
              </div>
            ) : delegations.length === 0 ? (
              <EmptyState
                icon="&#x1F511;"
                title={t(isHi, 'No delegation tokens', 'कोई प्रतिनिधि टोकन नहीं')}
                description={t(isHi, 'No delegation tokens found for this school.', 'इस स्कूल के लिए कोई प्रतिनिधि टोकन नहीं मिले।')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Permissions', 'अनुमतियां')}
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Status', 'स्थिति')}
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Uses', 'उपयोग')}
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Expires', 'समाप्ति')}
                      </th>
                      <th className="text-right py-2 px-2 text-xs font-semibold text-[var(--text-3)]">
                        {t(isHi, 'Actions', 'कार्य')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {delegations.map((del) => (
                      <tr
                        key={del.id}
                        className="border-b last:border-b-0"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <td className="py-3 px-2">
                          <div className="flex flex-wrap gap-1">
                            {Array.isArray(del.permissions) && del.permissions.length > 0 ? (
                              del.permissions.map((p) => (
                                <Badge key={p} color="#7C3AED" size="sm">{p}</Badge>
                              ))
                            ) : (
                              <span className="text-xs text-[var(--text-3)]">\u2014</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <Badge color={statusColor(del.status)}>
                            {del.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-2">
                          <span className="text-xs text-[var(--text-2)]">
                            {del.use_count ?? 0}{del.max_uses != null ? `/${del.max_uses}` : ''}
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          <span className="text-xs text-[var(--text-3)]">
                            {relativeTime(del.expires_at)}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right">
                          {del.status === 'active' ? (
                            <button
                              onClick={() => revokeDelegation(del.id)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                              style={{
                                color: '#DC2626',
                                background: 'rgba(220,38,38,0.06)',
                                border: '1px solid rgba(220,38,38,0.15)',
                              }}
                            >
                              {t(isHi, 'Revoke', 'रद्द करें')}
                            </button>
                          ) : (
                            <span className="text-xs text-[var(--text-3)]">\u2014</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ═══════════════════════════════════════
            TAB: APPROVALS
        ═══════════════════════════════════════ */}
        {activeTab === 'approvals' && (
          <section aria-label={t(isHi, 'Pending Approvals', 'लंबित अनुमोदन')}>
            {loadingData ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} variant="rect" height={80} rounded="rounded-xl" />
                ))}
              </div>
            ) : approvals.length === 0 ? (
              <EmptyState
                icon="&#x2705;"
                title={t(isHi, 'No pending approvals', 'कोई लंबित अनुमोदन नहीं')}
                description={t(isHi, 'All approval requests have been handled.', 'सभी अनुमोदन अनुरोध संभाल लिए गए हैं।')}
              />
            ) : (
              <div className="space-y-3">
                {approvals.map((appr) => (
                  <Card key={appr.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge color={statusColor(appr.status)}>
                            {appr.status}
                          </Badge>
                          <span className="text-xs text-[var(--text-3)]">
                            {appr.request_type}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--text-1)] font-medium truncate">
                          {appr.description}
                        </p>
                        <p className="text-xs text-[var(--text-3)] mt-1">
                          {t(isHi, 'Requested by', 'द्वारा अनुरोधित')}: {appr.requester_email || truncateId(appr.requested_by)}
                          {' '}&middot;{' '}
                          {formatDateTime(appr.created_at)}
                        </p>
                      </div>

                      {appr.status === 'pending' && (
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleApproval(appr.id, 'approve')}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                            style={{
                              color: '#16A34A',
                              background: 'rgba(22,163,74,0.06)',
                              border: '1px solid rgba(22,163,74,0.15)',
                            }}
                          >
                            {t(isHi, 'Approve', 'स्वीकृत')}
                          </button>
                          <button
                            onClick={() => handleApproval(appr.id, 'reject')}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                            style={{
                              color: '#DC2626',
                              background: 'rgba(220,38,38,0.06)',
                              border: '1px solid rgba(220,38,38,0.15)',
                            }}
                          >
                            {t(isHi, 'Reject', 'अस्वीकृत')}
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* ═══ BOTTOM NAV ═══ */}
      <BottomNav />
    </div>
  );
}
