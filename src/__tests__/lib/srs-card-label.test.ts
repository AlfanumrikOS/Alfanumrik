/**
 * srs-card-label — display-side hardening for the per-question SRS dedupe key
 * (fix/srs-dedupe-per-question follow-up).
 *
 * Quiz-review flashcards write `topic = subject:chapter:question_id` — a
 * machine key for the idx_src_u partial unique index. Two display paths fall
 * back to `topic` when `chapter_title` is missing. Pins:
 *   1. A composite key is NEVER returned raw — students never see a uuid.
 *   2. Human-readable topics (Foxy cards, legacy Bloom labels, anything not
 *      matching the composite shape) pass through byte-identical.
 *   3. Bilingual: Hindi UI gets "अध्याय N"; subject codes are not translated (P7).
 */

import { describe, it, expect } from 'vitest';
import { humaneCardLabel, isCompositeCardKey } from '@/lib/srs-card-label';

const UUID = '3f2a8b9c-7d4e-4f1a-9b2c-8e5d6a7f0c1d';

describe('isCompositeCardKey', () => {
  it('detects the writer-shaped composite key (subject:chapter:uuid)', () => {
    expect(isCompositeCardKey(`math:5:${UUID}`)).toBe(true);
    expect(isCompositeCardKey(`science:na:${UUID}`)).toBe(true);
  });

  it('rejects human-readable topics, including ones containing a colon', () => {
    expect(isCompositeCardKey('Photosynthesis')).toBe(false);
    expect(isCompositeCardKey('Ratio: the basics')).toBe(false);
    expect(isCompositeCardKey('remember')).toBe(false); // legacy Bloom key
    expect(isCompositeCardKey(null)).toBe(false);
    expect(isCompositeCardKey(undefined)).toBe(false);
    expect(isCompositeCardKey('')).toBe(false);
  });
});

describe('humaneCardLabel — composite dedupe key never rendered raw', () => {
  it('composite key with numeric chapter → `subject · Chapter N`', () => {
    expect(humaneCardLabel(`math:5:${UUID}`)).toBe('math · Chapter 5');
  });

  it('never leaks any part of the uuid tail', () => {
    const label = humaneCardLabel(`science:12:${UUID}`) as string;
    expect(label).toBe('science · Chapter 12');
    expect(label).not.toContain(UUID);
    expect(label).not.toContain(UUID.slice(0, 8));
  });

  it('Hindi UI → `subject · अध्याय N` (technical subject code untranslated, P7)', () => {
    expect(humaneCardLabel(`math:5:${UUID}`, { isHi: true })).toBe('math · अध्याय 5');
  });

  it('includeSubject:false drops the subject prefix (caller renders it already)', () => {
    expect(humaneCardLabel(`math:5:${UUID}`, { includeSubject: false })).toBe('Chapter 5');
    expect(humaneCardLabel(`math:5:${UUID}`, { isHi: true, includeSubject: false })).toBe('अध्याय 5');
  });

  it('`na` / chapter-0 sentinel → the subject name alone, never the uuid', () => {
    expect(humaneCardLabel(`science:na:${UUID}`)).toBe('science');
    expect(humaneCardLabel(`science:0:${UUID}`)).toBe('science');
    expect(humaneCardLabel(`science:na:${UUID}`, { includeSubject: false })).toBe('science');
  });
});

describe('humaneCardLabel — everything else passes through untouched', () => {
  it('Foxy-style human-readable topics are byte-identical', () => {
    expect(humaneCardLabel('Photosynthesis')).toBe('Photosynthesis');
    expect(humaneCardLabel('प्रकाश संश्लेषण')).toBe('प्रकाश संश्लेषण');
  });

  it('legacy Bloom-level topics are untouched', () => {
    expect(humaneCardLabel('remember')).toBe('remember');
  });

  it('colon-containing human text that lacks a uuid-ish tail is untouched', () => {
    expect(humaneCardLabel('Ratio: the basics')).toBe('Ratio: the basics');
    expect(humaneCardLabel('math:5:intro')).toBe('math:5:intro'); // tail not uuid-ish
  });

  it('null/undefined/empty pass through (callers keep their existing render behavior)', () => {
    expect(humaneCardLabel(null)).toBeNull();
    expect(humaneCardLabel(undefined)).toBeNull();
    expect(humaneCardLabel('')).toBe('');
  });
});
