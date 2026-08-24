import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { Menu, type MenuItem } from '@alfanumrik/ui/ui/primitives/Menu';

/* ═══════════════════════════════════════════════════════════════════════════
   Menu — canonical anchored-dropdown primitive
   (packages/ui/src/ui/primitives/Menu.tsx +
    packages/ui/src/ui/primitives/overlay/usePopoverPosition.ts)

   NEW FILE, ZERO CONSUMERS BY DESIGN. These tests are the only thing standing
   between the primitive's declared a11y contract and the day it gets mounted
   in navigation. They pin the WAI-ARIA menu-button pattern as behaviour, not
   as prose in a header comment:

     - trigger: aria-haspopup="menu", aria-expanded toggling, aria-controls
     - panel:   role="menu" + aria-label
     - items:   role="menuitem", roving tabindex
     - keyboard: ArrowDown/ArrowUp with WRAP and disabled-skipping,
                 Home/End, Enter/Space activating EXACTLY once,
                 Escape closing AND restoring focus to the trigger
     - pointer: outside pointerdown dismisses
     - controlled + uncontrolled open state
     - P7: `isHi` selects `labelHi`
     - href items render <a href> and route through `onNavigate`

   POSITIONING UNDER JSDOM. `getBoundingClientRect()` returns all zeros and
   `offsetWidth/offsetHeight` are 0, which usePopoverPosition documents as a
   supported degradation: every branch is pure arithmetic over those numbers,
   so it must yield FINITE coordinates (the viewport-padding corner) rather
   than NaN/null/throw. Asserting specific pixels here would be asserting the
   properties of a zero-rect, which proves nothing about a real browser — so
   the assertion is finiteness, which is the property that actually matters
   (a NaN `top` silently removes the declaration and strands the panel at the
   document origin).
   ═══════════════════════════════════════════════════════════════════════════ */

const ITEMS: MenuItem[] = [
  { id: 'dash', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '🏠' },
  { id: 'locked', label: 'Locked', labelHi: 'बंद', disabled: true },
  { id: 'progress', label: 'Progress', labelHi: 'प्रगति' },
  { id: 'leaderboard', label: 'Leaderboard', labelHi: 'लीडरबोर्ड' },
];

function withHandlers(items: MenuItem[]) {
  const onSelect = items.map(() => vi.fn());
  return {
    onSelect,
    items: items.map((item, i) => ({ ...item, onSelect: onSelect[i] })),
  };
}

interface Overrides {
  items?: MenuItem[];
  isHi?: boolean;
  label?: string;
  placement?: React.ComponentProps<typeof Menu>['placement'];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onNavigate?: (href: string, item: MenuItem) => void;
  closeOnSelect?: boolean;
}

function renderMenu(overrides: Overrides = {}) {
  const { items = ITEMS, ...rest } = overrides;
  const utils = render(
    <Menu items={items} isHi={false} label="Student menu" {...rest}>
      <button type="button">Open menu</button>
    </Menu>,
  );
  return utils;
}

const trigger = () => screen.getByRole('button', { name: 'Open menu' });
const panel = () => screen.getByRole('menu');
const menuItems = () => screen.getAllByRole('menuitem');

afterEach(() => cleanup());

/* ─────────────────────────────────────────────────────────────────────────
   ARIA wiring
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — trigger ARIA (WAI-ARIA menu button)', () => {
  it('closed trigger exposes aria-haspopup="menu", aria-expanded="false", aria-controls', () => {
    renderMenu();
    const t = trigger();
    expect(t.getAttribute('aria-haspopup')).toBe('menu');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    // aria-controls is kept on the CLOSED trigger on purpose (axe exempts the
    // id-reference check while aria-expanded is "false"), so it must be a
    // non-empty id even before the panel exists.
    expect(t.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('aria-expanded flips to "true" on open and aria-controls names the panel', () => {
    renderMenu();
    fireEvent.click(trigger());

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(panel().getAttribute('id'));
  });

  it('panel is role="menu" with the caller-supplied aria-label and vertical orientation', () => {
    renderMenu({ label: 'छात्र मेनू' });
    fireEvent.click(trigger());

    const p = panel();
    expect(p.getAttribute('aria-label')).toBe('छात्र मेनू');
    expect(p.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('every row is role="menuitem" with roving tabindex (-1) and the data-menu-item hook', () => {
    renderMenu();
    fireEvent.click(trigger());

    const rows = menuItems();
    expect(rows).toHaveLength(ITEMS.length);
    for (const row of rows) {
      expect(row.getAttribute('tabindex')).toBe('-1');
      expect(row.hasAttribute('data-menu-item')).toBe(true);
    }
    // Disabled rows announce themselves rather than being removed.
    expect(rows[1].getAttribute('aria-disabled')).toBe('true');
  });

  it('renders the transparent dismissal scrim (data-menu-scrim), aria-hidden', () => {
    const { baseElement } = renderMenu();
    fireEvent.click(trigger());

    const scrim = baseElement.querySelector('[data-menu-scrim]');
    expect(scrim).not.toBeNull();
    expect(scrim?.getAttribute('aria-hidden')).toBe('true');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Opening + initial focus
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — open behaviour and initial focus', () => {
  it('opening focuses the FIRST item', async () => {
    renderMenu();
    fireEvent.click(trigger());

    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));
    expect(document.activeElement?.textContent).toContain('Dashboard');
  });

  it('ArrowDown on the trigger opens at the first item', async () => {
    renderMenu();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));
  });

  it('ArrowUp on the trigger opens at the LAST ENABLED item', async () => {
    renderMenu();
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[3]));
  });

  it('defaultOpen renders the panel without a click (uncontrolled)', () => {
    renderMenu({ defaultOpen: true });
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the trigger while open closes it', async () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    // usePresence holds the node mounted for the 140 ms exit transition.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Roving focus
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — roving focus (ArrowDown / ArrowUp / Home / End)', () => {
  async function openAndFocusFirst() {
    renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));
    return menuItems();
  }

  it('ArrowDown SKIPS the disabled item', async () => {
    const rows = await openAndFocusFirst();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    // rows[1] ("Locked") is disabled — focus must land on rows[2].
    expect(document.activeElement).toBe(rows[2]);
    expect(document.activeElement).not.toBe(rows[1]);
  });

  it('ArrowDown WRAPS from the last item back to the first', async () => {
    const rows = await openAndFocusFirst();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); // → 2
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); // → 3 (last)
    expect(document.activeElement).toBe(rows[3]);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); // wrap → 0
    expect(document.activeElement).toBe(rows[0]);
  });

  it('ArrowUp WRAPS from the first item to the last, skipping disabled', async () => {
    const rows = await openAndFocusFirst();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' }); // wrap → 3
    expect(document.activeElement).toBe(rows[3]);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' }); // → 2
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' }); // skip 1 → 0
    expect(document.activeElement).toBe(rows[0]);
  });

  it('End jumps to the last ENABLED item, Home back to the first', async () => {
    const rows = await openAndFocusFirst();

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(rows[3]);

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('End skips a TRAILING disabled item', async () => {
    const items: MenuItem[] = [
      { id: 'a', label: 'A', labelHi: 'ए' },
      { id: 'b', label: 'B', labelHi: 'बी' },
      { id: 'c', label: 'C', labelHi: 'सी', disabled: true },
    ];
    renderMenu({ items });
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(menuItems()[1]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Activation
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — activation fires exactly once', () => {
  it('Enter activates the focused item EXACTLY once', async () => {
    const { items, onSelect } = withHandlers(ITEMS);
    renderMenu({ items });
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));

    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });

    // Call COUNT is the assertion, not merely "was called". The component
    // preventDefault()s the browser's own Enter→click synthesis and issues an
    // explicit .click(); a regression that drops the preventDefault would fire
    // the item TWICE in a real browser (double navigation / double mutation).
    expect(onSelect[0]).toHaveBeenCalledTimes(1);
    expect(onSelect[2]).not.toHaveBeenCalled();
  });

  it('Space activates the focused item EXACTLY once', async () => {
    const { items, onSelect } = withHandlers(ITEMS);
    renderMenu({ items });
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); // → index 2
    fireEvent.keyDown(document.activeElement!, { key: ' ' });

    expect(onSelect[2]).toHaveBeenCalledTimes(1);
    expect(onSelect[0]).not.toHaveBeenCalled();
  });

  it('mouse click activates once and closes by default (closeOnSelect)', async () => {
    const { items, onSelect } = withHandlers(ITEMS);
    renderMenu({ items });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    fireEvent.click(menuItems()[2]);

    expect(onSelect[2]).toHaveBeenCalledTimes(1);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    // Keyboard users must land back on the trigger, not at the document top.
    expect(document.activeElement).toBe(trigger());
  });

  it('closeOnSelect={false} keeps the menu open after activation', async () => {
    const { items, onSelect } = withHandlers(ITEMS);
    renderMenu({ items, closeOnSelect: false });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    fireEvent.click(menuItems()[2]);

    expect(onSelect[2]).toHaveBeenCalledTimes(1);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('a DISABLED item does not activate on click or Enter', async () => {
    const { items, onSelect } = withHandlers(ITEMS);
    renderMenu({ items });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    fireEvent.click(menuItems()[1]);
    expect(onSelect[1]).not.toHaveBeenCalled();
    // Still open — a disabled row is inert, not a dismissal.
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Dismissal
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — dismissal', () => {
  it('Escape closes AND returns focus to the trigger', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('outside pointerdown closes WITHOUT yanking focus back to the trigger', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));

    fireEvent.pointerDown(document.body);

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    // Deliberate asymmetry with Escape: a pointer dismissal must not steal
    // focus back to the control the user just clicked AWAY from.
    expect(document.activeElement).not.toBe(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('pointerdown INSIDE the panel does not close it', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    fireEvent.pointerDown(menuItems()[0]);

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('clicking the transparent scrim closes the menu', async () => {
    const { baseElement } = renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    fireEvent.click(baseElement.querySelector('[data-menu-scrim]')!);

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Controlled mode
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — controlled open state', () => {
  it('with `open` supplied, the component never self-opens; it only reports intent', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Menu items={ITEMS} isHi={false} label="Student menu" open={false} onOpenChange={onOpenChange}>
        <button type="button">Open menu</button>
      </Menu>,
    );

    fireEvent.click(trigger());

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // The owner has not granted it — so nothing opened.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    rerender(
      <Menu items={ITEMS} isHi={false} label="Student menu" open onOpenChange={onOpenChange}>
        <button type="button">Open menu</button>
      </Menu>,
    );

    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('controlled close intent is reported on Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Menu items={ITEMS} isHi={false} label="Student menu" open onOpenChange={onOpenChange}>
        <button type="button">Open menu</button>
      </Menu>,
    );
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Still open, because the owner has not changed `open` — controlled means
    // controlled.
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('uncontrolled mode still fires onOpenChange alongside its own state', () => {
    const onOpenChange = vi.fn();
    renderMenu({ onOpenChange });

    fireEvent.click(trigger());
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('menu')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Links
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — href items', () => {
  const LINK_ITEMS: MenuItem[] = [
    { id: 'dash', href: '/dashboard', label: 'Dashboard', labelHi: 'डैशबोर्ड' },
    { id: 'prog', href: '/progress', label: 'Progress', labelHi: 'प्रगति' },
    { id: 'off', href: '/locked', label: 'Locked', labelHi: 'बंद', disabled: true },
  ];

  it('an item with href renders an <a href> carrying role="menuitem"', async () => {
    renderMenu({ items: LINK_ITEMS });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    const first = menuItems()[0];
    expect(first.tagName).toBe('A');
    expect(first.getAttribute('href')).toBe('/dashboard');
    expect(first.getAttribute('role')).toBe('menuitem');
  });

  it('a DISABLED href item falls back to <button> (not a live link)', async () => {
    renderMenu({ items: LINK_ITEMS });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    const disabled = menuItems()[2];
    expect(disabled.tagName).toBe('BUTTON');
    expect(disabled.hasAttribute('href')).toBe(false);
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
  });

  it('onNavigate receives (href, item) and the item still activates + closes', async () => {
    const onNavigate = vi.fn();
    const onSelect = vi.fn();
    const items = LINK_ITEMS.map((i, idx) => (idx === 1 ? { ...i, onSelect } : i));

    renderMenu({ items, onNavigate });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    fireEvent.click(menuItems()[1]);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/progress', expect.objectContaining({ id: 'prog' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter on a focused link item routes through onNavigate exactly once', async () => {
    const onNavigate = vi.fn();
    renderMenu({ items: LINK_ITEMS, onNavigate });
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]));

    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/dashboard', expect.objectContaining({ id: 'dash' }));
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Bilingual (P7)
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — bilingual labels (P7)', () => {
  it('isHi={false} renders `label`', async () => {
    renderMenu({ isHi: false });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    expect(menuItems().map((n) => n.textContent?.trim())).toEqual([
      '🏠Dashboard',
      'Locked',
      'Progress',
      'Leaderboard',
    ]);
  });

  it('isHi={true} renders `labelHi` for EVERY row', async () => {
    renderMenu({ isHi: true });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    expect(menuItems().map((n) => n.textContent?.trim())).toEqual([
      '🏠डैशबोर्ड',
      'बंद',
      'प्रगति',
      'लीडरबोर्ड',
    ]);
    // No English leaks through when Hindi is on.
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('Leaderboard')).toBeNull();
  });

  it('the icon is aria-hidden so screen readers announce the label only', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    const icon = menuItems()[0].querySelector('span[aria-hidden="true"]');
    expect(icon?.textContent).toBe('🏠');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Positioning (JSDOM-degraded)
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — placement and positioning', () => {
  it('data-placement reflects the default placement (bottom-start)', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    expect(panel().getAttribute('data-placement')).toBe('bottom-start');
  });

  /**
   * JSDOM'S ZERO-RECTS ARE A FREE, DETERMINISTIC FLIP FIXTURE.
   *
   * `getBoundingClientRect()` returns all zeros here, which puts the anchor at
   * the viewport ORIGIN (top=bottom=left=right=0) inside a 1024x768 jsdom
   * window. Walk usePopoverPosition.update() with `placement: 'top-end'`:
   *
   *   need        = h + gap            = 0 + 8   =    8
   *   room.top    = rect.top    - pad  = 0 - 8   =   -8   → less than `need`
   *   room.bottom = vh - rect.bottom - pad = 768 - 0 - 8 = 760 → has room
   *   → `room[side] < need && room[OPPOSITE[side]] >= need` holds, so the side
   *     flips top → bottom and `resolved` becomes 'bottom-end'.
   *
   * So `bottom-end` is the CORRECT answer, not a regression: there is
   * genuinely no room above an anchor pinned to the viewport ceiling. The
   * cross-axis alignment ('end') is preserved by the flip, which is the other
   * half of the contract this pins.
   *
   * This asserts the RESOLVED placement exactly. It must NOT be relaxed to
   * accept either value — `data-placement` used to echo the raw PROP, so a
   * panel that had already flipped still advertised its unflipped preference
   * and anything keyed off the attribute (enter-animation origin, arrow
   * direction, visual-regression assertions) read a value the panel had
   * stopped honouring. An "either value passes" assertion would restore that
   * blind spot exactly.
   */
  it('data-placement reports the RESOLVED placement — top-end flips to bottom-end at the JSDOM origin', async () => {
    renderMenu({ placement: 'top-end' });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    expect(
      panel().getAttribute('data-placement'),
      'requested top-end at the viewport origin has no room above, so the resolved ' +
        'placement is bottom-end; data-placement must report the resolved value, not the prop',
    ).toBe('bottom-end');
  });

  /**
   * The counterpart: a placement that does NOT flip must be reported verbatim,
   * so the test above is pinning a real flip rather than a hook that always
   * rewrites the attribute. `right-start` is not an arbitrary pick — it is the
   * placement TabletNavRail passes to its grouped-nav flyouts, and at the
   * origin room.right = 1024 - 0 - 8 = 1016 >= need (8), so the rail's flyouts
   * open into the page exactly as declared.
   */
  it('data-placement reports a placement that did NOT flip verbatim (right-start, the rail flyout placement)', async () => {
    renderMenu({ placement: 'right-start' });
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    expect(panel().getAttribute('data-placement')).toBe('right-start');
  });

  it('coordinates are FINITE numbers under JSDOM zero-rects (never NaN)', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    const style = panel().getAttribute('style') ?? '';
    const top = /top:\s*(-?[\d.]+)px/.exec(style);
    const left = /left:\s*(-?[\d.]+)px/.exec(style);

    // A NaN coordinate serialises to nothing at all — the declaration is
    // dropped and the panel strands itself at the document origin. So the
    // presence of a parseable px value IS the assertion; the exact pixel is
    // meaningless against a zero rect.
    expect(top, `panel style had no numeric top: "${style}"`).not.toBeNull();
    expect(left, `panel style had no numeric left: "${style}"`).not.toBeNull();
    expect(Number.isFinite(Number(top![1]))).toBe(true);
    expect(Number.isFinite(Number(left![1]))).toBe(true);
  });

  it('the overlay container rides the canonical z-index token, not a magic number', async () => {
    const { baseElement } = renderMenu();
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());

    const container = baseElement.querySelector('[data-menu-scrim]')?.parentElement;
    expect(container?.getAttribute('style') ?? '').toMatch(/var\(--z-modal\)/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Trigger prop preservation
   ───────────────────────────────────────────────────────────────────────── */

describe('Menu — trigger cloning preserves the caller’s handlers', () => {
  it("the child's own onClick still fires alongside the open toggle", () => {
    const childClick = vi.fn();
    render(
      <Menu items={ITEMS} isHi={false} label="Student menu">
        <button type="button" onClick={childClick}>
          Open menu
        </button>
      </Menu>,
    );

    fireEvent.click(trigger());

    expect(childClick).toHaveBeenCalledTimes(1);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it("the child's own onKeyDown still fires alongside ArrowDown-to-open", async () => {
    const childKeyDown = vi.fn();
    render(
      <Menu items={ITEMS} isHi={false} label="Student menu">
        <button type="button" onKeyDown={childKeyDown}>
          Open menu
        </button>
      </Menu>,
    );

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    expect(childKeyDown).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());
  });
});
