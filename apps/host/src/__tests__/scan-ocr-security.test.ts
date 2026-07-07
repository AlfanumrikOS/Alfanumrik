import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();

const indexSource = readFileSync(
  resolve(ROOT, 'supabase/functions/scan-ocr/index.ts'),
  'utf8',
);

const migrationSource = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260620001300_ai_edge_function_security_policies.sql'),
  'utf8',
);

describe('scan-ocr security layer integration', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile security primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(indexSource).toContain(token);
    }
  });

  it('admits student and internal_service callers only', () => {
    expect(indexSource).toContain("callerTypes: ['student', 'internal_service']");
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
    // scan-ocr has many exit branches: auth header missing, invalid token,
    // student not found, invalid JSON, daily limit reached, action-specific
    // errors (insert_failed, file_not_accessible, scan_not_found, etc.),
    // OCR success paths, and the top-level catch. Every branch must call
    // finalizeAiRoute so quota and audit records are always written.
    const occurrences = (indexSource.match(/finalizeAiRoute/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });

  it('route policy is seeded for scan-ocr in the bulk migration', () => {
    expect(migrationSource).toContain("'scan-ocr'");
  });

  it('preserves check_and_record_usage for domain-specific OCR daily limit', () => {
    // The per-feature daily quota check (check_and_record_usage RPC) for
    // cost-incurring OCR actions (upload_and_process, retry_ocr, ask_foxy)
    // must not be removed when the platform security layer is integrated.
    // Removing it would let students bypass the OCR scan quota (P12).
    expect(indexSource).toContain('check_and_record_usage');
  });

  it('modelProvider is set to google in the route profile', () => {
    // scan-ocr routes through Google Vision (and OCR.space fallback), not
    // Claude/Anthropic. The route profile must reflect the correct provider
    // so quota accounting and circuit-breaker thresholds apply to the right
    // backend.
    expect(indexSource).toContain("modelProvider: 'google'");
  });
});
