'use client';

import StatusBadge from '../StatusBadge';
import { colors, S } from '../admin-styles';
import { StalenessTag } from '../StalenessTag';
import type { DeployRecord } from './control-room-types';

interface DeployHistoryProps {
  deployHistory: DeployRecord[];
  lastUpdated: Date | null;
}

export default function DeployHistory({ deployHistory, lastUpdated }: DeployHistoryProps) {
  if (deployHistory.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5 }}>Recent Deployments</div>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={10} />
      </div>
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Version</th>
              <th style={S.th}>Branch</th>
              <th style={S.th}>Env</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Commit</th>
              <th style={S.th}>Deployed</th>
            </tr>
          </thead>
          <tbody>
            {deployHistory.map(d => (
              <tr key={d.id}>
                <td style={S.td}><strong>{d.app_version}</strong></td>
                <td style={S.td}>{d.branch || '\u2014'}</td>
                <td style={S.td}><StatusBadge label={d.environment} variant={d.environment === 'production' ? 'info' : 'neutral'} /></td>
                <td style={S.td}><StatusBadge label={d.status} variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'} /></td>
                <td style={S.td}><code style={{ fontSize: 11, color: colors.text2 }}>{(d.commit_sha || '').slice(0, 8)}</code></td>
                <td style={{ ...S.td, fontSize: 12 }}>{new Date(d.deployed_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
