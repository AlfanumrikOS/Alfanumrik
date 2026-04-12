'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from './_components/AdminShell';
import { colors, S } from './_components/admin-styles';
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
} from './_components/widgets';
import type {
  SystemStats,
  ObsData,
  DeployInfo,
  BackupRecord,
  DeployRecord,
  AuditEntry,
  AnalyticsData,
  FeatureFlag,
} from './_components/widgets';

function ControlRoom() {
  const { apiFetch } = useAdmin();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [deployInfo, setDeployInfo] = useState<DeployInfo | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [deployHistory, setDeployHistory] = useState<DeployRecord[]>([]);
  const [recentLogs, setRecentLogs] = useState<AuditEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);

  // Staleness timestamps
  const [statsUpdated, setStatsUpdated] = useState<Date | null>(null);
  const [obsUpdated, setObsUpdated] = useState<Date | null>(null);
  const [deployUpdated, setDeployUpdated] = useState<Date | null>(null);
  const [analyticsUpdated, setAnalyticsUpdated] = useState<Date | null>(null);

  // Auto-revalidation interval ref
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
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
    } catch { /* */ }
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
    return <div style={{ color: colors.text3, padding: 40, textAlign: 'center' }}>Loading control room...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ ...S.h1, fontSize: 18 }}>Control Room</h1>
          <p style={{ fontSize: 12, color: colors.text3, margin: 0 }}>Platform operations, system status, and quick interventions</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {deployInfo && <code style={{ fontSize: 11, color: colors.text3, background: colors.surface, padding: '4px 8px', borderRadius: 4 }}>v{deployInfo.app_version}</code>}
          <button onClick={fetchAll} style={S.secondaryBtn}>Refresh All</button>
        </div>
      </div>

      {/* System Status Bar */}
      {obsData && (
        <SystemStatusBar obsData={obsData} lastUpdated={obsUpdated} />
      )}

      {/* Two-Column: Operations + Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <QuickOperations apiFetch={apiFetch} />
        <LiveStatus
          stats={stats}
          flags={flags}
          analytics={analytics}
          toggleFlag={toggleFlag}
          lastUpdated={statsUpdated}
        />
      </div>

      {/* Pending Actions */}
      <PendingActions obsData={obsData} analytics={analytics} flags={flags} />

      {/* Deploy + Audit + Backups */}
      <DeployAuditBackups
        deployInfo={deployInfo}
        recentLogs={recentLogs}
        backups={backups}
        lastUpdated={deployUpdated}
      />

      {/* Recent Deployments */}
      <DeployHistory deployHistory={deployHistory} lastUpdated={deployUpdated} />

      {/* Learner Health */}
      {analytics && stats && obsData && (
        <LearnerHealth
          analytics={analytics}
          stats={stats}
          obsData={obsData}
          lastUpdated={analyticsUpdated}
        />
      )}

      {/* Platform Health Grid */}
      {stats && obsData && (
        <PlatformHealth
          stats={stats}
          obsData={obsData}
          analytics={analytics}
          lastUpdated={statsUpdated}
        />
      )}

      {/* Content + Engagement Row */}
      {analytics && (
        <ContentEngagement analytics={analytics} lastUpdated={analyticsUpdated} />
      )}
    </div>
  );
}

export default function SuperAdminPage() {
  return (
    <AdminShell>
      <ControlRoom />
    </AdminShell>
  );
}