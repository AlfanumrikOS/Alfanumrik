'use client';

import { StatusBadge, StalenessTag, DataTable, type Column } from '@alfanumrik/ui/admin-ui';
import type { DeployRecord } from './control-room-types';

interface DeployHistoryProps {
  deployHistory: DeployRecord[];
  lastUpdated: Date | null;
}

export default function DeployHistory({ deployHistory, lastUpdated }: DeployHistoryProps) {
  if (deployHistory.length === 0) return null;

  const columns: Column<DeployRecord & Record<string, unknown>>[] = [
    { key: 'app_version', label: 'Version', render: r => <strong>{r.app_version}</strong> },
    { key: 'branch', label: 'Branch', render: r => <>{r.branch || '—'}</> },
    { key: 'environment', label: 'Env', render: r => <StatusBadge label={r.environment} variant={r.environment === 'production' ? 'info' : 'neutral'} /> },
    { key: 'status', label: 'Status', render: r => <StatusBadge label={r.status} variant={r.status === 'success' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'} /> },
    { key: 'commit_sha', label: 'Commit', render: r => <code style={{ fontSize: 11, color: '#6B7280' }}>{(r.commit_sha || '').slice(0, 8)}</code> },
    { key: 'deployed_at', label: 'Deployed', render: r => <span style={{ fontSize: 12 }}>{new Date(r.deployed_at).toLocaleString()}</span> },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Deployments</div>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={10} />
      </div>
      <DataTable
        columns={columns}
        data={deployHistory as unknown as (DeployRecord & Record<string, unknown>)[]}
        keyField="id"
      />
    </div>
  );
}
