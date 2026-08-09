/**
 * Cosmic primitives — public barrel.
 *
 * All components here are presentational shells that apply the cosmic CSS
 * classes defined in src/app/globals.css under the html[data-design="cosmic"]
 * scope. They are inert (render their children with no cosmic styling) when
 * ff_cosmic_redesign_v1 is OFF, because the scope is absent. Phase 1 surfaces
 * import from here:
 *
 *   import { GlowCard, MasteryRing, Chip, CosmicButton } from '@alfanumrik/ui/cosmic';
 */
export { GlowCard, type GlowCardProps } from './GlowCard';
export { CardElev, type CardElevProps } from './CardElev';
export { Chip, type ChipProps, type ChipTone } from './Chip';
export {
  CosmicButton,
  type CosmicButtonProps,
  PillButton,
  type PillButtonProps,
} from './CosmicButton';
export { MasteryRing, type MasteryRingProps } from './MasteryRing';

// Removed 2026-08-09 — name collisions with the canonical primitive library:
//   IconButton  → use { IconButton } from '@alfanumrik/ui/ui/primitives'
//                 (required `label`, >= 44px at every size, loading state).
//   ProgressBar → use { ProgressBar } from '@alfanumrik/ui/ui/primitives'
//                 (token-driven tone/size, optional label + value read-out).
// Neither cosmic copy had a production caller; both existed only to be shown
// on /dev/cosmic-preview. Do not re-add a cosmic twin — extend the primitive.
export { HeatCell, type HeatCellProps } from './HeatCell';
export { MascotBubble, type MascotBubbleProps } from './MascotBubble';
export { Starfield, type StarfieldProps } from './Starfield';
export { HDisplay, TabNum, FadeUp, Float } from './Text';
export { usePrefersReducedMotion } from './usePrefersReducedMotion';
