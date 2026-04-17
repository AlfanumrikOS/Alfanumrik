import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { buildSlackPayload } from './slack.ts';
import { buildEmailPayload } from './email.ts';

const COMMON = {
  ruleName: 'AI error spike', severity: 'error', category: 'ai',
  source: 'claude.ts', matchedCount: 5, windowMinutes: 10,
  environment: 'production', firedAt: '2026-04-12T14:32:07Z',
  consoleUrl: 'https://alfanumrik.com/super-admin/observability?category=ai&severity=error',
};

Deno.test('buildSlackPayload produces valid Block Kit', () => {
  const payload = buildSlackPayload(COMMON);
  assertEquals(typeof payload.text, 'string');
  assertEquals(payload.blocks.length, 3);
  assertEquals(payload.blocks[0].type, 'section');
  assertEquals(payload.blocks[2].type, 'actions');
});

Deno.test('buildSlackPayload includes rule name in text', () => {
  const payload = buildSlackPayload(COMMON);
  assertEquals(payload.text.includes('AI error spike'), true);
});

Deno.test('buildSlackPayload handles null source', () => {
  const payload = buildSlackPayload({ ...COMMON, source: null });
  assertEquals(payload.text.includes('undefined'), false);
});

Deno.test('buildEmailPayload generates correct subject', () => {
  const email = buildEmailPayload({ ...COMMON, to: 'admin@test.com' });
  assertEquals(email.subject, '[ALFA-OPS] ERROR ai \u2014 AI error spike');
});

Deno.test('buildEmailPayload includes console link', () => {
  const email = buildEmailPayload({ ...COMMON, to: 'admin@test.com' });
  assertEquals(email.htmlBody.includes(COMMON.consoleUrl), true);
  assertEquals(email.textBody.includes(COMMON.consoleUrl), true);
});

Deno.test('deliverer index does NOT import logOpsEvent (feedback loop guard)', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assertEquals(source.includes('logOpsEvent'), false);
});
