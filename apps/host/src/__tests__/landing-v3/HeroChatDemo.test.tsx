import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * Tests for the hero Foxy chat demo playback + FoxyMascot v2 gestures
 * (2026-07-17 blank-demo production fix + mascot rebuild).
 *
 * Source: packages/ui/src/landing/v3/HeroV3.tsx (ChatDemo), FoxyMascot.tsx.
 *
 * ROOT-CAUSE REGRESSION PIN — the demo rendered BLANK in production because
 * the play-once guard lived in React state AND in the effect dependency
 * array: the IntersectionObserver's setPlayed(true) re-ran the effect, whose
 * cleanup cleared the four just-scheduled script timers before any fired
 * (step stayed 0 → every message kept msgPending → empty panel). These tests
 * pin the fixed contract:
 *
 *   1. IO fires → scripted playback advances to the completed conversation
 *      (student question + Foxy's NCERT answer visible, step 4)
 *   2. IO NEVER fires → the 2.5s failsafe force-completes the conversation
 *   3. prefers-reduced-motion → the FULL final conversation renders
 *      synchronously (a COMPLETED exchange, never an empty panel)
 *   4. hero fox reacts to the demo (think while typing → happy on answer)
 *   5. FoxyMascot v2 interactivity (hover→wave, click→celebrate, reduced→still)
 *
 * Owning agent: frontend (testing reviews).
 */

import HeroV3 from '@alfanumrik/ui/landing/v3/HeroV3';
import FoxyMascot from '@alfanumrik/ui/landing/v3/FoxyMascot';
import { WelcomeV2Provider } from '@alfanumrik/ui/landing/WelcomeV2Context';

/** Controllable IntersectionObserver stub. */
class IOStub {
  static instances: IOStub[] = [];
  callback: IntersectionObserverCallback;
  elements = new Set<Element>();
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    IOStub.instances.push(this);
  }
  observe(el: Element) {
    this.elements.add(el);
  }
  unobserve(el: Element) {
    this.elements.delete(el);
  }
  disconnect() {
    this.elements.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  trigger(isIntersecting: boolean) {
    const entries = Array.from(this.elements).map(
      (el) => ({ isIntersecting, target: el }) as unknown as IntersectionObserverEntry,
    );
    if (entries.length > 0) {
      this.callback(entries, this as unknown as IntersectionObserver);
    }
  }
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function renderHero() {
  return render(
    <WelcomeV2Provider>
      <HeroV3 />
    </WelcomeV2Provider>,
  );
}

function chatBody(): HTMLElement {
  const el = document.querySelector('[data-chat-step]');
  expect(el, 'chat body with data-chat-step should render').not.toBeNull();
  return el as HTMLElement;
}

const QUESTION_EN = 'Which part of a candle flame is the hottest?';
const ANSWER_EN_FRAGMENT = 'outermost zone';

describe('HeroV3 chat demo — scripted playback (blank-demo regression)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
    IOStub.instances = [];
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      IOStub as unknown as typeof IntersectionObserver;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    cleanup();
  });

  it('plays the full conversation after the panel intersects: question + answer land, step 4', () => {
    renderHero();
    // Nothing has played yet.
    expect(chatBody().getAttribute('data-chat-step')).toBe('0');

    // Panel scrolls into view.
    act(() => {
      IOStub.instances.forEach((i) => i.trigger(true));
    });

    // Typing indicator phase (3 dots inside the chat body).
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(chatBody().getAttribute('data-chat-step')).toBe('2');
    expect(chatBody().querySelectorAll('i')).toHaveLength(3);

    // Answer + quick chip land.
    act(() => {
      vi.advanceTimersByTime(2500); // → 4200ms total
    });
    const body = chatBody();
    expect(body.getAttribute('data-chat-step')).toBe('4');
    expect(body.textContent).toContain(QUESTION_EN);
    expect(body.textContent).toContain(ANSWER_EN_FRAGMENT);
    // Typing indicator replaced by the answer.
    expect(body.querySelectorAll('i')).toHaveLength(0);
  });

  it('FAILSAFE: if the IntersectionObserver never fires, the conversation force-completes at 2.5s', () => {
    renderHero();
    expect(chatBody().getAttribute('data-chat-step')).toBe('0');

    // No intersection ever reported (embed/scroll-container IO quirk).
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    const body = chatBody();
    expect(body.getAttribute('data-chat-step')).toBe('4');
    expect(body.textContent).toContain(QUESTION_EN);
    expect(body.textContent).toContain(ANSWER_EN_FRAGMENT);
  });

  it('playback survives the play-once guard (regression: timers were cleared by the effect re-run)', () => {
    renderHero();
    act(() => {
      IOStub.instances.forEach((i) => i.trigger(true));
    });
    // The first script timer (student message at 600ms) MUST fire — in the
    // broken build every timer was cleared before this point.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(chatBody().getAttribute('data-chat-step')).toBe('1');
  });

  it('hero fox reacts to the demo: think while typing, happy when the answer lands, then idle', () => {
    renderHero();
    act(() => {
      IOStub.instances.forEach((i) => i.trigger(true));
    });
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(document.querySelector('[data-gesture="think"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1700); // → 3400ms: answer lands
    });
    expect(document.querySelector('[data-gesture="happy"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000); // happy settles back to idle life
    });
    expect(document.querySelector('[data-gesture="happy"]')).toBeNull();
    expect(document.querySelector('[data-gesture="think"]')).toBeNull();
  });
});

describe('HeroV3 chat demo — prefers-reduced-motion', () => {
  beforeEach(() => {
    stubMatchMedia(true); // (prefers-reduced-motion: reduce) matches
    localStorage.clear();
    IOStub.instances = [];
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      IOStub as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    cleanup();
  });

  it('renders the COMPLETED conversation synchronously — never an empty panel', () => {
    renderHero();
    // No timer advancement, no intersection — final state immediately.
    const body = chatBody();
    expect(body.getAttribute('data-chat-step')).toBe('4');
    expect(body.textContent).toContain(QUESTION_EN);
    expect(body.textContent).toContain(ANSWER_EN_FRAGMENT);
    expect(body.querySelectorAll('i')).toHaveLength(0);
  });
});

describe('FoxyMascot v2 — interactive gestures', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    IOStub.instances = [];
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      IOStub as unknown as typeof IntersectionObserver;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    cleanup();
  });

  function mascot(): SVGSVGElement {
    const el = document.querySelector('svg[data-gesture]');
    expect(el).not.toBeNull();
    return el as SVGSVGElement;
  }

  it('hover waves once, click celebrates for 1.5s, then returns to idle', () => {
    render(<FoxyMascot interactive />);
    expect(mascot().getAttribute('data-gesture')).toBe('idle');

    fireEvent.mouseEnter(mascot());
    expect(mascot().getAttribute('data-gesture')).toBe('wave');

    fireEvent.click(mascot());
    expect(mascot().getAttribute('data-gesture')).toBe('celebrate');

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // wave timer may also have elapsed — must be settled, not celebrating.
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(mascot().getAttribute('data-gesture')).toBe('idle');
  });

  it('non-interactive foxes (default) ignore hover/click — safe inside links', () => {
    render(<FoxyMascot />);
    fireEvent.mouseEnter(mascot());
    fireEvent.click(mascot());
    expect(mascot().getAttribute('data-gesture')).toBe('idle');
  });

  it('stays decorative: aria-hidden, not focusable', () => {
    render(<FoxyMascot interactive />);
    expect(mascot().getAttribute('aria-hidden')).toBe('true');
    expect(mascot().getAttribute('focusable')).toBe('false');
    expect(mascot().hasAttribute('tabindex')).toBe(false);
  });

  it('external gesture prop drives the pose (think/happy wiring)', () => {
    render(<FoxyMascot gesture="think" />);
    expect(mascot().getAttribute('data-gesture')).toBe('think');
  });

  it('reduced motion forces a still portrait: interactions and poses collapse to idle', () => {
    stubMatchMedia(true);
    render(<FoxyMascot interactive gesture="think" />);
    expect(mascot().getAttribute('data-gesture')).toBe('idle');
    fireEvent.click(mascot());
    expect(mascot().getAttribute('data-gesture')).toBe('idle');
  });
});
