/**
 * Phase 1C — STEM lab simulation sizing (CEO defect #13).
 *
 * Pins the overlap fix in `useResponsiveCanvas`: the canvas must NEVER be
 * painted larger than the container that owns it, and the minimum-size floor
 * must be absorbed by the CONTAINER (via CSS min-height) rather than by the
 * canvas. Before the fix the hook did `h = Math.max(w / aspectRatio, 200)` and
 * wrote that straight onto `canvas.style.height`, so whenever the container
 * was narrower than `200 * aspectRatio` the canvas painted over the sibling
 * controls below it.
 *
 * The test installs a tiny simulated CSS engine on the container's
 * getBoundingClientRect: height = max(width / aspectRatio, cssMinHeight).
 * That is exactly how CSS resolves `aspect-ratio` against `min-height`.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  useResponsiveCanvas,
  DEFAULT_CANVAS_MIN_HEIGHT,
} from '../../hooks/useResponsiveCanvas';

// ── Simulated layout state, read by the getBoundingClientRect stub ──────────
const layout = { width: 0, aspectRatio: 1 };

let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  // jsdom has no ResizeObserver. The hook only needs observe/disconnect.
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  rectSpy = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.dataset?.testid !== 'container') {
        return makeRect(0, 0);
      }
      const w = layout.width;
      // A container with no layout box (display:none, detached) reports 0x0 in
      // a real browser regardless of any min-* declaration.
      if (w <= 0) return makeRect(0, 0);
      // CSS: min-height wins over aspect-ratio.
      const cssMinHeight = parseFloat(el.style.minHeight || '0') || 0;
      const h = Math.max(w / layout.aspectRatio, cssMinHeight);
      return makeRect(w, h);
    }) as any;
});

afterEach(() => {
  cleanup();
  rectSpy?.mockRestore();
  rectSpy = null;
});

function makeRect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function Harness({
  aspectRatio,
  minHeight,
}: {
  aspectRatio: number;
  minHeight?: number;
}) {
  const { canvasRef, containerRef, size } = useResponsiveCanvas(
    aspectRatio,
    minHeight === undefined ? undefined : { minHeight },
  );
  return (
    <div
      ref={containerRef}
      data-testid="container"
      style={{ width: '100%', aspectRatio: String(aspectRatio) }}
    >
      <canvas ref={canvasRef} data-testid="canvas" />
      <div data-testid="reported">{`${size.width}x${size.height}`}</div>
    </div>
  );
}

function mount(aspectRatio: number, containerWidth: number, minHeight?: number) {
  layout.width = containerWidth;
  layout.aspectRatio = aspectRatio;
  const view = render(
    <Harness aspectRatio={aspectRatio} minHeight={minHeight} />,
  );
  const container = view.getByTestId('container') as HTMLDivElement;
  const canvas = view.getByTestId('canvas') as HTMLCanvasElement;
  return {
    container,
    canvas,
    containerHeight: container.getBoundingClientRect().height,
    containerWidth: container.getBoundingClientRect().width,
    canvasCssHeight: parseFloat(canvas.style.height),
    canvasCssWidth: parseFloat(canvas.style.width),
    reported: view.getByTestId('reported').textContent,
  };
}

// Representative of the real adopter set: 4/3 (BohrModel), 2 (CoulombsLaw,
// ConvexLens, ShadowFormation, WaveInterference, YoungDoubleSlitLab) and
// 560/200 = 2.8 (DopplerEffect, the widest / worst offender).
const ASPECT_RATIOS = [4 / 3, 2, 2.8];
// 280 = the old hard-coded width floor, 326 = real /stem-centre width on a
// 390px phone, 390 = phone viewport, 768 = tablet.
const CONTAINER_WIDTHS = [280, 326, 390, 768];

describe('useResponsiveCanvas — canvas never exceeds its container (P1C overlap fix)', () => {
  for (const ar of ASPECT_RATIOS) {
    for (const width of CONTAINER_WIDTHS) {
      it(`ar=${ar.toFixed(2)} width=${width}: canvas fits inside the container`, () => {
        const m = mount(ar, width);

        expect(m.canvasCssHeight).toBeGreaterThan(0);
        expect(m.canvasCssHeight).toBeLessThanOrEqual(m.containerHeight);
        expect(m.canvasCssWidth).toBeLessThanOrEqual(m.containerWidth);
      });
    }
  }

  it('the CONTAINER absorbs the minimum-height floor, not the canvas', () => {
    // 326 / 2.8 = 116.4 → well under the 200px floor. This is DopplerEffect on
    // a 390px phone: the exact case that used to overlap the controls.
    const m = mount(2.8, 326);

    expect(m.container.style.minHeight).toBe(`${DEFAULT_CANVAS_MIN_HEIGHT}px`);
    // The container GREW to the floor...
    expect(m.containerHeight).toBe(DEFAULT_CANVAS_MIN_HEIGHT);
    // ...and the canvas fills it exactly rather than spilling out of it.
    expect(m.canvasCssHeight).toBe(DEFAULT_CANVAS_MIN_HEIGHT);
  });

  it('does NOT force the floor onto a container that is already tall enough', () => {
    // 768 / 2 = 384 > 200, so min-height is set but never binds.
    const m = mount(2, 768);
    expect(m.containerHeight).toBe(384);
    expect(m.canvasCssHeight).toBe(384);
  });

  it('reproduces the pre-fix overflow arithmetic to prove the regression is real', () => {
    // Old hook: h = Math.max(Math.round(w / ar), 200) written to the canvas,
    // while the container stayed at w / ar.
    const w = 326;
    const ar = 2.8;
    const oldCanvasHeight = Math.max(Math.round(w / ar), 200);
    const oldContainerHeight = w / ar;
    expect(oldCanvasHeight).toBeGreaterThan(oldContainerHeight); // 200 > 116.4

    // New hook: no overflow.
    const m = mount(ar, w);
    expect(m.canvasCssHeight).toBeLessThanOrEqual(m.containerHeight);
  });

  it('reports the TRUE painted size so drawing code does not go off-canvas', () => {
    const m = mount(2.8, 326);
    // Painted box is 326x200 (floor applied by the container), and that is
    // exactly what `size` reports — not the 116px the aspect ratio implies.
    expect(m.reported).toBe('326x200');
    expect(m.canvasCssWidth).toBe(326);
    expect(m.canvasCssHeight).toBe(200);
  });

  it('honours an opt-in minHeight override without a new abstraction', () => {
    const m = mount(2.8, 326, 120);
    expect(m.container.style.minHeight).toBe('120px');
    // 326 / 2.8 = 116.43 → the 120px floor binds instead of the 200px default.
    expect(m.containerHeight).toBe(120);
    expect(m.canvasCssHeight).toBe(120);
  });

  it('scales the backing store by devicePixelRatio without changing the CSS box', () => {
    const original = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    });
    try {
      const m = mount(2, 768);
      expect(m.canvasCssWidth).toBe(768);
      expect(m.canvasCssHeight).toBe(384);
      expect(m.canvas.width).toBe(1536);
      expect(m.canvas.height).toBe(768);
      // Still inside the container.
      expect(m.canvasCssHeight).toBeLessThanOrEqual(m.containerHeight);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', {
        value: original,
        configurable: true,
      });
    }
  });

  it('skips sizing entirely when the container is not laid out (0x0)', () => {
    const m = mount(2, 0);
    // No imperative CSS written; the hook keeps its default reported size.
    expect(m.canvas.style.width).toBe('');
    expect(m.reported).toBe('600x400');
  });
});
