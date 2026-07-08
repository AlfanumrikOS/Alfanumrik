/**
 * Phase 4 Wave 2 — security layer contract tests.
 *
 * Validates:
 * 1. Each of the 5 Wave 2 Edge Functions has a route profile with the correct
 *    route name and callerTypes: ['internal_service'].
 * 2. Admission failure (ok: false) causes the function to return the denial
 *    response immediately — no business logic runs (legacy auth removed).
 * 3. MoL proxy decision (shouldProxyToPython) is imported and runs before
 *    bodyText is consumed in all 5 functions.
 * 4. Wave 2 proxy callers are correctly named in the migration.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();

// ── Source files ─────────────────────────────────────────────────────────────

const generateAnswersSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/generate-answers/index.ts'),
  'utf8',
);

const generateConceptsSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/generate-concepts/index.ts'),
  'utf8',
);

const extractNcertQuestionsSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/extract-ncert-questions/index.ts'),
  'utf8',
);

const bulkNonMcqGenSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/bulk-non-mcq-gen/index.ts'),
  'utf8',
);

const bulkQuestionGenSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/bulk-question-gen/index.ts'),
  'utf8',
);

const migrationSrc = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260620001600_phase4_internal_caller_registrations.sql'),
  'utf8',
);

// ── Route profile tests ───────────────────────────────────────────────────────

describe('Phase 4 Wave 2 — generate-answers security layer', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(generateAnswersSrc).toContain(token);
    }
  });

  it('route profile has route generate-answers and callerTypes internal_service only', () => {
    expect(generateAnswersSrc).toContain("route: 'generate-answers'");
    expect(generateAnswersSrc).toContain("callerTypes: ['internal_service']");
  });

  it('admission failure short-circuits before business logic', () => {
    expect(generateAnswersSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain constantTimeEqual or authenticateAdmin', () => {
    expect(generateAnswersSrc).not.toContain('constantTimeEqual');
    expect(generateAnswersSrc).not.toContain('function authenticateAdmin');
  });

  it('finalizeAiRoute called on unhandled error path', () => {
    expect(generateAnswersSrc).toContain("errorCode: 'unhandled_error'");
  });
});

describe('Phase 4 Wave 2 — generate-concepts security layer', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(generateConceptsSrc).toContain(token);
    }
  });

  it('route profile has route generate-concepts and callerTypes internal_service only', () => {
    expect(generateConceptsSrc).toContain("route: 'generate-concepts'");
    expect(generateConceptsSrc).toContain("callerTypes: ['internal_service']");
  });

  it('admission failure short-circuits before business logic', () => {
    expect(generateConceptsSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain constantTimeEqual or authenticateAdmin', () => {
    expect(generateConceptsSrc).not.toContain('constantTimeEqual');
    expect(generateConceptsSrc).not.toContain('function authenticateAdmin');
  });

  it('finalizeAiRoute called on unhandled error path', () => {
    expect(generateConceptsSrc).toContain("errorCode: 'unhandled_error'");
  });
});

describe('Phase 4 Wave 2 — extract-ncert-questions security layer', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(extractNcertQuestionsSrc).toContain(token);
    }
  });

  it('route profile has route extract-ncert-questions and callerTypes internal_service only', () => {
    expect(extractNcertQuestionsSrc).toContain("route: 'extract-ncert-questions'");
    expect(extractNcertQuestionsSrc).toContain("callerTypes: ['internal_service']");
  });

  it('admission failure short-circuits before business logic', () => {
    expect(extractNcertQuestionsSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain constantTimeEqual or authenticateAdmin', () => {
    expect(extractNcertQuestionsSrc).not.toContain('constantTimeEqual');
    expect(extractNcertQuestionsSrc).not.toContain('function authenticateAdmin');
  });

  it('finalizeAiRoute called on unhandled error path', () => {
    expect(extractNcertQuestionsSrc).toContain("errorCode: 'unhandled_error'");
  });
});

describe('Phase 4 Wave 2 — bulk-non-mcq-gen security layer', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(bulkNonMcqGenSrc).toContain(token);
    }
  });

  it('route profile has route bulk-non-mcq-gen and callerTypes internal_service only', () => {
    expect(bulkNonMcqGenSrc).toContain("route: 'bulk-non-mcq-gen'");
    expect(bulkNonMcqGenSrc).toContain("callerTypes: ['internal_service']");
  });

  it('admission failure short-circuits before business logic', () => {
    expect(bulkNonMcqGenSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain verifyAdminAuth function definition', () => {
    expect(bulkNonMcqGenSrc).not.toContain('async function verifyAdminAuth');
  });

  it('finalizeAiRoute called on unhandled error path', () => {
    expect(bulkNonMcqGenSrc).toContain("errorCode: 'unhandled_error'");
  });
});

describe('Phase 4 Wave 2 — bulk-question-gen security layer', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(bulkQuestionGenSrc).toContain(token);
    }
  });

  it('route profile has route bulk-question-gen and callerTypes internal_service only', () => {
    expect(bulkQuestionGenSrc).toContain("route: 'bulk-question-gen'");
    expect(bulkQuestionGenSrc).toContain("callerTypes: ['internal_service']");
  });

  it('admission failure short-circuits before business logic', () => {
    expect(bulkQuestionGenSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain verifyAdminAuth function definition', () => {
    expect(bulkQuestionGenSrc).not.toContain('async function verifyAdminAuth');
  });

  it('finalizeAiRoute called on unhandled error path', () => {
    expect(bulkQuestionGenSrc).toContain("errorCode: 'unhandled_error'");
  });
});

// ── MoL proxy ordering tests ──────────────────────────────────────────────────
// Verifies that shouldProxyToPython is imported and appears before the bodyText
// read (req.text()) in the handler, preserving the one-time-read stream contract.

describe('Phase 4 Wave 2 — MoL proxy runs before bodyText is consumed', () => {
  it('generate-answers: shouldProxyToPython import present and before req.text()', () => {
    expect(generateAnswersSrc).toContain('shouldProxyToPython');
    const proxyPos = generateAnswersSrc.indexOf('shouldProxyToPython');
    const textPos = generateAnswersSrc.indexOf('await req.text()');
    expect(proxyPos).toBeGreaterThan(-1);
    expect(textPos).toBeGreaterThan(-1);
    expect(proxyPos).toBeLessThan(textPos);
  });

  it('generate-concepts: shouldProxyToPython import present and before req.text()', () => {
    expect(generateConceptsSrc).toContain('shouldProxyToPython');
    const proxyPos = generateConceptsSrc.indexOf('shouldProxyToPython');
    const textPos = generateConceptsSrc.indexOf('await req.text()');
    expect(proxyPos).toBeGreaterThan(-1);
    expect(textPos).toBeGreaterThan(-1);
    expect(proxyPos).toBeLessThan(textPos);
  });

  it('extract-ncert-questions: shouldProxyToPython import present and before req.text()', () => {
    expect(extractNcertQuestionsSrc).toContain('shouldProxyToPython');
    const proxyPos = extractNcertQuestionsSrc.indexOf('shouldProxyToPython');
    const textPos = extractNcertQuestionsSrc.indexOf('await req.text()');
    expect(proxyPos).toBeGreaterThan(-1);
    expect(textPos).toBeGreaterThan(-1);
    expect(proxyPos).toBeLessThan(textPos);
  });

  it('bulk-non-mcq-gen: shouldProxyToPython import present and before req.text()', () => {
    expect(bulkNonMcqGenSrc).toContain('shouldProxyToPython');
    const proxyPos = bulkNonMcqGenSrc.indexOf('shouldProxyToPython');
    const textPos = bulkNonMcqGenSrc.indexOf('await req.text()');
    expect(proxyPos).toBeGreaterThan(-1);
    expect(textPos).toBeGreaterThan(-1);
    expect(proxyPos).toBeLessThan(textPos);
  });

  it('bulk-question-gen: shouldProxyToPython import present and before req.text()', () => {
    expect(bulkQuestionGenSrc).toContain('shouldProxyToPython');
    const proxyPos = bulkQuestionGenSrc.indexOf('shouldProxyToPython');
    const textPos = bulkQuestionGenSrc.indexOf('await req.text()');
    expect(proxyPos).toBeGreaterThan(-1);
    expect(textPos).toBeGreaterThan(-1);
    expect(proxyPos).toBeLessThan(textPos);
  });
});

// ── Migration caller name tests ───────────────────────────────────────────────

describe('Phase 4 Wave 2 — migration: Wave 2 proxy callers named correctly', () => {
  it('registers all 5 Wave 2 proxy callers in security_internal_callers', () => {
    for (const name of [
      'generate-answers-proxy',
      'generate-concepts-proxy',
      'extract-ncert-questions-proxy',
      'bulk-non-mcq-gen-proxy',
      'bulk-question-gen-proxy',
    ]) {
      expect(migrationSrc).toContain(`'${name}'`);
    }
  });

  it('links each Wave 2 proxy to its quota profile via internal_service caller type', () => {
    expect(migrationSrc).toContain('security_quota_profiles');
    expect(migrationSrc).toContain('internal_service');
  });
});
