/**
 * Wave 1 Task 1.2 — knowledge-audit response parser (pure, no network).
 * Verifies: tolerant JSON extraction, 31-dimension normalization with 0-fill,
 * count clamping, foreign-evidence-id dropping, suspected_missing hygiene.
 */
import { describe, it, expect } from 'vitest';

import { ALL_DIMENSIONS } from '../../../../scripts/knowledge-audit/dimensions';
import {
  extractJsonObject,
  parseAuditResponse,
} from '../../../../scripts/knowledge-audit/parse-response';

const VALID_IDS = ['c-1', 'c-2', 'c-3'];

function minimalResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    dimensions: {
      activities: { found_count: 3, evidence_chunk_ids: ['c-1', 'c-2'], notes: 'ok' },
      diagrams: { found_count: 5, evidence_chunk_ids: ['c-3'], notes: '' },
    },
    metadata_garbled: false,
    suspected_missing: ['Activity 4.5 referenced but not present'],
    ...overrides,
  });
}

describe('extractJsonObject (tolerant extraction)', () => {
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

describe('parseAuditResponse', () => {
  it('fails cleanly on unparseable input', () => {
    const r = parseAuditResponse('total garbage', VALID_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unparseable/);
  });

  it('normalizes to ALL 31 dimensions, 0-filling absent ones with a note', () => {
    const r = parseAuditResponse(minimalResponse(), VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.dimensions)).toHaveLength(31);
    for (const dim of ALL_DIMENSIONS) expect(r.dimensions[dim]).toBeDefined();
    expect(r.dimensions.activities.found_count).toBe(3);
    expect(r.dimensions.exercises.found_count).toBe(0);
    expect(r.dimensions.exercises.notes).toMatch(/absent from model response/);
    // scan-lane dims never requested from the model are also 0-filled
    expect(r.dimensions.hots_questions.found_count).toBe(0);
  });

  it('clamps counts: negative → 0, float → floored, non-numeric → 0 (each with a note)', () => {
    const raw = JSON.stringify({
      dimensions: {
        activities: { found_count: -4, evidence_chunk_ids: [], notes: '' },
        diagrams: { found_count: 3.7, evidence_chunk_ids: [], notes: '' },
        tables: { found_count: 'many', evidence_chunk_ids: [], notes: '' },
        examples: { found_count: '6', evidence_chunk_ids: [], notes: '' },
      },
    });
    const r = parseAuditResponse(raw, VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dimensions.activities.found_count).toBe(0);
    expect(r.dimensions.activities.notes).toMatch(/negative/);
    expect(r.dimensions.diagrams.found_count).toBe(3);
    expect(r.dimensions.diagrams.notes).toMatch(/floored/);
    expect(r.dimensions.tables.found_count).toBe(0);
    expect(r.dimensions.tables.notes).toMatch(/non-numeric/);
    // numeric strings are accepted
    expect(r.dimensions.examples.found_count).toBe(6);
  });

  it('drops evidence ids that are not in the input chunk set, with a note', () => {
    const raw = JSON.stringify({
      dimensions: {
        activities: { found_count: 2, evidence_chunk_ids: ['c-1', 'HALLUCINATED-9', 'c-2'], notes: '' },
      },
    });
    const r = parseAuditResponse(raw, VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dimensions.activities.evidence_chunk_ids).toEqual(['c-1', 'c-2']);
    expect(r.dimensions.activities.notes).toMatch(/dropped 1 foreign evidence id/);
  });

  it('caps evidence at 5 ids', () => {
    const many = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7'];
    const raw = JSON.stringify({
      dimensions: { diagrams: { found_count: 7, evidence_chunk_ids: many, notes: '' } },
    });
    const r = parseAuditResponse(raw, many);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dimensions.diagrams.evidence_chunk_ids).toHaveLength(5);
    expect(r.dimensions.diagrams.notes).toMatch(/capped at 5/);
  });

  it('tolerates the model flattening dimensions to the top level (no "dimensions" wrapper)', () => {
    const raw = JSON.stringify({
      activities: { found_count: 2, evidence_chunk_ids: ['c-1'], notes: '' },
      metadata_garbled: true,
      suspected_missing: [],
    });
    const r = parseAuditResponse(raw, VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dimensions.activities.found_count).toBe(2);
    expect(r.metadataGarbled).toBe(true);
  });

  it('coerces metadata_garbled ("true" string / missing) safely', () => {
    const asString = parseAuditResponse(minimalResponse({ metadata_garbled: 'true' }), VALID_IDS);
    expect(asString.ok && asString.metadataGarbled).toBe(true);
    const missing = parseAuditResponse(JSON.stringify({ dimensions: {} }), VALID_IDS);
    expect(missing.ok && !missing.metadataGarbled).toBe(true);
  });

  it('sanitizes suspected_missing: strings only, blanks dropped, entries capped, labels truncated', () => {
    const entries = [
      'Fig. 4.2 missing (numbering gap)',
      '',
      42,
      'y'.repeat(500),
      ...Array.from({ length: 60 }, (_, i) => `entry ${i}`),
    ];
    const r = parseAuditResponse(minimalResponse({ suspected_missing: entries }), VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.suspectedMissing.length).toBeLessThanOrEqual(50);
    expect(r.suspectedMissing[0]).toBe('Fig. 4.2 missing (numbering gap)');
    expect(r.suspectedMissing).toContain('42'); // coerced, non-blank
    const long = r.suspectedMissing.find((s) => s.startsWith('yyy'));
    expect(long && long.length).toBeLessThanOrEqual(200);
  });

  // Strengthened 2026-07-03 (testing review): the 300-char note truncation
  // (P13-adjacent — notes must never smuggle long chunk text into the
  // inventory) and non-array evidence tolerance were previously untested.
  it('truncates dimension notes to 300 chars with an ellipsis (notes never carry chunk text)', () => {
    const longNote = 'x'.repeat(500);
    const raw = JSON.stringify({
      dimensions: { activities: { found_count: 1, evidence_chunk_ids: ['c-1'], notes: longNote } },
    });
    const r = parseAuditResponse(raw, VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dimensions.activities.notes.length).toBeLessThanOrEqual(300);
    expect(r.dimensions.activities.notes.endsWith('…')).toBe(true);
  });

  it('tolerates non-array evidence_chunk_ids (string / object) by emitting an empty evidence list', () => {
    const raw = JSON.stringify({
      dimensions: {
        activities: { found_count: 2, evidence_chunk_ids: 'c-1', notes: '' },
        diagrams: { found_count: 1, evidence_chunk_ids: { id: 'c-2' }, notes: '' },
      },
    });
    const r = parseAuditResponse(raw, VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dimensions.activities.evidence_chunk_ids).toEqual([]);
    expect(r.dimensions.diagrams.evidence_chunk_ids).toEqual([]);
    // counts survive independently of evidence shape
    expect(r.dimensions.activities.found_count).toBe(2);
  });

  it('handles a fully-empty but valid object (all 31 dims 0-filled)', () => {
    const r = parseAuditResponse('{}', VALID_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const dim of ALL_DIMENSIONS) {
      expect(r.dimensions[dim].found_count).toBe(0);
      expect(r.dimensions[dim].evidence_chunk_ids).toEqual([]);
    }
    expect(r.suspectedMissing).toEqual([]);
  });
});
