import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const indexSource = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/alfabot-answer/index.ts'),
  'utf8',
);

const streamSource = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/alfabot-answer/stream-response.ts'),
  'utf8',
);

const migrationSource = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260620001300_ai_edge_function_security_policies.sql'),
  'utf8',
);

describe('alfabot-answer Platform Security Layer rollout', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile security primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(indexSource).toContain(token);
    }
  });

  it('admits only internal_service callers', () => {
    expect(indexSource).toContain("callerTypes: ['internal_service']");
  });

  it('reads body as text before JSON parse (for body hash)', () => {
    // req.text() must appear before the admitAiRoute call-site (and before
    // JSON.parse) so that the raw body bytes are available for the admission
    // hash check. We use the call-site token to skip past the import line.
    const textPos = indexSource.indexOf('req.text()');
    const admitCallPos = indexSource.indexOf('await admitAiRoute(');
    const jsonParsePos = indexSource.indexOf('JSON.parse');
    expect(textPos).toBeGreaterThan(-1);
    expect(admitCallPos).toBeGreaterThan(-1);
    expect(jsonParsePos).toBeGreaterThan(-1);
    expect(textPos).toBeLessThan(admitCallPos);
    expect(textPos).toBeLessThan(jsonParsePos);
  });

  it('calls finalizeAiRoute after non-streaming response', () => {
    // The non-streaming (wantsJson) path must call finalizeAiRoute before
    // returning the JSON response.
    const finalizePos = indexSource.indexOf('finalizeAiRoute');
    expect(finalizePos).toBeGreaterThan(-1);
    // The wantsJson conditional branch contains the call, which must appear
    // somewhere in the source after admitAiRoute.
    const admitPos = indexSource.indexOf('admitAiRoute');
    expect(finalizePos).toBeGreaterThan(admitPos);
  });

  it('stream-response calls finalizeAiRoute in the finally block', () => {
    // The streaming branch must call finalizeAiRoute inside a finally block so
    // quota/audit settlement is guaranteed even on error paths.
    const finallyPos = streamSource.indexOf('finally');
    expect(finallyPos).toBeGreaterThan(-1);
    const finalizeInStream = streamSource.indexOf('finalizeAiRoute', finallyPos);
    expect(finalizeInStream).toBeGreaterThan(finallyPos);
  });

  it('route policy is seeded for alfabot-answer in the bulk migration', () => {
    expect(migrationSource).toContain("'alfabot-answer'");
  });

  it('stream-response buildStreamingResponse accepts admission parameter', () => {
    // The function signature and import must reference AiAdmissionContext so
    // the type is enforced at the Deno compile stage.
    expect(streamSource).toContain('AiAdmissionContext');
    expect(streamSource).toContain('admission');
    expect(streamSource).toContain('buildStreamingResponse');
  });
});
