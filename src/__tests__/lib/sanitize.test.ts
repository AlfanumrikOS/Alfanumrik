/**
 * Sanitize utilities — unit tests.
 *
 * src/lib/sanitize.ts is a thin defense-in-depth layer for API routes,
 * Edge Functions, and form inputs. Tests cover:
 *   - HTML / dangerous-character stripping
 *   - filename safety (no path traversal)
 *   - UUID v4 + grade + subject validation
 *   - pagination clamping
 *   - body shape validation
 *   - password strength rules
 *   - IP normalisation
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeText,
  sanitizeFilename,
  isValidUUID,
  isValidGrade,
  isValidSubject,
  parsePagination,
  validateBody,
  validatePassword,
  PASSWORD_MIN_LENGTH,
  normalizeIP,
} from '@/lib/sanitize';

describe('sanitizeText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('<b>hi</b>')).toBe('hi');
    expect(sanitizeText('<script>alert(1)</script>x')).toBe('alert1x');
  });

  it('removes dangerous characters', () => {
    expect(sanitizeText(`'"<>;(){}\``)).toBe('');
  });

  it('strips backslashes', () => {
    expect(sanitizeText('path\\to\\file')).toBe('pathtofile');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('respects the maxLength parameter', () => {
    const result = sanitizeText('a'.repeat(2000), 50);
    expect(result.length).toBe(50);
  });

  it('defaults maxLength to 1000', () => {
    expect(sanitizeText('a'.repeat(2000)).length).toBe(1000);
  });

  it('returns empty string for input that is only dangerous chars', () => {
    expect(sanitizeText('<><>{}()')).toBe('');
  });
});

describe('sanitizeFilename', () => {
  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFilename('my file (1).pdf')).toBe('my_file__1_.pdf');
  });

  it('prevents .. path traversal', () => {
    expect(sanitizeFilename('../etc/passwd')).not.toContain('..');
    expect(sanitizeFilename('a..b')).toBe('a.b');
  });

  it('preserves alphanumeric, dash, underscore, dot', () => {
    expect(sanitizeFilename('My_File-2.txt')).toBe('My_File-2.txt');
  });

  it('clamps length to 255 chars', () => {
    expect(sanitizeFilename('a'.repeat(500)).length).toBe(255);
  });
});

describe('isValidUUID', () => {
  it('accepts a valid v4 UUID', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects v1 (third group does not start with 4)', () => {
    expect(isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
  });
});

describe('isValidGrade', () => {
  it('accepts integers 1 through 12 as numbers', () => {
    for (let i = 1; i <= 12; i++) expect(isValidGrade(i)).toBe(true);
  });

  it('accepts string grades 6 through 12 (P5)', () => {
    expect(isValidGrade('6')).toBe(true);
    expect(isValidGrade('12')).toBe(true);
  });

  it('rejects 0 and 13+', () => {
    expect(isValidGrade(0)).toBe(false);
    expect(isValidGrade(13)).toBe(false);
    expect(isValidGrade('13')).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(isValidGrade('abc')).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(isValidGrade(-1)).toBe(false);
  });
});

describe('isValidSubject', () => {
  it('accepts canonical subject codes', () => {
    expect(isValidSubject('math')).toBe(true);
    expect(isValidSubject('science')).toBe(true);
    expect(isValidSubject('physics')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isValidSubject('MATH')).toBe(true);
    expect(isValidSubject('Computer_Science')).toBe(true);
  });

  it('rejects unknown subjects', () => {
    expect(isValidSubject('astrology')).toBe(false);
    expect(isValidSubject('')).toBe(false);
  });
});

describe('parsePagination', () => {
  it('returns sensible defaults when args are missing', () => {
    expect(parsePagination()).toEqual({ offset: 0, limit: 50 });
  });

  it('clamps page to >= 1', () => {
    expect(parsePagination('0', '20').offset).toBe(0);
    expect(parsePagination('-5', '20').offset).toBe(0);
  });

  it('clamps pageSize to maxPageSize', () => {
    expect(parsePagination('1', '500', 100).limit).toBe(100);
  });

  it('falls back to default 50 when pageSize is 0 (falsy fallback)', () => {
    // parseInt('0',10) is 0 → falls through to `|| 50` default; documented quirk.
    expect(parsePagination('1', '0').limit).toBe(50);
  });

  it('clamps a negative pageSize up to 1', () => {
    expect(parsePagination('1', '-5').limit).toBe(1);
  });

  it('computes offset correctly from page * pageSize', () => {
    expect(parsePagination('3', '20')).toEqual({ offset: 40, limit: 20 });
  });

  it('treats malformed numbers as defaults', () => {
    expect(parsePagination('abc', 'def')).toEqual({ offset: 0, limit: 50 });
  });
});

describe('validateBody', () => {
  it('accepts a body matching the schema', () => {
    const result = validateBody<{ name: string; age: number }>(
      { name: 'Ravi', age: 12 },
      { name: 'string', age: 'number' },
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.name).toBe('Ravi');
      expect(result.data.age).toBe(12);
    }
  });

  it('rejects non-object body', () => {
    const result = validateBody({}, {} as never); // empty schema
    expect(result.valid).toBe(true); // Empty schema accepts empty object
    const r2 = validateBody(null, { name: 'string' } as never);
    expect(r2.valid).toBe(false);
  });

  it('reports missing required fields', () => {
    const result = validateBody({ name: 'Ravi' }, { name: 'string', age: 'number' } as never);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('age');
    }
  });

  it('reports type mismatches', () => {
    const result = validateBody({ name: 'Ravi', age: 'twelve' }, {
      name: 'string',
      age: 'number',
    } as never);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('age');
      expect(result.error).toContain('number');
    }
  });

  it('rejects null fields as missing', () => {
    const result = validateBody({ name: null }, { name: 'string' } as never);
    expect(result.valid).toBe(false);
  });
});

describe('validatePassword', () => {
  it('accepts a strong password', () => {
    const result = validatePassword('StrongPass1');
    expect(result.valid).toBe(true);
  });

  it('rejects passwords shorter than minimum', () => {
    const result = validatePassword('Aa1');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain(`${PASSWORD_MIN_LENGTH}`);
  });

  it('rejects passwords without lowercase', () => {
    const result = validatePassword('PASSWORD1');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/lowercase/i);
  });

  it('rejects passwords without uppercase', () => {
    const result = validatePassword('password1');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/uppercase/i);
  });

  it('rejects passwords without a digit', () => {
    const result = validatePassword('Password');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/number/i);
  });
});

describe('normalizeIP', () => {
  it('prefers x-forwarded-for and takes the first hop', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    expect(normalizeIP(req)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when forwarded is absent', () => {
    const req = new Request('http://x', {
      headers: { 'x-real-ip': '198.51.100.7' },
    });
    expect(normalizeIP(req)).toBe('198.51.100.7');
  });

  it('returns "unknown" when no headers are set', () => {
    const req = new Request('http://x');
    expect(normalizeIP(req)).toBe('unknown');
  });
});
