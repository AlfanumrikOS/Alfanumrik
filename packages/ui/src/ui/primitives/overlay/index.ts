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
/* usePopoverPosition: TYPES ONLY here. Import the HOOK from the module:
 *
 *     import { usePopoverPosition } from '.../overlay/usePopoverPosition';
 *
 * It is the anchored-placement half of the foundation and, unlike Portal /
 * focus-trap / presence / Escape, it is used by exactly ONE overlay (Menu),
 * which is itself lazy-loaded. `packages/ui` has no `"sideEffects": false`, so
 * a value re-export here becomes a bare side-effect `require()` that webpack
 * cannot drop — which put a SECOND, dead copy of this hook inside the shared
 * primitives chunk that 73 routes load eagerly, purely because Menu (in an
 * async chunk) made the module reachable. Types erase at compile time and
 * cost nothing. See the Menu note in ../index.ts for the full measurement.
 */
export type {
  PopoverPlacement,
  PopoverCoords,
  UsePopoverPositionOptions,
  UsePopoverPositionResult,
} from './usePopoverPosition';
