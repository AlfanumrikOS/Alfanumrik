import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), '..', '..', 'scripts', 'verify-grade-format.ts');

describe('grade-format live verifier', () => {
  it('does not force-exit while Supabase HTTP handles are still closing', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).not.toMatch(/\bprocess\.exit\(/);
    expect(source).toContain('process.exitCode');
  });
});
