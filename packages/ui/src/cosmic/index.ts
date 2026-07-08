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
  IconButton,
  type IconButtonProps,
} from './CosmicButton';
export { MasteryRing, type MasteryRingProps } from './MasteryRing';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { HeatCell, type HeatCellProps } from './HeatCell';
export { MascotBubble, type MascotBubbleProps } from './MascotBubble';
export { Starfield, type StarfieldProps } from './Starfield';
export { HDisplay, TabNum, FadeUp, Float } from './Text';
export { usePrefersReducedMotion } from './usePrefersReducedMotion';
