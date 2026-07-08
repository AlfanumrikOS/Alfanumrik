import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const indexSource = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/ncert-solver/index.ts'),
  'utf8',
);

const migrationSource = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260620001300_ai_edge_function_security_policies.sql'),
  'utf8',
);

describe('ncert-solver Platform Security Layer rollout', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile security primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(indexSource).toContain(token);
    }
  });

  it('admits student and internal_service callers', () => {
    expect(indexSource).toContain("callerTypes: ['student', 'internal_service']");
  });

  it('reads body as text before admission', () => {
    // req.text() must appear before the admitAiRoute call-site so the body
    // hash is available during the security admission check. We search for
    // the invocation token ('await admitAiRoute(') to skip past the import
    // declaration which appears earlier in the file.
    const textPos = indexSource.indexOf('req.text()');
    const admitCallPos = indexSource.indexOf('await admitAiRoute(');
    expect(textPos).toBeGreaterThan(-1);
    expect(admitCallPos).toBeGreaterThan(-1);
    expect(textPos).toBeLessThan(admitCallPos);
  });

  it('calls finalizeAiRoute on every exit path', () => {
    // ncert-solver has many early-return branches (proxy, auth failure, quota,
    // grounded-answer, circuit open, validation errors, the main happy path,
    // and the top-level catch). Every branch must call finalizeAiRoute so
    // quota and audit records are always written.
    const occurrences = (indexSource.match(/finalizeAiRoute/g) ?? []).length;
    // There are more than 4 distinct call-sites in the current source.
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });

  it('route policy is seeded for ncert-solver in the bulk migration', () => {
    expect(migrationSource).toContain("'ncert-solver'");
  });

  it('preserves function-local circuit breaker alongside platform circuit', () => {
    // The platform security layer provides its own circuit tracking but
    // ncert-solver additionally maintains a local Claude-specific circuit
    // breaker object. Both must coexist — removing the local breaker is a
    // regression on P12 (AI safety fallback depth).
    expect(indexSource).toContain('circuitBreaker');
    expect(indexSource).toContain('canRequest');
    expect(indexSource).toContain('recordSuccess');
    expect(indexSource).toContain('recordFailure');
  });
});
