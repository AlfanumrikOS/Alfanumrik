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

/* ── Form primitives (Batch B1) ── */
export { Field, useFieldControl, type FieldProps, type FieldContextValue } from './Field';
export { Input, type InputProps } from './Input';
export { Textarea, type TextareaProps } from './Textarea';
export { Select, type SelectProps, type SelectOption } from './Select';
export { Checkbox, type CheckboxProps } from './Checkbox';
export {
  Radio,
  RadioGroup,
  type RadioProps,
  type RadioGroupProps,
  type RadioGroupOption,
} from './Radio';
export { Switch, type SwitchProps } from './Switch';

/* ── Overlay primitives (Batch B2) ── */
export {
  Dialog,
  DialogTitle,
  DialogBody,
  DialogFooter,
  ConfirmDialog,
  type DialogProps,
  type DialogSize,
  type DialogTitleProps,
  type ConfirmDialogProps,
} from './Dialog';
export {
  Drawer,
  type DrawerProps,
  type DrawerSide,
  type DrawerSize,
} from './Drawer';
export {
  BottomSheet,
  type BottomSheetProps,
} from './BottomSheet';
export { Tooltip, type TooltipProps, type TooltipSide } from './Tooltip';

/* Shared overlay foundation (Portal / Scrim / focus-trap / scroll-lock / …). */
export {
  Portal,
  Scrim,
  useScrollLock,
  useFocusTrap,
  useEscapeKey,
  usePresence,
  type PortalProps,
  type ScrimProps,
  type UseFocusTrapOptions,
  type UsePresenceResult,
} from './overlay';

export { type Tone, type ActionVariant, type ControlSize } from './tokens';
