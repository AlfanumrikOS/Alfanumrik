/**
 * PercentileBandCard — band-union TOTALITY + producer drift guard (U10 / P7 / SEV1).
 *
 * ── WHAT BROKE ───────────────────────────────────────────────────────────────
 * `PercentileBandCard` indexed a `Record<PercentileBand, …>` copy table with a
 * band string that arrived off the wire. Three of the five labels
 * `bandFromPercentile()` can emit (`top_1`, `middle`, `bottom_25`) had NO entry
 * in that table, so `COPY[resolved]` was `undefined` and
 * `undefined.emoji` threw a TypeError during render. The card sits INSIDE the
 * `<SectionErrorBoundary section="Leaderboard">` that wraps all seven tabs of
 * /leaderboard, so one missing copy row blanked the entire page.
 *
 * The card now carries all seven labels plus a `keep_going` fallback, so it can
 * no longer throw. That fallback is a safety net, NOT a licence to skip copy:
 * a band with no copy row silently renders the generic "Keep going!" message to
 * a student who is actually in the top 1%. The drift guard below is what keeps
 * the fallback from becoming the default.
 *
 * ── WHAT THIS FILE PINS ──────────────────────────────────────────────────────
 * 1. TOTALITY — every one of the seven bands renders its OWN copy (verified via
 *    `data-band`, which reports the RESOLVED band: a band with no copy row
 *    resolves to `keep_going` and the assertion fails).
 * 2. BILINGUAL (P7) — every band carries non-empty EN copy and Devanagari HI
 *    copy. Not a mirror of the source table: the copy is read off the RENDERED
 *    DOM, so a band wired to the wrong language branch fails.
 * 3. U10 — no band's copy exposes an absolute numeric rank (`#\d+`). The whole
 *    point of replacing the rank block was to stop showing "#417 of 900".
 * 4. DRIFT — the card's union is a SUPERSET of every value its two producers
 *    can emit:
 *      a. the TS `bandFromPercentile()` in the /api/v1/leaderboard/me route,
 *         swept across percentiles 0..100 (plus the boundary values) by
 *         re-deriving it from the route's own source, and
 *      b. the SQL `CASE` in migration 20260813000006 that populates the RPC's
 *         `band` column — the OTHER producer, which emits `top_50`, a label the
 *         TS function never returns.
 *
 * (4) is the assertion that would have caught the SEV1 at CI time instead of in
 * production: adding a band route-side without adding copy fails here.
 *
 * The producers are read from SOURCE (fs + regex) rather than imported because
 * `bandFromPercentile` is module-private in the route and the SQL has no TS
 * binding at all. Reading source is the only way to see BOTH producers, and a
 * guard that only sees one of them is exactly the failure mode that let
 * `top_50` sit outside the union unnoticed. Non-vacuity is asserted explicitly
 * below so a regex that stops matching fails loudly instead of passing empty.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { PercentileBandCard } from '@alfanumrik/ui/leaderboard/PercentileBandCard';

/** The full union the card claims to cover. Spelled out, not imported from the
 *  card's own type — a test that derives its expectation from the thing under
 *  test cannot detect a missing member. */
const ALL_BANDS = [
  'top_1',
  'top_10',
  'top_25',
  'top_50',
  'middle',
  'bottom_25',
  'keep_going',
] as const;

/** Devanagari block. Used to prove HI copy is genuinely Hindi, not EN echoed. */
const DEVANAGARI = /[ऀ-ॿ]/;

/** U10: an absolute rank must never appear in band copy. */
const ABSOLUTE_RANK = /#\d+/;

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const ME_ROUTE = path.join(
  REPO_ROOT,
  'apps/host/src/app/api/v1/leaderboard/me/route.ts',
);
const PERCENTILE_MIGRATION = path.join(
  REPO_ROOT,
  'supabase/migrations/20260813000006_leaderboard_percentile_rpc.sql',
);

function renderBand(band: string, isHi: boolean): HTMLElement {
  render(<PercentileBandCard band={band} isHi={isHi} />);
  return screen.getByTestId('percentile-band-card');
}

afterEach(cleanup);

// ════════════════════════════════════════════════════════════════════════════
// 1. Totality — every band has its own copy row
// ════════════════════════════════════════════════════════════════════════════
describe('PercentileBandCard — band union totality', () => {
  it.each(ALL_BANDS)('"%s" resolves to itself, not to the fallback', (band) => {
    const card = renderBand(band, false);
    expect(
      card.getAttribute('data-band'),
      `band "${band}" fell back to keep_going — it has no copy row, so a student ` +
        `in that band is shown generic encouragement instead of their real standing`,
    ).toBe(band);
  });

  it.each(ALL_BANDS)('"%s" renders non-empty English copy', (band) => {
    const card = renderBand(band, false);
    const text = (card.textContent ?? '').trim();
    expect(text.length).toBeGreaterThan(10);
    // Heading + body are two distinct strings, not one repeated.
    expect(card.querySelector('h3')?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(card.querySelector('p')?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it.each(ALL_BANDS)('"%s" renders Devanagari copy under isHi (P7)', (band) => {
    const card = renderBand(band, true);
    const heading = card.querySelector('h3')?.textContent ?? '';
    const body = card.querySelector('p')?.textContent ?? '';
    expect(DEVANAGARI.test(heading), `HI heading for "${band}" is not Devanagari`).toBe(true);
    expect(DEVANAGARI.test(body), `HI body for "${band}" is not Devanagari`).toBe(true);
  });

  it.each(ALL_BANDS)('"%s" never exposes an absolute rank (U10)', (band) => {
    for (const isHi of [false, true]) {
      const card = renderBand(band, isHi);
      expect(
        ABSOLUTE_RANK.test(card.textContent ?? ''),
        `band "${band}" (isHi=${isHi}) leaks an absolute rank — U10 replaced the ` +
          `rank block precisely to stop that`,
      ).toBe(false);
      cleanup();
    }
  });

  it('EN and HI copy differ for every band (neither language is a stub)', () => {
    for (const band of ALL_BANDS) {
      const en = renderBand(band, false).textContent ?? '';
      cleanup();
      const hi = renderBand(band, true).textContent ?? '';
      cleanup();
      expect(en, `band "${band}" renders identical EN and HI copy`).not.toBe(hi);
    }
  });

  it('the seven bands produce seven distinct headings (no copy-paste collision)', () => {
    const headings = new Set<string>();
    for (const band of ALL_BANDS) {
      headings.add(renderBand(band, false).querySelector('h3')?.textContent ?? '');
      cleanup();
    }
    expect(headings.size).toBe(ALL_BANDS.length);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Never throws — the card sits inside the boundary that wraps all 7 tabs
// ════════════════════════════════════════════════════════════════════════════
describe('PercentileBandCard — total on unknown input', () => {
  const HOSTILE: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['unknown label', 'diamond_tier'],
    ['number', 3],
    ['object', { band: 'top_10' }],
    ['array', ['top_10']],
    ['prototype key', 'toString'],
    ['prototype key 2', 'constructor'],
    ['prototype key 3', '__proto__'],
  ];

  it.each(HOSTILE)('renders the fallback for %s without throwing', (_label, value) => {
    expect(() =>
      render(<PercentileBandCard band={value as string} isHi={false} />),
    ).not.toThrow();
    const card = screen.getByTestId('percentile-band-card');
    expect(card.getAttribute('data-band')).toBe('keep_going');
    expect((card.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. DRIFT GUARD — the union is a superset of what the producers can emit
// ════════════════════════════════════════════════════════════════════════════
describe('PercentileBandCard — producer drift guard', () => {
  /**
   * Re-derive `bandFromPercentile()` from the route's own source rather than
   * hand-copying its thresholds. Returns the ordered (threshold, label) pairs
   * plus the `else` label, so the sweep below runs the REAL rules.
   */
  function readTsProducer(): { rules: Array<[number, string]>; fallback: string } {
    const src = fs.readFileSync(ME_ROUTE, 'utf8');
    const fnStart = src.indexOf('function bandFromPercentile');
    expect(fnStart, 'bandFromPercentile() not found in the me route').toBeGreaterThan(-1);
    const body = src.slice(fnStart, src.indexOf('\n}', fnStart));

    const rules: Array<[number, string]> = [];
    const ifRe = /if\s*\(\s*p\s*>=\s*([\d.]+)\s*\)\s*return\s*'([a-z_0-9]+)'/g;
    let m: RegExpExecArray | null;
    while ((m = ifRe.exec(body))) rules.push([Number(m[1]), m[2]]);

    // The trailing unconditional `return '<label>';`
    const tail = [...body.matchAll(/^\s*return\s*'([a-z_0-9]+)'\s*;/gm)].at(-1);
    expect(tail, 'bandFromPercentile() has no unconditional fallback return').toBeDefined();

    return { rules, fallback: tail![1] };
  }

  /** Band literals emitted by the SQL CASE that fills `percentile.band`. */
  function readSqlProducer(): string[] {
    const sql = fs.readFileSync(PERCENTILE_MIGRATION, 'utf8');
    const caseStart = sql.indexOf('WHEN v_percentile');
    expect(caseStart, 'band CASE not found in the percentile migration').toBeGreaterThan(-1);
    const block = sql.slice(caseStart, caseStart + 600);
    const labels = [
      ...block.matchAll(/(?:THEN|ELSE)\s+'([a-z_0-9]+)'/g),
    ].map((m) => m[1]);
    return [...new Set(labels)];
  }

  /** The band the card ACTUALLY resolves a wire value to. */
  function resolvedBand(band: string): string {
    const card = renderBand(band, false);
    const resolved = card.getAttribute('data-band')!;
    cleanup();
    return resolved;
  }

  it('the TS producer extractor is not vacuous', () => {
    const { rules, fallback } = readTsProducer();
    expect(rules.length).toBeGreaterThanOrEqual(4);
    expect(fallback).toMatch(/^[a-z_0-9]+$/);
  });

  it('the SQL producer extractor is not vacuous', () => {
    const labels = readSqlProducer();
    expect(labels.length).toBeGreaterThanOrEqual(4);
    // `top_50` is emitted ONLY by SQL — its presence proves this extractor sees
    // the producer the TS one cannot.
    expect(labels).toContain('top_50');
  });

  it('every band bandFromPercentile() can return has copy (percentile sweep 0..100)', () => {
    const { rules, fallback } = readTsProducer();
    const emitted = new Set<string>();

    // Sweep every integer percentile plus each threshold and its neighbours, so
    // an off-by-one at a boundary cannot hide a band from the sweep.
    const probes = new Set<number>();
    for (let p = 0; p <= 100; p++) probes.add(p);
    for (const [threshold] of rules) {
      probes.add(threshold - 0.1);
      probes.add(threshold);
      probes.add(threshold + 0.1);
    }

    for (const p of probes) {
      const hit = rules.find(([threshold]) => p >= threshold);
      emitted.add(hit ? hit[1] : fallback);
    }

    expect(emitted.size).toBeGreaterThanOrEqual(4);
    for (const band of emitted) {
      expect(
        resolvedBand(band),
        `bandFromPercentile() can return "${band}" but PercentileBandCard has no copy ` +
          `for it — it silently renders the generic fallback. Add a COPY + TITLE row ` +
          `in packages/ui/src/leaderboard/PercentileBandCard.tsx.`,
      ).toBe(band);
    }
  });

  it('every band the percentile RPC can write has copy (SQL producer)', () => {
    for (const band of readSqlProducer()) {
      expect(
        resolvedBand(band),
        `migration 20260813000006 writes band "${band}" into the RPC's band column, ` +
          `but PercentileBandCard has no copy for it.`,
      ).toBe(band);
    }
  });

  it('the declared union covers BOTH producers combined', () => {
    const { rules, fallback } = readTsProducer();
    const producerBands = new Set<string>([
      ...rules.map(([, label]) => label),
      fallback,
      ...readSqlProducer(),
    ]);
    const missing = [...producerBands].filter((b) => !(ALL_BANDS as readonly string[]).includes(b));
    expect(
      missing,
      `bands emitted by a producer but absent from the card's union: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('a band that exists in NEITHER producer nor the union falls back (guard is real)', () => {
    // Negative control: proves the assertions above are capable of failing.
    expect(resolvedBand('top_0_point_1')).toBe('keep_going');
  });
});
