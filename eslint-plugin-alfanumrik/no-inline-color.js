/**
 * ESLint rule: no-inline-color
 *
 * Gate-2 Step B1 (design/06-design-system.md §1): "a lint rule forbids...
 * style={{color}}". Inline style colour props bypass the token system the
 * same way a hex literal does (see no-hex-in-tsx), and are harder to catch
 * by grep since the value is often a variable or expression rather than a
 * literal.
 *
 * Flags a JSX `style={{...}}` object literal that sets a colour-related CSS
 * property (color, backgroundColor, background, borderColor and its
 * per-edge variants, outlineColor, fill, stroke) to anything other than a
 * `var(--...)` string. `style={{ color: 'var(--text-1)' }}` is allowed —
 * that's still going through the token system, just via inline style syntax
 * instead of a Tailwind class.
 *
 * Introduced at "warn" (see .eslintrc.json) for the same incremental-rollout
 * reason as no-hex-in-tsx.
 */
const NAME = 'no-inline-color';

const COLOR_PROPS = new Set([
  'color',
  'backgroundColor',
  'background',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'fill',
  'stroke',
]);

function isTargetFile(filename) {
  const f = (filename || '').replace(/\\/g, '/');
  return (f.endsWith('.tsx') || f.endsWith('.jsx')) && !f.includes('eslint-plugin-alfanumrik/');
}

/** True for a plain string literal that is exactly a var(--...) reference (optionally with a fallback). */
function isVarReference(node) {
  return (
    node &&
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    /^var\(--[\w-]+.*\)$/.test(node.value.trim())
  );
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Forbid inline style={{ color/backgroundColor/... }} that is not a var(--token) reference.',
    },
    schema: [],
    messages: {
      forbidden: '`style={{ {{prop}}: ... }}` — use a var(--token) from packages/ui/src/tokens.css (or a Tailwind class), not an inline colour value.',
    },
  },
  create(context) {
    if (!isTargetFile(context.getFilename())) return {};

    return {
      JSXAttribute(node) {
        if (!node.name || node.name.name !== 'style') return;
        const value = node.value;
        if (!value || value.type !== 'JSXExpressionContainer') return;
        const expr = value.expression;
        if (!expr || expr.type !== 'ObjectExpression') return;

        for (const prop of expr.properties) {
          if (prop.type !== 'Property') continue;
          const key = prop.key;
          const propName = key && (key.name || key.value);
          if (typeof propName !== 'string' || !COLOR_PROPS.has(propName)) continue;
          if (isVarReference(prop.value)) continue; // var(--token) — allowed
          context.report({ node: prop, messageId: 'forbidden', data: { prop: propName } });
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
