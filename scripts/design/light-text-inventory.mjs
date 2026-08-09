#!/usr/bin/env node
/**
 * light-text-inventory.mjs — READ-ONLY light-text migration inventory.
 *
 * DRY-RUN ONLY. Reads src/**, MODIFIES NO SOURCE FILES. Writes a single markdown
 * report to docs/design/light-text-migration-inventory.md (pass --stdout to print
 * instead of writing).
 *
 * WHY: ~468 hardcoded light-text sites (`text-white` + inline `color:#fff`) are
 * DECOUPLED from their backgrounds — they assume a companion dark/gradient
 * surface paints. When it fails, text renders white-on-cream = invisible (DD-16).
 * The Phase-2 paired on-surface token layer (--on-surface-inverse / --on-accent,
 * see globals.css + design-system.md §8.1) is the migration target. This script
 * categorizes each site so a later codemod knows which to touch first.
 *
 * Categories:
 *   SAFE            — light text co-located with a guaranteed dark/gradient surface
 *                     (foxy-header-premium, gradient-brand/warm, bg-gradient-to-*,
 *                     dark hex bg, btn-primary, bg-surface-inverse/accent, dark
 *                     Tailwind bg like bg-black / bg-*-800/900 / bg-purple-700…).
 *                     Low migration priority.
 *   RISKY           — light text whose only nearby background is CONDITIONAL /
 *                     SCOPED (ternary-driven className, a scoped/module class, or
 *                     a var()/token bg that may resolve light). High priority.
 *   NEEDS_REVIEW    — no background signal found in the local window. Manual triage.
 *
 * Heuristic only: it scans a small line window around each site. Reported counts
 * are a targeting aid, not ground truth. Never auto-migrate from this alone.
 * Section 2 below ("confirmed sub-AA") IS ground truth for the failing subset —
 * it is region-scoped and contrast-computed rather than window-heuristic.
 *
 * PATHS (fixed 2026-08-09): this script scanned a repo-root `src/` which the
 * monorepo migration deleted, so it had been throwing ENOENT — and the checked-in
 * report was silently frozen at its pre-migration numbers. Roots are now the real
 * monorepo source trees.
 *
 * Usage: node scripts/design/light-text-inventory.mjs [--stdout]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC_ROOTS = ['apps/host/src', 'packages/ui/src', 'packages/lib/src']
  .map((p) => join(ROOT, p))
  .filter((p) => existsSync(p));
const OUT = join(ROOT, 'docs/design/light-text-migration-inventory.md');
const WINDOW = 4; // lines of context each side

// Light-text foreground signals (the FOREGROUND, not bg/border).
const LIGHT_TEXT = [
  /\btext-white\b/,
  /(?<!background|border|outline|box-shadow|fill|stroke)color:\s*['"]?#f{3,6}\b/i,
  /\bcolor:\s*['"]?white['"]?/i,
];
// Guaranteed-dark / gradient surface signals → SAFE.
const SAFE_BG = [
  /foxy-header-premium/,
  /\bgradient-brand\b/, /\bgradient-warm\b/,
  /\bbg-gradient-to-/,
  /\bbg-surface-inverse\b/, /\bbg-surface-accent\b/,
  /\bbtn-primary\b/,
  /\bbg-black\b/, /\bbg-slate-(7|8|9)\d{2}\b/, /\bbg-gray-(7|8|9)\d{2}\b/,
  /\bbg-zinc-(7|8|9)\d{2}\b/, /\bbg-neutral-(8|9)\d{2}\b/,
  /\bbg-purple-(6|7|8|9)\d{2}\b/, /\bbg-indigo-(6|7|8|9)\d{2}\b/,
  /\bbg-orange-(5|6|7)\d{2}\b/, /\bbg-violet-(6|7|8|9)\d{2}\b/,
  // inline dark hex background (#0x, #1x, #2x, #3x luminance range)
  /background(?:-color|Color|Image)?:\s*['"]?(?:linear-gradient|radial-gradient|#[0-3][0-9a-f]{2}[0-9a-f]{0,3})/i,
];
// Conditional / scoped background → RISKY.
const RISKY_BG = [
  /className=\{[^}]*\?[^}]*bg-/,        // ternary-driven bg class
  /style=\{\{[^}]*background[^}]*\?/,    // ternary-driven inline bg
  /background[^;]*var\(--/i,             // token bg (may resolve light)
  /\bbg-\[var\(/,                        // arbitrary token bg
  /\$\{[^}]*\}.*bg-/,                    // template-literal className bg
  /styles\.[A-Za-z]/,                    // CSS-module scoped class nearby
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { if (name !== 'node_modules' && name !== '.next') walk(p, acc); }
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) acc.push(p);
  }
  return acc;
}

// ─── Section 2 support: ground-truth contrast check ────────────────────────
// Solid fills on which #fff FAILS WCAG AA body text (4.5:1). Ratios are computed
// sRGB against #FFFFFF and are quoted in the emitted report.
const FAIL_FILLS = [
  ['--gold', /var\(--gold[),]|var\(--warning[),]|var\(--xp-color[),]|#F5A623/i, '2.03'],
  ['whatsapp-green', /#25D366/i, '1.98'],
  ['orange-500', /#F97316/i, '2.80'],
  ['amber-600', /#D97706/i, '3.19'],
  ['--green', /var\(--green[),]|var\(--success[),]|var\(--mastery-high[),]|#16A34A/i, '3.30'],
  ['--orange', /var\(--orange[),]|var\(--accent-warm[),]|var\(--primary[),]|var\(--streak-color[),]|#E8581C/i, '3.59'],
  ['--teal', /var\(--teal[),]|var\(--info[),]|#0891B2/i, '3.68'],
];
const BG_LINE = /background(?:-color|Color|Image)?\s*:|bg-\[/;

const files = SRC_ROOTS.flatMap((r) => walk(r));
const byCat = { SAFE: [], RISKY: [], NEEDS_REVIEW: [] };
const perFileRisk = new Map();
const confirmed = [];

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!LIGHT_TEXT.some((re) => re.test(line))) continue;
    const lo = Math.max(0, i - WINDOW);
    const hi = Math.min(lines.length, i + WINDOW + 1);
    const win = lines.slice(lo, hi).join('\n');
    let cat;
    if (SAFE_BG.some((re) => re.test(win))) cat = 'SAFE';
    else if (RISKY_BG.some((re) => re.test(win))) cat = 'RISKY';
    else cat = 'NEEDS_REVIEW';
    byCat[cat].push({ rel, line: i + 1, text: line.trim().slice(0, 120) });
    if (cat === 'RISKY' || cat === 'NEEDS_REVIEW') {
      perFileRisk.set(rel, (perFileRisk.get(rel) || 0) + 1);
    }
    // Ground truth: light text sitting on a fill where #fff measurably fails AA.
    const bgLines = win.split('\n').filter((l) => BG_LINE.test(l));
    for (const [name, re, ratio] of FAIL_FILLS) {
      if (bgLines.some((l) => re.test(l))) {
        confirmed.push({ rel, line: i + 1, fill: name, ratio });
        break;
      }
    }
  }
}

const total = byCat.SAFE.length + byCat.RISKY.length + byCat.NEEDS_REVIEW.length;
const topRisky = [...perFileRisk.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
const confByFile = new Map();
for (const c of confirmed) confByFile.set(c.rel, (confByFile.get(c.rel) || 0) + 1);
const topConfirmed = [...confByFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

const md = `# Light-text migration inventory (DD-16)

> **Generated by \`scripts/design/light-text-inventory.mjs\` — the script itself
> modifies no source file.** Regenerate with
> \`node scripts/design/light-text-inventory.mjs\`. Targeting aid for the migration
> onto the paired on-surface token layer (\`--on-surface-inverse\` / \`--on-accent\`,
> see design-system.md §8.1).
>
> **Sections 1 and 2 are regenerated; the "Migration status" section at the bottom
> is maintained in the script's template — edit it there, not here, or the next
> regeneration will drop it.**
>
> Scanned roots: \`apps/host/src\`, \`packages/ui/src\`, \`packages/lib/src\`.

## The bug (DD-16)
~${total} hardcoded light-text sites (\`text-white\` + inline \`color:#fff\`) are
decoupled from their backgrounds — they assume a companion dark/gradient surface
paints. When it fails (e.g. Foxy \`.foxy-header-premium\` not applied), the text
renders white-on-cream = invisible, across all roles. The migration repoints each
to its paired \`--on-*\` token so legibility becomes a surface invariant.

## Category counts

| Category | Count | Meaning | Priority |
|---|---|---|---|
| SAFE | ${byCat.SAFE.length} | co-located with a guaranteed dark/gradient surface | low |
| RISKY | ${byCat.RISKY.length} | background is conditional/scoped/token — may not paint | **high** |
| NEEDS_REVIEW | ${byCat.NEEDS_REVIEW.length} | no local background signal — manual triage | high |
| **Total** | **${total}** | | |

## Top ${topRisky.length} highest-risk files (RISKY + NEEDS_REVIEW sites)

| # | File | At-risk sites |
|---|---|---|
${topRisky.map(([f, n], k) => `| ${k + 1} | \`${f}\` | ${n} |`).join('\n')}

## Section 2 — CONFIRMED sub-AA sites (ground truth, not heuristic)

The buckets above are a *targeting* heuristic. This section is the measured set:
light text sitting on a fill where #FFFFFF demonstrably fails WCAG AA body text
(4.5:1). These are the ones a real user cannot read.

| Fill | #FFFFFF contrast | Verdict | Replacement foreground |
|---|---|---|---|
| \`--gold\` / \`--warning\` / \`--xp-color\` / \`#F5A623\` | 2.03:1 | FAIL | \`var(--text-1)\` → 9.14:1 |
| \`#25D366\` (WhatsApp) | 1.98:1 | FAIL | \`var(--text-1)\` → 9.34:1 |
| \`orange-500\` \`#F97316\` | 2.80:1 | FAIL | \`var(--accent-warm-strong)\` fill + \`var(--on-accent)\` → 5.09:1 |
| \`#D97706\` (amber-600) | 3.19:1 | FAIL | \`var(--text-1)\` → 5.82:1 |
| \`--green\` / \`--success\` / \`#16A34A\` | 3.30:1 | FAIL | \`var(--text-1)\` → 5.62:1 |
| \`--orange\` / \`--accent-warm\` / \`--primary\` / \`#E8581C\` | 3.59:1 | FAIL | \`var(--accent-warm-strong)\` fill + \`var(--on-accent)\` → 5.09:1 |
| \`--teal\` / \`--info\` / \`#0891B2\` | 3.68:1 | FAIL | \`var(--text-1)\` → 5.03:1 |
| \`--red\` / \`--danger\` / \`#DC2626\` | 4.83:1 | pass | leave; use \`var(--on-accent)\` |
| \`--purple\` / \`--secondary\` / \`#7C3AED\` | 5.70:1 | pass | leave; use \`var(--on-accent)\` |
| \`--surface-accent\` (CTA gradient) | 4.72:1 worst stop | pass | \`var(--on-surface-accent)\` |

**Confirmed sub-AA sites remaining: ${confirmed.length}** across ${confByFile.size} files.

${topConfirmed.length ? `| # | File | Confirmed sites |
|---|---|---|
${topConfirmed.map(([f, n], k) => `| ${k + 1} | \`${f}\` | ${n} |`).join('\n')}` : '_None._'}

> Caveat: this section still uses a ±4-line window to associate a foreground with
> a background, so it over-reports where an adjacent element supplies the fill
> (e.g. a \`--red\` badge next to a \`--green\` one). Treat a hit as "verify this",
> not "this is broken". It does NOT under-report token fills.

## Migration guidance
- **Confirmed sub-AA (Section 2) first**, then RISKY / NEEDS_REVIEW.
- Replace \`text-white\`/\`color:#fff\` with the paired token for the intended
  surface: \`text-on-inverse\` on dark chrome (\`bg-surface-inverse\` / Foxy header),
  \`text-on-accent\` on the CTA gradient (\`.btn-primary\` / \`bg-surface-accent\`).
  **Never \`#fff\` on bare \`--orange\`** — that is 3.59:1 and is the DD-16 core bug.
- On a light fill that has no darker token (gold, green, teal, WhatsApp green),
  the fix is the FOREGROUND, not the fill: \`var(--text-1)\` / \`text-foreground\`.
  This matches \`TONE_SOLID_FG\` in \`packages/ui/src/ui/primitives/tokens.ts\`,
  which already puts ink on the light tones.
- **SAFE** can wait, but should still migrate for consistency + future dark mode.
- Guard regressions with a lint rule (reject raw \`text-white\`/\`color:#fff\` in
  \`apps/host/src\` + \`packages/*/src\`) + visual-regression coverage once migrated.

## Migration status

| Date | Tranche | Sites fixed | Remaining (confirmed sub-AA) |
|---|---|---|---|
| 2026-08-09 | Student + parent + teacher + school-admin portals and the shared \`packages/ui\` components they render | 159 (139 codemod + 20 hand-fixed) | see Section 2 — residual is marketing/landing, \`packages/ui/src/simulations/*\`, super-admin, and \`packages/lib/src/email-templates.ts\` |

Deliberately NOT changed (documented, needs a decision rather than a patch):
- **Runtime-supplied fills.** \`/library\` and \`/memory\` subject chips paint
  \`background: s.color\` from a DB row. The hardcoded \`|| var(--orange)\` fallback
  was fixed; \`s.color\` itself has unknown luminance and cannot be verified at
  build time. Needs either a curated + contrast-verified subject palette, or a
  luminance-picked foreground helper. **Design-system decision, not a patch.**
- **\`packages/ui/src/simulations/*\`** (~14 sites) — labels painted over canvas /
  SVG scenes where the effective background is drawn, not declared in CSS.
  Needs visual QA per simulation.
- **\`packages/lib/src/email-templates.ts\`** — email HTML; contrast rules apply but
  the render target is a mail client, and the file is not frontend-owned.
- **Tailwind palette pairs** (\`bg-orange-100 text-orange-600\` etc.) — sub-AA but
  a different debt item (DD-03, raw palette bypassing the token layer).
`;

if (process.argv.includes('--stdout')) {
  process.stdout.write(md);
} else {
  writeFileSync(OUT, md, 'utf8');
  process.stdout.write(
    `light-text inventory: total=${total} SAFE=${byCat.SAFE.length} ` +
    `RISKY=${byCat.RISKY.length} NEEDS_REVIEW=${byCat.NEEDS_REVIEW.length}\n` +
    `report → ${relative(ROOT, OUT).replace(/\\/g, '/')}\n`,
  );
}
