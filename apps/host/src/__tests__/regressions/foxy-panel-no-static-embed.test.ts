/**
 * Phase 4 U1 — bundle-guard for FoxyPanel embeds.
 *
 * The three student embed surfaces (dashboard, learn chapter, quiz results)
 * mount the panel via <FoxyPanelLauncher> from `@alfanumrik/ui/foxy-launcher/*`,
 * which dynamic-imports the panel module only on tap. If any host page ever
 * imports `@alfanumrik/ui/foxy-panel/*` STATICALLY, the first-load JS budget
 * for that page would balloon (~200+ kB of chat+streaming+markdown+KaTeX).
 *
 * This test walks every host `page.tsx` and fails on any static import that
 * targets `@alfanumrik/ui/foxy-panel`. The launcher path (`foxy-launcher/*`)
 * is intentionally out of scope — it is the sanctioned static entry-point.
 *
 * The `/foxy` page itself still imports the moved primitives via the
 * `apps/host/src/app/foxy/_...` stubs (which re-export from foxy-panel/*);
 * those stubs are transitive — they do not appear as a literal
 * `@alfanumrik/ui/foxy-panel` string in the page's own source, so the walk
 * cleanly ignores them. This preserves the pre-Phase-4 behavior for /foxy
 * while blocking any accidental new embed regression.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FORBIDDEN = /from\s+['"]@alfanumrik\/ui\/foxy-panel(\/[^'"]+)?['"]/;

function walkForPageTsx(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walkForPageTsx(full, out);
    } else if (name === 'page.tsx') {
      out.push(full);
    }
  }
}

describe('Phase 4 U1 — no static @alfanumrik/ui/foxy-panel imports in host page.tsx', () => {
  it('every apps/host/src/app/**/page.tsx is free of static foxy-panel imports', () => {
    const hostRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'app',
    );
    const pages: string[] = [];
    walkForPageTsx(hostRoot, pages);
    expect(pages.length).toBeGreaterThan(10); // sanity: many pages exist

    const offenders: Array<{ file: string; line: string }> = [];
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        if (FORBIDDEN.test(line)) {
          offenders.push({ file, line: line.trim() });
        }
      }
    }

    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${path.relative(process.cwd(), o.file)}: ${o.line}`)
        .join('\n');
      throw new Error(
        `Found static @alfanumrik/ui/foxy-panel imports in host page.tsx.\n` +
          `Panel must be mounted via <FoxyPanelLauncher> from @alfanumrik/ui/foxy-launcher/*\n` +
          `(dynamic-imports the panel on tap).\n\nOffenders:\n${msg}`,
      );
    }

    expect(offenders).toEqual([]);
  });
});
