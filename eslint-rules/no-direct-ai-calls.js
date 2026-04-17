/**
 * ESLint rule: no-direct-ai-calls
 *
 * Enforces spec §4 invariant #1: the grounded-answer service is the ONLY
 * code path that may hit upstream AI providers (Claude, Voyage). Everything
 * else must route through it — the rationale being that grounding,
 * retrieval, citation, PII redaction, and circuit-breaker policy can only
 * be guaranteed at one choke point.
 *
 * Detects:
 *   1. ImportDeclaration — `import ... from "@anthropic-ai/..."` or
 *      `import ... from "voyageai"` (any variant matching /^@?anthropic-ai|voyageai/)
 *   2. String literal URLs — `'https://api.anthropic.com/...'` or
 *      `'https://api.voyageai.com/...'` anywhere in source (most commonly
 *      a fetch URL).
 *
 * Allowlist (rule is disabled for these paths):
 *   - `supabase/functions/grounded-answer/**`     (the service itself)
 *   - `supabase/functions/_shared/grounded-client.ts`  (client TO the service — has no AI calls, but lives alongside shared infra that might use embeddings)
 *   - `supabase/functions/_shared/embeddings.ts`  (Voyage client used by grounded-answer)
 *   - `supabase/functions/_shared/reranking.ts`   (reranker may call upstream)
 *   - any file with `// eslint-disable-next-line no-direct-ai-calls` or
 *     block-level `/* eslint-disable no-direct-ai-calls *\/` — ESLint
 *     handles these natively when the rule is registered.
 *
 * Suppressing a violation requires a `-- REASON: ...` comment after the
 * disable directive (ESLint's `no-warning-comments` isn't triggered here;
 * the comment is an auditable trail for the Phase-4 legacy cleanup).
 */
'use strict';

const AI_IMPORT_RE = /^@?anthropic-ai|^voyageai/;
const AI_URL_RE = /api\.(anthropic|voyageai)\.com/;

const ALLOWED_PATH_RE = [
  /[\\/]supabase[\\/]functions[\\/]grounded-answer[\\/]/,
  /[\\/]supabase[\\/]functions[\\/]_shared[\\/]grounded-client\.ts$/,
  /[\\/]supabase[\\/]functions[\\/]_shared[\\/]embeddings\.ts$/,
  /[\\/]supabase[\\/]functions[\\/]_shared[\\/]reranking\.ts$/,
  /[\\/]eslint-rules[\\/]/, // the rule file itself and its fixtures
];

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct AI API calls (Anthropic SDK, Voyage SDK, or direct HTTPS URLs) outside the grounded-answer service.',
    },
    schema: [],
    messages: {
      forbiddenImport:
        'Direct imports from "{{module}}" are forbidden outside supabase/functions/grounded-answer/. Route through the grounded-answer service (see supabase/functions/_shared/grounded-client.ts).',
      forbiddenUrl:
        'Direct fetches to "{{url}}" are forbidden outside supabase/functions/grounded-answer/. Route through the grounded-answer service.',
    },
  },
  create(context) {
    const filename = (context.getFilename() || '').replace(/\\/g, '/');
    // Cheap short-circuit: if the file is in an allowed location, skip.
    for (const re of ALLOWED_PATH_RE) {
      if (re.test(filename)) return {};
    }

    return {
      ImportDeclaration(node) {
        const src = node.source && node.source.value;
        if (typeof src !== 'string') return;
        if (AI_IMPORT_RE.test(src)) {
          context.report({
            node,
            messageId: 'forbiddenImport',
            data: { module: src },
          });
        }
      },
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (AI_URL_RE.test(node.value)) {
          context.report({
            node,
            messageId: 'forbiddenUrl',
            data: { url: node.value },
          });
        }
      },
      TemplateLiteral(node) {
        // Catch `fetch(\`https://api.anthropic.com/v1/messages\`, ...)` too.
        for (const quasi of node.quasis || []) {
          if (quasi.value && AI_URL_RE.test(quasi.value.raw || '')) {
            context.report({
              node: quasi,
              messageId: 'forbiddenUrl',
              data: { url: quasi.value.raw },
            });
            return;
          }
        }
      },
    };
  },
};

module.exports = rule;