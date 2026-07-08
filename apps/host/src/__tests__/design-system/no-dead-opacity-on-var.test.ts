/**
 * REG-238 — Dead opacity-on-var utility guard (DD-16 regression pin).
 *
 * WHY THIS EXISTS
 * ---------------
 * Alfanumrik's semantic colour tokens (`primary`, `success`, `surface-1`,
 * `foreground`, `on-accent`, …) are defined in tailwind.config.js as full
 * CSS custom-property VALUES — e.g. `primary: 'var(--primary)'`. Tailwind's
 * `/NN` opacity modifier can only inject an alpha channel into a colour it can
 * decompose (palette hex/rgb, or the `white`/`black`/`transparent`/`current`
 * keywords). Against a `var(--token)` value it CANNOT — so a class like
 * `bg-primary/10` emits no usable alpha: the intended 10 % wash silently
 * renders at full opacity (or drops entirely). These "dead opacity-on-var"
 * classes are a recurring DD-16 bug: they look correct in source, pass the
 * type-checker and the linter, and quietly ship the wrong colour.
 *
 * The fix is always the same — express the alpha with `color-mix`:
 *     bg-primary/10  →  bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]
 *
 * This test greps every `.tsx` under src/app + src/components and FAILS if a
 * dead opacity-on-var utility reappears. Palette colours (white / black /
 * transparent / current) DO support the `/NN` modifier and are intentionally
 * allowed.
 *
 * Fast (single synchronous fs walk, pure regex), deterministic, no network.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Vitest runs with cwd = repo root; __dirname is <repo>/src/__tests__/design-system.
const REPO_ROOT =
  typeof __dirname !== 'undefined' ? join(__dirname, '..', '..', '..') : process.cwd();

const SCAN_DIRS = [join('src', 'app'), join('src', 'components')];

/**
 * The var-valued token families from tailwind.config.js. Each is a full
 * `var(--…)` value, so NONE of them can carry a Tailwind `/NN` alpha modifier.
 * Palette colours (white/black/transparent/current) are deliberately absent —
 * they DO support `/NN` and must keep passing.
 */
const DEAD_OPACITY_ON_VAR =
  /(?<![-\w])(bg|text|border|ring|from|to|via|divide|outline|fill|stroke|caret|decoration|accent)-(surface-(?:[0-9]+|inverse|sunken|accent)|primary(?:-light|-hover)?|secondary|success|warning|danger(?:-light)?|info|muted-foreground|foreground|on-[a-z-]+)\/[0-9]+/g;

function collectTsx(absDir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return; // dir may not exist in some checkouts — skip silently
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next') continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectTsx(abs, out);
    } else if (name.endsWith('.tsx')) {
      out.push(abs);
    }
  }
}

describe('REG-238: no dead opacity-on-var utilities', () => {
  it('regex sanity — matches known-bad, ignores palette + color-mix (self-check)', () => {
    // Known-bad dead classes MUST be caught.
    for (const bad of [
      'bg-primary/10',
      'text-foreground/80',
      'border-success/30',
      'hover:bg-danger/20',
      'from-secondary/40',
      'bg-surface-1/25',
      'text-on-accent/50',
      'bg-surface-inverse/10',
    ]) {
      DEAD_OPACITY_ON_VAR.lastIndex = 0;
      expect(DEAD_OPACITY_ON_VAR.test(bad), `should flag "${bad}"`).toBe(true);
    }

    // Palette colours support `/NN` — must NOT be flagged.
    // color-mix arbitrary values are the sanctioned fix — must NOT be flagged.
    // Bare tokens without an opacity modifier are fine.
    for (const ok of [
      'bg-white/5',
      'bg-black/40',
      'text-white/70',
      'bg-transparent',
      'text-current',
      'bg-orange-500/20', // palette scale, not a var token
      'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]',
      'text-[color-mix(in_srgb,var(--text-1)_80%,transparent)]',
      'bg-primary',
      'text-foreground',
      'border-success',
    ]) {
      DEAD_OPACITY_ON_VAR.lastIndex = 0;
      expect(DEAD_OPACITY_ON_VAR.test(ok), `should NOT flag "${ok}"`).toBe(false);
    }
  });

  it('src/app + src/components are free of dead opacity-on-var classes', () => {
    const files: string[] = [];
    for (const rel of SCAN_DIRS) collectTsx(join(REPO_ROOT, rel), files);

    // Guard against a broken walk silently passing the test.
    expect(files.length).toBeGreaterThan(50);

    const violations: string[] = [];
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        DEAD_OPACITY_ON_VAR.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = DEAD_OPACITY_ON_VAR.exec(lines[i])) !== null) {
          const relPath = abs.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
          violations.push(`${relPath}:${i + 1}  →  "${m[0]}"`);
        }
      }
    }

    if (violations.length > 0) {
      const help =
        `\nFound ${violations.length} dead opacity-on-var utility(ies). ` +
        `Tailwind's /NN modifier emits no alpha for var()-valued semantic tokens, ` +
        `so these render at the wrong opacity.\n` +
        `FIX: replace  bg-primary/10  →  bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]\n\n` +
        violations.join('\n') +
        '\n';
      expect.fail(help);
    }

    expect(violations).toEqual([]);
  });
});
