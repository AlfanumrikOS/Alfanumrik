// apps/host/src/__tests__/api/foxy/explorer-mode-token-budget.test.ts
//
// Item 4.1 (2026-07-21) — Foxy `explorer` mode token-budget + persona bug fix.
//
// `explorer` is a VALID_MODES entry (constants.ts) and is the LIVE chat surface
// `/dive` opens via `/foxy?mode=explorer&...` (Weekly Dive is ON at 100% in
// production). Before this fix:
//   1. MODE_MAX_TOKENS had no 'explorer' key, so the call site
//      (`MODE_MAX_TOKENS[mode] ?? 1024`) silently gave explorer a 1024-token
//      budget — well below sibling teaching modes (learn/explain/revise: 3000).
//   2. MODE_DIRECTIVES had no 'explorer' key, so the call site
//      (`MODE_DIRECTIVES[mode] ?? ''`) silently gave explorer NO persona
//      override — it inherited the generic "teach deeply" / STEP CARDS shape
//      meant for learn/explain, contradicting the Socratic-led,
//      artifact-building design of the Weekly Curiosity Dive (docs/superpowers/
//      specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md §5.2).
//
// This test pins both fixes as a regression guard. Pure-module tests — no
// route/DB/Claude imports.
//
// Owner: ai-engineer. Reviewer: assessment (prompt/persona correctness).

import { describe, it, expect } from 'vitest';
import {
  MODE_DIRECTIVES,
  MODE_MAX_TOKENS,
  composeModeDirective,
} from '@alfanumrik/lib/foxy/prompt-sections';
import { VALID_MODES } from '@/app/api/foxy/_lib/constants';

describe('Foxy explorer mode — token budget (item 4.1)', () => {
  it('is a VALID_MODES entry (sanity check that this mode is actually live)', () => {
    expect(VALID_MODES).toContain('explorer');
  });

  it('gives explorer the SAME 3000-token budget as sibling prose-teaching modes', () => {
    expect(MODE_MAX_TOKENS.explorer).toBe(3000);
    expect(MODE_MAX_TOKENS.explorer).toBe(MODE_MAX_TOKENS.learn);
    expect(MODE_MAX_TOKENS.explorer).toBe(MODE_MAX_TOKENS.explain);
    expect(MODE_MAX_TOKENS.explorer).toBe(MODE_MAX_TOKENS.revise);
  });

  it('no longer silently falls back to the 1024 default via the route call-site expression', () => {
    // Mirrors the route's exact fallback expression (route.ts ~:1844).
    const resolved = MODE_MAX_TOKENS['explorer'] ?? 1024;
    expect(resolved).toBe(3000);
    expect(resolved).not.toBe(1024);
  });

  it('every VALID_MODES teaching-ish mode has an explicit MODE_MAX_TOKENS entry (no silent fallback)', () => {
    // practice/learn/explain/revise/explorer are the modes that flow through
    // the grounded-answer teach/exam templates and consume MODE_MAX_TOKENS
    // directly. doubt/homework/olympiad/lesson intentionally rely on the 1024
    // default today (out of scope for this fix) — assert only the set this
    // fix touches so future additions to that set don't silently regress.
    for (const mode of ['practice', 'learn', 'explain', 'revise', 'explorer']) {
      expect(MODE_MAX_TOKENS[mode]).toBeDefined();
      expect(MODE_MAX_TOKENS[mode]).toBeGreaterThanOrEqual(2500);
    }
  });
});

describe('Foxy explorer mode — dedicated persona directive (item 4.1)', () => {
  const DIRECTIVE_MARKER = 'Mode Directive (EXPLORER';

  it('has its own non-empty MODE_DIRECTIVES entry (no longer "" via the ?? fallback)', () => {
    const resolved = MODE_DIRECTIVES['explorer'] ?? '';
    expect(resolved).not.toBe('');
    expect(resolved).toContain(DIRECTIVE_MARKER);
  });

  it('directive instructs Socratic-first behavior, not exhaustive exposition', () => {
    const d = MODE_DIRECTIVES.explorer;
    expect(d).toMatch(/Socratic/i);
    expect(d).toMatch(/ask before telling/i);
    expect(d).toMatch(/GENUINELY stuck/);
  });

  it('directive instructs progressive artifact-draft building (key concepts / worked example / student-voice)', () => {
    const d = MODE_DIRECTIVES.explorer;
    expect(d).toMatch(/artifact draft/i);
    expect(d).toMatch(/key concepts/i);
    expect(d).toMatch(/worked example/i);
    expect(d).toMatch(/what I figured out/i);
  });

  it('directive preserves P12 grounding + scope rails (never fabricate, stay in CBSE scope)', () => {
    const d = MODE_DIRECTIVES.explorer;
    expect(d).toMatch(/P12/);
    expect(d).toMatch(/never/i);
    expect(d).toMatch(/fabricate/i);
    expect(d).toMatch(/CBSE scope/i);
  });

  it('is distinct from every other MODE_DIRECTIVES entry (not accidentally aliased to learn/practice)', () => {
    expect(MODE_DIRECTIVES.explorer).not.toBe(MODE_DIRECTIVES.learn);
    expect(MODE_DIRECTIVES.explorer).not.toBe(MODE_DIRECTIVES.explain);
    expect(MODE_DIRECTIVES.explorer).not.toBe(MODE_DIRECTIVES.revise);
    expect(MODE_DIRECTIVES.explorer).not.toBe(MODE_DIRECTIVES.practice);
    expect(MODE_DIRECTIVES.learn).toBe(''); // sanity: learn is still the empty-string baseline
  });

  it('composes cleanly with additive directives (diagram/math-format channel) like every other mode', () => {
    const composed = composeModeDirective(MODE_DIRECTIVES.explorer, 'EXTRA DIRECTIVE');
    expect(composed).toContain(DIRECTIVE_MARKER);
    expect(composed).toContain('EXTRA DIRECTIVE');
    expect(composed.indexOf(DIRECTIVE_MARKER)).toBeLessThan(composed.indexOf('EXTRA DIRECTIVE'));
  });
});
