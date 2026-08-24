/**
 * Phase 1C — STEM lab simulation sizing (CEO defect #13), Group 2.
 *
 * STRUCTURAL guard. 26 simulations shipped a canvas with a FIXED backing store
 * (`width={540} height={240}`) plus an inline `width: '100%'` and NO CSS
 * height. CSS width was fluid, CSS height fell back to the intrinsic 240px
 * attribute, so the canvas scaled NON-UNIFORMLY — squashed to ~0.6x on a
 * 326px phone, stretched ~1.5x on desktop. Text, circles and arrowheads skew.
 *
 * The fix is one property per file: `height: 'auto'`. A replaced element with
 * an intrinsic ratio, `width: 100%` and `height: auto` scales proportionally.
 *
 * This test makes the defect class un-reintroducible: any NEW canvas that has
 * both width/height attributes and `width: '100%'` without a CSS height fails
 * the build with the offending file listed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SIM_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../simulations',
);

/** Matches `<canvas …/>` up to the first self-closing bracket. */
const CANVAS_TAG = /<canvas\b[\s\S]*?\/>/g;
/** Matches the inline `style={{ … }}` object literal inside a tag. */
const STYLE_PROP = /style=\{\{([\s\S]*?)\}\}/;

interface CanvasTag {
  file: string;
  tag: string;
  style: string | null;
}

function collectCanvasTags(): CanvasTag[] {
  const files = fs
    .readdirSync(SIM_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .sort();

  const tags: CanvasTag[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(SIM_DIR, file), 'utf8');
    for (const match of source.match(CANVAS_TAG) ?? []) {
      tags.push({
        file,
        tag: match,
        style: match.match(STYLE_PROP)?.[1] ?? null,
      });
    }
  }
  return tags;
}

const hasWidthAttr = (tag: string) => /\swidth=\{/.test(tag);
const hasHeightAttr = (tag: string) => /\sheight=\{/.test(tag);
const styleSetsFullWidth = (style: string) => /\bwidth\s*:\s*'100%'/.test(style);
const styleSetsHeight = (style: string) =>
  /(^|[,{\s])height\s*:/.test(style);

describe('simulation <canvas> sizing — structural guards', () => {
  const tags = collectCanvasTags();

  it('the scanner actually finds the simulation canvases (anti-false-pass)', () => {
    // If the regex ever stops matching, every assertion below would pass
    // vacuously. There are ~70 canvas tags across packages/ui/src/simulations.
    expect(tags.length).toBeGreaterThan(40);
    expect(tags.filter((t) => t.style && styleSetsFullWidth(t.style)).length)
      .toBeGreaterThan(20);
  });

  it('no canvas has fixed width/height attributes + width:100% and no CSS height', () => {
    const offenders = tags
      .filter(
        (t) =>
          hasWidthAttr(t.tag) &&
          hasHeightAttr(t.tag) &&
          t.style !== null &&
          styleSetsFullWidth(t.style) &&
          !styleSetsHeight(t.style),
      )
      .map((t) => t.file);

    expect(
      offenders,
      `Non-uniform canvas scaling (Group 2 defect). These files declare a fixed ` +
        `backing store AND style width:'100%' but no CSS height, so the canvas ` +
        `is squashed on mobile and stretched on desktop. Add height: 'auto' to ` +
        `the inline style:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every fixed-backing-store canvas that goes fluid uses height:auto', () => {
    const fluidFixed = tags.filter(
      (t) =>
        hasWidthAttr(t.tag) &&
        hasHeightAttr(t.tag) &&
        t.style !== null &&
        styleSetsFullWidth(t.style),
    );

    // This is the 26-file Group 2 set repaired in Phase 1C.
    expect(fluidFixed.length).toBeGreaterThanOrEqual(26);

    const wrongHeight = fluidFixed
      .filter((t) => !/\bheight\s*:\s*'auto'/.test(t.style as string))
      .map((t) => t.file);

    expect(
      wrongHeight,
      `A fluid (width:100%) canvas with a fixed backing store must use ` +
        `height: 'auto' so it scales proportionally:\n  ${wrongHeight.join('\n  ')}`,
    ).toEqual([]);
  });
});
