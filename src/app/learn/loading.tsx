import { Bone } from '@/components/Skeleton';

/**
 * /learn skeleton — matches the subject grid + chapter list layout.
 * Tailwind only, no data fetch.
 */
export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <Bone width={120} height={20} />
          <Bone width={32} height={32} radius={16} />
        </div>
      </header>
      <div className="app-container py-5 space-y-4">
        {/* Last studied banner */}
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <Bone width={44} height={44} radius={12} />
          <div className="flex-1 space-y-1.5">
            <Bone width="60%" height={14} />
            <Bone width="40%" height={10} />
          </div>
        </div>
        {/* Subjects grid */}
        <Bone width="30%" height={12} />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width={40} height={40} radius={20} />
              <Bone width="70%" height={14} />
              <Bone width="40%" height={10} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
