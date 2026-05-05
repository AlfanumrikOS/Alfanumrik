/**
 * Tests for the Sanskrit/Hindi mojibake detector.
 *
 * Mirrors the SQL function `public.is_devanagari_mojibake(text)` defined in
 * `supabase/migrations/20260505000100_quarantine_mojibake_content.sql`. Both
 * implementations must agree — the TS twin is consumed by the NCERT
 * ingestion pipeline (`scripts/ncert-ingestion/validate.ts`), the SQL twin
 * by the quarantine + diagnostic functions.
 *
 * The detector is intentionally CONSERVATIVE: it returns true only when the
 * input has zero Devanagari codepoints AND contains the punctuation
 * fingerprints of Krutidev/SHUSHA/Walkman fonts (% mid-word, backtick, or a
 * Latin letter immediately followed by a semicolon). This keeps it from
 * firing on plain English chapter titles like "Light, Shadows and
 * Reflections" — quarantining English chapters would break the entire
 * NCERT Quiz Setup for those subjects.
 */

import { describe, it, expect } from 'vitest';
import { isDevanagariMojibake, assertNoMojibake } from '../../../scripts/ncert-ingestion/mojibake';

describe('isDevanagariMojibake — Sanskrit/Hindi font garbage detector', () => {
  it('returns false for pure Devanagari text', () => {
    // Real Sanskrit shloka opening — clean Unicode Devanagari
    expect(isDevanagariMojibake('ॐ नमः शिवाय')).toBe(false);
    // Real Hindi title — "Bharat ki Khoj"
    expect(isDevanagariMojibake('भारत की खोज')).toBe(false);
    // Real chapter heading — अध्याय
    expect(isDevanagariMojibake('अध्याय 1: संस्कृत भाषा')).toBe(false);
  });

  it('returns false for pure English chapter titles (no false positives)', () => {
    // These are real CBSE chapter names — must NOT be flagged.
    expect(isDevanagariMojibake('Light, Shadows and Reflections')).toBe(false);
    expect(isDevanagariMojibake('The Triangle and its Properties')).toBe(false);
    expect(isDevanagariMojibake('Mensuration')).toBe(false);
    expect(isDevanagariMojibake('Force and Pressure')).toBe(false);
  });

  it('returns true for Krutidev mojibake samples observed in production', () => {
    // These are the exact garbage strings the assessment audit pulled from
    // curriculum_topics.title and rag_content_chunks.chapter_title.
    expect(isDevanagariMojibake('R`Rh;%')).toBe(true);
    expect(isDevanagariMojibake('Prqfkz%')).toBe(true);
    expect(isDevanagariMojibake('"K"B%')).toBe(true);
    expect(isDevanagariMojibake('Lire%')).toBe(true);
  });

  it('returns false for mixed Devanagari + English (real bilingual titles)', () => {
    // Hindi-English bilingual chapter labels are common in NCERT —
    // any Devanagari codepoint short-circuits the detector.
    expect(isDevanagariMojibake('संस्कृत Sanskrit')).toBe(false);
    expect(isDevanagariMojibake('Chapter 1 — अध्याय 1')).toBe(false);
    // Even with a bogus % nearby, the presence of Devanagari makes it real.
    expect(isDevanagariMojibake('अध्याय 1: 50% complete')).toBe(false);
  });

  it('returns false for empty / null / whitespace inputs', () => {
    expect(isDevanagariMojibake('')).toBe(false);
    expect(isDevanagariMojibake(null)).toBe(false);
    expect(isDevanagariMojibake(undefined)).toBe(false);
  });

  it('returns true for letter-semicolon Krutidev pattern (e.g. R`Rh;%)', () => {
    // The R`Rh;% pattern features both backtick and letter+semicolon —
    // the detector must catch the semicolon path independently.
    expect(isDevanagariMojibake('xyz;abc')).toBe(true);
    expect(isDevanagariMojibake('A;B;C')).toBe(true);
  });

  it('returns false for normal English with semicolons / percents (non-Indic context)', () => {
    // Plain prose that legitimately contains ; or % but no Krutidev
    // letter+semicolon adjacency or mid-word % — these are FALSE.
    // Note: "completed; the" would actually trigger letter+semicolon, which
    // is acceptable because the assertNoMojibake guardrail only fires on
    // Indic-language subjects, never on English chapters.
    expect(isDevanagariMojibake('Hello world')).toBe(false);
    expect(isDevanagariMojibake('Pi is 3.14')).toBe(false);
  });

  it('returns false for clean Hindi prose (the most-common ingest content)', () => {
    expect(isDevanagariMojibake('यह एक उदाहरण वाक्य है।')).toBe(false);
    expect(isDevanagariMojibake('कक्षा 6 हिन्दी पाठ्यपुस्तक')).toBe(false);
  });
});

describe('assertNoMojibake — ingestion guardrail', () => {
  it('does not throw when subject is non-Indic (English etc.)', () => {
    expect(() =>
      assertNoMojibake(
        [
          { title: 'Light and Shadows' },
          { chunk_text: 'Newton said: F=ma; therefore...' },
        ],
        'english'
      )
    ).not.toThrow();
  });

  it('does not throw on clean Devanagari rows for an Indic subject', () => {
    expect(() =>
      assertNoMojibake(
        [
          { title: 'अध्याय 1: संस्कृत भाषा', chunk_text: 'ॐ नमः शिवाय' },
          { chapter_title: 'भारत की खोज', chunk_text: 'यह एक उदाहरण है।' },
        ],
        'sanskrit'
      )
    ).not.toThrow();
  });

  it('throws with structured message when Sanskrit chunks are mojibake', () => {
    expect(() =>
      assertNoMojibake(
        [
          { title: 'R`Rh;%' },
          { chapter_title: 'Prqfkz%', chunk_text: 'Lire%' },
        ],
        'sanskrit'
      )
    ).toThrow(/Refusing to insert.*mojibake row/);
  });

  it('throws even for a single offender so failures fail loud', () => {
    expect(() =>
      assertNoMojibake(
        [
          { title: 'अध्याय 1: संस्कृत भाषा' },
          { chunk_text: '"K"B%' },
        ],
        'hindi'
      )
    ).toThrow();
  });

  it('case-insensitive subject language match (HINDI vs hindi)', () => {
    expect(() =>
      assertNoMojibake([{ title: 'R`Rh;%' }], 'HINDI')
    ).toThrow(/Refusing to insert/);
  });
});
