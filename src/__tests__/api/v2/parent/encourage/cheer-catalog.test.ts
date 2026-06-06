/**
 * Cheer catalog — content-safety + bilingual contract tests (Wave D).
 *
 * The cheer catalog is a hard P12/P13 safety boundary: every preset must be a
 * fixed, bilingual, PII-free string. These tests pin:
 *   - DEFAULT_MESSAGE_KEY is itself a valid preset.
 *   - cheer_type is always one of the five allowed enum values (matches the
 *     parent_cheers.cheer_type CHECK constraint).
 *   - Every preset ships non-empty En + Hi title and body (P7 bilingual).
 *   - isValidMessageKey / getPreset behave correctly for known/unknown keys.
 */

import { describe, it, expect } from 'vitest';
import {
  CHEER_PRESETS,
  DEFAULT_MESSAGE_KEY,
  isValidMessageKey,
  getPreset,
  type CheerType,
} from '@/lib/parent/cheer-catalog';

const ALLOWED_TYPES: CheerType[] = ['generic', 'streak', 'quiz', 'effort', 'milestone'];

describe('cheer-catalog — structure', () => {
  it('exposes at least 6 presets', () => {
    expect(Object.keys(CHEER_PRESETS).length).toBeGreaterThanOrEqual(6);
  });

  it('DEFAULT_MESSAGE_KEY resolves to a valid preset', () => {
    expect(isValidMessageKey(DEFAULT_MESSAGE_KEY)).toBe(true);
    expect(getPreset(DEFAULT_MESSAGE_KEY)).not.toBeNull();
  });

  it('every preset uses an allowed cheer_type', () => {
    for (const [key, preset] of Object.entries(CHEER_PRESETS)) {
      expect(ALLOWED_TYPES, `${key} has an invalid cheerType`).toContain(preset.cheerType);
    }
  });

  it('every preset ships non-empty En + Hi title and body (P7 bilingual)', () => {
    for (const [key, preset] of Object.entries(CHEER_PRESETS)) {
      expect(preset.titleEn.trim().length, `${key}.titleEn`).toBeGreaterThan(0);
      expect(preset.titleHi.trim().length, `${key}.titleHi`).toBeGreaterThan(0);
      expect(preset.bodyEn.trim().length, `${key}.bodyEn`).toBeGreaterThan(0);
      expect(preset.bodyHi.trim().length, `${key}.bodyHi`).toBeGreaterThan(0);
      expect(preset.icon.trim().length, `${key}.icon`).toBeGreaterThan(0);
    }
  });

  it('Hindi variants actually contain Devanagari (not a copy of English)', () => {
    const devanagari = /[ऀ-ॿ]/;
    for (const [key, preset] of Object.entries(CHEER_PRESETS)) {
      expect(devanagari.test(preset.titleHi), `${key}.titleHi`).toBe(true);
      expect(devanagari.test(preset.bodyHi), `${key}.bodyHi`).toBe(true);
    }
  });
});

describe('cheer-catalog — helpers', () => {
  it('isValidMessageKey accepts known keys and rejects unknown/empty', () => {
    expect(isValidMessageKey(DEFAULT_MESSAGE_KEY)).toBe(true);
    expect(isValidMessageKey('not_a_key')).toBe(false);
    expect(isValidMessageKey('')).toBe(false);
    expect(isValidMessageKey(null)).toBe(false);
    expect(isValidMessageKey(undefined)).toBe(false);
  });

  it('getPreset returns the preset for a known key and null otherwise', () => {
    const p = getPreset(DEFAULT_MESSAGE_KEY);
    expect(p).not.toBeNull();
    expect(p?.cheerType).toBeTruthy();
    expect(getPreset('nope')).toBeNull();
    expect(getPreset(null)).toBeNull();
    expect(getPreset(undefined)).toBeNull();
  });
});
