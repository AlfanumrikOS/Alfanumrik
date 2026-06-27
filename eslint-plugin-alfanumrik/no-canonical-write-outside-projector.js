/**
 * ESLint rule: no-canonical-write-outside-projector
 *
 * Enforces ADR-005 §"The enforceable rule" #1:
 *
 *   "No API route is a canonical writer of learner state. Routes may
 *    compute and return optimistic results, but the canonical write to
 *    concept_mastery, daily_schedule, scheduled_actions, entitlements,
 *    notification_sends, etc. happens in a projector subscribing to a
 *    durable state_events row."
 *
 * The list of canonical learner-state tables is sourced from
 * docs/architecture/DATA_OWNERSHIP_MATRIX.md (the "Assessment", "Schedule",
 * "Billing/entitlements", and "Notifications" rows) plus the explicit
 * enumeration in ADR-005.
 *
 * Detects: Supabase-style writes
 *
 *     <X>.from('<TABLE>').insert(...)
 *     <X>.from('<TABLE>').update(...)
 *     <X>.from('<TABLE>').upsert(...)
 *     <X>.from('<TABLE>').delete(...)
 *
 *   where <TABLE> is one of the canonical learner-state tables. Reads
 *   (`.select(...)`) are NOT flagged — only writes to canonical state.
 *
 * Allowlist (rule skipped for these files):
 *   - src/lib/state/subscribers/**           — projector subscribers, the
 *                                              legitimate canonical writers.
 *   - src/lib/state/services/quiz-completion-service.ts
 *                                              — legacy P4 RPC orchestrator;
 *                                              documented exception (this
 *                                              file orchestrates the
 *                                              atomic_quiz_profile_update
 *                                              RPC plus targeted writes
 *                                              that predate the projector
 *                                              substrate; see EXCEPTIONS.md
 *                                              and ADR-005 §"Use the
 *                                              existing runtime").
 *
 * Test fixtures (src/__tests__/**, *.test.*, *.spec.*) are turned OFF
 * for this rule via an .eslintrc.json override — not via this file's
 * allowlist. Rationale: tests legitimately seed/clean canonical tables
 * as E2E setup (there is no projector in a test). The rule governs the
 * production write path, so scoping it out of tests at the config layer
 * (mirroring every other src-scoped rule in .eslintrc.json) is the
 * correct, idiomatic boundary. Keeping the in-rule allowlist focused on
 * the two legitimate PRODUCTION writers keeps the rule logic narrow.
 *
 * Per-site PRODUCTION exceptions (e.g. the ADR-sanctioned legacy
 * rollback block in /api/tutor/answer) are suppressed inline with
 * `// eslint-disable-next-line ... -- see EXCEPTIONS.md E<n>`, NOT by
 * widening the allowlist. See README "Suppression".
 *
 * Severity: warn in .eslintrc.json (ratcheting in), error in
 * .eslintrc.ai-boundary.json (strict mode).
 */
'use strict';

const path = require('path');

const NAME = 'no-canonical-write-outside-projector';

// Canonical learner-state tables, per ADR-005 §"The enforceable rule" #1
// and DATA_OWNERSHIP_MATRIX.md. Keep this list narrow: it covers tables
// owned by projectors. Operational/log tables (concept_attempts, request
// audit trails, idempotency reservations) are route-owned by design.
const CANONICAL_TABLES = new Set([
  'concept_mastery',
  'adaptive_mastery',
  'daily_schedule',
  'scheduled_actions',
  'entitlements',
  'notification_sends',
]);

// Mutating Supabase QueryBuilder methods.
const MUTATING_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

// Path-suffix allowlist. We match on the POSIX-normalized full path
// (forward slashes) rather than a CWD-relative path, because in this
// repo eslint may run from a worktree directory whose CWD doesn't
// align with the test runner's CWD. A suffix match on
// `src/lib/state/subscribers/` is unambiguous in practice (no other
// directory under the repo carries the same segment).
const ALLOWLIST_SUFFIXES = ['/src/lib/state/subscribers/'];

// Path-suffix allowlist for individual files (legacy exceptions).
const ALLOWLIST_FILE_SUFFIXES = [
  '/src/lib/state/services/quiz-completion-service.ts',
];

/**
 * Convert any filename to forward-slash form for path matching.
 */
function toPosix(filename) {
  if (!filename) return '';
  return filename.split(path.sep).join('/');
}

function isAllowlisted(posixPath) {
  for (const suffix of ALLOWLIST_FILE_SUFFIXES) {
    if (posixPath.endsWith(suffix)) return true;
  }
  for (const suffix of ALLOWLIST_SUFFIXES) {
    if (posixPath.includes(suffix)) return true;
  }
  return false;
}

/**
 * Given a CallExpression node `<callee>(<args>)`, walk the callee chain
 * looking for a `.from('<lit>')` step. We accept any chain depth between
 * the `.from(...)` call and the final mutating method call because real
 * Supabase code intersperses things like `.eq()`, `.in()`, `.match()`:
 *
 *   supabase.from('x').upsert({...})
 *   supabase.from('x').update({...}).eq('id', y)   ← `.update` is the
 *                                                    method we care about
 *
 * The AST shape for `a.b('x').c(...)` is:
 *
 *   CallExpression {
 *     callee: MemberExpression {
 *       object: CallExpression {
 *         callee: MemberExpression { object: a, property: b },
 *         arguments: [Literal 'x'],
 *       },
 *       property: c,
 *     },
 *     arguments: [...],
 *   }
 *
 * We start from the outer mutating-method CallExpression and walk
 * `callee.object` repeatedly until we find a CallExpression whose
 * callee is `.from(...)`. If found and its single string argument is
 * a canonical table, we have a match.
 */
function findFromCallInChain(node) {
  // Walk down the .object chain from `node`.
  let cur = node;
  // Bound the walk so a pathological deep chain can't hang the rule.
  let hops = 0;
  while (cur && hops < 32) {
    hops += 1;
    if (cur.type !== 'CallExpression') return null;
    const callee = cur.callee;
    if (!callee || callee.type !== 'MemberExpression') return null;
    const propName = callee.property && callee.property.name;
    if (propName === 'from') {
      // Found a .from(...) call. Inspect its single string argument.
      const arg0 = cur.arguments && cur.arguments[0];
      if (
        arg0 &&
        arg0.type === 'Literal' &&
        typeof arg0.value === 'string'
      ) {
        return { fromCall: cur, table: arg0.value };
      }
      // .from() called with non-literal (variable, fn return, …) —
      // we cannot statically resolve; bail out without reporting.
      return null;
    }
    // Not .from(...). Walk further down the chain into the object the
    // previous method was called on.
    cur = callee.object;
  }
  return null;
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Canonical learner-state tables (concept_mastery, adaptive_mastery, daily_schedule, scheduled_actions, entitlements, notification_sends) must only be written from projector subscribers (src/lib/state/subscribers/**) — see ADR-005 §"The enforceable rule" #1.',
    },
    schema: [],
    messages: {
      writeOutside:
        'Canonical state table "{{table}}" must be written only from projector subscribers (src/lib/state/subscribers/**). Detected outside the allowlist. See ADR-005 §"The enforceable rule" and EXCEPTIONS.md.',
    },
  },
  create(context) {
    const filename = context.getFilename() || context.filename || '';
    const posixPath = toPosix(filename);

    // Short-circuit: file is in the allowlist (legitimate writer) — emit
    // nothing for this file.
    if (isAllowlisted(posixPath)) return {};

    return {
      CallExpression(node) {
        // We care about the *mutating* call: node.callee must be a
        // MemberExpression where .property.name is one of the mutating
        // methods.
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const methodName = callee.property && callee.property.name;
        if (!methodName || !MUTATING_METHODS.has(methodName)) return;

        // The object the mutating method is called on must itself be the
        // result of `.from('<table>')` (possibly with further chained
        // methods in between — but in practice mutating methods come
        // directly after .from(), so this is usually one hop).
        const chainHead = callee.object;
        const found = findFromCallInChain(chainHead);
        if (!found) return;
        if (!CANONICAL_TABLES.has(found.table)) return;

        context.report({
          node,
          messageId: 'writeOutside',
          data: { table: found.table },
        });
      },
    };
  },
};

module.exports = {
  rules: {
    [NAME]: rule,
  },
};
