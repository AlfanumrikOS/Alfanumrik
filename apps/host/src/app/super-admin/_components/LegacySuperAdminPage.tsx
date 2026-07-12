'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from './AdminShell';
import { useCosmicTheme } from '@alfanumrik/lib/cosmic-theme';
import {
  SystemStatusBar,
  QuickOperations,
  LiveStatus,
  PendingActions,
  DeployAuditBackups,
  DeployHistory,
  LearnerHealth,
  PlatformHealth,
  ContentEngagement,
} from './widgets';
import type {
  SystemStats,
  ObsData,
  DeployInfo,
  BackupRecord,
  DeployRecord,
  AuditEntry,
  AnalyticsData,
  FeatureFlag,
} from './widgets';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';

function ControlRoom() {
  const { apiFetch } = useAdmin();
  // Cosmic Phase 3: the version-code chip hardcodes a light bg the token bridge
  // can't reach; swap it for a bridged surface when cosmic is ON. OFF ⇒ false ⇒
  // byte-identical light chip.
  const { cosmicEnabled } = useCosmicTheme();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [deployInfo, setDeployInfo] = useState<DeployInfo | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [deployHistory, setDeployHistory] = useState<DeployRecord[]>([]);
  const [recentLogs, setRecentLogs] = useState<AuditEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Staleness timestamps
  const [statsUpdated, setStatsUpdated] = useState<Date | null>(null);
  const [obsUpdated, setObsUpdated] = useState<Date | null>(null);
  const [deployUpdated, setDeployUpdated] = useState<Date | null>(null);
  const [analyticsUpdated, setAnalyticsUpdated] = useState<Date | null>(null);

  // Auto-revalidation interval ref
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const now = new Date();
    try {
      const [statsRes, deployRes, obsRes, backupRes, deployHistRes, logsRes, analyticsRes, flagsRes] = await Promise.all([
        apiFetch('/api/super-admin/stats'),
        apiFetch('/api/super-admin/deploy'),
        apiFetch('/api/super-admin/observability'),
        apiFetch('/api/super-admin/platform-ops?action=backups'),
        apiFetch('/api/super-admin/platform-ops?action=deployments&limit=5'),
        apiFetch('/api/super-admin/logs?limit=10'),
        apiFetch('/api/super-admin/analytics'),
        apiFetch('/api/super-admin/feature-flags'),
      ]);
      if (statsRes.ok) { setStats(await statsRes.json()); setStatsUpdated(now); }
      if (deployRes.ok) { setDeployInfo(await deployRes.json()); setDeployUpdated(now); }
      if (obsRes.ok) { setObsData(await obsRes.json()); setObsUpdated(now); }
      if (backupRes.ok) { const d = await backupRes.json(); setBackups(d.data || []); setDeployUpdated(now); }
      if (deployHistRes.ok) { const d = await deployHistRes.json(); setDeployHistory(d.data || []); setDeployUpdated(now); }
      if (logsRes.ok) { const d = await logsRes.json(); setRecentLogs(d.data || []); }
      if (analyticsRes.ok) { setAnalytics(await analyticsRes.json()); setAnalyticsUpdated(now); }
      if (flagsRes.ok) { const d = await flagsRes.json(); setFlags(d.data || []); }
    } catch (e) { console.error('ControlRoom fetch error:', e); setError(e instanceof Error ? e.message : 'Failed to load dashboard data'); }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    fetchAll();
    // Auto-revalidate every 30 seconds
    intervalRef.current = setInterval(fetchAll, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  const toggleFlag = async (flag: FeatureFlag) => {
    await apiFetch('/api/super-admin/feature-flags', {
      method: 'PATCH', body: JSON.stringify({ id: flag.id, updates: { enabled: !flag.enabled } }),
    });
    const res = await apiFetch('/api/super-admin/feature-flags');
    if (res.ok) { const d = await res.json(); setFlags(d.data || []); }
  };

  if (loading && !stats) {
    return <div style={{ color: '#9CA3AF', padding: 40, textAlign: 'center' }}>Loading control room...</div>;
  }

  if (error && !stats) {
    return (
      <div style={{ color: '#EF4444', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>&#x26A0;&#xFE0F;</div>
        <p style={{ fontWeight: 600, marginBottom: 12 }}>Failed to load dashboard data</p>
        <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 16 }}>{error}</p>
        <button onClick={fetchAll} style={{ padding: '8px 20px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="font-bold text-foreground" style={{ fontSize: 18 }}>Control Room</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>Platform operations, system status, and quick interventions</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {deployInfo && <code style={{ fontSize: 11, color: '#9CA3AF', background: cosmicEnabled ? 'var(--surface-2)' : '#F9FAFB', padding: '4px 8px', borderRadius: 4 }}>v{deployInfo.app_version}</code>}
          <button onClick={fetchAll} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Refresh All</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>
          &#x26A0;&#xFE0F; Some data failed to load: {error} &mdash;{' '}
          <button onClick={fetchAll} style={{ background: 'none', border: 'none', color: '#DC2626', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Retry</button>
        </div>
      )}

      {/* System Status Bar */}
      {obsData && (
        <SectionErrorBoundary section="System Status Bar">
          <SystemStatusBar obsData={obsData} lastUpdated={obsUpdated} />
        </SectionErrorBoundary>
      )}

      {/* Two-Column: Operations + Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <SectionErrorBoundary section="Quick Operations">
          <QuickOperations apiFetch={apiFetch} />
        </SectionErrorBoundary>
        <SectionErrorBoundary section="Live Status">
          <LiveStatus
            stats={stats}
            flags={flags}
            analytics={analytics}
            toggleFlag={toggleFlag}
            lastUpdated={statsUpdated}
          />
        </SectionErrorBoundary>
      </div>

      {/* Pending Actions */}
      <SectionErrorBoundary section="Pending Actions">
        <PendingActions obsData={obsData} analytics={analytics} flags={flags} />
      </SectionErrorBoundary>

      {/* Deploy + Audit + Backups */}
      <SectionErrorBoundary section="Deploy Audit and Backups">
        <DeployAuditBackups
          deployInfo={deployInfo}
          recentLogs={recentLogs}
          backups={backups}
          lastUpdated={deployUpdated}
        />
      </SectionErrorBoundary>

      {/* Recent Deployments */}
      <SectionErrorBoundary section="Deploy History">
        <DeployHistory deployHistory={deployHistory} lastUpdated={deployUpdated} />
      </SectionErrorBoundary>

      {/* Learner Health */}
      {analytics && stats && obsData && (
        <SectionErrorBoundary section="Learner Health">
          <LearnerHealth
            analytics={analytics}
            stats={stats}
            obsData={obsData}
            lastUpdated={analyticsUpdated}
          />
        </SectionErrorBoundary>
      )}

      {/* Platform Health Grid */}
      {stats && obsData && (
        <SectionErrorBoundary section="Platform Health">
          <PlatformHealth
            stats={stats}
            obsData={obsData}
            analytics={analytics}
            lastUpdated={statsUpdated}
          />
        </SectionErrorBoundary>
      )}

      {/* Content + Engagement Row */}
      {analytics && (
        <SectionErrorBoundary section="Content Engagement">
          <ContentEngagement analytics={analytics} lastUpdated={analyticsUpdated} />
        </SectionErrorBoundary>
      )}
    </div>
  );
}

export default function LegacySuperAdminPage() {
  return (
    <AdminShell>
      <ControlRoom />
    </AdminShell>
  );
}
