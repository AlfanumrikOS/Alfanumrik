/**
 * Tier 1 super-admin IA relabel — copy/IA regression pin (2026-07).
 *
 * Locks in three presentation/copy facts that had NO prior test coverage:
 *   1. The `/super-admin/subscribers` nav item is labelled "Event Runtime"
 *      (Hindi "इवेंट रनटाइम") — the old customer-facing "Subscribers" label is gone.
 *   2. That item now lives in the Health section (with observability/SLA/alerts),
 *      NOT the Users section — it is a state-event runtime-ops console, not
 *      customer-subscriber management.
 *   3. The two relabelled page H1s render the new bilingual copy:
 *      subscribers  → "Event Runtime" / "इवेंट रनटाइम"
 *      command-center → "Improvement Loop" / "सुधार लूप"
 *
 * NAV_ITEMS is a private module const and AdminShell pulls in the full V3 shell
 * (supabase, feature flags, cosmic theme, Starfield), so — matching the repo's
 * established pattern for AdminShell nav facts (see
 * one-experience-v3-parent-admin-surfaces.test.ts) — this asserts on source.
 * Fully deterministic: no render, no async, no mock-resolution guesswork.
 *
 * This is a copy/IA change, not a product invariant. Every assertion below
 * checks BOTH the English and the Hindi string for each relabelled surface (P7).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), 'src/app');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Tier 1 super-admin IA relabel — AdminShell nav', () => {
  const shell = read('super-admin/_components/AdminShell.tsx');

  it('relabels the /super-admin/subscribers item to "Event Runtime" (EN + Hindi)', () => {
    expect(shell).toContain(
      "href: '/super-admin/subscribers', label: 'Event Runtime', labelHi: 'इवेंट रनटाइम'",
    );
    // The old customer-facing label (EN + Hindi) is gone from the nav.
    expect(shell).not.toContain("label: 'Subscribers'");
    expect(shell).not.toContain("labelHi: 'सब्सक्राइबर'");
    // Route href is unchanged (this is copy/IA only — no route change).
    expect(shell).toContain("href: '/super-admin/subscribers'");
  });

  // Phase 3 super-admin IA redesign (2026-07-20, CEO-approved): the 6 flat
  // sections (Platform/Users/Institutions/Health/Operations + appended EI
  // group) were replaced with a 7-section task-ordered IA. The original
  // assertion here ("Event Runtime in the Health section") is updated to its
  // Phase-3 equivalent: Event Runtime lives in System Health, still a
  // runtime-ops placement, still not people-management.
  it('pins the Phase 3 seven-section IA in task-frequency order', () => {
    const sections = [
      "{ type: 'section', label: 'Home'",
      "{ type: 'section', label: 'People & Support'",
      "{ type: 'section', label: 'Revenue & Billing'",
      "{ type: 'section', label: 'Content & AI Quality'",
      "{ type: 'section', label: 'Flags & Config'",
      "{ type: 'section', label: 'System Health'",
      "{ type: 'section', label: 'Access & Institutions'",
    ];
    const indices = sections.map(s => shell.indexOf(s));
    for (const [i, idx] of indices.entries()) {
      expect(idx, `section marker missing: ${sections[i]}`).toBeGreaterThan(-1);
      if (i > 0) expect(idx).toBeGreaterThan(indices[i - 1]);
    }
    // The old flat sections are gone.
    expect(shell).not.toContain("{ type: 'section', label: 'Platform'");
    expect(shell).not.toContain("{ type: 'section', label: 'Operations'");
    expect(shell).not.toContain("{ type: 'section', label: 'Education Intelligence'");
  });

  it('places Event Runtime in the System Health section, not People & Support', () => {
    const peopleIdx = shell.indexOf("{ type: 'section', label: 'People & Support'");
    const systemHealthIdx = shell.indexOf("{ type: 'section', label: 'System Health'");
    const accessIdx = shell.indexOf("{ type: 'section', label: 'Access & Institutions'");
    const eventRuntimeIdx = shell.indexOf("label: 'Event Runtime'");

    expect(peopleIdx).toBeGreaterThan(-1);
    expect(systemHealthIdx).toBeGreaterThan(peopleIdx);
    expect(accessIdx).toBeGreaterThan(systemHealthIdx);

    // Event Runtime sits AFTER the System Health marker and BEFORE the next
    // section → it belongs to System Health.
    expect(eventRuntimeIdx).toBeGreaterThan(systemHealthIdx);
    expect(eventRuntimeIdx).toBeLessThan(accessIdx);
  });

  it('maps the 17 formerly-orphaned dashboards into the nav', () => {
    const orphanHrefs = [
      '/super-admin/bulk-upload',
      '/super-admin/content',
      '/super-admin/grounding/health',
      '/super-admin/grounding/coverage',
      '/super-admin/grounding/verification-queue',
      '/super-admin/grounding/ai-issues',
      '/super-admin/grounding/traces',
      '/super-admin/foxy-quality',
      '/super-admin/misconceptions',
      '/super-admin/readiness-rubric',
      '/super-admin/goal-profiles',
      '/super-admin/subjects',
      '/super-admin/module-overrides',
      '/super-admin/observability/rules',
      '/super-admin/health',
      '/super-admin/command-center',
      '/super-admin/intelligence/revenue',
    ];
    for (const href of orphanHrefs) {
      expect(shell, `nav missing formerly-orphaned page ${href}`).toContain(`href: '${href}'`);
    }
    // The duplicate-titled /super-admin/alerts page is no longer a nav item
    // (it is now a redirect to /super-admin/observability/rules).
    expect(shell).not.toContain("href: '/super-admin/alerts'");
  });

  it('keeps EI items flag-gated via the EI_NAV_HREFS filter', () => {
    expect(shell).toContain('EI_NAV_HREFS');
    for (const href of [
      '/super-admin/intelligence',
      '/super-admin/intelligence/schools',
      '/super-admin/intelligence/revenue',
      '/super-admin/intelligence/geography',
    ]) {
      expect(shell).toContain(`'${href}',`);
    }
  });
});

describe('Tier 1 super-admin IA relabel — page H1s (bilingual)', () => {
  it('subscribers page H1 renders "Event Runtime" / "इवेंट रनटाइम"', () => {
    const page = read('super-admin/subscribers/page.tsx');
    expect(page).toContain("isHi ? 'इवेंट रनटाइम' : 'Event Runtime'");
    // Old static English H1 is gone.
    expect(page).not.toContain('>Subscribers</h1>');
  });

  it('command-center page H1 renders "Improvement Loop" / "सुधार लूप"', () => {
    const page = read('super-admin/command-center/page.tsx');
    expect(page).toContain("isHi ? 'सुधार लूप' : 'Improvement Loop'");
    // Old static English H1 is gone.
    expect(page).not.toContain('>Command Center</h1>');
  });
});
