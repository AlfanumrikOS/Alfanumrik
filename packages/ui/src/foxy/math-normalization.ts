/**
 * math-normalization — render-time correction for UNDELIMITED inline LaTeX.
 *
 * ROOT CAUSE (2026-07, production screenshots): the Foxy model sometimes emits
 * inline math WITHOUT the required delimiters — e.g.
 *
 *     Example: (\frac{14}{15} \times \frac{25}{42})
 *
 * instead of `\(\frac{14}{15} \times \frac{25}{42}\)`. The tokenizer in
 * FoxyStructuredRenderer only enters math mode on `\(`, `\[`, `$`, `$$`, so
 * these spans fell through to the text branch and students saw raw LaTeX.
 *
 * This module is a PURE post-pass over the tokenizer's output. It is
 * deliberately fail-safe and narrow:
 *
 *   TRIGGER RULE (binding CEO constraint): normalization fires ONLY when a
 *   text span contains an EXPLICIT backslash LaTeX command from the allowlist
 *   below, matched with a word boundary (`\frac` matches; `\franchise` never
 *   does). It NEVER triggers on bare `^`, `_`, or `$` — those occur in normal
 *   prose and code (`snake_case`, `x^2 in prose`, `price is $5`).
 *
 *   SPAN RULE: around each allowlisted command we capture the maximal
 *   contiguous run of math-shaped tokens (digits, braces, operators,
 *   single-letter variables, further backslash commands). Prose words (two or
 *   more consecutive letters outside a backslash-command token) break the
 *   run, so adjacent prose is never swallowed. If the resulting span is
 *   wrapped in a single matching pair of parentheses — the model's fake
 *   delimiters — the parens are stripped and only the inner LaTeX is
 *   rendered. Text outside the span is preserved byte-for-byte.
 *
 * Already-delimited math never reaches this module (the tokenizer extracts it
 * first), so properly-delimited content tokenizes byte-identically to before.
 *
 * P12: the caller renders the produced `math` segments through the existing
 * KaTeX path (`throwOnError: false` + `<code>` fallback) — a bad span can
 * degrade but can never throw or blank the chat.
 *
 * No new dependencies. No user-facing strings (bilingual-neutral).
 */

// Segment shape shared with FoxyStructuredRenderer's `tokenizeInline`.
export type InlineSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; latex: string; display: boolean };

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
