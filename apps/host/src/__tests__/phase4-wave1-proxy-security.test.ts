/**
 * Phase 4 Wave 1 — proxy security contract tests.
 *
 * Validates:
 * 1. The Next.js proxy blocks unknown function names (404).
 * 2. The proxy sends the correct x-internal-caller header naming convention.
 * 3. Each of the 5 Wave 1 Edge Functions has a route profile with the correct
 *    route name and callerTypes.
 * 4. Admission failure (ok: false) causes the function to return the denial
 *    response immediately (no business logic runs).
 * 5. finalizeAiRoute is called on the GET path for the embed functions.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();

// ── Source files ────────────────────────────────────────────────────────────

const proxySrc = readFileSync(
  resolve(ROOT, 'src/app/api/super-admin/ai/[fn]/route.ts'),
  'utf8',
);

const embedQuestionsSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/embed-questions/index.ts'),
  'utf8',
);

const embedNcertQaSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/embed-ncert-qa/index.ts'),
  'utf8',
);

const embedDiagramsSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/embed-diagrams/index.ts'),
  'utf8',
);

const extractDiagramsSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/extract-diagrams/index.ts'),
  'utf8',
);

const bulkJeeNeetSrc = readFileSync(
  resolve(ROOT, 'supabase/functions/bulk-jee-neet-import/index.ts'),
  'utf8',
);

const migrationSrc = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260620001600_phase4_internal_caller_registrations.sql'),
  'utf8',
);

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Phase 4 Wave 1 — Next.js proxy route', () => {
  it('blocks unknown function names with 404', () => {
    // The proxy checks ALLOWED_FUNCTIONS before authorizing — unknown names
    // get a 404 before any auth or downstream call.
    expect(proxySrc).toContain("return NextResponse.json({ error: 'Unknown function' }, { status: 404 })");
    expect(proxySrc).toContain('ALLOWED_FUNCTIONS');
  });

  it('sends correct x-internal-caller header using ${fn}-proxy naming convention', () => {
    // buildInternalCallerHeaders is called with `${fn}-proxy` as the caller
    // argument so the Edge Function security layer can look up the registration
    // in security_internal_callers by that name.
    expect(proxySrc).toContain('buildInternalCallerHeaders');
    expect(proxySrc).toContain('`${fn}-proxy`');
  });

  it('uses authorizeAdmin with super_admin level', () => {
    expect(proxySrc).toContain("authorizeAdmin(request, 'super_admin')");
  });

  it('handles both GET and POST methods', () => {
    expect(proxySrc).toContain("export async function GET(");
    expect(proxySrc).toContain("export async function POST(");
  });

  it('all 10 Wave 1+2 functions are in ALLOWED_FUNCTIONS', () => {
    for (const fn of [
      'embed-questions', 'embed-ncert-qa', 'embed-diagrams',
      'extract-diagrams', 'bulk-jee-neet-import',
      'generate-answers', 'generate-concepts', 'extract-ncert-questions',
      'bulk-non-mcq-gen', 'bulk-question-gen',
    ]) {
      expect(proxySrc).toContain(`'${fn}'`);
    }
  });
});

describe('Phase 4 Wave 1 — embed-questions security layer', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(embedQuestionsSrc).toContain(token);
    }
  });

  it('route profile has route embed-questions and callerTypes internal_service only', () => {
    expect(embedQuestionsSrc).toContain("route: 'embed-questions'");
    expect(embedQuestionsSrc).toContain("callerTypes: ['internal_service']");
  });

  it('reads body as text before admission on POST path', () => {
    // The main handler reads body as text before the primary admitAiRoute call.
    // We use the comment marker to find the right req.text() call in the handler
    // (not the one inside handlePost's body parsing logic).
    const markerPos = embedQuestionsSrc.indexOf('Read body as text first');
    const textPos = embedQuestionsSrc.indexOf('await req.text()', markerPos);
    const admitPos = embedQuestionsSrc.indexOf('await admitAiRoute(', textPos);
    expect(markerPos).toBeGreaterThan(-1);
    expect(textPos).toBeGreaterThan(markerPos);
    expect(admitPos).toBeGreaterThan(textPos);
  });

  it('calls finalizeAiRoute on GET success path', () => {
    // finalizeAiRoute must be called after handleGet returns so quota/audit
    // records are written even on the lightweight status GET.
    const getHandlerPos = embedQuestionsSrc.indexOf('handleGet(');
    const finalizePos = embedQuestionsSrc.indexOf('finalizeAiRoute', getHandlerPos);
    expect(finalizePos).toBeGreaterThan(getHandlerPos);
  });

  it('calls finalizeAiRoute on unhandled error path', () => {
    expect(embedQuestionsSrc).toContain("errorCode: 'unhandled_error'");
  });

  it('does not contain constantTimeEqual or authenticateAdmin', () => {
    expect(embedQuestionsSrc).not.toContain('constantTimeEqual');
    expect(embedQuestionsSrc).not.toContain('authenticateAdmin');
  });
});

describe('Phase 4 Wave 1 — embed-ncert-qa security layer', () => {
  it('route profile has route embed-ncert-qa and callerTypes internal_service only', () => {
    expect(embedNcertQaSrc).toContain("route: 'embed-ncert-qa'");
    expect(embedNcertQaSrc).toContain("callerTypes: ['internal_service']");
  });

  it('admission failure short-circuits before business logic', () => {
    // If admitResult.ok is false, the handler returns admitResult.response.
    // Business logic (handleGet / handlePost) is never reached.
    expect(embedNcertQaSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain constantTimeEqual or authenticateAdmin', () => {
    expect(embedNcertQaSrc).not.toContain('constantTimeEqual');
    expect(embedNcertQaSrc).not.toContain('authenticateAdmin');
  });
});

describe('Phase 4 Wave 1 — embed-diagrams security layer', () => {
  it('route profile has route embed-diagrams and callerTypes internal_service only', () => {
    expect(embedDiagramsSrc).toContain("route: 'embed-diagrams'");
    expect(embedDiagramsSrc).toContain("callerTypes: ['internal_service']");
  });

  it('admission failure short-circuits before business logic', () => {
    expect(embedDiagramsSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain constantTimeEqual or authenticateAdmin', () => {
    expect(embedDiagramsSrc).not.toContain('constantTimeEqual');
    expect(embedDiagramsSrc).not.toContain('authenticateAdmin');
  });
});

describe('Phase 4 Wave 1 — extract-diagrams security layer', () => {
  it('route profile has route extract-diagrams and callerTypes internal_service only', () => {
    expect(extractDiagramsSrc).toContain("route: 'extract-diagrams'");
    expect(extractDiagramsSrc).toContain("callerTypes: ['internal_service']");
  });

  it('modelProvider is google (Vision API, not Claude)', () => {
    expect(extractDiagramsSrc).toContain("modelProvider: 'google'");
  });

  it('admission failure short-circuits before business logic', () => {
    expect(extractDiagramsSrc).toContain('if (!admitResult.ok) return admitResult.response');
  });

  it('does not contain constantTimeEqual or authenticateAdmin', () => {
    expect(extractDiagramsSrc).not.toContain('constantTimeEqual');
    expect(extractDiagramsSrc).not.toContain('authenticateAdmin');
  });
});

describe('Phase 4 Wave 1 — bulk-jee-neet-import security layer', () => {
  it('route profile has route bulk-jee-neet-import and callerTypes internal_service only', () => {
    expect(bulkJeeNeetSrc).toContain("route: 'bulk-jee-neet-import'");
    expect(bulkJeeNeetSrc).toContain("callerTypes: ['internal_service']");
  });

  it('reads body as text before admission', () => {
    const textPos = bulkJeeNeetSrc.indexOf('await req.text()');
    const admitPos = bulkJeeNeetSrc.indexOf('await admitAiRoute(');
    expect(textPos).toBeGreaterThan(-1);
    expect(admitPos).toBeGreaterThan(-1);
    expect(textPos).toBeLessThan(admitPos);
  });

  it('calls finalizeAiRoute on success path', () => {
    expect(bulkJeeNeetSrc).toContain("await finalizeAiRoute({ sb, admission, statusCode: 200 })");
  });

  it('calls finalizeAiRoute on unhandled error path', () => {
    expect(bulkJeeNeetSrc).toContain("errorCode: 'unhandled_error'");
  });

  it('does not contain authenticateAdmin function definition', () => {
    expect(bulkJeeNeetSrc).not.toContain('function authenticateAdmin');
  });
});

describe('Phase 4 Wave 1 — migration: internal caller registrations', () => {
  it('registers all 10 proxy callers in security_internal_callers', () => {
    for (const name of [
      'embed-questions-proxy',
      'embed-ncert-qa-proxy',
      'embed-diagrams-proxy',
      'extract-diagrams-proxy',
      'bulk-jee-neet-import-proxy',
      'generate-answers-proxy',
      'generate-concepts-proxy',
      'extract-ncert-questions-proxy',
      'bulk-non-mcq-gen-proxy',
      'bulk-question-gen-proxy',
    ]) {
      expect(migrationSrc).toContain(`'${name}'`);
    }
  });

  it('links each proxy to its quota profile via JOIN', () => {
    expect(migrationSrc).toContain('security_quota_profiles');
    expect(migrationSrc).toContain('internal_service');
  });
});
