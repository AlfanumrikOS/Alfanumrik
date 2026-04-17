/**
 * ESLint rule: no-direct-rag-rpc
 *
 * Enforces spec §4 invariant #2: the grounded-answer service owns retrieval.
 * All callers must route through grounded-client.ts (which dispatches to
 * grounded-answer, which calls the RAG RPCs). Direct `.rpc('match_rag_chunks')`
 * or `.rpc('match_rag_chunks_ncert')` calls from outside the service are a
 * correctness risk — they bypass board filtering, quality gates, and trace
 * logging.
 *
 * Detects:
 *   - `supabase.rpc('match_rag_chunks')` and any argument matching
 *     /^match_rag_chunks(_[a-z]+)?$/
 *
 * Allowlist (rule skipped):
 *   - supabase/functions/grounded-answer/**
 *   - supabase/functions/_shared/**         (shared retrieval helpers)
 *   - eslint-rules/**                       (self-reference)
 *
 * Expected legacy violations:
 *   - src/lib/ai/retrieval/ncert-retriever.ts  (calls match_rag_chunks_ncert)
 *   - src/app/api/concept-engine/route.ts     (calls match_rag_chunks)
 * These get eslint-disable comments with TODO(phase-4-cleanup) markers.
 *
 * Test fixtures use .rpc() on a mock supabase client — the rule matches on
 * the call expression, not the receiver type, so it triggers on any
 * `X.rpc('match_rag_chunks_foo')` call regardless of the object being
 * supabase/supabaseAdmin/anything else.
 */
'use strict';

const RPC_NAME_RE = /^match_rag_chunks(_[a-z_]+)?$/;

const ALLOWED_PATH_RE = [
  /[\\/]supabase[\\/]functions[\\/]grounded-answer[\\/]/,
  /[\\/]supabase[\\/]functions[\\/]_shared[\\/]/,
  /[\\/]eslint-rules[\\/]/,
];

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct Supabase RPC calls to match_rag_chunks* outside the grounded-answer service. Route through grounded-client.ts to preserve board filtering, quality gating, and trace logging.',
    },
    schema: [],
    messages: {
      forbidden:
        'Direct .rpc("{{name}}") calls are forbidden outside supabase/functions/grounded-answer/. Route through grounded-client.ts.',
    },
  },
  create(context) {
    const filename = (context.getFilename() || '').replace(/\\/g, '/');
    for (const re of ALLOWED_PATH_RE) {
      if (re.test(filename)) return {};
    }

    return {
      CallExpression(node) {
        // Match any X.rpc('match_rag_chunks...') call.
        const callee = node.callee;
        if (
          !callee ||
          callee.type !== 'MemberExpression' ||
          !callee.property ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'rpc'
        ) {
          return;
        }
        const firstArg = node.arguments && node.arguments[0];
        if (!firstArg) return;
        // Literal string
        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string' && RPC_NAME_RE.test(firstArg.value)) {
          context.report({ node: firstArg, messageId: 'forbidden', data: { name: firstArg.value } });
          return;
        }
        // Template literal with single static string
        if (
          firstArg.type === 'TemplateLiteral' &&
          firstArg.expressions.length === 0 &&
          firstArg.quasis.length === 1 &&
          typeof firstArg.quasis[0].value.raw === 'string' &&
          RPC_NAME_RE.test(firstArg.quasis[0].value.raw)
        ) {
          context.report({
            node: firstArg,
            messageId: 'forbidden',
            data: { name: firstArg.quasis[0].value.raw },
          });
        }
      },
    };
  },
};

module.exports = rule;
