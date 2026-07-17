import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * Tests for the "How Foxy thinks" pipeline section (intelligence layer,
 * 2026-07-17). Source: packages/ui/src/landing/v3/HowFoxyThinksV3.tsx.
 *
 * Pins:
 *   - the 4 pipeline nodes render in order (EN) with 3 decorative connectors
 *   - P7: Hindi variants render under initialLang="hi"
 *   - structural safety for the /welcome contracts: the section adds NO <h1>
 *     and NO <details> (WelcomeV3.test.tsx re-verifies the page-level counts)
 *
 * Owning agent: frontend (testing reviews).
 */

import HowFoxyThinksV3 from '@alfanumrik/ui/landing/v3/HowFoxyThinksV3';
import { WelcomeV2Provider } from '@alfanumrik/ui/landing/WelcomeV2Context';

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

const NODE_TITLES_EN = [
  'Your question',
  'Reads your NCERT chapter',
  'Checks your Bloom’s level',
  'Answers at YOUR level',
];

describe('HowFoxyThinksV3 — pipeline section', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders the 4 pipeline nodes in order with 3 connectors (EN)', () => {
    render(
      <WelcomeV2Provider>
        <HowFoxyThinksV3 />
      </WelcomeV2Provider>,
    );
    const section = document.querySelector('#how-foxy-thinks');
    expect(section).not.toBeNull();
    const titles = Array.from(section!.querySelectorAll('h3')).map((h) => h.textContent);
    expect(titles).toEqual(NODE_TITLES_EN);
    // 3 decorative connectors, 2 travelling dots each.
    const links = section!.querySelectorAll('div[aria-hidden="true"]');
    expect(links).toHaveLength(3);
    links.forEach((link) => expect(link.querySelectorAll('i')).toHaveLength(2));
  });

  it('P7: renders in Hindi under initialLang="hi"', () => {
    render(
      <WelcomeV2Provider initialLang="hi">
        <HowFoxyThinksV3 />
      </WelcomeV2Provider>,
    );
    const section = document.querySelector('#how-foxy-thinks')!;
    expect(section.textContent).toContain('आपका सवाल');
    expect(section.textContent).toContain('फ़ॉक्सी कैसे सोचता है');
  });

  it('adds no <h1> and no <details> (welcome-root structural contracts hold)', () => {
    render(
      <WelcomeV2Provider>
        <HowFoxyThinksV3 />
      </WelcomeV2Provider>,
    );
    expect(document.querySelectorAll('h1')).toHaveLength(0);
    expect(document.querySelectorAll('details')).toHaveLength(0);
  });
});
