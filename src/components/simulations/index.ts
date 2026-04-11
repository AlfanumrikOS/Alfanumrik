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
const TrigCircle = dynamic(() => import('./TrigCircle'), { ssr: false });
const NewtonLaws = dynamic(() => import('./NewtonLaws'), { ssr: false });
const BohrModel = dynamic(() => import('./BohrModel'), { ssr: false });
const QuadraticGraph = dynamic(() => import('./QuadraticGraph'), { ssr: false });
const HookesLaw = dynamic(() => import('./HookesLaw'), { ssr: false });
const LinearGraph = dynamic(() => import('./LinearGraph'), { ssr: false });
const ChemicalBalancer = dynamic(() => import('./ChemicalBalancer'), { ssr: false });
const GasLaws = dynamic(() => import('./GasLaws'), { ssr: false });
const ProbabilityLab = dynamic(() => import('./ProbabilityLab'), { ssr: false });
const SnellsLaw = dynamic(() => import('./SnellsLaw'), { ssr: false });
const IntegrationVisualizer = dynamic(() => import('./IntegrationVisualizer'), { ssr: false });
const SymmetryExplorer = dynamic(() => import('./SymmetryExplorer'), { ssr: false });
const AngleExplorer = dynamic(() => import('./AngleExplorer'), { ssr: false });
const BarGraphMaker = dynamic(() => import('./BarGraphMaker'), { ssr: false });
const PhotosynthesisLab = dynamic(() => import('./PhotosynthesisLab'), { ssr: false });
const HumanHeartLab = dynamic(() => import('./HumanHeartLab'), { ssr: false });
const ElectricCircuitBasic = dynamic(() => import('./ElectricCircuitBasic'), { ssr: false });
const MagnetFieldLines = dynamic(() => import('./MagnetFieldLines'), { ssr: false });
const LightReflection = dynamic(() => import('./LightReflection'), { ssr: false });
const CellStructure = dynamic(() => import('./CellStructure'), { ssr: false });
const AcidBaseIndicator = dynamic(() => import('./AcidBaseIndicator'), { ssr: false });
const RefractionLab = dynamic(() => import('./RefractionLab'), { ssr: false });
const RespirationLab = dynamic(() => import('./RespirationLab'), { ssr: false });
const MagneticFieldElectric = dynamic(() => import('./MagneticFieldElectric'), { ssr: false });
const MeterBridgeLab = dynamic(() => import('./MeterBridgeLab'), { ssr: false });
const ConvexLensLab = dynamic(() => import('./ConvexLensLab'), { ssr: false });
const PotentiometerLab = dynamic(() => import('./PotentiometerLab'), { ssr: false });
const MitosisLab = dynamic(() => import('./MitosisLab'), { ssr: false });
const PunnettSquareLab = dynamic(() => import('./PunnettSquareLab'), { ssr: false });
const DNAReplicationLab = dynamic(() => import('./DNAReplicationLab'), { ssr: false });
const AcidBaseTitration = dynamic(() => import('./AcidBaseTitration'), { ssr: false });
const ElectronConfiguration = dynamic(() => import('./ElectronConfiguration'), { ssr: false });
const StatesOfMatter = dynamic(() => import('./StatesOfMatter'), { ssr: false });
const ElectrochemicalCell = dynamic(() => import('./ElectrochemicalCell'), { ssr: false });
const VectorAddition = dynamic(() => import('./VectorAddition'), { ssr: false });
const SetTheoryVenn = dynamic(() => import('./SetTheoryVenn'), { ssr: false });
const StatisticsLab = dynamic(() => import('./StatisticsLab'), { ssr: false });
const CircuitBuilder = dynamic(() => import('./CircuitBuilder'), { ssr: false });
const MagneticField = dynamic(() => import('./MagneticField'), { ssr: false });
const WaveInterference = dynamic(() => import('./WaveInterference'), { ssr: false });
const CoulombsLaw = dynamic(() => import('./CoulombsLaw'), { ssr: false });
const SoundWaves = dynamic(() => import('./SoundWaves'), { ssr: false });

// ── 65 new simulations ────────────────────────────────────────────────────
// Physics 6-8
const SimpleMachines = dynamic(() => import('./SimpleMachines'), { ssr: false });
const MirrorReflection = dynamic(() => import('./MirrorReflection'), { ssr: false });
const ElectricCharge = dynamic(() => import('./ElectricCharge'), { ssr: false });
const HeatTransfer = dynamic(() => import('./HeatTransfer'), { ssr: false });
const SpeedDistanceTime = dynamic(() => import('./SpeedDistanceTime'), { ssr: false });
const LightRefraction = dynamic(() => import('./LightRefraction'), { ssr: false });
const SolarSystem = dynamic(() => import('./SolarSystem'), { ssr: false });
const WeatherCycle = dynamic(() => import('./WeatherCycle'), { ssr: false });
const EchoAndSound = dynamic(() => import('./EchoAndSound'), { ssr: false });
const ShadowFormation = dynamic(() => import('./ShadowFormation'), { ssr: false });
// Physics 9-12
const ElectricMotor = dynamic(() => import('./ElectricMotor'), { ssr: false });
const Transformer = dynamic(() => import('./Transformer'), { ssr: false });
const ResistorsInSeries = dynamic(() => import('./ResistorsInSeries'), { ssr: false });
const ConcaveMirrorLab = dynamic(() => import('./ConcaveMirrorLab'), { ssr: false });
const ConvexLens = dynamic(() => import('./ConvexLens'), { ssr: false });
const FreeBodyDiagram = dynamic(() => import('./FreeBodyDiagram'), { ssr: false });
const ArchimedesPrinciple = dynamic(() => import('./ArchimedesPrinciple'), { ssr: false });
const ElectromagneticSpectrum = dynamic(() => import('./ElectromagneticSpectrum'), { ssr: false });
const CapacitorCharging = dynamic(() => import('./CapacitorCharging'), { ssr: false });
const DopplerEffect = dynamic(() => import('./DopplerEffect'), { ssr: false });
const YoungDoubleSlitLab = dynamic(() => import('./YoungDoubleSlitLab'), { ssr: false });
const NuclearDecay = dynamic(() => import('./NuclearDecay'), { ssr: false });
const PhotoelectricEffect = dynamic(() => import('./PhotoelectricEffect'), { ssr: false });
// Chemistry 6-8
const ElementClassifier = dynamic(() => import('./ElementClassifier'), { ssr: false });
const MixturesSeparation = dynamic(() => import('./MixturesSeparation'), { ssr: false });
const WaterElectrolysis = dynamic(() => import('./WaterElectrolysis'), { ssr: false });
const LitmusTest = dynamic(() => import('./LitmusTest'), { ssr: false });
const AtomBuilder = dynamic(() => import('./AtomBuilder'), { ssr: false });
const PeriodicTrends = dynamic(() => import('./PeriodicTrends'), { ssr: false });
const CrystallizationLab = dynamic(() => import('./CrystallizationLab'), { ssr: false });
const RustingExperiment = dynamic(() => import('./RustingExperiment'), { ssr: false });
// Chemistry 9-10
const MolarityCalculator = dynamic(() => import('./MolarityCalculator'), { ssr: false });
const ExothermicEndothermic = dynamic(() => import('./ExothermicEndothermic'), { ssr: false });
const IonicCovalentBonds = dynamic(() => import('./IonicCovalentBonds'), { ssr: false });
const MetalReactivitySeries = dynamic(() => import('./MetalReactivitySeries'), { ssr: false });
const CarbonAllotropes = dynamic(() => import('./CarbonAllotropes'), { ssr: false });
// Chemistry 11-12
const ChemicalKinetics = dynamic(() => import('./ChemicalKinetics'), { ssr: false });
const BufferSolution = dynamic(() => import('./BufferSolution'), { ssr: false });
const GalvanicCell = dynamic(() => import('./GalvanicCell'), { ssr: false });
const MolecularGeometry = dynamic(() => import('./MolecularGeometry'), { ssr: false });
// Biology 6-8
const FoodWeb = dynamic(() => import('./FoodWeb'), { ssr: false });
const HumanDigestiveSystem = dynamic(() => import('./HumanDigestiveSystem'), { ssr: false });
const PlantParts = dynamic(() => import('./PlantParts'), { ssr: false });
const AlveoliBreathingLab = dynamic(() => import('./AlveoliBreathingLab'), { ssr: false });
const SeedGermination = dynamic(() => import('./SeedGermination'), { ssr: false });
const AnimalClassification = dynamic(() => import('./AnimalClassification'), { ssr: false });
const WaterPurification = dynamic(() => import('./WaterPurification'), { ssr: false });
// Biology 9-10
const HeartCirculation = dynamic(() => import('./HeartCirculation'), { ssr: false });
const NervousSystem = dynamic(() => import('./NervousSystem'), { ssr: false });
const MeiosisStages = dynamic(() => import('./MeiosisStages'), { ssr: false });
const EcosystemBalance = dynamic(() => import('./EcosystemBalance'), { ssr: false });
const EvolutionTree = dynamic(() => import('./EvolutionTree'), { ssr: false });
// Biology 11-12
const ProteinSynthesis = dynamic(() => import('./ProteinSynthesis'), { ssr: false });
const HormoneRegulation = dynamic(() => import('./HormoneRegulation'), { ssr: false });
const GeneExpression = dynamic(() => import('./GeneExpression'), { ssr: false });
// Math 6-8
const FractionOperations = dynamic(() => import('./FractionOperations'), { ssr: false });
const AreaPerimeter = dynamic(() => import('./AreaPerimeter'), { ssr: false });
const NumberLine = dynamic(() => import('./NumberLine'), { ssr: false });
const SymmetryLinesLab = dynamic(() => import('./SymmetryLinesLab'), { ssr: false });
const DataHandling = dynamic(() => import('./DataHandling'), { ssr: false });
// Math 9-10
const CoordinateGeometry = dynamic(() => import('./CoordinateGeometry'), { ssr: false });
const SurfaceAreaVolume = dynamic(() => import('./SurfaceAreaVolume'), { ssr: false });
const CircleTheorems = dynamic(() => import('./CircleTheorems'), { ssr: false });
// Math 11-12
const LimitsVisualizer = dynamic(() => import('./LimitsVisualizer'), { ssr: false });
const MatrixOperations = dynamic(() => import('./MatrixOperations'), { ssr: false });

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
    grade: ['6', '7', '8'],
    thumbnailEmoji: '🍕',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 7,
    conceptTags: ['Fractions', 'Comparison', 'Addition', 'Visualization'],
    foxyTip: 'Which is bigger: 3/4 or 5/8? Use the compare mode to find out visually!',
    component: FractionVisualizer,
  },
  {
    id: 'builtin-trig-circle',
    title: 'Trigonometry Circle Lab',
    description: 'Explore sin, cos, and tan on the unit circle. See how angles create waves.',
    subject: 'math',
    grade: ['9', '10', '11', '12'],
    thumbnailEmoji: '🔄',
    difficulty: 3,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 10,
    conceptTags: ['Trigonometry', 'Unit Circle', 'Sin', 'Cos', 'Tan', 'Angles', 'Waves'],
    foxyTip: 'Drag the point around the circle and watch how sin and cos change. What happens at 90°?',
    component: TrigCircle,
  },
  {
    id: 'builtin-newton-laws',
    title: "Newton's Laws — Force & Motion",
    description: 'Push a block with different forces and masses. See F = ma in action with free body diagrams and real-time acceleration.',
    subject: 'physics',
    grade: ['9', '10', '11'],
    thumbnailEmoji: '🧱',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Force', "Newton's Laws", 'Acceleration', 'Friction', 'F=ma'],
    foxyTip: 'Double the force with the same mass — what happens to acceleration? Now double the mass instead!',
    component: NewtonLaws,
  },
  {
    id: 'builtin-bohr-model',
    title: 'Bohr Atomic Model',
    description: 'Explore the electron configuration of the first 20 elements. Watch electrons orbit in shells and learn valence, valency, and element types.',
    subject: 'chemistry',
    grade: ['9', '10', '11'],
    thumbnailEmoji: '⚛️',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Atom', 'Bohr Model', 'Electron Configuration', 'Shells', 'Valence'],
    foxyTip: 'Compare Na and Cl — why do they form NaCl? Look at their valence electrons!',
    component: BohrModel,
  },
  {
    id: 'builtin-quadratic-graph',
    title: 'Quadratic Equation Grapher',
    description: 'Graph y = ax² + bx + c and see roots, vertex, and discriminant change as you adjust coefficients.',
    subject: 'math',
    grade: ['9', '10', '11'],
    thumbnailEmoji: '📈',
    difficulty: 2,
    bloomLevel: 'analyze',
    estimatedTimeMinutes: 10,
    conceptTags: ['Quadratic', 'Parabola', 'Roots', 'Vertex', 'Discriminant'],
    foxyTip: 'Set a=1, b=0, c=1 — no real roots! The parabola doesn\'t touch the x-axis. What does the discriminant show?',
    component: QuadraticGraph,
  },
  {
    id: 'builtin-hookes-law',
    title: "Hooke's Law Spring Lab",
    description: 'Hang masses from a spring and watch it stretch. See F = kx on a live graph, then trigger oscillations!',
    subject: 'physics',
    grade: ['9', '10', '11'],
    thumbnailEmoji: '🔩',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 8,
    conceptTags: ["Hooke's Law", 'Spring', 'Elasticity', 'SHM', 'Energy'],
    foxyTip: 'Increase k (stiffer spring) and watch the oscillation period decrease. Why?',
    component: HookesLaw,
  },
  {
    id: 'builtin-linear-graph',
    title: 'Linear Equation Grapher',
    description: 'Graph y = mx + c and visualise slope, intercepts, and angle. Compare two lines to find intersections or check if they are parallel!',
    subject: 'math',
    grade: ['8', '9', '10'],
    thumbnailEmoji: '📊',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Linear Equation', 'Slope', 'Intercept', 'Coordinate Geometry', 'Parallel Lines'],
    foxyTip: 'Two lines with the same slope never meet — they are parallel! What if their product of slopes is -1?',
    component: LinearGraph,
  },
  {
    id: 'builtin-chemical-balancer',
    title: 'Chemical Equation Balancer',
    description: 'Balance chemical equations by adjusting coefficients! Watch atoms count in real-time and discover the Law of Conservation of Mass.',
    subject: 'chemistry',
    grade: ['10'],
    thumbnailEmoji: '⚗️',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 8,
    conceptTags: ['Chemical Equations', 'Balancing', 'Conservation of Mass', 'Reactions', 'Stoichiometry'],
    foxyTip: 'Start by balancing the atom that appears in the fewest compounds. Save oxygen for last!',
    component: ChemicalBalancer,
  },
  {
    id: 'builtin-gas-laws',
    title: 'Gas Laws Lab (PV = nRT)',
    description: 'Explore Boyle\'s and Charles\'s Laws! Change pressure, volume, and temperature to see gas particles respond in real-time.',
    subject: 'chemistry',
    grade: ['11'],
    thumbnailEmoji: '🧪',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Gas Laws', 'Boyle\'s Law', 'Charles\'s Law', 'PV=nRT', 'Ideal Gas', 'States of Matter'],
    foxyTip: 'In Boyle\'s mode, halve the volume and watch pressure double! That\'s PV = constant.',
    component: GasLaws,
  },
  {
    id: 'builtin-probability-lab',
    title: 'Probability Experiment Lab',
    description: 'Flip coins, roll dice, and discover the Law of Large Numbers! Watch experimental probability converge to theoretical as you increase trials.',
    subject: 'math',
    grade: ['10', '11'],
    thumbnailEmoji: '🎲',
    difficulty: 1,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 8,
    conceptTags: ['Probability', 'Random Experiment', 'Law of Large Numbers', 'Theoretical Probability', 'Experimental Probability'],
    foxyTip: 'Roll 1000 dice and watch each number approach 16.7% — that\'s the Law of Large Numbers!',
    component: ProbabilityLab,
  },
  {
    id: 'builtin-snells-law',
    title: 'Snell\'s Law — Refraction of Light',
    description: 'Bend light through different media! Change the angle and materials to discover Snell\'s Law and total internal reflection.',
    subject: 'physics',
    grade: ['10', '12'],
    thumbnailEmoji: '💎',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 8,
    conceptTags: ['Refraction', 'Snell\'s Law', 'Total Internal Reflection', 'Refractive Index', 'Critical Angle', 'Light'],
    foxyTip: 'Set medium 1 to glass and medium 2 to air, then increase the angle past the critical angle to see total internal reflection!',
    component: SnellsLaw,
  },
  {
    id: 'builtin-integration',
    title: 'Integration Visualizer',
    description: 'See how rectangles approximate the area under a curve! Increase rectangles to watch the Riemann sum converge to the exact integral.',
    subject: 'math',
    grade: ['12'],
    thumbnailEmoji: '∫',
    difficulty: 3,
    bloomLevel: 'analyze',
    estimatedTimeMinutes: 10,
    conceptTags: ['Integration', 'Definite Integral', 'Riemann Sum', 'Area Under Curve', 'Calculus'],
    foxyTip: 'Start with 5 rectangles, then slide to 100. Watch the error shrink — that\'s why we use integration!',
    component: IntegrationVisualizer,
  },
  {
    id: 'builtin-symmetry-explorer',
    title: 'Symmetry Explorer',
    description: 'Pick a shape and discover its lines of symmetry! Rotate it to see rotational symmetry in action — how many times does it map onto itself?',
    subject: 'math',
    grade: ['6', '7'],
    thumbnailEmoji: '🔷',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 7,
    conceptTags: ['Symmetry', 'Lines of Symmetry', 'Rotational Symmetry', 'Regular Polygons', 'Geometry'],
    foxyTip: 'A regular polygon with n sides always has exactly n lines of symmetry. Try the hexagon — it has 6!',
    component: SymmetryExplorer,
  },
  {
    id: 'builtin-angle-explorer',
    title: 'Angle Explorer',
    description: 'Drag a ray to make any angle! See it measured live with a protractor overlay, colour-coded by type — acute, right, obtuse, straight, or reflex.',
    subject: 'math',
    grade: ['6', '7'],
    thumbnailEmoji: '📐',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 7,
    conceptTags: ['Angles', 'Protractor', 'Acute', 'Right Angle', 'Obtuse', 'Reflex', 'Complementary', 'Supplementary'],
    foxyTip: 'Set the angle to 60° — its complementary angle is 30° and supplementary is 120°. They always add up to 90° and 180°!',
    component: AngleExplorer,
  },
  {
    id: 'builtin-bar-graph-maker',
    title: 'Bar Graph Maker',
    description: 'Enter your own data and watch a bar chart build in real time! Calculate mean, mode, and range, or switch to a fun pictograph view.',
    subject: 'math',
    grade: ['6', '7', '8'],
    thumbnailEmoji: '📊',
    difficulty: 1,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 8,
    conceptTags: ['Data Handling', 'Bar Graph', 'Pictograph', 'Mean', 'Mode', 'Range', 'Statistics'],
    foxyTip: 'Try the Cricket Scores preset — notice how two matches have the same score? That\'s the mode! Now change one value to something huge and watch the mean jump.',
    component: BarGraphMaker,
  },
  {
    id: 'builtin-photosynthesis',
    title: 'Photosynthesis Lab',
    description: 'Explore how light, CO\u2082, and water drive photosynthesis! Adjust each factor and watch glucose production and O\u2082 release change in real time.',
    subject: 'biology',
    grade: ['7', '8', '9', '10'],
    thumbnailEmoji: '\uD83C\uDF31',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 10,
    conceptTags: ['Photosynthesis', 'Chlorophyll', 'Glucose', 'Light Reaction', 'Stomata', 'Life Processes'],
    foxyTip: 'Set light to 100% but CO\u2082 to 10% — the rate is limited by CO\u2082! This is Liebig\'s Law of the Minimum.',
    component: PhotosynthesisLab,
  },
  {
    id: 'builtin-human-heart',
    title: 'Human Heart & Double Circulation',
    description: 'Watch blood flow through all four chambers of the heart! See the heartbeat cycle, valve action, and understand why we have double circulation.',
    subject: 'biology',
    grade: ['10', '11', '12'],
    thumbnailEmoji: '\u2764\uFE0F',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 12,
    conceptTags: ['Heart', 'Double Circulation', 'Pulmonary', 'Systemic', 'Valves', 'Life Processes'],
    foxyTip: 'Increase the heart rate to 120 BPM and watch the blood particles speed up. Why does your heart beat faster during exercise?',
    component: HumanHeartLab,
  },
  {
    id: 'builtin-electric-circuit-basic',
    title: 'Electric Circuit Builder',
    description: 'Build a simple circuit with a battery, bulbs, and switch! Toggle the switch ON/OFF and compare series vs parallel circuits.',
    subject: 'physics',
    grade: ['6', '7', '8'],
    thumbnailEmoji: '💡',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Electricity', 'Circuit', 'Series', 'Parallel', 'Current', 'Switch'],
    foxyTip: 'In a series circuit, if one bulb breaks both go off. In parallel, the other stays on — that\'s how your home wiring works!',
    component: ElectricCircuitBasic,
  },
  {
    id: 'builtin-magnet-field-lines',
    title: 'Magnetic Field Lines',
    description: 'See field lines flow from North to South! Drag a compass around the magnet and watch the needle align. Try attract vs repel modes.',
    subject: 'physics',
    grade: ['6', '7', '8'],
    thumbnailEmoji: '🧲',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Magnets', 'Magnetic Field', 'Field Lines', 'Compass', 'Poles', 'Attraction', 'Repulsion'],
    foxyTip: 'Drag the compass between two repelling magnets — can you find the neutral point where the field nearly cancels out?',
    component: MagnetFieldLines,
  },
  {
    id: 'builtin-light-reflection',
    title: 'Light Reflection Lab',
    description: 'Shine a ray on a mirror and discover the Law of Reflection! Drag the angle and see how angle i always equals angle r.',
    subject: 'physics',
    grade: ['6', '7', '8'],
    thumbnailEmoji: '🪞',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 7,
    conceptTags: ['Light', 'Reflection', 'Mirror', 'Angle of Incidence', 'Normal', 'Plane Mirror', 'Concave', 'Convex'],
    foxyTip: 'With a plane mirror, angle i ALWAYS equals angle r — no matter what angle you try. That\'s the Law of Reflection!',
    component: LightReflection,
  },
  {
    id: 'builtin-cell-structure',
    title: 'Cell Structure Explorer',
    description: 'Explore animal and plant cells! Click on each organelle to learn its function. Compare what plant cells have that animal cells don\'t.',
    subject: 'biology',
    grade: ['6', '7', '8'],
    thumbnailEmoji: '🔬',
    difficulty: 1,
    bloomLevel: 'remember',
    estimatedTimeMinutes: 10,
    conceptTags: ['Cell', 'Nucleus', 'Mitochondria', 'Chloroplast', 'Cell Wall', 'Organelles', 'Plant Cell', 'Animal Cell'],
    foxyTip: 'Plant cells have 3 things animal cells don\'t: a rigid cell wall, green chloroplasts, and one giant central vacuole. Can you spot them all?',
    component: CellStructure,
  },
  {
    id: 'builtin-acid-base-indicator',
    title: 'Acid-Base Indicator Lab',
    description: 'Test 6 solutions with 4 indicators and observe colour changes! Auto-fill a data table and discover how different indicators classify acids and bases.',
    subject: 'chemistry',
    grade: ['9', '10'],
    thumbnailEmoji: '\uD83E\uDDEA',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Acids', 'Bases', 'Indicators', 'Litmus', 'Phenolphthalein', 'Methyl Orange', 'pH', 'Classification'],
    foxyTip: 'Phenolphthalein stays colourless in acid but turns pink in base — this makes it perfect for detecting bases! Why does it not work for acids?',
    component: AcidBaseIndicator,
  },
  {
    id: 'builtin-refraction-lab',
    title: 'Refraction Through Glass Slab & Prism',
    description: 'Watch light bend through a glass slab with lateral displacement, then switch to a prism and see white light split into VIBGYOR!',
    subject: 'physics',
    grade: ['9', '10'],
    thumbnailEmoji: '\uD83C\uDF08',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Refraction', 'Glass Slab', 'Prism', 'Dispersion', 'VIBGYOR', 'Snell\'s Law', 'Lateral Displacement', 'Light'],
    foxyTip: 'In a glass slab, the emergent ray is always parallel to the incident ray — but shifted sideways. Try increasing the angle to see the lateral displacement grow!',
    component: RefractionLab,
  },
  {
    id: 'builtin-respiration-lab',
    title: 'Aerobic vs Anaerobic Respiration',
    description: 'Watch glucose break down in two pathways side-by-side! Compare ATP production, see molecules flow through mitochondria, and toggle yeast vs muscle cells.',
    subject: 'biology',
    grade: ['9', '10'],
    thumbnailEmoji: '\uD83E\uDEC1',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Respiration', 'Aerobic', 'Anaerobic', 'ATP', 'Mitochondria', 'Glucose', 'Fermentation', 'Life Processes'],
    foxyTip: 'Aerobic respiration makes 38 ATP but anaerobic only makes 2 — that is 19x less! This is why you breathe harder during exercise — your muscles need oxygen for maximum energy.',
    component: RespirationLab,
  },
  {
    id: 'builtin-magnetic-field-electric',
    title: 'Magnetic Effects of Electric Current',
    description: 'See circular magnetic field lines form around a current-carrying wire! Toggle to solenoid mode, reverse current direction, and use the right-hand rule.',
    subject: 'physics',
    grade: ['9', '10'],
    thumbnailEmoji: '\uD83E\uDDF2',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Magnetic Field', 'Electric Current', 'Right-Hand Rule', 'Solenoid', 'Compass', 'Electromagnetism'],
    foxyTip: 'Reverse the current direction and watch all the compass needles flip! The right-hand thumb rule tells you the field direction every time.',
    component: MagneticFieldElectric,
  },
  {
    id: 'builtin-meter-bridge',
    title: 'Meter Bridge — Find Unknown Resistance',
    description: 'Slide the jockey along a 1-metre wire to find the null point. Use the Wheatstone bridge principle R = S × l/(100−l) to determine unknown resistance.',
    subject: 'physics',
    grade: ['11', '12'],
    thumbnailEmoji: '🔌',
    difficulty: 3,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 12,
    conceptTags: ['Meter Bridge', 'Wheatstone Bridge', 'Resistance', 'Null Point', 'Galvanometer', 'Current Electricity'],
    foxyTip: 'Change the known resistance S and take multiple readings — the average gives a more accurate result. Watch the galvanometer needle carefully!',
    component: MeterBridgeLab,
  },
  {
    id: 'builtin-convex-lens',
    title: 'Convex Lens — Image Formation',
    description: 'Move the object to 5 standard positions and watch real/virtual images form. Verify the lens formula 1/v − 1/u = 1/f with live calculations.',
    subject: 'physics',
    grade: ['11', '12'],
    thumbnailEmoji: '🔭',
    difficulty: 3,
    bloomLevel: 'analyze',
    estimatedTimeMinutes: 15,
    conceptTags: ['Convex Lens', 'Image Formation', 'Lens Formula', 'Magnification', 'Real Image', 'Virtual Image', 'Ray Diagram'],
    foxyTip: 'Place the object exactly at 2F — the image is the same size! Now move it between F and 2F and notice the image is magnified. This is how projectors work.',
    component: ConvexLensLab,
  },
  {
    id: 'builtin-potentiometer',
    title: 'Potentiometer — Compare EMFs',
    description: 'Find balance lengths for two cells and compare their EMFs using E1/E2 = l1/l2. See animated current flow and understand why a potentiometer beats a voltmeter.',
    subject: 'physics',
    grade: ['11', '12'],
    thumbnailEmoji: '🔋',
    difficulty: 3,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 12,
    conceptTags: ['Potentiometer', 'EMF', 'Balance Length', 'Null Method', 'Galvanometer', 'Current Electricity'],
    foxyTip: 'At the balance point, no current flows through the galvanometer — that is why the potentiometer measures true EMF without any internal resistance drop!',
    component: PotentiometerLab,
  },
  {
    id: 'builtin-mitosis',
    title: 'Mitosis — Onion Root Tip',
    description: 'Watch a cell divide through all stages of mitosis! See chromosomes condense, align, and separate with animated transitions. Click any stage for detailed CBSE descriptions.',
    subject: 'biology',
    grade: ['11'],
    thumbnailEmoji: '\uD83E\uDDEC',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 10,
    conceptTags: ['Mitosis', 'Cell Division', 'Chromosomes', 'Prophase', 'Metaphase', 'Anaphase', 'Telophase', 'Cytokinesis'],
    foxyTip: 'Most cells in an onion root tip squash are in interphase — it is the longest phase! Can you spot the rare anaphase cells? They are the shortest phase.',
    component: MitosisLab,
  },
  {
    id: 'builtin-punnett-square',
    title: 'Punnett Square — Mendelian Genetics',
    description: 'Cross pea plants just like Mendel! Select parent genotypes and watch the Punnett square build with animated gametes. See the classic 3:1 and 9:3:3:1 ratios come alive.',
    subject: 'biology',
    grade: ['10', '12'],
    thumbnailEmoji: '\uD83C\uDF31',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Genetics', 'Punnett Square', 'Monohybrid', 'Dihybrid', 'Mendel', 'Phenotype', 'Genotype', 'Heredity'],
    foxyTip: 'Try Tt x Tt for the classic 3:1 ratio. Then switch to dihybrid with TtRr x TtRr to see 9:3:3:1 — the most asked ratio in board exams!',
    component: PunnettSquareLab,
  },
  {
    id: 'builtin-dna-replication',
    title: 'DNA Replication Lab',
    description: 'Watch DNA replicate step by step! See helicase unwind the helix, DNA polymerase add bases, Okazaki fragments form, and DNA ligase seal the gaps. Colour-coded A-T and G-C base pairs.',
    subject: 'biology',
    grade: ['12'],
    thumbnailEmoji: '\uD83E\uDDEC',
    difficulty: 3,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 12,
    conceptTags: ['DNA Replication', 'Helicase', 'DNA Polymerase', 'Okazaki Fragments', 'Semi-conservative', 'Base Pairing', 'Molecular Biology'],
    foxyTip: 'The leading strand is synthesised continuously but the lagging strand needs Okazaki fragments — DNA polymerase can only work 5\' to 3\'! This is a key board exam concept.',
    component: DNAReplicationLab,
  },
  {
    id: 'builtin-acid-base-titration',
    title: 'Acid-Base Titration Lab',
    description: 'Drip NaOH into HCl and watch the pH curve build in real time! See the sharp equivalence point at pH 7 and observe the indicator colour change from red to purple.',
    subject: 'chemistry',
    grade: ['11', '12'],
    thumbnailEmoji: '\uD83E\uDDEA',
    difficulty: 3,
    bloomLevel: 'analyze',
    estimatedTimeMinutes: 12,
    conceptTags: ['Titration', 'pH', 'Acid-Base', 'Equivalence Point', 'Indicators', 'NaOH', 'HCl', 'Electrochemistry'],
    foxyTip: 'The pH jumps sharply from ~3 to ~11 near the equivalence point — this is why just one extra drop of base turns the indicator! This sharp jump is the key to accurate titration.',
    component: AcidBaseTitration,
  },
  {
    id: 'builtin-electron-configuration',
    title: 'Electron Configuration Explorer',
    description: 'Pick any element (H to Kr) and see its electrons fill into orbital boxes following Aufbau principle and Hund\'s rule. Spot the special cases Cr and Cu!',
    subject: 'chemistry',
    grade: ['11', '12'],
    thumbnailEmoji: '\u26DB',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 10,
    conceptTags: ['Electron Configuration', 'Aufbau Principle', "Hund's Rule", 'Orbital', 'Pauli Exclusion', 'Atomic Structure', 'Periodic Table'],
    foxyTip: 'Chromium (Cr, Z=24) and Copper (Cu, Z=29) are exceptions to Aufbau — they steal an electron from 4s to half-fill or fully fill 3d. Extra stability from half-filled and fully-filled d orbitals!',
    component: ElectronConfiguration,
  },
  {
    id: 'builtin-states-of-matter',
    title: 'States of Matter — Particle Simulation',
    description: 'Watch 60 particles transition from solid to liquid to gas as temperature rises! See lattice vibration, free flow, and rapid gas motion emerge from the same particles.',
    subject: 'chemistry',
    grade: ['9', '10'],
    thumbnailEmoji: '\uD83D\uDD25',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['States of Matter', 'Solid', 'Liquid', 'Gas', 'Kinetic Theory', 'Melting', 'Boiling', 'Particle Motion'],
    foxyTip: 'Notice that particles in a solid vibrate in place but never change position — that\'s why solids have a fixed shape! Increase temperature past 300K to see them break free into liquid.',
    component: StatesOfMatter,
  },
  {
    id: 'builtin-electrochemical-cell',
    title: 'Electrochemical Cell (Galvanic)',
    description: 'Watch the Daniell cell in action! See electrons flow from anode to cathode, ions migrate through the salt bridge, and calculate E°cell using electrode potentials.',
    subject: 'chemistry',
    grade: ['11', '12'],
    thumbnailEmoji: '\uD83D\uDD0B',
    difficulty: 3,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 12,
    conceptTags: ['Electrochemistry', 'Galvanic Cell', 'Daniell Cell', 'EMF', 'Electrode Potential', 'Oxidation', 'Reduction', 'Nernst Equation', 'Salt Bridge'],
    foxyTip: 'The anode always loses mass (metal dissolves) while the cathode gains mass (metal deposits) — try the Zn|Cu cell and trace where each atom goes! This is electrolysis in reverse.',
    component: ElectrochemicalCell,
  },
  {
    id: 'builtin-vector-addition',
    title: 'Vector Addition — Parallelogram Law',
    description: 'Set magnitude and angle for two vectors and watch the resultant form using the parallelogram law! See Cartesian components, resultant magnitude, and direction angle live.',
    subject: 'math',
    grade: ['11', '12'],
    thumbnailEmoji: '➡️',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Vectors', 'Parallelogram Law', 'Resultant', 'Components', 'Magnitude', 'Direction', 'Triangle Law'],
    foxyTip: 'Try angle A = 0° and angle B = 90° — the resultant is the hypotenuse! Change both to 45° and compare — the magnitude is highest when they point the same way.',
    component: VectorAddition,
  },
  {
    id: 'builtin-set-theory-venn',
    title: 'Set Theory & Venn Diagrams',
    description: 'Enter elements for Set A, Set B, and Universal Set U. Click regions on the Venn diagram to explore union, intersection, difference, and complement with the inclusion-exclusion formula.',
    subject: 'math',
    grade: ['11', '12'],
    thumbnailEmoji: '⭕',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 8,
    conceptTags: ['Sets', 'Venn Diagram', 'Union', 'Intersection', 'Complement', 'Difference', 'Inclusion-Exclusion', 'Universal Set'],
    foxyTip: 'n(A∪B) = n(A) + n(B) − n(A∩B) — try changing the sets so A∩B is empty. The union is just their sum! This is the most important formula in sets for board exams.',
    component: SetTheoryVenn,
  },
  {
    id: 'builtin-statistics-lab',
    title: 'Statistics Lab — Measures of Central Tendency',
    description: 'Input any dataset or pick a preset and instantly compute mean, median, mode, variance, and standard deviation! See a histogram with mean and median lines marked.',
    subject: 'math',
    grade: ['9', '10', '11', '12'],
    thumbnailEmoji: '📊',
    difficulty: 2,
    bloomLevel: 'analyze',
    estimatedTimeMinutes: 10,
    conceptTags: ['Statistics', 'Mean', 'Median', 'Mode', 'Variance', 'Standard Deviation', 'Histogram', 'Data Handling', 'Range'],
    foxyTip: 'Add one very large outlier to the exam scores — watch the mean jump but the median barely moves! Mean is sensitive to outliers, median is not. That is why median household income is used, not mean.',
    component: StatisticsLab,
  },
  {
    id: 'builtin-circuit-builder',
    title: 'Circuit Builder — Series & Parallel',
    description: 'Build series and parallel circuits with adjustable resistors and voltage. Apply Kirchhoff\'s laws and Ohm\'s law — watch wire colour shift with current intensity.',
    subject: 'physics',
    grade: ['9', '10', '11', '12'],
    thumbnailEmoji: '🔌',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ['Circuits', 'Series', 'Parallel', "Ohm's Law", "Kirchhoff's Law", 'Current', 'Voltage', 'Resistance', 'Power'],
    foxyTip: 'In a parallel circuit, adding more resistors drops total resistance and increases current! Try both at 10Ω — parallel gives half the resistance of series. That is why home appliances are wired in parallel.',
    component: CircuitBuilder,
  },
  {
    id: 'builtin-magnetic-field',
    title: 'Magnetic Field Around a Conductor',
    description: 'Visualize concentric magnetic field lines around a current-carrying wire. Apply the right-hand rule, reverse current direction, and calculate B at distances using Ampere\'s law.',
    subject: 'physics',
    grade: ['10', '11', '12'],
    thumbnailEmoji: '🧲',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Magnetic Field', "Ampere's Law", 'Right-Hand Rule', 'Current', 'Electromagnetism', 'Field Lines'],
    foxyTip: 'Reverse the current and watch all field arrows flip direction! The field is strongest near the wire — notice how circles are more crowded there. This is the inverse relationship B ∝ 1/r.',
    component: MagneticField,
  },
  {
    id: 'builtin-wave-interference',
    title: 'Wave Interference & Superposition',
    description: 'Superpose two sine waves and observe constructive and destructive interference. Adjust frequency, amplitude, and phase to create beat patterns and standing waves.',
    subject: 'physics',
    grade: ['11', '12'],
    thumbnailEmoji: '〰️',
    difficulty: 3,
    bloomLevel: 'analyze',
    estimatedTimeMinutes: 12,
    conceptTags: ['Wave Interference', 'Superposition', 'Constructive', 'Destructive', 'Beats', 'Phase', 'Amplitude', 'Frequency'],
    foxyTip: 'Set both waves to the same frequency but phase = 180° — they cancel out completely! That is destructive interference. Now set phase = 0° for maximum constructive interference. Noise-cancelling headphones use this!',
    component: WaveInterference,
  },
  {
    id: 'builtin-coulombs-law',
    title: "Coulomb's Law — Electrostatic Forces",
    description: 'Place two point charges and watch the electrostatic force update instantly. Adjust charge magnitudes, distance, and signs to verify F = kq₁q₂/r² in real-time.',
    subject: 'physics',
    grade: ['10', '11', '12'],
    thumbnailEmoji: '⚛️',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedTimeMinutes: 10,
    conceptTags: ["Coulomb's Law", 'Electrostatics', 'Electric Force', 'Point Charges', 'Inverse Square Law', 'Attraction', 'Repulsion'],
    foxyTip: 'Double the distance and the force drops to 1/4 — that is the inverse square law! Now double both charges and the force quadruples. This is why Coulomb\'s law is so powerful for board exam numericals.',
    component: CoulombsLaw,
  },
  {
    id: 'builtin-sound-waves',
    title: 'Sound Waves — Frequency & Amplitude',
    description: 'See sound as both a longitudinal (particle compression) wave and a transverse sine wave simultaneously. Adjust frequency and amplitude to visualize wavelength, period, and wave speed.',
    subject: 'physics',
    grade: ['9', '10', '11'],
    thumbnailEmoji: '🔊',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedTimeMinutes: 8,
    conceptTags: ['Sound Waves', 'Longitudinal Wave', 'Compression', 'Rarefaction', 'Frequency', 'Amplitude', 'Wavelength', 'Wave Speed'],
    foxyTip: 'Increase frequency and watch the wavelength shrink — v = fλ means if speed is fixed, higher frequency = shorter wavelength. That is why a piccolo (high frequency) sounds sharper than a bass guitar!',
    component: SoundWaves,
  },
  // ── 65 new simulations ────────────────────────────────────────────────
  // Physics 6-8
  { id:'builtin-simple-machines', title:'Simple Machines Lab', description:'Explore levers, pulleys, and inclined planes! Adjust effort and load positions to discover mechanical advantage.', subject:'physics', grade:['6','7','8'], thumbnailEmoji:'⚙️', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Simple Machines','Lever','Pulley','Inclined Plane','Mechanical Advantage'], foxyTip:'A longer effort arm means less force needed! That\'s why door handles are placed far from the hinge.', component:SimpleMachines },
  { id:'builtin-mirror-reflection', title:'Law of Reflection', description:'Shine a ray on a mirror and see angle of incidence always equals angle of reflection. Drag the angle to verify!', subject:'physics', grade:['6','7','8'], thumbnailEmoji:'🪞', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Light','Reflection','Mirror','Angle of Incidence','Normal'], foxyTip:'The normal line is always perpendicular to the mirror surface. Both angles are measured from the normal, not the mirror!', component:MirrorReflection },
  { id:'builtin-electric-charge', title:"Electric Charges & Coulomb's Force", description:'See how positive and negative charges attract and repel! Watch the force arrow change as you move charges closer.', subject:'physics', grade:['8','9'], thumbnailEmoji:'⚡', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Electric Charge','Coulomb\'s Law','Attraction','Repulsion','Force'], foxyTip:'Halve the distance and the force becomes 4× stronger! Coulomb\'s law follows an inverse square relationship.', component:ElectricCharge },
  { id:'builtin-heat-transfer', title:'Heat Transfer: Conduction, Convection & Radiation', description:'See all three modes of heat transfer! A metal rod conducts, fluids convect, and the sun radiates energy.', subject:'physics', grade:['7','8'], thumbnailEmoji:'🔥', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:8, conceptTags:['Heat Transfer','Conduction','Convection','Radiation','Thermal Energy'], foxyTip:'Metals are good conductors because their free electrons carry kinetic energy quickly along the rod!', component:HeatTransfer },
  { id:'builtin-speed-distance-time', title:'Speed, Distance & Time Graph', description:'Watch a car move and plot distance-time graphs in real time! See how speed changes the slope of the graph.', subject:'physics', grade:['6','7'], thumbnailEmoji:'🚗', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:7, conceptTags:['Speed','Distance','Time','Motion','Graph','Kinematics'], foxyTip:'The slope of a distance-time graph equals the speed! A steeper slope means faster motion.', component:SpeedDistanceTime },
  { id:'builtin-light-refraction', title:"Light Refraction — Snell's Law", description:"Bend light through different media and verify Snell's law! Watch for total internal reflection as the angle increases.", subject:'physics', grade:['8','9','10'], thumbnailEmoji:'💡', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Light','Refraction','Snell\'s Law','Refractive Index','TIR'], foxyTip:'Optical fibers use total internal reflection to carry data at the speed of light over thousands of kilometers!', component:LightRefraction },
  { id:'builtin-solar-system', title:'Solar System Orbital Simulator', description:'Watch all 8 planets orbit the Sun! Click any planet to see its name and distance. Mercury is the fastest — can you see why?', subject:'physics', grade:['6','7','8'], thumbnailEmoji:'🪐', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:10, conceptTags:['Solar System','Planets','Orbit','Kepler\'s Laws','Gravity'], foxyTip:'Mercury completes a year in just 88 Earth days because it\'s closest to the Sun — and gravity pulls it harder!', component:SolarSystem },
  { id:'builtin-weather-cycle', title:'The Water Cycle', description:'Follow a water molecule through evaporation, condensation, precipitation, and collection! See the complete water cycle animated.', subject:'physics', grade:['6','7'], thumbnailEmoji:'🌧️', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Water Cycle','Evaporation','Condensation','Precipitation','Collection'], foxyTip:'The sun is the engine of the water cycle — solar energy evaporates water from oceans. Without the sun, there would be no rain!', component:WeatherCycle },
  { id:'builtin-echo-sound', title:'Echo & Speed of Sound Calculator', description:'Send sound to a wall and calculate echo delay! Change distance and see how far you must be to hear a distinct echo.', subject:'physics', grade:['8','9'], thumbnailEmoji:'📢', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:7, conceptTags:['Sound','Echo','Speed of Sound','Reflection','Waves'], foxyTip:'You need at least 17.2m from a wall to hear a distinct echo — your ears need 0.1s between original sound and echo!', component:EchoAndSound },
  { id:'builtin-shadow-formation', title:'Shadow Formation & Umbra/Penumbra', description:'Move the light source and watch the shadow change! See why solar eclipses have both a dark centre (umbra) and lighter outer shadow.', subject:'physics', grade:['6','7'], thumbnailEmoji:'🌑', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Light','Shadow','Umbra','Penumbra','Opaque Objects','Rectilinear Propagation'], foxyTip:'The umbra is the region of total shadow — no light at all. The penumbra gets partial light. This is exactly what happens in a solar eclipse!', component:ShadowFormation },
  // Physics 9-12
  { id:'builtin-electric-motor', title:'DC Electric Motor', description:'See how a current-carrying coil in a magnetic field produces rotation! Understand the commutator and Fleming\'s left-hand rule.', subject:'physics', grade:['10','11'], thumbnailEmoji:'🔄', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:10, conceptTags:['Electric Motor','Magnetic Force','F=BIL','Commutator','Fleming\'s Left-Hand Rule'], foxyTip:'The commutator reverses current direction every half rotation — without it the coil would just rock back and forth!', component:ElectricMotor },
  { id:'builtin-transformer', title:'Transformer — Turns Ratio & Voltage', description:'Step voltage up or down using transformer coils! Change the turns ratio and watch V₁/V₂ = N₁/N₂ work perfectly.', subject:'physics', grade:['10','11','12'], thumbnailEmoji:'🔌', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Transformer','Turns Ratio','Step-up','Step-down','Electromagnetic Induction'], foxyTip:'Power lines use step-up transformers to carry electricity at high voltage (low current) — this reduces energy loss in wires!', component:Transformer },
  { id:'builtin-resistors-series', title:'Resistors in Series — Voltage Divider', description:'Connect 3 resistors in series and see how voltage divides proportionally! Verify that total resistance = sum of all.', subject:'physics', grade:['10','11'], thumbnailEmoji:'⚡', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Resistance','Series Circuit','Voltage Divider','Kirchhoff\'s Voltage Law','Current'], foxyTip:'In a series circuit, current is the same everywhere but voltage splits! The largest resistor gets the most voltage.', component:ResistorsInSeries },
  { id:'builtin-concave-mirror', title:'Concave Mirror Ray Diagrams', description:'Move an object in front of a concave mirror and watch the image form! Verify the mirror formula 1/v + 1/u = 1/f.', subject:'physics', grade:['10','11','12'], thumbnailEmoji:'🔍', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:12, conceptTags:['Concave Mirror','Ray Diagram','Image Formation','Mirror Formula','Magnification'], foxyTip:'Place the object between F and P — you get a virtual, magnified image behind the mirror. This is how makeup mirrors work!', component:ConcaveMirrorLab },
  { id:'builtin-convex-lens-new', title:'Convex Lens — Ray Construction', description:'Construct ray diagrams for a convex lens! See how image type changes as the object moves through different positions.', subject:'physics', grade:['10','11','12'], thumbnailEmoji:'🔭', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:12, conceptTags:['Convex Lens','Ray Diagram','Focal Length','Magnification','Real/Virtual Image'], foxyTip:'Object between F and lens = virtual magnified image (magnifying glass). Object at 2F = same size image. Beyond 2F = diminished image!', component:ConvexLens },
  { id:'builtin-free-body-diagram', title:'Free Body Diagram Builder', description:'Apply forces to an object and see all vectors! Adjust friction, applied force, and mass to find net force and acceleration.', subject:'physics', grade:['9','10','11'], thumbnailEmoji:'⬆️', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:9, conceptTags:['Force','Free Body Diagram','Friction','Normal Force','Newton\'s Second Law','F=ma'], foxyTip:'When net force = 0, the object is in equilibrium — it either stays still or moves at constant velocity (Newton\'s First Law)!', component:FreeBodyDiagram },
  { id:'builtin-archimedes', title:"Archimedes' Principle — Buoyancy Lab", description:"Submerge objects in water and watch the spring scale reading drop! See why dense objects sink while less dense ones float.", subject:'physics', grade:['9','10'], thumbnailEmoji:'🚢', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:9, conceptTags:['Buoyancy','Archimedes\'Principle','Density','Floating','Sinking','Upthrust'], foxyTip:'A steel ship floats because it displaces water equal to its weight — not its volume! The hollow hull includes air.', component:ArchimedesPrinciple },
  { id:'builtin-em-spectrum', title:'Electromagnetic Spectrum Explorer', description:'Click each region from radio waves to gamma rays! See wavelength, frequency, uses, and everyday examples for each type.', subject:'physics', grade:['10','11','12'], thumbnailEmoji:'🌈', difficulty:2, bloomLevel:'remember', estimatedTimeMinutes:8, conceptTags:['Electromagnetic Spectrum','Radio Waves','Microwaves','X-rays','Gamma Rays','Wavelength','Frequency'], foxyTip:'All EM waves travel at 3×10⁸ m/s in vacuum! Only wavelength and frequency change — shorter wavelength means higher frequency.', component:ElectromagneticSpectrum },
  { id:'builtin-capacitor-charging', title:'Capacitor Charging in RC Circuit', description:'Watch a capacitor charge exponentially! Change R and C to see how the time constant τ = RC controls the charging speed.', subject:'physics', grade:['12'], thumbnailEmoji:'🔋', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:12, conceptTags:['Capacitor','RC Circuit','Charging','Time Constant','Exponential Growth','Current Electricity'], foxyTip:'After 5τ (5 time constants), the capacitor is 99.3% charged! Engineers use this to design timing circuits.', component:CapacitorCharging },
  { id:'builtin-doppler-effect', title:'Doppler Effect Simulator', description:'Watch sound waves compress and stretch as a source moves! Calculate the frequency shift heard by observers in different positions.', subject:'physics', grade:['11','12'], thumbnailEmoji:'🚨', difficulty:3, bloomLevel:'apply', estimatedTimeMinutes:10, conceptTags:['Doppler Effect','Frequency Shift','Sound','Moving Source','Wave Compression'], foxyTip:'The Doppler effect works for light too! Astronomers use it to detect red-shifted galaxies moving away from us.', component:DopplerEffect },
  { id:'builtin-young-double-slit', title:"Young's Double Slit — Interference", description:"See light interfere through two slits! Change wavelength, slit separation, and screen distance to control fringe width.", subject:'physics', grade:['12'], thumbnailEmoji:'〰️', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:12, conceptTags:['Young\'s Double Slit','Interference','Fringe Width','Wavelength','Wave Optics'], foxyTip:'Fringe width β = λD/d. Double the screen distance D and fringes double in width. Halve the slit separation d and fringes also double!', component:YoungDoubleSlitLab },
  { id:'builtin-nuclear-decay', title:'Radioactive Decay & Half-Life', description:'Watch nuclei decay one by one in real time! See the N vs t curve form and understand what half-life really means.', subject:'physics', grade:['12'], thumbnailEmoji:'☢️', difficulty:3, bloomLevel:'apply', estimatedTimeMinutes:10, conceptTags:['Radioactivity','Nuclear Decay','Half-Life','Alpha','Beta','Gamma','Exponential Decay'], foxyTip:'After 10 half-lives, only 1/1024 of the original sample remains. Carbon-14 dating uses this to determine the age of ancient materials!', component:NuclearDecay },
  { id:'builtin-photoelectric-effect', title:'Photoelectric Effect Lab', description:'Shine light on a metal and see electrons fly off! Only frequency (not intensity) determines if emission occurs.', subject:'physics', grade:['12'], thumbnailEmoji:'💥', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:10, conceptTags:['Photoelectric Effect','Threshold Frequency','Work Function','Kinetic Energy','Photon','Quantum Physics'], foxyTip:'Einstein won the Nobel Prize for explaining this! Increasing intensity increases the NUMBER of electrons, not their energy.', component:PhotoelectricEffect },
  // Chemistry 6-8
  { id:'builtin-element-classifier', title:'Element Classifier — Metals, Non-metals, Metalloids', description:'Sort 12 elements into their correct categories! Discover what properties define metals, non-metals, and metalloids.', subject:'chemistry', grade:['8','9'], thumbnailEmoji:'🧪', difficulty:1, bloomLevel:'remember', estimatedTimeMinutes:7, conceptTags:['Elements','Metals','Non-metals','Metalloids','Periodic Table','Properties'], foxyTip:'Metalloids like Silicon and Germanium are semiconductors — they\'re why your phone chips work! Too conducting for insulators, not enough for metals.', component:ElementClassifier },
  { id:'builtin-mixtures-separation', title:'Separating Mixtures Lab', description:'Learn filtration, distillation, and evaporation with animated lab equipment! See which method works for each type of mixture.', subject:'chemistry', grade:['6','7','8'], thumbnailEmoji:'⚗️', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:8, conceptTags:['Mixtures','Filtration','Distillation','Evaporation','Separation Techniques'], foxyTip:'Sea water is separated by distillation — but industrial plants use reverse osmosis (pressure through membranes) because it\'s cheaper!', component:MixturesSeparation },
  { id:'builtin-water-electrolysis', title:'Electrolysis of Water', description:'Pass current through water and watch hydrogen and oxygen bubble up in a 2:1 ratio! Verify the equation 2H₂O → 2H₂ + O₂.', subject:'chemistry', grade:['8','9'], thumbnailEmoji:'💧', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Electrolysis','Water','Hydrogen','Oxygen','Cathode','Anode'], foxyTip:'Notice H₂ makes twice as many bubbles as O₂ — because water has 2 hydrogen atoms for every 1 oxygen! That\'s the 2:1 ratio.', component:WaterElectrolysis },
  { id:'builtin-litmus-test', title:'Litmus Test Lab', description:'Test 6 common substances with red and blue litmus paper! Discover which are acids, bases, or neutral substances.', subject:'chemistry', grade:['6','7','8'], thumbnailEmoji:'🧫', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:7, conceptTags:['Litmus','Acids','Bases','Neutral','Indicators','pH'], foxyTip:'Lemon juice turns blue litmus red (acid), baking soda turns red litmus blue (base). Your blood is slightly basic at pH 7.4!', component:LitmusTest },
  { id:'builtin-atom-builder', title:'Atom Builder — Protons, Neutrons, Electrons', description:'Add protons, neutrons, and electrons to build real atoms! Watch electrons fill shells and create ions by changing electron count.', subject:'chemistry', grade:['8','9','10'], thumbnailEmoji:'⚛️', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:9, conceptTags:['Atom','Protons','Neutrons','Electrons','Electron Configuration','Ions','Atomic Structure'], foxyTip:'Remove one electron from Na (sodium) and you get Na⁺ — this is exactly how table salt forms! Na⁺ bonds with Cl⁻.', component:AtomBuilder },
  { id:'builtin-periodic-trends', title:'Periodic Table Trends', description:'Explore how atomic radius, electronegativity, and ionisation energy change across the periodic table! See the heat map patterns.', subject:'chemistry', grade:['10','11','12'], thumbnailEmoji:'📊', difficulty:2, bloomLevel:'analyze', estimatedTimeMinutes:10, conceptTags:['Periodic Trends','Atomic Radius','Electronegativity','Ionisation Energy','Periodic Table','Periodicity'], foxyTip:'Atomic radius increases DOWN a group (more shells) but DECREASES across a period (more protons pull electrons closer).', component:PeriodicTrends },
  { id:'builtin-crystallization', title:'Crystallization — From Solution to Crystals', description:'Cool a hot saturated solution and watch crystals form! See the solubility curve and understand supersaturation.', subject:'chemistry', grade:['7','8'], thumbnailEmoji:'💎', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Crystallization','Solubility','Saturated Solution','Supersaturation','Crystal Formation'], foxyTip:'Slow cooling gives large, well-formed crystals. Fast cooling gives many tiny ones. Gemstone miners prefer the slowest natural cooling!', component:CrystallizationLab },
  { id:'builtin-rusting-experiment', title:'Rusting — Conditions for Corrosion', description:'Run the classic 3-test-tube experiment to find out what iron really needs to rust. Control variables just like a scientist!', subject:'chemistry', grade:['8','9'], thumbnailEmoji:'🔩', difficulty:1, bloomLevel:'analyze', estimatedTimeMinutes:8, conceptTags:['Rusting','Corrosion','Iron','Oxidation','Control Variables','Chemical Reactions'], foxyTip:'Iron needs BOTH water AND oxygen to rust — that\'s why painting iron prevents rust, it keeps both away from the metal surface!', component:RustingExperiment },
  // Chemistry 9-10
  { id:'builtin-molarity-calculator', title:'Molarity — Concentration Calculator', description:'Calculate molarity visually! See how moles, volume, and concentration are related, with a beaker that darkens as concentration rises.', subject:'chemistry', grade:['10','11'], thumbnailEmoji:'🧪', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Molarity','Concentration','Moles','Volume','Solution','Stoichiometry'], foxyTip:'A 1 mol/L (1M) solution has 1 mole of solute per litre of solution — not per litre of solvent! The final volume includes the solute.', component:MolarityCalculator },
  { id:'builtin-exo-endo-thermic', title:'Exothermic & Endothermic Reactions', description:'See energy diagrams for reactions! Adjust activation energy and enthalpy change. Add a catalyst and watch the barrier drop.', subject:'chemistry', grade:['10','11'], thumbnailEmoji:'🌡️', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:9, conceptTags:['Exothermic','Endothermic','Activation Energy','Enthalpy','Catalyst','Energy Diagram'], foxyTip:'A catalyst lowers activation energy but doesn\'t change ΔH — the reaction releases the same heat, just faster!', component:ExothermicEndothermic },
  { id:'builtin-ionic-covalent-bonds', title:'Ionic vs Covalent Bond Formation', description:'Watch electrons transfer in ionic bonds and share in covalent bonds! See the difference between Na+Cl and H₂O formation step by step.', subject:'chemistry', grade:['9','10','11'], thumbnailEmoji:'🔗', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:9, conceptTags:['Ionic Bond','Covalent Bond','Electron Transfer','Electron Sharing','Polarity','Chemical Bonding'], foxyTip:'Ionic bonds form between metals and non-metals (one gives electrons). Covalent bonds form between non-metals (electrons shared).', component:IonicCovalentBonds },
  { id:'builtin-metal-reactivity', title:'Metal Reactivity Series — Displacement Reactions', description:'Test if one metal can displace another from solution! See animated displacement reactions based on the activity series.', subject:'chemistry', grade:['10','11'], thumbnailEmoji:'⚗️', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:9, conceptTags:['Reactivity Series','Displacement Reactions','Metals','Activity Series','Redox'], foxyTip:'Zinc displaces copper from copper sulphate solution because Zn is more reactive. The solution turns from blue to colourless as Cu deposits!', component:MetalReactivitySeries },
  { id:'builtin-carbon-allotropes', title:'Carbon Allotropes — Diamond, Graphite & Fullerene', description:'Explore how the same carbon atoms arranged differently create completely different materials!', subject:'chemistry', grade:['11','12'], thumbnailEmoji:'💎', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:9, conceptTags:['Carbon','Allotropes','Diamond','Graphite','Fullerene','Bonding','Structure'], foxyTip:'Graphite conducts electricity because one electron per carbon is delocalized — diamond cannot because all 4 electrons are locked in bonds!', component:CarbonAllotropes },
  // Chemistry 11-12
  { id:'builtin-chemical-kinetics', title:'Chemical Kinetics — Rate vs Concentration', description:'See how reaction rate changes with concentration and temperature! Plot concentration-time curves and find the half-life.', subject:'chemistry', grade:['12'], thumbnailEmoji:'📈', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:12, conceptTags:['Kinetics','Rate of Reaction','Rate Constant','Arrhenius Equation','Half-Life','Order of Reaction'], foxyTip:'Increasing temperature by 10°C roughly doubles the reaction rate! This is the Arrhenius equation in action.', component:ChemicalKinetics },
  { id:'builtin-buffer-solution', title:'Buffer Solution — pH Stability', description:'Add acid or base to a buffer and compare with pure water! See how buffers resist pH change — just like your blood does.', subject:'chemistry', grade:['12'], thumbnailEmoji:'⚗️', difficulty:3, bloomLevel:'apply', estimatedTimeMinutes:10, conceptTags:['Buffer Solution','pH','Henderson-Hasselbalch','Weak Acid','Conjugate Base','Equilibrium'], foxyTip:'Your blood is buffered at pH 7.4 by a bicarbonate buffer. A change of just 0.4 pH units can be life-threatening!', component:BufferSolution },
  { id:'builtin-galvanic-cell', title:'Galvanic Cell — Daniell Cell Lab', description:'Watch the Daniell cell work! See zinc oxidize, copper deposit, and ions flow through the salt bridge to complete the circuit.', subject:'chemistry', grade:['12'], thumbnailEmoji:'🔋', difficulty:3, bloomLevel:'apply', estimatedTimeMinutes:12, conceptTags:['Galvanic Cell','Daniell Cell','Electrode Potential','EMF','Electrochemistry','Redox'], foxyTip:'The standard cell voltage 1.10V = E°(Cu/Cu²⁺) − E°(Zn/Zn²⁺) = 0.34 − (−0.76). This formula is key for board exams!', component:GalvanicCell },
  { id:'builtin-molecular-geometry', title:'VSEPR Molecular Geometry', description:'See the 3D shapes of molecules! From linear CO₂ to tetrahedral CH₄ — understand how electron pair repulsion determines shape.', subject:'chemistry', grade:['11','12'], thumbnailEmoji:'🔬', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:9, conceptTags:['VSEPR','Molecular Geometry','Bond Angles','Tetrahedral','Trigonal','Lone Pairs','Molecular Shape'], foxyTip:'Water is bent (not linear) because its two lone pairs repel more than bond pairs, pushing the H-O-H angle to 104.5°!', component:MolecularGeometry },
  // Biology 6-8
  { id:'builtin-food-web', title:'Food Web Builder', description:"Build a food web by connecting organisms! Remove a species and watch the cascade effect through the ecosystem.", subject:'biology', grade:['6','7','8'], thumbnailEmoji:'🌿', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:9, conceptTags:['Food Web','Food Chain','Trophic Levels','Producer','Consumer','Ecosystem'], foxyTip:'Only about 10% of energy passes from one trophic level to the next — that\'s why you need 10 kg of plants to grow 1 kg of herbivore!', component:FoodWeb },
  { id:'builtin-digestive-system', title:'Human Digestive System — Follow the Food', description:'Follow a food bolus through all digestive organs! Click each organ to learn which enzymes work there.', subject:'biology', grade:['7','8','10'], thumbnailEmoji:'🫁', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:10, conceptTags:['Digestion','Enzymes','Stomach','Small Intestine','Absorption','Life Processes'], foxyTip:'The small intestine is where 90% of nutrients are absorbed — its inner surface has finger-like villi that increase surface area 600×!', component:HumanDigestiveSystem },
  { id:'builtin-plant-parts', title:'Plant Parts & Functions', description:'Explore all parts of a flowering plant! Click any part to learn its function. Zoom into a leaf to see the cross-section.', subject:'biology', grade:['6','7'], thumbnailEmoji:'🌱', difficulty:1, bloomLevel:'remember', estimatedTimeMinutes:8, conceptTags:['Plant Parts','Root','Stem','Leaf','Flower','Functions','Botany'], foxyTip:'Leaves are nature\'s solar panels — they capture light energy and convert CO₂ + water into glucose. The green colour comes from chlorophyll!', component:PlantParts },
  { id:'builtin-alveoli-breathing', title:'Breathing & Gas Exchange in Alveoli', description:'Watch the diaphragm contract and expand! See oxygen enter blood and CO₂ leave through tiny alveoli in the lungs.', subject:'biology', grade:['7','8','10'], thumbnailEmoji:'🫁', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:8, conceptTags:['Breathing','Alveoli','Gas Exchange','Oxygen','Carbon Dioxide','Diffusion','Respiration'], foxyTip:'There are ~700 million alveoli in your lungs! Spread flat, they\'d cover half a tennis court — maximizing gas exchange surface area.', component:AlveoliBreathingLab },
  { id:'builtin-seed-germination', title:'Seed Germination Conditions', description:'Test what seeds need to germinate! Adjust water, temperature, and air. Find the limiting factor when growth is slow.', subject:'biology', grade:['6','7'], thumbnailEmoji:'🌱', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Germination','Seeds','Water','Temperature','Conditions','Plant Growth'], foxyTip:'Seeds don\'t need light to germinate — they use stored food (cotyledons). That\'s why seeds buried in soil can still sprout!', component:SeedGermination },
  { id:'builtin-animal-classification', title:'Animal Classification — Vertebrates & Invertebrates', description:'Sort 10 animals into vertebrate and invertebrate groups! Then classify vertebrates by their class.', subject:'biology', grade:['6','7','8'], thumbnailEmoji:'🦎', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Classification','Vertebrates','Invertebrates','Kingdom Animalia','Taxonomy','Biodiversity'], foxyTip:'Bats are mammals, not birds! And whales are mammals too — they breathe air, are warm-blooded, and nurse their young with milk.', component:AnimalClassification },
  { id:'builtin-water-purification', title:'Water Treatment Plant — Step by Step', description:'Follow water through 5 treatment stages from dirty river water to safe drinking water! See what each stage removes.', subject:'biology', grade:['7','8'], thumbnailEmoji:'💧', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:8, conceptTags:['Water Purification','Filtration','Chlorination','Sedimentation','Coagulation','Clean Water'], foxyTip:'Chlorination kills bacteria but some parasites like Cryptosporidium are chlorine-resistant! That\'s why modern plants use UV light too.', component:WaterPurification },
  // Biology 9-10
  { id:'builtin-heart-circulation', title:'Heart & Double Circulation', description:'Watch blood flow through all four heart chambers! See deoxygenated blood go to lungs and oxygenated blood reach the body.', subject:'biology', grade:['10','11'], thumbnailEmoji:'❤️', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:10, conceptTags:['Heart','Double Circulation','Pulmonary','Systemic','Chambers','Valves','Blood Flow'], foxyTip:'Mammals and birds have 4-chambered hearts for complete double circulation — fish only have 2 chambers and single circulation!', component:HeartCirculation },
  { id:'builtin-nervous-system', title:'Neuron Structure & Reflex Arc', description:'Explore neuron anatomy! Then trace a reflex arc from receptor to effector and see how signals travel faster without the brain.', subject:'biology', grade:['10','11','12'], thumbnailEmoji:'🧠', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:10, conceptTags:['Neuron','Reflex Arc','Synapse','Nerve Impulse','Myelin Sheath','Nervous System'], foxyTip:'Myelinated neurons conduct impulses at up to 120 m/s — four times faster than unmyelinated ones. That\'s why myelin loss (MS) slows signals!', component:NervousSystem },
  { id:'builtin-meiosis-stages', title:'Meiosis — All 8 Stages Animated', description:'Step through all stages of meiosis! See chromosomes pair up, cross over in Prophase I, then separate into 4 haploid cells.', subject:'biology', grade:['11','12'], thumbnailEmoji:'🔬', difficulty:3, bloomLevel:'understand', estimatedTimeMinutes:12, conceptTags:['Meiosis','Cell Division','Haploid','Crossing Over','Prophase I','Chromosomes','Genetics'], foxyTip:'Crossing over in Prophase I shuffles genetic material — this is why siblings from the same parents look different!', component:MeiosisStages },
  { id:'builtin-ecosystem-balance', title:'Predator-Prey Population Dynamics', description:'Watch rabbit and fox populations cycle! Change birth and death rates to see how ecosystems find balance — or collapse.', subject:'biology', grade:['10','11','12'], thumbnailEmoji:'🐰', difficulty:2, bloomLevel:'analyze', estimatedTimeMinutes:10, conceptTags:['Ecosystem','Predator-Prey','Population Dynamics','Lotka-Volterra','Food Web','Ecology'], foxyTip:'When prey decreases, predators starve and decline. Then prey recovers — and the cycle repeats! This is the Lotka-Volterra cycle.', component:EcosystemBalance },
  { id:'builtin-evolution-tree', title:'Phylogenetic Tree — Common Ancestors', description:"Explore the evolutionary tree of life! Find common ancestors between species and see the key traits that define each branch.", subject:'biology', grade:['10','11','12'], thumbnailEmoji:'🌳', difficulty:2, bloomLevel:'analyze', estimatedTimeMinutes:10, conceptTags:['Evolution','Phylogenetic Tree','Common Ancestor','Divergent Evolution','Cladogram','Natural Selection'], foxyTip:'Humans and fish share a common ancestor! All vertebrates evolved from a fish-like ancestor ~500 million years ago.', component:EvolutionTree },
  // Biology 11-12
  { id:'builtin-protein-synthesis', title:'Protein Synthesis — Transcription & Translation', description:'Watch DNA become protein! See RNA polymerase copy DNA into mRNA, then ribosomes translate codons into amino acids.', subject:'biology', grade:['12'], thumbnailEmoji:'🧬', difficulty:3, bloomLevel:'understand', estimatedTimeMinutes:12, conceptTags:['Protein Synthesis','Transcription','Translation','mRNA','Ribosome','Codon','Molecular Biology'], foxyTip:'The genetic code is universal — almost all organisms use the same codons! AUG always means methionine (start codon) in every living thing.', component:ProteinSynthesis },
  { id:'builtin-hormone-regulation', title:'Hormone Regulation & Feedback Loops', description:'See how the thyroid hormone system uses negative feedback! Trace the signal from hypothalamus to pituitary to thyroid and back.', subject:'biology', grade:['11','12'], thumbnailEmoji:'⚗️', difficulty:2, bloomLevel:'understand', estimatedTimeMinutes:10, conceptTags:['Hormones','Negative Feedback','Endocrine System','Hypothalamus','Pituitary','Thyroid','Homeostasis'], foxyTip:'Negative feedback is nature\'s thermostat — too much hormone inhibits more production. This keeps your body chemistry constantly balanced!', component:HormoneRegulation },
  { id:'builtin-gene-expression', title:'Gene Expression — Lac Operon', description:'Control gene expression like a cell! See how the lac operon switches ON when lactose is present and OFF when absent.', subject:'biology', grade:['12'], thumbnailEmoji:'🧬', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:12, conceptTags:['Gene Expression','Lac Operon','Repressor','Inducer','Transcription Control','Molecular Biology'], foxyTip:'E. coli only expresses lactose-digesting genes when lactose is present AND glucose is absent — it\'s an incredibly efficient molecular switch!', component:GeneExpression },
  // Math 6-8
  { id:'builtin-fraction-operations', title:'Fraction Operations — Visual Pie Charts', description:"Add, subtract, multiply, and divide fractions with pie chart visuals! See why 1/3 + 1/4 = 7/12 and not 2/7!", subject:'math', grade:['6','7','8'], thumbnailEmoji:'🍕', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Fractions','Addition','Subtraction','Multiplication','Division','LCM','Visualization'], foxyTip:'When adding fractions, you need the same denominator — the LCM. Think of it as cutting pizzas into equal slices before adding pieces!', component:FractionOperations },
  { id:'builtin-area-perimeter', title:'Area & Perimeter Shape Builder', description:'Build shapes with sliders and get instant area and perimeter! Compare how different shapes with the same perimeter can have different areas.', subject:'math', grade:['6','7','8'], thumbnailEmoji:'📐', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Area','Perimeter','Shapes','Circle','Triangle','Rectangle','Trapezoid','Geometry'], foxyTip:'A circle has the largest area for a given perimeter! That\'s why planets, bubbles, and animal cells are (nearly) spherical.', component:AreaPerimeter },
  { id:'builtin-number-line', title:'Integer Operations on a Number Line', description:'See addition, subtraction, and multiplication on a number line! Positive numbers jump right, negative jumps left — interactive and visual.', subject:'math', grade:['6','7'], thumbnailEmoji:'🔢', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Integers','Number Line','Addition','Subtraction','Negative Numbers','Absolute Value'], foxyTip:'Subtracting a negative is the same as adding a positive! (−3) − (−2) = −3 + 2 = −1. Think of it as removing a debt!', component:NumberLine },
  { id:'builtin-symmetry-lines-lab', title:'Symmetry in Alphabets & Polygons', description:"Find lines of symmetry in letters and shapes! Discover which letters have vertical, horizontal, or rotational symmetry.", subject:'math', grade:['6','7'], thumbnailEmoji:'🔡', difficulty:1, bloomLevel:'understand', estimatedTimeMinutes:7, conceptTags:['Symmetry','Lines of Symmetry','Rotational Symmetry','Alphabets','Regular Polygons'], foxyTip:'Letters H, I, O, and X have BOTH vertical and horizontal symmetry. Can you find a letter with only rotational symmetry but no line symmetry?', component:SymmetryLinesLab },
  { id:'builtin-data-handling', title:'Data Handling — Charts & Statistics', description:'Enter your own data and build bar charts, pie charts, and histograms! Calculate mean, median, mode, and range automatically.', subject:'math', grade:['6','7','8'], thumbnailEmoji:'📊', difficulty:1, bloomLevel:'apply', estimatedTimeMinutes:8, conceptTags:['Data Handling','Bar Chart','Pie Chart','Mean','Median','Mode','Range','Statistics'], foxyTip:'Mean is affected by outliers (extreme values) but median is not! That\'s why average salary data uses median — one billionaire skews the mean.', component:DataHandling },
  // Math 9-10
  { id:'builtin-coordinate-geometry', title:'Coordinate Geometry Lab', description:'Plot points, measure distances, find midpoints, and calculate slopes! Click to place points and see all formulas calculate instantly.', subject:'math', grade:['9','10'], thumbnailEmoji:'📍', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:10, conceptTags:['Coordinate Geometry','Distance Formula','Midpoint','Slope','Line Equation','Cartesian Plane'], foxyTip:'The distance formula is just Pythagoras Theorem in disguise! d = √(Δx² + Δy²) comes directly from the right triangle formed by the two points.', component:CoordinateGeometry },
  { id:'builtin-surface-area-volume', title:'Surface Area & Volume of 3D Shapes', description:'See 3D shapes with all dimensions! Calculate surface area and volume instantly. Compare shapes to see which holds more with less surface.', subject:'math', grade:['9','10'], thumbnailEmoji:'📦', difficulty:2, bloomLevel:'apply', estimatedTimeMinutes:10, conceptTags:['Surface Area','Volume','Cube','Cuboid','Cylinder','Cone','Sphere','3D Geometry'], foxyTip:'A sphere has the minimum surface area for a given volume — that\'s why soap bubbles are spherical! Nature minimizes surface energy.', component:SurfaceAreaVolume },
  { id:'builtin-circle-theorems', title:'Circle Theorems — Interactive Proofs', description:'Explore 5 circle theorems interactively! Drag points to verify that inscribed angles, tangent lines, and cyclic quadrilaterals always hold.', subject:'math', grade:['9','10'], thumbnailEmoji:'⭕', difficulty:2, bloomLevel:'analyze', estimatedTimeMinutes:11, conceptTags:['Circle Theorems','Inscribed Angle','Tangent','Cyclic Quadrilateral','Chord','Alternate Segment'], foxyTip:'The inscribed angle theorem says the angle at the circumference is HALF the angle at the centre for the same arc — always, without exception!', component:CircleTheorems },
  // Math 11-12
  { id:'builtin-limits-visualizer', title:'Limits — Graphical Approach', description:"Approach a limit from left and right on a graph! See when limits exist (LHL = RHL) and when they don't. Visualise holes in functions.", subject:'math', grade:['11','12'], thumbnailEmoji:'📉', difficulty:3, bloomLevel:'analyze', estimatedTimeMinutes:11, conceptTags:['Limits','Left-Hand Limit','Right-Hand Limit','Continuity','Calculus','Functions'], foxyTip:'lim(x→0) sin(x)/x = 1 even though sin(0)/0 is 0/0 undefined! The limit and the function value are different things.', component:LimitsVisualizer },
  { id:'builtin-matrix-operations', title:'Matrix Operations — Add, Multiply, Determinant', description:'Perform matrix operations with step-by-step working! See exactly how matrix multiplication works, find determinants, and invert 2×2 matrices.', subject:'math', grade:['11','12'], thumbnailEmoji:'🔢', difficulty:3, bloomLevel:'apply', estimatedTimeMinutes:12, conceptTags:['Matrices','Matrix Multiplication','Determinant','Inverse Matrix','Linear Algebra','Transpose'], foxyTip:'Matrix multiplication is NOT commutative — AB ≠ BA in general! This is why the order matters in linear transformations.', component:MatrixOperations },
];
