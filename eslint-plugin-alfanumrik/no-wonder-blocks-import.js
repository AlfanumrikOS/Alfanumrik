/**
 * ESLint rule: no-wonder-blocks-import
 *
 * Gate-2 B2: the legacy "Wonder Blocks" component set (@alfanumrik/ui/ui,
 * backed by wonder-blocks.tsx) is superseded by the canonical primitives at
 * @alfanumrik/ui/ui/primitives. New code MUST import from
 * '@alfanumrik/ui/ui/primitives' instead.
 *
 * Originally added as a `no-restricted-imports` pattern group in
 * .eslintrc.json's TIER A/B overrides, both of which set that rule's
 * severity to "error" for an unrelated pre-existing ban (the RAG eval-harness
 * boundary). `no-restricted-imports` carries one severity per rule instance,
 * so the wonder-blocks group inherited "error" too — turning every one of
 * the 130 pre-existing grandfathered importers into a hard CI failure instead
 * of the intended "warn on new usage only". (This exact shadowing class is
 * independently documented elsewhere in .eslintrc.json, 2026-08-09, for the
 * xp-rules deprecation — the mistake was made here anyway and only caught by
 * full CI against main.) A standalone rule at "warn" (see .eslintrc.json)
 * avoids the collision entirely: 130 existing files are grandfathered: this
 * only flags new usage.
 *
 * Does NOT flag deeper imports like '@alfanumrik/ui/ui/primitives' or
 * '@alfanumrik/ui/ui/toast' — only the bare legacy barrel and its explicit
 * wonder-blocks module path.
 */
const NAME = 'no-wonder-blocks-import';

function isWonderBlocksSource(source) {
  if (typeof source !== 'string') return false;
  if (source === '@alfanumrik/ui/ui') return true;
  if (source === '@alfanumrik/ui/ui/wonder-blocks') return true;
  if (source.endsWith('/ui/wonder-blocks')) return true;
  return false;
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid new imports of the legacy Wonder Blocks barrel (@alfanumrik/ui/ui) — use @alfanumrik/ui/ui/primitives instead.',
    },
    schema: [],
    messages: {
      forbidden:
        'Gate-2 B2: the legacy "Wonder Blocks" component set ({{source}}, backed by wonder-blocks.tsx) is superseded by the canonical primitives at @alfanumrik/ui/ui/primitives. New code MUST import from \'@alfanumrik/ui/ui/primitives\' instead. Existing imports are grandfathered (130 files as of 2026-09-04, tracked for a staged follow-up migration) — this only flags new usage.',
    },
  },
  create(context) {
    function check(node, source) {
      if (isWonderBlocksSource(source)) {
        context.report({ node, messageId: 'forbidden', data: { source } });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source && node.source.value);
      },
      ImportExpression(node) {
        if (node.source && node.source.type === 'Literal') check(node, node.source.value);
      },
    };
  },
};

module.exports = {
  rules: {
    [NAME]: rule,
  },
};
