/**
 * Knowledge-audit v2 — deterministic structural scanner.
 *
 * This is where the pilot-gate accuracy requirement became OFFLINE-TESTABLE:
 * the 12 structural dimensions are counted exactly in code, so the synthetic
 * mini-chapters in scripts/knowledge-audit/fixtures/synthetic-chunks/ carry
 * authored ground truth and the tests assert EXACT counts — no LLM, no
 * network, no tolerance bands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  CHUNK_PASS_DIMENSIONS,
  SEMANTIC_DIMENSIONS,
  STRUCTURAL_DIMENSIONS,
  type AuditChunk,
} from '../../../../scripts/knowledge-audit/dimensions';
import {
  countFoundExerciseQuestions,
  deriveExpectedExercises,
  maxSeriesIndex,
  runStructuralScan,
  scanExerciseSets,
} from '../../../../scripts/knowledge-audit/structural-scan';

const FIXTURE_DIR = join(process.cwd(), 'scripts', 'knowledge-audit', 'fixtures', 'synthetic-chunks');

interface SyntheticFixture {
  chapter_number: number;
  chapter_title: string;
  chunks: AuditChunk[];
  truth: Record<string, number | boolean>;
}

function loadFixture(name: string): SyntheticFixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as SyntheticFixture;
}

function chunk(id: string, text: string, type: string | null = null): AuditChunk {
  return { chunk_id: id, chunk_text: text, content_type: type };
}

const clean = loadFixture('clean-mini-chapter.json');
const contaminated = loadFixture('contaminated-mini-chapter.json');
const newSyllabus = loadFixture('new-syllabus-mini-chapter.json');

describe('dimension partition (v2 split)', () => {
  it('STRUCTURAL (12) + SEMANTIC (10) exactly partition the 22 chunk-pass dimensions', () => {
    expect(STRUCTURAL_DIMENSIONS).toHaveLength(12);
    expect(SEMANTIC_DIMENSIONS).toHaveLength(10);
    const union = new Set([...STRUCTURAL_DIMENSIONS, ...SEMANTIC_DIMENSIONS]);
    expect(union.size).toBe(22);
    expect([...union].sort()).toEqual([...CHUNK_PASS_DIMENSIONS].sort());
  });
});

describe('runStructuralScan — clean synthetic mini-chapter (EXACT counts vs authored truth)', () => {
  const scan = runStructuralScan(clean.chunks, clean.chapter_number);
  const count = (d: (typeof STRUCTURAL_DIMENSIONS)[number]) => scan.findings[d].found_count;

  it('diagrams: 4 distinct Fig N.M despite overlap duplication (Fig 4.1 in c1 AND c2)', () => {
    expect(count('diagrams')).toBe(clean.truth.diagrams);
  });

  it('captions: all 4 figures carry ":" captions', () => {
    expect(count('captions')).toBe(clean.truth.captions);
  });

  it('tables: 2 distinct Table N.M', () => {
    expect(count('tables')).toBe(clean.truth.tables);
  });

  it('activities: 3 distinct Activity N.M', () => {
    expect(count('activities')).toBe(clean.truth.activities);
  });

  it('examples: 2 distinct; solved_examples: only the one with a Solution marker', () => {
    expect(count('examples')).toBe(clean.truth.examples);
    expect(count('solved_examples')).toBe(clean.truth.solved_examples);
  });

  it('exercises: per-set line-start continuity SUMMED across sets (Intext 3 + enhance-learning 4 = 7)', () => {
    expect(count('exercises')).toBe(clean.truth.exercises);
    expect(deriveExpectedExercises(clean.chunks)).toBe(clean.truth.exercises_expected);
  });

  it('headings: 2 numbered N.M headings, INLINE (OCR-flattened, no own-line requirement)', () => {
    expect(count('headings')).toBe(clean.truth.headings);
  });

  it('subtopics: 1 distinct N.M.K', () => {
    expect(count('subtopics')).toBe(clean.truth.subtopics);
  });

  it('summary: overlap-duplicated SUMMARY block (c6 + c7) fingerprint-dedupes to 1', () => {
    expect(count('summary')).toBe(clean.truth.summary);
    expect(scan.summaryBlockCount).toBe(clean.truth.summary);
  });

  it('keywords: 5 enumerable slash-separated terms, deduped across the duplicated block', () => {
    expect(count('keywords')).toBe(clean.truth.keywords);
  });

  it('pages: 0 (no explicit page markers — never estimated)', () => {
    expect(count('pages')).toBe(clean.truth.pages);
  });

  it('series metadata: single native major 4 with 4 distinct diagram members', () => {
    const diagrams = scan.series.find((s) => s.dimension === 'diagrams')!;
    expect([...diagrams.majorsSeen.entries()]).toEqual([[4, 4]]);
  });

  it('no numbering gaps → no deterministic suspected_missing labels', () => {
    expect(scan.suspectedMissing).toEqual([]);
  });

  it('evidence: chunk IDs only (subset of input ids), max 5 per dimension (P13)', () => {
    const validIds = new Set(clean.chunks.map((c) => c.chunk_id));
    for (const d of STRUCTURAL_DIMENSIONS) {
      const ev = scan.findings[d].evidence_chunk_ids;
      expect(ev.length).toBeLessThanOrEqual(5);
      for (const id of ev) expect(validIds.has(id)).toBe(true);
    }
    expect(scan.findings.diagrams.evidence_chunk_ids).toContain('clean-c1');
  });

  it('every structural finding is marked deterministic in its notes', () => {
    for (const d of STRUCTURAL_DIMENSIONS) {
      expect(scan.findings[d].notes).toMatch(/^deterministic structural scan:/);
    }
  });
});

describe('runStructuralScan — contaminated synthetic mini-chapter (count-as-is posture)', () => {
  const scan = runStructuralScan(contaminated.chunks, contaminated.chapter_number);

  it('counts INCLUDE the foreign 13.x material (contamination is a flag, not abstention)', () => {
    expect(scan.findings.diagrams.found_count).toBe(contaminated.truth.diagrams); // 6.1,6.2 + 13.1-13.3
    expect(scan.findings.captions.found_count).toBe(contaminated.truth.captions);
    expect(scan.findings.activities.found_count).toBe(contaminated.truth.activities);
    expect(scan.findings.headings.found_count).toBe(contaminated.truth.headings);
    expect(scan.findings.exercises.found_count).toBe(contaminated.truth.exercises);
  });

  it('detects BOTH summary blocks as distinct (different following text)', () => {
    expect(scan.summaryBlockCount).toBe(contaminated.truth.summary);
    expect(scan.findings.summary.found_count).toBe(2);
  });

  it('series metadata separates native major 6 (2 members) from foreign major 13 (3 members)', () => {
    const diagrams = scan.series.find((s) => s.dimension === 'diagrams')!;
    expect(diagrams.majorsSeen.get(6)).toBe(2);
    expect(diagrams.majorsSeen.get(13)).toBe(3);
  });
});

describe('inline (OCR-flattened) matching', () => {
  it('recognizes every structural marker mid-line in a single flattened chunk with NO newlines', () => {
    const flattened = chunk(
      'flat-1',
      '5.1 Heat And Temperature We measure heat. Activity 5.1 Touch a metal spoon. Fig. 5.1: A laboratory thermometer. Table 5.1 Body temperatures. 5.1.1 Clinical Thermometer Read the scale. Example 5.1 Convert 40 degrees. Solution: multiply and add.',
    );
    const scan = runStructuralScan([flattened], 5);
    expect(scan.findings.headings.found_count).toBe(1);
    expect(scan.findings.subtopics.found_count).toBe(1);
    expect(scan.findings.activities.found_count).toBe(1);
    expect(scan.findings.diagrams.found_count).toBe(1);
    expect(scan.findings.captions.found_count).toBe(1);
    expect(scan.findings.tables.found_count).toBe(1);
    expect(scan.findings.examples.found_count).toBe(1);
    expect(scan.findings.solved_examples.found_count).toBe(1);
  });

  it('series labels never double as headings ("Fig. 5.2 Shows" / "Table 5.3 Lists" are not headings)', () => {
    const scan = runStructuralScan(
      [chunk('c', 'Fig. 5.2 Shows the apparatus. Table 5.3 Lists the readings. Activity 5.4 Repeat the experiment.')],
      5,
    );
    expect(scan.findings.headings.found_count).toBe(0);
  });
});

describe('numbering-gap suspected_missing (deterministic)', () => {
  it('Fig 4.1 → 4.3 gap emits "Fig. 4.2 absent (numbering gap)" for the NATIVE major only', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'Fig. 4.1: Wood objects. Fig. 4.3: Metal objects. Also recall Fig. 2.9 from an earlier chapter.')],
      4,
    );
    // foreign major 2 must not generate gap labels (2.1-2.8 are not "missing")
    expect(scan.suspectedMissing).toEqual(['Fig. 4.2 absent (numbering gap)']);
  });

  it('activity/table/example gaps are labelled with their own prefixes', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'Activity 4.1 do. Activity 4.3 do more. Table 4.2 data. Example 4.1 solve. Example 4.3 solve too.')],
      4,
    );
    expect(scan.suspectedMissing).toContain('Activity 4.2 absent (numbering gap)');
    expect(scan.suspectedMissing).toContain('Table 4.1 absent (numbering gap)');
    expect(scan.suspectedMissing).toContain('Example 4.2 absent (numbering gap)');
  });
});

describe('examples: bare "Example N" + solution-marker variants', () => {
  it('counts bare "Example N" (old maths NCERT) distinctly from dotted "Example N.M"', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'Example 1 : In the figure, find x. Solution: x = 40. Example 2 : Prove the angles equal. Example 6.1 A dotted one.')],
      6,
    );
    expect(scan.findings.examples.found_count).toBe(3); // n1, n2, 6.1
    expect(scan.findings.solved_examples.found_count).toBe(1); // only Example 1
  });

  it('recognizes "Sol.", "∴" and "Answer:" as solution markers', () => {
    for (const marker of ['Sol. x = 3', '∴ x equals 3', 'Answer: 3']) {
      const scan = runStructuralScan([chunk('c1', `Example 3.1 Find x when 2x = 6. ${marker}`)], 3);
      expect(scan.findings.solved_examples.found_count).toBe(1);
    }
  });

  it('a solution marker belonging to the NEXT example is not attributed to the previous one', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'Example 3.1 State the theorem. Example 3.2 Find x. Solution: x = 12.')],
      3,
    );
    expect(scan.findings.solved_examples.found_count).toBe(1);
  });

  // Assessment pre-pilot condition 1 (2026-07-04): the bare form is
  // case-SENSITIVE on the capital E — NCERT prints "Example" capitalized,
  // while prose "for example 2 marks" is always lowercase.
  it('prose "for example 2 marks are awarded" is NOT counted; "Example 3" IS', () => {
    const prose = runStructuralScan(
      [chunk('c1', 'In the board exam, for example 2 marks are awarded for each correct step.')],
      6,
    );
    expect(prose.findings.examples.found_count).toBe(0);
    const real = runStructuralScan([chunk('c1', 'Example 3 : Find the value of x in the figure.')], 6);
    expect(real.findings.examples.found_count).toBe(1);
  });

  it('dotted form carries the same guard: prose "for example 2.5 litres" NOT counted; all-caps "EXAMPLE 6.1" still counted', () => {
    const prose = runStructuralScan([chunk('c1', 'A vessel holds, for example 2.5 litres of water.')], 6);
    expect(prose.findings.examples.found_count).toBe(0);
    const caps = runStructuralScan([chunk('c1', 'EXAMPLE 6.1 Find the centre of mass of the rod.')], 6);
    expect(caps.findings.examples.found_count).toBe(1);
  });
});

describe('exercises: found-counter vs continuity expectation (machinery moved from coverage.ts)', () => {
  it('truncated set: observed 1,2,3,7 → found 4 (distinct present) but expected 7 (continuity)', () => {
    const chunks = [chunk('ex', 'EXERCISES\n1. Q one.\n2. Q two.\n3. Q three.\n7. Q seven.', 'exercise')];
    expect(countFoundExerciseQuestions(chunks).found).toBe(4);
    expect(deriveExpectedExercises(chunks)).toBe(7);
  });

  it('overlap-duplicated question numbers within a set count once (found is distinct-based)', () => {
    const chunks = [
      chunk('a', 'EXERCISE 6.1\n1. Q\n2. Q\n3. Q', 'exercise'),
      chunk('b', 'EXERCISE 6.1\n2. Q\n3. Q\n4. Q', 'exercise'),
    ];
    expect(countFoundExerciseQuestions(chunks).found).toBe(4);
  });

  it('unreliable sets (numbering not starting near 1) are excluded from found AND expected', () => {
    const chunks = [
      chunk('ex1', 'EXERCISE 6.1\n1. Q\n2. Q', 'exercise'),
      chunk('ex2', 'EXERCISE 6.2\n9. stray\n12. stray', 'exercise'),
    ];
    expect(countFoundExerciseQuestions(chunks).found).toBe(2);
    expect(deriveExpectedExercises(chunks)).toBe(2);
  });

  // Finding-level pin added 2026-07-03 (testing review): truncation must
  // SURFACE in the runStructuralScan output itself — found_count is the
  // distinct-present count (never silently equal to the continuity
  // expectation) and the notes carry the expected denominator.
  it('runStructuralScan surfaces truncation in the exercises FINDING (found 4, notes carry "continuity expects 7")', () => {
    const scan = runStructuralScan(
      [chunk('ex', 'EXERCISES\n1. Q one.\n2. Q two.\n3. Q three.\n7. Q seven.', 'exercise')],
      6,
    );
    expect(scan.findings.exercises.found_count).toBe(4);
    expect(scan.findings.exercises.notes).toMatch(/continuity expects 7/);
  });

  it('scanExerciseSets exposes per-set numbers keyed by merged header labels', () => {
    const scan = scanExerciseSets([
      chunk('it', 'Intext Questions\n1. Define.\n2. State.', null),
      chunk('ex', 'EXERCISES\n1. Q\n2. Q\n3. Q', 'exercise'),
    ]);
    expect([...scan.sets.keys()].sort()).toEqual(['exercises', 'intext questions']);
  });
});

describe('keywords / summary / pages / TitleCase edge behavior', () => {
  it('keywords block present but not enumerable → 0 (never guessed)', () => {
    const scan = runStructuralScan([chunk('c1', 'Keywords and other things you saw in this chapter matter a lot.')], 4);
    expect(scan.findings.keywords.found_count).toBe(0);
  });

  it('keyword capture stops at the next block header (terms never bleed into exercises)', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'Keywords Lustre / Soluble Let us enhance our learning\n1. A question about lustre.')],
      4,
    );
    expect(scan.findings.keywords.found_count).toBe(2);
  });

  it('lowercase "in summary" prose never counts as a summary block', () => {
    const scan = runStructuralScan([chunk('c1', 'And so, in summary terms, the materials differ in properties.')], 4);
    expect(scan.findings.summary.found_count).toBe(0);
  });

  it('numbered "6.6 Summary" header is recognized', () => {
    const scan = runStructuralScan([chunk('c1', '6.6 Summary In this chapter you studied lines, angles and their properties in detail.')], 6);
    expect(scan.findings.summary.found_count).toBe(1);
  });

  // Assessment pre-pilot condition 2 (2026-07-04): math NCERT prints an
  // unnumbered title-case "Summary" head — must be detected, but guarded
  // against prose ("in summary, ...", "the Summary of the chapter").
  it('title-case standalone "Summary" block is detected (math NCERT unnumbered head)', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'the angles were computed in detail. Summary In this chapter, you have studied lines, angles and their properties.')],
      6,
    );
    expect(scan.findings.summary.found_count).toBe(1);
  });

  it('prose "in summary, we learned" and "the Summary of the chapter" never count as blocks', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'And so, in summary, we learned that materials differ. Read the Summary of the chapter before the test.')],
      6,
    );
    expect(scan.findings.summary.found_count).toBe(0);
  });

  it('OCR-flattened title-case Summary duplicated by overlap still fingerprint-dedupes to 1', () => {
    const scan = runStructuralScan(
      [
        chunk('c1', 'measured carefully. Summary Two distinct points determine a unique line in the plane.'),
        chunk('c2', 'Summary Two distinct points determine a unique line in the plane.'),
      ],
      6,
    );
    expect(scan.findings.summary.found_count).toBe(1);
  });

  it('pages: explicit markers only — "[page 12]" and "Page 13" count, distinct-deduped', () => {
    const scan = runStructuralScan([chunk('c1', '[page 12] Some content here. Page 13 More content. [page 12] repeated.')], 4);
    expect(scan.findings.pages.found_count).toBe(2);
  });

  it('TitleCase standalone lines count as headings conservatively; block labels and sentences do not', () => {
    const text = [
      'Plants Around Us',
      'Intext Questions',
      'This is a normal sentence that ends with a period.',
      'Plants Around Us', // duplicate line (overlap) → once
      'the quick brown fox jumps over everything else here',
    ].join('\n');
    const scan = runStructuralScan([chunk('c1', text)], 4);
    expect(scan.findings.headings.found_count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave-1 pilot re-run accuracy fixes (2026-07-04): keyword under-split +
// new-syllabus (unnumbered) subtopic fallback. Synthetic fixture MIRRORS the
// real g6-science-ch2 format (boxed Keywords header separated from its term
// list by an intervening prose sidebar; named TitleCase sub-sections below a
// numbered heading) without copying any corpus text.
// ─────────────────────────────────────────────────────────────────────────────

describe('runStructuralScan — new-syllabus mini-chapter (pilot re-run fixes, EXACT counts)', () => {
  const scan = runStructuralScan(newSyllabus.chunks, newSyllabus.chapter_number);
  const count = (d: (typeof STRUCTURAL_DIMENSIONS)[number]) => scan.findings[d].found_count;

  it('BUG 1: reaches the ~20-term list PAST the intervening prose sidebar (old 600-char window counted ~3)', () => {
    expect(count('keywords')).toBe(newSyllabus.truth.keywords); // 20
  });

  it('BUG 1: prose sidebar between "Keywords" and the list is NOT split into fake terms', () => {
    // If prose leaked, the count would exceed the authored 20 real terms.
    expect(count('keywords')).toBeLessThanOrEqual(newSyllabus.truth.keywords as number);
  });

  it('BUG 2: subtopics = 2 numbered N.M.K + 2 named sub-section fallback = 4', () => {
    expect(count('subtopics')).toBe(newSyllabus.truth.subtopics); // 4
    expect(scan.findings.subtopics.notes).toMatch(/named sub-section headings \(fallback/);
  });

  it('BUG 2: named-subtopic terms from the Keywords box do NOT leak into subtopics', () => {
    // Keyword terms are single words or "Cap lowercase" pairs → never TitleCase
    // sub-headings; only the two genuine "Cap Cap" sub-heads are added.
    expect(count('subtopics')).toBe(4);
  });

  it('headings still count the 3 numbered N.M sections + 2 named TitleCase heads = 5', () => {
    expect(count('headings')).toBe(newSyllabus.truth.headings); // 5
  });

  it('evidence stays chunk-id-only within the input set (P13)', () => {
    const ids = new Set(newSyllabus.chunks.map((c) => c.chunk_id));
    for (const id of scan.findings.keywords.evidence_chunk_ids) expect(ids.has(id)).toBe(true);
    for (const id of scan.findings.subtopics.evidence_chunk_ids) expect(ids.has(id)).toBe(true);
  });
});

describe('keyword under-split guards (BUG 1)', () => {
  it('a prose paragraph with NO keyword header → 0 keywords (no false-split)', () => {
    const prose =
      'Materials around us have many properties. Metals, Glass and Plastic behave differently when heated or bent. Scientists study these Properties carefully.';
    const scan = runStructuralScan([chunk('c1', prose)], 3);
    expect(scan.findings.keywords.found_count).toBe(0);
  });

  it('whitespace/newline-separated TitleCase list after a header is fully captured (not just the first line)', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'Keywords\nLustre\nDensity\nSolubility\nHardness\nElasticity\nConductor')],
      3,
    );
    expect(scan.findings.keywords.found_count).toBe(6);
  });

  it('multi-word terms survive (single space preserved); "More to" / "know?" prose lines rejected', () => {
    const scan = runStructuralScan(
      [chunk('c1', 'Keywords\nMore to\nknow?\nNatural fibre\nSynthetic fibre\nBiodegradable')],
      3,
    );
    // "Natural fibre" + "Synthetic fibre" + "Biodegradable" = 3; "More to" (trailing stopword) and "know?" (punctuation) rejected.
    expect(scan.findings.keywords.found_count).toBe(3);
  });
});

describe('named-subtopic fallback guards (BUG 2)', () => {
  it('fallback does NOT trigger when numbered N.M.K subtopics >= numbered N.M sections', () => {
    const scan = runStructuralScan(
      [
        chunk('c1', '4.1 Section One\n4.1.1 Sub One\nText here about the topic.\nAlpha Beta\nSome prose sentence.'),
      ],
      4,
    );
    // numbered subtopics (1) is NOT < numbered headings (1) → fallback off →
    // the standalone "Alpha Beta" TitleCase line is NOT counted as a subtopic.
    expect(scan.findings.subtopics.found_count).toBe(1);
  });

  it('a running header/footer (same TitleCase line in >2 chunks) is NOT counted as a named subtopic', () => {
    const runningHeader = 'Materials And Their Properties';
    const mk = (id: string) =>
      chunk(id, `3.1 Some Section Heading\nSome introductory prose sentence here.\n${runningHeader}\nMore prose follows.`);
    const scan = runStructuralScan([mk('c1'), mk('c2'), mk('c3')], 3);
    // The running header appears below the heading in 3 chunks (freq 3 > 2) →
    // excluded; no other named sub-heads exist → subtopics stays 0.
    expect(scan.findings.subtopics.found_count).toBe(0);
  });

  it('tab-delimited table rows below a heading are NOT counted as named subtopics', () => {
    const scan = runStructuralScan(
      [chunk('c1', '3.1 Grouping Materials\nSome prose about grouping.\nMetal \tNon-metal \tAlloy\nEnd of section.')],
      3,
    );
    expect(scan.findings.subtopics.found_count).toBe(0);
  });
});

describe('maxSeriesIndex (moved from coverage.ts — re-export sanity)', () => {
  it('still derives the dominant-major max minor', () => {
    expect(maxSeriesIndex('Fig. 4.1 then Fig. 4.3', /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi)).toBe(3);
  });

  it('OCR junk minors above the sanity ceiling are ignored', () => {
    expect(maxSeriesIndex('Fig. 4.150 junk only', /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi)).toBeNull();
  });
});
