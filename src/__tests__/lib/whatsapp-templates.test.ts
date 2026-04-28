/**
 * WhatsApp Templates — unit tests.
 *
 * Covers the pure helpers in src/lib/whatsapp-templates.ts:
 *   - getTemplate(): name + language lookup with bilingual ids (P7)
 *   - buildTemplatePayload(): WhatsApp Cloud API body shape
 *   - isValidE164(): phone-format gate
 *   - redactPhone(): P13 logging redaction
 *
 * Part of the global-coverage installment-1 ratchet — these helpers had 0%
 * coverage before this file landed.
 */

import { describe, it, expect } from 'vitest';
import {
  WHATSAPP_TEMPLATES,
  getTemplate,
  buildTemplatePayload,
  isValidE164,
  redactPhone,
} from '@/lib/whatsapp-templates';

describe('getTemplate', () => {
  it('returns the English template for daily_reminder', () => {
    const t = getTemplate('daily_reminder', 'en');
    expect(t).not.toBeNull();
    expect(t!.id).toBe('daily_study_reminder');
    expect(t!.params).toEqual(['student_name', 'streak_count', 'subject_suggestion']);
  });

  it('returns the Hindi template for daily_reminder (P7 bilingual)', () => {
    const t = getTemplate('daily_reminder', 'hi');
    expect(t).not.toBeNull();
    expect(t!.id).toBe('daily_study_reminder_hi');
  });

  it('returns distinct ids for English and Hindi variants', () => {
    for (const type of Object.keys(WHATSAPP_TEMPLATES) as Array<keyof typeof WHATSAPP_TEMPLATES>) {
      const en = getTemplate(type, 'en');
      const hi = getTemplate(type, 'hi');
      expect(en).not.toBeNull();
      expect(hi).not.toBeNull();
      expect(en!.id).not.toBe(hi!.id);
      // Same params surface for both languages so caller doesn't branch on language
      expect(en!.params).toEqual(hi!.params);
    }
  });

  it('returns null for an unknown template type', () => {
    // @ts-expect-error — deliberately invalid type to test defensive shape
    expect(getTemplate('nonexistent_type', 'en')).toBeNull();
  });
});

describe('buildTemplatePayload', () => {
  const template = WHATSAPP_TEMPLATES.score_notification.en;

  it('produces the WhatsApp Cloud API body with template name and language', () => {
    const payload = buildTemplatePayload(template, '+919876543210', 'en', {
      student_name: 'Ravi',
      subject: 'Math',
      score: '85',
      xp_earned: '90',
    }) as Record<string, unknown>;

    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.to).toBe('+919876543210');
    expect(payload.type).toBe('template');

    const tpl = payload.template as Record<string, unknown>;
    expect(tpl.name).toBe('quiz_score_parent');
    expect((tpl.language as { code: string }).code).toBe('en');
  });

  it('maps params in declared order to body parameters', () => {
    const payload = buildTemplatePayload(template, '+919999999999', 'en', {
      student_name: 'Ravi',
      subject: 'Math',
      score: '85',
      xp_earned: '90',
    }) as Record<string, unknown>;

    const components = (payload.template as { components: Array<Record<string, unknown>> }).components;
    expect(components).toHaveLength(1);
    expect(components[0].type).toBe('body');
    const params = components[0].parameters as Array<{ type: string; text: string }>;
    expect(params).toEqual([
      { type: 'text', text: 'Ravi' },
      { type: 'text', text: 'Math' },
      { type: 'text', text: '85' },
      { type: 'text', text: '90' },
    ]);
  });

  it('substitutes empty string for missing param keys (defensive)', () => {
    const payload = buildTemplatePayload(template, '+919999999999', 'en', {
      // student_name intentionally omitted
      subject: 'Math',
      score: '85',
      // xp_earned intentionally omitted
    }) as Record<string, unknown>;

    const params = (payload.template as { components: Array<{ parameters: Array<{ text: string }> }> })
      .components[0].parameters;
    expect(params[0].text).toBe('');
    expect(params[1].text).toBe('Math');
    expect(params[3].text).toBe('');
  });

  it('uses the Hindi language code for hi templates', () => {
    const hiTemplate = WHATSAPP_TEMPLATES.score_notification.hi;
    const payload = buildTemplatePayload(hiTemplate, '+919999999999', 'hi', {
      student_name: 'राहुल',
      subject: 'Math',
      score: '85',
      xp_earned: '90',
    }) as Record<string, unknown>;

    expect((payload.template as { language: { code: string } }).language.code).toBe('hi');
  });
});

describe('isValidE164', () => {
  it('accepts a valid Indian +91 mobile number', () => {
    expect(isValidE164('+919876543210')).toBe(true);
  });

  it('accepts other country codes', () => {
    expect(isValidE164('+12025550199')).toBe(true);
    expect(isValidE164('+447911123456')).toBe(true);
  });

  it('rejects numbers without leading +', () => {
    expect(isValidE164('919876543210')).toBe(false);
  });

  it('rejects numbers starting with +0', () => {
    expect(isValidE164('+0123456789')).toBe(false);
  });

  it('rejects too-short strings', () => {
    expect(isValidE164('+1234')).toBe(false);
  });

  it('rejects too-long strings (>15 digits)', () => {
    expect(isValidE164('+1234567890123456')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidE164('')).toBe(false);
  });

  it('rejects strings with non-digits after +', () => {
    expect(isValidE164('+91abc1234567')).toBe(false);
  });
});

describe('redactPhone', () => {
  it('redacts the middle digits of a typical Indian number', () => {
    expect(redactPhone('+919876543210')).toBe('+91****3210');
  });

  it('preserves first 3 and last 4 characters', () => {
    const result = redactPhone('+447911123456');
    expect(result.startsWith('+44')).toBe(true);
    expect(result.endsWith('3456')).toBe(true);
    expect(result).toContain('****');
  });

  it('returns *** for empty string', () => {
    expect(redactPhone('')).toBe('***');
  });

  it('returns *** for too-short input', () => {
    expect(redactPhone('+1234')).toBe('***');
  });

  it('does not leak full digits even on edge-length input', () => {
    const result = redactPhone('+12345678');
    // Length >= 8 → goes through normal path; verify no full original appears.
    expect(result).not.toBe('+12345678');
    expect(result).toContain('****');
  });
});
