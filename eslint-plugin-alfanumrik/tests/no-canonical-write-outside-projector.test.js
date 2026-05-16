/**
 * Tests for `no-canonical-write-outside-projector`.
 *
 * Uses ESLint's built-in `RuleTester`. Each test sets `filename` so that
 * the rule's path-allowlist check sees the right relative path.
 *
 * Run via: node eslint-plugin-alfanumrik/tests/no-canonical-write-outside-projector.test.js
 * (No mocha/jest needed — RuleTester throws on failure and exits 0 on success.)
 */
'use strict';

const path = require('path');
const { RuleTester } = require('eslint');

const ruleModule = require('../no-canonical-write-outside-projector');
const rule = ruleModule.rules['no-canonical-write-outside-projector'];

// Repo root, two levels up from this test file.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function absUnderRoot(...parts) {
  return path.join(REPO_ROOT, ...parts);
}

const tester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tester.run('no-canonical-write-outside-projector', rule, {
  valid: [
    // 1) Projector subscriber: upsert into concept_mastery is legitimate.
    {
      name: 'projector subscriber can upsert concept_mastery',
      filename: absUnderRoot(
        'src',
        'lib',
        'state',
        'subscribers',
        'concept-mastery-projector.ts'
      ),
      code: `supabase.from('concept_mastery').upsert({ student_id: 1 });`,
    },
    // 2) Legacy P4 RPC orchestrator: explicit single-file allowlist entry.
    {
      name: 'quiz-completion-service can write concept_mastery (legacy)',
      filename: absUnderRoot(
        'src',
        'lib',
        'state',
        'services',
        'quiz-completion-service.ts'
      ),
      code: `supabase.from('concept_mastery').upsert({ student_id: 1 });`,
    },
    // 3) Reads anywhere are fine.
    {
      name: 'select from concept_mastery is fine anywhere',
      filename: absUnderRoot('src', 'app', 'api', 'foo', 'route.ts'),
      code: `supabase.from('concept_mastery').select('*').eq('student_id', 1);`,
    },
    // 4) Writes to non-canonical tables are fine.
    {
      name: 'writes to non-canonical tables are not flagged',
      filename: absUnderRoot('src', 'app', 'api', 'foo', 'route.ts'),
      code: `supabase.from('some_other_table').update({ x: 1 });`,
    },
    // 5) Variable table name (not a literal) — bail out gracefully.
    {
      name: 'non-literal table arg is not flagged (can\'t statically resolve)',
      filename: absUnderRoot('src', 'app', 'api', 'foo', 'route.ts'),
      code: `const t = 'concept_mastery'; supabase.from(t).update({ x: 1 });`,
    },
  ],
  invalid: [
    // 1) API route writing concept_mastery via upsert.
    {
      name: 'api route upsert concept_mastery is flagged',
      filename: absUnderRoot('src', 'app', 'api', 'foo', 'route.ts'),
      code: `supabase.from('concept_mastery').upsert({ student_id: 1 });`,
      errors: [
        {
          messageId: 'writeOutside',
          data: { table: 'concept_mastery' },
        },
      ],
    },
    // 2) Non-allowlisted lib file inserting daily_schedule.
    {
      name: 'lib helper insert daily_schedule is flagged',
      filename: absUnderRoot('src', 'lib', 'schedules', 'helper.ts'),
      code: `supabase.from('daily_schedule').insert({ student_id: 1 });`,
      errors: [
        {
          messageId: 'writeOutside',
          data: { table: 'daily_schedule' },
        },
      ],
    },
    // 3) Anywhere updating entitlements.
    {
      name: 'api route update entitlements is flagged',
      filename: absUnderRoot('src', 'app', 'api', 'billing', 'route.ts'),
      code: `supabase.from('entitlements').update({ active: true }).eq('id', 1);`,
      errors: [
        {
          messageId: 'writeOutside',
          data: { table: 'entitlements' },
        },
      ],
    },
    // 4) Anywhere deleting notification_sends.
    {
      name: 'api route delete notification_sends is flagged',
      filename: absUnderRoot('src', 'app', 'api', 'notify', 'route.ts'),
      code: `supabase.from('notification_sends').delete().eq('id', 1);`,
      errors: [
        {
          messageId: 'writeOutside',
          data: { table: 'notification_sends' },
        },
      ],
    },
    // 5) supabaseAdmin (different receiver) — rule still triggers.
    {
      name: 'supabaseAdmin upsert adaptive_mastery is flagged',
      filename: absUnderRoot('src', 'app', 'api', 'adaptive', 'route.ts'),
      code: `supabaseAdmin.from('adaptive_mastery').upsert({ student_id: 1 });`,
      errors: [
        {
          messageId: 'writeOutside',
          data: { table: 'adaptive_mastery' },
        },
      ],
    },
    // 6) Chained .from('x').update(...).eq(...) — the `.update` is the
    //    mutating call, .eq is appended after.
    {
      name: 'update with chained .eq still flags',
      filename: absUnderRoot('src', 'lib', 'somewhere', 'helper.ts'),
      code: `supabase.from('scheduled_actions').update({ done: true }).eq('id', 1);`,
      errors: [
        {
          messageId: 'writeOutside',
          data: { table: 'scheduled_actions' },
        },
      ],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('no-canonical-write-outside-projector: all RuleTester cases passed.');
