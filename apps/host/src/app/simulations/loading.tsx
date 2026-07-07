export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner">
          <div className="w-48 h-6 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
        </div>
      </header>
      <main className="app-container py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="w-full h-32 animate-pulse" style={{ background: 'var(--surface-2)' }} />
              <div className="p-3 space-y-2">
                <div className="w-3/4 h-4 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
                <div className="w-1/2 h-3 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
