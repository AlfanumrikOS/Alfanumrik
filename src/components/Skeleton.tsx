'use client';

/**
 * Skeleton Loading Components
 *
 * Research: Users perceive skeleton screens as 30% faster than spinners.
 * On Indian mobile networks (avg 3G: 3.5 Mbps, 4G: 12 Mbps), the difference
 * between a spinner and a skeleton is the difference between "app is broken"
 * and "app is loading". Duolingo, Khan Academy, and Instagram all use
 * skeletons for this exact reason.
 *
 * Design: Matches Alfanumrik's cool navy/teal palette with subtle shimmer.
 */

function Bone({ width = '100%', height = 16, radius = 8, className = '' }: {
  width?: string | number;
  height?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-shimmer ${className}`}
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)',
        backgroundSize: '200% 100%',
      }}
    />
  );
}

/** Dashboard skeleton — matches the real dashboard layout */
export function DashboardSkeleton() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header skeleton */}
      <div className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bone width={40} height={40} radius={20} />
            <div className="space-y-1.5">
              <Bone width={120} height={14} />
              <Bone width={80} height={10} />
            </div>
          </div>
          <Bone width={40} height={40} radius={12} />
        </div>
      </div>

      <div className="app-container py-5 space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-xl p-3" style={{ background: 'var(--surface-1)' }}>
              <Bone width={20} height={20} radius={4} className="mb-2" />
              <Bone width="60%" height={20} className="mb-1" />
              <Bone width="40%" height={10} />
            </div>
          ))}
        </div>

        {/* Action tiles */}
        <Bone width="40%" height={12} className="mb-2" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-4 flex flex-col items-center gap-2" style={{ background: 'var(--surface-1)' }}>
              <Bone width={32} height={32} radius={8} />
              <Bone width="60%" height={10} />
            </div>
          ))}
        </div>

        {/* Subject cards */}
        <Bone width="40%" height={12} className="mb-2" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width={44} height={44} radius={12} />
              <div className="flex-1 space-y-1.5">
                <Bone width="70%" height={14} />
                <Bone width="100%" height={8} radius={4} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Quiz skeleton — matches the quiz question layout */
export function QuizSkeleton() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <div className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <Bone width={100} height={16} />
          <Bone width={60} height={12} />
        </div>
      </div>
      <div className="app-container py-6 space-y-4">
        <Bone width="100%" height={8} radius={4} />
        <div className="rounded-2xl p-6 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <Bone width="90%" height={18} />
          <Bone width="70%" height={18} />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-2xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <Bone width={`${70 + Math.random() * 30}%`} height={16} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Card list skeleton — generic for leaderboard, notifications, etc. */
export function CardListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <Bone width={40} height={40} radius={20} />
          <div className="flex-1 space-y-1.5">
            <Bone width={`${50 + Math.random() * 40}%`} height={14} />
            <Bone width={`${30 + Math.random() * 30}%`} height={10} />
          </div>
          <Bone width={40} height={20} radius={10} />
        </div>
      ))}
    </div>
  );
}

export { Bone };
