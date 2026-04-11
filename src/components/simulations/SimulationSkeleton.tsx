export default function SimulationSkeleton() {
  return (
    <div
      style={{
        width: '100%',
        height: 400,
        background: 'var(--surface-2, #f3f4f6)',
        borderRadius: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 40, animation: 'pulse 1.5s ease-in-out infinite' }}>🔬</div>
      <p style={{ color: 'var(--text-3, #9ca3af)', fontSize: 14, margin: 0 }}>
        Loading simulation…
      </p>
    </div>
  );
}
