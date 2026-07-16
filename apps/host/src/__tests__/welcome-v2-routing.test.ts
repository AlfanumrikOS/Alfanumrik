import { describe, it, expect, vi } from 'vitest';

/**
 * Welcome page routing tests.
 *
 * UPDATED 2026-07-16 (landing v3 makeover): the welcome page now renders
 * WelcomeV3 by DEFAULT, with `?v=2` preserved as the rollback escape hatch
 * that renders the previous WelcomeV2. The old assertions ("always renders
 * WelcomeV2 / synchronous page") were deliberately replaced — not deleted —
 * to pin the new contract:
 *   1. default (no query / unknown v) → WelcomeV3
 *   2. ?v=2 → WelcomeV2 (rollback path; V2 removal is a later cleanup PR)
 *   3. the page is an async server component (Next.js 16 delivers
 *      searchParams as a Promise, so the page must await it — the previous
 *      "not async" pin no longer applies).
 *
 * Owning agent: testing. Owner of source: frontend (page.tsx).
 */

function FakeV2() { return null; }
FakeV2.displayName = 'FakeV2';

function FakeV3() { return null; }
FakeV3.displayName = 'FakeV3';

vi.mock('@alfanumrik/ui/landing/WelcomeV2', () => ({ default: FakeV2 }));
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

describe('welcome page — V3 default with ?v=2 rollback escape hatch', () => {
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

  it('renders WelcomeV2 for ?v=2 (rollback escape hatch)', async () => {
    const Page = await importPage();
    const result = await Page({ searchParams: Promise.resolve({ v: '2' }) });
    expect(elementType(result)).toBe(FakeV2);
  });

  it('falls through to WelcomeV3 for unknown versions (?v=1, ?v=junk)', async () => {
    const Page = await importPage();
    const v1 = await Page({ searchParams: Promise.resolve({ v: '1' }) });
    expect(elementType(v1)).toBe(FakeV3);
    const junk = await Page({ searchParams: Promise.resolve({ v: 'junk' }) });
    expect(elementType(junk)).toBe(FakeV3);
  });

  it('handles array-valued v (first value wins)', async () => {
    const Page = await importPage();
    const result = await Page({ searchParams: Promise.resolve({ v: ['2', '3'] }) });
    expect(elementType(result)).toBe(FakeV2);
  });

  it('is an async server component (returns a Promise)', async () => {
    const Page = await importPage();
    const pending = Page({ searchParams: Promise.resolve({}) });
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });
});
