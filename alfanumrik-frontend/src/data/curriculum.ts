import type { ConceptNode, Subject } from '@/lib/types';

// === MATH CONCEPTS (Class 6-10 NCERT) ===
export const MATH_CONCEPTS: ConceptNode[] = [
  { id:'m6-1', subject:'math', grade:6, chapter:'Knowing Our Numbers', topic:'Place Value', title:'Place Value System', titleHi:'स्थानीय मान प्रणाली', bloomLevel:'remember', prerequisites:[], difficulty:0.2, discrimination:1.2 },
  { id:'m6-2', subject:'math', grade:6, chapter:'Playing with Numbers', topic:'Factors & Multiples', title:'Factors and Multiples', titleHi:'गुणनखंड और गुणज', bloomLevel:'apply', prerequisites:['m6-1'], difficulty:0.4, discrimination:1.3 },
  { id:'m6-3', subject:'math', grade:6, chapter:'Playing with Numbers', topic:'HCF & LCM', title:'HCF and LCM', titleHi:'म.स. और ल.स.', bloomLevel:'apply', prerequisites:['m6-2'], difficulty:0.5, discrimination:1.4 },
  { id:'m7-1', subject:'math', grade:7, chapter:'Integers', topic:'Integer Operations', title:'Operations on Integers', titleHi:'पूर्णांकों पर संक्रियाएँ', bloomLevel:'apply', prerequisites:['m6-1'], difficulty:0.45, discrimination:1.2 },
  { id:'m7-2', subject:'math', grade:7, chapter:'Fractions & Decimals', topic:'Fraction Operations', title:'Fraction Operations', titleHi:'भिन्नों पर संक्रियाएँ', bloomLevel:'apply', prerequisites:['m6-2'], difficulty:0.5, discrimination:1.3 },
  { id:'m7-3', subject:'math', grade:7, chapter:'Algebraic Expressions', topic:'Expressions', title:'Algebraic Expressions', titleHi:'बीजीय व्यंजक', bloomLevel:'understand', prerequisites:['m7-1'], difficulty:0.55, discrimination:1.1 },
  { id:'m8-1', subject:'math', grade:8, chapter:'Rational Numbers', topic:'Properties', title:'Rational Numbers', titleHi:'परिमेय संख्याएँ', bloomLevel:'understand', prerequisites:['m7-1','m7-2'], difficulty:0.5, discrimination:1.2 },
  { id:'m8-2', subject:'math', grade:8, chapter:'Linear Equations', topic:'Solving', title:'Linear Equations in One Variable', titleHi:'एक चर वाले रैखिक समीकरण', bloomLevel:'apply', prerequisites:['m7-3'], difficulty:0.6, discrimination:1.5 },
  { id:'m9-1', subject:'math', grade:9, chapter:'Number Systems', topic:'Real Numbers', title:'Real Number System', titleHi:'वास्तविक संख्या प्रणाली', bloomLevel:'understand', prerequisites:['m8-1'], difficulty:0.55, discrimination:1.3 },
  { id:'m9-2', subject:'math', grade:9, chapter:'Polynomials', topic:'Operations', title:'Polynomials', titleHi:'बहुपद', bloomLevel:'apply', prerequisites:['m7-3','m8-2'], difficulty:0.65, discrimination:1.4 },
  { id:'m9-3', subject:'math', grade:9, chapter:'Coordinate Geometry', topic:'Cartesian Plane', title:'Coordinate Geometry', titleHi:'निर्देशांक ज्यामिति', bloomLevel:'apply', prerequisites:['m8-2'], difficulty:0.6, discrimination:1.2 },
  { id:'m10-1', subject:'math', grade:10, chapter:'Quadratic Equations', topic:'Solving', title:'Quadratic Equations', titleHi:'द्विघात समीकरण', bloomLevel:'apply', prerequisites:['m9-2'], difficulty:0.7, discrimination:1.6 },
  { id:'m10-2', subject:'math', grade:10, chapter:'Trigonometry', topic:'Trig Ratios', title:'Trigonometric Ratios', titleHi:'त्रिकोणमितीय अनुपात', bloomLevel:'apply', prerequisites:['m9-3'], difficulty:0.7, discrimination:1.4 },
];

// === SCIENCE CONCEPTS ===
export const SCIENCE_CONCEPTS: ConceptNode[] = [
  { id:'s7-1', subject:'science', grade:7, chapter:'Heat', topic:'Temperature & Heat', title:'Heat and Temperature', titleHi:'ऊष्मा और तापमान', bloomLevel:'understand', prerequisites:[], difficulty:0.35, discrimination:1.1 },
  { id:'s8-1', subject:'science', grade:8, chapter:'Force & Pressure', topic:'Force', title:'Force and Pressure', titleHi:'बल और दाब', bloomLevel:'understand', prerequisites:['s7-1'], difficulty:0.45, discrimination:1.2 },
  { id:'s8-2', subject:'science', grade:8, chapter:'Chemical Effects', topic:'Electrochemistry', title:'Chemical Effects of Current', titleHi:'विद्युत धारा के रासायनिक प्रभाव', bloomLevel:'understand', prerequisites:[], difficulty:0.5, discrimination:1.3 },
  { id:'s9-1', subject:'science', grade:9, chapter:'Motion', topic:'Speed Velocity', title:'Motion', titleHi:'गति', bloomLevel:'apply', cbseCompetency:'Describes motion using graphs', prerequisites:['s8-1'], difficulty:0.55, discrimination:1.4 },
  { id:'s9-2', subject:'science', grade:9, chapter:'Force & Laws of Motion', topic:"Newton's Laws", title:'Laws of Motion', titleHi:'गति के नियम', bloomLevel:'analyze', cbseCompetency:"Applies Newton's laws to real-world", prerequisites:['s9-1'], difficulty:0.65, discrimination:1.5 },
  { id:'s9-3', subject:'science', grade:9, chapter:'Atoms & Molecules', topic:'Atomic Structure', title:'Atoms and Molecules', titleHi:'परमाणु और अणु', bloomLevel:'understand', prerequisites:[], difficulty:0.5, discrimination:1.2 },
  { id:'s10-1', subject:'science', grade:10, chapter:'Chemical Reactions', topic:'Types', title:'Chemical Reactions & Equations', titleHi:'रासायनिक अभिक्रियाएँ', bloomLevel:'apply', cbseCompetency:'Balances chemical equations', prerequisites:['s9-3'], difficulty:0.6, discrimination:1.4 },
  { id:'s10-2', subject:'science', grade:10, chapter:'Light', topic:'Reflection & Refraction', title:'Light: Reflection & Refraction', titleHi:'प्रकाश: परावर्तन और अपवर्तन', bloomLevel:'apply', cbseCompetency:'Ray diagram image formation', prerequisites:[], difficulty:0.65, discrimination:1.5 },
  { id:'s10-3', subject:'science', grade:10, chapter:'Electricity', topic:"Ohm's Law", title:'Electricity', titleHi:'विद्युत', bloomLevel:'apply', cbseCompetency:'Calculates R, I, V in circuits', prerequisites:['s8-2'], difficulty:0.7, discrimination:1.6 },
];

export const ALL_CONCEPTS = [...MATH_CONCEPTS, ...SCIENCE_CONCEPTS];

// === HELPERS ===
export function getConceptsBySubject(subject: Subject) { return ALL_CONCEPTS.filter(c => c.subject === subject); }
export function getSubjectIcon(s: Subject) { return {math:'🧮',science:'🔬',english:'📚',hindi:'📝',social_science:'🌍'}[s]; }
export function getSubjectColor(s: Subject) { return {math:'#FF6B35',science:'#00B4D8',english:'#FFB800',hindi:'#2DC653',social_science:'#9B4DAE'}[s]; }
export function getSubjectLabel(s: Subject) { return {math:'Mathematics',science:'Science',english:'English',hindi:'Hindi',social_science:'Social Science'}[s]; }
export function getSubjectLabelHi(s: Subject) { return {math:'गणित',science:'विज्ञान',english:'अंग्रेज़ी',hindi:'हिन्दी',social_science:'सामाजिक विज्ञान'}[s]; }
