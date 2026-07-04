/**
 * Shared overlay foundation — Phase 2 Batch B2.
 *
 * The single reusable substrate under Dialog / Drawer / BottomSheet /
 * Tooltip: a body Portal, ref-counted scroll lock, from-scratch focus
 * trap + restore, Escape wiring, enter/exit presence, and a
 * token-driven Scrim. Overlays compose these — no duplication.
 */

export { Portal, type PortalProps } from './Portal';
export { Scrim, type ScrimProps } from './Scrim';
export { useScrollLock } from './useScrollLock';
export { useFocusTrap, type UseFocusTrapOptions } from './useFocusTrap';
export { useEscapeKey } from './useEscapeKey';
export { usePresence, type UsePresenceResult } from './usePresence';
