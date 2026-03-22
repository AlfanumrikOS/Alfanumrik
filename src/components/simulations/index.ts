'use client';

import dynamic from 'next/dynamic';

export interface BuiltInSimulation {
  id: string;
  title: string;
  description: string;
  subject: string;
  grade: string[];
  thumbnailEmoji: string;
  difficulty: number;
  bloomLevel: string;
  estimatedTimeMinutes: number;
  conceptTags: string[];
  foxyTip: string;
  component: React.ComponentType;
}

const OhmsLaw = dynamic(() => import('./OhmsLaw'), { ssr: false });
const PendulumLab = dynamic(() => import('./PendulumLab'), { ssr: false });
const LensRayDiagram = dynamic(() => import('./LensRayDiagram'), { ssr: false });
const WaveOnString = dynamic(() => import('./WaveOnString'), { ssr: false });
const ProjectileMotion = dynamic(() => import('./ProjectileMotion'), { ssr: false });
const PHScale = dynamic(() => import('./PHScale'), { ssr: false });
const PythagorasTheorem = dynamic(() => import('./PythagorasTheorem'), { ssr: false });
const FractionVisualizer = dynamic(() => import('./FractionVisualizer'), { ssr: false });

export const BUILT_IN_SIMULATIONS: BuiltInSimulation[] = [
  {
    id: 'builtin-ohms-law',
    title: "Ohm's Law Circuit Lab",
    description: 'Build a circuit and watch electrons flow! Change voltage and resistance to see how current changes in real-time.',
    subject: 'physics',
    grade: ['10', '11', '12'],
    thumbnailEmoji: '⚡',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 8,
    conceptTags: ['Electricity', "Ohm's Law", 'Current', 'Voltage', 'Resistance'],
    foxyTip: 'Try setting resistance very low — what happens to the current? This is why short circuits are dangerous!',
    component: OhmsLaw,
  },
  {
    id: 'builtin-pendulum',
    title: 'Pendulum Physics Lab',
    description: 'Swing a pendulum and discover what controls its period. Change gravity, length, and angle — which one matters most?',
    subject: 'physics',
    grade: ['9', '10', '11'],
    thumbnailEmoji: '🕐',
    difficulty: 2,
    bloomLevel: 'analyze',
    estimatedTimeMinutes: 10,
    conceptTags: ['Oscillation', 'Pendulum', 'Period', 'Gravity', 'SHM'],
    foxyTip: 'Does changing the angle change the period? Try it! The answer might surprise you for small angles.',
    component: PendulumLab,
  },
  {
    id: 'builtin-lens-ray',
    title: 'Lens & Mirror Ray Diagrams',
    description: 'Drag an object near a lens and watch the image form! See exactly how light bends through convex and concave lenses.',
    subject: 'physics',
    grade: ['10', '11', '12'],
    thumbnailEmoji: '🔍',
    difficulty: 3,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 12,
    conceptTags: ['Light', 'Refraction', 'Lens', 'Image Formation', 'Ray Diagram'],
    foxyTip: 'Move the object between F and 2F — this is the most asked case in board exams! Note if image is real or virtual.',
    component: LensRayDiagram,
  },
  {
    id: 'builtin-wave',
    title: 'Wave on a String',
    description: 'Create waves and see how frequency, amplitude, and speed are connected. Toggle standing waves to see nodes glow!',
    subject: 'physics',
    grade: ['9', '10', '11'],
    thumbnailEmoji: '🌊',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Waves', 'Frequency', 'Amplitude', 'Wavelength', 'Standing Waves'],
    foxyTip: 'Watch the particles — they move up and down, not sideways! That\'s what makes it a transverse wave.',
    component: WaveOnString,
  },
  {
    id: 'builtin-projectile',
    title: 'Projectile Motion Launcher',
    description: 'Launch projectiles at different angles and speeds! Discover which angle gives maximum range and trace beautiful parabolas.',
    subject: 'physics',
    grade: ['11', '12'],
    thumbnailEmoji: '🚀',
    difficulty: 3,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Projectile', 'Kinematics', 'Parabola', 'Range', 'Trajectory'],
    foxyTip: 'Try 45° for maximum range! Then try 30° and 60° — notice anything special about their ranges?',
    component: ProjectileMotion,
  },
  {
    id: 'builtin-ph-scale',
    title: 'pH Scale Explorer',
    description: 'Click everyday substances and watch the pH meter react! See litmus paper change color and learn acids from bases.',
    subject: 'chemistry',
    grade: ['7', '8', '9', '10'],
    thumbnailEmoji: '🧪',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 6,
    conceptTags: ['pH', 'Acids', 'Bases', 'Indicators', 'Litmus'],
    foxyTip: 'Your stomach acid has pH ~1.5! How does your body handle something so acidic?',
    component: PHScale,
  },
  {
    id: 'builtin-pythagoras',
    title: 'Pythagoras Theorem Explorer',
    description: 'Drag the triangle corners and watch the squares on each side change. See a² + b² = c² come alive!',
    subject: 'math',
    grade: ['8', '9', '10'],
    thumbnailEmoji: '📐',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Pythagoras', 'Right Triangle', 'Geometry', 'Proof'],
    foxyTip: 'Try the 3-4-5 triangle — the simplest Pythagorean triple! Can you find others?',
    component: PythagorasTheorem,
  },
  {
    id: 'builtin-fractions',
    title: 'Pizza Fraction Lab',
    description: 'Slice pizzas into fractions! Compare halves, thirds, and quarters visually. Finally understand why 1/3 + 1/4 is not 2/7!',
    subject: 'math',
    grade: ['5', '6', '7', '8'],
    thumbnailEmoji: '🍕',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 7,
    conceptTags: ['Fractions', 'Comparison', 'Addition', 'Visualization'],
    foxyTip: 'Which is bigger: 3/4 or 5/8? Use the compare mode to find out visually!',
    component: FractionVisualizer,
  },
];
