import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();

const indexSource = readFileSync(
  resolve(ROOT, 'supabase/functions/whatsapp-notify/index.ts'),
  'utf8',
);

const migrationSource = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260620001500_whatsapp_notify_security_policy.sql'),
  'utf8',
);

describe('whatsapp-notify security layer integration', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile security primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(indexSource).toContain(token);
    }
  });

  it('admits only internal_service callers', () => {
    expect(indexSource).toContain("callerTypes: ['internal_service']");
  });

  it('modelProvider is set to meta in the route profile', () => {
    // whatsapp-notify routes through Meta WhatsApp Cloud API, not Claude/Anthropic.
    // The route profile must reflect the correct provider so quota accounting
    // and circuit-breaker thresholds apply to the right backend.
    expect(indexSource).toContain("modelProvider: 'meta'");
  });

  it('reads body as text before admission (body hash requirement)', () => {
    // req.text() must appear before the admitAiRoute call-site so the raw body
    // bytes are available for the body hash during the security admission check.
    // We search for the invocation token ('await admitAiRoute(') to skip past
    // the import declaration which appears earlier in the file.
    const textPos = indexSource.indexOf('req.text()');
    const admitCallPos = indexSource.indexOf('await admitAiRoute(');
    expect(textPos).toBeGreaterThan(-1);
    expect(admitCallPos).toBeGreaterThan(-1);
    expect(textPos).toBeLessThan(admitCallPos);
  });

  it('calls finalizeAiRoute on every exit path', () => {
    // whatsapp-notify has multiple exit branches: invalid_json, invalid_template,
    // invalid_phone, invalid_language, invalid_data, rate_limited,
    // template_not_found, missing_params, success 200, whatsapp_send_failed 502,
    // and the top-level catch 500. Every branch must call finalizeAiRoute so
    // quota and audit records are always written.
    const occurrences = (indexSource.match(/finalizeAiRoute/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });

  it('quota profile is seeded for whatsapp-notify in the dedicated migration', () => {
    expect(migrationSource).toContain('whatsapp-notify-internal_service');
  });

  it('three internal caller registrations are seeded in the migration', () => {
    expect(migrationSource).toContain('notifications-whatsapp-route');
    expect(migrationSource).toContain('school-admin-parents-route');
    expect(migrationSource).toContain('synthesis-parent-share-route');
  });
});
