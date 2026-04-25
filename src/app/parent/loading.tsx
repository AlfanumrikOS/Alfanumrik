import { Bone } from '@/components/Skeleton';

/**
 * /parent skeleton — child summary + dashboard stats + weekly activity shape.
 */
export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <Bone width={140} height={20} />
          <Bone width={64} height={28} radius={12} />
        </div>
      </header>
      <div className="app-container py-5 space-y-4">
        {/* Child selector */}
        <div className="flex gap-2 overflow-x-auto">
          {[1, 2].map(i => (
            <div key={i} className="rounded-2xl p-3 flex items-center gap-2 min-w-[160px]" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width={36} height={36} radius={18} />
              <div className="space-y-1">
                <Bone width={80} height={12} />
                <Bone width={50} height={10} />
              </div>
            </div>
          ))}
        </div>
        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width="60%" height={10} />
              <Bone width="40%" height={24} />
              <Bone width="80%" height={10} />
            </div>
          ))}
        </div>
        {/* Weekly activity */}
        <Bone width="40%" height={14} />
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-end h-24 gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <Bone key={i} width="100%" height={40 + (i * 8) % 60} radius={4} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
