/**
 * Shared overlay foundation — Phase 2 Batch B2.
 *
 * The single reusable substrate under Dialog / Drawer / BottomSheet /
 * Tooltip / Menu: a body Portal, ref-counted scroll lock, from-scratch
 * focus trap + restore, Escape wiring, enter/exit presence, anchored
 * flip/clamp positioning, and a token-driven Scrim. Overlays compose
 * these — no duplication.
 */

export { Portal, type PortalProps } from './Portal';
export { Scrim, type ScrimProps } from './Scrim';
export { useScrollLock } from './useScrollLock';
export { useFocusTrap, type UseFocusTrapOptions } from './useFocusTrap';
export { useEscapeKey } from './useEscapeKey';
export { usePresence, type UsePresenceResult } from './usePresence';
export {
  usePopoverPosition,
  type PopoverPlacement,
  type PopoverCoords,
  type UsePopoverPositionOptions,
  type UsePopoverPositionResult,
} from './usePopoverPosition';
