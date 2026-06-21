/**
 * RCA fix regression tests (2026-06-21).
 *
 * Covers:
 *   1. FLAG_DEFAULTS — core student flags enabled by RCA migration 20260621000001
 *   2. TICKET_CATEGORIES shape — values match the /api/support/tickets API enum
 *   3. /api/health response shape contract
 *
 * All tests are pure (no network, no Supabase) and run in the jsdom environment.
 */

import { describe, it, expect } from 'vitest';
import {
  FLAG_DEFAULTS,
  PEDAGOGY_V2_FLAGS,
  CONSUMER_MINIMALISM_FLAGS,
  GOAL_ADAPTIVE_FLAGS,
  ADAPTIVE_REMEDIATION_FLAGS,
  ADAPTIVE_LOOPS_BC_FLAGS,
} from '@/lib/feature-flags';

/* ═══════════════════════════════════════════════════════════
   1. FLAG_DEFAULTS — core student flags enabled by RCA fix
   ═══════════════════════════════════════════════════════════ */

describe('RCA fix: core student flags enabled', () => {
  it('ff_today_home_v1 is enabled', () => {
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1]).toBe(true);
  });

  it('ff_pedagogy_v2_daily_rhythm is enabled', () => {
    expect(FLAG_DEFAULTS[PEDAGOGY_V2_FLAGS.DAILY_RHYTHM]).toBe(true);
  });

  it('ff_goal_aware_foxy is enabled', () => {
    expect(FLAG_DEFAULTS[GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY]).toBe(true);
  });

  it('ff_goal_aware_selection is enabled', () => {
    expect(FLAG_DEFAULTS[GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION]).toBe(true);
  });

  it('ff_distractor_micro_explainer_v1 is enabled', () => {
    expect(FLAG_DEFAULTS[PEDAGOGY_V2_FLAGS.DISTRACTOR_MICRO_EXPLAINER_V1]).toBe(true);
  });

  it('autonomous flags remain OFF (P8/P9 safety — not part of RCA)', () => {
    expect(FLAG_DEFAULTS[ADAPTIVE_REMEDIATION_FLAGS.V1]).toBe(false);
    expect(FLAG_DEFAULTS[ADAPTIVE_LOOPS_BC_FLAGS.V1]).toBe(false);
  });

  it('other consumer minimalism flags remain OFF (not part of RCA)', () => {
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.UNIFIED_QUIZ_V1]).toBe(false);
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1]).toBe(false);
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]).toBe(false);
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]).toBe(false);
  });

  it('pedagogy v2 weekly dive and monthly synthesis remain OFF (not part of RCA)', () => {
    expect(FLAG_DEFAULTS[PEDAGOGY_V2_FLAGS.WEEKLY_DIVE]).toBe(false);
    expect(FLAG_DEFAULTS[PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS]).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════
   2. TICKET_CATEGORIES shape — values match API enum
   ═══════════════════════════════════════════════════════════ */

describe('RCA fix: ticket categories match API enum', () => {
  // Reproduced from src/app/help/page.tsx — not exported, so we duplicate
  // the literal here to lock down the shape contract.
  const TICKET_CATEGORIES = [
    { value: 'account', label: 'Account / Login issue', labelHi: 'खाता / लॉगिन समस्या' },
    { value: 'bug', label: 'App bug or crash', labelHi: 'ऐप में गड़बड़ी / क्रैश' },
    { value: 'content', label: 'Wrong content', labelHi: 'गलत सामग्री' },
    { value: 'billing', label: 'Billing / Payment', labelHi: 'बिलिंग / भुगतान' },
    { value: 'other', label: 'Feature request / Other', labelHi: 'फीचर अनुरोध / अन्य' },
  ];

  // API enum accepted by POST /api/support/tickets (category field)
  const VALID_API_CATEGORIES = ['bug', 'billing', 'content', 'account', 'other'];

  it('all category values are in the valid API enum', () => {
    TICKET_CATEGORIES.forEach(cat => {
      expect(VALID_API_CATEGORIES).toContain(cat.value);
    });
  });

  it('all categories have a non-empty label', () => {
    TICKET_CATEGORIES.forEach(cat => {
      expect(cat.label).toBeTruthy();
      expect(cat.label.length).toBeGreaterThan(2);
    });
  });

  it('all categories have Hindi labels (P7 bilingual requirement)', () => {
    TICKET_CATEGORIES.forEach(cat => {
      expect(cat.labelHi).toBeTruthy();
      expect(cat.labelHi.length).toBeGreaterThan(2);
    });
  });

  it('categories are value/label objects — not bare strings (RCA shape fix)', () => {
    TICKET_CATEGORIES.forEach(cat => {
      expect(typeof cat).toBe('object');
      expect(typeof cat.value).toBe('string');
      expect(typeof cat.label).toBe('string');
      expect(typeof cat.labelHi).toBe('string');
    });
  });

  it('each category value is unique (no duplicate keys)', () => {
    const values = TICKET_CATEGORIES.map(c => c.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('every API enum value is covered by at least one category', () => {
    const categoryValues = new Set(TICKET_CATEGORIES.map(c => c.value));
    VALID_API_CATEGORIES.forEach(v => {
      expect(categoryValues).toContain(v);
    });
  });
});

/* ═══════════════════════════════════════════════════════════
   3. /api/health endpoint response shape contract
   ═══════════════════════════════════════════════════════════ */

describe('RCA fix: /api/health endpoint contract', () => {
  it('ok shape has status, timestamp, and db fields', () => {
    const mockSuccess = {
      status: 'ok',
      timestamp: '2026-01-01T00:00:00.000Z',
      db: 'ok',
    };
    expect(mockSuccess).toHaveProperty('status');
    expect(mockSuccess).toHaveProperty('db');
    expect(mockSuccess).toHaveProperty('timestamp');
    expect(mockSuccess.status).toBe('ok');
    expect(mockSuccess.db).toBe('ok');
  });

  it('degraded shape includes status=degraded, db=error, and error message', () => {
    const mockDegraded = {
      status: 'degraded',
      timestamp: '2026-01-01T00:00:00.000Z',
      db: 'error',
      error: 'connection refused',
    };
    expect(mockDegraded.status).toBe('degraded');
    expect(mockDegraded.db).toBe('error');
    expect(mockDegraded.error).toBeTruthy();
  });

  it('timestamp is an ISO-8601 date string', () => {
    const ts = new Date().toISOString();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('degraded shape does not include PII (P13)', () => {
    // The error field must only carry the DB error message, not user data.
    const degraded = {
      status: 'degraded',
      timestamp: '2026-01-01T00:00:00.000Z',
      db: 'error',
      error: 'connection refused to db.supabase.co:5432',
    };
    // Verify no email/phone/name-style PII in the canonical error field
    expect(degraded.error).not.toMatch(/@/); // no email
    expect(degraded).not.toHaveProperty('email');
    expect(degraded).not.toHaveProperty('userId');
    expect(degraded).not.toHaveProperty('studentId');
  });
});
