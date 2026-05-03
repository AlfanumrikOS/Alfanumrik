/**
 * Optional Layer 3: shell out to `deno check` for the most authoritative
 * verdict on whether the Edge Function bundle would deploy.
 *
 * This test is GATED on Deno being installed. CI environments without Deno
 * (e.g. plain `npm test` runs on the Vercel build) get the test skipped, so
 * this never becomes a hard CI dependency.
 *
 * When Deno IS available, this test catches the same class of bug as
 * `ts-parse-guard.test.ts` Layers 1+2 — but using Deno's actual parser, which
 * is the source of truth for `supabase functions deploy`.
 *
 * If you want to force-require Deno locally, set `REQUIRE_DENO=1` in env.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const INLINE_TS = path.join(
  ROOT, 'supabase', 'functions', 'grounded-answer', 'prompts', 'inline.ts'
);

function denoAvailable(): boolean {
  try {
    const r = spawnSync('deno', ['--version'], { stdio: 'pipe' });
    return r.status === 0;
  } catch {
    return false;
  }
}

const HAS_DENO = denoAvailable();
const REQUIRE_DENO = process.env.REQUIRE_DENO === '1';

describe('Deno parses Edge Function entry points (optional)', () => {
  if (!HAS_DENO && !REQUIRE_DENO) {
    it.skip('skipped: deno not installed (set REQUIRE_DENO=1 to force)', () => {});
    return;
  }

  if (!HAS_DENO && REQUIRE_DENO) {
    it('REQUIRE_DENO=1 but deno is not on PATH', () => {
      throw new Error(
        'REQUIRE_DENO=1 was set but `deno --version` failed. ' +
        'Install Deno (https://deno.com) to run this test.'
      );
    });
    return;
  }

  it('inline.ts parses under deno check', () => {
    if (!fs.existsSync(INLINE_TS)) {
      // File was moved / renamed — let the static parse-guard test catch it.
      return;
    }
    const r = spawnSync('deno', ['check', '--no-lock', INLINE_TS], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(
        `deno check failed for ${INLINE_TS}\n` +
        `stdout:\n${r.stdout}\n` +
        `stderr:\n${r.stderr}`
      );
    }
    expect(r.status).toBe(0);
  });
});
