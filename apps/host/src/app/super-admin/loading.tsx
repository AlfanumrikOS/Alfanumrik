/**
 * /super-admin (Control Room) skeleton — system status bar, KPI grid, widget rows.
 * English-only per ops decision. Matches sibling super-admin loading.tsx files.
 */
export default function Loading() {
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ height: 22, width: 180, background: 'var(--border)', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 12, width: 320, background: 'var(--surface-2)', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ height: 32, width: 110, background: 'var(--surface-2)', borderRadius: 8 }} />
          <div style={{ height: 32, width: 90, background: 'var(--border)', borderRadius: 8 }} />
        </div>
      </div>

      {/* Status bar */}
      <div style={{ height: 56, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 16 }} />

      {/* Quick ops + Live status row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ height: 140, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }} />
        <div style={{ height: 140, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }} />
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: 96, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }} />
        ))}
      </div>

      {/* Widget rows */}
      {[1, 2, 3].map(i => (
        <div key={i} style={{ height: 180, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 12 }} />
      ))}
    </div>
  );
}
