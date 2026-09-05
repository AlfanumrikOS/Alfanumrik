import { describe, it, expect, vi } from 'vitest';

/**
 * Welcome page routing tests.
 *
 * UPDATED 2026-09-05 (CEO-approved WelcomeV2 retirement): the `?v=2`
 * rollback escape hatch to WelcomeV2 was removed now that V3 is confirmed
 * stable. `?v=2` now falls through to the default exactly like every other
 * unrecognized value (matching how `?v=1` already behaved after legacy
 * WelcomeV1 was deleted). The page renders WelcomeV3 unconditionally:
 *   1. every searchParams value (none, empty, `?v=1`, `?v=2`, `?v=junk`) → WelcomeV3
 *   2. the page is still an async server component (Next.js 16 delivers
 *      searchParams as a Promise, so the page must await it).
 *
 * Owning agent: testing. Owner of source: frontend (page.tsx).
 */

function FakeV3() { return null; }
FakeV3.displayName = 'FakeV3';

vi.mock('@alfanumrik/ui/landing/v3/WelcomeV3', () => ({ default: FakeV3 }));

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

describe('welcome page — V3 unconditional (no more v2 rollback hatch)', () => {
  it('renders WelcomeV3 by default (no search params)', async () => {
    const Page = await importPage();
    const result = await Page({});
    expect(elementType(result)).toBe(FakeV3);
  });

  it('renders WelcomeV3 when searchParams resolve empty', async () => {
    const Page = await importPage();
    const result = await Page({ searchParams: Promise.resolve({}) });
    expect(elementType(result)).toBe(FakeV3);
  });

  it('renders WelcomeV3 for the retired ?v=2 rollback hatch', async () => {
    const Page = await importPage();
    const result = await Page({ searchParams: Promise.resolve({ v: '2' }) });
    expect(elementType(result)).toBe(FakeV3);
  });

  it('renders WelcomeV3 for any other version value (?v=1, ?v=junk)', async () => {
    const Page = await importPage();
    const v1 = await Page({ searchParams: Promise.resolve({ v: '1' }) });
    expect(elementType(v1)).toBe(FakeV3);
    const junk = await Page({ searchParams: Promise.resolve({ v: 'junk' }) });
    expect(elementType(junk)).toBe(FakeV3);
  });

  it('renders WelcomeV3 for array-valued v', async () => {
    const Page = await importPage();
    const result = await Page({ searchParams: Promise.resolve({ v: ['2', '3'] }) });
    expect(elementType(result)).toBe(FakeV3);
  });

  it('is an async server component (returns a Promise)', async () => {
    const Page = await importPage();
    const pending = Page({ searchParams: Promise.resolve({}) });
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });
});
