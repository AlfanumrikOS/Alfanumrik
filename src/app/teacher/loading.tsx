import { Bone } from '@/components/Skeleton';

/**
 * /teacher skeleton — class list + alerts + heatmap shape.
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
        {/* Stat row */}
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width="60%" height={10} />
              <Bone width="40%" height={24} />
            </div>
          ))}
        </div>
        {/* Classes list */}
        <Bone width="30%" height={14} />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width={44} height={44} radius={12} />
              <div className="flex-1 space-y-1.5">
                <Bone width="60%" height={14} />
                <Bone width="40%" height={10} />
              </div>
              <Bone width={40} height={24} radius={12} />
            </div>
          ))}
        </div>
        {/* Heatmap teaser */}
        <Bone width="40%" height={14} />
        <div className="rounded-2xl p-4 grid grid-cols-7 gap-1" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          {Array.from({ length: 28 }).map((_, i) => (
            <Bone key={i} width="100%" height={20} radius={4} />
          ))}
        </div>
      </div>
    </div>
  );
}
