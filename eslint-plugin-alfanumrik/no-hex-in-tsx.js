/**
 * ESLint rule: no-hex-in-tsx
 *
 * Gate-2 Step B1 (design/06-design-system.md §1): "a lint rule forbids
 * #hex in TSX". Hardcoded hex colours in component files bypass the token
 * system (packages/ui/src/tokens.css) entirely — they can't theme-switch,
 * can't be retinted for white-label branding, and don't get AA-contrast
 * review the way a named token does.
 *
 * Flags any #RGB / #RRGGBB / #RRGGBBAA literal appearing in a string or
 * template literal within .tsx/.jsx files. Does NOT apply to .css/.ts files
 * — token *declarations* (tokens.css, globals.css) legitimately contain hex
 * values; this rule is about component-level *consumption* only.
 *
 * Introduced at "warn" (see .eslintrc.json) — the codebase has thousands of
 * pre-existing hex literals (design/06-design-system.md: "9,000+ hex
 * literals"). This rule stops the count from growing while B2/B3 migrate
 * components onto the token system incrementally.
 */
const NAME = 'no-hex-in-tsx';

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

function isTargetFile(filename) {
  const f = (filename || '').replace(/\\/g, '/');
  return (f.endsWith('.tsx') || f.endsWith('.jsx')) && !f.includes('eslint-plugin-alfanumrik/');
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Forbid hardcoded #hex colour literals in TSX/JSX — use a var(--token) from tokens.css instead.',
    },
    schema: [],
    messages: {
      forbidden: 'Hardcoded colour "{{value}}" — use a var(--token) from packages/ui/src/tokens.css instead of a hex literal.',
    },
  },
  create(context) {
    if (!isTargetFile(context.getFilename())) return {};

    function checkLiteral(node, raw) {
      const match = HEX_RE.exec(raw);
      if (match) {
        context.report({ node, messageId: 'forbidden', data: { value: match[0] } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkLiteral(node, node.value);
      },
      TemplateElement(node) {
        const raw = node.value && node.value.raw;
        if (typeof raw === 'string') checkLiteral(node, raw);
      },
    };
  },
};

module.exports = {
  rules: {
    [NAME]: rule,
  },
};
