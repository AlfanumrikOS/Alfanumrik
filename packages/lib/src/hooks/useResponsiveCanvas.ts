import { useRef, useEffect, useState } from 'react';

interface CanvasSize {
  width: number;         // CSS pixel width the canvas is actually painted at
  height: number;        // CSS pixel height the canvas is actually painted at
  dpr: number;           // devicePixelRatio for sharp rendering
  canvasWidth: number;   // actual canvas backing-store pixel width (width * dpr)
  canvasHeight: number;  // actual canvas backing-store pixel height (height * dpr)
}

/** Minimum usable canvas box. Applied to the CONTAINER, never to the canvas. */
export const DEFAULT_CANVAS_MIN_HEIGHT = 200;
export const DEFAULT_CANVAS_MIN_WIDTH = 280;

export interface ResponsiveCanvasOptions {
  /** Floor for the container's height in CSS px. Pass 0 to disable. Default 200. */
  minHeight?: number;
  /** Floor for the container's width in CSS px. Pass 0 to disable. Default 280. */
  minWidth?: number;
}

/**
 * Makes a canvas responsive to its container size.
 *
 * Usage:
 *   const { canvasRef, containerRef, size } = useResponsiveCanvas(16 / 9);
 *
 *   <div ref={containerRef} className="w-full" style={{ aspectRatio: '16/9' }}>
 *     <canvas ref={canvasRef} style={{ display: 'block' }} />
 *   </div>
 *
 * The hook:
 * 1. Observes the container via ResizeObserver
 * 2. Applies the minimum-size floors to the CONTAINER (see below)
 * 3. Sizes the canvas to the container's MEASURED box — never larger
 * 4. Scales the backing store by devicePixelRatio for sharp rendering
 * 5. Returns the true painted CSS size for drawing calculations
 *
 * ── Why the floors live on the container (overlap bug, fixed 2026-08-24) ──
 *
 * The previous implementation derived the canvas height from the aspect ratio
 * and then clamped it upward:
 *
 *     h = Math.max(Math.round(w / aspectRatio), 200);
 *     canvas.style.height = `${h}px`;      // imperative, ignores the container
 *
 * Callers size the container with CSS `aspect-ratio`, so the container's height
 * is `w / aspectRatio`. Whenever `w < 200 * aspectRatio` the clamp made the
 * CANVAS taller than its own container. The containers carry no `overflow`
 * rule, so the canvas simply painted on top of the sibling controls below it.
 * On a 390px phone (~326px of container width in the /stem-centre chain) that
 * fired for 22 of the 25 adopters. `Math.max(w, 280)` was the horizontal twin
 * of the same defect.
 *
 * The floors are now set as CSS `min-height` / `min-width` on the CONTAINER.
 * `min-height` beats `aspect-ratio` in CSS, so a too-short container GROWS and
 * pushes the controls down instead of being painted over. The width floor uses
 * `min(<floor>px, 100%)` so it can never exceed the available width and cause
 * horizontal overflow inside nested padding (e.g. InlineSimulation).
 *
 * The reported `size` is the measured CSS box, not a clamped invention —
 * drawing code positions against `size.width`/`size.height`, so a size that
 * disagreed with the painted box would draw scenes off-canvas.
 */
export function useResponsiveCanvas(
  aspectRatio?: number,
  options?: ResponsiveCanvasOptions,
) {
  const minHeight = options?.minHeight ?? DEFAULT_CANVAS_MIN_HEIGHT;
  const minWidth = options?.minWidth ?? DEFAULT_CANVAS_MIN_WIDTH;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({
    width: 600,
    height: 400,
    dpr: 1,
    canvasWidth: 600,
    canvasHeight: 400,
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      // 1. Push the minimum-size floors onto the CONTAINER first, so that the
      //    measurement in step 2 already reflects them. CSS min-height wins
      //    over aspect-ratio: the container grows, the layout reflows, and the
      //    sibling controls move down instead of being covered.
      //    Written only when the value actually changes: this runs inside the
      //    ResizeObserver callback, and an unconditional write would re-dirty
      //    layout every tick ("ResizeObserver loop completed" warnings).
      const nextMinHeight = minHeight > 0 ? `${minHeight}px` : '';
      const nextMinWidth = minWidth > 0 ? `min(${minWidth}px, 100%)` : '';
      if (container.style.minHeight !== nextMinHeight) {
        container.style.minHeight = nextMinHeight;
      }
      if (container.style.minWidth !== nextMinWidth) {
        container.style.minWidth = nextMinWidth;
      }

      // 2. Measure. Take the SMALLER of the border box and the content box:
      //    clientWidth/Height excludes the border (so a bordered container
      //    doesn't get a canvas 2px too wide) but is integer-rounded, which can
      //    round UP past the real fractional box. `min` is safe under both.
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) return; // not laid out yet

      const clientW = container.clientWidth;
      const clientH = container.clientHeight;
      const boxW = clientW > 0 ? Math.min(clientW, rect.width) : rect.width;
      const boxH = clientH > 0 ? Math.min(clientH, rect.height) : rect.height;

      // 3. The canvas is exactly the container box, floored to whole CSS px so
      //    it can never round up past its container. Overflow is impossible by
      //    construction. The aspect ratio is only a fallback for containers
      //    that report no height at all.
      const w = Math.max(1, Math.floor(boxW));
      const h = Math.max(
        1,
        boxH > 0
          ? Math.floor(boxH)
          : aspectRatio
            ? Math.floor(w / aspectRatio)
            : minHeight,
      );

      const dpr = window.devicePixelRatio || 1;

      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      setSize((prev) =>
        prev.width === w && prev.height === h && prev.dpr === dpr
          ? prev
          : {
              width: w,
              height: h,
              dpr,
              canvasWidth: Math.round(w * dpr),
              canvasHeight: Math.round(h * dpr),
            },
      );
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    updateSize(); // initial sizing

    return () => observer.disconnect();
  }, [aspectRatio, minHeight, minWidth]);

  return { canvasRef, containerRef, size };
}
