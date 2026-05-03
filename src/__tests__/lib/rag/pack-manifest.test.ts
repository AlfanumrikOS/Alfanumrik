/**
 * Tests for src/lib/rag/pack-manifest.ts (Phase 4.5).
 * Pins the validator contract for content pack JSONL files.
 */
import { describe, it, expect } from 'vitest';
import {
  validatePackEntry,
  validatePackHeader,
  applyHeaderDefaults,
  isValidProvenance,
  isValidSourceTag,
  isValidExamRelevance,
  PACK_PROVENANCE_VALUES,
  PACK_SOURCE_TAGS,
  PACK_EXAM_RELEVANCE_VALUES,
  type PackEntry,
  type PackHeader,
} from '@/lib/rag/pack-manifest';

const VALID_ENTRY: PackEntry = {
  chunk_text: 'A '.repeat(40) + 'sample CBSE board PYQ chunk text content for testing.',
  grade: '10',
  subject: 'math',
  chapter_number: 5,
  chapter_title: 'Quadratic Equations',
  topic: 'Roots of a quadratic',
  source: 'pyq',
  exam_relevance: ['CBSE_BOARD'],
  provenance: 'public_domain',
  board_year: 2024,
  difficulty_level: 3,
};

const VALID_HEADER: PackHeader = {
  pack_id: 'cbse-board-pyq-math-grade10',
  pack_version: 'v1',
  pack_source: 'pyq',
  default_provenance: 'public_domain',
  notes: 'Sample reference pack',
};

describe('isValidProvenance', () => {
  it.each(PACK_PROVENANCE_VALUES)('accepts %s', (v) => {
    expect(isValidProvenance(v)).toBe(true);
  });
  it('rejects unknown', () => {
    expect(isValidProvenance('made_up')).toBe(false);
    expect(isValidProvenance(null)).toBe(false);
    expect(isValidProvenance(123)).toBe(false);
  });
});

describe('isValidSourceTag', () => {
  it.each(PACK_SOURCE_TAGS)('accepts %s', (v) => {
    expect(isValidSourceTag(v)).toBe(true);
  });
  it('rejects unknown', () => {
    expect(isValidSourceTag('mistral')).toBe(false);
    expect(isValidSourceTag('')).toBe(false);
  });
});

describe('isValidExamRelevance', () => {
  it.each(PACK_EXAM_RELEVANCE_VALUES)('accepts %s', (v) => {
    expect(isValidExamRelevance(v)).toBe(true);
  });
  it('rejects unknown / lowercased / mixed case', () => {
    expect(isValidExamRelevance('SAT')).toBe(false);
    expect(isValidExamRelevance('cbse')).toBe(false);
  });
});

describe('validatePackEntry', () => {
  it('valid entry passes', () => {
    const r = validatePackEntry(VALID_ENTRY);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects entry that is not an object', () => {
    expect(validatePackEntry(null).ok).toBe(false);
    expect(validatePackEntry('string').ok).toBe(false);
    expect(validatePackEntry(123).ok).toBe(false);
  });

  it('rejects chunk_text shorter than 50 chars', () => {
    const r = validatePackEntry({ ...VALID_ENTRY, chunk_text: 'short' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/chunk_text/);
  });

  it('rejects chunk_text longer than 4000 chars', () => {
    const r = validatePackEntry({ ...VALID_ENTRY, chunk_text: 'x'.repeat(5000) });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/4000 chars/);
  });

  it('rejects integer grade (P5 says strings only)', () => {
    const r = validatePackEntry({ ...VALID_ENTRY, grade: 10 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/grade/);
  });

  it('rejects out-of-range grade', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, grade: '5' }).ok).toBe(false);
    expect(validatePackEntry({ ...VALID_ENTRY, grade: '13' }).ok).toBe(false);
  });

  it('rejects empty subject', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, subject: '' }).ok).toBe(false);
  });

  it('rejects non-positive chapter_number', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, chapter_number: 0 }).ok).toBe(false);
    expect(validatePackEntry({ ...VALID_ENTRY, chapter_number: -1 }).ok).toBe(false);
    expect(validatePackEntry({ ...VALID_ENTRY, chapter_number: 1.5 }).ok).toBe(false);
  });

  it('rejects unknown source tag', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, source: 'mistral' as never }).ok).toBe(false);
  });

  it('rejects empty exam_relevance array', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, exam_relevance: [] }).ok).toBe(false);
  });

  it('rejects exam_relevance with invalid tag', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, exam_relevance: ['CBSE', 'SAT' as never] }).ok).toBe(false);
  });

  it('rejects unknown provenance', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, provenance: 'stolen' as never }).ok).toBe(false);
  });

  it('rejects board_year out of range', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, board_year: 1999 }).ok).toBe(false);
    expect(validatePackEntry({ ...VALID_ENTRY, board_year: 2200 }).ok).toBe(false);
  });

  it('rejects difficulty_level out of range', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, difficulty_level: 0 }).ok).toBe(false);
    expect(validatePackEntry({ ...VALID_ENTRY, difficulty_level: 6 }).ok).toBe(false);
  });

  it('rejects invalid language', () => {
    expect(validatePackEntry({ ...VALID_ENTRY, language: 'fr' as never }).ok).toBe(false);
  });
});

describe('validatePackHeader', () => {
  it('valid header passes', () => {
    expect(validatePackHeader(VALID_HEADER).ok).toBe(true);
  });

  it('rejects header that is not an object', () => {
    expect(validatePackHeader(null).ok).toBe(false);
  });

  it('rejects pack_id with invalid characters', () => {
    expect(validatePackHeader({ ...VALID_HEADER, pack_id: 'has spaces' }).ok).toBe(false);
    expect(validatePackHeader({ ...VALID_HEADER, pack_id: 'too' }).ok).toBe(false);
  });

  it('accepts versioned pack_id formats', () => {
    expect(validatePackHeader({ ...VALID_HEADER, pack_version: 'v1' }).ok).toBe(true);
    expect(validatePackHeader({ ...VALID_HEADER, pack_version: '1.0' }).ok).toBe(true);
    expect(validatePackHeader({ ...VALID_HEADER, pack_version: 'v1.2.3' }).ok).toBe(true);
    expect(validatePackHeader({ ...VALID_HEADER, pack_version: 'release' }).ok).toBe(false);
  });

  it('rejects unknown pack_source', () => {
    expect(validatePackHeader({ ...VALID_HEADER, pack_source: 'foo' as never }).ok).toBe(false);
  });
});

describe('applyHeaderDefaults', () => {
  it('fills in language default', () => {
    const e = applyHeaderDefaults(VALID_ENTRY, VALID_HEADER);
    expect(e.language).toBe('en');
  });

  it('preserves entry overrides over header defaults', () => {
    const e = applyHeaderDefaults({ ...VALID_ENTRY, language: 'hi' }, VALID_HEADER);
    expect(e.language).toBe('hi');
  });

  it('preserves the entry source/provenance verbatim (header is fallback at validation level only)', () => {
    const e = applyHeaderDefaults(
      { ...VALID_ENTRY, source: 'olympiad', provenance: 'licensed' },
      VALID_HEADER,
    );
    expect(e.source).toBe('olympiad');
    expect(e.provenance).toBe('licensed');
  });
});
