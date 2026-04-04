/**
 * WhatsApp Business API message template definitions.
 *
 * These correspond to pre-approved templates in the Meta WhatsApp Business dashboard.
 * Template names and parameter lists must match exactly what was approved.
 *
 * Bilingual: each template has an English and Hindi variant (P7).
 */

export interface WhatsAppTemplate {
  /** Template name as registered in Meta Business Manager */
  id: string;
  /** Ordered parameter names — values are substituted into {{1}}, {{2}}, etc. */
  params: readonly string[];
}

export type WhatsAppTemplateType =
  | 'daily_reminder'
  | 'score_notification'
  | 'streak_warning'
  | 'weekly_summary';

export type WhatsAppLanguage = 'en' | 'hi';

export const WHATSAPP_TEMPLATES: Record<
  WhatsAppTemplateType,
  Record<WhatsAppLanguage, WhatsAppTemplate>
> = {
  daily_reminder: {
    en: {
      id: 'daily_study_reminder',
      params: ['student_name', 'streak_count', 'subject_suggestion'],
    },
    hi: {
      id: 'daily_study_reminder_hi',
      params: ['student_name', 'streak_count', 'subject_suggestion'],
    },
  },
  score_notification: {
    en: {
      id: 'quiz_score_parent',
      params: ['student_name', 'subject', 'score', 'xp_earned'],
    },
    hi: {
      id: 'quiz_score_parent_hi',
      params: ['student_name', 'subject', 'score', 'xp_earned'],
    },
  },
  streak_warning: {
    en: {
      id: 'streak_warning',
      params: ['student_name', 'streak_count'],
    },
    hi: {
      id: 'streak_warning_hi',
      params: ['student_name', 'streak_count'],
    },
  },
  weekly_summary: {
    en: {
      id: 'weekly_progress_summary',
      params: ['student_name', 'quizzes_completed', 'avg_score', 'xp_earned', 'streak_days'],
    },
    hi: {
      id: 'weekly_progress_summary_hi',
      params: ['student_name', 'quizzes_completed', 'avg_score', 'xp_earned', 'streak_days'],
    },
  },
} as const;

/**
 * Look up template by type and language. Returns null for unknown types.
 */
export function getTemplate(
  type: WhatsAppTemplateType,
  language: WhatsAppLanguage,
): WhatsAppTemplate | null {
  return WHATSAPP_TEMPLATES[type]?.[language] ?? null;
}

/**
 * Build the WhatsApp Cloud API template message body.
 * Maps ordered params to {{1}}, {{2}}, ... component parameters.
 */
export function buildTemplatePayload(
  template: WhatsAppTemplate,
  recipientPhone: string,
  language: WhatsAppLanguage,
  data: Record<string, string>,
): Record<string, unknown> {
  const parameters = template.params.map((paramName) => ({
    type: 'text',
    text: data[paramName] ?? '',
  }));

  return {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'template',
    template: {
      name: template.id,
      language: {
        code: language === 'hi' ? 'hi' : 'en',
      },
      components: [
        {
          type: 'body',
          parameters,
        },
      ],
    },
  };
}

/**
 * Validate E.164 phone number format.
 * Indian numbers: +91 followed by 10 digits.
 * Also accepts other country codes.
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/**
 * Redact phone number for logging (P13 compliance).
 * "+919876543210" → "+91****3210"
 */
export function redactPhone(phone: string): string {
  if (!phone || phone.length < 8) return '***';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}
