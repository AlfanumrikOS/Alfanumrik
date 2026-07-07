'use client';

/**
 * Re-export shim — Plan 0 Task 2.
 *
 * The canonical StatCard now lives at src/components/admin-ui/StatCard.tsx
 * so it can be shared by /super-admin, /school-admin, /teacher and /parent
 * shells. This file is kept temporarily so existing super-admin call sites keep
 * working without an import-site sweep.
 *
 * New code should import from '@alfanumrik/ui/admin-ui/StatCard' directly.
 */

export { StatCard, type StatCardProps } from '@alfanumrik/ui/admin-ui/StatCard';
export { default } from '@alfanumrik/ui/admin-ui/StatCard';
