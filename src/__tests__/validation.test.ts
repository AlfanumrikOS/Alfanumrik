import { describe, it, expect } from 'vitest';
import {
  UUID_REGEX,
  isValidUUID,
  isValidGrade,
  isValidPlanCode,
  isSafeIdentifier,
  isValidEmail,
  sanitizeText,
} from '../lib/validation';

// ── isValidUUID ──────────────────────────────────────────

describe('isValidUUID', () => {
  it('accepts a valid v4 UUID', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts uppercase UUID', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('accepts mixed-case UUID', () => {
    expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidUUID(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidUUID(undefined)).toBe(false);
  });

  it('rejects a number', () => {
    expect(isValidUUID(12345)).toBe(false);
  });

  it('rejects a UUID without hyphens', () => {
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rejects a short string', () => {
    expect(isValidUUID('550e8400-e29b')).toBe(false);
  });

  it('rejects a string with invalid characters', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-44665544ZZZZ')).toBe(false);
  });

  it('rejects SQL injection in UUID field', () => {
    expect(isValidUUID("'; DROP TABLE students; --")).toBe(false);
  });

  it('UUID_REGEX matches the same values as isValidUUID', () => {
    const valid = '550e8400-e29b-41d4-a716-446655440000';
    expect(UUID_REGEX.test(valid)).toBe(true);
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
  });
});

// ── isValidGrade (P5: grades must be strings "6"-"12") ───

describe('isValidGrade', () => {
  it('accepts "6" through "12"', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(isValidGrade(g)).toBe(true);
    }
  });

  it('rejects integer 6 (P5: must be string)', () => {
    expect(isValidGrade(6)).toBe(false);
  });

  it('rejects integer 12 (P5: must be string)', () => {
    expect(isValidGrade(12)).toBe(false);
  });

  it('rejects "5" (below range)', () => {
    expect(isValidGrade('5')).toBe(false);
  });

  it('rejects "13" (above range)', () => {
    expect(isValidGrade('13')).toBe(false);
  });

  it('rejects "0"', () => {
    expect(isValidGrade('0')).toBe(false);
  });

  it('rejects "Grade 9" (prefixed form)', () => {
    expect(isValidGrade('Grade 9')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidGrade('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidGrade(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidGrade(undefined)).toBe(false);
  });

  it('rejects "1" (primary school, not CBSE 6-12)', () => {
    expect(isValidGrade('1')).toBe(false);
  });
});

// ── isValidPlanCode ──────────────────────────────────────

describe('isValidPlanCode', () => {
  it('accepts "free"', () => {
    expect(isValidPlanCode('free')).toBe(true);
  });

  it('accepts "starter"', () => {
    expect(isValidPlanCode('starter')).toBe(true);
  });

  it('accepts "pro"', () => {
    expect(isValidPlanCode('pro')).toBe(true);
  });

  it('accepts "unlimited"', () => {
    expect(isValidPlanCode('unlimited')).toBe(true);
  });

  it('rejects "premium" (not a valid plan)', () => {
    expect(isValidPlanCode('premium')).toBe(false);
  });

  it('rejects "Free" (case-sensitive)', () => {
    expect(isValidPlanCode('Free')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidPlanCode('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidPlanCode(null)).toBe(false);
  });

  it('rejects number 0', () => {
    expect(isValidPlanCode(0)).toBe(false);
  });
});

// ── isSafeIdentifier ────────────────────────────────────

describe('isSafeIdentifier', () => {
  it('accepts alphanumeric string', () => {
    expect(isSafeIdentifier('student123')).toBe(true);
  });

  it('accepts string with hyphens', () => {
    expect(isSafeIdentifier('my-identifier')).toBe(true);
  });

  it('accepts string with underscores', () => {
    expect(isSafeIdentifier('my_identifier')).toBe(true);
  });

  it('accepts single character', () => {
    expect(isSafeIdentifier('a')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isSafeIdentifier('')).toBe(false);
  });

  it('rejects SQL injection string', () => {
    expect(isSafeIdentifier("'; DROP TABLE students; --")).toBe(false);
  });

  it('rejects string with spaces', () => {
    expect(isSafeIdentifier('hello world')).toBe(false);
  });

  it('rejects string with dots (path traversal)', () => {
    expect(isSafeIdentifier('../etc/passwd')).toBe(false);
  });

  it('rejects string with angle brackets (XSS)', () => {
    expect(isSafeIdentifier('<script>alert(1)</script>')).toBe(false);
  });

  it('rejects null', () => {
    expect(isSafeIdentifier(null)).toBe(false);
  });

  it('rejects string longer than 128 characters', () => {
    expect(isSafeIdentifier('a'.repeat(129))).toBe(false);
  });

  it('accepts string of exactly 128 characters', () => {
    expect(isSafeIdentifier('a'.repeat(128))).toBe(true);
  });
});

// ── isValidEmail ─────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts a standard email', () => {
    expect(isValidEmail('student@example.com')).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(isValidEmail('user@mail.example.co.in')).toBe(true);
  });

  it('accepts email with plus addressing', () => {
    expect(isValidEmail('user+tag@example.com')).toBe(true);
  });

  it('rejects missing @ sign', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects missing domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('rejects missing TLD', () => {
    expect(isValidEmail('user@example')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidEmail(null)).toBe(false);
  });

  it('rejects number', () => {
    expect(isValidEmail(42)).toBe(false);
  });

  it('rejects email exceeding 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@b.com'; // 256 chars total
    expect(isValidEmail(longEmail)).toBe(false);
  });
});

// ── sanitizeText ─────────────────────────────────────────

describe('sanitizeText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('<b>bold</b>')).toBe('bold');
  });

  it('strips script tags', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe('alert("xss")');
  });

  it('strips nested tags', () => {
    expect(sanitizeText('<div><p>hello</p></div>')).toBe('hello');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeText('  hello world  ')).toBe('hello world');
  });

  it('returns empty string for tags-only input', () => {
    expect(sanitizeText('<br/><hr/>')).toBe('');
  });

  it('preserves plain text', () => {
    expect(sanitizeText('Hello, World!')).toBe('Hello, World!');
  });

  it('preserves Hindi text', () => {
    expect(sanitizeText('  नमस्ते दुनिया  ')).toBe('नमस्ते दुनिया');
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('strips img tags with attributes', () => {
    expect(sanitizeText('<img src="x" onerror="alert(1)">')).toBe('');
  });
});
