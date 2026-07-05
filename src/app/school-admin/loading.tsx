export default function Loading() {
  return (
    <div style={{ padding: '16px', maxWidth: 672, margin: '0 auto' }}>
      {/* Header skeleton */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ height: 24, width: 180, background: 'var(--surface-3)', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 12, width: 120, background: 'var(--surface-2)', borderRadius: 4 }} />
        </div>
        <div style={{ height: 32, width: 64, background: 'var(--surface-2)', borderRadius: 12 }} />
      </div>

      {/* 4 stat cards row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: 80, background: 'var(--surface-2)', borderRadius: 16, border: '1px solid var(--surface-3)' }} />
        ))}
      </div>

      {/* Mastery ring + quizzes today row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ height: 120, background: 'var(--surface-2)', borderRadius: 20, border: '1px solid var(--surface-3)' }} />
        <div style={{ height: 120, background: 'var(--surface-2)', borderRadius: 20, border: '1px solid var(--surface-3)' }} />
      </div>

      {/* Quick actions label */}
      <div style={{ height: 14, width: 120, background: 'var(--surface-2)', borderRadius: 4, marginBottom: 12 }} />

      {/* Quick action tiles 4-grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: 72, background: 'var(--surface-2)', borderRadius: 16, border: '1px solid var(--surface-3)' }} />
        ))}
      </div>

      {/* Activity feed label */}
      <div style={{ height: 14, width: 140, background: 'var(--surface-2)', borderRadius: 4, marginBottom: 12 }} />

      {/* Activity feed rows */}
      {[1, 2, 3].map(i => (
        <div key={i} style={{ height: 64, background: 'var(--surface-2)', borderRadius: 16, border: '1px solid var(--surface-3)', marginBottom: 8 }} />
      ))}
    </div>
  );
}
