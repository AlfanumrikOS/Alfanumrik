/**
 * Ops Domain (B13) — read-only helpers for super-admin / ops surfaces.
 *
 * CONTRACT:
 *   - Every helper here is read-only. B13 never writes into another
 *     bounded context's tables. Writes to `support_tickets` and
 *     `feature_flags` happen inside dedicated API routes that already
 *     log to the audit trail; this module is the read side.
 *   - Every helper uses `supabaseAdmin` (service role). The ESLint
 *     `no-restricted-imports` rule on `@/lib/supabase-admin` keeps these
 *     out of client components; `src/lib/domains/**` is in the allow-list.
 *   - Every helper returns ServiceResult<T> — no throws, no silent nulls.
 *   - Single-row lookups return `ServiceResult<T | null>`. Reserve
 *     `NOT_FOUND` for routes that want 404 semantics.
 *   - List queries return `ServiceResult<T[]>`. An empty array is `ok`.
 *   - Never `select('*')`. Map snake_case columns to the camelCase
 *     domain type once, here, so callers don't depend on database column
 *     names.
 *
 * NON-DUPLICATION NOTE (feature_flags):
 *   `src/lib/feature-flags.ts` is the canonical reader for the
 *   `feature_flags` table. It owns scoping (env / role / institution /
 *   rollout %) and a 5-minute in-memory cache. The ops domain MUST NOT
 *   re-implement those reads. The single banner-shaped helper here only
 *   projects the `metadata` JSONB into a typed shape — server callers
 *   that just need the boolean kill-switch should stay on
 *   `isFeatureEnabled` / `getFeatureFlagsSimple`.
 *
 * SCOPE GUARD (Phase 0j):
 *   - Do NOT migrate routes here.
 *   - Do NOT touch Edge Functions, RLS policies, migrations, RBAC, or
 *     `src/lib/audit.ts`.
 *   - Do NOT add write helpers in this phase. Writes stay in the
 *     existing API routes (`/api/support/ticket`,
 *     `/api/internal/admin/support`, `/api/v1/admin/roles`).
 *
 * MISSING TABLES:
 *   `support_tickets` and `admin_users` are physical tables (see
 *   migrations `20260322070714_create_support_tickets_table.sql` and
 *   `20260324070000_production_rbac_system.sql`). If a referenced table
 *   is not yet provisioned in a given environment Postgres returns code
 *   `42P01`; we map this to a single warn log and a `DB_ERROR`
 *   ServiceResult so callers can degrade gracefully without crashing.
 *   This mirrors the precedent set by Phase 0i (analytics).
 *
 * MICROSERVICE EXTRACTION PATH:
 *   B13 is a candidate for early extraction because it is read-only
 *   against every other context. Wrap each function in an HTTP handler,
 *   add admin auth, and the super-admin / internal-admin surfaces
 *   consume it via HTTP.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type MaintenanceBanner,
  type SupportTicket,
  type AdminUser,
} from './types';

// ── Postgres "relation does not exist" detection ──────────────────────────────
//
// When a referenced table is not yet provisioned, Postgres returns SQLSTATE
// 42P01. Treat this as a soft-failure DB_ERROR and warn once; never throw.
// Mirrors the helper in `analytics.ts` (Phase 0i).

interface PgErrorLike {
  code?: string;
  message: string;
}

function isMissingRelation(err: PgErrorLike | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42P01') return true;
  // The supabase-js PostgrestError sometimes only surfaces the message text.
  return /relation .* does not exist/i.test(err.message ?? '');
}

// ── Maintenance banner (read-only projection of feature_flags row) ───────────
//
// Backed by `feature_flags` WHERE flag_name='maintenance_banner'. The flag's
// `metadata` JSONB carries `message_en` and `message_hi`. When the row does
// not exist (e.g. the seed migration has not run yet) we return ok(null) —
// callers should treat that as "no banner".

const MAINTENANCE_BANNER_FLAG = 'maintenance_banner';

type MaintenanceBannerRow = {
  is_enabled: boolean | null;
  metadata: Record<string, unknown> | null;
};

function mapMaintenanceBanner(row: MaintenanceBannerRow): MaintenanceBanner {
  const meta = row.metadata ?? null;
  const messageEn =
    meta && typeof meta === 'object' && typeof meta.message_en === 'string'
      ? (meta.message_en as string)
      : null;
  const messageHi =
    meta && typeof meta === 'object' && typeof meta.message_hi === 'string'
      ? (meta.message_hi as string)
      : null;

  return {
    isEnabled: row.is_enabled === true,
    messageEn,
    messageHi,
    metadata: meta,
  };
}

/**
 * Fetch the maintenance banner row, if present.
 *
 * Returns `ok(null)` when no `maintenance_banner` row exists — callers
 * should treat that as "no banner". Returns `ok(banner)` even when
 * `isEnabled === false`, so callers can decide whether to render the
 * banner UI based on the row state.
 *
 * Use `isFeatureEnabled('maintenance_banner', ctx)` from
 * `src/lib/feature-flags.ts` when you only need the boolean toggle and
 * want the cached / scoped path.
 */
export async function getMaintenanceBanner(): Promise<
  ServiceResult<MaintenanceBanner | null>
> {
  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .select('is_enabled, metadata')
    .eq('flag_name', MAINTENANCE_BANNER_FLAG)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('ops_feature_flags_table_missing', {
        message: error.message,
      });
      return fail('feature_flags table is not provisioned', 'DB_ERROR');
    }
    logger.error('ops_get_maintenance_banner_failed', {
      error: new Error(error.message),
    });
    return fail(
      `maintenance_banner lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(data ? mapMaintenanceBanner(data as MaintenanceBannerRow) : null);
}

// ── Support tickets ───────────────────────────────────────────────────────────

type SupportTicketRow = {
  id: string;
  student_id: string | null;
  email: string | null;
  category: string;
  subject: string | null;
  message: string;
  status: string;
  user_role: string | null;
  user_name: string | null;
  device_info: string | null;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
};

const SUPPORT_TICKET_COLUMNS =
  'id, student_id, email, category, subject, message, status, user_role, user_name, device_info, admin_notes, created_at, resolved_at';

function mapSupportTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    studentId: row.student_id,
    email: row.email,
    category: row.category,
    subject: row.subject,
    message: row.message,
    status: row.status,
    userRole: row.user_role,
    userName: row.user_name,
    deviceInfo: row.device_info,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/**
 * List support tickets, newest first.
 *
 * The query is bounded by both `limit` (max 200; default 50) and an
 * implicit caller-supplied filter — admin pages always pass a `status`
 * (`open`, `pending`, `resolved`) and ad-hoc paging is done with smaller
 * limits. Without filters, the helper still caps at 200 to prevent
 * accidental full-table scans.
 *
 * Filters (optional):
 *   - userId  → `student_id = userId`
 *   - status  → `status = status` (e.g. 'open', 'pending', 'resolved')
 *   - limit   → 1..200, default 50
 */
export async function listSupportTickets(
  opts: { userId?: string; status?: string; limit?: number } = {}
): Promise<ServiceResult<SupportTicket[]>> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));

  let query = supabaseAdmin
    .from('support_tickets')
    .select(SUPPORT_TICKET_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.userId) query = query.eq('student_id', opts.userId);
  if (opts.status) query = query.eq('status', opts.status);

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('ops_support_tickets_table_missing', {
        message: error.message,
      });
      return fail('support_tickets table is not provisioned', 'DB_ERROR');
    }
    logger.error('ops_list_support_tickets_failed', {
      error: new Error(error.message),
      userId: opts.userId ?? null,
      status: opts.status ?? null,
    });
    return fail(`support_tickets lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapSupportTicket(r as SupportTicketRow)));
}

/**
 * Look up a single support ticket by id.
 *
 * Returns `ok(null)` when the id does not resolve — callers that want
 * 404 semantics should check for `data === null` explicitly. Does NOT
 * enforce ownership; callers are admin-gated routes that have already
 * verified the requester is super-admin / admin via
 * `requireAdminSecret` or `authorizeAdmin`.
 */
export async function getSupportTicket(
  ticketId: string
): Promise<ServiceResult<SupportTicket | null>> {
  if (!ticketId) return fail('ticketId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(SUPPORT_TICKET_COLUMNS)
    .eq('id', ticketId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('ops_support_tickets_table_missing', {
        message: error.message,
      });
      return fail('support_tickets table is not provisioned', 'DB_ERROR');
    }
    logger.error('ops_get_support_ticket_failed', {
      error: new Error(error.message),
      ticketId,
    });
    return fail(`support_tickets lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapSupportTicket(data as SupportTicketRow) : null);
}

// ── Admin users ───────────────────────────────────────────────────────────────
//
// Reads the physical `admin_users` table introduced by
// `20260324070000_production_rbac_system.sql`. The DATA_OWNERSHIP_MATRIX
// describes admin_users as "alias for user_roles WHERE role='admin'", but
// the production schema actually materialises it as its own table — RLS
// policies on roughly 30 migrations join through `admin_users`. We read
// the table directly here.

type AdminUserRow = {
  id: string;
  auth_user_id: string;
  name: string;
  email: string | null;
  admin_level: string;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

const ADMIN_USER_COLUMNS =
  'id, auth_user_id, name, email, admin_level, is_active, created_at, updated_at';

function mapAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.name,
    email: row.email,
    adminLevel: row.admin_level,
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List admin users.
 *
 * By default returns active admins only (matches the RLS check used in
 * 30+ migrations: `auth.uid() IN (SELECT auth_user_id FROM admin_users
 * WHERE is_active = true)`). Pass `includeInactive: true` to include
 * suspended / deactivated rows for an audit-style view.
 *
 * Result is ordered by `admin_level` (super_admin first by string sort)
 * then `name` for stable display.
 */
export async function listAdminUsers(
  opts: { includeInactive?: boolean } = {}
): Promise<ServiceResult<AdminUser[]>> {
  let query = supabaseAdmin
    .from('admin_users')
    .select(ADMIN_USER_COLUMNS)
    .order('admin_level', { ascending: true })
    .order('name', { ascending: true });

  if (!opts.includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('ops_admin_users_table_missing', {
        message: error.message,
      });
      return fail('admin_users table is not provisioned', 'DB_ERROR');
    }
    logger.error('ops_list_admin_users_failed', {
      error: new Error(error.message),
      includeInactive: opts.includeInactive ?? false,
    });
    return fail(`admin_users lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapAdminUser(r as AdminUserRow)));
}
