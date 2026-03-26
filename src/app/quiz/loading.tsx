export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner">
          <div className="w-40 h-6 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
        </div>
      </header>
      <main className="app-container py-6 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
            <div className="w-3/4 h-5 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
            <div className="space-y-2">
              {[1, 2, 3, 4].map(j => (
                <div key={j} className="w-full h-10 rounded-xl animate-pulse" style={{ background: 'var(--surface-2)' }} />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
