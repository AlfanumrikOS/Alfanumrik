/**
 * MobileBottomNav — reduced-motion behaviour and long translated labels.
 *
 * ── Why these two live at the component layer ────────────────────────────
 * Both are JS behaviour, not layout, so a browser buys nothing:
 *
 *   1. The scroll-hide is the one piece of motion in the navigation that NO
 *      stylesheet can suppress. globals.css's
 *      `@media (prefers-reduced-motion: reduce)` block neutralises the
 *      transition, but the bar still MOVES — the component sets
 *      `data-scroll-hidden="true"` and the transform applies instantly
 *      instead of over 260ms, which is exactly the vestibular trigger the
 *      preference exists to prevent. The component therefore checks the media
 *      query itself and skips installing the listener. That branch (three
 *      lines in a useEffect) had no test, and deleting it would leave every
 *      CSS-level reduced-motion assertion green.
 *
 *   2. Which STRING each slot renders under `isHi` is a pure props-in /
 *      text-out question. Whether that string then FITS is a layout question
 *      and is measured in `e2e/ui-nav-contract.spec.ts` at 480px and 768px.
 *      Splitting them this way keeps the expensive layer small.
 *
 * The rendered-geometry counterparts (five slots at 44px, exactly one
 * aria-current in the real accessibility tree, Hindi labels not truncating)
 * are in e2e/ui-nav-contract.spec.ts. Nothing here is duplicated there.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerPush = vi.fn();
let mockIsHi = false;
/** Mutable so the aria-current cases below can drive a real route change.
 *  It was hard-coded to '/dashboard', which made every current-slot property
 *  untestable at this layer. */
let mockPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    isHi: mockIsHi,
    roles: ['student'],
    activeRole: 'student',
    setActiveRole: vi.fn(),
    student: { id: 'student-1', grade: '9', subscription_plan: 'paid' },
    snapshot: { current_streak: 4 },
  }),
}));

vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => ({ data: {} }),
  useDashboardData: () => ({ data: { due_count: 2 } }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        limit: () => chain,
        then: (resolve: (value: { data: unknown[] }) => void) => {
          resolve({ data: [] });
          return Promise.resolve();
        },
      };
      return chain;
    },
  },
}));

import { MobileBottomNav } from '@alfanumrik/ui/navigation/MobileBottomNav';
import { resolveStudentPrimaryNav } from '@alfanumrik/ui/navigation/nav-config';

/**
 * Install a deterministic `matchMedia`. jsdom's own implementation answers
 * `matches: false` to everything, which would make the reduced-motion test
 * silently assert the DEFAULT branch while claiming to assert the reduced one.
 */
function stubMatchMedia(prefersReduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: /prefers-reduced-motion:\s*reduce/.test(query) ? prefersReduce : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

/** Drive a downward scroll past the component's own 80px / 8px thresholds. */
function scrollDownTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: y });
  fireEvent.scroll(window);
}

/**
 * The component throttles through requestAnimationFrame, so the handler body
 * runs on the next frame rather than inside `fireEvent`. Flush it.
 */
function flushRaf(): Promise<void> {
  return new Promise((resolve) => {
    // Two frames: one for the component's scheduled callback, one for React
    // to commit the resulting state.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function navElement(): HTMLElement {
  const nav = document.querySelector('nav[aria-label="Main navigation"]');
  if (!nav) throw new Error('MobileBottomNav rendered no main-navigation landmark');
  return nav as HTMLElement;
}

beforeEach(() => {
  routerPush.mockReset();
  mockIsHi = false;
  mockPathname = '/dashboard';
  Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: 0 });
});

afterEach(() => {
  cleanup();
});

describe('MobileBottomNav — prefers-reduced-motion', () => {
  it('hides itself on scroll-down when the user has expressed no motion preference', async () => {
    // The CONTROL direction. Without it, the reduced-motion test below would
    // also pass against a component that never hides the bar at all — i.e.
    // against a deleted feature rather than a respected preference.
    stubMatchMedia(false);
    render(<MobileBottomNav />);

    expect(navElement().getAttribute('data-scroll-hidden')).toBe('false');

    scrollDownTo(400);
    await flushRaf();

    expect(
      navElement().getAttribute('data-scroll-hidden'),
      'With no motion preference the bar is supposed to slide away on scroll-down. If this fails ' +
        'the reduced-motion assertion below proves nothing, because there would be no motion to reduce.',
    ).toBe('true');
  });

  it('never hides itself on scroll when prefers-reduced-motion is reduce', async () => {
    stubMatchMedia(true);
    render(<MobileBottomNav />);

    scrollDownTo(400);
    await flushRaf();
    scrollDownTo(900);
    await flushRaf();

    expect(
      navElement().getAttribute('data-scroll-hidden'),
      'Under prefers-reduced-motion: reduce the bar must stay put. The CSS reduce block only ' +
        'removes the 260ms transition — the bar would still JUMP off screen, which is the ' +
        'vestibular trigger the preference exists to prevent. The component has to skip the ' +
        'scroll listener entirely.',
    ).toBe('false');
  });

  it('keeps every navigation slot reachable while reduced motion is active', async () => {
    // A "never hides" implementation that achieved it by not rendering is not
    // the same product. Assert the slots are still there and still work.
    stubMatchMedia(true);
    render(<MobileBottomNav />);

    scrollDownTo(900);
    await flushRaf();

    const slots = Array.from(document.querySelectorAll('[data-slot]'));
    // 'foxy' joined the bar at slot 3 on 2026-08-24 (CEO-directed IA reversal
    // — see the block at the top of nav-config.ts).
    expect(slots.map((s) => s.getAttribute('data-slot'))).toEqual([
      'today',
      'practice',
      'foxy',
      'progress',
      'more',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(routerPush).toHaveBeenCalledWith('/practice');
  });
});

describe('MobileBottomNav — long translated labels (P7)', () => {
  it('renders every slot label in Hindi when isHi is set', () => {
    mockIsHi = true;
    stubMatchMedia(false);
    render(<MobileBottomNav />);

    const slots = resolveStudentPrimaryNav();
    const nav = navElement();
    for (const slot of slots) {
      const el = nav.querySelector(`[data-slot="${slot.id}"]`);
      expect(el, `slot ${slot.id} must render`).not.toBeNull();
      expect(
        el!.textContent,
        `slot ${slot.id} shows "${el!.textContent}" — expected the Hindi label "${slot.labelHi}"`,
      ).toContain(slot.labelHi);
    }
  });

  it('gives the overflow slot a Hindi accessible name, not the English one', () => {
    // The visible label is the short "और". The accessible name must still say
    // the control opens a sheet — and must not fall back to English, which is
    // the failure mode when a component reads `label` instead of `labelHi`.
    mockIsHi = true;
    stubMatchMedia(false);
    render(<MobileBottomNav />);

    const more = document.querySelector('[data-slot="more"]');
    const name = more?.getAttribute('aria-label') ?? '';
    expect(name, `the overflow slot announces "${name}"`).toMatch(/[ऀ-ॿ]/);
    expect(name, 'a Hindi UI must not announce the English name').not.toBe('More options');
  });

  it('renders English labels when isHi is unset', () => {
    // Both directions: a component that hardcoded Hindi would pass the test
    // above.
    mockIsHi = false;
    stubMatchMedia(false);
    render(<MobileBottomNav />);

    const nav = navElement();
    for (const slot of resolveStudentPrimaryNav()) {
      const el = nav.querySelector(`[data-slot="${slot.id}"]`);
      expect(el!.textContent, `slot ${slot.id} in English`).toContain(slot.label);
    }
  });

  it('marks exactly one slot as the current page', () => {
    // The rendered-accessibility-tree version of this (across ALL nav tiers at
    // once) is in e2e/ui-nav-contract.spec.ts; here it is pinned for the
    // bottom bar in isolation, where a regression is cheapest to catch.
    stubMatchMedia(false);
    render(<MobileBottomNav />);

    const current = Array.from(document.querySelectorAll('[aria-current="page"]'));
    expect(
      current.map((el) => el.getAttribute('data-slot')),
      'on /dashboard the Today slot owns the current-page marker (TODAY FLAG CONTRACT: /today ' +
        'redirects to /dashboard while ff_today_home_v1 is OFF)',
    ).toEqual(['today']);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * EXACTLY ONE aria-current="page", in the RENDERED tree.
 *
 * `student-primary-nav-contract.test.ts` pins `resolvePrimaryActiveId`, which
 * returns a single id BY CONSTRUCTION — so it cannot catch a component that
 * ignores the resolver and stamps `aria-current` per slot. That is worth
 * pinning here now that a fifth slot exists and `/foxy` is a route the bar is
 * actually mounted on: pre-2026-08-24 the bar was suppressed on /foxy, so the
 * Foxy slot could never have been current no matter what the markup said.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('MobileBottomNav — exactly one aria-current in the rendered tree', () => {
  const CASES: Array<[pathname: string, expectedSlot: string]> = [
    ['/today', 'today'],
    ['/dashboard', 'today'],
    ['/practice', 'practice'],
    ['/quiz', 'practice'],
    ['/foxy', 'foxy'],
    ['/progress', 'progress'],
  ];

  for (const [pathname, expectedSlot] of CASES) {
    it(`marks only the ${expectedSlot} slot current on ${pathname}`, () => {
      mockPathname = pathname;
      stubMatchMedia(false);
      render(<MobileBottomNav />);

      const current = Array.from(
        navElement().querySelectorAll('[aria-current="page"]'),
      ).map((el) => el.getAttribute('data-slot'));

      expect(
        current,
        `on ${pathname} the bar marked ${current.length} slots current: [${current.join(', ')}]`,
      ).toEqual([expectedSlot]);
    });
  }

  it('marks the Foxy slot current on /foxy — the route the bar used to be hidden on', () => {
    // The 4C half of CEO defect #1 in one assertion. GlobalAppLayout used to
    // suppress ALL nav chrome on /foxy (`isFocusedFoxy`), so a student inside
    // Foxy had no bottom bar at all and the only exit was a header back arrow.
    mockPathname = '/foxy';
    stubMatchMedia(false);
    render(<MobileBottomNav />);

    const foxy = navElement().querySelector('[data-slot="foxy"]');
    expect(foxy, 'the bar renders no Foxy slot').not.toBeNull();
    expect(foxy!.getAttribute('aria-current')).toBe('page');
  });

  it('marks NO primary slot current on a More-sheet route', () => {
    mockPathname = '/memory';
    stubMatchMedia(false);
    render(<MobileBottomNav />);

    const current = navElement().querySelectorAll('[aria-current="page"]');
    expect(
      Array.from(current).map((el) => el.getAttribute('data-slot')),
      '/memory belongs to the More sheet — the Foxy slot must not claim it just ' +
        'because both are Foxy-flavoured surfaces',
    ).toEqual([]);
  });
});
