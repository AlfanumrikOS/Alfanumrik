/**
 * Knowledge-audit v2 — batched semantic-pass parser + cross-batch label-dedupe
 * merge (pure, no network).
 *
 * Replaces parse-response.test.ts (the v1 single-pass 22-dim count parser was
 * retired with the v1 prompt). The extractJsonObject suite moved here intact;
 * count-clamping tests are obsolete (v2 derives counts from deduped labels —
 * the model never returns a count to clamp).
 */
import { describe, it, expect } from 'vitest';

import { SEMANTIC_DIMENSIONS } from '../../../../scripts/knowledge-audit/dimensions';
import {
  extractJsonObject,
  MAX_LABEL_CHARS,
  mergeSemanticBatches,
  normalizeLabel,
  parseSemanticBatchResponse,
  type ParsedSemanticBatch,
} from '../../../../scripts/knowledge-audit/parse-semantic';

const VALID_IDS = ['c-1', 'c-2', 'c-3'];

function batchResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    dimensions: {
      definitions: { items: ['adaptation', 'habitat'], evidence_chunk_ids: ['c-1'] },
      formulae: { items: ['eq 6.1', 'v = u + at'], evidence_chunk_ids: ['c-2'] },
    },
    metadata_garbled: false,
    suspected_missing: ['Activity 4.5 referenced but not present'],
    ...overrides,
  });
}

function parsedOrThrow(raw: string, ids: string[] = VALID_IDS): ParsedSemanticBatch {
  const r = parseSemanticBatchResponse(raw, ids);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('extractJsonObject (tolerant extraction — moved from parse-response.ts)', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips bare ``` fences and surrounding prose', () => {
    expect(extractJsonObject('Here is the audit:\n```\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it('extracts the outermost object from leading/trailing chatter', () => {
    expect(extractJsonObject('Sure! {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });

  it('returns null for unparseable / non-object input', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"broken": ')).toBeNull();
    expect(extractJsonObject('[1,2,3]')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('normalizeLabel (the cross-batch dedupe key)', () => {
  it('collapses case, whitespace and wrapping punctuation', () => {
    expect(normalizeLabel('Adaptation')).toBe('adaptation');
    expect(normalizeLabel('  adaptation.  ')).toBe('adaptation');
    expect(normalizeLabel('"ADAPTATION"')).toBe('adaptation');
    expect(normalizeLabel('- v = u + at,')).toBe('v = u + at');
    expect(normalizeLabel('eq   6.1')).toBe('eq 6.1');
  });

  it(`caps at ${MAX_LABEL_CHARS} chars`, () => {
    expect(normalizeLabel('x'.repeat(200)).length).toBe(MAX_LABEL_CHARS);
  });
});

describe('parseSemanticBatchResponse', () => {
  it('fails cleanly on unparseable input', () => {
    const r = parseSemanticBatchResponse('total garbage', VALID_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unparseable/);
  });

  it('normalizes to ALL 10 semantic dimensions, empty-filling absent ones', () => {
    const r = parsedOrThrow(batchResponse());
    expect(Object.keys(r.dimensions)).toHaveLength(10);
    for (const dim of SEMANTIC_DIMENSIONS) expect(r.dimensions[dim]).toBeDefined();
    expect(r.dimensions.definitions.items).toEqual(['adaptation', 'habitat']);
    expect(r.dimensions.concepts.items).toEqual([]);
    expect(r.dimensions.concepts.evidence_chunk_ids).toEqual([]);
  });

  it('sanitizes items: blanks dropped, non-strings coerced, length-bounded', () => {
    const r = parsedOrThrow(
      JSON.stringify({
        dimensions: { concepts: { items: ['grouping', '', 42, '   ', 'z'.repeat(300)], evidence_chunk_ids: [] } },
      }),
    );
    expect(r.dimensions.concepts.items).toContain('grouping');
    expect(r.dimensions.concepts.items).toContain('42');
    expect(r.dimensions.concepts.items).not.toContain('');
    const long = r.dimensions.concepts.items.find((s) => s.startsWith('zzz'))!;
    expect(long.length).toBeLessThanOrEqual(80);
  });

  it('caps a runaway items list at 200 per dimension per batch', () => {
    const r = parsedOrThrow(
      JSON.stringify({
        dimensions: { topics: { items: Array.from({ length: 500 }, (_, i) => `topic ${i}`), evidence_chunk_ids: [] } },
      }),
    );
    expect(r.dimensions.topics.items).toHaveLength(200);
  });

  it('drops evidence ids not in THIS batch and caps at 5 (defense against hallucinated evidence)', () => {
    const r = parsedOrThrow(
      JSON.stringify({
        dimensions: {
          definitions: {
            items: ['x'],
            evidence_chunk_ids: ['c-1', 'HALLUCINATED-9', 'c-2', 'c-3', 'c-1', 'c-2', 'c-3'],
          },
        },
      }),
    );
    expect(r.dimensions.definitions.evidence_chunk_ids.every((id) => VALID_IDS.includes(id))).toBe(true);
    expect(r.dimensions.definitions.evidence_chunk_ids.length).toBeLessThanOrEqual(5);
  });

  it('tolerates a bare items ARRAY for a dimension (no {items, evidence} wrapper)', () => {
    const r = parsedOrThrow(JSON.stringify({ dimensions: { prerequisites: ['class 7 heat'] } }));
    expect(r.dimensions.prerequisites.items).toEqual(['class 7 heat']);
    expect(r.dimensions.prerequisites.evidence_chunk_ids).toEqual([]);
  });

  it('tolerates the model flattening dimensions to the top level', () => {
    const r = parsedOrThrow(
      JSON.stringify({ definitions: { items: ['lustre'], evidence_chunk_ids: ['c-1'] }, metadata_garbled: true }),
    );
    expect(r.dimensions.definitions.items).toEqual(['lustre']);
    expect(r.metadataGarbled).toBe(true);
  });

  it('coerces metadata_garbled ("true" string / missing / junk) safely', () => {
    expect(parsedOrThrow(batchResponse({ metadata_garbled: 'true' })).metadataGarbled).toBe(true);
    expect(parsedOrThrow(batchResponse({ metadata_garbled: 'severe' })).metadataGarbled).toBe(false);
    expect(parsedOrThrow('{}').metadataGarbled).toBe(false);
  });

  it('sanitizes suspected_missing: strings only, blanks dropped, capped at 50, labels truncated to 200', () => {
    const entries = ['Fig. 4.2 missing (numbering gap)', '', 42, 'y'.repeat(500), ...Array.from({ length: 60 }, (_, i) => `entry ${i}`)];
    const r = parsedOrThrow(batchResponse({ suspected_missing: entries }));
    expect(r.suspectedMissing.length).toBeLessThanOrEqual(50);
    expect(r.suspectedMissing[0]).toBe('Fig. 4.2 missing (numbering gap)');
    expect(r.suspectedMissing).toContain('42');
    const long = r.suspectedMissing.find((s) => s.startsWith('yyy'))!;
    expect(long.length).toBeLessThanOrEqual(200);
    // non-array tolerated as empty
    expect(parsedOrThrow(batchResponse({ suspected_missing: 'not an array' })).suspectedMissing).toEqual([]);
  });

  it('handles a fully-empty but valid object (all 10 dims empty)', () => {
    const r = parsedOrThrow('{}');
    for (const dim of SEMANTIC_DIMENSIONS) {
      expect(r.dimensions[dim].items).toEqual([]);
      expect(r.dimensions[dim].evidence_chunk_ids).toEqual([]);
    }
  });
});

describe('mergeSemanticBatches (cross-batch label dedupe — counts are DERIVED, never guessed)', () => {
  const batch = (dims: Record<string, { items: string[]; evidence_chunk_ids: string[] }>, garbled = false, suspected: string[] = []) =>
    parsedOrThrow(JSON.stringify({ dimensions: dims, metadata_garbled: garbled, suspected_missing: suspected }), [
      'c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7',
    ]);

  it('the same item labelled with case/whitespace/punctuation variants across batches counts ONCE', () => {
    const merged = mergeSemanticBatches([
      batch({ definitions: { items: ['Adaptation', 'habitat'], evidence_chunk_ids: ['c-1'] } }),
      batch({ definitions: { items: ['  adaptation.', '"HABITAT"', 'biodiversity'], evidence_chunk_ids: ['c-4'] } }),
    ]);
    expect(merged.dimensions.definitions.found_count).toBe(3); // adaptation, habitat, biodiversity
  });

  it('distinct items across batches SUM (this is the cross-batch count contract)', () => {
    const merged = mergeSemanticBatches([
      batch({ formulae: { items: ['eq 6.1'], evidence_chunk_ids: [] } }),
      batch({ formulae: { items: ['eq 6.2', 'v = u + at'], evidence_chunk_ids: [] } }),
    ]);
    expect(merged.dimensions.formulae.found_count).toBe(3);
  });

  it('evidence unions across batches in order, capped at 5 (P13: ids only)', () => {
    const merged = mergeSemanticBatches([
      batch({ concepts: { items: ['a'], evidence_chunk_ids: ['c-1', 'c-2', 'c-3'] } }),
      batch({ concepts: { items: ['b'], evidence_chunk_ids: ['c-3', 'c-4', 'c-5', 'c-6', 'c-7'] } }),
    ]);
    expect(merged.dimensions.concepts.evidence_chunk_ids).toEqual(['c-1', 'c-2', 'c-3', 'c-4', 'c-5']);
  });

  it('metadata_garbled ORs across batches', () => {
    expect(mergeSemanticBatches([batch({}), batch({}, true)]).metadataGarbled).toBe(true);
    expect(mergeSemanticBatches([batch({}), batch({})]).metadataGarbled).toBe(false);
  });

  it('suspected_missing dedupes normalized labels across batches, keeping the first original', () => {
    const merged = mergeSemanticBatches([
      batch({}, false, ['Activity 4.5 referenced but not present']),
      batch({}, false, ['activity 4.5 referenced but not present', 'Exercise section truncated']),
    ]);
    expect(merged.suspectedMissing).toEqual(['Activity 4.5 referenced but not present', 'Exercise section truncated']);
  });

  it('blank-normalizing labels ("...") never register as items', () => {
    const merged = mergeSemanticBatches([batch({ topics: { items: ['...', '--', 'real topic'], evidence_chunk_ids: [] } })]);
    expect(merged.dimensions.topics.found_count).toBe(1);
  });

  it('zero batches → all 10 dims present with found_count 0', () => {
    const merged = mergeSemanticBatches([]);
    for (const dim of SEMANTIC_DIMENSIONS) {
      expect(merged.dimensions[dim].found_count).toBe(0);
      expect(merged.dimensions[dim].evidence_chunk_ids).toEqual([]);
    }
  });
});
