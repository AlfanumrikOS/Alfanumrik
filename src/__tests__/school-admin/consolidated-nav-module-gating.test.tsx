/**
 * Phase 3C Wave A / A3 — ConsolidatedSchoolNav module gating parity.
 *
 * The nav's hide/show decision for a `moduleKey`-tagged item MUST match the
 * route guard's decision so a tenant never sees a nav link that 404s, and never
 * loses a link to a module that the route would actually serve:
 *
 *   moduleEnablement[key] === false  → item HIDDEN  (mirrors route-guard 404).
 *   moduleEnablement == null         → ALL items shown (loading / error /
 *                                       fail-open — mirrors the guard's allow).
 *   flag OFF (all-enabled map)       → ALL items shown (the enabledModulesFor
 *                                       map is every-key-true when the flag is
 *                                       OFF — same source the resolver uses).
 *
 * The component renders `<a href>` links; we assert on link presence by href.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConsolidatedSchoolNav, {
  SCHOOL_NAV_SECTIONS,
} from '@/app/school-admin/_components/ConsolidatedSchoolNav';

// The PURELY module-gated items in the nav (href → moduleKey) — derived from the
// REAL section map so this stays in sync if the map changes. We exclude items
// that carry an ADDITIONAL gate (`rbacOnly` / `reportsDepthOnly`): those are
// hidden by their own flag (default OFF) independent of module enablement, so
// they are not a clean probe of the module-gating ↔ route-guard parity this test
// asserts. (The Wave C/D flag gates are covered by their own REG entries.)
const MODULE_GATED_ITEMS = SCHOOL_NAV_SECTIONS.flatMap((s) => s.items)
  .filter((i) => i.moduleKey && !i.rbacOnly && !i.reportsDepthOnly)
  .map((i) => ({ href: i.href, moduleKey: i.moduleKey as string }));

function renderNav(moduleEnablement: Record<string, boolean> | null | undefined) {
  return render(
    <ConsolidatedSchoolNav
      brandTitle="DPS"
      brandSubtitle="School Admin"
      currentPath="/school-admin"
      isHi={false}
      moduleEnablement={moduleEnablement}
    />,
  );
}

/** All anchor hrefs currently rendered (desktop rail; the mobile drawer is closed). */
function renderedHrefs(): string[] {
  return screen
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'))
    .filter((h): h is string => Boolean(h));
}

describe('ConsolidatedSchoolNav — sanity: the nav actually has module-gated items', () => {
  it('the section map contains at least one moduleKey-tagged item (testing_engine, lms, analytics, communication)', () => {
    const keys = new Set(MODULE_GATED_ITEMS.map((i) => i.moduleKey));
    expect(keys.has('testing_engine')).toBe(true);
    expect(keys.has('lms')).toBe(true);
    expect(keys.has('analytics')).toBe(true);
    expect(keys.has('communication')).toBe(true);
  });
});

describe('ConsolidatedSchoolNav — item with moduleKey whose enablement is false is HIDDEN', () => {
  it('hides the Exams (testing_engine) link when testing_engine is disabled', () => {
    // Every module enabled EXCEPT testing_engine.
    const enablement = Object.fromEntries(
      MODULE_GATED_ITEMS.map((i) => [i.moduleKey, i.moduleKey !== 'testing_engine']),
    );
    renderNav(enablement);
    const hrefs = renderedHrefs();
    expect(hrefs).not.toContain('/school-admin/exams'); // testing_engine — hidden
    expect(hrefs).toContain('/school-admin/content'); // lms — still shown
  });

  it('hides exactly the disabled item, mirroring the route-guard decision for that key', () => {
    for (const target of MODULE_GATED_ITEMS) {
      const enablement = Object.fromEntries(
        MODULE_GATED_ITEMS.map((i) => [i.moduleKey, i.moduleKey !== target.moduleKey]),
      );
      const { unmount } = renderNav(enablement);
      const hrefs = renderedHrefs();
      // The single disabled module's link is gone…
      expect(hrefs).not.toContain(target.href);
      // …and every OTHER module-gated link is still present.
      for (const other of MODULE_GATED_ITEMS) {
        if (other.href !== target.href) expect(hrefs).toContain(other.href);
      }
      unmount();
    }
  });

  it('keeps NON-module items (Students, Classes) visible regardless of module enablement', () => {
    const allDisabled = Object.fromEntries(MODULE_GATED_ITEMS.map((i) => [i.moduleKey, false]));
    renderNav(allDisabled);
    const hrefs = renderedHrefs();
    expect(hrefs).toContain('/school-admin'); // Command Center (no moduleKey)
    expect(hrefs).toContain('/school-admin/students'); // People (no moduleKey)
    expect(hrefs).toContain('/school-admin/classes'); // Academics (no moduleKey)
  });
});

describe('ConsolidatedSchoolNav — moduleEnablement null/undefined → ALL items shown (fail-open)', () => {
  it('shows every module-gated link when moduleEnablement is null (loading / error)', () => {
    renderNav(null);
    const hrefs = renderedHrefs();
    for (const item of MODULE_GATED_ITEMS) {
      expect(hrefs).toContain(item.href);
    }
  });

  it('shows every module-gated link when moduleEnablement is undefined', () => {
    renderNav(undefined);
    const hrefs = renderedHrefs();
    for (const item of MODULE_GATED_ITEMS) {
      expect(hrefs).toContain(item.href);
    }
  });
});

describe('ConsolidatedSchoolNav — flag OFF (all-enabled map) → ALL items shown', () => {
  it('shows every module-gated link when the enablement map is every-key-true (resolver OFF short-circuit)', () => {
    // When ff_tenant_module_registry_v1 is OFF, enabledModulesFor returns a map
    // with EVERY module true — the same all-enabled posture the route guard
    // fails open to. The nav must therefore show every link.
    const allEnabled = Object.fromEntries(MODULE_GATED_ITEMS.map((i) => [i.moduleKey, true]));
    renderNav(allEnabled);
    const hrefs = renderedHrefs();
    for (const item of MODULE_GATED_ITEMS) {
      expect(hrefs).toContain(item.href);
    }
  });
});
