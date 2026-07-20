/**
 * math/normalize — THE canonical math-normalization module.
 *
 * This is the single source of truth for every math-normalization pass on the
 * platform. It merges (2026-07 consolidation):
 *
 *   1. `normalizeLatexDelimiters` — string-level delimiter conversion
 *      (previously defined in `foxy/RichContent.tsx`). Converts `\(..\)` /
 *      `\[..\]` to `$..$` / `$$..$$` so `remark-math` can see them.
 *   2. `tokenizeInline` — the delimiter tokenizer (previously defined in
 *      `foxy/FoxyStructuredRenderer.tsx`). Splits a prose string into ordered
 *      text/math segments. Accepts BOTH `\(..\)`/`\[..\]` AND `$..$`/`$$..$$`
 *      defensively (the platform contract is `\(..\)` but the renderer
 *      tolerates both).
 *   3. The undelimited-LaTeX rescue pass (previously
 *      `foxy/math-normalization.ts`) — segment-level correction for model
 *      output that omits delimiters entirely. Strict allowlist trigger,
 *      byte-identity guarantee for non-math input.
 *
 * `foxy/math-normalization.ts` re-exports from this module — there is exactly
 * ONE normalizer source of truth. Regression pins:
 *   - apps/host/src/__tests__/foxy/undelimited-math-normalization.test.tsx
 *   - apps/host/src/__tests__/foxy/math-canary-corpus.test.ts (REG-257)
 * Their contracts (trigger predicate, span rule, reference-equality fast
 * path) are binding — do not change behavior here without assessment +
 * ai-engineer review.
 */

// ── Shared segment shape ─────────────────────────────────────────────────────

export type InlineSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; latex: string; display: boolean };

// ── Pass 1: string-level delimiter normalization (for remark-math) ───────────

/**
 * Normalises LaTeX delimiters so `remark-math` can see them.
 *
 * `remark-math` recognises `$…$` (inline) and `$$…$$` (block) but NOT the
 * `\( … \)` / `\[ … \]` style Claude frequently emits. Without this step,
 * legacy markdown answers render the raw `\( \frac{3}{4} \)` delimiters as
 * plain text. We convert:
 *   `\[ … \]` → `$$ … $$`   (display)
 *   `\( … \)` → `$ … $`     (inline)
 *
 * `$..$` / `$$..$$` input passes through unchanged (already the target form).
 * Non-greedy, `[\s\S]` so multi-line LaTeX is captured. Pure string
 * transform — no dependency.
 */
export function normalizeLatexDelimiters(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$$${inner}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`);
}

// ── Pass 2: delimiter tokenizer (for the KaTeX-direct renderer) ──────────────

/**
 * Split a prose string into ordered text / math segments.
 *
 * Recognised math delimiters (longest/most-specific matched first so `$$`
 * wins over `$` and `\[`/`\(` are not mistaken for stray backslashes):
 *   - `\[ … \]`  → display math
 *   - `$$ … $$`  → display math
 *   - `\( … \)`  → inline math
 *   - `$ … $`    → inline math (single, non-greedy; ignores escaped `\$`)
 *
 * Escaped `\$` is treated as a literal dollar and never opens/closes a `$`
 * math span. Only the INNER LaTeX (delimiters stripped) is handed to KaTeX.
 * Unterminated delimiters are left as literal text (no crash, no swallow).
 */
export function tokenizeInline(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let buf = '';
  let i = 0;
  const n = input.length;

  const flushText = () => {
    if (buf) {
      segments.push({ kind: 'text', value: buf });
      buf = '';
    }
  };

  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];

    // Escaped dollar: literal `$`, consume both chars, never a delimiter.
    if (ch === '\\' && next === '$') {
      buf += '$';
      i += 2;
      continue;
    }

    // Display math: \[ … \]
    if (ch === '\\' && next === '[') {
      const close = input.indexOf('\\]', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({
          kind: 'math',
          latex: input.slice(i + 2, close).trim(),
          display: true,
        });
        i = close + 2;
        continue;
      }
    }

    // Inline math: \( … \)
    if (ch === '\\' && next === '(') {
      const close = input.indexOf('\\)', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({
          kind: 'math',
          latex: input.slice(i + 2, close).trim(),
          display: false,
        });
        i = close + 2;
        continue;
      }
    }

    // Display math: $$ … $$
    if (ch === '$' && next === '$') {
      const close = input.indexOf('$$', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({
          kind: 'math',
          latex: input.slice(i + 2, close).trim(),
          display: true,
        });
        i = close + 2;
        continue;
      }
    }

    // Inline math: $ … $ (single). Scan for the next unescaped `$`.
    if (ch === '$') {
      let j = i + 1;
      let found = -1;
      while (j < n) {
        if (input[j] === '\\' && input[j + 1] === '$') {
          j += 2;
          continue;
        }
        if (input[j] === '$') {
          found = j;
          break;
        }
        j += 1;
      }
      if (found !== -1 && found > i + 1) {
        const inner = input.slice(i + 1, found).replace(/\\\$/g, '$').trim();
        flushText();
        segments.push({ kind: 'math', latex: inner, display: false });
        i = found + 1;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flushText();
  return segments;
}

// ── Pass 3: undelimited-LaTeX rescue (render-time correction) ────────────────
//
// ROOT CAUSE (2026-07, production screenshots): the Foxy model sometimes emits
// inline math WITHOUT the required delimiters — e.g.
//
//     Example: (\frac{14}{15} \times \frac{25}{42})
//
// instead of `\(\frac{14}{15} \times \frac{25}{42}\)`. The tokenizer above
// only enters math mode on `\(`, `\[`, `$`, `$$`, so these spans fell through
// to the text branch and students saw raw LaTeX.
//
// This pass is a PURE post-pass over the tokenizer's output. It is
// deliberately fail-safe and narrow:
//
//   TRIGGER RULE (binding CEO constraint): normalization fires ONLY when a
//   text span contains an EXPLICIT backslash LaTeX command from the allowlist
//   below, matched with a word boundary (`\frac` matches; `\franchise` never
//   does). It NEVER triggers on bare `^`, `_`, or `$` — those occur in normal
//   prose and code (`snake_case`, `x^2 in prose`, `price is $5`).
//
//   SPAN RULE: around each allowlisted command we capture the maximal
//   contiguous run of math-shaped tokens (digits, braces, operators,
//   single-letter variables, further backslash commands). Prose words (two or
//   more consecutive letters outside a backslash-command token) break the
//   run, so adjacent prose is never swallowed. If the resulting span is
//   wrapped in a single matching pair of parentheses — the model's fake
//   delimiters — the parens are stripped and only the inner LaTeX is
//   rendered. Text outside the span is preserved byte-for-byte.
//
// Already-delimited math never reaches this pass (the tokenizer extracts it
// first), so properly-delimited content tokenizes byte-identically to before.
//
// P12: the caller renders the produced `math` segments through the KaTeX
// path (`throwOnError: false` + `<code>` fallback) — a bad span can degrade
// but can never throw or blank the chat.
//
// No new dependencies. No user-facing strings (bilingual-neutral).

/**
 * Backslash commands that qualify a span as "definitely math".
 *
 * Scope: commands the Foxy model actually emits for CBSE grades 6-12
 * (fractions, arithmetic, relations, trig/log, geometry, Greek letters,
 * basic calculus/sets for 11-12). Every entry is a valid KaTeX command so a
 * triggered span renders rather than degrading to the error fallback.
 *
 * Matching is case-sensitive (LaTeX is) and word-bounded: the command must
 * NOT be followed by another letter, so `\franchise` never matches `\frac`.
 */
export const MATH_COMMAND_ALLOWLIST: readonly string[] = [
  // Fractions / roots / binomials
  'frac', 'dfrac', 'tfrac', 'sqrt', 'binom',
  // Arithmetic operators
  'times', 'div', 'cdot', 'pm', 'mp',
  // Relations
  'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'equiv', 'sim', 'simeq',
  'cong', 'propto', 'parallel', 'perp',
  // Sets (class 11-12)
  'subset', 'supset', 'subseteq', 'supseteq', 'in', 'notin', 'cup', 'cap',
  'forall', 'exists', 'emptyset', 'varnothing',
  // Negation slash — NCERT Class 11 Sets writes `\not\subset` (KaTeX renders
  // `\not` as a combining negation). Safe as a trigger: matching requires the
  // literal backslash AND the (?![a-zA-Z]) word boundary, so prose "not" never
  // fires and `\notin` is unaffected (`not` inside `\notin` fails the boundary
  // on the following `i`; the alternation is also longest-first so `notin` is
  // tried before `not` before `nu` — see the ordering pins in
  // apps/host/src/__tests__/foxy/undelimited-math-normalization.test.tsx).
  'not',
  // Arrows / logic (therefore & because are everywhere in CBSE geometry proofs)
  'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow',
  'implies', 'iff', 'therefore', 'because',
  // Big operators / calculus
  'int', 'sum', 'prod', 'lim',
  // Named functions
  'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'arcsin', 'arccos', 'arctan',
  // Decorations (overline → recurring decimals; vec/overrightarrow → vectors)
  'overline', 'underline', 'vec', 'bar', 'hat', 'dot',
  'overrightarrow', 'overleftarrow',
  // Geometry
  'angle', 'triangle', 'degree', 'circ',
  // Greek — lowercase
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
  'phi', 'varphi', 'chi', 'psi', 'omega',
  // Greek — uppercase
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi',
  'Omega',
  // Structure / text-in-math / ellipses
  'infty', 'left', 'right', 'text', 'mathrm', 'mathbf',
  'ldots', 'cdots', 'dots',
  //
  // DECISION (2026-07-20, evaluated with assessment — Class 12 matrices):
  // `begin` (`\begin{bmatrix}...\end{bmatrix}`) is DEFERRED, not added.
  //   (a) Trigger safety is NOT the blocker: `\begin` needs a literal
  //       backslash + word boundary, so it can never false-positive on prose.
  //   (b) The SPAN RULE is the blocker: a matrix environment contains `&`
  //       column separators (outside MATH_SAFE), `\\` row breaks, and `\end`
  //       (not allowlisted) — the token-run capture would truncate the
  //       environment at the first `&`, hand KaTeX an unclosed `\begin{...}`
  //       head, and degrade to the <code> fallback where today the raw text
  //       at least stays readable. Rescuing environments needs a dedicated
  //       environment-aware span rule (match `\begin{X}...\end{X}` as one
  //       unit), not an allowlist entry. Repair-side `begin` is likewise
  //       deferred — see JSON_REPAIR_EXTRA_COMMANDS in
  //       packages/lib/src/foxy/json-escape-repair.ts.
];

// Alternation sorted longest-first so more specific commands are preferred
// deterministically (`\left` before `\le`). The trailing negative lookahead
// is the word boundary: a command match must not be followed by a letter.
const COMMAND_ALTERNATION = [...MATH_COMMAND_ALLOWLIST]
  .sort((a, b) => b.length - a.length)
  .join('|');

// Non-global on purpose: `.test()` on a /g regex mutates lastIndex across
// calls, which would make the predicate stateful. This one is pure.
const COMMAND_RE = new RegExp(`\\\\(?:${COMMAND_ALTERNATION})(?![a-zA-Z])`);

/**
 * THE TRIGGER PREDICATE (exported for the production canary corpus tests).
 *
 * True iff `text` contains at least one allowlisted backslash command with a
 * word boundary. Bare `^`, `_`, `$`, brackets, or non-allowlisted commands
 * (`\franchise`) never trigger.
 */
export function containsAllowlistedMathCommand(text: string): boolean {
  return COMMAND_RE.test(text);
}

/**
 * Cheap gate used by `MathRenderer` to decide whether to load the KaTeX
 * chunk at all. True when the content contains ANY delimiter that
 * `tokenizeInline` could open (`\(`, `\[`, `$`) or an allowlisted
 * backslash command (the undelimited-rescue trigger). A false positive
 * (e.g. a lone `$5` price) merely loads KaTeX and renders the text
 * unchanged; a false negative would leave raw LaTeX on screen — so this
 * errs permissive on `$`.
 */
export function containsRenderableMath(text: string): boolean {
  if (!text) return false;
  if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) {
    return true;
  }
  return containsAllowlistedMathCommand(text);
}

// ── Token classification ─────────────────────────────────────────────────────
//
// Span detection works on whitespace-delimited tokens so surrounding prose is
// preserved exactly (we only ever slice the original string at token
// boundaries).

// Characters permitted inside an undelimited math span, per the span rule:
// letters/digits/braces/spaces + - * / = ( ) . , ^ _ (+ backslash commands).
const MATH_SAFE = /^[A-Za-z0-9{}+\-*/=().,^_]+$/;
const MATH_SAFE_WITH_BACKSLASH = /^[A-Za-z0-9{}+\-*/=().,^_\\]+$/;

// Two or more consecutive letters outside a backslash command ⇒ a prose word
// ("and", "by", "cake") — must never be swallowed into a math span. Single
// letters stay eligible (variables: x, y, a).
const PROSE_WORD = /[A-Za-z]{2}/;

// Sentence punctuation glued to the END of a token ("…\frac{3}{8}." /
// "…\frac{25}{4}),"). It is trimmed off the math span (stays as prose text)
// and terminates the span.
const TRAILING_PUNCT = /[?!.,;:]+$/;

/**
 * Is this whitespace-delimited token (with trailing sentence punctuation
 * already trimmed) part of a math expression?
 */
function isMathyCore(core: string): boolean {
  if (!core) return false;
  if (core.includes('\\')) {
    // A backslash token must contain an allowlisted command AND be composed
    // only of math-safe characters. Unknown commands (`\franchise`) and
    // tokens with unsafe characters break the span — conservative by design.
    return COMMAND_RE.test(core) && MATH_SAFE_WITH_BACKSLASH.test(core);
  }
  return MATH_SAFE.test(core) && !PROSE_WORD.test(core);
}

/**
 * If the span is wrapped in ONE matching pair of parentheses — the model's
 * fake delimiters, e.g. `(\frac{14}{15} \times \frac{25}{42})` — strip them
 * and return the inner LaTeX. If the leading `(` closes before the end
 * (e.g. `(a+b)(c+d)`) or the parens are unbalanced, return the span as-is.
 */
function stripWrappingParens(span: string): string {
  if (span.length < 2 || span[0] !== '(' || span[span.length - 1] !== ')') {
    return span;
  }
  let depth = 0;
  for (let k = 0; k < span.length; k += 1) {
    if (span[k] === '(') depth += 1;
    else if (span[k] === ')') {
      depth -= 1;
      if (depth < 0) return span; // unbalanced
      if (depth === 0 && k < span.length - 1) return span; // closes early
    }
  }
  if (depth !== 0) return span; // unbalanced (never closed)
  const inner = span.slice(1, -1).trim();
  return inner.length > 0 ? inner : span;
}

/**
 * Split a PLAIN-TEXT segment (already known to contain no delimited math)
 * into text/math segments by detecting undelimited LaTeX spans.
 *
 * Algorithm:
 *   1. If the trigger predicate fails, return the input untouched (single
 *      text segment).
 *   2. Tokenize on whitespace, keeping exact source positions. Trim trailing
 *      sentence punctuation from each token before classification.
 *   3. A maximal run of consecutive math-shaped tokens becomes a math segment
 *      IFF at least one token in the run contains an allowlisted command
 *      (runs of bare numbers like "14 and 42" never convert). A token with
 *      trailing punctuation may end a run but not continue it.
 *   4. Fake wrapping parens around the whole span are stripped.
 *   5. All other bytes — including inter-token whitespace — are re-emitted
 *      verbatim as text segments.
 */
export function splitUndelimitedMath(text: string): InlineSegment[] {
  if (!text) return [];
  if (!containsAllowlistedMathCommand(text)) {
    return [{ kind: 'text', value: text }];
  }

  interface Tok {
    start: number;
    /** End of the math-eligible core (trailing punctuation excluded). */
    coreEnd: number;
    mathy: boolean;
    hasCommand: boolean;
    /** Trailing punctuation present ⇒ a run may end here but not continue. */
    terminal: boolean;
  }

  const toks: Tok[] = [];
  const WORD = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = WORD.exec(text)) !== null) {
    const raw = m[0];
    const punct = raw.match(TRAILING_PUNCT);
    const core = punct ? raw.slice(0, raw.length - punct[0].length) : raw;
    const mathy = isMathyCore(core);
    toks.push({
      start: m.index,
      coreEnd: m.index + core.length,
      mathy,
      hasCommand: mathy && core.includes('\\') && COMMAND_RE.test(core),
      terminal: punct !== null,
    });
  }

  const segments: InlineSegment[] = [];
  let cursor = 0;
  let i = 0;
  while (i < toks.length) {
    if (!toks[i].mathy) {
      i += 1;
      continue;
    }
    // Extend the run over consecutive mathy tokens; a terminal token
    // (trailing punctuation) closes the run.
    let j = i;
    let hasCommand = false;
    while (j < toks.length && toks[j].mathy) {
      hasCommand = hasCommand || toks[j].hasCommand;
      const terminal = toks[j].terminal;
      j += 1;
      if (terminal) break;
    }
    if (!hasCommand) {
      // Math-shaped but command-less (e.g. bare "14") — stays prose.
      i = j;
      continue;
    }
    const runStart = toks[i].start;
    const runEnd = toks[j - 1].coreEnd;
    if (runStart > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, runStart) });
    }
    const latex = stripWrappingParens(text.slice(runStart, runEnd).trim());
    segments.push({ kind: 'math', latex, display: false });
    cursor = runEnd;
    i = j;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }
  return segments;
}

/**
 * Post-pass over `tokenizeInline` output: expand undelimited LaTeX inside
 * TEXT segments into math segments. Math segments (properly-delimited input)
 * are passed through untouched.
 *
 * Returns the ORIGINAL array (reference-equal) when nothing changed, so
 * "already-correct input is byte-identical" is a checkable guarantee.
 */
export function normalizeMathSegments(
  segments: InlineSegment[],
): InlineSegment[] {
  let changed = false;
  const out: InlineSegment[] = [];
  for (const seg of segments) {
    if (seg.kind !== 'text' || !containsAllowlistedMathCommand(seg.value)) {
      out.push(seg);
      continue;
    }
    const split = splitUndelimitedMath(seg.value);
    if (split.length === 1 && split[0].kind === 'text') {
      out.push(seg);
      continue;
    }
    changed = true;
    out.push(...split);
  }
  return changed ? out : segments;
}
