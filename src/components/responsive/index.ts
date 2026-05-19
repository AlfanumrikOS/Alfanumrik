/**
 * Responsive primitives barrel export (2026-05-19).
 *
 * Single import surface for the new mobile-first responsive system.
 * Components are designed to be additive — existing AtlasShell/BottomNav
 * continue to work unchanged. New surfaces opt-in to AppShell + MobileNav.
 */

export { AppShell } from './AppShell';
export type { AppShellProps, AppShellVariant } from './AppShell';

export { MobileNav, STUDENT_NAV_ITEMS } from './MobileNav';
export type { MobileNavProps, MobileNavItem } from './MobileNav';

export { Touchable } from './Touchable';
export type { TouchableProps, TouchableSize } from './Touchable';
