/**
 * ESLint rule: no-inline-taxonomy-reads
 *
 * ADR-007 / Hard Rule 6 (identical chapter structure across Foxy, Quiz, UI):
 * new Next.js code must read chapter/topic taxonomy through the shared cached
 * fetcher (`apps/host/src/lib/curriculum/cached-taxonomy.ts` — tag 'syllabus',
 * tag-revalidated on admin content writes) instead of inline
 * `.from('curriculum_topics')` queries. Two independent fetchers with
 * different shapes is exactly how the historical Foxy/Quiz chapter-mismatch
 * P0 happened; per-request re-queries of public reference data also waste DB
 * round-trips (ADR-007 taxonomy layer).
 *
 * Detects: any call expression `X.from('curriculum_topics')` in app code.
 *
 * Allowlist (rule skipped):
 *   - apps/host/src/lib/curriculum/**        (the fetcher itself)
 *   - supabase/functions/**                  (Deno side — no next/cache; has its
 *                                             own patterns; out of scope here)
 *   - packages/lib/src/supabase.ts           (legacy helpers pending migration)
 *   - src/__tests__/**  and  *.test.* files  (tests mock the chain shape)
 *   - eslint-plugin-alfanumrik/**            (self-reference)
 *
 * Severity is WARN at introduction (2026-07-13): ~12 pre-existing call sites
 * are being migrated incrementally (tech-debt register item 9). Flip to
 * "error" once the migration PR lands — do NOT add new warn-level call sites;
 * reviewers should treat a new warning from this rule as a blocking finding.
 */
'use strict';

const ALLOWED_PATH_RE = [
  /[\\/]src[\\/]lib[\\/]curriculum[\\/]/,
  /[\\/]supabase[\\/]functions[\\/]/,
  /[\\/]packages[\\/]lib[\\/]src[\\/]supabase\.ts$/,
  /[\\/]__tests__[\\/]/,
  /\.test\.(ts|tsx|js)$/,
  /[\\/]eslint-plugin-alfanumrik[\\/]/,
];

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow inline .from('curriculum_topics') reads outside the shared cached taxonomy fetcher (src/lib/curriculum/cached-taxonomy.ts). Two fetchers for chapter structure is the Hard Rule 6 drift pattern behind the historical Foxy/Quiz chapter-mismatch P0.",
    },
    schema: [],
    messages: {
      inlineTaxonomyRead:
        "Inline .from('curriculum_topics') read — use getActiveTopicsForSubjects()/getSubjectIdCodeRows() from '@/lib/curriculum/cached-taxonomy' instead (shared shape, 'syllabus'-tag cached, admin-write revalidated). See ADR-007.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (ALLOWED_PATH_RE.some((re) => re.test(filename))) return {};
    return {
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === 'MemberExpression' &&
          node.callee.property &&
          node.callee.property.name === 'from' &&
          node.arguments.length >= 1 &&
          node.arguments[0].type === 'Literal' &&
          node.arguments[0].value === 'curriculum_topics'
        ) {
          context.report({ node, messageId: 'inlineTaxonomyRead' });
        }
      },
    };
  },
};

module.exports = { rules: { 'no-inline-taxonomy-reads': rule } };
