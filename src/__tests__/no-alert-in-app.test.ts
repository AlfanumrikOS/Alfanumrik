import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Regression guard for Phase A.4.
 *
 * Native `alert()` was previously used as error UI in 30 places across
 * src/app. We replaced those with the in-app toast component because
 * cheap school tablets / Chromebooks render alert() as a blocking modal
 * dialog (ugly, poor UX, blocks the JS thread).
 *
 * This test fails if any new `alert(` call lands in `src/app/**` (other
 * than test files), forcing future contributors to use the toast
 * component at @/components/ui/toast.
 *
 * Implemented in portable Node (no `grep`) so it runs on Windows CI too.
 */

const ROOT = resolve(__dirname, '..', 'app');
const ALLOWED_SUFFIXES = ['.ts', '.tsx'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (!ALLOWED_SUFFIXES.some((ext) => entry.endsWith(ext))) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    yield full;
  }
}

describe('no native alert() in src/app', () => {
  it('uses the toast component instead of blocking browser alert()', () => {
    const hits: { file: string; line: number; text: string }[] = [];

    for (const file of walk(ROOT)) {
      const raw = readFileSync(file, 'utf8');
      // Strip block comments (/* ... */ and {/* ... */} JSX comments) before
      // line-scanning so review comments mentioning `alert(` don't trip us.
      const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');
      const lines = stripped.split(/\r?\n/);
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        // Skip single-line comments and string-literal XSS fixtures.
        if (trimmed.startsWith('//')) return;
        if (line.includes('<script>') || line.includes('onerror=')) return;
        // Function-call `alert(` not preceded by a word-char (so we don't
        // match unrelated identifiers like `xyzalert(`).
        if (/(^|[^A-Za-z0-9_$.])alert\s*\(/.test(line)) {
          hits.push({ file, line: idx + 1, text: line.trim() });
        }
      });
    }

    if (hits.length > 0) {
      const formatted = hits
        .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
        .join('\n');
      throw new Error(
        `Found ${hits.length} native alert() call(s) in src/app. ` +
        `Use the toast component (import { toast } from '@/components/ui/toast') instead.\n${formatted}`,
      );
    }

    expect(hits).toEqual([]);
  });
});
