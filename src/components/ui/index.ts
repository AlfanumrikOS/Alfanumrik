/**
 * src/components/ui — barrel.
 *
 * ┌─ Legacy "Wonder Blocks" (unchanged public surface) ──────────────┐
 * │ The pre-existing single-file component set (Button, Card, Badge,  │
 * │ ProgressBar, Skeleton, EmptyState, LoadingFoxy, MasteryRing, …)   │
 * │ moved from index.tsx → wonder-blocks.tsx. It is re-exported here  │
 * │ verbatim so the ~134 existing `@/components/ui` consumers keep    │
 * │ working byte-for-byte until they are migrated in later phases.    │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * The CANONICAL Phase-2 primitive library lives under
 * `@/components/ui/primitives`. Its names intentionally collide with the
 * legacy set (Button, Card, Badge, …) with a cleaner, stricter API, so it
 * is exposed here under the `primitives` namespace rather than clobbering
 * the legacy root names. New work should:
 *
 *     import { Button, Card, Badge } from '@/components/ui/primitives';
 *
 * Once a page migrates off Wonder Blocks, the canonical set is promoted to
 * the root barrel and the legacy import is dropped.
 */

export * from './wonder-blocks';
export * as primitives from './primitives';
