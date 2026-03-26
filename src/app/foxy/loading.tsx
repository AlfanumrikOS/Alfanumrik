export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full animate-pulse" style={{ background: 'var(--surface-2)' }} />
            <div className="w-32 h-5 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
          </div>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-bounce">🦊</div>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Waking up Foxy...</p>
        </div>
      </div>
    </div>
  );
}
