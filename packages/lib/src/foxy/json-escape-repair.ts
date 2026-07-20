// json-escape-repair -- pre-parse repair of illegal JSON escapes in LLM output.
//
// TWO byte-identical copies exist (parity-pinned by
// apps/host/src/__tests__/lib/foxy/json-escape-repair-parity.test.ts):
//   - packages/lib/src/foxy/json-escape-repair.ts          (Node source)
//   - supabase/functions/grounded-answer/json-escape-repair.ts (Deno mirror)
// This file is runtime-neutral on purpose: no imports, no Deno/Node APIs.
// Change BOTH copies or neither.
//
// WHY (production incident 2026-07-20): Foxy's structured-output few-shot
// prompts historically showed LaTeX inside JSON strings with SINGLE
// backslashes ("\(", "\frac"). The model imitated them, producing illegal
// JSON escapes. JSON.parse then threw at the FIRST math-bearing block, the
// truncation-rescue path salvaged only the blocks before it, and students
// received a problem restatement with no solution (while telemetry recorded
// success). This module is the defense-in-depth half of the fix: even when
// the model still under-escapes, the payload is repaired BEFORE JSON.parse
// so no content is lost.
//
// POLICY (conservative, string-literal-scoped):
//   The walker tracks JSON string-literal state. OUTSIDE string literals
//   nothing is ever touched. INSIDE a string literal, for each backslash:
//     1. `\"`, `\\`, `\/`             -> legal escape, preserved byte-for-byte.
//     2. `\uXXXX` (4 hex digits)      -> legal unicode escape, preserved.
//     3. `\u` + NOT 4 hex digits     -> always illegal JSON, repaired
//                                        (doubled). Also covers `\underline`.
//     4. `\b` `\f` `\n` `\r` `\t`     -> AMBIGUOUS: a legal control escape OR
//        the head of an under-escaped LaTeX command (`\times` starts with the
//        legal escape `\t`, `\neq` with `\n`, `\frac` with `\f`). Arbiter: the
//        backslash is doubled ONLY when the letter run starting at the escape
//        letter spells a known math command from the allowlist below, with a
//        word boundary (`\times` matches "times"; `\tcell` matches nothing and
//        is preserved as a genuine tab). Otherwise preserved byte-for-byte.
//     5. Any other char (`\(`, `\[`, `\p`, `\s`, `\l`, ...) -> illegal JSON
//        escape (would abort the whole parse), repaired (doubled). This is
//        strictly safer than parsing: JSON.parse turns the survivor into a
//        literal backslash + char, exactly what the model meant.
//
// RESIDUAL AMBIGUITY (documented, accepted): a GENUINE control escape whose
// following letters coincidentally spell an allowlisted command minus its head
// letter is indistinguishable from under-escaped LaTeX and will be repaired in
// favour of LaTeX -- e.g. a real tab immediately followed by "imes" or "o",
// a real newline followed by "eq", a real form-feed followed by "rac". In
// Foxy's student-facing prose these collisions are contrived (the structured
// contract forbids markdown/layout tabs and prose newlines are `\n` followed
// by a space or capital letter), while under-escaped LaTeX was observed in
// 19/29 production math turns -- so the bias is deliberate.
//
// GUARANTEES (unit-pinned in json-escape-repair.test.ts):
//   - Pure, deterministic, single pass, never throws.
//   - Legal escapes (\n \t \" \\ \/ \uXXXX) preserved byte-for-byte.
//   - Nothing repaired outside string literals.
//   - Idempotent: repair(repair(x)) === repair(x) (a doubled backslash is the
//     legal `\\` escape and is preserved on the second pass).
//
// P12: this is pre-parse repair only. The repaired payload still flows through
// the FULL FoxyResponse validation gate -- the bar is never lowered.

/**
 * Math-command arbiter list. MUST stay equal to MATH_COMMAND_ALLOWLIST in
 * packages/ui/src/math/normalize.ts (the renderer's undelimited-math trigger
 * allowlist) -- pinned by the parity test. Duplicated here because this file
 * must be runtime-neutral (Deno cannot import packages/ui, and the Deno copy
 * is byte-identical to the Node copy).
 */
export const JSON_REPAIR_MATH_COMMANDS: readonly string[] = [
  // Fractions / roots / binomials
  'frac', 'dfrac', 'tfrac', 'sqrt', 'binom',
  // Arithmetic operators
  'times', 'div', 'cdot', 'pm', 'mp',
  // Relations
  'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'equiv', 'sim', 'simeq',
  'cong', 'propto', 'parallel', 'perp',
  // Sets (class 11-12). `not` = negation slash (`\not\subset`, NCERT Class 11
  // Sets); its `\n` head needs arbitration. `\notin` is unaffected: `not`
  // inside "notin" fails the (?![a-zA-Z]) boundary on the following `i`, and
  // the alternation is longest-first anyway.
  'subset', 'supset', 'subseteq', 'supseteq', 'in', 'notin', 'not', 'cup',
  'cap', 'forall', 'exists', 'emptyset', 'varnothing',
  // Arrows / logic (therefore & because are everywhere in CBSE geometry proofs)
  'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow',
  'implies', 'iff', 'therefore', 'because',
  // Big operators / calculus
  'int', 'sum', 'prod', 'lim',
  // Named functions
  'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'arcsin', 'arccos', 'arctan',
  // Decorations (overline -> recurring decimals; vec/overrightarrow -> vectors)
  'overline', 'underline', 'vec', 'bar', 'hat', 'dot',
  'overrightarrow', 'overleftarrow',
  // Geometry
  'angle', 'triangle', 'degree', 'circ',
  // Greek -- lowercase
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
  'phi', 'varphi', 'chi', 'psi', 'omega',
  // Greek -- uppercase
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi',
  'Omega',
  // Structure / text-in-math / ellipses
  'infty', 'left', 'right', 'text', 'mathrm', 'mathbf',
  'ldots', 'cdots', 'dots',
];

/**
 * JSON-repair-only arbitration extras. These are NOT renderer triggers (they
 * are intentionally absent from the UI allowlist) but they DO appear in Foxy
 * prompt contracts, so an under-escaped occurrence inside a JSON string must
 * be repaired rather than silently mangled into a control char:
 *   - 'boxed':             \boxed{...} is mandated on raw-markdown surfaces
 *                          and starts with the legal escape `\b`.
 *   - 'rightleftharpoons': the chemistry equilibrium arrow used in the
 *                          few-shot Haber-process example; starts with `\r`.
 *
 * DELIBERATELY ABSENT (evaluated 2026-07-20): 'begin' (Class 12 matrices,
 * `\begin{bmatrix}`, `\b` head). Deferred because repairing only the `\begin`
 * head cannot save an under-escaped matrix: the interior `\\` row separators
 * arrive as the LEGAL escape `\\` (parsing to ONE backslash -- row breaks
 * already lost, correctly untouched by this conservative repair), so the
 * environment stays unrenderable either way, and no under-escaped matrix
 * payload has been observed in production. Revisit with an environment-aware
 * renderer rule if incidents appear -- add it HERE (extras), never to the
 * parity-pinned JSON_REPAIR_MATH_COMMANDS. See the matching decision note in
 * packages/ui/src/math/normalize.ts.
 */
export const JSON_REPAIR_EXTRA_COMMANDS: readonly string[] = [
  'boxed',
  'rightleftharpoons',
];

/** The six letters that are legal single-char JSON escapes. */
const LEGAL_ESCAPE_LETTERS = 'bfnrtu';

// Only commands whose FIRST letter is a legal escape letter need arbitration
// (any other head letter is an illegal escape and always repaired).
// Longest-first so `\therefore` wins over `\theta` over `\the`-nothing.
const ARBITER_ALTERNATION = [
  ...JSON_REPAIR_MATH_COMMANDS,
  ...JSON_REPAIR_EXTRA_COMMANDS,
]
  .filter((cmd) => LEGAL_ESCAPE_LETTERS.includes(cmd[0]))
  .sort((a, b) => b.length - a.length)
  .join('|');

// Anchored + word-bounded: the run starting AT the escape letter must spell a
// known command and must NOT be followed by another latin letter.
const ARBITER_RE = new RegExp(`^(?:${ARBITER_ALTERNATION})(?![a-zA-Z])`);

const HEX4_RE = /^[0-9a-fA-F]{4}$/;

export interface JsonEscapeRepairResult {
  /** The repaired string (=== input when repairCount is 0). */
  repaired: string;
  /** Number of backslashes that were doubled. */
  repairCount: number;
}

/**
 * Conservative pre-parse repair of illegal JSON escapes inside string
 * literals. See module header for the full policy. Pure; never throws.
 */
export function repairIllegalJsonEscapes(raw: string): JsonEscapeRepairResult {
  if (typeof raw !== 'string' || raw.length === 0 || !raw.includes('\\')) {
    return { repaired: raw, repairCount: 0 };
  }

  const out: string[] = [];
  let repairCount = 0;
  let inStr = false;
  let i = 0;
  const n = raw.length;

  while (i < n) {
    const ch = raw[i];

    if (!inStr) {
      if (ch === '"') inStr = true;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === '"') {
      inStr = false;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch !== '\\') {
      out.push(ch);
      i += 1;
      continue;
    }

    // Backslash inside a string literal.
    const next = i + 1 < n ? raw[i + 1] : undefined;

    if (next === undefined) {
      // Trailing backslash (truncated payload) -- leave for the rescue path.
      out.push(ch);
      i += 1;
      continue;
    }

    if (next === '"' || next === '\\' || next === '/') {
      // Legal non-letter escapes. `\\` consumes BOTH chars so a correctly
      // escaped `\\times` is never re-doubled (idempotence).
      out.push(ch, next);
      i += 2;
      continue;
    }

    if (next === 'u') {
      if (HEX4_RE.test(raw.slice(i + 2, i + 6))) {
        // Legal \uXXXX unicode escape, preserved.
        out.push(raw.slice(i, i + 6));
        i += 6;
        continue;
      }
      // `\u` without 4 hex digits is ALWAYS illegal JSON (covers
      // `\underline` and any stray `\u...`). Repair.
      out.push('\\\\');
      repairCount += 1;
      i += 1;
      continue;
    }

    if (LEGAL_ESCAPE_LETTERS.includes(next)) {
      // Ambiguous: legal control escape OR under-escaped LaTeX head.
      // Arbitrate via the math-command allowlist (word-bounded).
      if (ARBITER_RE.test(raw.slice(i + 1))) {
        out.push('\\\\');
        repairCount += 1;
        i += 1; // letter run flows through untouched on subsequent iterations
        continue;
      }
      // Genuine control escape, preserved byte-for-byte.
      out.push(ch, next);
      i += 2;
      continue;
    }

    // Any other char after a backslash is an illegal JSON escape. Repair.
    out.push('\\\\');
    repairCount += 1;
    i += 1;
    continue;
  }

  return repairCount === 0
    ? { repaired: raw, repairCount: 0 }
    : { repaired: out.join(''), repairCount };
}
