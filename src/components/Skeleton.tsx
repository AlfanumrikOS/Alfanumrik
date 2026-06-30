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
 * Design: Matches Alfanumrik's warm cream palette with subtle shimmer.
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

/**
 * Dashboard skeleton — mirrors the Alfa OS student dashboard
 * (StudentOSDashboard + AppShell variant="split"): a compact header rail, the
 * PRIMARY mission hero, the mastery snapshot, the BoardScore widget, then the
 * subject roadmaps. Matching the real section order (hero → mastery → board →
 * roadmaps) eliminates the first-paint layout shift the legacy Atlas skeleton
 * caused. Warm-cream via the shared surface/border tokens (no dark mode);
 * the hero placeholder carries a subtle warm wash through the stable
 * --accent-warm channel (--orange-rgb is violet on the cosmic-light surface).
 */
export function DashboardSkeleton() {
  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-2xl">
        {/* Compact header rail — greeting + streak + XP chip + lang toggle. */}
        <div className="flex items-center gap-3 px-4 py-4 w-full">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Bone width={150} height={20} />
            <Bone width={110} height={12} />
          </div>
          <Bone width={48} height={24} radius={12} />
          <Bone width={56} height={24} radius={12} />
          <Bone width={36} height={24} radius={12} />
        </div>

        <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
          {/* 1. PRIMARY hero — Today's Mission. */}
          <div
            className="rounded-3xl p-5 md:p-6 space-y-3"
            style={{
              background: 'linear-gradient(135deg, var(--surface-1), rgb(var(--accent-warm-rgb) / 0.05))',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <Bone width={140} height={11} />
            <Bone width="75%" height={26} />
            <div className="space-y-2 pt-1">
              <Bone height={64} radius={16} />
              <Bone height={48} radius={16} />
            </div>
            <Bone height={48} radius={16} className="mt-1" />
          </div>

          {/* 2. Mastery snapshot. */}
          <div
            className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
          >
            <div className="flex items-center justify-between">
              <Bone width="40%" height={11} />
              <Bone width={56} height={20} radius={10} />
            </div>
            <div className="flex items-center gap-3">
              <Bone width={56} height={56} radius={28} />
              <div className="flex-1 space-y-2">
                <Bone width="40%" height={11} />
                <Bone height={6} radius={3} />
              </div>
            </div>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Bone key={i} height={54} radius={12} />
              ))}
            </div>
          </div>

          {/* 3. BoardScore widget — gauge + breakdown rows. */}
          <div
            className="rounded-3xl p-5 space-y-4"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <Bone width={120} height={14} />
                <Bone width={160} height={10} />
              </div>
              <Bone width={44} height={18} radius={9} />
            </div>
            <div className="rounded-2xl p-4 flex items-center gap-4" style={{ background: 'var(--surface-2)' }}>
              <Bone width={84} height={84} radius={42} />
              <div className="flex-1 space-y-2 pt-1">
                <Bone height={22} width="55%" />
                <Bone height={12} width="40%" />
                <Bone height={12} width="60%" />
              </div>
            </div>
            <Bone height={6} radius={3} />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Bone key={i} height={56} radius={16} />
              ))}
            </div>
          </div>

          {/* 4. Subject roadmaps — section title + skill-tree rows. */}
          <div className="space-y-3">
            <Bone width="45%" height={12} />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Bone key={i} height={64} radius={16} />
              ))}
            </div>
          </div>
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

/**
 * Simulation skeleton — placeholder for lazily-loaded STEM simulations.
 * Distinct visual (emoji + CSS pulse) preserved verbatim from the former
 * standalone src/components/simulations/SimulationSkeleton.tsx (folded in
 * during the duplicate-skeleton consolidation).
 */
export function SimulationSkeleton() {
  return (
    <div
      style={{
        width: '100%',
        height: 400,
        background: 'var(--surface-2, #f3f4f6)',
        borderRadius: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 40, animation: 'pulse 1.5s ease-in-out infinite' }}>🔬</div>
      <p style={{ color: 'var(--text-3, #9ca3af)', fontSize: 14, margin: 0 }}>
        Loading simulation…
      </p>
    </div>
  );
}

/**
 * Teacher Command Center skeleton — mirrors the Atlas teacher home layout: a
 * header rail of ~5 KPI tile bones, an at-risk rail of ~3 row bones, and a
 * roster mastery heatmap grid of bones. Warm-cream (NOT dark) using the shared
 * var(--surface-*) tokens so it matches the rest of the OS shell.
 */
export function TeacherDashboardSkeleton() {
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header rail */}
      <div className="page-header">
        <div className="app-container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bone width={40} height={40} radius={12} />
            <div className="space-y-1.5">
              <Bone width={140} height={14} />
              <Bone width={90} height={10} />
            </div>
          </div>
          <Bone width={120} height={36} radius={12} />
        </div>
      </div>

      <div className="app-container py-5 space-y-5">
        {/* KPI tiles (~5) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className="rounded-2xl p-4 space-y-2"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <Bone width="50%" height={10} />
              <Bone width="70%" height={24} />
            </div>
          ))}
        </div>

        {/* At-risk rail (~3 rows) */}
        <div className="space-y-2">
          <Bone width={120} height={12} className="mb-1" />
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <Bone width={36} height={36} radius={18} />
              <div className="flex-1 space-y-1.5">
                <Bone width="55%" height={13} />
                <Bone width="80%" height={10} />
              </div>
              <Bone width={88} height={28} radius={10} />
            </div>
          ))}
        </div>

        {/* Roster mastery heatmap grid */}
        <div
          className="rounded-2xl p-4 space-y-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <Bone width={160} height={12} className="mb-2" />
          {[1, 2, 3, 4, 5].map(row => (
            <div key={row} className="flex items-center gap-2">
              <Bone width={96} height={16} />
              <div className="flex-1 grid grid-cols-8 gap-1.5">
                {Array.from({ length: 8 }).map((_, col) => (
                  <Bone key={col} width="100%" height={20} radius={4} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Generic table/roster skeleton — a header bone plus N row bones. Used by the
 * teacher students / gradebook / reports pages. Warm-cream, shared tokens.
 */
export function TeacherTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      {/* Header row */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}
      >
        <Bone width="30%" height={12} />
        <Bone width="20%" height={12} />
        <Bone width="20%" height={12} />
        <Bone width="15%" height={12} />
      </div>
      {/* Body rows */}
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <Bone width={32} height={32} radius={16} />
            <Bone width={`${30 + (i % 3) * 10}%`} height={13} />
            <Bone width="18%" height={13} />
            <Bone width="18%" height={13} />
            <Bone width={48} height={22} radius={11} />
          </div>
        ))}
      </div>
    </div>
  );
}

export { Bone };
