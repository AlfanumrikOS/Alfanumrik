/**
 * Canonical UI primitive library — Phase 2 Batch A.
 *
 * THE design-system component layer. Every primitive is token-driven
 * (design-system.md — zero inline hex / rgb() / arbitrary Tailwind values),
 * accessible by default (>= 44px touch targets, visible focus-visible ring,
 * correct semantics, prefers-reduced-motion aware, non-colour backups on
 * colour-coded state), and bilingual-safe (all copy via props/children, P7).
 *
 * Import canonical primitives from '@/components/ui/primitives'. The legacy
 * "Wonder Blocks" set at '@/components/ui' remains until pages migrate.
 */

export { Button, type ButtonProps } from './Button';
export { IconButton, type IconButtonProps } from './IconButton';
export {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  type CardProps,
  type CardVariant,
} from './Card';
export { Badge, type BadgeProps, type BadgeVariant } from './Badge';
export { Chip, type ChipProps } from './Chip';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export {
  ProgressRing,
  MasteryRing,
  bandForValue,
  type ProgressRingProps,
  type MasteryRingProps,
  type MasteryBandKey,
} from './ProgressRing';
export {
  Skeleton,
  SkeletonText,
  SkeletonCircle,
  type SkeletonProps,
  type SkeletonTextProps,
  type SkeletonCircleProps,
} from './Skeleton';
export { EmptyState, type EmptyStateProps } from './EmptyState';

export { type Tone, type ActionVariant, type ControlSize } from './tokens';
