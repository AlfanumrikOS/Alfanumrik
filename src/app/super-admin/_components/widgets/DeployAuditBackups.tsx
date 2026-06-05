'use client';

import { StatusBadge, StalenessTag } from '@/components/admin-ui';
import type { DeployInfo, AuditEntry, BackupRecord } from './control-room-types';

interface DeployAuditBackupsProps {
  deployInfo: DeployInfo | null;
  recentLogs: AuditEntry[];
  backups: BackupRecord[];
  lastUpdated: Date | null;
}

export default function DeployAuditBackups({ deployInfo, recentLogs, backups, lastUpdated }: DeployAuditBackupsProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
      {/* Deployment */}
      {deployInfo && (
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deployment</div>
            <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={10} />
          </div>
          {[
            { l: 'Version', v: deployInfo.app_version },
            { l: 'Env', v: deployInfo.environment },
            { l: 'Branch', v: deployInfo.deployment.branch },
            { l: 'Commit', v: deployInfo.deployment.commit_sha.slice(0, 8) },
            { l: 'Author', v: deployInfo.deployment.commit_author },
            { l: 'Region', v: deployInfo.region },
          ].map(item => (
            <div key={item.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
              <span style={{ color: '#9CA3AF' }}>{item.l}</span>
              <span style={{ color: 'var(--text-1)', fontWeight: 500, fontFamily: item.l === 'Commit' ? 'monospace' : 'inherit' }}>{item.v}</span>
            </div>
          ))}
          {deployInfo.deployment.commit_message !== 'unknown' && (
            <div style={{ marginTop: 8, padding: '6px 8px', background: '#F9FAFB', borderRadius: 4, fontSize: 11, color: '#6B7280' }}>
              {deployInfo.deployment.commit_message}
            </div>
          )}
        </div>
      )}

      {/* Recent Audit */}
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Audit Trail</div>
          <a href="/super-admin/logs" style={{ fontSize: 11, color: '#2563EB', textDecoration: 'none' }}>All</a>
        </div>
        {recentLogs.length === 0 ? (
          <div style={{ fontSize: 11, color: '#9CA3AF' }}>No recent actions</div>
        ) : recentLogs.slice(0, 8).map(l => (
          <div key={l.id} style={{ padding: '4px 0', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <code style={{ fontSize: 10, color: '#111827', background: '#F9FAFB', padding: '1px 4px', borderRadius: 2 }}>{l.action}</code>
            <span style={{ fontSize: 10, color: '#9CA3AF' }}>{new Date(l.created_at).toLocaleString().replace(/:\d{2}\s/, ' ')}</span>
          </div>
        ))}
      </div>

      {/* Backups */}
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Backups</div>
          <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={10} />
        </div>
        {backups.length === 0 ? (
          <div style={{ fontSize: 11, color: '#9CA3AF' }}>No backup records. Check Supabase dashboard.</div>
        ) : backups.slice(0, 4).map(b => (
          <div key={b.id} style={{ padding: '4px 0', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <StatusBadge label={b.status} variant={b.status === 'success' ? 'success' : b.status === 'failed' ? 'danger' : 'warning'} />
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>{b.backup_type}</span>
            </div>
            <span style={{ fontSize: 10, color: '#9CA3AF' }}>
              {b.completed_at ? new Date(b.completed_at).toLocaleDateString() : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
