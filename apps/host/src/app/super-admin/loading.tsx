import { AdminControlRoomSkeleton } from '@alfanumrik/ui/Skeleton';

/**
 * /super-admin (Control Room) route-level skeleton — system status bar, KPI
 * grid, widget rows. Now routed onto the shared AdminControlRoomSkeleton
 * (brand surface/border tokens, aria-busy) instead of the former flat
 * hardcoded-hex grey blocks. Text-free by design (language-neutral first paint).
 */
export default function Loading() {
  return <AdminControlRoomSkeleton />;
}
