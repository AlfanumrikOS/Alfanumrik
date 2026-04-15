/**
 * ESLint rule: no-raw-subject-imports
 *
 * Forbid two escape hatches that drift the UI away from the single subject
 * source of truth (useAllowedSubjects() / get_available_subjects RPC):
 *
 *   1. IMPORTS — Named imports of GRADE_SUBJECTS / SUBJECT_META /
 *      getSubjectsForGrade / SUBJECT_BY_GRADE from @/lib/constants (or any
 *      ./constants / ../constants specifier) outside the allowed files.
 *
 *   2. LOCAL DECLARATIONS — Function or variable declarations that shadow
 *      those forbidden names (e.g. `function getSubjectsForGrade(g) {...}`
 *      in a page component). Discovered in stem-centre/page.tsx where a
 *      local helper bypassed the original import-only check.
 *
 * Rationale: subjects must be resolved at runtime from the DB-backed RPC so
 * grade/stream/plan gating, locale, and admin-curated master list are all
 * respected. Hardcoded arrays drift from the database truth.
 *
 * Allowed files (where these names may legitimately be defined or imported):
 *   - src/lib/subjects.ts / subjects.types.ts  (the service itself)
 *   - src/lib/constants.ts                     (the deprecated compat shim)
 *   - src/__tests__/**                         (tests pin the deprecated shape)
 *   - **\/*.test.ts, **\/*.test.tsx            (co-located tests)
 *   - eslint-plugin-alfanumrik/**              (the rule itself)
 */
const NAME = 'no-raw-subject-imports';

const FORBIDDEN_NAMES = new Set([
  'GRADE_SUBJECTS',
  'SUBJECT_META',
  'getSubjectsForGrade',
  'SUBJECT_BY_GRADE',
]);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw imports OR local declarations of GRADE_SUBJECTS / SUBJECT_META / getSubjectsForGrade / SUBJECT_BY_GRADE outside the subjects service, compat shim, and tests.',
    },
    schema: [],
    messages: {
      forbidden:
        'Use useAllowedSubjects() or getAllowedSubjectsForStudent() instead of importing "{{name}}" from constants.',
      forbiddenLocal:
        'Do not redeclare "{{name}}" locally — use useAllowedSubjects() (client) or getAllowedSubjectsForStudent() (server) so grade/plan/stream gating is honoured.',
    },
  },
  create(context) {
    const file = (context.getFilename() || '').replace(/\\/g, '/');
    // Allow the compat shim itself, the subjects service, any test files,
    // and the eslint plugin itself (where these names appear in strings).
    const isAllowed =
      file.includes('src/lib/subjects.ts') ||
      file.includes('src/lib/subjects.types.ts') ||
      file.includes('src/lib/constants.ts') ||
      file.includes('src/__tests__/') ||
      file.includes('eslint-plugin-alfanumrik/') ||
      file.endsWith('.test.ts') ||
      file.endsWith('.test.tsx');
    if (isAllowed) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source && node.source.value;
        if (typeof source !== 'string') return;
        // Match @/lib/constants, ./constants, ../constants, ./constants.ts, etc.
        if (!/(^|\/)constants(\.ts)?$/.test(source)) return;
        for (const spec of node.specifiers || []) {
          const name = spec.imported && spec.imported.name;
          if (name && FORBIDDEN_NAMES.has(name)) {
            context.report({
              node: spec,
              messageId: 'forbidden',
              data: { name },
            });
          }
        }
      },
      // Block `function getSubjectsForGrade(...) { ... }` in non-allowed files.
      FunctionDeclaration(node) {
        if (node.id && FORBIDDEN_NAMES.has(node.id.name)) {
          context.report({
            node: node.id,
            messageId: 'forbiddenLocal',
            data: { name: node.id.name },
          });
        }
      },
      // Block `const getSubjectsForGrade = ...`, `const GRADE_SUBJECTS = ...`
      // at module or block scope.
      VariableDeclarator(node) {
        if (node.id && node.id.type === 'Identifier' && FORBIDDEN_NAMES.has(node.id.name)) {
          context.report({
            node: node.id,
            messageId: 'forbiddenLocal',
            data: { name: node.id.name },
          });
        }
      },
    };
  },
};

module.exports = {
  rules: {
    [NAME]: rule,
  },
};
