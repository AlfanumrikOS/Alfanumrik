/**
 * /api/foxy — safeguarding escalation fan-out (Phase 1, ff_safeguarding_v1).
 *
 * Clones the teacher→school-admin fan-out shape from
 * `src/app/api/teacher/escalate/route.ts` (T13): resolve the student's
 * school's ACTIVE `school_admins` rows and insert ONE generic `notifications`
 * row per admin. Differences from the teacher flow, by design:
 *
 *   - sender is the SYSTEM (sender_id null, sender_type 'system') — no human
 *     initiated this.
 *   - `data` carries { escalation_id, category } ONLY. NEVER the disclosure
 *     excerpt, NEVER the student's name/message text (P13). The reviewing
 *     admin opens the escalation detail (which is itself excerpt-gated to the
 *     single-row detail view) through the review surface.
 *   - Zero active admins is NOT an error and does NOT drop the case: the
 *     `safeguarding_escalations` row still stands and surfaces in the
 *     super-admin review queue (`/api/super-admin/safeguarding`). We simply
 *     return notifiedAdminCount 0.
 *
 * Returns COUNTS ONLY. Never throws — any failure logs (P13: ids/counts only)
 * and returns zero counts so the Foxy terminal response is never blocked.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export interface SafeguardingEscalateResult {
  notifiedAdminCount: number;
}

export async function escalateSafeguarding(params: {
  /** safeguarding_escalations.id — the already-inserted case row. */
  escalationId: string;
  /** students.school_id — null for B2C students (no school → no fan-out). */
  schoolId: string | null;
  /** Confirmed safeguarding category (enum code, non-PII). */
  category: string;
}): Promise<SafeguardingEscalateResult> {
  const { escalationId, schoolId, category } = params;

  try {
    // B2C student (no school): the escalation row still stands and surfaces
    // in the super-admin queue; there is simply nobody school-side to notify.
    if (!schoolId) {
      return { notifiedAdminCount: 0 };
    }

    // Resolve the school's active admin(s) — mirrors teacher/escalate:132-137.
    const { data: admins, error: adminsErr } = await supabaseAdmin
      .from('school_admins')
      .select('id')
      .eq('school_id', schoolId)
      .eq('is_active', true);

    if (adminsErr) {
      logger.error('safeguarding_escalate_admin_lookup_failed', {
        error: new Error(adminsErr.message),
        route: 'foxy/safeguarding-escalate',
        escalationId,
      });
      return { notifiedAdminCount: 0 };
    }

    const adminRows = (admins ?? []) as { id: string }[];
    if (adminRows.length === 0) {
      // Counts-only log — the row still stands in the super-admin queue.
      logger.warn('safeguarding_escalate_no_active_admins', {
        route: 'foxy/safeguarding-escalate',
        escalationId,
      });
      return { notifiedAdminCount: 0 };
    }

    // One notifications row per active admin. `data` is metadata-ONLY:
    // { escalation_id, category }. The disclosure excerpt NEVER rides a
    // notification payload (P13).
    const rowsToInsert = adminRows.map((admin) => ({
      recipient_id: admin.id,
      recipient_type: 'school_admin',
      sender_id: null,
      sender_type: 'system',
      type: 'safeguarding_escalation',
      notification_type: 'safeguarding_escalation',
      title: 'Safeguarding alert',
      message: 'A student wellbeing concern needs your review.',
      body: 'A student wellbeing concern needs your review.',
      data: {
        escalation_id: escalationId,
        category,
      },
      is_read: false,
      delivery_channel: 'in_app',
    }));

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('notifications')
      .insert(rowsToInsert)
      .select('id');

    if (insertErr || !inserted) {
      logger.error('safeguarding_escalate_notification_insert_failed', {
        error: new Error(insertErr?.message ?? 'no rows returned'),
        route: 'foxy/safeguarding-escalate',
        escalationId,
      });
      return { notifiedAdminCount: 0 };
    }

    return { notifiedAdminCount: (inserted as { id: string }[]).length };
  } catch (err) {
    logger.error('safeguarding_escalate_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'foxy/safeguarding-escalate',
      escalationId,
    });
    return { notifiedAdminCount: 0 };
  }
}
