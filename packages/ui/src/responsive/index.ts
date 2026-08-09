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

// responsive/Breadcrumbs was removed on 2026-08-09 for the same reason as
// MobileNav above: it was a second component NAMED "Breadcrumbs" that no page
// ever rendered (only its own test imported it), colliding with the live
// packages/ui/src/Breadcrumbs.tsx used by /careers, /press, /refunds,
// /research, PricingV3 and MarketingShell. Its `.app-breadcrumbs*` CSS was
// dropped from globals.css in the same change. If an in-app back-nav crumb is
// wanted later, extend the surviving Breadcrumbs rather than reviving a twin.
