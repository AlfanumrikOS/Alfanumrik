/**
 * Unit tests for src/lib/super-admin/announcement-validation.ts
 * Locks down the input contract for the global-announcements CRUD API
 * (Gate-2 D1, admin_announcements — previously had a table + RLS but zero
 * UI/API in this codebase).
 */

import { describe, it, expect } from 'vitest';
import {
  validateCreatePayload,
  validateUpdatePayload,
  MAX_TITLE_LEN,
  MAX_CONTENT_LEN,
} from '@alfanumrik/lib/super-admin/announcement-validation';

const validCreate = () => ({
  title: 'Exam schedule update',
  content: 'The final exams have moved by one week.',
});

describe('validateCreatePayload — happy paths', () => {
  it('accepts a minimal valid payload with default empty targeting', () => {
    const v = validateCreatePayload(validCreate());
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.title).toBe('Exam schedule update');
    expect(v.target_grades).toEqual([]);
    expect(v.target_subjects).toEqual([]);
    expect(v.expires_at).toBeNull();
  });

  it('trims title and content', () => {
    const v = validateCreatePayload({ ...validCreate(), title: '  Hi  ', content: '  Body  ' });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.title).toBe('Hi');
    expect(v.content).toBe('Body');
  });

  it('accepts grade strings (P5: grades are strings, never integers)', () => {
    const v = validateCreatePayload({ ...validCreate(), target_grades: ['9', '10'] });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.target_grades).toEqual(['9', '10']);
  });

  it('accepts a valid ISO expires_at', () => {
    const v = validateCreatePayload({ ...validCreate(), expires_at: '2026-12-01T00:00:00.000Z' });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.expires_at).toBe('2026-12-01T00:00:00.000Z');
  });

  it('accepts an explicit null expires_at', () => {
    const v = validateCreatePayload({ ...validCreate(), expires_at: null });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.expires_at).toBeNull();
  });
});

describe('validateCreatePayload — rejections', () => {
  it('rejects a non-object body', () => {
    expect(validateCreatePayload(null)).toBe('invalid_body');
    expect(validateCreatePayload('x')).toBe('invalid_body');
  });

  it('rejects a missing/blank title', () => {
    expect(validateCreatePayload({ ...validCreate(), title: '' })).toBe('title_required');
    expect(validateCreatePayload({ ...validCreate(), title: '   ' })).toBe('title_required');
    expect(validateCreatePayload({ content: 'x' })).toBe('title_required');
  });

  it('rejects a title over the max length', () => {
    expect(validateCreatePayload({ ...validCreate(), title: 'x'.repeat(MAX_TITLE_LEN + 1) })).toBe('title_too_long');
  });

  it('rejects a missing/blank content', () => {
    expect(validateCreatePayload({ ...validCreate(), content: '' })).toBe('content_required');
  });

  it('rejects content over the max length', () => {
    expect(validateCreatePayload({ ...validCreate(), content: 'x'.repeat(MAX_CONTENT_LEN + 1) })).toBe('content_too_long');
  });

  it('rejects non-string-array target_grades', () => {
    expect(validateCreatePayload({ ...validCreate(), target_grades: [9, 10] })).toBe('target_grades_invalid');
    expect(validateCreatePayload({ ...validCreate(), target_grades: 'all' })).toBe('target_grades_invalid');
  });

  it('rejects non-string-array target_subjects', () => {
    expect(validateCreatePayload({ ...validCreate(), target_subjects: [1] })).toBe('target_subjects_invalid');
  });

  it('rejects an unparseable expires_at', () => {
    expect(validateCreatePayload({ ...validCreate(), expires_at: 'not-a-date' })).toBe('expires_at_invalid');
    expect(validateCreatePayload({ ...validCreate(), expires_at: 123 })).toBe('expires_at_invalid');
  });
});

describe('validateUpdatePayload — happy paths', () => {
  it('accepts a partial update of just is_active (the soft-delete/archive toggle)', () => {
    const v = validateUpdatePayload({ is_active: false });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v).toEqual({ is_active: false });
  });

  it('accepts a partial update of just title', () => {
    const v = validateUpdatePayload({ title: 'New title' });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v).toEqual({ title: 'New title' });
  });

  it('accepts multiple fields at once', () => {
    const v = validateUpdatePayload({ title: 'A', content: 'B', is_active: true });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v).toEqual({ title: 'A', content: 'B', is_active: true });
  });
});

describe('validateUpdatePayload — rejections', () => {
  it('rejects an empty update (no fields)', () => {
    expect(validateUpdatePayload({})).toBe('no_fields_to_update');
  });

  it('rejects a non-object body', () => {
    expect(validateUpdatePayload(null)).toBe('invalid_body');
  });

  it('rejects a non-boolean is_active', () => {
    expect(validateUpdatePayload({ is_active: 'true' })).toBe('is_active_invalid');
  });

  it('rejects a blank title', () => {
    expect(validateUpdatePayload({ title: '' })).toBe('title_invalid');
  });

  it('rejects an unparseable expires_at, but allows explicit null (clearing it)', () => {
    expect(validateUpdatePayload({ expires_at: 'nope' })).toBe('expires_at_invalid');
    const v = validateUpdatePayload({ expires_at: null });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.expires_at).toBeNull();
  });
});
