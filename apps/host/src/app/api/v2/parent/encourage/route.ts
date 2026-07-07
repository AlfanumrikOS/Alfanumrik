import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getGuardianByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { isGuardianLinkedToStudent } from '@alfanumrik/lib/domains/relationship';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import {
  getPreset,
  isValidMessageKey,
  DEFAULT_MESSAGE_KEY,
  type CheerPreset,
} from '@alfanumrik/lib/parent/cheer-catalog';

/**
 * POST /api/v2/parent/encourage — Parent sends a PRESET cheer to a linked child.
 * Permission: child.encourage
 * Resource check: parent must be linked to the student via guardian_student_links.
 *
 * Body: { student_id: string (UUID); message_key?: string }
 *
 * Behaviour:
 *   - Messages are NEVER free text (P12): only a curated preset key is accepted.
 *     A missing/absent key falls back to DEFAULT_MESSAGE_KEY; a PRESENT-but-
 *     unknown key is a 400.
 *   - One cheer per (guardian, student) per 6 hours (rate limit → 429).
 *   - On success: fans out to the child's notifications feed (send_notification
 *     RPC) AND records a parent_cheers row. Both writes use the service role
 *     because parent_cheers INSERT and notifications INSERT are service-role-only
 *     by RLS.
 *   - P13: logs only UUIDs (guardian_id / student_id), never names / emails /
 *     message text.
 *
 * Auth/ownership mirror /api/parent/report exactly:
 *   getGuardianByAuthUserId(auth.userId) + isGuardianLinkedToStudent(guardian.id, student_id).
 */

const RATE_LIMIT_HOURS = 6;

export async function POST(request: Request) {
  try {
    // ── 1. AuthZ (RBAC permission gate) ──
    const auth = await authorizeRequest(request, 'child.encourage');
    if (!auth.authorized) return auth.errorResponse!;

    // ── 2. Parse + validate body ──
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const { student_id, message_key } = (body ?? {}) as {
      student_id?: unknown;
      message_key?: unknown;
    };

    if (typeof student_id !== 'string' || !isValidUUID(student_id)) {
      return NextResponse.json(
        { success: false, error: 'Valid student_id is required' },
        { status: 400 }
      );
    }

    // Preset resolution:
    //   - absent / null / undefined → fall back to DEFAULT (do NOT 400)
    //   - present but not a known key → 400 (someone sent a bad/forged key)
    //   - present and valid          → use it
    let resolvedKey: string;
    if (message_key === undefined || message_key === null || message_key === '') {
      resolvedKey = DEFAULT_MESSAGE_KEY;
    } else if (typeof message_key === 'string' && isValidMessageKey(message_key)) {
      resolvedKey = message_key;
    } else {
      return NextResponse.json(
        { success: false, error: 'Unknown message_key' },
        { status: 400 }
      );
    }

    const preset = getPreset(resolvedKey) as CheerPreset; // resolvedKey is guaranteed valid
    const cheerType = preset.cheerType;

    // ── 3. Resolve guardian from auth user (same helper as /api/parent/report) ──
    const guardianResult = await getGuardianByAuthUserId(auth.userId!);
    if (!guardianResult.ok || !guardianResult.data) {
      return NextResponse.json(
        { success: false, error: 'No parent profile found' },
        { status: 403 }
      );
    }
    const guardian = guardianResult.data;

    // ── 4. Verify parent ↔ student link (same helper as /api/parent/report) ──
    const linkCheck = await isGuardianLinkedToStudent(guardian.id, student_id);
    if (!linkCheck.ok) {
      logger.error('parent_encourage_link_check_failed', {
        route: '/api/v2/parent/encourage',
        guardianId: guardian.id,
        studentId: student_id,
      });
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }
    if (!linkCheck.data) {
      return NextResponse.json(
        { success: false, error: 'You are not linked to this student' },
        { status: 403 }
      );
    }

    // ── 5. Rate limit: one cheer per (guardian, student) per 6h ──
    const sinceIso = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentErr } = await supabaseAdmin
      .from('parent_cheers')
      .select('id')
      .eq('guardian_id', guardian.id)
      .eq('student_id', student_id)
      .gt('created_at', sinceIso)
      .limit(1)
      .maybeSingle();

    if (recentErr) {
      logger.error('parent_encourage_rate_check_failed', {
        route: '/api/v2/parent/encourage',
        guardianId: guardian.id,
        studentId: student_id,
      });
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (recent) {
      return NextResponse.json(
        {
          success: false,
          error:
            'You have already cheered recently. Please wait a few hours before sending another. / आपने हाल ही में प्रोत्साहन भेजा है। कृपया कुछ घंटे रुककर दोबारा भेजें।',
        },
        { status: 429 }
      );
    }

    // ── 6. Pick the child's preferred language for the primary rendered strings.
    //       Both languages are always stored in `data` so the UI can switch. ──
    let prefersHindi = false;
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('preferred_language')
      .eq('id', student_id)
      .maybeSingle();
    if (studentRow?.preferred_language === 'hi') prefersHindi = true;

    const title = prefersHindi ? preset.titleHi : preset.titleEn;
    const cheerBody = prefersHindi ? preset.bodyHi : preset.bodyEn;

    // ── 7. Fan-out to the child's notifications feed via send_notification RPC.
    //       data jsonb carries UUIDs / enums / preset keys ONLY — no PII. ──
    const { data: notificationId, error: notifyErr } = await supabaseAdmin.rpc(
      'send_notification',
      {
        p_recipient_id: student_id,
        p_recipient_type: 'student',
        p_type: 'parent_cheer',
        p_title: title,
        p_body: cheerBody,
        p_data: {
          guardian_id: guardian.id,
          cheer_type: cheerType,
          message_key: resolvedKey,
          title_en: preset.titleEn,
          title_hi: preset.titleHi,
          body_en: preset.bodyEn,
          body_hi: preset.bodyHi,
          icon: preset.icon,
        },
        p_channel: 'in_app',
      }
    );

    if (notifyErr || !notificationId) {
      logger.error('parent_encourage_notify_failed', {
        route: '/api/v2/parent/encourage',
        guardianId: guardian.id,
        studentId: student_id,
      });
      return NextResponse.json(
        { success: false, error: 'Could not send cheer. Please try again later.' },
        { status: 502 }
      );
    }

    // ── 8. Record the parent_cheers row (service role; RLS allows service insert). ──
    const { error: cheerErr } = await supabaseAdmin.from('parent_cheers').insert({
      guardian_id: guardian.id,
      student_id,
      cheer_type: cheerType,
      message_key: resolvedKey,
      notification_id: notificationId,
    });

    if (cheerErr) {
      // The notification already fired; the cheer record failed. Log and report
      // a server error so the client knows the audit record didn't persist, but
      // the child still received the encouragement.
      logger.error('parent_encourage_cheer_insert_failed', {
        route: '/api/v2/parent/encourage',
        guardianId: guardian.id,
        studentId: student_id,
      });
      return NextResponse.json(
        { success: false, error: 'Could not record cheer. Please try again later.' },
        { status: 500 }
      );
    }

    // ── 9. Audit trail (UUIDs / enums / keys only — no PII). ──
    logAudit(auth.userId!, {
      action: 'parent.child_encouraged',
      resourceType: 'parent_cheer',
      resourceId: student_id,
      details: { cheer_type: cheerType, message_key: resolvedKey },
      status: 'success',
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    logger.error('parent_encourage_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/parent/encourage',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
