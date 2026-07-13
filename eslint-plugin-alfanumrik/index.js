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
// Phase 3 — canonical-write boundary (ADR-005 §"The enforceable rule" #1)
const noCanonicalWriteOutsideProjector = require('./no-canonical-write-outside-projector');
// ADR-007 taxonomy boundary (tech-debt register item 9, 2026-07-13)
const noInlineTaxonomyReads = require('./no-inline-taxonomy-reads');

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
    'no-canonical-write-outside-projector':
      noCanonicalWriteOutsideProjector.rules['no-canonical-write-outside-projector'],
    'no-inline-taxonomy-reads': noInlineTaxonomyReads.rules['no-inline-taxonomy-reads'],
    // Grounding-boundary rules (Tasks 3.18 / 3.19)
    'no-direct-ai-calls': noDirectAiCalls,
    'no-direct-rag-rpc': noDirectRagRpc,
  },
};
