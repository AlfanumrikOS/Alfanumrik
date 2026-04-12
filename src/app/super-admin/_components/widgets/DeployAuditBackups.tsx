'use client';

import StatusBadge from '../StatusBadge';
import { colors, S } from '../admin-styles';
import { StalenessTag } from '../StalenessTag';
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
        <div style={{ ...S.card, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1 }}>Deployment</div>
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
              <span style={{ color: colors.text3 }}>{item.l}</span>
              <span style={{ color: colors.text1, fontWeight: 500, fontFamily: item.l === 'Commit' ? 'monospace' : 'inherit' }}>{item.v}</span>
            </div>
          ))}
          {deployInfo.deployment.commit_message !== 'unknown' && (
            <div style={{ marginTop: 8, padding: '6px 8px', background: colors.surface, borderRadius: 4, fontSize: 11, color: colors.text2 }}>
              {deployInfo.deployment.commit_message}
            </div>
          )}
        </div>
      )}

      {/* Recent Audit */}
      <div style={{ ...S.card, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1 }}>Audit Trail</div>
          <a href="/super-admin/logs" style={{ fontSize: 11, color: colors.accent, textDecoration: 'none' }}>All</a>
        </div>
        {recentLogs.length === 0 ? (
          <div style={{ fontSize: 11, color: colors.text3 }}>No recent actions</div>
        ) : recentLogs.slice(0, 8).map(l => (
          <div key={l.id} style={{ padding: '4px 0', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <code style={{ fontSize: 10, color: colors.text1, background: colors.surface, padding: '1px 4px', borderRadius: 2 }}>{l.action}</code>
            <span style={{ fontSize: 10, color: colors.text3 }}>{new Date(l.created_at).toLocaleString().replace(/:\d{2}\s/, ' ')}</span>
          </div>
        ))}
      </div>

      {/* Backups */}
      <div style={{ ...S.card, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1 }}>Backups</div>
          <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={10} />
        </div>
        {backups.length === 0 ? (
          <div style={{ fontSize: 11, color: colors.text3 }}>No backup records. Check Supabase dashboard.</div>
        ) : backups.slice(0, 4).map(b => (
          <div key={b.id} style={{ padding: '4px 0', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <StatusBadge label={b.status} variant={b.status === 'success' ? 'success' : b.status === 'failed' ? 'danger' : 'warning'} />
              <span style={{ fontSize: 11, color: colors.text3 }}>{b.backup_type}</span>
            </div>
            <span style={{ fontSize: 10, color: colors.text3 }}>
              {b.completed_at ? new Date(b.completed_at).toLocaleDateString() : '\u2014'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
