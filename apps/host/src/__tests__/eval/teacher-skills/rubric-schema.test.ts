// src/__tests__/eval/teacher-skills/rubric-schema.test.ts
//
// Teacher-skills eval harness — rubric CSV parser/validator tests, plus a
// conformance pass over every SHIPPED rubric CSV in
// eval/teacher-skills/rubrics/. Pure/offline: no DB, no LLM, no network.
//
// Path mapping: the `(\.\.\/)+eval\/` Vitest alias (root vitest.config.ts)
// maps the relative import to the repo-root eval/ dir — the same convention
// as src/__tests__/eval/rag/*.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  parseCsv,
  parseRubricCsv,
  bucketLetter,
  scanForPiiKeys,
  GRADES,
  RUBRIC_HEADER,
  PII_FORBIDDEN_KEYS,
} from '../../../../eval/teacher-skills/harness/rubric-schema';

const HEADER = RUBRIC_HEADER.join(',');

// House convention for on-disk assets (see verdict.test.ts): a 4-up path that
// the setup.ts `remapRepoAssetPath` fs shim remaps from apps/host/ to the
// repo root where eval/ actually lives.
const RUBRICS_DIR = resolve(__dirname, '../../../../eval/teacher-skills/rubrics');

describe('parseCsv', () => {
  it('parses quoted fields with embedded commas and escaped quotes', () => {
    const { rows, error } = parseCsv('a,"b, with comma","say ""hi"""\n');
    expect(error).toBeNull();
    expect(rows).toEqual([['a', 'b, with comma', 'say "hi"']]);
  });

  it('parses quoted fields with embedded newlines', () => {
    const { rows, error } = parseCsv('a,"line1\nline2",c\n');
    expect(error).toBeNull();
    expect(rows).toEqual([['a', 'line1\nline2', 'c']]);
  });

  it("skips '#' comment lines at record start (the Apache-4(b) notice header)", () => {
    const { rows } = parseCsv('# comment one\n# comment two\na,b\n');
    expect(rows).toEqual([['a', 'b']]);
  });

  it("does NOT treat '#' inside a quoted field as a comment", () => {
    const { rows } = parseCsv('"#not a comment",b\n');
    expect(rows).toEqual([['#not a comment', 'b']]);
  });

  it('reports unterminated quotes as an error instead of hanging or throwing', () => {
    const { error } = parseCsv('a,"unterminated\n');
    expect(error).toMatch(/unterminated/);
  });

  it('handles a final record with no trailing newline and skips blank lines', () => {
    const { rows } = parseCsv('a,b\n\nc,d');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseRubricCsv', () => {
  const goodRow = 'X1,P — Pedagogy,Some criterion,"Pass requires this, exactly",note,';

  it('parses a minimal valid rubric', () => {
    const r = parseRubricCsv('test', `${HEADER}\n${goodRow}\n`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('test');
      expect(r.value.criteria).toHaveLength(1);
      expect(r.value.criteria[0]).toMatchObject({
        id: 'X1',
        bucket: 'P — Pedagogy',
        passRequires: 'Pass requires this, exactly',
        conditional: '',
      });
    }
  });

  it('rejects a wrong header', () => {
    const r = parseRubricCsv('test', `ID,Bucket,Criterion,Pass,Notes,Conditional\n${goodRow}\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/header must be exactly/);
  });

  it('rejects duplicate criterion ids', () => {
    const r = parseRubricCsv('test', `${HEADER}\n${goodRow}\n${goodRow}\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/duplicate criterion id "X1"/);
  });

  it('rejects a row with an empty id or empty pass condition', () => {
    const r = parseRubricCsv('test', `${HEADER}\n,P — Pedagogy,name,,note,\n`);
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown bucket letter', () => {
    const r = parseRubricCsv('test', `${HEADER}\nX1,Z — Zealotry,name,passes,note,\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/bucket/);
  });

  it('rejects an empty document and a header-only document', () => {
    expect(parseRubricCsv('test', '').ok).toBe(false);
    expect(parseRubricCsv('test', `${HEADER}\n`).ok).toBe(false);
  });

  it('rejects a row with the wrong number of fields', () => {
    const r = parseRubricCsv('test', `${HEADER}\nX1,P — Pedagogy,name\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/expected 6 fields/);
  });
});

describe('shipped rubric CSVs all validate', () => {
  const files = readdirSync(RUBRICS_DIR).filter((f) => f.endsWith('.csv'));

  it('ships the six expected rubrics', () => {
    expect(files.sort()).toEqual(
      [
        'foxy-explanation.csv',
        'ncert-differentiation.csv',
        'ncert-lesson-planning-math.csv',
        'ncert-lesson-planning-science.csv',
        'ncert-lesson-planning.csv',
        'quiz-generation.csv',
      ].sort(),
    );
  });

  for (const file of files) {
    it(`${file} parses and validates`, () => {
      const text = readFileSync(resolve(RUBRICS_DIR, file), 'utf-8');
      const r = parseRubricCsv(file.replace(/\.csv$/, ''), text);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.value.criteria.length).toBeGreaterThan(0);
      // Every adapted/new file carries the in-file Apache-4(b)/provenance notice.
      expect(text.startsWith('#')).toBe(true);
    });
  }

  it('ncert-lesson-planning carries the two Alfanumrik additions (A1, A2a/A2b)', () => {
    const text = readFileSync(resolve(RUBRICS_DIR, 'ncert-lesson-planning.csv'), 'utf-8');
    const r = parseRubricCsv('ncert-lesson-planning', text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ids = r.value.criteria.map((c) => c.id);
      expect(ids).toContain('A1');
      expect(ids).toContain('A2a');
      expect(ids).toContain('A2b');
    }
  });

  it('quiz-generation criteria cover the P6 invariant surface + P5', () => {
    const text = readFileSync(resolve(RUBRICS_DIR, 'quiz-generation.csv'), 'utf-8');
    const r = parseRubricCsv('quiz-generation', text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ids = r.value.criteria.map((c) => c.id);
      for (const id of ['QZ-P6a', 'QZ-P6b', 'QZ-P6c', 'QZ-P6d', 'QZ-P6e', 'QZ-P6f', 'QZ-P5']) {
        expect(ids).toContain(id);
      }
    }
  });
});

describe('constants + PII scan', () => {
  it('GRADES is the P5 string set "6".."12"', () => {
    expect(GRADES).toEqual(['6', '7', '8', '9', '10', '11', '12']);
  });

  it('bucketLetter derives P/R/O/M/A and rejects unknowns', () => {
    expect(bucketLetter('P — Pedagogy')).toBe('P');
    expect(bucketLetter('O — Output / Formatting')).toBe('O');
    expect(bucketLetter('A — Alfanumrik')).toBe('A');
    expect(bucketLetter('Z — nope')).toBeNull();
  });

  it('scanForPiiKeys finds forbidden keys at any depth including arrays (P13)', () => {
    expect(scanForPiiKeys({ ok: true })).toEqual([]);
    const hits = scanForPiiKeys({ a: [{ b: { student_id: 'x' } }], email: 'y' });
    expect(hits.join('\n')).toMatch(/student_id/);
    expect(hits.join('\n')).toMatch(/email/);
    expect(hits).toHaveLength(2);
  });

  it('the forbidden-key list mirrors the RAG harness (byte-identical)', () => {
    expect(PII_FORBIDDEN_KEYS).toEqual(['student_id', 'user_id', 'session_id', 'email', 'phone']);
  });
});
