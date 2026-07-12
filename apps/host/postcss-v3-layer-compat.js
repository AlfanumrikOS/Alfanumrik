/**
 * Safari 14 parses scoped selectors but predates cascade layers. Duplicate only
 * the isolated V3 layer as unlayered fallback declarations while retaining the
 * authored layer for modern browsers. Every selector remains data-experience
 * scoped, so this cannot repaint legacy pages.
 */
module.exports = function v3LayerCompat() {
  return {
    postcssPlugin: 'alfanumrik-v3-layer-compat',
    Once(root) {
      root.walkAtRules('layer', (rule) => {
        if (rule.params.trim() !== 'alfanumrik-v3' || !rule.nodes?.length) return;
        const fallbacks = rule.nodes.map((node) => node.clone());
        rule.before(fallbacks);
      });
    },
  };
};

module.exports.postcss = true;
