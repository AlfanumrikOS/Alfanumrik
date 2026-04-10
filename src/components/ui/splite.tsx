'use client';

import { Suspense, lazy } from 'react';

const Spline = lazy(() => import('@splinetool/react-spline'));

interface SplineSceneProps {
  scene: string;
  className?: string;
}

export function SplineScene({ scene, className }: SplineSceneProps) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <Spline scene={scene} className={className} />
    </Suspense>
  );
}
