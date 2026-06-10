import { describe, it, expect, vi } from 'vitest';

/**
 * Welcome page routing tests.
 *
 * The welcome page (`src/app/welcome/page.tsx`) now unconditionally renders
 * WelcomeV2 — the legacy WelcomeV1 and the ff_welcome_v2 flag-routing logic
 * have been removed. This file verifies the simplified contract.
 *
 * Owning agent: testing. Owner of source: frontend (page.tsx).
 */

function FakeV2() { return null; }
FakeV2.displayName = 'FakeV2';

vi.mock('@/components/landing/WelcomeV2', () => ({ default: FakeV2 }));

const importPage = async () => {
  const mod = await import('@/app/welcome/page');
  return mod.default;
};

type RenderedType = React.JSXElementConstructor<unknown> | string;
function elementType(el: unknown): RenderedType | undefined {
  if (el && typeof el === 'object' && 'type' in (el as Record<string, unknown>)) {
    return (el as { type: RenderedType }).type;
  }
  return undefined;
}

describe('welcome page — always renders WelcomeV2', () => {
  it('returns WelcomeV2 unconditionally', async () => {
    const Page = await importPage();
    const result = Page({});
    expect(elementType(result)).toBe(FakeV2);
  });

  it('is a synchronous server component (no async)', async () => {
    const Page = await importPage();
    // The simplified page is not async — calling it returns an element, not a Promise.
    const result = Page({});
    expect(result).not.toBeInstanceOf(Promise);
    expect(elementType(result)).toBe(FakeV2);
  });
});
