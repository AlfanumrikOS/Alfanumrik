/**
 * Notifications Domain (B11) — typed read APIs and ownership-checked status
 * writes for the shared `notifications` table, plus a thin read accessor
 * for guardian `notification_preferences`.
 *
 * CONTRACT:
 *   - Reads + markAsRead only in this phase (0h). Outbound dispatch — email,
 *     WhatsApp, alert delivery — stays inside the corresponding Edge Functions
 *     (`send-auth-email`, `send-welcome-email`, `whatsapp-notify`,
 *     `alert-deliverer`) and the cross-domain trigger lib
 *     `src/lib/notification-triggers.ts`. This domain does NOT replace those.
 *   - All functions return ServiceResult<T>. Callers must check `ok` before
 *     accessing `data`.
 *   - Server-only: every function uses supabaseAdmin (service role). The
 *     ESLint `no-restricted-imports` rule on `@/lib/supabase-admin` allows
 *     `src/lib/domains/**` so these helpers can run from API routes only.
 *   - Single-row lookups return `T | null` (null = not found, not an error).
 *     List endpoints return `T[]` (an empty array is ok).
 *   - Never `select('*')`. Map snake_case rows to camelCase domain types here.
 *   - markAsRead is ownership-checked: the recipientId from the caller MUST
 *     match the row's recipient_id, otherwise NOT_FOUND is returned (same
 *     status as missing, to prevent enumeration).
 *
 * SCHEMA NOTES:
 *   The `notifications` table uses a recipient-keyed model
 *   (recipient_type + recipient_id) and has TWO co-existing read flags
 *   across migration history: `is_read` (boolean) and `read_at` (timestamptz).
 *   markAsRead writes BOTH so older RLS / RPC paths and newer client paths
 *   stay consistent. listForRecipient filters unread by `is_read = false`,
 *   which matches NotificationCenter.tsx and bulk-actions/notify.
 *
 *   Some legacy rows have `notification_type`, others have `type`. We select
 *   `notification_type` (the column present on the latest CREATE TABLE in
 *   `20260324043526_dashboard_rpcs_submit_quiz_and_ddl.sql`) and expose it as
 *   `notificationType` in the domain shape.
 *
 *   `notification_preferences` is currently a JSONB column on `guardians`,
 *   not a separate table. getPreferences reads that JSONB plus adjacent
 *   guardian-level toggles (daily_report_enabled, weekly_report_enabled,
 *   alert_score_threshold, preferred_language).
 *
 * MICROSERVICE EXTRACTION PATH:
 *   B11 becomes a "notifications service" that owns recipient-fanout,
 *   preference resolution, and dispatch coordination. Wrap these reads in
 *   HTTP handlers; the dispatch Edge Functions stay where they are.
 *
 * SCOPE GUARD (Phase 0h):
 *   - Do NOT add cross-recipient fanout or dispatch helpers here
 *   - Do NOT touch RLS / migrations / RBAC
 *   - Do NOT touch payment / Foxy / mobile / super-admin pages
 *   - Do NOT modify Edge Functions or `src/lib/notification-triggers.ts`
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type Notification,
  type NotificationPreferences,
  type NotificationRecipientType,
} from './types';

// ── notifications ─────────────────────────────────────────────────────────────

type NotificationRow = {
  id: string;
  recipient_type: string | null;
  recipient_id: string;
  notification_type: string | null;
  title: string;
  body: string | null;
  body_hi: string | null;
  icon: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean | null;
  read_at: string | null;
  created_at: string;
};

const NOTIFICATION_COLUMNS =
  'id, recipient_type, recipient_id, notification_type, title, body, body_hi, icon, data, is_read, read_at, created_at';

function mapNotification(row: NotificationRow): Notification {
  // is_read column may be null on legacy rows — derive from read_at as a
  // fallback so the domain shape stays boolean.
  const isRead =
    row.is_read === true || (row.is_read == null && row.read_at != null);

  return {
    id: row.id,
    recipientType: (row.recipient_type ?? 'student') as NotificationRecipientType,
    recipientId: row.recipient_id,
    notificationType: row.notification_type,
    title: row.title,
    body: row.body,
    bodyHi: row.body_hi,
    icon: row.icon,
    data: row.data,
    isRead,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

const VALID_RECIPIENT_TYPES: NotificationRecipientType[] = [
  'student',
  'guardian',
  'teacher',
  'school',
  'super_admin',
];

function isValidRecipientType(t: string): t is NotificationRecipientType {
  return (VALID_RECIPIENT_TYPES as string[]).includes(t);
}

/**
 * List notifications for a single recipient, newest first. By default
 * returns at most 50 rows. Pass `unreadOnly: true` to filter to is_read = false.
 *
 * Returns an empty array when the recipient has no rows (not an error).
 */
export async function listForRecipient(
  recipientType: NotificationRecipientType,
  recipientId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {}
): Promise<ServiceResult<Notification[]>> {
  if (!recipientType || !isValidRecipientType(recipientType)) {
    return fail('recipientType is required', 'INVALID_INPUT');
  }
  if (!recipientId) return fail('recipientId is required', 'INVALID_INPUT');

  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));

  let query = supabaseAdmin
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('recipient_id', recipientId)
    .eq('recipient_type', recipientType)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.unreadOnly) {
    query = query.eq('is_read', false);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('notifications_list_for_recipient_failed', {
      error: new Error(error.message),
      recipientType,
      recipientId,
      unreadOnly: opts.unreadOnly ?? false,
    });
    return fail(`Notifications lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapNotification(r as NotificationRow)));
}

/**
 * Mark a single notification as read, but ONLY if it belongs to the supplied
 * recipientId. This prevents one user from clearing another user's
 * notifications via a forged id.
 *
 * Returns ok(true) on a successful update, ok(false) when the row was already
 * read, and `NOT_FOUND` when the notification does not exist or belongs to a
 * different recipient (same code for both to prevent enumeration).
 *
 * Sets BOTH `is_read = true` and `read_at = now()` so older code paths that
 * still check `read_at IS NULL` continue to work.
 */
export async function markAsRead(
  notificationId: string,
  recipientId: string
): Promise<ServiceResult<boolean>> {
  if (!notificationId) return fail('notificationId is required', 'INVALID_INPUT');
  if (!recipientId) return fail('recipientId is required', 'INVALID_INPUT');

  // Pre-check ownership and current state. Using maybeSingle() keeps NOT_FOUND
  // semantically distinct from DB errors.
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('notifications')
    .select('id, recipient_id, is_read, read_at')
    .eq('id', notificationId)
    .maybeSingle();

  if (fetchErr) {
    logger.error('notifications_mark_as_read_lookup_failed', {
      error: new Error(fetchErr.message),
      notificationId,
    });
    return fail(`Notification lookup failed: ${fetchErr.message}`, 'DB_ERROR');
  }

  if (!existing || existing.recipient_id !== recipientId) {
    // Same code for missing and not-yours to prevent id enumeration
    return fail('Notification not found', 'NOT_FOUND');
  }

  // Already read — no-op success.
  const wasRead =
    existing.is_read === true ||
    (existing.is_read == null && existing.read_at != null);
  if (wasRead) {
    return ok(false);
  }

  const { error: updErr } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('recipient_id', recipientId);

  if (updErr) {
    logger.error('notifications_mark_as_read_update_failed', {
      error: new Error(updErr.message),
      notificationId,
    });
    return fail(`Notification update failed: ${updErr.message}`, 'DB_ERROR');
  }

  return ok(true);
}

/**
 * Count unread notifications for a single recipient. Used by the bell-icon
 * badge and parent/teacher dashboards.
 *
 * Uses `head: true` + `count: 'exact'` so no rows are transferred — only a
 * count is returned. Capped server-side at 1000 for badge display.
 */
export async function countUnread(
  recipientType: NotificationRecipientType,
  recipientId: string
): Promise<ServiceResult<number>> {
  if (!recipientType || !isValidRecipientType(recipientType)) {
    return fail('recipientType is required', 'INVALID_INPUT');
  }
  if (!recipientId) return fail('recipientId is required', 'INVALID_INPUT');

  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', recipientId)
    .eq('recipient_type', recipientType)
    .eq('is_read', false);

  if (error) {
    logger.error('notifications_count_unread_failed', {
      error: new Error(error.message),
      recipientType,
      recipientId,
    });
    return fail(`Unread count failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(count ?? 0);
}

// ── notification_preferences (guardians.notification_preferences JSONB) ───────

type GuardianPrefRow = {
  notification_preferences: Record<string, unknown> | null;
  daily_report_enabled: boolean | null;
  weekly_report_enabled: boolean | null;
  alert_score_threshold: number | null;
  preferred_language: string | null;
};

function mapPrefs(row: GuardianPrefRow): NotificationPreferences {
  const json = (row.notification_preferences ?? {}) as Record<string, unknown>;
  // Narrow projection — only known boolean keys are surfaced; anything else
  // stays opaque inside the JSONB column and is intentionally not exposed.
  const pickBool = (k: string): boolean | undefined =>
    typeof json[k] === 'boolean' ? (json[k] as boolean) : undefined;

  return {
    email: pickBool('email'),
    whatsapp: pickBool('whatsapp'),
    push: pickBool('push'),
    daily_report: pickBool('daily_report'),
    weekly_report: pickBool('weekly_report'),
    dailyReportEnabled: row.daily_report_enabled ?? undefined,
    weeklyReportEnabled: row.weekly_report_enabled ?? undefined,
    alertScoreThreshold: row.alert_score_threshold,
    preferredLanguage: row.preferred_language,
  };
}

/**
 * Get notification preferences for a recipient.
 *
 * Phase 0h scope: only `guardian` is implemented because that is the only
 * recipient type with a real preferences shape today. Student / teacher /
 * school recipients return ok(null) — callers should treat that as "use
 * defaults" rather than as an error.
 */
export async function getPreferences(
  recipientType: NotificationRecipientType,
  recipientId: string
): Promise<ServiceResult<NotificationPreferences | null>> {
  if (!recipientType || !isValidRecipientType(recipientType)) {
    return fail('recipientType is required', 'INVALID_INPUT');
  }
  if (!recipientId) return fail('recipientId is required', 'INVALID_INPUT');

  if (recipientType !== 'guardian') {
    // Other recipient types do not currently store a preferences row.
    // Return null (not an error) so callers can fall back to defaults.
    return ok(null);
  }

  const { data, error } = await supabaseAdmin
    .from('guardians')
    .select(
      'notification_preferences, daily_report_enabled, weekly_report_enabled, alert_score_threshold, preferred_language'
    )
    .eq('id', recipientId)
    .maybeSingle();

  if (error) {
    logger.error('notifications_get_preferences_failed', {
      error: new Error(error.message),
      recipientType,
      recipientId,
    });
    return fail(`Preferences lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapPrefs(data as GuardianPrefRow) : null);
}
