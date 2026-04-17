/**
 * ESLint rule: no-raw-subject-imports
 *
 * Forbid raw imports of subject constants (GRADE_SUBJECTS, SUBJECT_META,
 * getSubjectsForGrade, SUBJECT_BY_GRADE) outside src/lib/subjects*.ts and
 * src/lib/constants.ts (the compat shim itself) and test files.
 *
 * Rationale: subjects must be resolved at runtime via useAllowedSubjects()
 * so grade/stream/plan gating, locale, and admin-curated master list are
 * all respected. Hardcoded arrays drift from the database truth.
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
        'Forbid raw imports of GRADE_SUBJECTS/SUBJECT_META outside src/lib/subjects*.ts and the compat shim',
    },
    schema: [],
    messages: {
      forbidden:
        'Use useAllowedSubjects() or getAllowedSubjectsForStudent() instead of importing "{{name}}" from constants.',
    },
  },
  create(context) {
    const file = (context.getFilename() || '').replace(/\\/g, '/');
    // Allow the compat shim itself, the subjects service, and any test files.
    const isAllowed =
      file.includes('src/lib/subjects.ts') ||
      file.includes('src/lib/subjects.types.ts') ||
      file.includes('src/lib/constants.ts') ||
      file.includes('src/__tests__/') ||
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
    };
  },
};

module.exports = {
  rules: {
    [NAME]: rule,
  },
};
