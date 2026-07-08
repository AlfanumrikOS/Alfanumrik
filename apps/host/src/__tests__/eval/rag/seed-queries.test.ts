// src/__tests__/eval/rag/seed-queries.test.ts
//
// Coverage-validation gate for the B1 RAG eval-harness SEED QUERY SET
// (Task 9): `eval/rag/golden/seed-queries.json`.
//
// This file is the assessment-owned, candidate-pool-independent CBSE/NCERT
// curriculum IP — real student queries stratified by grade band x core subject
// x query type, each carrying a `target` (the human curriculum intent the
// Task-10 operator uses to BIND + LABEL real chunk UUIDs). It deliberately
// carries NO resolved `rag_content_chunks.id` UUIDs (no corpus access at
// authoring time), so this test validates the QUERY/TARGET contract + the Q2
// coverage decision — NOT the resolved-fixture schema (that is
// `golden-schema.test.ts` over `ncert-golden-v1.json`).
//
// Asserts:
//   - every item has a P5 STRING grade in "6".."12";
//   - every `subject` is a canonical snake_case subject_code;
//   - every `query_type` is in the canonical taxonomy;
//   - every item has a non-empty `query` and a non-empty `target`
//     (chapter_name, concept, relevance_2_description);
//   - multi_hop items carry `multi_hop_required_concepts` (>=2 concepts);
//   - per-(band x subject) coverage: all 4 query types present, >=2 items,
//     >=1 multi_hop;
//   - total item count is 28-32;
//   - all ids are unique.
//
// Path mapping: the `@/* -> ./src/*` Vitest alias does not reach the eval
// harness (it lives outside src/), so we use a relative import — matching the
// convention in `golden-schema.test.ts`.
//
// PURE/offline test: no DB, no LLM, no network. Runs in the normal `npm test`
// lane (NOT `*.integration.test.ts`).

import { describe, it, expect } from 'vitest';

import {
  GRADES,
  CANONICAL_SUBJECT_CODES,
  QUERY_TYPES,
  type Grade,
  type SubjectCode,
  type QueryType,
} from '../../../../eval/rag/harness/golden-schema';
import seedDoc from '../../../../eval/rag/golden/seed-queries.json';

// ─── Local types for the SEED-SOURCE shape (distinct from the resolved fixture) ─

interface SeedTarget {
  chapter_name: string;
  concept: string;
  relevance_2_description: string;
  multi_hop_required_concepts?: string[];
}

interface SeedItem {
  id: string;
  tier: 'seed';
  query: string;
  query_type: QueryType;
  grade: Grade;
  subject: SubjectCode;
  chapter_number: number | null;
  target: SeedTarget;
}

interface SeedDoc {
  version: string;
  items: SeedItem[];
}

const doc = seedDoc as unknown as SeedDoc;
const items: SeedItem[] = doc.items;

const GRADE_SET = new Set<string>(GRADES);
const SUBJECT_SET = new Set<string>(CANONICAL_SUBJECT_CODES);
const QUERY_TYPE_SET = new Set<string>(QUERY_TYPES);

/** Grade-band stratification (Q2): 6-8 / 9-10 / 11-12. */
function gradeBand(grade: string): 'junior' | 'secondary' | 'senior' {
  if (grade === '6' || grade === '7' || grade === '8') return 'junior';
  if (grade === '9' || grade === '10') return 'secondary';
  return 'senior'; // '11' | '12'
}

describe('B1 seed query set — document shape', () => {
  it('is a non-empty array of items', () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it('declares a version', () => {
    expect(typeof doc.version).toBe('string');
    expect(doc.version.length).toBeGreaterThan(0);
  });

  it('carries NO resolved chunk-id fields (binding is the Task-10 operator step)', () => {
    // Guard against accidental fabrication of resolved chunk UUIDs in the
    // seed source. The seed asset is query+target only.
    const raw = JSON.stringify(doc);
    expect(raw).not.toMatch(/"relevant_chunks"/);
    expect(raw).not.toMatch(/"relevant_chunk_ids"/);
    expect(raw).not.toMatch(/"chunk_id"/);
  });
});

describe('B1 seed query set — per-item contract', () => {
  it('every item has a P5 STRING grade in "6".."12" (never an integer)', () => {
    for (const item of items) {
      expect(typeof item.grade, `item ${item.id} grade type`).toBe('string');
      expect(GRADE_SET.has(item.grade), `item ${item.id} grade "${item.grade}"`).toBe(true);
    }
  });

  it('every item subject is a canonical snake_case subject_code', () => {
    for (const item of items) {
      expect(SUBJECT_SET.has(item.subject), `item ${item.id} subject "${item.subject}"`).toBe(true);
    }
  });

  it('never uses a forbidden legacy/alias subject code', () => {
    const forbidden = new Set(['civics', 'history', 'social science', 'social_science', 'sst']);
    for (const item of items) {
      expect(forbidden.has(item.subject as unknown as string), `item ${item.id}`).toBe(false);
    }
  });

  it('every item query_type is in the canonical taxonomy', () => {
    for (const item of items) {
      expect(QUERY_TYPE_SET.has(item.query_type), `item ${item.id} query_type "${item.query_type}"`).toBe(true);
    }
  });

  it('every item has tier "seed"', () => {
    for (const item of items) {
      expect(item.tier, `item ${item.id} tier`).toBe('seed');
    }
  });

  it('every item has a non-empty natural-language query', () => {
    for (const item of items) {
      expect(typeof item.query, `item ${item.id} query type`).toBe('string');
      expect(item.query.trim().length, `item ${item.id} query length`).toBeGreaterThan(0);
    }
  });

  it('every item has chapter_number as an integer or null', () => {
    for (const item of items) {
      const ch = item.chapter_number;
      const ok = ch === null || (typeof ch === 'number' && Number.isInteger(ch));
      expect(ok, `item ${item.id} chapter_number "${ch}"`).toBe(true);
    }
  });

  it('every item has a non-empty target (chapter_name, concept, relevance_2_description)', () => {
    for (const item of items) {
      expect(item.target, `item ${item.id} target`).toBeTruthy();
      expect(typeof item.target.chapter_name, `item ${item.id} target.chapter_name`).toBe('string');
      expect(item.target.chapter_name.trim().length).toBeGreaterThan(0);
      expect(typeof item.target.concept, `item ${item.id} target.concept`).toBe('string');
      expect(item.target.concept.trim().length).toBeGreaterThan(0);
      expect(typeof item.target.relevance_2_description, `item ${item.id} target.relevance_2_description`).toBe(
        'string',
      );
      expect(item.target.relevance_2_description.trim().length).toBeGreaterThan(0);
    }
  });

  it('every multi_hop item carries >=2 multi_hop_required_concepts', () => {
    for (const item of items) {
      if (item.query_type === 'multi_hop') {
        const concepts = item.target.multi_hop_required_concepts;
        expect(Array.isArray(concepts), `item ${item.id} multi_hop_required_concepts`).toBe(true);
        expect((concepts as string[]).length, `item ${item.id} required-concept count`).toBeGreaterThanOrEqual(2);
        for (const c of concepts as string[]) {
          expect(typeof c).toBe('string');
          expect(c.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has unique item ids', () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('B1 seed query set — Q2 coverage decision', () => {
  it('has a total item count in the 28-32 target range', () => {
    expect(items.length).toBeGreaterThanOrEqual(28);
    expect(items.length).toBeLessThanOrEqual(32);
  });

  it('stratifies across all three grade bands', () => {
    const bands = new Set(items.map((i) => gradeBand(i.grade)));
    expect(bands.has('junior')).toBe(true);
    expect(bands.has('secondary')).toBe(true);
    expect(bands.has('senior')).toBe(true);
  });

  it('senior band substitutes physics + history_sr (combined codes do not exist there)', () => {
    const seniorSubjects = new Set(items.filter((i) => gradeBand(i.grade) === 'senior').map((i) => i.subject));
    // No combined `science` / `social_studies` at senior-secondary.
    expect(seniorSubjects.has('science' as SubjectCode)).toBe(false);
    expect(seniorSubjects.has('social_studies' as SubjectCode)).toBe(false);
    expect(seniorSubjects.has('physics' as SubjectCode)).toBe(true);
    expect(seniorSubjects.has('history_sr' as SubjectCode)).toBe(true);
  });

  it('every (band x subject) cell: all 4 query types present, >=2 items, >=1 multi_hop', () => {
    // Build the per-(band x subject) cell map.
    const cells = new Map<string, SeedItem[]>();
    for (const item of items) {
      const key = `${gradeBand(item.grade)}::${item.subject}`;
      const list = cells.get(key) ?? [];
      list.push(item);
      cells.set(key, list);
    }

    // There must be at least one cell, and each cell must satisfy the coverage rules.
    expect(cells.size).toBeGreaterThan(0);

    for (const [key, cellItems] of cells.entries()) {
      // >=2 items per cell.
      expect(cellItems.length, `cell ${key} item count`).toBeGreaterThanOrEqual(2);

      // All 4 query types present in the cell.
      const typesInCell = new Set(cellItems.map((i) => i.query_type));
      for (const qt of QUERY_TYPES) {
        expect(typesInCell.has(qt), `cell ${key} missing query_type "${qt}"`).toBe(true);
      }

      // >=1 multi_hop per cell.
      const multiHopCount = cellItems.filter((i) => i.query_type === 'multi_hop').length;
      expect(multiHopCount, `cell ${key} multi_hop count`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every grade band exercises >=2 distinct core subjects', () => {
    const byBand = new Map<string, Set<string>>();
    for (const item of items) {
      const band = gradeBand(item.grade);
      const set = byBand.get(band) ?? new Set<string>();
      set.add(item.subject);
      byBand.set(band, set);
    }
    for (const [band, subjects] of byBand.entries()) {
      expect(subjects.size, `band ${band} distinct subjects`).toBeGreaterThanOrEqual(2);
    }
  });
});
