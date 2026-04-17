/**
 * ESLint local-plugin registry for grounding-boundary rules.
 *
 * Loaded by .eslintrc.ai-boundary.json as an ESLint plugin via:
 *   "plugins": ["local"]
 * with the plugin resolved through `rulePaths` or a custom resolver. To
 * keep the setup minimal and avoid a separate published package, we expose
 * these rules as a single CJS module and reference them by `./eslint-rules`
 * in the eslint config.
 */
'use strict';

module.exports = {
  rules: {
    'no-direct-ai-calls': require('./no-direct-ai-calls'),
    'no-direct-rag-rpc': require('./no-direct-rag-rpc'),
  },
};