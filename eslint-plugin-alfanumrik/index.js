/**
 * eslint-plugin-alfanumrik — local ESLint plugin consolidating all
 * Alfanumrik-specific rules. Rules live in sibling files (here) or in
 * the repo-level `eslint-rules/` directory (grounding-boundary rules
 * owned by the grounded-answer system — kept there to keep config-
 * parity + rule-definition co-located).
 */
'use strict';

const path = require('path');

// Pre-existing rule in this package
const noRawSubjectImports = require('./no-raw-subject-imports');

// Grounding-boundary rules live at the repo root under eslint-rules/
// so they can be tested and referenced without mixing with subject rules.
const noDirectAiCalls = require(path.join(__dirname, '..', 'eslint-rules', 'no-direct-ai-calls'));
const noDirectRagRpc = require(path.join(__dirname, '..', 'eslint-rules', 'no-direct-rag-rpc'));

module.exports = {
  rules: {
    // From sibling file (keeps the existing default export so that the old
    // "main: no-raw-subject-imports.js" path still resolves for any legacy
    // consumers).
    'no-raw-subject-imports': noRawSubjectImports.rules['no-raw-subject-imports'],
    // Grounding-boundary rules (Tasks 3.18 / 3.19)
    'no-direct-ai-calls': noDirectAiCalls,
    'no-direct-rag-rpc': noDirectRagRpc,
  },
};
