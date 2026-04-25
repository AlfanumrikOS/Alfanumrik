import { Bone } from '@/components/Skeleton';

/**
 * /exams skeleton — exam type filter + upcoming exam cards shape.
 */
export default function Loading() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <Bone width={120} height={20} />
          <Bone width={88} height={32} radius={16} />
        </div>
      </header>
      <div className="app-container py-5 space-y-4">
        {/* Type filter pills */}
        <div className="flex gap-2 overflow-x-auto">
          {[1, 2, 3].map(i => (
            <Bone key={i} width={104} height={36} radius={18} />
          ))}
        </div>
        {/* Exam cards */}
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bone width={32} height={32} radius={16} />
                  <div className="space-y-1">
                    <Bone width={120} height={14} />
                    <Bone width={80} height={10} />
                  </div>
                </div>
                <Bone width={56} height={24} radius={12} />
              </div>
              <Bone width="100%" height={6} radius={3} />
              <div className="flex justify-between">
                <Bone width={80} height={10} />
                <Bone width={60} height={10} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
