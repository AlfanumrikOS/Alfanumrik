/**
 * nav-config — the "/me" Wave B gap-screen entry (ff_me_v2).
 *
 * Pins that the new MORE_ITEMS / SIDEBAR_SECTIONS entry follows the SAME
 * flag-gating convention as the existing Practice Center / Revision Center
 * entries (isItemVisibleForFlags), so it is invisible until the flag ramps
 * and never duplicates the existing /profile entry unconditionally.
 */
import { describe, it, expect } from 'vitest';
import {
  MORE_ITEMS,
  SIDEBAR_SECTIONS,
  isItemVisibleForFlags,
  type NavFlagGatedItem,
} from '@alfanumrik/ui/navigation/nav-config';

describe('nav-config — /me gap screen (ff_me_v2)', () => {
  it('MORE_ITEMS has exactly one /me entry, flag-gated by ff_me_v2', () => {
    const meItems = MORE_ITEMS.filter((i) => i.href === '/me');
    expect(meItems).toHaveLength(1);
    expect(meItems[0].flagName).toBe('ff_me_v2');
  });

  it('SIDEBAR_SECTIONS (Account) has exactly one /me entry, flag-gated by ff_me_v2', () => {
    const account = SIDEBAR_SECTIONS.find((s) => s.title === 'Account');
    expect(account).toBeDefined();
    const meItems = account!.items.filter((i) => i.href === '/me');
    expect(meItems).toHaveLength(1);
    expect((meItems[0] as NavFlagGatedItem).flagName).toBe('ff_me_v2');
  });

  it('isItemVisibleForFlags: the /me item is hidden when ff_me_v2 is off/undefined, visible when on', () => {
    const item = MORE_ITEMS.find((i) => i.href === '/me') as NavFlagGatedItem;
    expect(isItemVisibleForFlags(item, undefined)).toBe(false);
    expect(isItemVisibleForFlags(item, { ff_me_v2: false })).toBe(false);
    expect(isItemVisibleForFlags(item, { ff_me_v2: true })).toBe(true);
  });

  it('the existing /profile entry is unconditional (still reachable regardless of the flag)', () => {
    const profileItem = MORE_ITEMS.find((i) => i.href === '/profile') as NavFlagGatedItem;
    expect(profileItem.flagName).toBeUndefined();
    expect(isItemVisibleForFlags(profileItem, undefined)).toBe(true);
  });
});
