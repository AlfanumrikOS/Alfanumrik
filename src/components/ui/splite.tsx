'use client';
import { Suspense, lazy } from 'react';

const Spline = lazy(() => import('@splinetool/react-spline'));

interface SplineSceneProps {
  scene: string;
  className?: string;
}

/**
 * Lazily loads a Spline 3D scene with a spinner fallback.
 * Uses Suspense so the rest of the page renders immediately.
 *
 * Usage:
 *   <SplineScene scene="https://prod.spline.design/xxx/scene.splinecode" className="w-full h-full" />
 */
export function SplineScene({ scene, className }: SplineSceneProps) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center">
          {/* Tailwind-only loading ring — no external CSS dependency */}
          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <Spline scene={scene} className={className} />
    </Suspense>
  );
}
