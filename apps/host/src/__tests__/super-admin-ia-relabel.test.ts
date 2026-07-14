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

  it('places Event Runtime in the Health section, not Users', () => {
    const usersIdx = shell.indexOf("{ type: 'section', label: 'Users'");
    const institutionsIdx = shell.indexOf("{ type: 'section', label: 'Institutions'");
    const healthIdx = shell.indexOf("{ type: 'section', label: 'Health'");
    const operationsIdx = shell.indexOf("{ type: 'section', label: 'Operations'");
    const eventRuntimeIdx = shell.indexOf("label: 'Event Runtime'");

    // Sanity: the four section markers exist in canonical order.
    expect(usersIdx).toBeGreaterThan(-1);
    expect(institutionsIdx).toBeGreaterThan(usersIdx);
    expect(healthIdx).toBeGreaterThan(institutionsIdx);
    expect(operationsIdx).toBeGreaterThan(healthIdx);

    // Event Runtime sits AFTER the Health marker and BEFORE Operations →
    // it belongs to the Health section.
    expect(eventRuntimeIdx).toBeGreaterThan(healthIdx);
    expect(eventRuntimeIdx).toBeLessThan(operationsIdx);

    // And it is NOT in the Users section (Users spans usersIdx..institutionsIdx).
    expect(eventRuntimeIdx).toBeGreaterThan(institutionsIdx);
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
