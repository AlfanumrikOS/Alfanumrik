// apps/host/src/__tests__/eval/openai-migration/cli.test.ts
//
// OpenAI-migration harness — CLI pure-logic tests (arg parsing + template
// substitution only). Deliberately does NOT invoke main() with --judge on,
// which would dynamic-import the real AI layer — that path is exercised only
// by a human operator with real OPENAI_API_KEY / ANTHROPIC_API_KEY set, never
// by this automated suite. ZERO network, ZERO live API calls.

import { describe, it, expect } from 'vitest';
import { parseArgs, resolveTemplate } from '../../../../eval/openai-migration/harness/cli';

describe('parseArgs', () => {
  it('requires --fixtures', () => {
    const r = parseArgs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--fixtures is required/);
  });

  it('defaults judge=off, model=gpt-4o-mini, outDir=null when only --fixtures is given', () => {
    const r = parseArgs(['--fixtures', 'some/dir']);
    expect(r).toEqual({ ok: true, value: { fixtures: 'some/dir', judge: false, model: 'gpt-4o-mini', outDir: null } });
  });

  it('parses --judge on', () => {
    const r = parseArgs(['--fixtures', 'd', '--judge', 'on']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.judge).toBe(true);
  });

  it('rejects an invalid --judge value', () => {
    const r = parseArgs(['--fixtures', 'd', '--judge', 'maybe']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--judge must be on\|off/);
  });

  it('parses a custom --model', () => {
    const r = parseArgs(['--fixtures', 'd', '--model', 'gpt-4o']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.model).toBe('gpt-4o');
  });

  it('parses --out and resolves it to an absolute path', () => {
    const r = parseArgs(['--fixtures', 'd', '--out', 'my-reports']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outDir).toMatch(/my-reports$/);
  });

  it('rejects an unknown flag', () => {
    const r = parseArgs(['--fixtures', 'd', '--bogus']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown argument "--bogus"/);
  });
});

describe('resolveTemplate', () => {
  it('substitutes every {{var}} slot from the vars map', () => {
    expect(resolveTemplate('Hello {{name}}, grade {{grade}}.', { name: 'Foxy', grade: '8' })).toBe(
      'Hello Foxy, grade 8.',
    );
  });

  it('substitutes a missing var with an empty string rather than leaving the {{slot}} literal', () => {
    expect(resolveTemplate('{{present}} and {{missing}}', { present: 'X' })).toBe('X and ');
  });

  it('leaves text with no {{slots}} unchanged', () => {
    expect(resolveTemplate('plain text, no slots', {})).toBe('plain text, no slots');
  });

  it('substitutes repeated occurrences of the same slot', () => {
    expect(resolveTemplate('{{x}}-{{x}}-{{x}}', { x: 'Q' })).toBe('Q-Q-Q');
  });
});
