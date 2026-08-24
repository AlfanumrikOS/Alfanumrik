/**
 * Canonical UI primitive library — Phase 2 Batch A.
 *
 * THE design-system component layer. Every primitive is token-driven
 * (design-system.md — zero inline hex / rgb() / arbitrary Tailwind values),
 * accessible by default (>= 44px touch targets, visible focus-visible ring,
 * correct semantics, prefers-reduced-motion aware, non-colour backups on
 * colour-coded state), and bilingual-safe (all copy via props/children, P7).
 *
 * Import canonical primitives from '@alfanumrik/ui/ui/primitives'. The legacy
 * "Wonder Blocks" set at '@alfanumrik/ui/ui' remains until pages migrate.
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
/* ── Menu: TYPES ONLY from this barrel. Import the COMPONENT from the module ──
 *
 *     import { Menu } from '@alfanumrik/ui/ui/primitives/Menu';   // ✅
 *     import { Menu } from '@alfanumrik/ui/ui/primitives';        // ❌ removed
 *
 * WHY, measured on the build that turned main red (PR #1624). `packages/ui`
 * has no `"sideEffects": false`, so webpack cannot prove this barrel pure and
 * emits a bare side-effect `require()` for EVERY module it re-exports. The
 * moment `Menu` gained its first real consumer (TabletNavRail's flag-gated
 * flyouts) that bare require made `Menu` a HARD, SYNCHRONOUS dependency of the
 * shared primitives chunk — which is initial on the 73 routes that touch any
 * primitive at all. Menu and the overlay foundation were emitted together as
 * `87234-<hash>.js` (3.6 kB gz) and appeared in 73 route RSC client-reference
 * manifests: +3.0 kB of first-load JS each, on routes like `/onboarding` and
 * `/settings` that never render a menu. That breached the P10 per-page ratchet
 * on 10 routes.
 *
 * Lazy-loading at the call site could not fix it on its own: the async import
 * in TabletNavRail compiled correctly (`l.e(87234)`) and moved nothing, because
 * this barrel was still pulling the same module in synchronously.
 *
 * The types cost nothing — `export type` is erased at compile time and emits no
 * require — so the authoring experience is unchanged for anyone typing a menu.
 * There were zero value-importers of `Menu` from this barrel when it was moved.
 *
 * The durable, broader fix is `"sideEffects": false` on packages/ui, which would
 * let webpack drop the unused re-exports for every primitive rather than just
 * this one. That is a package-wide tree-shaking change with real risk to
 * side-effect imports (CSS), so it is deliberately NOT bundled into a hot fix.
 * ─────────────────────────────────────────────────────────────────────────── */
export type { MenuProps, MenuItem, MenuPlacement } from './Menu';

/* ── Feedback / Navigation / Data primitives (Batch B3) ── */
export {
  ToastProvider,
  useToast,
  type ToastApi,
  type ToastOptions,
  type ToastProviderProps,
  type ToastTone,
} from './Toast';
export { Alert, type AlertProps, type AlertTone } from './Alert';
export {
  Tabs,
  TabList,
  Tab,
  TabPanel,
  type TabsProps,
  type TabListProps,
  type TabProps,
  type TabPanelProps,
} from './Tabs';
export {
  Table,
  type TableProps,
  type TableColumn,
  type TableAlign,
} from './Table';
export {
  Avatar,
  AvatarGroup,
  type AvatarProps,
  type AvatarGroupProps,
  type AvatarSize,
  type AvatarStatus,
} from './Avatar';

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
/* usePopoverPosition is TYPES ONLY from this barrel, for the same measured
 * reason as Menu above — it is Menu's exclusive dependency, and a value
 * re-export drags a dead second copy of it into the eager primitives chunk.
 * Import the hook from '.../overlay/usePopoverPosition'. */
export type {
  PopoverPlacement,
  PopoverCoords,
  UsePopoverPositionOptions,
  UsePopoverPositionResult,
} from './overlay';

export { type Tone, type ActionVariant, type ControlSize } from './tokens';
