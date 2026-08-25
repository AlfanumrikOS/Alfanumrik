/**
 * ESLint rule: no-unchecked-supabase-error
 *
 * supabase-js resolves `{ data, error }` and NEVER throws. A destructure that
 * takes only `data` therefore discards the failure silently, and the enclosing
 * `try/catch` is decorative — the catch block is unreachable for query errors.
 * Every failure then renders as a plausible zero: HTTP 200, no exception, no
 * log, no Sentry event.
 *
 * This is the single most expensive defect class in this codebase. Confirmed
 * production incidents traced to exactly this pattern:
 *   - foxy_chat_messages persisted ZERO rows for 22 days while Foxy kept
 *     answering (sessions written, messages dropped).
 *   - /api/student/engagement selected four columns that do not exist
 *     (students.total_xp, concept_mastery.subject_code,
 *     quiz_responses.score_percent); the 42703 was discarded and every student
 *     was shown 0 XP / Level 1 / 0 streak.
 *   - /api/super-admin/db-performance safeRpc() swallowed a 42P01 and rendered
 *     an empty panel instead of an error.
 *   - learn/page.tsx dropped a PGRST201 and rendered "0/0 Ch · 0% Done" for
 *     every student on every grade (since fixed).
 *
 * Detects: `const { data } = await <supabase-chain>` where the object pattern
 * binds `data` but does NOT bind `error` (and has no rest element that could
 * capture it).
 *
 * Correct forms (all pass):
 *   const { data, error } = await supabase.from('t').select();
 *   if (error) { ... }
 *   const { data: rows, error: err } = await supabase.rpc('f');
 *   const { data, ...rest } = await supabase.from('t').select();  // rest may hold error
 *
 * Allowlist (rule skipped):
 *   - src/__tests__/** and *.test.* / *.spec.*   (tests assert on shapes)
 *   - eslint-plugin-alfanumrik/**                (self-reference)
 *   - **\/database.types.ts                       (generated)
 *
 * Severity is WARN at introduction (2026-08-25) so the pre-existing call sites
 * can be burned down without breaking CI. Do NOT add new warn-level sites —
 * treat a new warning from this rule as a blocking review finding. Flip to
 * "error" once the count reaches zero.
 *
 * Measured baseline at introduction (2026-08-25, against 9a8348dba):
 *   356 violations across 163 files, over apps/host/src + packages/lib/src +
 *   packages/ui/src. Highest-risk clusters, to be burned down first:
 *     14  apps/host/src/app/api/payments/webhook/route.ts   (payment events)
 *      8  apps/host/src/app/api/cron/adaptive-remediation/route.ts
 *      8  apps/host/src/app/api/school-admin/reports/route.ts
 *      8  apps/host/src/app/(student)/profile/page.tsx
 *      8  packages/lib/src/identity/complete-signup.ts
 *      7  apps/host/src/app/api/school-admin/parents/route.ts
 *      7  packages/lib/src/rbac.ts                          (authz decisions)
 *      6  apps/host/src/app/api/foxy/_lib/cognitive-context.ts
 *
 * CAVEAT — `npm run lint` does NOT surface most of these. It runs
 *   `npm run lint --workspaces`, which currently lints 499 files and reports
 *   only the 11 violations that live in packages/ui/src. apps/host/src and
 *   packages/lib/src are outside that workspace lint scope, so the other 345
 *   are invisible to CI. That scope gap is pre-existing and NOT addressed
 *   here; widening it would need its own change. Until it is closed, use the
 *   direct command below rather than `npm run lint` to measure this rule.
 *
 * Re-measure with:
 *   npx eslint apps/host/src packages/lib/src packages/ui/src --ext .ts,.tsx \
 *     --format json
 */
'use strict';

const ALLOWED_PATH_RE = [
  /[\\/]__tests__[\\/]/,
  /\.(test|spec)\.(ts|tsx|js|jsx)$/,
  /[\\/]eslint-plugin-alfanumrik[\\/]/,
  /[\\/]database\.types\.ts$/,
];

// Chain links that identify a PostgREST/supabase-js builder call.
const BUILDER_METHODS = new Set([
  'from',
  'rpc',
  'select',
  'insert',
  'update',
  'upsert',
  'delete',
  'single',
  'maybeSingle',
  'eq',
  'match',
  'limit',
]);

// Base identifiers that denote a supabase client in this repo.
const CLIENT_RE = /^(supabase|supabaseAdmin|admin|db|sb)$/i;

/**
 * Walk a call/member chain and decide whether it is a supabase-js query.
 * True when the chain contains `.from(` or `.rpc(`, or bottoms out in a
 * recognised client identifier while using builder methods.
 */
function isSupabaseChain(node) {
  let cur = node;
  let sawBuilder = false;
  let sawFromOrRpc = false;

  while (cur) {
    if (cur.type === 'CallExpression') {
      cur = cur.callee;
      continue;
    }
    if (cur.type === 'MemberExpression') {
      const name = cur.property && cur.property.name;
      if (name === 'from' || name === 'rpc') sawFromOrRpc = true;
      if (BUILDER_METHODS.has(name)) sawBuilder = true;
      cur = cur.object;
      continue;
    }
    if (cur.type === 'Identifier') {
      return sawFromOrRpc || (sawBuilder && CLIENT_RE.test(cur.name));
    }
    if (cur.type === 'ThisExpression') return sawFromOrRpc;
    return sawFromOrRpc;
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow destructuring only `data` from an awaited supabase-js call. supabase-js never throws, so a discarded `error` turns every failure into a silent zero — the defect class behind the 22-day Foxy message-loss outage and the zeroed student engagement dashboard.',
    },
    schema: [],
    messages: {
      uncheckedError:
        'Supabase result destructures `data` without `error`. supabase-js resolves {data, error} and never throws, so this failure will be silent and any wrapping try/catch is unreachable. Destructure `error` and handle it (surface, log, or return a typed failure).',
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (ALLOWED_PATH_RE.some((re) => re.test(filename))) return {};

    return {
      VariableDeclarator(node) {
        if (!node.id || node.id.type !== 'ObjectPattern') return;
        if (!node.init || node.init.type !== 'AwaitExpression') return;

        const awaited = node.init.argument;
        if (!awaited || awaited.type !== 'CallExpression') return;
        if (!isSupabaseChain(awaited)) return;

        let bindsData = false;
        let bindsError = false;
        let hasRest = false;

        for (const prop of node.id.properties) {
          if (prop.type === 'RestElement' || prop.type === 'ExperimentalRestProperty') {
            hasRest = true;
            continue;
          }
          const key = prop.key && (prop.key.name || prop.key.value);
          if (key === 'data') bindsData = true;
          if (key === 'error') bindsError = true;
        }

        // A rest element may capture `error`, so it is not a violation.
        if (bindsData && !bindsError && !hasRest) {
          context.report({ node: node.id, messageId: 'uncheckedError' });
        }
      },
    };
  },
};

module.exports = { rules: { 'no-unchecked-supabase-error': rule } };
