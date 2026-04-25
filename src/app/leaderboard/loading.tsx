import { Bone, CardListSkeleton } from '@/components/Skeleton';

/**
 * /leaderboard skeleton — tabs + period pills + ranked list shape.
 */
export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <Bone width={140} height={20} />
          <Bone width={32} height={32} radius={16} />
        </div>
      </header>
      <div className="app-container py-5 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto">
          {[1, 2, 3, 4, 5].map(i => (
            <Bone key={i} width={88} height={32} radius={16} />
          ))}
        </div>
        {/* Period pills */}
        <div className="flex gap-2">
          {[1, 2, 3].map(i => (
            <Bone key={i} width={80} height={28} radius={14} />
          ))}
        </div>
        {/* Top 3 podium */}
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-4 flex flex-col items-center gap-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width={48} height={48} radius={24} />
              <Bone width="80%" height={12} />
              <Bone width={40} height={20} radius={10} />
            </div>
          ))}
        </div>
        {/* Rank list */}
        <CardListSkeleton count={6} />
      </div>
    </div>
  );
}
