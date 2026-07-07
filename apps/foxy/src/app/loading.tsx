'use client';

export default function Loading() {
  // Detect Hindi preference without AuthContext (loading runs before context).
  // Mirrors the pattern in src/app/dashboard/error.tsx:14-17.
  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

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
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'फॉक्सी जाग रहा है...' : 'Waking up Foxy...'}
          </p>
        </div>
      </div>
    </div>
  );
}
