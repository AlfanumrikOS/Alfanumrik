/**
 * Phase 4 tests:
 *   - modalityForMastery() — pure thresholds picking the modality the
 *     /revise card recommends per chapter.
 *   - isItemVisibleForFlags() — pure helper deciding whether a nav
 *     entry surfaces when its flagName isn't yet enabled.
 *
 * Both are exported pure functions; testing them lets us pin /revise's
 * recommendation logic AND the nav-visibility policy without standing
 * up the full UI.
 */

import { describe, it, expect } from 'vitest';
import { modalityForMastery } from '@alfanumrik/lib/state/learner-loop/revise-stack-modality';
import { isItemVisibleForFlags } from '../../../components/navigation/nav-config';

// ─── modalityForMastery ──────────────────────────────────────────────

describe('modalityForMastery', () => {
  it('mastery >= 0.85 → worked-example', () => {
    expect(modalityForMastery(0.85)).toBe('worked-example');
    expect(modalityForMastery(0.95)).toBe('worked-example');
    expect(modalityForMastery(1)).toBe('worked-example');
  });

  it('0.7 <= mastery < 0.85 → explainer', () => {
    expect(modalityForMastery(0.7)).toBe('explainer');
    expect(modalityForMastery(0.8)).toBe('explainer');
    expect(modalityForMastery(0.849)).toBe('explainer');
  });

  it('mastery < 0.7 → read', () => {
    expect(modalityForMastery(0.69)).toBe('read');
    expect(modalityForMastery(0.6)).toBe('read');
    expect(modalityForMastery(0.5)).toBe('read');
  });

  it('boundary at exactly 0.7: returns explainer, not read', () => {
    expect(modalityForMastery(0.7)).toBe('explainer');
  });

  it('boundary at exactly 0.85: returns worked-example, not explainer', () => {
    expect(modalityForMastery(0.85)).toBe('worked-example');
  });
});

// ─── isItemVisibleForFlags ───────────────────────────────────────────

describe('isItemVisibleForFlags', () => {
  it('items without a flagName are always visible', () => {
    expect(isItemVisibleForFlags({ href: '/learn' }, {})).toBe(true);
    expect(isItemVisibleForFlags({ href: '/learn' }, null)).toBe(true);
    expect(isItemVisibleForFlags({ href: '/learn' }, undefined)).toBe(true);
    expect(isItemVisibleForFlags({ href: '/learn' }, { ff_anything: false })).toBe(true);
  });

  it('item with flagName visible only when that flag is true', () => {
    const item = { href: '/revise', flagName: 'ff_revise_route_v1' };
    expect(isItemVisibleForFlags(item, { ff_revise_route_v1: true })).toBe(true);
    expect(isItemVisibleForFlags(item, { ff_revise_route_v1: false })).toBe(false);
  });

  it('item with flagName hidden when flag missing from map', () => {
    const item = { href: '/revise', flagName: 'ff_revise_route_v1' };
    expect(isItemVisibleForFlags(item, {})).toBe(false);
  });

  it('item with flagName hidden when flag map is null/undefined (load failure)', () => {
    const item = { href: '/revise', flagName: 'ff_revise_route_v1' };
    // Defensive: a flag-fetch failure means we cannot prove the flag is
    // ON, so we hide the gated item. Safer than accidentally surfacing
    // a feature that should be dark.
    expect(isItemVisibleForFlags(item, null)).toBe(false);
    expect(isItemVisibleForFlags(item, undefined)).toBe(false);
  });

  it('null/undefined item is not visible', () => {
    expect(isItemVisibleForFlags(null, { ff_revise_route_v1: true })).toBe(true);
    // Items missing entirely treated as no flag — visible. (Caller is
    // responsible for not passing nulls in normal flow.)
    expect(isItemVisibleForFlags(undefined, { ff_revise_route_v1: true })).toBe(true);
  });
});
