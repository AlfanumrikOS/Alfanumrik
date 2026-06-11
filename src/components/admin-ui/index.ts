// Shared dashboard UI primitives used by /super-admin, /school-admin,
// and (after Plans 1-2) /teacher and /parent shells. Built on the
// existing CSS-variable Tailwind tokens defined in tailwind.config.js
// (primary, surface-1/2/3, success, warning, danger, info, foreground,
// muted-foreground).
//
// See docs/superpowers/plans/2026-05-09-dashboard-foundation.md for the
// full lift plan.

// Primitives
export { StatCard, type StatCardProps } from './StatCard';
export { StatusBadge, type StatusBadgeProps, type StatusBadgeVariant } from './StatusBadge';
export { ScoreBar, scoreBand, type ScoreBarProps, type ScoreBand } from './ScoreBar';
export { StalenessTag } from './StalenessTag';
export { NoDataState, type NoDataStateProps, type NoDataStateReason } from './NoDataState';
export { default as DetailDrawer } from './DetailDrawer';
export type { DetailDrawerProps } from './DetailDrawer';
export { default as DataTable } from './DataTable';
export type { Column, DataTableProps } from './DataTable';
export { default as DashboardSidebar } from './DashboardSidebar';
export type { DashboardSidebarProps, SidebarNavItem } from './DashboardSidebar';

// Chart wrappers (Recharts)
export * from './charts';
