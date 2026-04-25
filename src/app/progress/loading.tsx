import { Bone } from '@/components/Skeleton';

/**
 * /progress skeleton — score hero + bloom progression + knowledge gaps shape.
 */
export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <Bone width={120} height={20} />
          <Bone width={64} height={24} radius={12} />
        </div>
      </header>
      <div className="app-container py-5 space-y-4">
        {/* Score hero */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <Bone width={140} height={16} />
            <Bone width={60} height={20} radius={10} />
          </div>
          <Bone width={100} height={36} />
          <Bone width="100%" height={8} radius={4} />
        </div>
        {/* Stat row */}
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width="60%" height={10} />
              <Bone width="80%" height={20} />
            </div>
          ))}
        </div>
        {/* Bloom's progression */}
        <Bone width="40%" height={14} />
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Bone width={32} height={32} radius={16} />
              <div className="flex-1 space-y-1.5">
                <Bone width="40%" height={12} />
                <Bone width="100%" height={6} radius={3} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
