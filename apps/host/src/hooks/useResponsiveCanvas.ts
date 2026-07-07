import { useRef, useEffect, useState } from 'react';

interface CanvasSize {
  width: number;         // CSS pixel width of container
  height: number;        // CSS pixel height of container
  dpr: number;           // devicePixelRatio for sharp rendering
  canvasWidth: number;   // actual canvas pixel width (width * dpr)
  canvasHeight: number;  // actual canvas pixel height (height * dpr)
}

/**
 * Makes a canvas responsive to its container size.
 *
 * Usage:
 *   const { canvasRef, containerRef, size } = useResponsiveCanvas();
 *
 *   <div ref={containerRef} style={{ width: '100%', aspectRatio: '16/9' }}>
 *     <canvas ref={canvasRef} />
 *   </div>
 *
 * The hook:
 * 1. Observes the container via ResizeObserver
 * 2. Sets canvas width/height to container size * devicePixelRatio (sharp rendering)
 * 3. Sets canvas CSS to fill container (no stretching artifacts)
 * 4. Returns current size for drawing calculations
 */
export function useResponsiveCanvas(aspectRatio?: number) {
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
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      let w = Math.round(rect.width);
      let h = aspectRatio
        ? Math.round(w / aspectRatio)
        : Math.round(rect.height);

      // Ensure minimum usable size
      w = Math.max(w, 280);
      h = Math.max(h, 200);

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      setSize({
        width: w,
        height: h,
        dpr,
        canvasWidth: w * dpr,
        canvasHeight: h * dpr,
      });
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    updateSize(); // initial sizing

    return () => observer.disconnect();
  }, [aspectRatio]);

  return { canvasRef, containerRef, size };
}