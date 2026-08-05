/**
 * Demo persona label — Foxy North-Star policy PR1 (prohibited-inferences copy
 * audit): the human-visible label for the `weak_student` persona is
 * "Foundation Builder", never "Weak Student".
 *
 * The persona CODE stays `weak_student` (DB/API contract — see
 * packages/lib/src/demo/personas.ts and its own tests); only the display
 * label changes. Source-assert pattern (see super-admin-ia-relabel.test.ts):
 * AdminShell-hosted pages pull the full V3 shell, so asserting on source is
 * the repo's established deterministic approach for these copy pins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const demoPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/app/super-admin/demo/page.tsx'),
  'utf8',
);

describe('super-admin demo persona label (policy PR1)', () => {
  it('labels the weak_student persona "Foundation Builder"', () => {
    expect(demoPage).toContain("weak_student: 'Foundation Builder'");
  });

  it('never shows "Weak Student" as a label anywhere on the page', () => {
    expect(demoPage).not.toContain('Weak Student');
  });

  it('keeps the persona CODE weak_student intact (DB/API contract unchanged)', () => {
    expect(demoPage).toContain('weak_student:');
  });
});
