/**
 * POST /api/notifications/whatsapp
 *
 * Server-side route for sending WhatsApp messages via the whatsapp-notify Edge Function.
 * Restricted to admin users only (authorizeAdmin).
 *
 * Request body:
 *   type: 'daily_reminder' | 'score_notification' | 'streak_warning' | 'weekly_summary'
 *   recipient_phone: string (E.164 format)
 *   language: 'en' | 'hi'
 *   data: Record<string, string> (template variables)
 *   user_id?: string (optional, for audit logging)
 *
 * Response: { success: boolean, data?: { message_id }, error?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { isValidE164, redactPhone, getTemplate } from '@/lib/whatsapp-templates';
import type { WhatsAppTemplateType, WhatsAppLanguage } from '@/lib/whatsapp-templates';

const VALID_TYPES: WhatsAppTemplateType[] = [
  'daily_reminder',
  'score_notification',
  'streak_warning',
  'weekly_summary',
];

export async function POST(request: NextRequest) {
  // Auth: admin or system only
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const { type, recipient_phone, language, data, user_id } = body as {
      type: WhatsAppTemplateType;
      recipient_phone: string;
      language: WhatsAppLanguage;
      data: Record<string, string>;
      user_id?: string;
    };

    // ── Input validation ──

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    if (!recipient_phone || !isValidE164(recipient_phone)) {
      return NextResponse.json(
        { success: false, error: 'Invalid phone number. Must be E.164 format (e.g., +919876543210)' },
        { status: 400 },
      );
    }

    if (!language || !['en', 'hi'].includes(language)) {
      return NextResponse.json(
        { success: false, error: 'Invalid language. Must be "en" or "hi"' },
        { status: 400 },
      );
    }

    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid data object' },
        { status: 400 },
      );
    }

    // Validate template params
    const template = getTemplate(type, language);
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 400 },
      );
    }

    const missingParams = template.params.filter((p) => !data[p]);
    if (missingParams.length > 0) {
      return NextResponse.json(
        { success: false, error: `Missing template parameters: ${missingParams.join(', ')}` },
        { status: 400 },
      );
    }

    // ── Call Edge Function ──

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 },
      );
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/whatsapp-notify`;

    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type,
        recipient_phone,
        language,
        data,
        user_id,
      }),
    });

    const result = await response.json();

    // Audit log (P13: redact phone)
    await logAdminAudit(
      auth,
      'whatsapp_notification_sent',
      'notification',
      user_id ?? 'system',
      {
        template_type: type,
        language,
        recipient: redactPhone(recipient_phone),
        success: result.success,
      },
      request.headers.get('x-forwarded-for') ?? undefined,
    );

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: result.error || 'Edge Function returned an error', fallback: result.fallback },
        { status: response.status },
      );
    }

    return NextResponse.json({
      success: true,
      data: { message_id: result.message_id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Internal server error: ${message}` },
      { status: 500 },
    );
  }
}
