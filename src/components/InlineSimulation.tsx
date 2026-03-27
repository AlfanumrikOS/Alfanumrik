'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

/**
 * CONCEPT-TO-SIMULATION MAPPING
 *
 * Maps subject + topic keywords to built-in simulation IDs.
 * When a student is learning a concept, the matching simulation
 * appears inline — no need to navigate to a separate page.
 */

const SIMULATION_MAP: Record<string, { id: string; title: string; emoji: string; tip: string }> = {
  // Physics
  'ohm|resistance|current|voltage|circuit': {
    id: 'builtin-ohms-law', title: "Ohm's Law Circuit Lab", emoji: '⚡',
    tip: 'Try changing the resistance and see how current changes!',
  },
  'pendulum|oscillation|shm|simple harmonic': {
    id: 'builtin-pendulum', title: 'Pendulum Physics Lab', emoji: '🕐',
    tip: 'Change the length and observe how the period changes.',
  },
  'lens|mirror|refraction|ray diagram|image formation': {
    id: 'builtin-lens-ray', title: 'Lens & Mirror Ray Diagrams', emoji: '🔍',
    tip: 'Move the object and see where the image forms.',
  },
  'wave|frequency|amplitude|wavelength|transverse': {
    id: 'builtin-wave', title: 'Wave on a String', emoji: '🌊',
    tip: 'Change frequency and amplitude to see the wave change.',
  },
  'projectile|trajectory|parabola|range|kinematics': {
    id: 'builtin-projectile', title: 'Projectile Motion', emoji: '🚀',
    tip: 'Try different angles — which gives maximum range?',
  },
  // Chemistry
  'ph|acid|base|indicator|litmus|neutral': {
    id: 'builtin-ph-scale', title: 'pH Scale Explorer', emoji: '🧪',
    tip: 'Drag substances onto the scale to see their pH values.',
  },
  // Math
  'pythagoras|hypotenuse|right triangle|right angle triangle': {
    id: 'builtin-pythagoras', title: 'Pythagoras Theorem Explorer', emoji: '📐',
    tip: 'Drag the corners to see a² + b² = c² in action.',
  },
  'fraction|numerator|denominator|pizza': {
    id: 'builtin-fractions', title: 'Pizza Fraction Lab', emoji: '🍕',
    tip: 'Cut the pizza to understand fractions visually!',
  },
  'trigonometry|sin|cos|tan|unit circle|sine|cosine|tangent': {
    id: 'builtin-trig-circle', title: 'Trigonometry Circle Lab', emoji: '🔄',
    tip: 'Drag the point around the circle and watch sin, cos, tan change!',
  },
};

// Lazy-load simulation components — each imported directly from its file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMPONENTS: Record<string, any> = {
  'builtin-ohms-law': dynamic(() => import('@/components/simulations/OhmsLaw'), { ssr: false }),
  'builtin-pendulum': dynamic(() => import('@/components/simulations/PendulumLab'), { ssr: false }),
  'builtin-lens-ray': dynamic(() => import('@/components/simulations/LensRayDiagram'), { ssr: false }),
  'builtin-wave': dynamic(() => import('@/components/simulations/WaveOnString'), { ssr: false }),
  'builtin-projectile': dynamic(() => import('@/components/simulations/ProjectileMotion'), { ssr: false }),
  'builtin-ph-scale': dynamic(() => import('@/components/simulations/PHScale'), { ssr: false }),
  'builtin-pythagoras': dynamic(() => import('@/components/simulations/PythagorasTheorem'), { ssr: false }),
  'builtin-fractions': dynamic(() => import('@/components/simulations/FractionVisualizer'), { ssr: false }),
  'builtin-trig-circle': dynamic(() => import('@/components/simulations/TrigCircle'), { ssr: false }),
};

/** Find a matching simulation for a given topic/concept text */
export function findSimulation(text: string): { id: string; title: string; emoji: string; tip: string } | null {
  const lower = text.toLowerCase();
  for (const [keywords, sim] of Object.entries(SIMULATION_MAP)) {
    const parts = keywords.split('|');
    if (parts.some(kw => lower.includes(kw))) {
      return sim;
    }
  }
  return null;
}

interface InlineSimulationProps {
  simulationId: string;
  title: string;
  emoji: string;
  tip: string;
  color?: string;
}

/**
 * InlineSimulation — renders a simulation inline within concept flow.
 * Collapsible by default to keep concept text primary.
 * Expands to show interactive simulation with guided prompt.
 */
export function InlineSimulation({ simulationId, title, emoji, tip, color = '#0891B2' }: InlineSimulationProps) {
  const [open, setOpen] = useState(false);
  const SimComponent = COMPONENTS[simulationId];

  if (!SimComponent) return null;

  return (
    <div className="my-4 rounded-2xl overflow-hidden" style={{ border: `1px solid ${color}25`, background: `${color}04` }}>
      {/* Collapsed header — tap to expand */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all active:scale-[0.99]"
      >
        <span className="text-xl">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold" style={{ color }}>
            {open ? '▼' : '▶'} Try it: {title}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {open ? 'Tap to close' : 'Tap to explore this concept interactively'}
          </div>
        </div>
        <span className="text-lg">{open ? '▲' : '🔬'}</span>
      </button>

      {/* Expanded simulation */}
      {open && (
        <div className="border-t" style={{ borderColor: `${color}15` }}>
          {/* Guided prompt */}
          <div className="px-4 py-2 text-xs" style={{ background: `${color}08`, color }}>
            💡 {tip}
          </div>

          {/* Simulation component */}
          <div className="p-3" style={{ minHeight: 300, maxHeight: 500 }}>
            <SimComponent />
          </div>

          {/* Takeaway prompt */}
          <div className="px-4 py-2 text-[10px] text-center" style={{ color: 'var(--text-3)', borderTop: `1px solid ${color}10` }}>
            What did you notice? Ask Foxy to explain what you observed.
          </div>
        </div>
      )}
    </div>
  );
}
