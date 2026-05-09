'use client';

/**
 * Re-export shim — Plan 0 Task 3.
 *
 * The canonical StatusBadge now lives at src/components/admin-ui/StatusBadge.tsx
 * so it can be shared by /super-admin, /school-admin, /teacher and /parent
 * shells. This file is kept temporarily so existing super-admin call sites keep
 * working without an import-site sweep.
 *
 * New code should import from '@/components/admin-ui/StatusBadge' directly.
 */

export { StatusBadge, type StatusBadgeProps, type StatusBadgeVariant } from '@/components/admin-ui/StatusBadge';
export { default } from '@/components/admin-ui/StatusBadge';
