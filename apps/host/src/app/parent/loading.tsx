import { ParentDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

/**
 * /parent route-level skeleton — renders the shared ParentDashboardSkeleton so
 * the streaming fallback matches the ParentGlanceHome shape (header + stat grid
 * + activity + insights) and there's no layout shift into the real dashboard.
 */
export default function Loading() {
  return <ParentDashboardSkeleton />;
}
