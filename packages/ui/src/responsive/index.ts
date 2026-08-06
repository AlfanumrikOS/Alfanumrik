/**
 * Responsive primitives barrel export (2026-05-19).
 *
 * Single import surface for the new mobile-first responsive system.
 * Components are designed to be additive — existing AtlasShell/BottomNav
 * continue to work unchanged. New surfaces opt-in to AppShell.
 */

export { AppShell } from './AppShell';
export type { AppShellProps, AppShellVariant } from './AppShell';

// STUDENT_NAV_ITEMS and the whole responsive/MobileNav twin were removed on
// 2026-08-06 — MobileNav was a fully-built bottom nav RENDERED NOWHERE (only
// its own test imported it), a duplicate of the live navigation/MobileBottomNav.
// Student nav config lives in packages/ui/src/navigation/nav-config.ts.

export { Touchable } from './Touchable';
export type { TouchableProps, TouchableSize } from './Touchable';

export { Breadcrumbs } from './Breadcrumbs';
export type { BreadcrumbsProps } from './Breadcrumbs';
