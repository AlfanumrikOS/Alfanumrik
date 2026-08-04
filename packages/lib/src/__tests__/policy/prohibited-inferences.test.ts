/**
 * Prohibited-inferences policy module (Foxy North-Star Phase 1 — PR1..PR5)
 * + ANALYZER PARITY pin (REG-48 SQL/TS-parity pattern).
 *
 * The alignment analyzer's check 8e SOURCE-PARSES the `bannedPhrases: [...]`
 * arrays out of prohibited-inferences.ts instead of keeping its own hardcoded
 * regex. This test pins:
 *   1. Module shape + seed phrases + pure never-throws scanner.
 *   2. PARITY: the exact parse the analyzer runs, applied to the module
 *      source, yields the SAME set the module exports at runtime — so a
 *      format change that would silently blind check 8e fails here first.
 *   3. analyze.mjs actually derives from the module (references the module
 *      path, defines parseBannedPhrases, and the old hardcoded 4-phrase regex
 *      is gone).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_BANNED_PHRASES,
  NO_DIAGNOSIS_BOUNDARY_NOTE,
  PROHIBITED_INFERENCES,
  PROHIBITED_INFERENCES_PROMPT_SECTION,
  findProhibitedPhrases,
  type ProhibitedInferenceCategory,
} from '@alfanumrik/lib/policy/prohibited-inferences';

const MODULE_PATH = resolve(__dirname, '../../policy/prohibited-inferences.ts');
const ANALYZER_PATH = resolve(__dirname, '../../../../../scripts/foxy-alignment/analyze.mjs');

const CATEGORIES: ProhibitedInferenceCategory[] = ['PR1', 'PR2', 'PR3', 'PR4', 'PR5'];

describe('module shape (design export contract)', () => {
  it('defines exactly PR1..PR5, each with title, promptRule, bannedPhrases[]', () => {
    expect(Object.keys(PROHIBITED_INFERENCES).sort()).toEqual([...CATEGORIES].sort());
    for (const c of CATEGORIES) {
      const entry = PROHIBITED_INFERENCES[c];
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.promptRule.length).toBeGreaterThan(20);
      expect(Array.isArray(entry.bannedPhrases)).toBe(true);
    }
  });

  it('carries the PR1 seed phrases', () => {
    for (const phrase of [
      'weak student',
      'slow learner',
      'low intelligence',
      'you are weak',
      'struggling student',
    ]) {
      expect(ALL_BANNED_PHRASES).toContain(phrase);
    }
  });

  it('carries the Hindi/Hinglish PR1 identity labels (assessment 2026-08-05, P7)', () => {
    for (const phrase of [
      'kamzor student',
      'कमज़ोर छात्र',
      'कमज़ोर बच्चा',
      'मंदबुद्धि',
      'तुम कमज़ोर हो',
    ]) {
      expect(ALL_BANNED_PHRASES).toContain(phrase);
      expect(PROHIBITED_INFERENCES.PR1.bannedPhrases).toContain(phrase);
    }
  });

  it('PR2 bans second-person diagnosis phrasings, NOT bare condition names', () => {
    expect(ALL_BANNED_PHRASES).toContain('you have adhd');
    expect(ALL_BANNED_PHRASES).toContain('depression diagnosis');
    // Hindi/Hinglish second-person diagnoses (assessment 2026-08-05, P7).
    for (const phrase of [
      'tumhe depression hai',
      'तुम्हें डिप्रेशन है',
      'आपको डिप्रेशन है',
      'tumhe adhd hai',
    ]) {
      expect(ALL_BANNED_PHRASES).toContain(phrase);
      expect(PROHIBITED_INFERENCES.PR2.bannedPhrases).toContain(phrase);
    }
    // Bare condition names must NOT be banned — curriculum content (biology,
    // psychology) legitimately mentions them in the third person.
    expect(ALL_BANNED_PHRASES).not.toContain('adhd');
    expect(ALL_BANNED_PHRASES).not.toContain('depression');
    expect(ALL_BANNED_PHRASES).not.toContain('anxiety');
    // …and the Hindi bare condition name stays unbanned too.
    expect(ALL_BANNED_PHRASES).not.toContain('डिप्रेशन');
  });

  it('every phrase is lowercase and the list is de-duplicated', () => {
    for (const p of ALL_BANNED_PHRASES) expect(p).toBe(p.toLowerCase());
    expect(new Set(ALL_BANNED_PHRASES).size).toBe(ALL_BANNED_PHRASES.length);
  });

  it('prompt section joins every category rule + the full phrase denylist deterministically', () => {
    for (const c of CATEGORIES) {
      expect(PROHIBITED_INFERENCES_PROMPT_SECTION).toContain(PROHIBITED_INFERENCES[c].title);
    }
    for (const phrase of ALL_BANNED_PHRASES) {
      expect(PROHIBITED_INFERENCES_PROMPT_SECTION).toContain(`"${phrase}"`);
    }
  });

  it('exposes the PR2 boundary note for the safeguarding classifier', () => {
    expect(NO_DIAGNOSIS_BOUNDARY_NOTE).toMatch(/not a\s+clinician/i);
    expect(NO_DIAGNOSIS_BOUNDARY_NOTE).toMatch(/never produce diagnosis language/i);
  });
});

describe('findProhibitedPhrases — pure, never throws', () => {
  it('finds a phrase case-insensitively inside longer text', () => {
    expect(findProhibitedPhrases('He is such a WEAK student, honestly')).toEqual(['weak student']);
  });

  it('returns multiple matches in denylist order', () => {
    const found = findProhibitedPhrases('a weak student and a slow learner');
    expect(found).toEqual(['weak student', 'slow learner']);
  });

  it('finds Hindi/Hinglish phrases inside longer text (P7)', () => {
    expect(findProhibitedPhrases('वह एक कमज़ोर छात्र है, ध्यान दो')).toEqual(['कमज़ोर छात्र']);
    expect(findProhibitedPhrases('lagta hai tumhe depression hai yaar')).toEqual([
      'tumhe depression hai',
    ]);
  });

  it('clean Hindi curriculum mention of a condition returns [] (no bare डिप्रेशन ban)', () => {
    expect(
      findProhibitedPhrases('मनोविज्ञान अध्याय में डिप्रेशन के लक्षणों की व्याख्या कीजिए'),
    ).toEqual([]);
  });

  it('clean pedagogical evidence-language returns []', () => {
    expect(
      findProhibitedPhrases('You missed 3 questions on this concept this week — let us rebuild it.'),
    ).toEqual([]);
  });

  it('empty / non-string input returns [] without throwing', () => {
    expect(findProhibitedPhrases('')).toEqual([]);
    expect(findProhibitedPhrases(null as unknown as string)).toEqual([]);
    expect(findProhibitedPhrases(undefined as unknown as string)).toEqual([]);
    expect(findProhibitedPhrases(42 as unknown as string)).toEqual([]);
  });
});

describe('ANALYZER PARITY — check 8e derives from this module (REG-48 pattern)', () => {
  // EXACT copy of parseBannedPhrases() in scripts/foxy-alignment/analyze.mjs
  // (minus its ROOT/readText plumbing). If the module's array format changes
  // such that this parse diverges from the runtime export, check 8e is blind —
  // this test is what catches that BEFORE the analyzer silently passes rot.
  function analyzerParse(source: string): string[] {
    const phrases: string[] = [];
    const arrRe = /bannedPhrases\s*:\s*\[([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = arrRe.exec(source))) {
      const litRe = /'([^'\\]+)'|"([^"\\]+)"/g;
      let lm: RegExpExecArray | null;
      while ((lm = litRe.exec(m[1]))) phrases.push(lm[1] ?? lm[2]);
    }
    return [...new Set(phrases)];
  }

  it('analyzer-parsed list == runtime ALL_BANNED_PHRASES (order + content)', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    expect(analyzerParse(source)).toEqual([...ALL_BANNED_PHRASES]);
  });

  it('analyze.mjs references the module path and defines the parser', () => {
    const analyzer = readFileSync(ANALYZER_PATH, 'utf8');
    expect(analyzer).toContain('packages/lib/src/policy/prohibited-inferences.ts');
    expect(analyzer).toContain('function parseBannedPhrases()');
    expect(analyzer).toContain(String.raw`/bannedPhrases\s*:\s*\[([^\]]*)\]/g`);
  });

  it('the old hardcoded 4-phrase regex is GONE from analyze.mjs', () => {
    const analyzer = readFileSync(ANALYZER_PATH, 'utf8');
    expect(analyzer).not.toContain('(weak student|slow learner|low intelligence|you are weak)');
  });

  it('check 8e fails loudly (not silently-pass) when the list cannot be parsed', () => {
    // Behavior pin via source: the empty-parse branch must push a FAIL line,
    // not fall through to a zero-hit PASS.
    const analyzer = readFileSync(ANALYZER_PATH, 'utf8');
    expect(analyzer).toMatch(/FAIL 8e cannot derive banned-phrase list/);
  });
});
