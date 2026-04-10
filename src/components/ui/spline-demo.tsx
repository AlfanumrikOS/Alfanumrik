'use client';

/**
 * SplineSceneBasic — drop-in demo of the Spline 3D integration.
 *
 * Best placement options:
 *   - Hero section of the landing page (src/app/welcome/page.tsx)
 *   - A dedicated /demo page
 *   - The /product showcase page
 *
 * To use on the landing page, import and render:
 *   import { SplineSceneBasic } from '@/components/ui/spline-demo'
 *   <SplineSceneBasic />
 */

import { SplineScene } from '@/components/ui/splite';
import { Card } from '@/components/ui/card';
import { Spotlight } from '@/components/ui/spotlight';

export function SplineSceneBasic() {
  return (
    <Card className="w-full h-[500px] bg-black/[0.96] relative overflow-hidden border-0">
      {/* Animated spotlight beam */}
      <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="white" />

      <div className="flex h-full">
        {/* Left — text content */}
        <div className="flex-1 p-8 relative z-10 flex flex-col justify-center">
          <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400">
            Interactive 3D
          </h1>
          <p className="mt-4 text-neutral-300 max-w-lg text-sm leading-relaxed">
            Bring your UI to life with beautiful 3D scenes. Create immersive experiences
            that capture attention and enhance your design.
          </p>
        </div>

        {/* Right — Spline 3D scene */}
        <div className="flex-1 relative">
          <SplineScene
            scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
            className="w-full h-full"
          />
        </div>
      </div>
    </Card>
  );
}
